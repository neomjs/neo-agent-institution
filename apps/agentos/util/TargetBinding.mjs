import Base               from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import GraphSceneEnvelope from './GraphSceneEnvelope.mjs';

/**
 * @module apps/agentos/util/TargetBinding
 * @summary The rule the cockpit's retained truth obeys: rows a store holds belong to the profile
 * whose answer produced them. `DeploymentStateRead` stamps its picture with the answering
 * `profileId`; this helper brings the roster, the activity feed, the graph scene and the operator's
 * own mailbox under the same rule, lifted beside the liveness owner (which holds the size bar). A read through a bridge bound to
 * ANOTHER profile first retires the previous profile's truth — both stores empty, both surfaces read
 * `cold`, the graph leaf returns to unobserved, the roster-derived consumers re-snapshot —
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
     * the store holds. The store empties and the surface reads `cold` until the new profile
     * answers; the selection reconciles against the emptied store so the inspector never keeps
     * another instance's resident.
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

        owner.publishConnection('grid', {data: {gridAdapterState: 'cold', gridDegradedReason: null, presenceCapability: null}});
        grid && (grid.adapterState = 'cold');

        owner.reconcileSelection();
        TargetBinding.refreshRosterConsumers(owner);

        return true
    }

    /**
     * @summary Retire the activity feed when the bridge in hand belongs to another profile than
     * the events the store holds. The store empties and the header reads `not answered yet` until
     * the new profile answers; the previous profile's counts go with its rows.
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

        // the old profile's exhausted mailbox is not the new one's
        owner.publishConnection('stream', {data: {activityCounts: [], streamAdapterState: 'cold', streamDegradedReason: null, streamHistoryExhausted: false}});
        stream && (stream.adapterState = 'cold');

        return true
    }

    /**
     * @summary Retire the held open work when the bridge in hand belongs to another profile than the
     * one that answered it. The owner returns to unobserved until the new profile answers, so one
     * instance's open PRs and merge queue never stand under another's name. The read that calls this
     * has already taken its generation, which fences any earlier profile's read still in flight.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @param {Object} options
     * @param {String|null} options.profileId The profile the bridge in hand is bound to.
     * @returns {Boolean} whether a retirement happened
     */
    static retireOpenWork(owner, {profileId}) {
        if (!owner.openWorkSnapshot || owner.openWorkProfileId === profileId) {
            return false
        }

        owner.openWorkSnapshot  = null;
        owner.openWorkProfileId = null;

        return true
    }

    /**
     * @summary Retire the graph scene when the bridge in hand belongs to another profile than the read
     * the leaf holds. The leaf returns to its unobserved declaration until the new profile answers, so
     * the Observatory never draws one instance's neighbourhood under another's name; its selection
     * clears with it.
     * @param {AgentOS.view.fleet.cockpit.ReadingSurfacesController} owner The reading-surfaces owner.
     * @param {Object} options
     * @param {String|null} options.profileId The profile the bridge in hand is bound to.
     * @returns {Boolean} whether a retirement happened
     */
    static retireGraphScene(owner, {profileId}) {
        if (!owner.graphSceneHeld || owner.graphSceneProfileId === profileId) {
            return false
        }

        owner.graphSceneHeld      = false;
        owner.graphSceneProfileId = null;

        owner.component.getStateProvider()?.setData({graphSceneEnvelope: GraphSceneEnvelope.blank()});

        return true
    }

    /**
     * @summary Retire the operator's own mailbox when the bridge in hand belongs to another profile than
     * the identity and window the owner holds. They leave together: the window was read as that
     * identity, and one operator handle can name two instances, so the pane's subject check cannot
     * tell them apart. The pane reads `unobserved` until the new profile's identity binds and reads
     * its own first window; the last send's outcome goes with them.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @param {Object} options
     * @param {String|null} options.profileId The profile the bridge in hand is bound to.
     * @returns {Boolean} whether a retirement happened
     */
    static retireOperatorMailbox(owner, {profileId}) {
        if ((!owner.operatorRecord && !owner.operatorSnapshot) || owner.operatorProfileId === profileId) {
            return false
        }

        owner.operatorIdentityPosture = null;
        owner.operatorProfileId       = null;
        owner.operatorRecord          = null;
        owner.operatorSnapshot        = null;
        owner.operatorInboxReadGeneration++;

        owner.component.getOperatorMailboxPane()?.set({composeOutcome: null, identityPosture: null, record: null, snapshot: null});

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
