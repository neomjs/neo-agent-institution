import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import TargetBinding from './TargetBinding.mjs';

/**
 * @module apps/agentos/util/FleetAdmission
 * @summary The admission of an ANSWERED fleet surface — the one path a wired answer and a test's
 * landing share, lifted beside the liveness owner (which holds the size bar) like the retirement in
 * {@link AgentOS.util.TargetBinding}. The owner's reads call it after their generation fence and
 * validation; the tests' landing (`test/playwright/fixture/FleetLanding.mjs`) calls it directly with
 * the rows or events it lands, as the answer of the bridge in hand. Whatever this path gains, both
 * callers get: the landed state is by construction the state a wired answer produces.
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
     * reads `live` with the producer's counts.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} answer
     * @param {Object[]} answer.events The producer's bounded page
     * @param {Object[]} [answer.counts=[]] The producer's fold counts
     * @param {String|null} [answer.profileId=null] The profile the answer belongs to
     */
    static admitActivity(owner, {counts = [], events, profileId = null}) {
        const store = owner.resolveFleetActivityEventsStore(), stream = owner.getReference('activity-stream');

        store.ingestSnapshot(Array.isArray(events) ? events : [], {replace: !owner.activityWired});
        owner.activityWired     = true;
        owner.activityProfileId = profileId;
        owner.publishConnection('stream', {data: {
            activityCounts      : Array.isArray(counts) ? counts : [],
            streamAdapterState  : 'live',
            streamDegradedReason: null
        }});
        stream && (stream.adapterState = 'live')
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
            // the first live snapshot replaces the sample seed wholesale — re-seat or clear a
            // selection made against a now-removed sample record
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
