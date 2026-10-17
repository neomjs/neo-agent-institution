import BaseList from '../../../../node_modules/neo.mjs/src/list/Base.mjs';

/**
 * @summary The glyph and the word for every status — two channels per row, never hue alone.
 * @type {Object}
 */
export const STATUS_MARKS = Object.freeze({
    ok                 : {glyph: '●', word: 'ok'},
    pending            : {glyph: '○', word: 'pending'},
    unknown            : {glyph: '◌', word: 'unknown'},
    failed             : {glyph: '✕', word: 'failed'},
    'reconcile-required': {glyph: '◐', word: 'reconcile-required'}
});

/**
 * @summary The operator's verb for each exit the recipe names on its witness row.
 * @type {Object}
 */
export const EXIT_VERBS = Object.freeze({run: 'run', resume: 're-check', 'new-attempt': 'write again'});

/**
 * @summary The card's own exit for an effect row that stayed `reconcile-required` through a re-check in
 * this card: a fresh run for the same target. Never the recipe's data — the operator's re-check here is
 * what names it — and never on the witness row, whose exits are the Brain's.
 * @type {String}
 */
export const FRESH_RUN = 'start a fresh run';

/**
 * @summary The line a row says under its reason after the first press of an action that costs something,
 * by that action; the second press sends it.
 * @type {Object}
 */
export const CONFIRM_LINES = Object.freeze({
    'write again': 'a second row on the plane is possible · press write again to write it',
    [FRESH_RUN]  : 'a fresh run leaves this run\'s record on disk as history, nothing is deleted · a step whose result the host shows reads ok, the others ask again · press start a fresh run to start it'
});

/**
 * @summary The same lines for the door's Start block, naming the block's button instead of the chip.
 * @type {Object}
 */
export const BLOCK_CONFIRM_LINES = Object.freeze({
    'write again': 'a second row on the plane is possible · press Write again to write it',
    [FRESH_RUN]  : 'a fresh run leaves this run\'s record on disk as history, nothing is deleted · press Start a fresh run to start it'
});

/**
 * @summary The row's actions, from the step's data alone: none while it waits for another step, the
 * exits it names in the recipe's order, otherwise the one its kind and status decide. An empty list
 * means no chip (the exception-only rule).
 * @param {Object} step `{id, kind, status, waitsFor, exits}`
 * @returns {String[]}
 */
export function actionsFor({id, kind, status, waitsFor, exits}) {
    if (waitsFor) return [];

    if (Array.isArray(exits)) {
        return exits.map(exit => EXIT_VERBS[exit]).filter(Boolean)
    }

    if (kind === 'question') {
        if (status === 'ok') return [id === 'advanced' ? 'unfold' : 'change'];

        return [id === 'plane-credential' || id === 'provider-key' ? 'open window' : 'choose']
    }

    if (kind === 'effect') {
        return status === 'reconcile-required' ? ['re-check'] : status === 'ok' ? [] : ['run']
    }

    if (id === 'placement') return ['re-read'];
    if (id === 'served-plane' && status === 'failed') return ['which plane?'];
    if (id === 'done') return status === 'ok' ? ['open memories'] : status === 'failed' ? ['retry'] : [];

    return []
}

/**
 * @class AgentOS.view.setup.StepList
 * @extends Neo.list.Base
 *
 * @summary The recipe's step rows under one grammar — `[glyph] [status word] [id] [reason] [action]`:
 * the glyph and the word carry the status together, the reason is the recipe's text verbatim, the
 * action chip names the one request a click sends to main. The list renders the bound
 * {@link AgentOS.store.SetupSteps} and reads nothing else; a click on a row fires
 * `itemClick` with the record and the chip it landed on, and the owning door decides the request.
 */
class StepList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.setup.StepList'
         * @protected
         */
        className: 'AgentOS.view.setup.StepList',
        /**
         * @member {String} ntype='fm-setup-step-list'
         * @protected
         */
        ntype: 'fm-setup-step-list',
        /**
         * @member {String[]} baseCls=['fm-setup-steps','neo-list']
         */
        baseCls: ['fm-setup-steps', 'neo-list'],
        /**
         * The projection Store belongs to the Create door — this list never destroys it.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * The row whose `write again` can cost a second row and was pressed once; the second press sends it.
         * @member {String|null} confirmingId_=null
         * @reactive
         */
        confirmingId_: null,
        /**
         * The action pressed once on `confirmingId`'s row — `write again` or the card's fresh run — whose
         * line from {@link CONFIRM_LINES} the row then says. Set before `confirmingId`, whose change draws
         * the rows once; cleared with it.
         * @member {String|null} confirmingAction=null
         */
        confirmingAction: null,
        /**
         * The effect rows the door re-checked in this card that are still `reconcile-required`: each draws
         * the card's fresh-run exit as its quiet second chip. The door owns the set and sets it before it
         * projects the rows, so the projection's one redraw reads it.
         * @member {String[]|null} freshRunIds=null
         */
        freshRunIds: null,
        /**
         * Step rows are a glance surface with one action each, not a selection surface.
         * @member {Boolean} disableSelection=true
         * @reactive
         */
        disableSelection: true
    }

    /**
     * @summary The rows are drawn again, with or without the confirmation line.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetConfirmingId(value, oldValue) {
        oldValue !== undefined && this.store && this.createItems()
    }

    /**
     * @summary One list item per step record: the status class on the row, five cells inside.
     * @param {Object} record
     * @param {Number} index
     * @returns {Object|null}
     */
    createItem(record, index) {
        const item = super.createItem(record, index);

        item && item.cls.push(`is-${record.status ?? 'unknown'}`);

        return item
    }

    /**
     * @summary The five cells of a row. The action cell holds its chips (a second one is the quieter),
     * the step it waits for, or an invisible chip, so the column keeps its rhythm. The card's fresh-run
     * exit follows the row's own actions on a row the door named. The row pressed once for an action
     * that costs something adds a sixth cell: the line that says so.
     * @param {Object} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        const
            me      = this,
            mark    = STATUS_MARKS[record.status] ?? STATUS_MARKS.unknown,
            fresh   = record.status === 'reconcile-required' && Boolean(me.freshRunIds?.includes(record.id)),
            actions = [...actionsFor(record), ...(fresh ? [FRESH_RUN] : [])],
            chips   = record.waitsFor
                ? [{cls: ['fm-setup-step-wait'], text: `waits for ${record.waitsFor}`}]
                : actions.length > 0
                    ? actions.map((action, index) => ({cls: ['fm-setup-step-action', ...(index > 0 ? ['is-quiet'] : [])], text: action, 'data-action': action}))
                    : [{cls: ['fm-setup-step-action', 'is-none'], text: '—'}];

        return [
            {cls: ['fm-setup-step-glyph'],   text: mark.glyph, 'aria-hidden': 'true'},
            {cls: ['fm-setup-step-status'],  text: mark.word},
            {cls: ['fm-setup-step-id'],      text: record.id, title: record.summary ?? null},
            {cls: ['fm-setup-step-reason'],  text: record.reason ?? ''},
            {cls: ['fm-setup-step-actions'], cn: chips},
            ...(me.confirmingId === record.id ? [{cls: ['fm-setup-step-confirm'], role: 'status', text: CONFIRM_LINES[me.confirmingAction] ?? CONFIRM_LINES['write again']}] : [])
        ]
    }

    /**
     * @summary Fires `itemClick` with the record and the clicked chip's action; `null` beside the chips.
     * @param {Object} node The clicked list item
     * @param {Object} data The click event
     */
    onItemClick(node, data) {
        const me = this;

        me.fire('itemClick', {
            action: data.path.find(item => item.data?.action)?.data.action ?? null,
            record: me.store.get(me.getItemRecordId(node.id))
        })
    }
}

export default Neo.setupClass(StepList);
