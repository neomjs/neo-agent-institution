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
     * the step it waits for, or an invisible chip, so the column keeps its rhythm. The row pressed
     * once for a costly write adds a sixth: the line that says so.
     * @param {Object} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        const
            mark    = STATUS_MARKS[record.status] ?? STATUS_MARKS.unknown,
            actions = actionsFor(record),
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
            ...(this.confirmingId === record.id ? [{cls: ['fm-setup-step-confirm'], role: 'status', text: 'a second row on the plane is possible · press write again to write it'}] : [])
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
