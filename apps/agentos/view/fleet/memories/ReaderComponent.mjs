import Component  from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import ViewerTime from '../../../util/ViewerTime.mjs';

/**
 * The turn record's three authored fields, in reading order, with their block labels.
 * @type {Array<[String, String]>}
 */
const TURN_FIELDS = [['prompt', 'Prompt'], ['thought', 'Thought'], ['response', 'Response']];

/**
 * The Memories view's reading surface: the selected session summary or turn record, whole.
 *
 * @summary Renders the plain record bags the owning {@link AgentOS.view.fleet.memories.Container}
 * hands it: one record while the operator reads a selection, every loaded record of the open
 * register in list order under *show all*, none for the nothing-selected state. The wire already
 * carries each record whole — `get_all_summaries` the summary document, `get_session_memories` the
 * turn's prompt, thought and response — so nothing is fetched here and nothing is cut: the list
 * registers keep their clamped previews, and this pane is where the whole lives. A field the plane
 * did not return as a string is NAMED with the record's id, never rendered as an empty block.
 *
 * Flat vdom like the pooled cells, all content escaped `text`. The copy and drill affordances are
 * native buttons, delegated here: drill re-fires as the `drillRequest` intent, copy goes to the
 * clipboard through the main thread's selection — `DomAccess.selectNode` selects form fields only,
 * so the field's text passes through one hidden read-only textarea.
 *
 * @class AgentOS.view.fleet.memories.ReaderComponent
 * @extends Neo.component.Base
 */
class ReaderComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.ReaderComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.ReaderComponent',
        /**
         * @member {String} ntype='fm-memories-reader'
         * @protected
         */
        ntype: 'fm-memories-reader',
        /**
         * @member {String[]} baseCls=['fm-memories-reader']
         */
        baseCls: ['fm-memories-reader'],
        /**
         * What to read, in one write so the pane renders once: `{kind: 'summary'|'turn', records:
         * Object[], emptyText: String}`. `records` are plain bags (never Model instances); an empty
         * list renders `emptyText`.
         * @member {Object|null} reading_=null
         * @reactive
         */
        reading_: null
    }

    /**
     * The field the last copy put on the clipboard (`<recordId>:<field>`), so its button can say so
     * until the reading changes.
     * @member {String|null} copiedKey=null
     */
    copiedKey = null

    /**
     * @summary Delegate the drill and copy buttons; the cells' buttons stay passive vdom.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const me = this;

        me.addDomListeners([
            {click: me.onCopyClick,  delegate: '.fm-memories-read-copy',  scope: me},
            {click: me.onTurnsClick, delegate: '.fm-memories-read-turns', scope: me}
        ]);

        me.render()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetReading(value, oldValue) {
        this.copiedKey = null;
        this.isConstructed && this.render()
    }

    /**
     * @summary A DOM id for one part of one record: record ids come from the plane and may carry
     * characters an id should not.
     * @param {String} recordId
     * @param {String} part
     * @returns {String}
     */
    partId(recordId, part) {
        return `${this.id}__${String(recordId).replace(/[^\w-]/g, '_')}__${part}`
    }

    /**
     * @summary The node for one record's text: the whole string, or the sentence naming what the
     * plane did not return.
     * @param {*}      value
     * @param {String} id
     * @param {String} missing
     * @returns {Object}
     */
    textNode(value, id, missing) {
        const whole = typeof value === 'string' && value.trim().length > 0;

        return {cls: ['fm-memories-read-text', ...whole ? [] : ['is-missing']], id, text: whole ? value : missing}
    }

    /**
     * @summary One session summary: title and drill, the meta line, the full summary text.
     * @param {Object} record
     * @returns {Object}
     */
    summaryArticle(record) {
        const
            me       = this,
            session  = typeof record.sessionId === 'string' && record.sessionId ? record.sessionId : null,
            iso      = ViewerTime.viewerTimeTitle(record.timestamp),
            metaBits = [
                ViewerTime.formatViewerTime(record.timestamp)?.text ?? 'unknown time',
                session ? `session ${session.slice(0, 8)}` : null,
                (record.sourceAgentIdentities || []).join(', ') || null,
                record.category || null,
                Number.isFinite(record.memoryCount) ? `${record.memoryCount} memories` : null
            ].filter(Boolean);

        return {
            tag: 'article',
            cls: ['fm-memories-read'],
            id : me.partId(record.id, 'article'),
            cn : [{
                cls: ['fm-memories-read-head'],
                cn : [{
                    tag : 'h3',
                    cls : ['fm-memories-read-title'],
                    text: record.title ?? 'Title unavailable for this session.'
                }, session && {
                    tag : 'button',
                    type: 'button',
                    cls : ['fm-memories-read-turns'],
                    data: {recordId: record.id},
                    text: 'Read the turns'
                }].filter(Boolean)
            }, {
                cls : ['fm-memories-read-meta'],
                text: metaBits.join(' · '),
                ...(iso ? {title: iso} : {})
            }, me.textNode(record.summary, me.partId(record.id, 'summary'), `The plane returned no summary text · summary ${record.id}`)]
        }
    }

    /**
     * @summary One turn record: the meta line, then prompt, thought and response as three blocks,
     * each with its copy action.
     * @param {Object} record
     * @returns {Object}
     */
    turnArticle(record) {
        const
            me       = this,
            iso      = ViewerTime.viewerTimeTitle(record.timestamp),
            metaBits = [
                ViewerTime.formatViewerTime(record.timestamp)?.text ?? 'unknown time',
                record.agentIdentity || null,
                Number.isFinite(record.amountToolCalls) ? `${record.amountToolCalls} tool calls` : null
            ].filter(Boolean);

        return {
            tag: 'article',
            cls: ['fm-memories-read', 'is-turn'],
            id : me.partId(record.id, 'article'),
            cn : [{
                cls : ['fm-memories-read-meta'],
                text: metaBits.join(' · '),
                ...(iso ? {title: iso} : {})
            }, ...TURN_FIELDS.map(([field, label]) => {
                const
                    value  = record[field],
                    whole  = typeof value === 'string' && value.trim().length > 0,
                    copied = me.copiedKey === `${record.id}:${field}`;

                return {
                    cls: ['fm-memories-read-block'],
                    cn : [{
                        cls: ['fm-memories-read-block-head'],
                        cn : [{tag: 'h4', cls: ['fm-memories-read-label'], text: label}, whole && {
                            tag         : 'button',
                            type        : 'button',
                            cls         : ['fm-memories-read-copy'],
                            id          : me.partId(record.id, `copy-${field}`),
                            data        : {field, recordId: record.id},
                            'aria-label': `Copy the ${field}`,
                            text        : copied ? 'Copied' : 'Copy'
                        }].filter(Boolean)
                    }, me.textNode(value, me.partId(record.id, field), `The plane returned no ${field} for this turn · turn ${record.id}`)]
                }
            })]
        }
    }

    /**
     * @summary Rebuild the whole surface from {@link #reading} — one pass, like the cells.
     */
    render() {
        const
            me = this,
            {kind = 'summary', records = [], emptyText = ''} = me.reading || {};

        me.vdom.cn = [
            ...records.length > 0
                ? records.map(record => kind === 'turn' ? me.turnArticle(record) : me.summaryArticle(record))
                : [{cls: ['fm-memories-reader-empty'], text: emptyText}],
            // the clipboard's way in: DomAccess.selectNode selects form fields only
            {tag: 'textarea', cls: ['fm-memories-copy-source'], id: me.partId('clipboard', 'source'), readonly: true, tabIndex: -1, 'aria-hidden': 'true'}
        ];

        me.update()
    }

    /**
     * @summary Resolve a delegated button's `data` from the event path.
     * @param {Object} data
     * @param {String} cls
     * @returns {Object|null}
     */
    buttonData(data, cls) {
        return (data.path || []).find(node => node.cls?.includes(cls))?.data ?? null
    }

    /**
     * @summary The copy action: the field's whole text goes to the clipboard through the hidden
     * textarea, and the focus returns to the button.
     * @param {Object} data The delegated click
     */
    async onCopyClick(data) {
        const
            me         = this,
            button     = me.buttonData(data, 'fm-memories-read-copy'),
            record     = (me.reading?.records || []).find(bag => bag.id === button?.recordId),
            value      = record?.[button?.field],
            {windowId} = me,
            source     = me.vdom.cn.at(-1);

        if (typeof value !== 'string') {
            return
        }

        source.text = value;
        await me.promiseUpdate();
        await Neo.main.DomAccess.selectNode({id: source.id, windowId});
        await Neo.main.DomAccess.execCommand({command: 'copy', windowId});
        await Neo.main.DomAccess.focus({id: me.partId(record.id, `copy-${button.field}`), windowId});

        me.copiedKey = `${record.id}:${button.field}`;
        me.render()
    }

    /**
     * @summary The drill affordance: fire the `drillRequest` intent with the summary's record bag.
     * @param {Object} data The delegated click
     */
    onTurnsClick(data) {
        const
            me     = this,
            button = me.buttonData(data, 'fm-memories-read-turns'),
            record = (me.reading?.records || []).find(bag => bag.id === button?.recordId);

        record && me.fire('drillRequest', {record})
    }

    /**
     * @summary Bring one record's article into view — show-all's answer to a rail click.
     * @param {String} recordId
     */
    scrollToRecord(recordId) {
        const me = this;

        me.mounted && Neo.main.DomAccess.scrollIntoView({id: me.partId(recordId, 'article'), windowId: me.windowId, block: 'start', delay: 0})
    }
}

export default Neo.setupClass(ReaderComponent);
