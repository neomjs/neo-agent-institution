import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @summary A string field that admits strings only: a non-string wire value becomes `null`, so the
 * row names the gap instead of coercing a number or an object into words.
 * @param {String} name
 * @returns {Object}
 */
const stringField = name => ({name, type: 'String', convert: value => typeof value === 'string' ? value : null, defaultValue: null});

/**
 * @class AgentOS.model.SetupStep
 * @extends Neo.data.Model
 *
 * @summary One row of the first-run recipe's evaluation, exactly as the recipe's step JSON carried it
 * (`evaluateRecipe` → `steps[]`): the step's id, kind, summary, its fresh status with the reason in
 * the recipe's own words, the effect it names with its receipt outcome, the consented answer, and
 * the structured facts a row renders beside its text (the placement verdicts, the served identity,
 * the observed result). A thin projection input, never re-derived: no field here remembers a
 * "completed" bit, and a re-evaluation replaces every row — the projection rule of the bootstrap-record
 * decision.
 */
class SetupStep extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.SetupStep'
         * @protected
         */
        className: 'AgentOS.model.SetupStep',
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
        },
            // question · effect · observation — the kind decides the row's action
            stringField('kind'),
            // ok · pending · unknown · failed · reconcile-required
            stringField('status'),
            stringField('reason'),
            stringField('summary'),
            stringField('effectId'),
            // the receipt's outcome beside an effect row, history never health
            stringField('receipt'),
            stringField('observedAt'),
            stringField('consentedAt'),
        {
            // a consented answer: a preset id, or the PATH of a credential file — never a value
            name        : 'answer',
            type        : 'String',
            convert     : value => typeof value === 'string' ? value : null,
            defaultValue: null
        }, {
            // the placement step's verdicts: `{recommended, possible, refused, headroomBytes}`
            name        : 'placement',
            type        : 'Object',
            convert     : value => value && typeof value === 'object' ? value : null,
            defaultValue: null
        }, {
            // the served plane's identity on a mismatch: `{planeId, dataRoot}` as the responder named them
            name        : 'served',
            type        : 'Object',
            convert     : value => value && typeof value === 'object' ? value : null,
            defaultValue: null
        }, {
            // an unsettled effect's observed result, so a re-check can carry it
            name        : 'observed',
            type        : 'Object',
            convert     : value => value && typeof value === 'object' ? value : null,
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(SetupStep);
