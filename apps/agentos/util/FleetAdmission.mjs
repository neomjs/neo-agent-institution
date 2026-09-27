import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import TargetBinding from './TargetBinding.mjs';
import {FLEET_COCKPIT_EVENT_TYPES, FLEET_COCKPIT_SOURCES} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * @module apps/agentos/util/FleetAdmission
 * @summary The admission of an ANSWERED fleet surface — the one path a complete or partial answer and a test's
 * landing share, lifted beside the liveness owner (which holds the size bar) like the retirement in
 * {@link AgentOS.util.TargetBinding}. The owner's reads call it after their generation fence and
 * validation; the tests' landing (`test/playwright/fixture/FleetLanding.mjs`) calls it directly with
 * the rows or events it lands, as the answer of the bridge in hand. Both callers share the Store
 * admission and publish the same completeness state.
 */
class FleetAdmission extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.FleetAdmission'
         * @protected
         */
        className: 'AgentOS.util.FleetAdmission'
    }

    /**
     * @summary Admits an answered activity feed: the events join the provider-owned store (the first
     * answer replaces, later ones merge), the feed is bound to the answering profile, and the surface
     * reads `live`, or `partial` with the failed source's reason. Counts retain their producer scope.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} answer
     * @param {Object[]} answer.events The producer's bounded page
     * @param {Object[]} [answer.counts=[]] The producer's fold counts
     * @param {String|null} [answer.profileId=null] The profile the answer belongs to
     * @param {Boolean} [answer.partial=false] A usable page from an incomplete composed read
     * @param {String|null} [answer.reason=null] Sanitized reason retained for a partial read
     */
    static admitActivity(owner, {counts = [], events, profileId = null, partial = false, reason = null}) {
        const store = owner.resolveFleetActivityEventsStore(), stream = owner.getReference('activity-stream'),
              state = partial ? 'partial' : 'live';

        store.ingestSnapshot(Array.isArray(events) ? events : [], {replace: !owner.activityWired});
        owner.activityWired     = true;
        owner.activityProfileId = profileId;
        owner.publishConnection('stream', {data: {
            activityCounts      : Array.isArray(counts) ? counts : [],
            streamAdapterState  : state,
            streamDegradedReason: partial ? reason : null
        }});
        stream && (stream.adapterState = state)
    }

    /**
     * @summary Selects usable producer facts from a partial page. Failure diagnostics are not work;
     * an unrecognized or malformed remaining row refuses the page instead of manufacturing activity.
     * Store admission still validates identity uniqueness before changing retained records.
     * @param {*} events The composed producer page
     * @returns {Object[]} Valid activity rows, or an empty array when none can be admitted
     */
    static partialActivityEvents(events) {
        if (!Array.isArray(events)) return [];
        const rows = events.filter(event => event?.type !== 'source-degraded');
        return rows.every(event =>
            typeof event?.eventId === 'string' && event.eventId.trim() &&
            FLEET_COCKPIT_EVENT_TYPES.includes(event.type) &&
            Object.values(FLEET_COCKPIT_SOURCES).includes(event.source) &&
            ['observed', 'inferred'].includes(event.confidence) &&
            typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt))
        ) ? rows : []
    }

    /**
     * @summary Admits an answered roster over record-shaped rows (the DTO already mapped): the first
     * answer replaces the store's rows and re-seats the selection, later ones reconcile; the roster is
     * bound to the answering profile; the surface reads `live` with the presence envelope; the
     * roster-derived consumers re-snapshot; and the construction-time misses recover — the operator's
     * identity posture, a resident CatchUp's first read and the Golden Path read.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} answer
     * @param {Object[]} answer.rows Record-shaped rows
     * @param {Object|null} [answer.capabilities=null] The assembler's capabilities envelope
     * @param {String|null} [answer.profileId=null] The profile the answer belongs to
     */
    static admitRoster(owner, {capabilities = null, profileId = null, rows}) {
        const
            store    = owner.resolveFleetRosterStore(),
            grid     = owner.getReference('fleet-grid'),
            cockpit  = owner.component,
            provider = cockpit.getStateProvider();

        owner.lastLiveRows    = rows;
        owner.rosterProfileId = profileId;

        if (owner.rosterWired) {
            owner.reconcileRoster(store, rows)
        } else {
            store.clear();
            rows.length > 0 && store.add(rows);
            owner.rosterWired = true;
            // the first live snapshot replaces what the store holds wholesale — re-seat or clear a
            // selection made against a now-removed record
            owner.reconcileSelection()
        }

        owner.publishConnection('grid', {data: {
            gridAdapterState  : 'live',
            gridDegradedReason: null,
            // the presence-capability envelope rides every admitted snapshot; absent or
            // malformed envelopes plumb null — the chip claims nothing
            presenceCapability: capabilities?.presence ?? null
        }});
        grid && (grid.adapterState = 'live');

        TargetBinding.refreshRosterConsumers(owner);

        if (owner.operatorRecord) {
            owner.operatorIdentityPosture = owner.deriveOperatorIdentityPosture(owner.operatorRecord.agentIdentityNodeId);
            cockpit.getOperatorMailboxPane()?.set({identityPosture: owner.operatorIdentityPosture})
        }

        // a resident CatchUp can emit its construction-time request BEFORE the bridge wires;
        // that one-shot miss recovers the moment the bridge answers, through the pane's own
        // guarded refresh path
        owner.catchUpSnapshot?.capability?.state === 'unavailable' && cockpit.getCatchUpPane()?.onRefreshClick();
        // the Golden Path read has the same construction-time miss; its leaf is the owner's own truth
        provider?.getData('goldenPathEnvelope.capability.state') === 'unavailable' && owner.loadGoldenPath()
    }
}

export default Neo.setupClass(FleetAdmission);
