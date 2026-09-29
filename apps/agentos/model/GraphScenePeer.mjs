import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.GraphScenePeer
 * @extends Neo.data.Model
 *
 * @summary One peer of the Observatory's team lens: an identity the graph read attributes nodes to, as
 * {@link AgentOS.util.ObservatorySceneLayout#peersOf} finds it, with how many of the read's nodes carry it and
 * the hue it is drawn in ({@link module:apps/agentos/canvas/fmPalette.peerHues}, keyed on the identity, never the
 * model). Whether the lens shows a peer is its list row's selection, not a field. The key is the canonical
 * identity, `@login`.
 */
class GraphScenePeer extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.GraphScenePeer'
         * @protected
         */
        className: 'AgentOS.model.GraphScenePeer',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'id',
            type: 'String'
        }, {
            name        : 'nodes',
            type        : 'Integer',
            defaultValue: 0
        }, {
            name        : 'hue',
            type        : 'Number',
            defaultValue: 0
        }]
    }
}

export default Neo.setupClass(GraphScenePeer);
