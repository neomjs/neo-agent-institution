import Component  from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import ViewerTime from '../../../util/ViewerTime.mjs';

/**
 * One designed mailbox row — the merged information-design sketch
 * (`apps/agentos/design/institution-mailbox-pane.html`, #36/#38) rendered from one
 * {@link AgentOS.model.MailboxMessage} record.
 *
 * @summary The grid cell for {@link AgentOS.view.fleet.mailbox.Grid}: a deliberately FLAT component —
 * the whole row anatomy (unread mark · sender monogram · content column · viewer-local age) is built
 * as plain vdom from the record, with zero child components. Flatness is the recycle-atomicity
 * contract: `grid.column.Component` re-seats pooled cells via silent `set()`, and a child that
 * updates itself leaves the row's scroll transaction and tears (the engine's `NestedCell` example
 * documents the hazard; a flat cell cannot exhibit it). The one interactive element — the thread
 * toggle — is a NATIVE button in the vdom (keyboard-operable, `aria-expanded`); its click is
 * delegated by the owning grid, never handled here.
 *
 * Row grammar (the sketch's contract, all writer-guaranteed fields — no phantom states):
 * - `status` — `unread` lifts the subject to weight + ink and fills the dot (two channels,
 *   WCAG 1.4.1); `retracted` strikes the subject on readable ink and names itself in the strip.
 * - `subject` — the ONE body-tier line, escaped text only (the adapter's redaction contract).
 * - `sentAt` — T5: viewer-local text via {@link AgentOS.util.ViewerTime}, exact ISO on `title`.
 * - exception strip — chips render ONLY for deviations (T2 exception-only): `high`/`low` priority,
 *   an A2A `taskState` envelope, a non-direct `recipientClass`; a direct/normal/plain/read message
 *   renders two quiet lines and zero chips.
 * - thread — a head renders the toggle (`+N earlier` collapsed · `collapse thread` expanded);
 *   members indent on the rail (grid-fed display facts, derived from the store's thread map).
 *
 * @class AgentOS.view.fleet.mailbox.RowComponent
 * @extends Neo.component.Base
 */
class RowComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.RowComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.RowComponent',
        /**
         * @member {String} ntype='fm-mailbox-row'
         * @protected
         */
        ntype: 'fm-mailbox-row',
        /**
         * @member {String[]} baseCls=['fm-mail-row']
         */
        baseCls: ['fm-mail-row'],
        /**
         * The row's data surface: one {@link AgentOS.model.MailboxMessage} record (or a plain field
         * bag with the same keys). Re-assigned on every pool recycle by the column's `component`
         * factory; `afterSetRecord` rebuilds the vdom in place.
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * Thread display facts for THIS row, derived by the owning grid from its store-wide thread
         * map (a cell sees one record and cannot know its thread's shape): `null` for a standalone
         * row, else `{isHead: Boolean, collapsed: Boolean, hiddenCount: Number, inThread: Boolean}`.
         * @member {Object|null} threadFacts_=null
         * @reactive
         */
        threadFacts_: null
    }

    /**
     * @summary The sender monogram: the first two characters of the handle's last dash segment
     * (`@neo-gpt-emmy` → `em`, `@tobiu` → `to`) — a deterministic, view-local derivation. Family
     * hue joins only if the adapter ever ships a family field; never guessed from the handle.
     * @param {String} from The canonical `@`-form sender.
     * @returns {String}
     */
    static monogram(from) {
        const segments = String(from || '').replace(/^@/, '').split('-');

        return segments[segments.length - 1].slice(0, 2)
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetRecord(value, oldValue) {
        this.buildRow()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetThreadFacts(value, oldValue) {
        this.buildRow()
    }

    /**
     * @summary Rebuild the full row vdom from the record + thread facts — one atomic update.
     *
     * The exception strip is assembled first and only mounted when it has content: absence of
     * deviation earns zero pixels, and an empty strip element would still cost its gap.
     * @protected
     */
    buildRow() {
        const
            me           = this,
            record       = me.record,
            facts        = me.threadFacts,
            {cls, vdom}  = me;

        if (!record) {
            vdom.cn = [];
            me.update();
            return
        }

        const
            unread    = record.status === 'unread',
            retracted = record.status === 'retracted',
            stamp     = ViewerTime.formatViewerTime(record.sentAt),
            strip     = [];

        // the exception strip: every entry is a deviation from direct/normal/plain — T2 exception-only
        if (record.priority === 'high' || record.priority === 'low') {
            strip.push({tag: 'span', cls: ['fm-mail-chip', `fm-mail-prio-${record.priority}`], text: record.priority})
        }

        if (record.taskState) {
            strip.push({tag: 'span', cls: ['fm-mail-chip', 'fm-mail-task'], text: `task · ${record.taskState}`})
        }

        if (record.recipientClass && record.recipientClass !== 'agent') {
            strip.push({tag: 'span', cls: ['fm-mail-chip', 'fm-mail-bcast'], text: record.recipientClass})
        }

        if (facts?.isHead) {
            strip.push({
                tag            : 'button',
                type           : 'button',
                cls            : ['fm-mail-thread-toggle'],
                'aria-expanded': String(!facts.collapsed),
                'aria-label'   : facts.collapsed
                    ? `Expand thread — ${facts.hiddenCount} earlier messages`
                    : 'Collapse thread',
                text: facts.collapsed ? `+${facts.hiddenCount} earlier` : 'collapse thread'
            })
        }

        if (retracted) {
            strip.push({tag: 'span', cls: ['fm-mail-tickets'], text: 'retracted'})
        } else if (record.relatedTickets?.length) {
            const
                tickets  = record.relatedTickets,
                shown    = tickets.slice(0, 2).map(id => `#${id}`).join(' · '),
                overflow = tickets.length > 2 ? ` +${tickets.length - 2}` : '';

            strip.push({tag: 'span', cls: ['fm-mail-tickets'], text: shown + overflow})
        }

        me[unread    ? 'addCls' : 'removeCls']('is-unread');
        me[retracted ? 'addCls' : 'removeCls']('status-retracted');
        me[facts?.inThread ? 'addCls' : 'removeCls']('is-in-thread');

        vdom.cn = [{
            tag: 'span',
            cls: ['fm-mail-udot'],
            ...(unread ? {title: 'unread in the subject agent\'s queue'} : {})
        }, {
            tag : 'span',
            cls : ['fm-mail-smark'],
            text: RowComponent.monogram(record.from)
        }, {
            cls: ['fm-mail-content'],
            cn : [
                {cls: ['fm-mail-sender'],  text: record.from},
                {cls: ['fm-mail-subject'], text: record.subject || '(no subject)'},
                ...(strip.length > 0 ? [{cls: ['fm-mail-xstrip'], cn: strip}] : [])
            ]
        }, {
            tag : 'span',
            cls : ['fm-mail-age'],
            text: stamp?.text ?? '',
            ...(stamp?.title ? {title: stamp.title} : {})
        }];

        me.update()
    }
}

export default Neo.setupClass(RowComponent);
