import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/TargetBinding
 * @summary The rule the cockpit's retained truth obeys: rows a store holds belong to the profile
 * whose answer produced them. `DeploymentStateRead` stamps its picture with the answering
 * `profileId`; this helper brings the roster and the activity feed under the same rule, lifted
 * beside the liveness owner (which holds the size bar). A read through a bridge bound to ANOTHER
 * profile first retires the previous profile's truth — the roster returns to its honestly-labelled
 * seed, the feed empties, the surface reads `sample`, the roster-derived consumers re-snapshot —
 * so the new profile's first live answer is a first admission, and its failure shows its own cold
 * truth instead of another instance's residents labelled `stale`. The generation fences only drop
 * a LATE answer from the previous bridge; nothing else touched rows already admitted. A
 * same-profile failure keeps its last-known rows as `stale`, unchanged.
 */
class TargetBinding extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.TargetBinding'
         * @protected
         */
        className: 'AgentOS.util.TargetBinding'
    }

    /**
     * @summary Retire the roster when the bridge in hand belongs to another profile than the rows
     * the store holds. The seed comes back through the store's own `load()` (its `url` pipeline);
     * `onRosterStoreLoad` lets it land because nothing is wired any more, and the selection
     * reconciles against the emptied store so the inspector never keeps another instance's resident.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} options
     * @param {Neo.data.Store} options.store The provider-owned roster store.
     * @param {Neo.component.Base|null} options.grid The held grid, if materialized.
     * @param {String|null} options.profileId The profile the bridge in hand is bound to.
     * @returns {Boolean} whether a retirement happened
     */
    static retireRoster(owner, {store, grid, profileId}) {
        if (!owner.rosterWired || owner.rosterProfileId === profileId) {
            return false
        }

        owner.lastLiveRows    = null;
        owner.rosterWired     = false;
        owner.rosterProfileId = null;

        store.clear();
        store.load();

        owner.publishConnection('grid', {data: {gridAdapterState: 'sample', gridDegradedReason: null, presenceCapability: null}});
        grid && (grid.adapterState = 'sample');

        owner.reconcileSelection();
        TargetBinding.refreshRosterConsumers(owner);

        return true
    }

    /**
     * @summary Retire the activity feed when the bridge in hand belongs to another profile than
     * the events the store holds. The feed has no seed: the store empties and the header reads
     * `sample · live feed pending` until the new profile answers; the previous profile's counts go
     * with its rows.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} options
     * @param {Neo.data.Store} options.store The provider-owned activity store.
     * @param {Neo.component.Base|null} options.stream The held stream, if materialized.
     * @param {String|null} options.profileId The profile the bridge in hand is bound to.
     * @returns {Boolean} whether a retirement happened
     */
    static retireActivity(owner, {store, stream, profileId}) {
        if (!owner.activityWired || owner.activityProfileId === profileId) {
            return false
        }

        owner.activityWired     = false;
        owner.activityProfileId = null;

        store.clear();

        owner.publishConnection('stream', {data: {activityCounts: [], streamAdapterState: 'sample', streamDegradedReason: null}});
        stream && (stream.adapterState = 'sample');

        return true
    }

    /**
     * @summary Re-snapshot the roster-derived consumers from the store as it stands: resident panes
     * take their options at projection time, which can precede the first live answer, and a
     * retirement changes what the roster says. Pane-first, so a non-materialized pane costs no
     * option rebuild.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     */
    static refreshRosterConsumers(owner) {
        const
            cockpit     = owner.component,
            catchUpPane = cockpit.getCatchUpPane(),
            stream      = owner.getReference('activity-stream'),
            mailboxPane = cockpit.getOperatorMailboxPane();

        catchUpPane && catchUpPane.set({partitionOptions: owner.buildCatchUpPartitionOptions()});
        stream      && stream.set({actorDirectory: owner.buildActivityActorDirectory()});
        mailboxPane && mailboxPane.set({recipientOptions: owner.buildOperatorRecipientOptions()})
    }
}

export default Neo.setupClass(TargetBinding);
