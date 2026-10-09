import ReadingSurfacesController   from './ReadingSurfacesController.mjs';
import CockpitPerspectives         from '../../../util/CockpitPerspectives.mjs';
import FleetLifecycleIntentAdapter from '../../../util/FleetLifecycleIntentAdapter.mjs';
import FleetStartPlan              from '../../../util/FleetStartPlan.mjs';
import OpenWorkRead                from '../../../util/OpenWorkRead.mjs';
import OperatorInbox               from '../../../util/OperatorInbox.mjs';
import SourceHealth                from '../../../util/SourceHealth.mjs';
import TargetBinding               from '../../../util/TargetBinding.mjs';

/**
 * @summary The cockpit's intent + command layer — the surface-fired intent relays, the per-pane
 * snapshot reads and the fleet-start batch. View logic lives on the controller (lifecycle-bound,
 * first-class `this.component` access), never on a util a view object gets passed into. Two layers
 * are inherited:
 * - the south reading surfaces (catch-up and the Golden Path):
 *   {@link AgentOS.view.fleet.cockpit.ReadingSurfacesController};
 * - beneath them, the wire-liveness half (roster, activity and Brain-health loads, cadence,
 *   reconnect, viewer-wake custody): {@link AgentOS.view.fleet.cockpit.LivenessController}.
 *
 * State split (the operator's partial-provider ruling): truths MORE THAN ONE surface reads live
 * on {@link AgentOS.view.fleet.cockpit.StateProvider} and the surfaces bind. Per-pane snapshots
 * (operator inbox, memories + drill, wake routes, tasks) are CONTROLLER state below,
 * written to their one pane directly at WRITE time through the view's phase-blind accessors (a
 * pane torn into a vessel or parked in a returning window still receives the truth; a destroyed
 * one never swallows it).
 *
 * Every read follows the inherited one discipline: fence bump FIRST, verb-presence check, typed
 * unavailable fallback (never a fabricated success), and only the newest generation writes.
 *
 * @class AgentOS.view.fleet.cockpit.Controller
 * @extends AgentOS.view.fleet.cockpit.ReadingSurfacesController
 */
class Controller extends ReadingSurfacesController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.Controller'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.Controller',
        /**
         * @member {String} ntype='fm-fleet-cockpit-controller'
         * @protected
         */
        ntype: 'fm-fleet-cockpit-controller'
    }

    /**
     * The read-fence + owner-held drill state for the memories surfaces.
     * @member {Number} memoriesReadGeneration=0
     * @protected
     */
    memoriesReadGeneration = 0
    /**
     * @member {Number} memoriesDrillReadGeneration=0
     * @protected
     */
    memoriesDrillReadGeneration = 0
    /**
     * The open memories drill — `{sessionId, title}` — owner-held BEFORE any await, so a pane
     * rematerialized mid-read reopens on the PENDING drill.
     * @member {Object|null} memoriesDrillSession=null
     * @protected
     */
    memoriesDrillSession = null
    /**
     * @member {Object|null} memoriesDrillSnapshot=null
     * @protected
     */
    memoriesDrillSnapshot = null
    /**
     * @member {Object|null} memoriesSnapshot=null
     * @protected
     */
    memoriesSnapshot = null
    /**
     * The memories pane's pending target, owner-held BEFORE the await (honest switch-pending on
     * rematerialization, never the last accepted target).
     * @member {String|null} memoriesTarget=null
     * @protected
     */
    memoriesTarget = null
    /**
     * Read-fence + owner-held snapshot for the operator's own mailbox mirror.
     * @member {Number} operatorInboxReadGeneration=0
     * @protected
     */
    operatorInboxReadGeneration = 0
    /**
     * Read-fence for the open message's body: a read that settles after another message opened lands
     * nowhere.
     * @member {Number} operatorMessageReadGeneration=0
     * @protected
     */
    operatorMessageReadGeneration = 0
    /**
     * The message the detail shows, set by each open: a refresh after an action re-reads only this one.
     * @member {String|null} operatorOpenMessageId=null
     * @protected
     */
    operatorOpenMessageId = null
    /**
     * @member {Object|null} operatorSnapshot=null
     * @protected
     */
    operatorSnapshot = null
    /**
     * The profile whose bridge answered the operator identity; the identity and its window belong to
     * it ({@link AgentOS.util.TargetBinding#retireOperatorMailbox}).
     * @member {String|null} operatorProfileId=null
     * @protected
     */
    operatorProfileId = null
    /**
     * The resolved operator identity record (`{agentIdentityNodeId, githubUsername}`) — the
     * bootstrap leg of "the client SAYS self, the admission stamp proves it".
     * @member {Object|null} operatorRecord=null
     * @protected
     */
    operatorRecord = null
    /**
     * The seat-conflation posture derived from the roster for the resolved viewer identity.
     * @member {Object|null} operatorIdentityPosture=null
     * @protected
     */
    operatorIdentityPosture = null
    /**
     * The active fleet-start batch — repeated activations join it until its summary and one
     * roster reconciliation settled.
     * @member {Promise<Object>|null} startFleetPromise=null
     * @protected
     */
    startFleetPromise = null
    /** @member {Object|null} startFleetBatch=null Token fencing late summaries from older batches. */
    startFleetBatch = null
    /**
     * Read-fence + in-flight accounting + owner-held snapshot for the tasks surface.
     * @member {Number} tasksReadGeneration=0
     * @protected
     */
    tasksReadGeneration = 0
    /**
     * @member {Number} tasksReadInFlight=0
     * @protected
     */
    tasksReadInFlight = 0
    /**
     * @member {Object|null} tasksSnapshot=null
     * @protected
     */
    tasksSnapshot = null
    /**
     * Read-fence + in-flight accounting + owner-held snapshot for the open-work read, with the
     * profile that answered it: an instance switch retires the held answer
     * ({@link AgentOS.util.TargetBinding#retireOpenWork}).
     * @member {Number} openWorkReadGeneration=0
     * @protected
     */
    openWorkReadGeneration = 0
    /**
     * @member {Number} openWorkReadInFlight=0
     * @protected
     */
    openWorkReadInFlight = 0
    /**
     * @member {Object|null} openWorkSnapshot=null
     * @protected
     */
    openWorkSnapshot = null
    /**
     * @member {String|null} openWorkProfileId=null
     * @protected
     */
    openWorkProfileId = null
    /**
     * Read-fence + owner-held snapshot for the wake-routes surface.
     * @member {Number} wakeRoutesReadGeneration=0
     * @protected
     */
    wakeRoutesReadGeneration = 0
    /**
     * @member {Object|null} wakeRoutesSnapshot=null
     * @protected
     */
    wakeRoutesSnapshot = null
    /**
     * @summary The cockpit-owned authenticated bridge — resolved fresh per call, never captured.
     * @returns {Object|undefined}
     * @protected
     */
    get bridge() {
        return globalThis.AgentOS?.fleet?.registryBridge
    }

    /**
     * @summary The profile the bridge in hand answers for, `null` when it names none — the origin an
     * operator read or send compares against once it settles ({@link AgentOS.util.TargetBinding}).
     * @returns {String|null}
     * @protected
     */
    get bridgeProfileId() {
        return this.bridge?.profileId ?? null
    }

    /* ── intent relays (the B4÷C2 seam: surfaces fire intents, this composition root owns the wire) ── */

    /**
     * @summary Consume a card's `lifecycleIntent` and drive the honest round-trip: the intent +
     * that card's roster record go to the C2 adapter, which writes pending/settled/rejected state
     * onto the record — never an optimistic success.
     * @param {Object} data `{action, agentId, source}` — Neo stamps `source`.
     */
    onAgentLifecycleIntent(data) {
        const card = Neo.getComponent(data.source);

        return card && this.requestFleetLifecycle(data, card.record).then(result =>
            this.refreshRosterOnSettle(Promise.resolve(FleetLifecycleIntentAdapter.rosterMayRead(result)), result.isCurrent)
        )
    }

    /**
     * @summary Drill into a resident: resolve the record from the provider-owned store, seat it
     * through the view's ONE selection-write site, and reveal the auto-hidden detail pane.
     * @param {Object} data The `agentSelect` payload `{agentId}`.
     */
    onAgentSelect(data) {
        const
            cockpit = this.component,
            record  = this.resolveFleetRosterStore()?.get(data.agentId);

        if (!record) {
            return
        }

        this.applySelection(record);

        if (cockpit.dockModel?.items?.detail?.autoHidden) {
            const result = cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'detail', autoHidden: false});

            result && !result.errors?.length && cockpit.onDockZoneDocumentChange(result.document)
        }
    }

    /**
     * @summary The grid's bootstrap CTA (empty fleet) opens the S5 define-agent zone.
     * @param {Object} data The `addAgentRequest` payload.
     */
    onAddAgentRequest(data) {
        const cockpit = this.component;

        if (cockpit.dockModel?.items?.defineAgent?.autoHidden) {
            const result = cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'defineAgent', autoHidden: false});

            result && !result.errors?.length && cockpit.onDockZoneDocumentChange(result.document)
        }
    }

    /**
     * @summary Relay the operator-mailbox compose intent to the fleet write verb and close the
     * outcome loop: `Observable.fire` discards handler returns, so the settled per-recipient
     * outcome is written back onto the mailbox surface for the form to render — a refusal is
     * never invisible.
     * @param {Object} data The `compose` payload `{message, source}`.
     */
    async onOperatorCompose(data) {
        const
            me        = this,
            profileId = me.bridgeProfileId,
            outcome   = await me.composeOperatorMessage(data.message),
            mailbox   = me.getReference('operator-mailbox');

        // a send that settles after a switch keeps its result, but never lands in another profile's pane
        me.bridgeProfileId === profileId && mailbox && (mailbox.composeOutcome = outcome);

        return outcome
    }

    /**
     * @summary Relay the operator-mailbox paged re-read.
     * @param {Object} data `{offset, source}`
     */
    onOperatorInboxPageRequest(data) {
        return this.loadOperatorInbox({offset: data.offset})
    }

    /**
     * @summary Relay: read the open message in full ({@link AgentOS.util.OperatorInbox#open}).
     * @param {Object} data `{messageId, refresh?, source}`
     * @returns {Promise<void>}
     */
    onOperatorMessageOpen(data) {
        return OperatorInbox.open(this, data)
    }

    /**
     * @summary Relay: mark the open message read ({@link AgentOS.util.OperatorInbox#markRead}).
     * @param {Object} data `{messageId, source}`
     * @returns {Promise<Boolean>}
     */
    onOperatorMarkRead(data) {
        return OperatorInbox.markRead(this, data)
    }

    /**
     * @summary Relay: resolve the open message's Task ({@link AgentOS.util.OperatorInbox#resolve}).
     * @param {Object} data `{expectedCurrentState, messageId, source}`
     * @returns {Promise<Boolean>}
     */
    onOperatorResolve(data) {
        return OperatorInbox.resolve(this, data)
    }

    /**
     * @summary Relay a MemoriesPane read intent.
     * @param {Object} data `{agentIdentity, offset?}`
     * @returns {Promise<Object>}
     */
    onMemoriesRequest(data) {
        const {source, ...params} = data;

        return this.loadMemories(params)
    }

    /**
     * @summary Relay a MemoriesPane drill-in read intent.
     * @param {Object} data `{sessionId, title?, offset?}`
     * @returns {Promise<Object>}
     */
    onSessionDetailRequest(data) {
        const {source, ...params} = data;

        return this.loadSessionMemories(params)
    }

    /**
     * @summary Clear the owner-held drill when the pane closes it — a drill the operator left
     * must not reopen on rematerialization.
     * @param {Object} data
     */
    onSessionDetailClosed(data) {
        this.clearSessionMemoriesDrill()
    }

    /**
     * @summary The spine banner's one action. Beside a running plane there is nothing to reconnect:
     * the shell refused its own organism on purpose, so the action opens the plane card, which lives
     * with the viewport. Every other verdict reconnects the fleet.
     */
    onSpineAction() {
        const me = this;

        if (me.component.getStateProvider()?.getData('spineBanner')?.action === 'connect-plane') {
            me.getParent()?.showPlaneSetup?.()
        } else {
            me.reconnectFleet()
        }
    }

    /**
     * @summary Relay a WakeRoutePane read intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onWakeRoutesRequest(data) {
        const {source, ...params} = data;

        return this.loadWakeRoutes(params)
    }

    /**
     * @summary Relay a PerspectivesPane intent: `apply` switches the cockpit to the named
     * perspective through the same path the preset switcher uses; `capture` wraps the live dock
     * document under the given name. Both re-project the list the drawer binds to.
     * @param {Object} data
     * @param {String} data.action `apply` or `capture`
     * @param {String} data.name The perspective's name
     * @returns {Object} the cockpit's verdict
     */
    onPerspectiveRequest(data) {
        const {action, name} = data;

        return action === 'capture'
            ? this.capturePerspective(name)
            : this.component.activatePerspective(name)
    }

    /**
     * @summary Capture the perspective document under a name — the drawer's capture verb; a pane
     * away in its vessel files in its home. A duty's name is refused by the wrapper; a held name
     * updates that capture in place (the same folded id — the library's collision verdict guards
     * a foreign record's name, an imported artifact's). A saved capture is FILED, not activated:
     * it reaches the drawer through the projected list, verdict included, while the live layout
     * stays what it is — the card's Apply is the switch.
     * @param {String} name The operator's name for the layout.
     * @returns {{saved: Boolean, layoutId: String|null, name: String|null, errors: String[]}}
     */
    capturePerspective(name) {
        let view    = this.component,
            verdict;

        // A capture that throws is still a verdict the drawer must show — a silent failure would
        // read as "nothing happened", the one outcome a capture verb may never produce.
        try {
            let {layout, errors} = CockpitPerspectives.captureSavedLayout(view.getPerspectiveDocument(), name, Object.keys(view.perspectives ?? {}));

            verdict = {saved: false, layoutId: null, name: layout?.perspectiveName ?? null, errors};

            if (!errors.length) {
                // `activate` moves the library's pointer, nothing more: a collection invariant
                // (a library holding records must name one), never the selection — the engine's
                // published name is. Nothing restores here: the live layout already IS this
                // document, and the card's Apply is the switch.
                const outcome = view.perspectiveStore.savePerspective(layout, {activate: true});

                verdict = {
                    saved   : outcome.saved,
                    layoutId: outcome.layoutId,
                    name    : layout.perspectiveName,
                    // the library's collision verdict names the HOLDER (`holderTitle` / `holderLayoutId`)
                    errors  : outcome.collision
                        ? [`"${layout.perspectiveName}" is already held by ${outcome.collision.holderTitle ?? outcome.collision.holderLayoutId}`]
                        : outcome.errors
                }
            }
        } catch (error) {
            console.error('FleetCockpit: capturing the live layout failed', error);
            verdict = {saved: false, layoutId: null, name: (name ?? '').trim() || null, errors: [`capture failed: ${error.message}`]}
        }

        view.publishPerspectives(verdict);
        return verdict
    }

    /**
     * @summary Relay a TasksPane read intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onTasksRequest(data) {
        const {source, ...params} = data;

        return this.loadTasks(params)
    }

    /**
     * @summary The memories pop-out/return toggle — routed to the view's vessel state machine.
     * @param {Object} data
     */
    onMemoriesWindowToggle(data) {
        this.component.onMemoriesWindowToggle(data)
    }

    /**
     * @summary The detail pop-out/reattach toggle — routed to the view's vessel state machine.
     * @param {Object} data
     */
    onDetailWindowToggle(data) {
        this.component.onDetailWindowToggle(data)
    }

    /**
     * @summary The ONE selection-write site: seat a resident record (or null) as the cockpit's
     * selection truth everywhere it lives — the view-owned {@link AgentOS.view.fleet.cockpit.Container#detailRecord}
     * reactive config (its afterSet hook pushes the live pane; dock rematerialization reads it),
     * the provider pair (`selectedAgentId` / `selectedAgentIdentity`), and the memories
     * write-through (the one-picker contract: a selected resident with a verifiable mailbox
     * identity re-targets the pane through the view's phase-blind accessor, so a vesseled pane
     * re-targets exactly like a docked one).
     *
     * A null identity keeps the pane's LAST target: the summary corpus outlives the seat, so a
     * resident without identity authority (or a cleared selection) never blanks a valid read —
     * the provider pair still reports the honest null.
     * @param {Object|null} record The selected {@link AgentOS.model.FleetAgent} record, or null.
     */
    applySelection(record) {
        const
            me       = this,
            cockpit  = me.component,
            identity = record?.githubUsername ? `@${record.githubUsername}` : null;

        cockpit.detailRecord = record ?? null;   // afterSetDetailRecord pushes the live pane

        cockpit.setState({
            selectedAgentId      : record?.agentId ?? null,
            selectedAgentIdentity: identity
        });

        if (identity && identity !== me.memoriesTarget) {
            me.memoriesTarget = identity;
            cockpit.getMemoriesPane()?.set({activeAgent: identity})
        }
    }

    /* ── the fleet-start batch ── */

    /**
     * @summary Join the active one-click fleet-start batch, or create exactly one new batch.
     * @returns {Promise<Object>} The one authoritative batch outcome summary.
     */
    onStartFleet() {
        const me = this;

        if (!me.startFleetPromise) {
            me.startFleetPromise = me.executeStartFleetBatch().finally(() => {
                me.startFleetPromise = null
            })
        }

        return me.startFleetPromise
    }

    /**
     * @summary Start eligible records and re-poll once after their initial answers. Current late
     * answers update the batch summary; a newer batch retires that summary's writer.
     * @returns {Promise<Object>} The outcome summary.
     * @protected
     */
    async executeStartFleetBatch() {
        const
            me      = this,
            records = me.getRosterRecords(),
            plan    = FleetStartPlan.partitionFleetStart(records),
            batch   = me.startFleetBatch = {},
            profile = me.bridgeProfileId;

        me.renderStartSummary(null);

        const results = await Promise.all(plan.eligible.map(record =>
            me.requestFleetLifecycle({action: 'start', agentId: record.agentId}, record)
        ));

        const summary = FleetStartPlan.summarizeFleetStart(plan, results);

        if (!me.isDestroyed && me.startFleetBatch === batch && me.bridgeProfileId === profile) {
            me.renderStartSummary(summary)
        }

        results.forEach((result, index) => {
            result.settlement?.then(answer => {
                if (me.startFleetBatch === batch && answer.isCurrent()) {
                    results[index] = answer;
                    me.renderStartSummary(FleetStartPlan.summarizeFleetStart(plan, results))
                }
            })
        });

        await me.refreshRosterOnSettle(Promise.resolve(true), () => results.some(FleetLifecycleIntentAdapter.rosterMayRead));

        return summary
    }

    /**
     * @summary The full roster truth for fleet-level actions: the grid store's records (a folded
     * idle card is still a member); the rendered-cards fallback covers compositions without the
     * grid store reference.
     * @returns {Object[]}
     */
    getRosterRecords() {
        const store = this.getReference('fleet-grid')?.store;

        return store ? [...(store.items ?? [])] : this.getAgentCards().map(card => card.record).filter(Boolean)
    }

    /**
     * @summary Write the fleet-start outcome into the chrome summary slot — counts as text,
     * per-member reasons on the title; hidden again when cleared.
     * @param {Object|null} summary
     */
    renderStartSummary(summary) {
        const slot = this.getReference('fleet-start-summary');

        if (!slot) return;

        if (!summary) {
            slot.set({hidden: true, text: ''});
            return
        }

        const {detail, text} = FleetStartPlan.renderFleetStartSummary(summary);

        slot.vdom.title = detail;
        slot.set({hidden: false, text})
    }

    /**
     * @summary The rendered resident cards (the collapsed-idle fold and header excluded by ntype).
     * @returns {Neo.component.Base[]}
     */
    getAgentCards() {
        return (this.getReference('fleet-cards')?.items ?? []).filter(card => card.ntype === 'fm-agent-card')
    }

    /* ── provider store resolution (tolerant: an overridden provider chain degrades honestly) ── */

    /* ── the fenced pane-snapshot reads ── */

    /**
     * @summary READ-OBSERVE: one pane memories intent. The requested selection is owner-held
     * BEFORE any await — a pane rematerialized mid-read reopens on the PENDING target, never the
     * last accepted one.
     * @param {Object} [params] `{agentIdentity, offset?, limit?}`
     * @returns {Promise<Object>}
     */
    async loadMemories(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.memoriesReadGeneration;

        if (params.agentIdentity) {
            me.memoriesTarget = params.agentIdentity
        }

        const fallback = reason => ({
            capability: {state: 'unavailable', reason},
            viewer    : null,
            target    : params.agentIdentity || null,
            page      : {offset: params.offset ?? 0, limit: null},
            sessions  : [],
            count     : 0,
            total     : null
        });

        let snapshot;

        if (typeof bridge?.fleetMemories !== 'function') {
            snapshot = fallback('fleet memories verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetMemories(params)
            } catch (error) {
                snapshot = fallback('fleet memories read failed')
            }
        }

        if (generation === me.memoriesReadGeneration && !me.isDestroyed) {
            me.memoriesSnapshot = snapshot;

            const livePane = me.component.getMemoriesPane();

            livePane && (livePane.snapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary The memories drill-in — the summary read's discipline one level down: the open
     * drill is owner-held before the await, and display-only `title` never rides the wire.
     * @param {Object} params `{sessionId, title?, offset?, limit?}`
     * @returns {Promise<Object>}
     */
    async loadSessionMemories(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.memoriesDrillReadGeneration;

        if (params.sessionId) {
            me.memoriesDrillSession = {sessionId: params.sessionId, title: params.title ?? null}
        }

        const
            {title, ...wireParams} = params,
            fallback               = reason => ({
                capability: {state: 'unavailable', reason},
                viewer    : null,
                sessionId : params.sessionId || null,
                page      : {offset: params.offset ?? 0, limit: null},
                turns     : [],
                count     : 0,
                total     : null
            });

        let snapshot;

        if (typeof bridge?.fleetSessionMemories !== 'function') {
            snapshot = fallback('fleet session-memories verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetSessionMemories(wireParams)
            } catch (error) {
                snapshot = fallback('fleet session-memories read failed')
            }
        }

        if (generation === me.memoriesDrillReadGeneration && !me.isDestroyed) {
            me.memoriesDrillSnapshot = snapshot;

            const livePane = me.component.getMemoriesPane();

            livePane && (livePane.drillSnapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary Clear the owner-held drill — TERMINAL for in-flight reads: the fence bump makes a
     * read landing after close unwanted, so it can never repopulate the drill the operator left.
     */
    clearSessionMemoriesDrill() {
        this.memoriesDrillReadGeneration++;
        this.memoriesDrillSession  = null;
        this.memoriesDrillSnapshot = null
    }

    /**
     * @summary READ-OBSERVE: the decomposed per-seat wake-route envelope — the memories sibling,
     * no variance.
     * @param {Object} [params]
     * @returns {Promise<Object>}
     */
    async loadWakeRoutes(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.wakeRoutesReadGeneration,
            fallback   = reason => ({
                capability: {state: 'unavailable', reason},
                viewer    : null,
                count     : 0,
                seats     : []
            });

        let snapshot;

        if (typeof bridge?.fleetWakeRoutes !== 'function') {
            snapshot = fallback('fleet wake-routes verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetWakeRoutes(params)
            } catch (error) {
                snapshot = fallback('fleet wake-routes read failed')
            }
        }

        if (generation === me.wakeRoutesReadGeneration && !me.isDestroyed) {
            me.wakeRoutesSnapshot = snapshot;

            const livePane = me.component.getWakeRoutesPane();

            livePane && (livePane.snapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary READ-OBSERVE: the deployment's task picture — plus the liveness tick's in-flight
     * accounting: incremented before the verb check, released in `finally` on this read's OWN
     * settle, never a newer read's.
     * @param {Object} [params] Reserved; the verb takes no caller input today.
     * @returns {Promise<Object>}
     */
    async loadTasks(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.tasksReadGeneration,
            fallback   = reason => ({
                capability: {state: 'unavailable', reason},
                viewer    : null,
                sources   : {},
                running   : [],
                queued    : [],
                recent    : [],
                counts    : {running: 0, queued: 0, recent: 0}
            });

        let snapshot;

        me.tasksReadInFlight++;

        try {
            if (typeof bridge?.fleetTasks !== 'function') {
                snapshot = fallback('fleet tasks verb not wired')
            } else {
                try {
                    snapshot = await bridge.fleetTasks(params)
                } catch (error) {
                    snapshot = fallback('fleet tasks read failed')
                }
            }
        } finally {
            me.tasksReadInFlight--
        }

        if (generation === me.tasksReadGeneration && !me.isDestroyed) {
            me.admitTasks(snapshot)
        }

        return snapshot
    }

    /**
     * @summary Admit one task answer to the cockpit and its mounted pane. Advancing the read
     * generation prevents a read already in flight from replacing a newer admitted answer; the
     * tests' App-worker landing uses this same owner path.
     * @param {Object|null} snapshot One `fleetTasks` envelope or the unobserved state.
     */
    admitTasks(snapshot) {
        const me = this;

        me.tasksReadGeneration++;
        me.tasksSnapshot = snapshot;

        const livePane = me.component.getTasksPane();

        livePane && (livePane.snapshot = snapshot)
    }

    /**
     * @summary READ-OBSERVE: each seat's open work and the PRs awaiting the operator's merge
     * ({@link AgentOS.util.OpenWorkRead#load}).
     * @param {Object} [params] `{seat}` narrows the answer to one seat.
     * @returns {Promise<Object>} The envelope `{state, observedAt, coverage, reason, seats, awaitingMerge}`.
     */
    loadOpenWork(params = {}) {
        return OpenWorkRead.load(this, params)
    }

    /**
     * @summary Admit one open-work answer ({@link AgentOS.util.OpenWorkRead#admit}).
     * @param {Object|null} snapshot One `fleetOpenWork` envelope or the unobserved state.
     * @param {String|null} [profileId] The profile the answering bridge is bound to.
     */
    admitOpenWork(snapshot, profileId = this.bridge?.profileId ?? null) {
        OpenWorkRead.admit(this, snapshot, profileId)
    }

    /**
     * @summary A roster row as its record, carrying the seat's held open work, so a roster refresh never
     * drops the card's open-work chip or the detail's rows ({@link AgentOS.util.OpenWorkRead#seatOpenWork}).
     * @param {Object} row One roster DTO row.
     * @returns {Object}
     */
    mapRosterRow(row) {
        const mapped = super.mapRosterRow(row);

        return {...mapped, ...OpenWorkRead.seatOpenWork(this, mapped.githubUsername)}
    }

    /**
     * @summary WRITE: route one operator-composed message ({@link AgentOS.util.OperatorInbox#compose}).
     * @param {Object} message `{to, subject, body, priority?, wakeSuppressed?, relatedTickets?, inReplyTo?}`
     * @returns {Promise<Object>} `{results: [{to, outcome}]}` in order.
     */
    composeOperatorMessage(message) {
        return OperatorInbox.compose(this, message)
    }

    /**
     * @summary BOOT: resolve the operator's OWN identity (whoami) and hold it owner-side — the
     * mirror read requires an EXPLICIT subject (a self-default at a trust boundary is
     * spoof-adjacent). Fail-closed: an unwired source / unbound context leaves the record null
     * and the pane honestly unobserved. A bridge throw (no bearer injected) ends HERE the same way:
     * the boot call is fire-and-forget, so a rejection would be an unhandled App Worker error.
     * A bridge bound to another profile first retires what the previous one answered, and an answer
     * lands only while the profile that asked is still the bridge in hand.
     * @returns {Promise<String|null>} `'bound'` when the answer bound another identity than the one held
     * (the pane then reads its own first window, {@link AgentOS.view.fleet.mailbox.OperatorContainer#afterSetRecord}),
     * `'held'` when it confirmed the identity held, `null` when nothing landed: no verb, a throw, a
     * refusal, or an answer whose asking profile is gone
     * @protected
     */
    async loadOperatorIdentity() {
        const
            me        = this,
            {bridge}  = me,
            profileId = me.bridgeProfileId;

        TargetBinding.retireOperatorMailbox(me, {profileId});

        if (typeof bridge?.resolveViewerIdentity !== 'function') {
            return null
        }

        let outcome;

        try {
            outcome = await bridge.resolveViewerIdentity()
        } catch (error) {
            return null
        }

        if (outcome?.ok && outcome.agentIdentityNodeId && !me.isDestroyed && me.bridgeProfileId === profileId) {
            const
                nodeId = outcome.agentIdentityNodeId,
                held   = me.operatorRecord;

            // the reused MailboxPane proves possession from `record.githubUsername` (canonicalized
            // against the mirror admission's subject); the node id IS that @-form authority — carry
            // both: the username for the possession match, the node id as the explicit read subject
            me.operatorRecord    = {agentIdentityNodeId: nodeId, githubUsername: nodeId.replace(/^@/, '')};
            me.operatorProfileId = profileId;

            me.operatorIdentityPosture = me.deriveOperatorIdentityPosture(nodeId);

            // both orderings (identity-first or pane-first) land exactly one first read
            me.component.getOperatorMailboxPane()?.set({record: me.operatorRecord, identityPosture: me.operatorIdentityPosture});

            return Neo.isEqual(held, me.operatorRecord) ? 'held' : 'bound'
        }

        return null
    }

    /**
     * @summary The seat-conflation honesty check: a viewer claim matching a registered agent
     * identity means sends attribute to that seat — a truth the pane renders, never swallows. An
     * empty roster answers `null` (cannot judge), not a clean bill.
     * @param {String} viewerIdentity The resolved `@`-form viewer identity.
     * @returns {{conflated: Boolean, seatIdentity: String}|null}
     */
    deriveOperatorIdentityPosture(viewerIdentity) {
        const rows = this.resolveFleetRosterStore()?.items ?? [];

        if (typeof viewerIdentity !== 'string' || !viewerIdentity.trim() || rows.length < 1) {
            return null
        }

        const
            bare      = id => String(id).trim().replace(/^@/, ''),
            viewer    = bare(viewerIdentity),
            conflated = rows.some(row => bare(row.agentId ?? '') === viewer);

        return {conflated, seatIdentity: `@${viewer}`}
    }

    /**
     * @summary READ-OBSERVE: one window of the list the operator's own mailbox shows, all mail or its open
     * questions ({@link AgentOS.util.OperatorInbox#read}).
     * @param {Object} [params]
     * @param {Number} [params.offset=0]
     * @returns {Promise<void>}
     * @protected
     */
    loadOperatorInbox(params = {}) {
        return OperatorInbox.read(this, params)
    }

    /* ── the liveness reads (provider-written surfaces; the banner + chrome bind) ── */

    /* ── the shared loss edges + helpers ── */

    /* ── roster mapping + reconciliation ── */

    /* ── the liveness owner + reconnect + viewer-wake stream ── */

    /**
     * @summary The inherited re-drive, plus the operator's own mailbox, whose reads live on this layer.
     * A switch retires the previous profile's identity and window inside {@link #loadOperatorIdentity};
     * an identity that binds anew reads its own first window, a held one reads it here, and an answer
     * that landed nothing (a stale profile included) reads nothing.
     */
    reconnectFleet() {
        const me = this;

        super.reconnectFleet();

        me.loadOperatorIdentity().then(identity => {
            identity === 'held' && me.loadOperatorInbox({offset: 0})
        })
    }
}

export default Neo.setupClass(Controller);
