import RecentTurnModel from '../model/RecentTurn.mjs';
import Store           from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.AgentRecentTurns
 * @extends Neo.data.Store
 *
 * @summary The newest turns of the one seat the Agent Detail shows, newest first as the Fleet serves
 * them. The detail's Thought stream list owns its instance and replaces the rows from the cockpit's
 * recent-turns answer on every render; the order is the plane's, so the Store sorts nothing.
 */
class AgentRecentTurns extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.AgentRecentTurns'
         * @protected
         */
        className: 'AgentOS.store.AgentRecentTurns',
        /**
         * @member {Object[]} data=[]
         */
        data: [],
        /**
         * @member {String} keyProperty='id'
         */
        keyProperty: 'id',
        /**
         * @member {Neo.data.Model} model=RecentTurnModel
         * @reactive
         */
        model: RecentTurnModel
    }
}

export default Neo.setupClass(AgentRecentTurns);
