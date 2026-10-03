import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.OpenPullRequest
 * @extends Neo.data.Model
 *
 * @summary One open pull request as the Brain's open-work producer observed it: the facts its holder
 * acts on, keyed `<repo>#<number>`. A row is projected from a `fleetOpenWork` answer and replaced
 * whole on the next one, never edited in place.
 */
class OpenPullRequest extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.OpenPullRequest'
         * @protected
         */
        className: 'AgentOS.model.OpenPullRequest',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            // `<repo>#<number>`: the repository slug, then the pull request number
            name: 'id',
            type: 'String'
        }, {
            name: 'repo',
            type: 'String'
        }, {
            name: 'number',
            type: 'Integer'
        }, {
            // the head's CI conclusion, e.g. `green`, `red`, `pending`; null = not observed
            name        : 'ci',
            defaultValue: null
        }, {
            // GitHub's mergeability, e.g. `MERGEABLE`; null = not observed
            name        : 'mergeable',
            defaultValue: null
        }, {
            name        : 'draft',
            type        : 'Boolean',
            defaultValue: false
        }, {
            // when the producer last observed this PR (ISO string)
            name        : 'observedAt',
            defaultValue: null
        }, {
            // the producer's own freshness verdict for this row
            name        : 'stale',
            type        : 'Boolean',
            defaultValue: false
        }]
    }
}

export default Neo.setupClass(OpenPullRequest);
