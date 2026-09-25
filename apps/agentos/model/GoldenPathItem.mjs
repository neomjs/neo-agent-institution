import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.GoldenPathItem
 * @extends Neo.data.Model
 *
 * @summary One item of the computed Golden Path route, exactly as the producer wrote it. The key is
 * `position`, the item's index in the producer's list, so the producer's order and a repeated id both
 * survive the Store.
 */
class GoldenPathItem extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.GoldenPathItem'
         * @protected
         */
        className: 'AgentOS.model.GoldenPathItem',
        /**
         * @member {String} keyProperty='position'
         */
        keyProperty: 'position',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'position',
            type: 'Integer'
        }, {
            name: 'id',
            type: 'String'
        }, {
            name        : 'rank',
            type        : 'Integer',
            defaultValue: null
        }, {
            name: 'title',
            type: 'String'
        }, {
            name        : 'score',
            type        : 'Float',
            defaultValue: null
        }, {
            name        : 'citations',
            type        : 'Array',
            defaultValue: []
        }]
    }
}

export default Neo.setupClass(GoldenPathItem);
