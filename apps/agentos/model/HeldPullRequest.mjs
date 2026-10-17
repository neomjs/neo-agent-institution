import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.HeldPullRequest
 * @extends Neo.data.Model
 *
 * @summary One pull request whose next action a seat holds, as the Agent Detail's Pull requests pane
 * lists it: a row of `AgentOS.util.OpenWorkSeat.held`, keyed `<repo>#<number>`. The pane replaces
 * the rows whole on every answer, never edits one in place.
 */
class HeldPullRequest extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.HeldPullRequest'
         * @protected
         */
        className: 'AgentOS.model.HeldPullRequest',
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
            // what the seat holds: `red`, `changes-requested` or `review-due`
            name: 'kind',
            type: 'String'
        }, {
            // the seat's role on the pull request: `author` or `reviewer`
            name: 'role',
            type: 'String'
        }, {
            // the producer's title; null while its row carries none
            name        : 'title',
            defaultValue: null
        }, {
            // when the producer last observed this PR (ISO string); null = not observed
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

export default Neo.setupClass(HeldPullRequest);
