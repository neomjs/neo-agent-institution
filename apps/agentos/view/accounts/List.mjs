import BaseList      from '../../../../node_modules/neo.mjs/src/list/Base.mjs';
import HarnessChoice from '../../util/HarnessChoice.mjs';

/**
 * @class AgentOS.view.accounts.List
 * @extends Neo.list.Base
 *
 * @summary The Accounts view's agent definitions, one row each: the agent's name over the harness
 * it runs in, named the way the add-agent form offers it (`HarnessChoice.describe`). The list is
 * bound to the provider-hosted `agentDefinitions` Store, which it never owns; the Accounts view reads
 * its selection and scopes the configuration card to it. Rows render, and nothing here reads a
 * bridge.
 */
class List extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.accounts.List'
         * @protected
         */
        className: 'AgentOS.view.accounts.List',
        /**
         * @member {String} ntype='fm-accounts-list'
         * @protected
         */
        ntype: 'fm-accounts-list',
        /**
         * @member {String[]} baseCls=['fm-accounts-list','neo-list']
         */
        baseCls: ['fm-accounts-list', 'neo-list'],
        /**
         * The definitions Store belongs to the Viewport's state provider — this list must never
         * destroy it.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false
    }

    /**
     * @summary One row per definition: the display name (falling back to the GitHub username) and
     * the harness line.
     * @param {Object} record An {@link AgentOS.model.AgentDefinition} record.
     * @returns {Object[]} vdom child nodes
     */
    createItemContent(record) {
        return [
            {cls: ['fm-accounts-name'],    text: record.displayName || record.githubUsername || record.id},
            {cls: ['fm-accounts-harness'], text: HarnessChoice.describe(record.harnessType) ?? 'Unknown harness'}
        ]
    }
}

export default Neo.setupClass(List);
