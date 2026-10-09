import FleetAdmission          from '../../../util/FleetAdmission.mjs';
import GoldenPathEnvelope      from '../../../util/GoldenPathEnvelope.mjs';
import GraphSceneEnvelope      from '../../../util/GraphSceneEnvelope.mjs';
import TargetBinding           from '../../../util/TargetBinding.mjs';
import LivenessController      from './LivenessController.mjs';
import {FLEET_COCKPIT_SOURCES} from '../../../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * @summary The owner of the cockpit's resident south reading surfaces: the catch-up history (its
 * read, the explicit mark and the live-activity adjacency) and the computed Golden Path.
 *
 * The catch-up snapshot is read by its one pane, so it stays owner-held and is written to that pane
 * at write time, through the view's phase-blind accessors. So a pane torn into a vessel still
 * receives the truth, and a rematerialized pane starts from it. The Golden Path is read by more than
 * one pane, so it lands in the provider's `goldenPathEnvelope` leaf, which those panes bind. Every read
 * follows the inherited discipline: bump the fence first, check the verb is present, fall back to a
 * typed unavailable envelope (never a fabricated success), and let only the newest generation write.
 *
 * Sits between the wire-liveness layer ({@link AgentOS.view.fleet.cockpit.LivenessController}) and
 * the intent layer ({@link AgentOS.view.fleet.cockpit.Controller}).
 *
 * @class AgentOS.view.fleet.cockpit.ReadingSurfacesController
 * @extends AgentOS.view.fleet.cockpit.LivenessController
 */
class ReadingSurfacesController extends LivenessController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.ReadingSurfacesController'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.ReadingSurfacesController'
    }

    /**
     * Read-fence for the activity feed's older pages.
     * @member {Number} activityHistoryGeneration=0
     * @protected
     */
    activityHistoryGeneration = 0
    /**
     * The generation of the older-page read in flight, or `null`. A read from before a profile switch
     * stops counting, so it can neither block nor release the new profile's reads.
     * @member {Number|null} activityHistoryFlight=null
     * @protected
     */
    activityHistoryFlight = null
    /**
     * The profile the paging state belongs to. Once the store answers for another, that state resets.
     * @member {String|null} activityHistoryProfileId=null
     * @protected
     */
    activityHistoryProfileId = null
    /**
     * The store's count when an older page added no row; no page is asked again until it moves.
     * @member {Number|null} activityHistoryStalledAt=null
     * @protected
     */
    activityHistoryStalledAt = null
    /**
     * Read-fence + owner-held snapshot for the catch-up history surface.
     * @member {Number} catchUpReadGeneration=0
     * @protected
     */
    catchUpReadGeneration = 0
    /**
     * @member {Object|null} catchUpSnapshot=null
     * @protected
     */
    catchUpSnapshot = null
    /**
     * The last explicit mark-caught-up outcome, owner-held for pane rematerialization.
     * @member {Object|null} catchUpMarkOutcome=null
     * @protected
     */
    catchUpMarkOutcome = null
    /**
     * Read-fence for the Golden Path surface.
     * @member {Number} goldenPathReadGeneration=0
     * @protected
     */
    goldenPathReadGeneration = 0
    /**
     * Read-fence for the graph scene surface.
     * @member {Number} graphSceneReadGeneration=0
     * @protected
     */
    graphSceneReadGeneration = 0
    /**
     * Whether the graph leaf holds a landed read, whose profile `graphSceneProfileId` names.
     * @member {Boolean} graphSceneHeld=false
     * @protected
     */
    graphSceneHeld = false
    /**
     * The profile whose bridge answered the read the graph leaf holds ({@link AgentOS.util.TargetBinding}).
     * @member {String|null} graphSceneProfileId=null
     * @protected
     */
    graphSceneProfileId = null

    /**
     * @summary Relay the Activity stream's request for older events.
     * @returns {Promise<Object|null>}
     */
    onActivityHistoryRequest() {
        return this.loadActivityHistory()
    }

    /**
     * @summary READ-OBSERVE: the activity feed's next older page. The mailbox is the one lane that pages,
     * so the read asks it alone (`slots: ['a2a']`) at the offset of the mailbox rows the store holds: a
     * message lands as one row, and ids dedupe the overlap that new arrivals shift in. One page is in
     * flight at a time. Nothing is asked once the ring is full, since the page would be the tail it
     * evicts; once the mailbox answers no older row; or while a page that added nothing has not been
     * followed by a change in the store. The page lands through
     * {@link AgentOS.util.FleetAdmission#admitActivityHistory}; a failed read changes nothing.
     *
     * Every outcome belongs to the profile that asked. Once the store holds another profile, a late
     * answer is dropped whole, an empty page's end-of-history included, and the old profile's stall and
     * in-flight read no longer apply.
     * @param {Number} [limit=50] Rows per page.
     * @returns {Promise<Object|null>} The ingest result, or `null` when nothing was asked or landed.
     */
    async loadActivityHistory(limit = 50) {
        const
            me        = this,
            {bridge}  = me,
            provider  = me.component.getStateProvider(),
            store     = me.resolveFleetActivityEventsStore(),
            profileId = bridge?.profileId ?? null;

        if (me.activityHistoryProfileId !== me.activityProfileId) {
            me.activityHistoryProfileId = me.activityProfileId;
            me.activityHistoryStalledAt = null;
            me.activityHistoryFlight    = null;
            me.activityHistoryGeneration++
        }

        if (!store || !me.activityWired || me.activityHistoryFlight !== null || provider?.getData('streamHistoryExhausted')
            || store.count >= store.maxRecords || store.count === me.activityHistoryStalledAt
            || typeof bridge?.fleetActivity !== 'function') {
            return null
        }

        const
            generation = ++me.activityHistoryGeneration,
            offset     = store.items.filter(record => record.source === FLEET_COCKPIT_SOURCES.a2a).length;

        let answer;

        me.activityHistoryFlight = generation;

        try {
            answer = await me.boundedRead(
                Promise.resolve().then(() => bridge.fleetActivity({limit, offset, slots: ['a2a']})),
                () => { me.activityHistoryFlight === generation && (me.activityHistoryFlight = null) }
            )
        } catch (error) {
            return null
        }

        if (generation !== me.activityHistoryGeneration || me.isDestroyed || answer?.capability?.state !== 'wired'
            || !me.activityWired || me.activityProfileId !== profileId) {
            return null
        }

        const events = (answer.events || []).filter(event => event?.source === FLEET_COCKPIT_SOURCES.a2a);

        if (!events.length) {
            provider?.setData({streamHistoryExhausted: true});
            return null
        }

        const landed = FleetAdmission.admitActivityHistory(me, {events, profileId});

        me.activityHistoryStalledAt = landed?.added === 0 ? store.count : null;

        return landed
    }

    /**
     * @summary Relay a CatchUpPane read intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpHistoryRequest(data) {
        const {source, ...params} = data;

        return this.loadCatchUp(params)
    }

    /**
     * @summary Relay the explicit runtime-only mark intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpMarkRequest(data) {
        return this.markCatchUp({windowEnd: data.windowEnd})
    }

    /**
     * @summary Route to the existing live adjacency without turning it into history authority.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpLiveSurfaceRequest(data) {
        return this.openCatchUpLiveSurface({target: data.target})
    }

    /**
     * @summary Relay a GoldenPathPane read intent. The graph scene is the neighbourhood of the same
     * route, so it is read beside it, on its own fence.
     * @returns {Promise<Object>} The landed Golden Path envelope.
     */
    onGoldenPathRequest() {
        this.loadGraphScene();

        return this.loadGoldenPath()
    }

    /**
     * @summary Focus the existing bounded live Activity surface as adjacency. No history citation
     * is injected into it and no alternate historical authority is implied.
     *
     * The stream is a resident south tab, so adjacency ACTIVATES its tab first: the jump usually
     * originates from a sibling reading surface (catch-up) whose tab is active, and focusing the
     * inactive card's unmounted DOM would be a silent no-op.
     * @param {Object} request `{target}`
     * @returns {Promise<{opened: Boolean, target: String}>}
     */
    async openCatchUpLiveSurface({target} = {}) {
        const
            me     = this,
            stream = target === 'activity-stream' ? me.getReference('activity-stream') : null;

        if (!stream) {
            return {opened: false, target: target || 'unknown'}
        }

        await me.revealResidentTab('stream');
        stream.focus(stream.id, false, true);

        return {opened: true, target}
    }

    /**
     * @summary Open one session's turns in the Memories pane, for a view outside the cockpit (the
     * Observatory's selected session): the pane's tab comes forward and the pane drills into the session
     * ({@link AgentOS.view.fleet.memories.Container#openSession}), whose `sessionDetailRequest` reads it the
     * way a summary card's does.
     * @param {Object}      request
     * @param {String}      request.sessionId
     * @param {String|null} [request.title] Display only
     * @returns {Promise<{opened: Boolean, sessionId: String|null}>}
     */
    async openMemoriesSession({sessionId, title = null} = {}) {
        const me = this, pane = me.component.getMemoriesPane();

        if (typeof sessionId !== 'string' || !sessionId || !pane) {
            return {opened: false, sessionId: sessionId ?? null}
        }

        await me.revealResidentTab('memories');
        pane.openSession({sessionId, title});

        return {opened: true, sessionId}
    }

    /**
     * @summary Open the operator's open questions for a view outside the cockpit (Home's question count): the
     * Mailbox tab comes forward showing `for you · open`, read anew.
     * @returns {Promise<{opened: Boolean}>}
     */
    async openOperatorQuestions() {
        const me = this;

        await me.revealResidentTab('operator');

        const mailbox = me.component.getOperatorMailboxPane();

        mailbox?.showOpenQuestions();

        return {opened: !!mailbox}
    }

    /**
     * @summary Open the fleet head's merge queue for a view outside the cockpit (Home's merge count): the
     * roster's tab comes forward and its awaiting-merge button opens its list, when there is one.
     * @returns {Promise<{opened: Boolean}>}
     */
    async openMergeQueue() {
        const me = this;

        await me.revealResidentTab('fleet');

        const button = me.getReference('fleet-grid')?.getReference('awaiting-merge');

        return {opened: button ? await button.openMenu() : false}
    }

    /**
     * @summary Bring a resident tab forward in whichever dock node holds it under the current perspective. A
     * pane that left the dock (a vessel window) or a node that already shows it needs nothing.
     * @param {String} itemId The dock item, e.g. `stream` or `memories`
     * @returns {Promise<void>}
     * @protected
     */
    async revealResidentTab(itemId) {
        const
            cockpit = this.component,
            nodes   = cockpit.dockModel?.nodes ?? {},
            nodeId  = Object.keys(nodes).find(id => nodes[id]?.items?.includes(itemId)),
            strip   = nodeId && cockpit.down({dockNodeId: nodeId}),
            index   = nodeId ? nodes[nodeId].items.indexOf(itemId) : -1;

        if (strip && index > -1 && strip.activeIndex !== index) {
            strip.activeIndex = index;
            // the card layout mounts the newly active item asynchronously; focus needs the DOM
            await cockpit.timeout(50)
        }
    }

    /**
     * @summary READ-OBSERVE: one pane history intent → the fleet history verb; a typed
     * unavailable envelope on absence/throw, the accepted snapshot owner-held and written to the
     * pane at WRITE time.
     * @param {Object} [params]
     * @returns {Promise<Object>}
     */
    async loadCatchUp(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.catchUpReadGeneration,
            fallback   = reason => ({
                capability         : {state: 'unavailable', reason},
                needsFirstUseWindow: false,
                partition          : params.partition || 'unified',
                viewerState        : {lastSeen: null, lastVisitAt: null},
                window             : null,
                sources            : null
            });

        let snapshot;

        if (typeof bridge?.fleetHistory !== 'function') {
            snapshot = fallback('fleet history verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetHistory(params)
            } catch (error) {
                snapshot = fallback('fleet history read failed')
            }
        }

        if (generation === me.catchUpReadGeneration && !me.isDestroyed) {
            me.catchUpSnapshot = snapshot;

            const pane = me.component.getCatchUpPane();

            pane && (pane.snapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary READ: the computed Golden Path through the fleet bridge. The read fence lets the latest
     * read win. The unavailable envelope is used when the verb is absent or the read throws.
     * @returns {Promise<Object>} The landed envelope.
     */
    async loadGoldenPath() {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.goldenPathReadGeneration,
            fallback   = reason => ({capability: {state: 'unavailable', reason}});

        let envelope;

        try {
            envelope = typeof bridge?.fleetGoldenPath === 'function' ? await bridge.fleetGoldenPath({}) : fallback('fleet golden path verb not wired')
        } catch (error) {
            envelope = fallback('fleet golden path read failed')
        }

        return generation === me.goldenPathReadGeneration && !me.isDestroyed ? me.writeGoldenPath(envelope) : GoldenPathEnvelope.fromWire(envelope)
    }

    /**
     * @summary WRITE: lands one envelope in the provider's `goldenPathEnvelope` leaf, in the closed shape
     * every Golden Path pane binds.
     * @param {Object|null} envelope The wire envelope.
     * @returns {Object} The landed envelope.
     */
    writeGoldenPath(envelope) {
        const landed = GoldenPathEnvelope.fromWire(envelope);

        this.component.getStateProvider()?.setData({goldenPathEnvelope: landed});

        return landed
    }

    /**
     * @summary READ: the bounded graph neighbourhood around the route through the fleet bridge. The
     * read fence lets the latest read win. The unavailable envelope is used when the verb is absent or
     * the read throws; the Golden Path leaf is never touched. A read through another profile's bridge
     * first retires the landed one ({@link AgentOS.util.TargetBinding#retireGraphScene}).
     * @returns {Promise<Object>} The landed envelope.
     */
    async loadGraphScene() {
        const
            me         = this,
            {bridge}   = me,
            profileId  = bridge?.profileId ?? null,
            generation = ++me.graphSceneReadGeneration,
            fallback   = reason => ({capability: {state: 'unavailable', reason}});

        let envelope;

        TargetBinding.retireGraphScene(me, {profileId});

        try {
            envelope = typeof bridge?.fleetGraphScene === 'function' ? await bridge.fleetGraphScene({}) : fallback('fleet graph scene verb not wired')
        } catch (error) {
            envelope = fallback('fleet graph scene read failed')
        }

        if (generation !== me.graphSceneReadGeneration || me.isDestroyed) {
            return GraphSceneEnvelope.fromWire(envelope)
        }

        me.graphSceneHeld      = true;
        me.graphSceneProfileId = profileId;

        return me.writeGraphScene(envelope)
    }

    /**
     * @summary WRITE: lands one envelope in the provider's `graphSceneEnvelope` leaf, in its closed shape.
     * @param {Object|null} envelope The wire envelope.
     * @returns {Object} The landed envelope.
     */
    writeGraphScene(envelope) {
        const landed = GraphSceneEnvelope.fromWire(envelope);

        this.component.getStateProvider()?.setData({graphSceneEnvelope: landed});

        return landed
    }

    /**
     * @summary RUNTIME-WRITE: advance the authenticated viewer's lastSeen through the pane's
     * rendered window end, then write the honest outcome back.
     * @param {Object} params `{windowEnd}`
     * @returns {Promise<Object>}
     */
    async markCatchUp(params) {
        const
            me       = this,
            {bridge} = me;

        let outcome;

        try {
            outcome = typeof bridge?.markFleetCaughtUp === 'function'
                ? await bridge.markFleetCaughtUp(params)
                : {status: 'not-wired', reason: 'fleet catch-up mark verb not wired'}
        } catch (error) {
            outcome = {status: 'error', reason: 'fleet catch-up mark failed'}
        }

        if (!me.isDestroyed) {
            me.catchUpMarkOutcome = outcome;

            const pane = me.component.getCatchUpPane();

            pane && (pane.markOutcome = outcome)
        }

        return outcome
    }
}

export default Neo.setupClass(ReadingSurfacesController);
