import MailboxMessageModel from '../model/MailboxMessage.mjs';
import Store               from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.AgentMailbox
 * @extends Neo.data.Store
 *
 * @summary The mailbox mirror pane's row layer — a Store of
 * {@link AgentOS.model.MailboxMessage} records holding ONE adapter snapshot's frozen rows for the
 * pane's current subject. **Not a singleton and not provider-hosted**: the mailbox pane owns its
 * store instance directly — created with the pane, replaced wholesale on each snapshot through the
 * grid's one data path ({@link AgentOS.view.fleet.mailbox.Grid#applyBags}), destroyed with the pane.
 *
 * No `url`: this store is NEVER fetched. The Fleet mailbox read adapter (the S1 Brain half) is the
 * only data source, and its viewer-admission + read-only + active-inbox boundaries live on that
 * seam — the store is presentation plumbing over the adapter's immutable rows, newest first.
 *
 * The pane's open view lists the operator's open questions in their read's own order (priority, then age), so it
 * clears the sorter while it shows them ({@link #sortersOf}).
 */
class AgentMailbox extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.AgentMailbox'
         * @protected
         */
        className: 'AgentOS.store.AgentMailbox',
        /**
         * The durable message key. Declared on the store as well as the model: the collection
         * layer defaults `keyProperty` to `'id'`, which always wins the store-level
         * `this.keyProperty || this.model.keyProperty` fallback — so the model's `messageId` must
         * be mirrored here to take effect.
         * @member {String} keyProperty='messageId'
         */
        keyProperty: 'messageId',
        /**
         * @member {Neo.data.Model} model=MailboxMessageModel
         * @reactive
         */
        model: MailboxMessageModel,
        /**
         * Flat-chronological, newest first — the graduated record's binding render order; thread
         * collapse is a display grouping the view applies OVER this order, never a re-sort.
         * @member {Object[]} sorters
         */
        sorters: AgentMailbox.sortersOf('all')
    }

    /**
     * @summary The sorters a list reads in: all mail newest first; the open questions none, because their read
     * already orders them and a sorter would undo it.
     * @param {'all'|'open'} view
     * @returns {Object[]} Fresh sorter configs
     */
    static sortersOf(view) {
        return view === 'open' ? [] : [{direction: 'DESC', property: 'sentAt'}]
    }
}

export default Neo.setupClass(AgentMailbox);
