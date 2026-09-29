import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.GraphSceneRelation
 * @extends Neo.data.Model
 *
 * @summary One of the feed's relations touching the Observatory's selected node, seen from that node: the
 * relation type exactly as the feed carried it (`null` where the graph named none), its direction, and the
 * node at the other end. A header record opens each group of one type and direction and counts it. The key is
 * `position`, the row's index in the selected node's list, because two relations can join the same pair under
 * different types.
 */
class GraphSceneRelation extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.GraphSceneRelation'
         * @protected
         */
        className: 'AgentOS.model.GraphSceneRelation',
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
            name        : 'type',
            type        : 'String',
            defaultValue: null
        }, {
            // 'out' when the selected node is the relation's `from`, 'in' when it is its `to`
            name: 'direction',
            type: 'String'
        }, {
            name: 'otherId',
            type: 'String'
        }, {
            name        : 'otherLabel',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'otherKind',
            type        : 'String',
            defaultValue: null
        }, {
            // a group's header carries its `type` and `direction`, and how many relations the group holds in the read
            name        : 'isHeader',
            type        : 'Boolean',
            defaultValue: false
        }, {
            name        : 'count',
            type        : 'Integer',
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(GraphSceneRelation);
