import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.SessionSummary
 * @extends Neo.data.Model
 *
 * @summary One view-projection record in the Fleet memories pane: a single session summary as the
 * `get_all_summaries` operation returned it. The model is intentionally thin — it stores
 * projection input and never derives a second memory authority. The `title` and `summary`
 * converts are the rendering guards for the vocabulary-collision class: a non-string value
 * becomes `null` and the pane names it honestly, instead of a coerced `[object Object]` card.
 */
class SessionSummary extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.SessionSummary'
         * @protected
         */
        className: 'AgentOS.model.SessionSummary',
        /**
         * @member {String} keyProperty='id'
         * @reactive
         */
        keyProperty: 'id',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            /**
             * View-owned display facts: the viewer-calendar band grouping stamped by
             * {@link AgentOS.view.fleet.memories.SummaryGrid#stampFacts} into the plain projection
             * bags before they become records ({label} on the first card of each band, null
             * otherwise). Rides the record because the pooled grid cells render from record fields;
             * never wire data — the owner seam strips display state off the wire.
             * @field
             */
            name: 'bandFacts'
        }, {
            name: 'id',
            type: 'String'
        }, {
            name: 'sessionId',
            type: 'String'
        }, {
            name: 'timestamp',
            type: 'String'
        }, {
            name        : 'title',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            name        : 'summary',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            name        : 'category',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'memoryCount',
            type        : 'Integer',
            defaultValue: null
        }, {
            name        : 'quality',
            type        : 'Integer',
            defaultValue: null
        }, {
            name        : 'impact',
            type        : 'Integer',
            defaultValue: null
        }, {
            name        : 'sourceAgentIdentities',
            type        : 'Array',
            convert     : value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [],
            defaultValue: []
        }]
    }
}

export default Neo.setupClass(SessionSummary);
