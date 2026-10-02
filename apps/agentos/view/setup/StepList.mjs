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
 * @summary The row's one action, decided by the step's kind and status: a question is answered or
 * changed, an effect is run or re-checked, an observation re-read. The served-plane mismatch asks
 * its own question; the provider key is asked only once the consented preset requires it (until
 * then the row is the sentence it carries). `null` means no action and no chip (the exception-only
 * rule).
 * @param {Object} step `{id, kind, status, reason}`
 * @returns {String|null}
 */
export function actionFor({id, kind, status, reason}) {
    if (kind === 'question') {
        if (status === 'ok') return id === 'advanced' ? 'unfold' : 'change';
        if (id === 'provider-key') return typeof reason === 'string' && reason.startsWith('unanswered') ? 'open window' : null;

        return id === 'plane-credential' ? 'open window' : 'choose'
    }

    if (kind === 'effect') {
        return status === 'reconcile-required' ? 're-check' : status === 'ok' ? null : 'run'
    }

    if (id === 'placement') return 're-read';
    if (id === 'served-plane' && status === 'failed') return 'which plane?';
    if (id === 'done') return status === 'ok' ? 'open memories' : status === 'failed' ? 'retry' : null;

    return null
}

/**
 * @class AgentOS.view.setup.StepList
 * @extends Neo.list.Base
 *
 * @summary The recipe's step rows under one grammar — `[glyph] [status word] [id] [reason] [action]`:
 * the glyph and the word carry the status together, the reason is the recipe's text verbatim, the
 * action chip names the one request a click sends to main. The list renders the bound
 * {@link AgentOS.store.SetupSteps} and reads nothing else; a click on a row fires the base
 * `itemClick` with the record, and the owning door decides the request.
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
         * Step rows are a glance surface with one action each, not a selection surface.
         * @member {Boolean} disableSelection=true
         * @reactive
         */
        disableSelection: true
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
     * @summary The five cells of a row. A row without an action keeps an invisible chip, so the
     * column keeps its rhythm.
     * @param {Object} record
     * @returns {Object[]}
     */
    createItemContent(record) {
        const
            mark   = STATUS_MARKS[record.status] ?? STATUS_MARKS.unknown,
            action = actionFor(record);

        return [
            {cls: ['fm-setup-step-glyph'],  text: mark.glyph, 'aria-hidden': 'true'},
            {cls: ['fm-setup-step-status'], text: mark.word},
            {cls: ['fm-setup-step-id'],     text: record.id, title: record.summary ?? null},
            {cls: ['fm-setup-step-reason'], text: record.reason ?? ''},
            {cls: ['fm-setup-step-action', ...(action ? [] : ['is-none'])], text: action ?? '—', 'data-action': action ?? null}
        ]
    }
}

export default Neo.setupClass(StepList);
