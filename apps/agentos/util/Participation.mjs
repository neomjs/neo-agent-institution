import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * The plane-host command that records a participation decision, as the Brain's `IdentitySchema.md` documents it.
 * @member {String} PARTICIPATION_CLI
 */
const PARTICIPATION_CLI = 'node ai/scripts/fleet/participation.mjs';

/**
 * A handle the command carries as one literal argument on any shell: an optional `@`, then letters, digits, `.`, `_`
 * or `-`, starting with a letter or digit. Anything else (whitespace, quotes, shell metacharacters, a leading dash) is
 * refused rather than escaped, so a copied command never carries more than the identity it names.
 * @member {RegExp} PLAIN_HANDLE
 */
const PLAIN_HANDLE = /^@?[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * @summary What Agent Detail, its state ledger and the roster card say about a seat's participation, from the
 * roster's facts: the status the seat's identity node records, the operator's reason and date, and whether the read
 * answered. The cockpit shows the plane's identity fact and writes none of it, so a decision is the plane host's: the
 * Participation row names the one command that fits and where it runs.
 * @class AgentOS.util.Participation
 * @extends Neo.core.Base
 */
class Participation extends Base {
    static PARTICIPATION_CLI = PARTICIPATION_CLI

    static config = {
        /**
         * @member {String} className='AgentOS.util.Participation'
         * @protected
         */
        className: 'AgentOS.util.Participation'
    }

    /**
     * @summary The participation a record shows: its node's status, `unobserved` when the read did not answer, or
     * `null` where neither is known (no node, or a Brain that reports no read).
     * @param {Object|null} record A FleetAgent record, or its fields.
     * @returns {String|null}
     */
    static stateOf(record) {
        return record?.participationStatus ?? (record?.participationRead?.state === 'unread' ? 'unobserved' : null)
    }

    /**
     * @summary The facts behind the state, for a title: the date and the operator's reason, or why the read did not
     * answer, then when the roster was read. `null` with none of them.
     * @param {Object|null}  record
     * @param {Number|null} [readAtMs] When the roster carrying the record was read (epoch ms).
     * @returns {String|null}
     */
    static detailOf(record, readAtMs = null) {
        const
            unread = Participation.stateOf(record) === 'unobserved',
            facts  = [
                !unread && record?.participationSince ? `since ${record.participationSince.slice(0, 10)}` : null,
                unread ? `the read did not answer${record.participationRead.reason ? `: ${record.participationRead.reason}` : ''}` : record?.participationReason ?? null,
                Number.isFinite(readAtMs) ? `read at ${new Date(readAtMs).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : null
            ].filter(Boolean);

        return facts.length ? facts.join(' · ') : null
    }

    /**
     * @summary The Participation row's line, in the design read's words: `active`, `benched since <date> — <reason>`,
     * another status by its word, or `unobserved — <why the read did not answer>`.
     * @param {Object|null} record
     * @returns {String|null}
     */
    static lineOf(record) {
        const state = Participation.stateOf(record);

        if (state === 'unobserved') {
            return `unobserved — ${record.participationRead.reason || 'the read did not answer'}`
        }

        if (!state || state === 'active') {
            return state
        }

        const
            word   = state === 'operator_benched' ? 'benched' : state.replace(/_/g, ' '),
            since  = record.participationSince ? ` since ${record.participationSince.slice(0, 10)}` : '',
            reason = record.participationReason ? ` — ${record.participationReason}` : '';

        return `${word}${since}${reason}`
    }

    /**
     * @summary The one plane-host command that fits the state, the seat filled in: `bench` for an active seat, with
     * the reason as a visible placeholder; `activate` for a benched one; `show` where the state is unread or another
     * status. `null` without a state, or without an identity that is a plain handle.
     * @param {Object|null} record
     * @returns {String|null}
     */
    static commandOf(record) {
        const
            state    = Participation.stateOf(record),
            login    = record?.githubUsername ?? null,
            identity = login && PLAIN_HANDLE.test(login) ? (login.startsWith('@') ? login : `@${login}`) : null;

        if (!state || !identity) {
            return null
        }

        if (state === 'active') {
            return `${PARTICIPATION_CLI} bench --identity ${identity} --reason "<why>" --apply`
        }

        return state === 'operator_benched'
            ? `${PARTICIPATION_CLI} activate --identity ${identity} --apply`
            : `${PARTICIPATION_CLI} show --identity ${identity}`
    }

    /**
     * @summary What the group offers to run, and where: the command that fits ({@link #commandOf}), on the plane the
     * shell is attached to, whose Memory Core serves the graph the command changes. There is no command for an
     * identity that is not a plain handle. There is none either where the shell names no plane: when it runs its own,
     * a command from a terminal would not reach that graph, and this view cannot name one that does.
     * @param {Object|null} record
     * @param {String|null} planeBase The plane the shell is attached to; `null` when it runs its own or names none.
     * @returns {{command: String|null, place: String|null}} `place` says where to run the command, or why there is
     *     none; both `null` without a participation to change.
     */
    static instructionOf(record, planeBase) {
        if (!Participation.stateOf(record)) {
            return {command: null, place: null}
        }

        const command = Participation.commandOf(record);

        if (!command) {
            return {command: null, place: record?.githubUsername ? 'No command is offered: the seat\'s identity is not a plain handle.' : 'No command is offered: the seat names no identity.'}
        }

        let host = null;

        try {
            host = planeBase ? new URL(planeBase).host : null
        } catch {}

        if (!host) {
            return {command: null, place: 'No command is offered: this view cannot name where the plane\'s Memory Core runs.'}
        }

        return {
            command,
            place: /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)
                ? `Run it on this machine, where the plane at ${host} runs its Memory Core (on a Docker plane, inside its container).`
                : `Run it on the plane host ${host}, where its Memory Core runs (on a Docker plane, inside its container).`
        }
    }
}

export default Neo.setupClass(Participation);
