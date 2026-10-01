import SeatRepositoryModel from '../model/SeatRepository.mjs';
import Store               from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.SeatRepositories
 * @extends Neo.data.Store
 *
 * @summary The repositories of the one seat the Accounts Repositories card shows, the working
 * repository first. The card owns its instance and replaces the rows from the selected definition
 * on every refresh.
 */
class SeatRepositories extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.SeatRepositories'
         * @protected
         */
        className: 'AgentOS.store.SeatRepositories',
        /**
         * @member {Object[]} data=[]
         */
        data: [],
        /**
         * @member {String} keyProperty='repoSlug'
         */
        keyProperty: 'repoSlug',
        /**
         * @member {Neo.data.Model} model=SeatRepositoryModel
         * @reactive
         */
        model: SeatRepositoryModel
    }
}

export default Neo.setupClass(SeatRepositories);
