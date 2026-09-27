import GraphSceneRelation from '../model/GraphSceneRelation.mjs';
import Store              from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.GraphSceneRelations
 * @extends Neo.data.Store
 *
 * @summary Pane-local projection store for the relations of the Observatory's selected node, in the
 * scene's edge order. It holds nothing while no node is selected; each Observatory owns its store and
 * destroys it with the pane.
 */
class GraphSceneRelations extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.GraphSceneRelations'
         * @protected
         */
        className: 'AgentOS.store.GraphSceneRelations',
        /**
         * @member {String} keyProperty='position'
         */
        keyProperty: 'position',
        /**
         * @member {Neo.data.Model} model=GraphSceneRelation
         * @reactive
         */
        model: GraphSceneRelation
    }
}

export default Neo.setupClass(GraphSceneRelations);
