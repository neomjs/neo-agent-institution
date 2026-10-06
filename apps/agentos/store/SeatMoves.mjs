import SeatMoveModel from '../model/SeatMove.mjs';
import Store from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.SeatMoves
 * @extends Neo.data.Store
 *
 * @summary The local System panel's projection of one reviewed seat-root plan. The shell owns
 * the plan and transition record; this Store owns only the visible rows while the panel lives.
 */
class SeatMoves extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.SeatMoves'
         * @protected
         */
        className: 'AgentOS.store.SeatMoves',
        /** @member {String} keyProperty='id' */
        keyProperty: 'id',
        /**
         * @member {Neo.data.Model} model=SeatMoveModel
         * @reactive
         */
        model: SeatMoveModel,
        /** @member {Object[]} data=[] */
        data: []
    }
}

export default Neo.setupClass(SeatMoves);
