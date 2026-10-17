import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * The Repository pane's word for each row state. `prepared` stands for the producer's `installed` and
 * `present`; every other state keeps its own word, so a skipped, canceled or unverified checkout never
 * reads as prepared.
 * @type {Readonly<Object<String, String>>}
 */
const LABELS = Object.freeze({
    canceled        : 'Canceled',
    failed          : 'Failed',
    installing      : 'Installing',
    'not-applicable': 'No preparation step',
    prepared        : 'Prepared',
    skipped         : 'Skipped',
    unverified      : 'Unverified'
});

/**
 * The working checkout's final states that leave a running seat without verified skills. `not-applicable`
 * has no step that could fail, and `installing` belongs to a Start that is still pending.
 * @type {Set<String>}
 */
const UNPREPARED = new Set(['canceled', 'failed', 'skipped', 'unverified']);

/**
 * @summary What a Fleet Start reports about each checkout's dependencies, worded once for the card, for
 * Agent Detail's Repository pane and for the Accounts Repositories card. The fact is the roster row's
 * `dependencyOutcomes`: `[{repoSlug, state, reason?}]` from the latest Start that reached its install,
 * live while that Start is pending and final after it. `null` means no Start has reported any, which is
 * unknown, never ready.
 *
 * Only the working checkout speaks on the card, and only when the last start did not prepare it, since the
 * seat's skills come from that checkout. Every checkout keeps its own row in the panes, so a failure in
 * another repository stays its own and never reads as the working checkout's.
 * @class AgentOS.util.SeatDependencies
 * @extends Neo.core.Base
 */
class SeatDependencies extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.SeatDependencies'
         * @protected
         */
        className: 'AgentOS.util.SeatDependencies'
    }

    /**
     * @summary Whether a live Start's cancel is still open: `sent` while its Stop is in flight, and `unanswered`
     * once the cockpit's own deadline passed without the Fleet's answer, which can still settle it. Either way
     * the Start reads as canceling, never as plain preparation.
     * @param {Object} record The roster record, or a bag of its `controlReason`, `dependencyOutcomes` and
     * `pendingAction`.
     * @returns {'sent'|'unanswered'|null} `null` without a live preparation or without a cancel.
     */
    static cancelState({controlReason, dependencyOutcomes, pendingAction}) {
        if (!SeatDependencies.liveLine(dependencyOutcomes)) return null;

        if (pendingAction === 'stop') return 'sent';

        return controlReason?.action === 'stop' && controlReason.kind === 'timeout' ? 'unanswered' : null
    }

    /**
     * @summary The card's line for a running seat whose working checkout the last start did not prepare,
     * and its title.
     * @param {Object[]|null} dependencyOutcomes
     * @param {String|null} repoSlug The seat's working repository.
     * @returns {{text: String, title: String}|null} `null` when there is nothing to say: prepared, no
     * preparation step, still installing, or no row for the working repository.
     */
    static cardLine(dependencyOutcomes, repoSlug) {
        const row = Array.isArray(dependencyOutcomes) && repoSlug ? dependencyOutcomes.find(entry => entry?.repoSlug === repoSlug) : null;

        return UNPREPARED.has(row?.state) ? {
            text : 'skills not verified',
            title: `Skills not verified. The working checkout ${repoSlug} reads ${LABELS[row.state]} after the last start${row.reason ? ` (${row.reason})` : ''}. Detail › Repositories shows each checkout.`
        } : null
    }

    /**
     * @summary The panes' rows for one seat: each checkout the latest start reported, in its order (the
     * working checkout first), then each repository known only from its clone, all folded by {@link #paneRow}.
     * A state the panes have no word for is left out, as unknown. The Fleet records a start's clones only once
     * it launches, so while a Start installs every clone outcome is the previous launch's, and the rows list
     * this start's checkouts alone.
     * @param {Object[]|null} dependencyOutcomes The roster row's `dependencyOutcomes`.
     * @param {Object[]|null} repoOutcomes The roster row's `repoOutcomes`.
     * @returns {{reason: String|null, repoSlug: String, state: String}[]}
     */
    static checkouts(dependencyOutcomes, repoOutcomes) {
        const
            bySlug       = rows => new Map((Array.isArray(rows) ? rows : []).filter(row => row?.repoSlug).map(row => [row.repoSlug, row])),
            dependencies = bySlug(dependencyOutcomes),
            clones       = SeatDependencies.liveLine(dependencyOutcomes) ? new Map() : bySlug(repoOutcomes);

        return [...new Set([...dependencies.keys(), ...clones.keys()])]
            .map(repoSlug => ({repoSlug, ...SeatDependencies.paneRow(clones.get(repoSlug), dependencies.get(repoSlug))}))
            .filter(row => LABELS[row.state])
    }

    /**
     * @summary The live preparation of a Start still pending: how many of the reported checkouts are done,
     * and each live row for the title. `installing` appears only while that Start is pending, since the
     * Fleet retires every undecided row when it ends, so a retained set never reads as live. The count is
     * over the rows reported so far; an install not yet begun has no row.
     * @param {Object[]|null} dependencyOutcomes
     * @returns {{done: Number, text: String, title: String, total: Number}|null} `null` while nothing installs.
     */
    static liveLine(dependencyOutcomes) {
        const rows = Array.isArray(dependencyOutcomes) ? dependencyOutcomes.filter(row => row?.repoSlug && row.state) : [];

        if (!rows.some(row => row.state === 'installing')) return null;

        const done = rows.filter(row => row.state !== 'installing').length;

        return {
            done,
            text : `preparing dependencies (${done}/${rows.length} done)`,
            title: rows.map(({repoSlug, state}) => `${repoSlug}: ${(LABELS[SeatDependencies.paneRow(null, {state}).state] ?? state).toLowerCase()}`).join(' · '),
            total: rows.length
        }
    }

    /**
     * @summary The panes' word for a row state.
     * @param {String|null} state A {@link #paneRow} state.
     * @returns {String|null} `null` for no state, or one the panes do not know.
     */
    static label(state) {
        return LABELS[state] ?? null
    }

    /**
     * @summary One Repository pane row's state and reason. The checkout's dependency row speaks when there is
     * one, with `installed` and `present` as `prepared`: the Fleet writes it before the launch and records the
     * clones after, so it is never older than the clone, and its start held a checkout of that repository. Without one,
     * a failed clone reads `failed`, and a prepared clone `unverified`, since no install was reported for it.
     * @param {Object|null} [clone] The repository's `repoOutcomes` row: `{state: 'prepared'|'failed', reason?}`.
     * @param {Object|null} [dependency] Its `dependencyOutcomes` row: `{state, reason?}`.
     * @returns {{reason: String|null, state: String|null}}
     */
    static paneRow(clone, dependency) {
        if (dependency?.state) {
            return {
                reason: dependency.reason ?? null,
                state : dependency.state === 'installed' || dependency.state === 'present' ? 'prepared' : dependency.state
            }
        }

        return clone?.state === 'prepared'
            ? {reason: 'no dependency install reported', state: 'unverified'}
            : {reason: clone?.reason ?? null, state: clone?.state ?? null}
    }
}

export default Neo.setupClass(SeatDependencies);
