import ComponentController   from '../../../../../node_modules/neo.mjs/src/controller/Component.mjs';
import ConfigIntentRoundTrip from '../../../util/ConfigIntentRoundTrip.mjs';

/**
 * @class AgentOS.view.fleet.detail.Controller
 * @extends Neo.controller.Component
 * @summary Owns the inspector's configuration and freshness lifecycle. The component renders
 * shared records; ConfigIntentRoundTrip retains cross-surface canonical write arbitration.
 */
class Controller extends ComponentController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.Controller'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.Controller'
    }

    /**
     * @summary Wire the completed inspector's config card and shared Store, then start its
     * existing freshness cadence. The component may have received its Store during construction.
     */
    onComponentConstructed() {
        const me = this;

        me.getReference('config-pane').on({configIntent: me.onConfigIntent, scope: me});
        me.onDefinitionsStoreChange(me.component.agentDefinitions, null);
        me.startFreshnessAging()
    }

    /**
     * @summary Detach intent and Store subscriptions before the inspector's children leave.
     * The inherited lifecycle cancels this controller's pending freshness timeout.
     * @param {...*} args
     */
    destroy(...args) {
        const me = this;

        me.component.agentDefinitions?.un(me.getDefinitionsStoreListeners());
        me.getReference('config-pane')?.un({configIntent: me.onConfigIntent, scope: me});
        super.destroy(...args)
    }

    /**
     * @summary Fresh listener descriptors for the shared definitions Store. Observable consumes
     * descriptor keys, so attach and detach each receive their own map.
     * @returns {Object}
     * @private
     */
    getDefinitionsStoreListeners() {
        return {
            load        : this.onDefinitionsStoreMutation,
            mutate      : this.onDefinitionsStoreMutation,
            recordChange: this.onDefinitionRecordChange,
            scope       : this
        }
    }

    /**
     * @summary Move subscriptions between provider-owned Stores and re-seat the rendered join.
     * Neither this controller nor the inspector owns the Store's destruction.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     */
    onDefinitionsStoreChange(value, oldValue) {
        const me = this;

        oldValue?.un(me.getDefinitionsStoreListeners());
        value?.on(me.getDefinitionsStoreListeners());
        me.component.applyConfigRecord()
    }

    /**
     * @summary A reload or membership change may add, replace or remove the displayed definition.
     * The view resolves the same registry-key join against the current shared Store.
     */
    onDefinitionsStoreMutation() {
        this.component.applyConfigRecord()
    }

    /**
     * @summary Refresh a same-identity record after a field readback; reactive record assignment
     * alone cannot observe an in-place change.
     * @param {Object} data The Store's recordChange event.
     */
    onDefinitionRecordChange(data) {
        const card = this.getReference('config-pane');

        card.record && data.record?.id === card.record.id && card.refresh()
    }

    /**
     * @summary Submit the config card's intent to the shared round-trip owner. A late response
     * can still update its surviving provider Store, but cannot paint a dead or rebound inspector.
     * The card itself keeps statuses scoped to its currently displayed agent.
     * @param {Object} intent `{id, harnessType?, mcpServers?, mcpTarget?}` plus the event envelope.
     * @returns {Promise<void>}
     */
    onConfigIntent(intent={}) {
        const
            me          = this,
            {component} = me,
            store       = component.agentDefinitions;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent,
            owner: me,
            store,
            setSaveStatus: (agentId, state, reason) => {
                if (!me.isDestroyed && !component.isDestroying && !component.isDestroyed &&
                    store === component.agentDefinitions) {
                    me.getReference('config-pane').setSaveStatus(agentId, state, reason)
                }
            }
        })
    }

    /**
     * @summary Re-age the inspector without requiring a new roster row. Preserve its cadence and
     * injected-clock behavior: an empty inspector skips rendering and keeps the loop alive.
     * @returns {Promise<void>} This wait's completion, including normal destruction cancellation.
     */
    startFreshnessAging() {
        const
            me          = this,
            {component} = me;

        return me.timeout(component.freshnessRefreshMs).then(() => {
            if (!me.isDestroyed && !component.isDestroying && !component.isDestroyed) {
                component.record && component.applyPaneFreshness();
                me.startFreshnessAging()
            }
        }).catch(error => {
            if (error !== Neo.isDestroyed) throw error
        })
    }
}

export default Neo.setupClass(Controller);
