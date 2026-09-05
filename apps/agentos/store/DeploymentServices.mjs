import DeploymentServiceModel from '../model/DeploymentService.mjs';
import Store                  from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.DeploymentServices
 * @extends Neo.data.Store
 *
 * @summary The System view's projection store: one record per service of the connected instance's
 * deployment-state picture, keyed by compose service id so a re-projected picture reconciles cards in
 * place (object permanence) instead of rebuilding them. Owned by the view and destroyed with it — the
 * rows remain the orchestrator's, read at query time through the fleet wire.
 */
class DeploymentServices extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.DeploymentServices'
         * @protected
         */
        className: 'AgentOS.store.DeploymentServices',
        /**
         * @member {String} keyProperty='serviceKey'
         */
        keyProperty: 'serviceKey',
        /**
         * @member {Neo.data.Model} model=DeploymentServiceModel
         * @reactive
         */
        model: DeploymentServiceModel
    }
}

export default Neo.setupClass(DeploymentServices);
