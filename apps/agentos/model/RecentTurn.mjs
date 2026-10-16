import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.RecentTurn
 * @extends Neo.data.Model
 *
 * @summary One turn of a seat's thought stream as the Fleet's `fleetRecentTurns` verb serves it
 * (neomjs/neo-agent-brain#792): the one-line summary the plane DERIVED for the turn, its instant and its
 * session, never the turn's own prose. The memories drill-in's {@link AgentOS.model.SessionTurn} is the
 * other kind of row, an agent-authored record, and the two stay apart so a provenance label can lean on
 * the class. The two flags name a weaker summary: `projectionPending` while the plane has not projected
 * one yet, `summaryFallback` where the line was cut from the raw turn instead. The Agent Detail's Thought
 * stream list replaces the rows whole on every answer, never edits one in place.
 */
class RecentTurn extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.RecentTurn'
         * @protected
         */
        className: 'AgentOS.model.RecentTurn',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'id',
            type: 'String'
        }, {
            name: 'sessionId',
            type: 'String'
        }, {
            // the turn's instant (ISO string); the row words its age against the pane's clock
            name: 'timestamp',
            type: 'String'
        }, {
            // the derived line; a non-string value becomes null and the row says so, never a coerced object
            name        : 'summary',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            name        : 'summaryFallback',
            type        : 'Boolean',
            defaultValue: false
        }, {
            name        : 'projectionPending',
            type        : 'Boolean',
            defaultValue: false
        }]
    }
}

export default Neo.setupClass(RecentTurn);
