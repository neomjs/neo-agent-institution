import AgentFreshness from './AgentFreshness.mjs';
import Base           from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary The words for each kind of held pull request, worst first. The order IS the rank.
 * @type {Object}
 */
const KIND_WORDS = Object.freeze({
    'red'              : 'red',
    'changes-requested': 'changes requested',
    'review-due'       : 'review due'
});

/**
 * @summary The kinds in rank order, worst first.
 * @type {String[]}
 */
const KIND_RANK = Object.freeze(Object.keys(KIND_WORDS));

/**
 * @summary One seat's share of the fleet's open work, as its roster card shows it: the pull requests whose
 * next action the seat holds, counted, with the worst of them named.
 *
 * The Brain's open-work producer decides who holds each PR (`holder`); this module only reads that verdict.
 * A row counts for a seat when its holder is the author or a requested reviewer AND the holder's ids name
 * the seat. Rows held by the operator, the rotation, nobody, or an unknown holder put nothing on a card:
 * the operator's queue is the fleet head's awaiting-merge button, and an unknown holder is nobody's to act
 * on yet.
 *
 * Worst first: a red head (the author's) outranks a change request (the author's), which outranks a
 * review due (a requested reviewer's).
 *
 * The chip keeps the open-lane badge's rule: nothing held is no chip, never "0 PRs", and an unanswered or
 * unavailable read is no chip either. Unknown never poses as zero.
 * @class AgentOS.util.OpenWorkSeat
 * @extends Neo.core.Base
 */
class OpenWorkSeat extends Base {
    static KIND_RANK  = KIND_RANK
    static KIND_WORDS = KIND_WORDS

    static config = {
        /**
         * @member {String} className='AgentOS.util.OpenWorkSeat'
         * @protected
         */
        className: 'AgentOS.util.OpenWorkSeat'
    }

    /**
     * @summary The kind of one open-work row for one seat, or `null` when the seat does not hold it.
     * @param {Object} row          One `fleetOpenWork` row summary (`{ci, holder: {role, ids}, ...}`).
     * @param {String} seatIdentity The seat's identity, e.g. `@neo-opus-ada`.
     * @returns {String|null} `red`, `changes-requested`, `review-due` or `null`.
     */
    static kindOf(row, seatIdentity) {
        const {role, ids} = row?.holder ?? {};

        if (!Array.isArray(ids) || !ids.includes(seatIdentity)) return null;

        if (role === 'author')   return row.ci === 'red' ? 'red' : 'changes-requested';
        if (role === 'reviewer') return 'review-due';

        return null
    }

    /**
     * @summary The seat's held open work, or `null` when it holds none or the read cannot say.
     * @param {Object|null} snapshot     One `fleetOpenWork` envelope, or `null` while unanswered.
     * @param {String|null} seatIdentity The seat's identity, e.g. `@neo-opus-ada`.
     * @returns {{count: Number, worst: String, stale: Boolean, observedAt: String|null}|null}
     */
    static summarize(snapshot, seatIdentity) {
        const lists = seatIdentity && snapshot?.state !== 'unavailable' ? snapshot?.seats?.[seatIdentity] : null;

        if (!lists) return null;

        const held = new Map();

        [...(lists.authored ?? []), ...(lists.reviewing ?? [])].forEach(row => {
            const kind = OpenWorkSeat.kindOf(row, seatIdentity);

            kind && held.set(`${row.repo}#${row.number}`, {kind, stale: row.stale === true})
        });

        if (held.size === 0) return null;

        const rows = [...held.values()];

        return {
            count     : rows.length,
            worst     : KIND_RANK.find(kind => rows.some(row => row.kind === kind)),
            stale     : snapshot.state === 'stale' || rows.some(row => row.stale),
            observedAt: snapshot.observedAt ?? null
        }
    }

    /**
     * @summary The card chip for one seat's held open work: its words, its accessible name and its title,
     * as one unit, so the visible text and the spoken one cannot diverge.
     * @param {Object|null} openWork One {@link #summarize} result, or `null`.
     * @param {Number} [now=Date.now()] The viewer's clock, for a stale chip's age.
     * @returns {{hidden: Boolean, stale: Boolean, text: String, ariaLabel: String|null, title: String|null}}
     */
    static describe(openWork, now = Date.now()) {
        if (!openWork) {
            return {hidden: true, stale: false, text: '', ariaLabel: null, title: null}
        }

        const
            {count, observedAt, stale, worst} = openWork,
            word  = KIND_WORDS[worst],
            prs   = count === 1 ? 'pull request' : 'pull requests',
            ageMs = stale && observedAt ? now - Date.parse(observedAt) : NaN,
            age   = Number.isFinite(ageMs) ? ` · observed ${AgentFreshness.formatAge(ageMs)}` : '';

        return {
            hidden   : false,
            stale,
            text     : `${count} ${count === 1 ? 'PR' : 'PRs'} · ${word}`,
            ariaLabel: `Open work: ${count} ${prs} waiting on this seat, worst ${word}${stale ? ', stale' : ''}.`,
            title    : `${count} ${prs} waiting on this seat · worst: ${word}${stale ? ' · stale' : ''}${age}`
        }
    }
}

export default Neo.setupClass(OpenWorkSeat);
