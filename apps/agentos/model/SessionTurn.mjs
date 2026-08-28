import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.SessionTurn
 * @extends Neo.data.Model
 *
 * @summary One view-projection record in the Fleet memories drill-in: a single turn-level memory
 * as the `get_session_memories` operation returned it. The model is intentionally thin — it
 * stores projection input and never derives a second memory authority. The prose-field converts
 * are the rendering guards for the vocabulary-collision class: a non-string value becomes `null`
 * and the pane names it honestly, instead of a coerced `[object Object]` row. Unlike the derived
 * summary sibling, every prose field here is an AGENT-AUTHORED record — the pane's provenance
 * labels lean on that distinction.
 */
class SessionTurn extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.SessionTurn'
         * @protected
         */
        className: 'AgentOS.model.SessionTurn',
        /**
         * @member {String} keyProperty='id'
         * @reactive
         */
        keyProperty: 'id',
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
            name: 'timestamp',
            type: 'String'
        }, {
            /**
             * The tweet-size per-turn summary — the turn's TITLE line once the wire carries it
             * (producer-side exposure: neomjs/neo-agent-brain#210; the merged memories sketch's
             * measured law). Until then the field arrives null and the row falls back to the
             * bounded response head — forward-compatible, never a phantom.
             * @field
             */
            name        : 'miniSummary',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            name        : 'prompt',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            name        : 'thought',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            name        : 'response',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            name        : 'agentIdentity',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'amountToolCalls',
            type        : 'Integer',
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(SessionTurn);
