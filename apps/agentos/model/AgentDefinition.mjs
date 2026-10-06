import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.AgentDefinition
 * @extends Neo.data.Model
 *
 * @summary Public, Body-side shape for Fleet Manager agent definitions — the per-agent
 * configuration model every account surface binds: identity, its bound forge, ONE harness choice (a registered
 * public harness-catalog key), the per-agent sparse MCP-server overrides (`mcpServers` — null
 * means every current catalog default applies; resolve via the public MCP catalog, never persist
 * the fully resolved matrix), the narrow MCP target (`mcpTarget` — null = resident services;
 * a tenant is only `{kind:'tenant', tenantId}`), the declared repositories (`metadata.repo` is the
 * working one, `metadata.repos` the others; read as `record['metadata.repos']`), and the operational toggles (honest
 * readback: null = state not read back yet, never an
 * optimistic guess). This model deliberately contains no credential field: PAT bytes remain
 * Brain-side in FleetRegistryService and may only surface here as redacted state.
 */
class AgentDefinition extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.AgentDefinition'
         * @protected
         */
        className: 'AgentOS.model.AgentDefinition',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'id',
            type: 'String'
        }, {
            name: 'githubUsername',
            type: 'String'
        }, {
            // The Brain's bound forge is read-only here; definitions predating it are GitHub seats.
            name        : 'forge',
            type        : 'String',
            defaultValue: 'github'
        }, {
            name        : 'displayName',
            type        : 'String',
            defaultValue: null
        }, {
            name: 'harnessType',
            type: 'String'
        }, {
            name: 'credentialState',
            type: 'String'
        }, {
            name: 'lifecycleState',
            type: 'String'
        }, {
            // who launches the seat: 'fleet' (this fleet is its only launcher) or 'external' (its own
            // harness); null = the Brain did not report it, never a guess
            name        : 'launchOwner',
            type        : 'String',
            defaultValue: null
        }, {
            // sparse per-agent MCP overrides {serverKey: Boolean}; null = all live defaults apply
            name        : 'mcpServers',
            type        : 'Object',
            defaultValue: null
        }, {
            // null = resident services; tenant shape is only {kind:'tenant', tenantId}
            name        : 'mcpTarget',
            type        : 'Object',
            defaultValue: null
        }, {
            // the model and reasoning effort declared for the seat's harness, applied at its next Start;
            // null = none declared, so the harness keeps its own configuration
            name        : 'model',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'reasoningEffort',
            type        : 'String',
            defaultValue: null
        }, {
            // the seat's memory consent: the folder of the existing agent's memory it continues, or 'none' to start
            // empty; null = none recorded, so its first Start opens with empty memory
            name        : 'memoryImport',
            type        : 'String',
            defaultValue: null
        }, {
            // the repositories the registry declares for the seat: `repo` is the working one
            // ({repoSlug, cloneUrl}), `repos` the others. Nested fields, not a `mapping`: a mapping
            // only reads initial values, and the configure readback must refresh both.
            name  : 'metadata',
            type  : 'Object',
            fields: [{
                name        : 'repo',
                type        : 'Object',
                defaultValue: null
            }, {
                name        : 'repos',
                type        : 'Array',
                defaultValue: null
            }]
        }, {
            // operational toggles: tri-state honesty (true / false / null = not read back yet) —
            // Object-typed so null survives hydration; never an optimistic default
            name        : 'hooksActive',
            type        : 'Object',
            defaultValue: null
        }, {
            name        : 'wakeSubscriptionsActive',
            type        : 'Object',
            defaultValue: null
        }, {
            name: 'statusText',
            type: 'String'
        }, {
            name: 'updatedAt',
            type: 'String'
        }]
    }
}

export default Neo.setupClass(AgentDefinition);
