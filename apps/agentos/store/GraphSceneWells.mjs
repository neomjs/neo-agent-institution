import GraphSceneWell from '../model/GraphSceneWell.mjs';
import Store          from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.GraphSceneWells
 * @extends Neo.data.Store
 *
 * @summary Pane-local projection store for the wells of the Observatory's scene. It has no sorters, so records keep
 * the layout's order, the largest well first. Each Observatory owns its store and destroys it with the pane.
 */
class GraphSceneWells extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.GraphSceneWells'
         * @protected
         */
        className: 'AgentOS.store.GraphSceneWells',
        /**
         * @member {Neo.data.Model} model=GraphSceneWell
         * @reactive
         */
        model: GraphSceneWell
    }
}

export default Neo.setupClass(GraphSceneWells);
