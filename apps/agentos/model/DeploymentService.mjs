import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

const
    STATUSES     = new Set(['available', 'degraded']),
    DISPOSITIONS = new Set(['below', 'at-cap', 'unknown']),
    BASELINES    = new Set(['available', 'absent', 'unreadable']),
    word         = value => typeof value === 'string' && value ? value : null,
    finite       = value => Number.isFinite(value) ? value : null,
    flag         = value => typeof value === 'boolean' ? value : null;

/**
 * @class AgentOS.model.DeploymentService
 * @extends Neo.data.Model
 *
 * @summary One plane card's record in the System view: a single service row of the `fleetDeploymentState`
 * projection, flattened to the fields a card renders — the orchestrator's folded status word, the
 * memory-pressure reading, the restart-churn detector's state, the service class with its applied
 * threshold, and the container-health decision. Thin by design: it stores projection input and derives
 * no second truth. The converts are rendering guards — a word outside the writer's vocabulary becomes
 * `null` and the card renders the honest absence instead of a guessed state.
 */
class DeploymentService extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.DeploymentService'
         * @protected
         */
        className: 'AgentOS.model.DeploymentService',
        /**
         * @member {String} keyProperty='serviceKey'
         * @reactive
         */
        keyProperty: 'serviceKey',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'serviceKey',
            type: 'String'
        }, {
            // the orchestrator's observation instant for this row (epoch ms)
            name        : 'observedAt',
            type        : 'Integer',
            convert     : finite,
            defaultValue: null
        }, {
            // how old the observation is on the reader's clock, computed by the owning view from the
            // picture's own age and the row's observation instant — a card word, not a second truth
            name        : 'observedAgeMs',
            type        : 'Integer',
            convert     : finite,
            defaultValue: null
        }, {
            // the folded status word: `available` | `degraded` (memory at-cap folds to degraded at the writer)
            name        : 'status',
            type        : 'String',
            convert     : value => STATUSES.has(value) ? value : null,
            defaultValue: null
        }, {
            name        : 'memoryDisposition',
            type        : 'String',
            convert     : value => DISPOSITIONS.has(value) ? value : null,
            defaultValue: null
        }, {
            name        : 'memoryReason',
            type        : 'String',
            convert     : word,
            defaultValue: null
        }, {
            name        : 'churnBaseline',
            type        : 'String',
            convert     : value => BASELINES.has(value) ? value : null,
            defaultValue: null
        }, {
            name        : 'churnDetecting',
            type        : 'Boolean',
            convert     : flag,
            defaultValue: null
        }, {
            name        : 'serviceClass',
            type        : 'String',
            convert     : word,
            defaultValue: null
        }, {
            name        : 'serviceClassDeclared',
            type        : 'Boolean',
            convert     : flag,
            defaultValue: null
        }, {
            // the applied memory threshold, in percent, as the classification carries it
            name        : 'memoryThreshold',
            type        : 'Integer',
            convert     : finite,
            defaultValue: null
        }, {
            name        : 'sampleCount',
            type        : 'Integer',
            convert     : finite,
            defaultValue: null
        }, {
            // the container-health decision: its status word and action class, plus the inner
            // diagnosis's recovery class and confidence when one exists
            name        : 'diagnosisStatus',
            type        : 'String',
            convert     : word,
            defaultValue: null
        }, {
            name        : 'actionClass',
            type        : 'String',
            convert     : word,
            defaultValue: null
        }, {
            name        : 'recoveryClass',
            type        : 'String',
            convert     : word,
            defaultValue: null
        }, {
            name        : 'confidence',
            type        : 'Float',
            convert     : finite,
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(DeploymentService);
