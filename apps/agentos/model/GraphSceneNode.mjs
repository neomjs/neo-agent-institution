import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.GraphSceneNode
 * @extends Neo.data.Model
 *
 * @summary One node of the Observatory's bounded graph read, as the scene layout derived it
 * ({@link AgentOS.util.ObservatorySceneLayout#fromGraphScene}): the feed's own fields, plus the route
 * rank a seed carries, the hop to the nearest seed and the count of the feed's relations touching it,
 * and under the team lens what the node is to its checked peer, with that peer's hue
 * ({@link AgentOS.util.ObservatorySceneLayout#roleOf}). The key is the origin-qualified id, the one form every
 * selection speaks.
 */
class GraphSceneNode extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.GraphSceneNode'
         * @protected
         */
        className: 'AgentOS.model.GraphSceneNode',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'id',
            type: 'String'
        }, {
            name        : 'label',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'kind',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'rank',
            type        : 'Integer',
            defaultValue: null
        }, {
            name        : 'hop',
            type        : 'Integer',
            defaultValue: null
        }, {
            name        : 'relations',
            type        : 'Integer',
            defaultValue: 0
        }, {
            name        : 'role',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'roleHue',
            type        : 'Number',
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(GraphSceneNode);
