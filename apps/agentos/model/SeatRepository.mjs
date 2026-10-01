import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.SeatRepository
 * @extends Neo.data.Model
 *
 * @summary One repository a seat gets a clone of, as its definition declares it: the working
 * repository (`working: true`, set at add time through `setRepo`) or one of the others the
 * Accounts Repositories card sets through `setRepos`. A row is projected from an
 * {@link AgentOS.model.AgentDefinition}'s `metadata`, never edited in place: the registry's
 * readback is the only truth. Each of the others also carries the last start's outcome, from the
 * seat's {@link AgentOS.model.FleetAgent} roster record.
 */
class SeatRepository extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.SeatRepository'
         * @protected
         */
        className: 'AgentOS.model.SeatRepository',
        /**
         * @member {String} keyProperty='repoSlug'
         * @reactive
         */
        keyProperty: 'repoSlug',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'repoSlug',
            type: 'String'
        }, {
            name: 'cloneUrl',
            type: 'String'
        }, {
            name        : 'working',
            type        : 'Boolean',
            defaultValue: false
        }, {
            // the last start's outcome, 'prepared' or 'failed'; null = no start has covered this
            // repository yet. The working repository has the roster's repo status instead
            name        : 'state',
            defaultValue: null
        }, {
            // a failed start's reason, credential-redacted by the Fleet
            name        : 'reason',
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(SeatRepository);
