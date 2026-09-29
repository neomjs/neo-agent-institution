import GraphScenePeer from '../model/GraphScenePeer.mjs';
import Store          from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.GraphScenePeers
 * @extends Neo.data.Store
 *
 * @summary Pane-local projection store for the peers of the Observatory's team lens, by identity. It has no
 * sorters, so records keep the order the read lists them in. Each Observatory owns its store and destroys it with
 * the pane; a new read replaces the peers, and the pane checks again the ones it still lists.
 */
class GraphScenePeers extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.GraphScenePeers'
         * @protected
         */
        className: 'AgentOS.store.GraphScenePeers',
        /**
         * @member {Neo.data.Model} model=GraphScenePeer
         * @reactive
         */
        model: GraphScenePeer
    }
}

export default Neo.setupClass(GraphScenePeers);
