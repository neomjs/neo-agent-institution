import OpenPullRequestModel from '../model/OpenPullRequest.mjs';
import Store                from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.FleetAwaitingMerge
 * @extends Neo.data.Store
 *
 * @summary The pull requests awaiting the operator's merge: approved on the head, CI green, mergeable
 * and not draft, as the Brain's open-work producer reports them (`awaitingMerge`). Hosted by the
 * Viewport's provider; the cockpit's open-work read replaces the rows on every answer, and the fleet
 * head's awaiting-merge button binds the instance.
 */
class FleetAwaitingMerge extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.FleetAwaitingMerge'
         * @protected
         */
        className: 'AgentOS.store.FleetAwaitingMerge',
        /**
         * @member {Object[]} data=[]
         */
        data: [],
        /**
         * @member {String} keyProperty='id'
         */
        keyProperty: 'id',
        /**
         * @member {Neo.data.Model} model=OpenPullRequestModel
         * @reactive
         */
        model: OpenPullRequestModel
    }
}

export default Neo.setupClass(FleetAwaitingMerge);
