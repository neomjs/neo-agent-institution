import GraphSceneNode from '../model/GraphSceneNode.mjs';
import Store          from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.GraphSceneNodes
 * @extends Neo.data.Store
 *
 * @summary Pane-local projection store for the nodes of the Observatory's scene. It has no sorters, so
 * records keep the layout's order: the seeds in route order, then every other node by id. Each
 * Observatory owns its store and destroys it with the pane; no record outlives the read it came from.
 */
class GraphSceneNodes extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.GraphSceneNodes'
         * @protected
         */
        className: 'AgentOS.store.GraphSceneNodes',
        /**
         * @member {Neo.data.Model} model=GraphSceneNode
         * @reactive
         */
        model: GraphSceneNode
    }
}

export default Neo.setupClass(GraphSceneNodes);
