/**
 * @module AgentOS.util.setupAsks
 * @summary The Create door's pure readings of one recipe evaluation: a preset's verdict, a run's
 * density, the recommendation sentence, and the three question blocks' states. Rows in, words out;
 * nothing here touches a view or a store's lifecycle, so the door and its tests read the same facts.
 */

const GiB = 1073741824;

/**
 * @summary Words a byte count as GiB with one decimal; a missing count reads as such.
 * @param {*} bytes
 * @returns {String}
 */
export const gibText = bytes => Number.isFinite(bytes) ? `${(bytes / GiB).toFixed(1)} GiB` : 'not measured';

/**
 * @summary The CLI's own command, for a served cockpit without a vessel: the operator runs it on the
 * host and pastes its `--json` into the card, which projects it through the same list.
 * @type {String}
 */
export const CLI_COMMAND = 'node ai/scripts/setup/firstRun.mjs --json';

/**
 * @summary The Start block's words for a row's action. The action sent is the chip's own verb, so the
 * block's button asks main for exactly what the row's chip under Details would.
 * @type {Object}
 */
export const START_VERBS = Object.freeze({
    run            : 'Run next step',
    're-check'     : 'Check again',
    'write again'  : 'Write again',
    retry          : 'Try again',
    're-read'      : 'Read again',
    'which plane?' : 'Which plane?',
    'open memories': 'Open memories'
});

/**
 * @summary A row's question-side word for one preset, from the placement step's verdicts: which
 * list the preset sits in and the recipe's reason for it.
 * @param {Object|null} placement The placement step's `{recommended, possible, refused}`
 * @param {String} presetId
 * @returns {{verdict: String, reason: String, margins: Object|null}} `margins` is the row's `{host, guest}`
 */
export function presetVerdict(placement, presetId) {
    for (const verdict of ['recommended', 'possible', 'refused']) {
        const row = placement?.[verdict]?.find(entry => entry.id === presetId);

        if (row) {
            return {verdict, reason: row.reason ?? '', margins: row.margins ?? null}
        }
    }

    return {verdict: 'unknown', reason: 'the placement step has not answered', margins: null}
}

/**
 * @summary The density of one completed run — the counting definition, not a measurement: a decision
 * is one answered question (a consent with an answer) or one consent to an effect (an accepted
 * receipt); a manual action is a step whose action was an operator instruction (an effect the
 * vessel could not run itself). Placement is defaulted, never decided, unless the advanced fold
 * was opened.
 * @param {Object|null} evaluation
 * @param {Number} manualActions The instructions the door handed the operator this session
 * @returns {{decisions: Number, manualActions: Number}}
 */
export function countDensity(evaluation, manualActions = 0) {
    const steps = evaluation?.steps ?? [];

    return {
        decisions: steps.filter(step =>
            (step.kind === 'question' && step.status === 'ok' && step.answer !== null && step.answer !== undefined) ||
            (step.kind === 'effect' && step.receipt === 'accepted')
        ).length,
        manualActions
    }
}

/**
 * @summary The Where block's line from the placement's verdicts and the preset table: the recommended
 * preset in the recipe's words, or that nothing is and each choice says why. The card adds the
 * label; the verdict and its reason are the recipe's own, so the card recommends nothing the recipe
 * does not.
 * @param {Object|null} placement The placement step's `{recommended, possible, refused}`
 * @param {Object[]|null} presets The preset table
 * @returns {String}
 */
export function recommendationText(placement, presets) {
    if (!placement) return 'Measuring this machine…';

    const
        label       = id => presets?.find(row => row.id === id)?.label ?? id,
        recommended = placement.recommended?.[0],
        possible    = placement.possible?.[0];

    if (recommended) return `This machine, ${label(recommended.id)} — ${recommended.reason}`;

    return possible
        ? `Nothing fits this machine outright; ${label(possible.id)} is possible — ${possible.reason}. Choose under Other choices.`
        : 'Nothing fits this machine yet — each choice says why under Other choices.'
}

/**
 * @summary The three question blocks' states, from the rows alone: **token** is the plane credential,
 * **where** the preset with its provider key when the preset needs one, **start** the first row that
 * is not ok and waits for nothing. The blocks read in order — the first one not answered is open,
 * the ones before it answered, the ones after it next — and `reopened` names an answered block the
 * operator opened again with Change.
 * @param {Neo.data.Store|null} store The door's projection store
 * @param {String|null} [reopened=null] `token` | `where`
 * @returns {{token: String, where: String, start: String, startRow: Object|null}} Each state is
 * `open` · `answered` · `next`; `startRow` is the Start block's row, `null` while the questions are
 * not done or once nothing is left to run
 */
export function describeAsks(store, reopened = null) {
    const
        step       = id => store?.get(id) ?? null,
        credential = step('plane-credential'),
        preset     = step('preset'),
        key        = step('provider-key'),
        keyDone    = !key || key.status === 'ok' || Boolean(key.waitsFor),
        answered   = {token: credential?.status === 'ok', where: preset?.status === 'ok' && keyDone},
        order      = ['token', 'where', 'start'],
        firstOpen  = order.indexOf(order.find(id => id === 'start' || !answered[id])),
        states     = {};

    order.forEach((id, index) => {
        states[id] = reopened === id ? 'open' : index < firstOpen ? 'answered' : index === firstOpen ? 'open' : 'next'
    });

    // the Start block's row: not ok, waits for nothing, and not a question the blocks above own
    states.startRow = states.start === 'open'
        ? (store?.items ?? []).find(row => row.status !== 'ok' && !row.waitsFor && row.kind !== 'question') ?? null
        : null;

    return states
}
