import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.SeatMove
 * @extends Neo.data.Model
 *
 * @summary One seat row in the shell-owned move plan. It contains only the observed source,
 * destination and plan state; it records no move state of its own. Paths and reasons use the
 * literal-preserving Html field type; the view renders them through VDOM text, never HTML.
 */
class SeatMove extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.SeatMove'
         * @protected
         */
        className: 'AgentOS.model.SeatMove',
        /**
         * @member {String} keyProperty='id'
         * @reactive
         */
        keyProperty: 'id',
        /** @member {Object[]} fields */
        fields: [{name: 'id', type: 'String'}, {
            name: 'seatHome',
            type: 'Html',
            defaultValue: null
        }, {
            name: 'destination',
            type: 'Html',
            defaultValue: null
        }, {
            name: 'state',
            type: 'String',
            defaultValue: null
        }, {
            name: 'materialized',
            type: 'Boolean',
            defaultValue: false
        }, {
            name: 'code',
            type: 'String',
            defaultValue: null
        }, {
            name: 'reason',
            type: 'Html',
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(SeatMove);
