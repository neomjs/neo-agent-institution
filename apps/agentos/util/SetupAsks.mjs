import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

const GiB = 1073741824;

/**
 * @summary The Create door's pure readings of one recipe evaluation: a preset's verdict, a run's
 * density, the recommendation sentence, and the three question blocks' states. Rows in, words out;
 * nothing here touches a view or a store's lifecycle, so the door and its tests read the same facts.
 * @class AgentOS.util.SetupAsks
 * @extends Neo.core.Base
 */
class SetupAsks extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.SetupAsks'
         * @protected
         */
        className: 'AgentOS.util.SetupAsks'
    }

    /**
     * @summary The CLI's own command, for a served cockpit without a vessel: the operator runs it on
     * the host and pastes its `--json` into the card, which projects it through the same list.
     * @member {String} CLI_COMMAND
     * @static
     */
    static CLI_COMMAND = 'node ai/scripts/setup/firstRun.mjs --json'

    /**
     * @summary The Start block's words for a row's action. The action sent is the chip's own verb, so
     * the block's button asks main for exactly what the row's chip under Details would.
     * @member {Object} START_VERBS
     * @static
     */
    static START_VERBS = Object.freeze({
        run                : 'Run next step',
        're-check'         : 'Check again',
        'write again'      : 'Write again',
        'start a fresh run': 'Start a fresh run',
        retry              : 'Try again',
        're-read'          : 'Read again',
        'which plane?'     : 'Which plane?',
        'open memories'    : 'Open memories'
    })

    /**
     * @summary Words a byte count as GiB with one decimal; a missing count reads as such.
     * @param {*} bytes
     * @returns {String}
     */
    static gibText(bytes) {
        return Number.isFinite(bytes) ? `${(bytes / GiB).toFixed(1)} GiB` : 'not measured'
    }

    /**
     * @summary A row's question-side word for one preset, from the placement step's verdicts: which
     * list the preset sits in and the recipe's reason for it.
     * @param {Object|null} placement The placement step's `{recommended, possible, refused}`
     * @param {String} presetId
     * @returns {{verdict: String, reason: String, margins: Object|null}} `margins` is the row's `{host, guest}`
     */
    static presetVerdict(placement, presetId) {
        for (const verdict of ['recommended', 'possible', 'refused']) {
            const row = placement?.[verdict]?.find(entry => entry.id === presetId);

            if (row) {
                return {verdict, reason: row.reason ?? '', margins: row.margins ?? null}
            }
        }

        return {verdict: 'unknown', reason: 'the placement step has not answered', margins: null}
    }

    /**
     * @summary The density of one completed run — the counting definition, not a measurement: a
     * decision is one answered question (a consent with an answer) or one consent to an effect (an
     * accepted receipt); a manual action is a step whose action was an operator instruction (an
     * effect the vessel could not run itself). Placement is defaulted, never decided, unless the
     * advanced fold was opened.
     * @param {Object|null} evaluation
     * @param {Number} [manualActions=0] The instructions the door handed the operator this session
     * @returns {{decisions: Number, manualActions: Number}}
     */
    static countDensity(evaluation, manualActions = 0) {
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
     * @summary The Where block's line from the placement's verdicts and the preset table: the
     * recommended preset in the recipe's words, or that nothing is and each choice says why. The card
     * adds the label; the verdict and its reason are the recipe's own, so the card recommends nothing
     * the recipe does not.
     * @param {Object|null} placement The placement step's `{recommended, possible, refused}`
     * @param {Object[]|null} presets The preset table
     * @returns {String}
     */
    static recommendationText(placement, presets) {
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
     * @summary The budgets line: both budgets as numbers with the pressure verdict.
     * @param {Object|null} probe
     * @returns {String}
     */
    static budgetText(probe) {
        if (!probe?.host) return 'not probed yet';

        const
            {guest, host} = probe,
            hostText      = `host ${SetupAsks.gibText(host.totalBytes)} total · ${SetupAsks.gibText(host.availableBytes)} available · pressure ${host.pressure ?? 'unknown'}`,
            guestText     = guest ? ` · VM ${SetupAsks.gibText(guest.capBytes)} cap · ${SetupAsks.gibText(guest.availableBytes)} available` : ' · no VM observed';

        return `${hostText}${guestText}`
    }

    /**
     * @summary The lede names a fresh or resumed run and its binding; a cold run keeps the door's words.
     * @param {Object|null} evaluation
     * @param {Object|null} freshRun
     * @param {String} coldLede
     * @returns {String}
     */
    static ledeText(evaluation, freshRun, coldLede) {
        if (evaluation?.runId && freshRun?.runId === evaluation.runId) {
            return `Fresh run ${evaluation.runId}${freshRun.retiredRunId ? ` — the run ${freshRun.retiredRunId} stays on disk as history` : ''}. Nothing was deleted; a step whose result the host shows reads ok, the others ask again.`
        }

        if (evaluation?.binding && evaluation.binding !== 'bound' && evaluation.binding !== 'no-record') {
            return `Resumed from the run record (${evaluation.runId ?? 'unknown run'}): ${evaluation.bindingReason ?? evaluation.binding}. Prior consents and receipts are history now; every step reads fresh.`
        }

        if (evaluation?.runId && evaluation.steps?.some(step => step.kind === 'effect' && step.receipt)) {
            return `Resumed from the run record (${evaluation.runId}, bound to ${evaluation.target?.planeId ?? 'this plane'} at ${evaluation.target?.dataRoot ?? 'its data root'}). An interrupted effect is never run again; a fresh observation that matches the plane settles it.`
        }

        return coldLede
    }

    /**
     * @summary Derives the Where block's projection from the store: recommendation vs chosen preset,
     * provider key requirement, and desktop-wake consent/toggle state.
     * @param {Neo.data.Store|null} store
     * @param {Object[]} [presets=[]]
     * @param {String|null} [reopened=null]
     * @returns {Object}
     */
    static describeWhere(store, presets = [], reopened = null) {
        const
            step           = id => store?.get(id) ?? null,
            preset         = step('preset'),
            key            = step('provider-key'),
            wake           = step('desktop-wake'),
            placement      = step('placement')?.placement ?? null,
            label          = id => presets?.find(row => row.id === id)?.label ?? id,
            chosen         = preset?.answer ?? null,
            recommended    = placement?.recommended?.[0] ?? null,
            keyNeeded      = Boolean(key) && key.status !== 'ok' && !key.waitsFor,
            wakeSupported  = Boolean(wake) && wake.capability?.supported !== false,
            wakeNeeded     = Boolean(chosen) && !keyNeeded && Boolean(wake) && wake.status !== 'ok' && !wake.waitsFor,
            wakeFlipAnswer = reopened === 'where' && !wakeNeeded && wakeSupported && wake?.status === 'ok'
                ? (wake.answer === 'declined' ? 'enabled' : wake.answer === 'enabled' ? 'declined' : null)
                : null,
            keySuffix      = keyNeeded ? ' · needs a provider key' : key?.status === 'ok' && key.answer ? ' · provider key kept' : '',
            wakeSuffix     = wakeNeeded ? ' · needs a desktop wake choice' : wake?.answer === 'enabled' ? ' · desktop wakes enabled' : wake?.answer === 'declined' ? ' · without desktop wakes' : '';

        return {
            chosen,
            keyNeeded,
            keyText          : keyNeeded ? `This preset needs a provider key — ${key.reason ?? 'unanswered'}` : '',
            line             : chosen ? `This machine, ${label(chosen)}${keySuffix}${wakeSuffix}` : SetupAsks.recommendationText(placement, presets),
            placement,
            recommended,
            useHidden        : !recommended || chosen === recommended.id,
            useText          : recommended ? `Use ${label(recommended.id)}` : 'Use this',
            wakeDeclineHidden: !(wakeNeeded || wakeFlipAnswer === 'declined'),
            wakeEnableHidden : !(wakeNeeded || wakeFlipAnswer === 'enabled'),
            wakeNeeded,
            wakeText         : wakeNeeded ? `Desktop wakes — ${wake.reason ?? 'unanswered'}` : ''
        }
    }

    /**
     * @summary Derives the Token block's display line from the `plane-credential` step.
     * @param {Object|null} credential
     * @returns {String}
     */
    static tokenLine(credential) {
        return credential?.status === 'ok'
            ? `consented · ${credential.answer ?? 'a kept file'}${credential.consentedAt ? ` · ${credential.consentedAt}` : ''}`
            : 'One token. It lets your agents read and write your repositories, and it signs you in here.'
    }

    /**
     * @summary Derives the Start block's line, help text, and primary button label from the current step state.
     * @param {Object} options
     * @returns {{buttonText: String, help: String, line: String}}
     */
    static describeStart({action = null, confirmLines = {}, confirming = false, confirmingAction = null, done = null, progress, start, startRow}) {
        const
            line = done?.status === 'ok'
                ? 'Your institution is running. Add your first agent.'
                : startRow
                    ? `${startRow.summary ?? startRow.id} · ${progress.ok} of ${progress.total}`
                    : start === 'open'
                        ? `${progress.ok} of ${progress.total} — waiting for the plane`
                        : 'Two answers, then one action at a time.',
            help = startRow
                ? confirming
                    ? confirmLines[confirmingAction] ?? confirmLines['write again']
                    : `${startRow.status} · ${startRow.reason ?? ''}`
                : '';

        return {
            buttonText: SetupAsks.START_VERBS[action] ?? action ?? 'Run next step',
            help,
            line
        }
    }

    /**
     * @summary Derives the quiet first-persistence confirmation banner state from the `done` and `preset` rows.
     * @param {Neo.data.Store|null} store
     * @param {Object[]|null} presets
     * @returns {{finished: Boolean, text: String}}
     */
    static describeQuiet(store, presets) {
        const
            done     = store?.get('done'),
            preset   = store?.get('preset'),
            table    = presets?.find(row => row.id === preset?.answer),
            finished = done?.status === 'ok';

        return {
            finished,
            text: finished ? `${done.reason}${table ? ` · ${table.id} · ${table.vectorDimension}-dim` : ''} · the set-up card stays in the rail` : ''
        }
    }

    /**
     * @summary Builds the leaf-complete `setupProgress` and `setupRun` state-provider payload.
     * @param {Neo.data.Store} store
     * @param {Object|null} evaluation
     * @param {Number} manualActions
     * @returns {{setupProgress: Object, setupRun: Object}}
     */
    static describePublishedRun(store, evaluation, manualActions) {
        const density = SetupAsks.countDensity(evaluation, manualActions);

        return {
            setupProgress: store.describeProgress(),
            setupRun     : {
                dataRoot     : evaluation?.target?.dataRoot ?? null,
                decisions    : evaluation ? density.decisions : null,
                manualActions: evaluation ? density.manualActions : null,
                planeId      : evaluation?.target?.planeId ?? null,
                preset       : store.get('preset')?.answer ?? null,
                recipeVersion: evaluation?.recipeVersion ?? null,
                runId        : evaluation?.runId ?? null
            }
        }
    }

    /**
     * @summary The three question blocks' states, from the rows alone: **token** is the plane
     * credential, **where** the preset with its provider key and desktop-wake consent when required,
     * **start** the first row that is not ok and waits for nothing. The blocks read in order — the
     * first one not answered is open, the ones before it answered, the ones after it next — and
     * `reopened` names an answered block the operator opened again with Change: it becomes the one
     * open block, and the blocks after it read next until it settles, so one progression is active at a time.
     * @param {Neo.data.Store|null} store The door's projection store
     * @param {String|null} [reopened=null] `token` | `where`
     * @returns {{token: String, where: String, start: String, startRow: Object|null}} Each state is
     * `open` · `answered` · `next`; `startRow` is the Start block's row, `null` while the questions
     * are not done, while a question is being edited, or once nothing is left to run
     */
    static describeAsks(store, reopened = null) {
        const
            step       = id => store?.get(id) ?? null,
            credential = step('plane-credential'),
            preset     = step('preset'),
            key        = step('provider-key'),
            wake       = step('desktop-wake'),
            keyDone    = !key || key.status === 'ok' || Boolean(key.waitsFor),
            wakeDone   = !wake || wake.status === 'ok' || Boolean(wake.waitsFor),
            answered   = {token: credential?.status === 'ok', where: preset?.status === 'ok' && keyDone && wakeDone},
            order      = ['token', 'where', 'start'],
            normal     = order.indexOf(order.find(id => id === 'start' || !answered[id])),
            reopenedAt = order.indexOf(reopened),
            firstOpen  = reopenedAt > -1 && reopenedAt < normal ? reopenedAt : normal,
            states     = {};

        order.forEach((id, index) => {
            states[id] = index < firstOpen ? 'answered' : index === firstOpen ? 'open' : 'next'
        });

        // the Start block's row: not ok, waits for nothing, and not a question the blocks above own
        states.startRow = states.start === 'open'
            ? (store?.items ?? []).find(row => row.status !== 'ok' && !row.waitsFor && row.kind !== 'question') ?? null
            : null;

        return states
    }
}

export default Neo.setupClass(SetupAsks);
