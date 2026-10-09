import Button     from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container  from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import ViewerTime from '../../../util/ViewerTime.mjs';

/**
 * The Task states the recipient may still move to Completed (the recipient's exits in the Task contract).
 * @type {String[]}
 */
const RESOLVABLE_TASK_STATES = Object.freeze(['InputRequired', 'Working']);

/**
 * The actions an outcome line can name.
 * @type {Object}
 */
const ACTION_LABELS = Object.freeze({markRead: 'Mark read', resolve: 'Resolve'});

/**
 * One message opened from the mailbox: its facts, its full body, and on the operator's own inbox one
 * action strip, `Mark read` · `Reply` · then apart `Resolve: mark Completed`.
 *
 * @summary The pane owns which message is open (the grid's selection) and hands this view the selected
 * row; the owner reads the body and writes it back as {@link #read}. Two entries share this one view:
 * `own` renders the strip, `observer` renders the message read-only. Opening reads; it never marks
 * read. Every action fires an intent for the host to relay, and its result returns as owner-written
 * {@link #outcome}, so a refusal shows its reason and its code, and never a false success.
 *
 * @class AgentOS.view.fleet.mailbox.DetailContainer
 * @extends Neo.container.Base
 */
class DetailContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.DetailContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.DetailContainer',
        /**
         * @member {String} ntype='fm-mailbox-detail'
         * @protected
         */
        ntype: 'fm-mailbox-detail',
        /**
         * @member {String[]} baseCls=['fm-mailbox-detail']
         */
        baseCls: ['fm-mailbox-detail'],
        /**
         * Which entry opened the message: `own` (the operator's own inbox) renders the action strip,
         * `observer` renders none.
         * @member {'own'|'observer'} entry_='observer'
         * @reactive
         */
        entry_: 'observer',
        /**
         * The owner's settled action on this message: `{messageId, action, state, code?, reason?}`,
         * `state` one of `pending` · `ok` · `refused`. `null` = no action taken.
         * @member {Object|null} outcome_=null
         * @reactive
         */
        outcome_: null,
        /**
         * The owner's body read: `{messageId, state, message?, code?, reason?}`, `state` one of
         * `loading` · `ok` · `refused` · `unavailable`. `null` = not asked yet.
         * @member {Object|null} read_=null
         * @reactive
         */
        read_: null,
        /**
         * The selected row, as the mirror listed it (`messageId`, `from`, `subject`, `status`,
         * `taskState`, `priority`, `sentAt`, `relatedTickets`). `null` = nothing open.
         * @member {Object|null} row_=null
         * @reactive
         */
        row_: null,
        /**
         * The viewer's identity, `@`-form: a Task is the viewer's to resolve only when it names the
         * viewer as its assignee.
         * @member {String|null} viewerIdentity_=null
         * @reactive
         */
        viewerIdentity_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-mailbox-detail-facts'],
            flex     : 'none',
            reference: 'detail-facts'
        }, {
            // escaped text: a body is a peer's words, never markup
            ntype    : 'component',
            cls      : ['fm-mailbox-detail-body'],
            flex     : '0 1 auto',
            reference: 'detail-body'
        }, {
            ntype    : 'component',
            cls      : ['fm-mailbox-detail-outcome'],
            flex     : 'none',
            hidden   : true,
            reference: 'detail-outcome',
            role     : 'status'
        }, {
            ntype    : 'container',
            cls      : ['fm-mailbox-detail-strip'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'hbox', align: 'center'},
            reference: 'detail-strip',
            items    : [{
                module   : Button,
                handler  : 'up.onMarkReadClick',
                reference: 'detail-mark-read',
                text     : 'Mark read',
                ui       : 'ghost'
            }, {
                module   : Button,
                handler  : 'up.onReplyClick',
                reference: 'detail-reply',
                text     : 'Reply',
                ui       : 'ghost'
            }, {
                ntype: 'component',
                flex : 1
            }, {
                module   : Button,
                handler  : 'up.onResolveClick',
                reference: 'detail-resolve',
                text     : 'Resolve: mark Completed',
                ui       : 'ghost'
            }]
        }]
    }

    /**
     * @summary Is the read about the open message?
     * @returns {Object|null} The read, or `null`
     */
    get currentRead() {
        const {read, row} = this;

        return read && row && read.messageId === row.messageId ? read : null
    }

    /**
     * @summary The open message's Task, once the body read returned it.
     * @returns {Object|null}
     */
    get openTask() {
        const read = this.currentRead;

        return read?.state === 'ok' ? read.message?.task ?? null : null
    }

    /**
     * @summary Render whatever was set before construction.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.applyDetail()
    }

    /**
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetEntry(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetOutcome(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRead(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRow(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetViewerIdentity(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * @summary Render the facts, the body, the outcome line and the strip from the configs.
     * @protected
     */
    applyDetail() {
        const
            me        = this,
            {row}     = me,
            facts     = me.getReference('detail-facts'),
            retracted = row?.status === 'retracted',
            outcome   = row && me.outcome?.messageId === row.messageId ? me.outcome : null,
            pending   = outcome?.state === 'pending',
            own       = me.entry === 'own' && !!row && !retracted;

        facts.vdom.cn = me.buildFacts();
        facts.update();
        me.getReference('detail-body').text = me.getBodyText();

        me.getReference('detail-outcome').set({
            hidden: !outcome || outcome.state === 'ok',
            text  : outcome ? me.getOutcomeText(outcome) : null
        });

        me.getReference('detail-strip').hidden = !own;
        me.getReference('detail-mark-read').set({disabled: pending, hidden: row?.status !== 'unread'});
        me.getReference('detail-reply').disabled = pending;
        me.getReference('detail-resolve').set({disabled: pending, hidden: !me.canResolve()})
    }

    /**
     * @summary The facts line: sender, the full subject, the sent time (exact ISO on its title) and the
     * Task state when there is one. An expired question adds what its sender planned for that case.
     * @returns {Object[]}
     * @protected
     */
    buildFacts() {
        const row = this.row;

        if (!row) {
            return []
        }

        const
            stamp   = ViewerTime.formatViewerTime(row.sentAt),
            task    = this.openTask?.state ?? row.taskState,
            expired = this.getExpiredText();

        return [
            {cls: ['fm-mailbox-detail-from'], text: row.from},
            {cls: ['fm-mailbox-detail-subject'], text: row.subject || '(no subject)'},
            {
                cls: ['fm-mailbox-detail-meta'],
                cn : [
                    {tag: 'span', text: stamp?.text ?? '', ...(stamp?.title ? {title: stamp.title} : {})},
                    ...(task ? [{tag: 'span', cls: ['fm-mail-chip', 'fm-mail-task'], text: `task · ${task}`}] : [])
                ]
            },
            ...(expired ? [{cls: ['fm-mailbox-detail-expired'], text: expired}] : [])
        ]
    }

    /**
     * @summary The expired line, read from the persisted Task the body read returned, never from a list row:
     * the sender's stated plan, or that none was stated. It states a plan, never that the plan ran.
     * @returns {String|null} `null` unless the open message's Task expired
     * @protected
     */
    getExpiredText() {
        const task = this.openTask;

        if (task?.state !== 'Expired') {
            return null
        }

        return typeof task.fallback === 'string' && task.fallback.trim()
            ? `expired; planned fallback: ${task.fallback.trim()}`
            : 'expired; no fallback was stated'
    }

    /**
     * @summary Can the viewer resolve the open message's Task: a Task the read returned, in a state the
     * recipient may still move, naming the viewer as its assignee.
     * @returns {Boolean}
     */
    canResolve() {
        const
            task   = this.openTask,
            bare   = id => String(id ?? '').trim().replace(/^@/, ''),
            viewer = bare(this.viewerIdentity);

        return !!task && RESOLVABLE_TASK_STATES.includes(task.state) && !!viewer && bare(task.assignee) === viewer
    }

    /**
     * @summary The body's text: the message's own words once the read returned them, otherwise what
     * stands in their place and why.
     * @returns {String}
     * @protected
     */
    getBodyText() {
        const {row} = this;

        if (!row) {
            return ''
        }

        if (row.status === 'retracted') {
            return 'The sender retracted this message.'
        }

        const read = this.currentRead;

        switch (read?.state) {
            case 'ok':
                return read.message?.body || '(no message text)';
            case 'refused':
                return `The message could not be opened: ${read.reason || 'refused'}${read.code ? ` · ${read.code}` : ''}`;
            case 'unavailable':
                return `The message could not be read: ${read.reason || 'source unavailable'}`;
            default:
                return 'Reading the message…'
        }
    }

    /**
     * @summary The outcome line for an action that is pending or was refused, with the Brain's code
     * beside its reason.
     * @param {Object} outcome
     * @returns {String}
     * @protected
     */
    getOutcomeText(outcome) {
        const label = ACTION_LABELS[outcome.action] || outcome.action;

        if (outcome.state === 'pending') {
            return `${label}…`
        }

        return `${label} was refused: ${outcome.reason || 'no reason given'}${outcome.code ? ` · ${outcome.code}` : ''}`
    }

    /**
     * @summary Ask the host to mark the open message read.
     * @protected
     */
    onMarkReadClick() {
        const {row} = this;

        row && this.fire('markReadRequest', {messageId: row.messageId})
    }

    /**
     * @summary Ask the host to open a reply to the open message's sender.
     * @protected
     */
    onReplyClick() {
        const {row} = this;

        row && this.fire('replyRequest', {messageId: row.messageId, subject: row.subject, to: row.from})
    }

    /**
     * @summary Ask the host to move the open message's Task to Completed, guarded by the state the read
     * returned.
     * @protected
     */
    onResolveClick() {
        const {row} = this, task = this.openTask;

        row && task && this.fire('resolveRequest', {expectedCurrentState: task.state, messageId: row.messageId})
    }
}

export default Neo.setupClass(DetailContainer);
