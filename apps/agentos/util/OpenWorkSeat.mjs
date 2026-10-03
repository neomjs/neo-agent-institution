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
 * @summary The Agent Detail pane's two sentences without rows: the read answered and the seat holds
 * nothing, or the read has not answered.
 * @type {Object}
 */
const PANE_WORDS = Object.freeze({
    none      : 'no pull request waits on this seat',
    unanswered: 'open-work read unanswered'
});

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
 * unavailable read is no chip either. Unknown never poses as zero. The Agent Detail lists the same rows
 * ({@link #held}, {@link #describeRow}) and tells nothing held from an unanswered read in words.
 * @class AgentOS.util.OpenWorkSeat
 * @extends Neo.core.Base
 */
class OpenWorkSeat extends Base {
    static KIND_RANK  = KIND_RANK
    static KIND_WORDS = KIND_WORDS
    static PANE_WORDS = PANE_WORDS

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
     * @summary The pull requests whose next action the seat holds, worst first, or `null` when the read
     * has not answered for it (unanswered, unavailable, or no seat identity). An answer that names no
     * row for the seat holds nothing: `rows` is empty. Its `observedAt` is the oldest observation among
     * the held rows, the envelope's own when no row carries one, so a surface that is stale because of
     * one row ages from that row.
     * @param {Object|null} snapshot     One `fleetOpenWork` envelope, or `null` while unanswered.
     * @param {String|null} seatIdentity The seat's identity, e.g. `@neo-opus-ada`.
     * @returns {{rows: Object[], stale: Boolean, observedAt: String|null}|null} Each row is
     * `{kind, number, observedAt, repo, role, stale, title}`; `title` is `null` while the producer's
     * row carries none.
     */
    static held(snapshot, seatIdentity) {
        if (!seatIdentity || !snapshot || snapshot.state === 'unavailable') return null;

        const
            lists = snapshot.seats?.[seatIdentity] ?? {},
            held  = new Map();

        [...(lists.authored ?? []), ...(lists.reviewing ?? [])].forEach(row => {
            const kind = OpenWorkSeat.kindOf(row, seatIdentity);

            kind && held.set(`${row.repo}#${row.number}`, {
                kind,
                number    : row.number,
                observedAt: row.observedAt ?? null,
                repo      : row.repo,
                role      : row.holder.role,
                stale     : row.stale === true,
                title     : row.title || null
            })
        });

        const rows = [...held.values()].sort((a, b) => KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind));

        return {
            rows,
            stale     : snapshot.state === 'stale' || rows.some(row => row.stale),
            observedAt: OpenWorkSeat.oldestObservedAt(rows) ?? snapshot.observedAt ?? null
        }
    }

    /**
     * @summary The seat's held open work as its card's chip counts it, or `null` when it holds none or
     * the read cannot say ({@link #held}).
     * @param {Object|null} snapshot     One `fleetOpenWork` envelope, or `null` while unanswered.
     * @param {String|null} seatIdentity The seat's identity, e.g. `@neo-opus-ada`.
     * @returns {{count: Number, worst: String, stale: Boolean, observedAt: String|null}|null}
     */
    static summarize(snapshot, seatIdentity) {
        const held = OpenWorkSeat.held(snapshot, seatIdentity);

        if (!held?.rows.length) return null;

        return {count: held.rows.length, worst: held.rows[0].kind, stale: held.stale, observedAt: held.observedAt}
    }

    /**
     * @summary One held pull request as the Agent Detail lists it: its reference and the link the
     * reference opens, its title when the producer's row carries one, and one line in the chip's
     * vocabulary: the seat's role, the state word and the row's age. The link is composed from the
     * row's own repository and number, never taken from the wire.
     * @param {Object} row One {@link #held} row.
     * @param {Number} [now=Date.now()] The viewer's clock, for the row's age.
     * @returns {{href: String, ref: String, title: String|null, line: String}}
     */
    static describeRow(row, now = Date.now()) {
        const ageMs = row.observedAt ? now - Date.parse(row.observedAt) : NaN;

        return {
            href : `https://github.com/${row.repo}/pull/${row.number}`,
            ref  : `${row.repo} #${row.number}`,
            title: row.title ?? null,
            line : [
                row.role,
                KIND_WORDS[row.kind],
                ...(Number.isFinite(ageMs) ? [`observed ${AgentFreshness.formatAge(ageMs)}`] : []),
                ...(row.stale ? ['stale'] : [])
            ].join(' · ')
        }
    }

    /**
     * @summary The oldest observation among open-work rows: a surface that one row made stale ages
     * from that row. The seat chip and the fleet head's merge queue share this rule.
     * @param {Object[]} rows Rows or records carrying an ISO-8601 `observedAt`.
     * @returns {String|null} `null` when no row carries one.
     */
    static oldestObservedAt(rows) {
        return rows.map(row => row.observedAt).filter(Boolean).sort()[0] ?? null
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
