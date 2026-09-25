import GoldenPathEnvelope from '../../../util/GoldenPathEnvelope.mjs';
import LivenessController from './LivenessController.mjs';

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
     * @summary Relay a GoldenPathPane read intent.
     * @returns {Promise<Object>}
     */
    onGoldenPathRequest() {
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
            me      = this,
            cockpit = me.component,
            stream  = target === 'activity-stream' ? me.getReference('activity-stream') : null;

        if (!stream) {
            return {opened: false, target: target || 'unknown'}
        }

        const strip = cockpit.down({dockNodeId: 'stream-tabs'}),
              index = cockpit.dockModel?.nodes?.['stream-tabs']?.items?.indexOf('stream') ?? -1;

        if (strip && index > -1 && strip.activeIndex !== index) {
            strip.activeIndex = index;
            // the card layout mounts the newly active item asynchronously; focus needs the DOM
            await cockpit.timeout(50)
        }

        stream.focus(stream.id, false, true);

        return {opened: true, target}
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
