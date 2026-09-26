/**
 * @module harness/adapterWitness
 * @summary The cockpit adapter-state contract and the shell's final-verdict arithmetic, extracted so
 * both halves are unit-testable without booting Electron.
 *
 * ## Why this is its own module
 *
 * The verdict lived inside `main.mjs`, which exports nothing and only runs under Electron — so the
 * shell's half of the witness had **no coverage at all**, while the preload observer had plenty. A
 * review proved the gap by asking for the one mutation that matters: force `isAdapterRenderCoherent()`
 * true and the suite must go red. It could not, because nothing imported it. An untested verdict is the
 * worst place for a gap, since the verdict is what the release gate actually reads.
 *
 * ## Exactly one state, or `unknown`
 *
 * A head advertising two known states (`is-live is-cold`) is **ambiguous, not live**. First-match
 * resolution silently preferred whichever state happened to be earlier in the list and reported a
 * confident answer about a contradictory DOM. Ambiguity now yields `unknown`, which is not ready and
 * not conclusive — the same fail-closed direction as an unrecognised state.
 *
 * ## The labels belong to the components that render them
 *
 * `FleetGrid` renders `adapterState === 'stale' ? … : adapterState === 'cold' ? … : ''`, and
 * `ActivityStream` renders `{cold, stale}[state] ?? '● streaming'`. These maps mirror that, so the
 * witness checks state-vs-label **agreement** rather than pinning one expected state — pinning made the
 * smoke assert the product was unfinished, and it would have gone red the moment the cockpit worked.
 *
 * ## The roster's answer, not a count of seeded cards
 *
 * Nothing is seeded any more: a cold roster renders no cards and no CTA, a live empty answer renders
 * the "Add your first agent" CTA, a live populated answer renders cards. The first-paint receipt
 * accepts any of the three as a paint; the PRODUCT witness needs the plane's answer — cards or the
 * CTA (`emptyCta`) — because a count of zero over a cold head is silence, not an empty fleet.
 */

/**
 * Adapter states a cockpit head can render, as `is-<state>` classes.
 * @type {String[]}
 */
export const ADAPTER_STATES = Object.freeze(['live', 'cold', 'stale', 'degraded']);

/**
 * The label each roster state renders, mirrored from `FleetGrid`.
 * @type {Object}
 */
export const ROSTER_STATE_LABELS = Object.freeze({
    live: '', cold: 'not answered yet', stale: 'stale — reconnecting', degraded: ''
});

/**
 * The label each stream state renders, mirrored from `ActivityStream`.
 * @type {Object}
 */
export const STREAM_STATE_LABELS = Object.freeze({
    live: '● streaming', cold: 'not answered yet', stale: 'stale — reconnecting', degraded: '● streaming'
});

/**
 * Values the preload may report for an adapter state, including the two non-states.
 *
 * `unknown` is admitted through the payload allowlist on purpose so it reaches the coherence check and
 * fails there with a named state, rather than being rejected as a malformed payload: an upstream state
 * nobody mapped should read as "unverified", not as "the renderer sent garbage".
 * @type {String[]}
 */
export const ADAPTER_STATE_NAMES = Object.freeze([...ADAPTER_STATES, 'unknown']);

/**
 * How long (ms) the shell waits for the cockpit's next roster read after a popup closes. The cockpit
 * reads its roster on its own cadence and launches a due read on its next pass
 * ({@link AgentOS.util.LivenessCadence}), so the next App-Worker crossing can be one roster interval
 * plus one pass away; the rest is margin. The shell cannot import the cockpit's classes, so the
 * cadence spec fails when that sum outgrows this window.
 * @type {Number}
 */
export const ROSTER_CROSSING_WINDOW_MS = 80000;

/**
 * @summary Resolves the single state a class list advertises, or `unknown` when it is absent or ambiguous.
 *
 * Shared by the preload observer's logic and the shell's assertions so the two cannot drift on what
 * counts as a state. Takes a predicate rather than a DOM node so it is callable from either world.
 * @param {Function} hasClass `className => Boolean`
 * @returns {String} one of {@link ADAPTER_STATES}, or `'unknown'`
 */
export function resolveAdapterState(hasClass) {
    const matched = ADAPTER_STATES.filter(state => hasClass(`is-${state}`));

    // EXACTLY one. Two known classes is a contradictory DOM, and first-match resolution would report a
    // confident answer about it — preferring whichever state sat earlier in the list.
    return matched.length === 1 ? matched[0] : 'unknown';
}

/**
 * @summary True when a head renders a recognised state AND a label that agrees with it.
 *
 * Deliberately state-AGNOSTIC: pinning one expected label made the smoke assert the cockpit was still
 * cold, so wiring it to the live fleet would have turned the witness red. Agreement keeps the
 * guard real — a `live` head showing the cold label is still a defect — while letting any honest
 * state pass.
 *
 * `unknown` fails closed, which now covers ambiguity as well as unmapped states.
 * @param {String|null} state Observed `is-<state>`, `'unknown'`, or `null` when the head is absent.
 * @param {String|null} label Observed label text.
 * @param {Object} expectedLabels state → canonical label.
 * @returns {Boolean}
 */
export function isAdapterRenderCoherent(state, label, expectedLabels) {
    // Head absent ⇒ the cockpit did not render it; distinct from any rendered state, and not a pass.
    if (!state || !Object.hasOwn(expectedLabels, state)) return false;

    const expected = expectedLabels[state];

    // An empty canonical label may render as an empty node or none at all; both are honest.
    return expected === '' ? (label === '' || label === null) : label === expected;
}

/**
 * @summary Computes the shell's final first-paint verdict from a sanitised preload report.
 *
 * Returns the unmet conjuncts alongside the booleans, because a bare `productWitnessPassed: false` on a
 * completely healthy boot invited exactly the wrong conclusion — it is normally just `packagedMode`,
 * since no npm script runs the packaged app.
 * @param {Object}  spec
 * @param {Object}  spec.firstPaint    Sanitised report: `{cockpitVisible, cardCount, emptyCta, rosterState, rosterLabel, streamState, activityLabel, firstPaintMs, timedOut, tourControlCount}`.
 * @param {Boolean} spec.packagedMode
 * @param {Boolean} spec.brainMode
 * @param {Boolean} [spec.brainUp]
 * @param {Number}  [spec.firstPaintBudgetMs=60000]
 * @returns {Object} `{adaptersCoherent, firstPaintPassed, productWitnessPassed, productWitnessUnmet}`
 */
export function computeFirstPaintVerdict({firstPaint, packagedMode, brainMode, brainUp, firstPaintBudgetMs = 60000} = {}) {
    const adaptersCoherent = isAdapterRenderCoherent(firstPaint.rosterState, firstPaint.rosterLabel, ROSTER_STATE_LABELS) &&
              isAdapterRenderCoherent(firstPaint.streamState, firstPaint.activityLabel, STREAM_STATE_LABELS),
          // the roster ANSWERED: real cards, or the empty CTA a live empty answer renders. Nothing is
          // seeded any more, so a count of cards can only ever be the fleet's own.
          rosterAnswered   = firstPaint.cardCount > 0 || firstPaint.emptyCta === true,
          // a first paint is honest in ANY recognised state: cold is what the plain smoke (no plane)
          // paints, and it is a paint — the PRODUCT witness below is the one that needs an answer
          firstPaintPassed = firstPaint.cockpitVisible === true &&
              (rosterAnswered || firstPaint.rosterState === 'cold') &&
              adaptersCoherent &&
              firstPaint.firstPaintMs !== null &&
              firstPaint.firstPaintMs <= firstPaintBudgetMs &&
              firstPaint.timedOut === false,
          productWitnessUnmet = [
              !packagedMode                    && 'packagedMode (run the packaged app, not `npm run smoke`)',
              !brainMode                       && 'brainMode (use `npm run smoke:brain`)',
              brainMode && brainUp !== true    && 'brainUp',
              !firstPaintPassed                && 'firstPaint',
              !adaptersCoherent                && 'adapterRenderCoherent',
              !rosterAnswered                  && 'rosterAnswered (no cards and no empty CTA — the plane never answered the roster)'
          ].filter(Boolean);

    return {
        adaptersCoherent,
        firstPaintPassed,
        productWitnessPassed: Boolean(packagedMode && brainMode && brainUp === true && firstPaintPassed && rosterAnswered),
        productWitnessUnmet,
        rosterAnswered
    };
}
