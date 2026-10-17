import HeldPullRequestModel from '../model/HeldPullRequest.mjs';
import Store                from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.HeldPullRequests
 * @extends Neo.data.Store
 *
 * @summary The pull requests whose next action the one shown seat holds, worst first. The Agent
 * Detail's Pull requests list owns its instance and replaces the rows from the record's
 * `openWorkHeld` on every render; the order is the resolver's, so the Store sorts nothing.
 */
class HeldPullRequests extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.HeldPullRequests'
         * @protected
         */
        className: 'AgentOS.store.HeldPullRequests',
        /**
         * @member {Object[]} data=[]
         */
        data: [],
        /**
         * @member {String} keyProperty='id'
         */
        keyProperty: 'id',
        /**
         * @member {Neo.data.Model} model=HeldPullRequestModel
         * @reactive
         */
        model: HeldPullRequestModel
    }
}

export default Neo.setupClass(HeldPullRequests);
