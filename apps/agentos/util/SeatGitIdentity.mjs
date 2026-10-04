import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * The states the Fleet answers for a seat's commit identity (`fleetSeatGitIdentity`, Brain #829).
 * @member {String[]} STATES
 */
const STATES = ['declared', 'derived', 'missing', 'mismatch', 'unknown'];

/**
 * The states the operator acts on: no usable identity, a PAT that answers for another account, or a
 * read that failed. The other two commit as the seat.
 * @member {String[]} REPAIR_STATES
 */
const REPAIR_STATES = ['missing', 'mismatch', 'unknown'];

/**
 * @summary The cockpit's one reading of which identity a seat's commits carry: the Fleet's answer read,
 * worded, and repaired by a declaration. Add, Detail and the roster card speak through it, so a state
 * reads the same wherever it shows.
 *
 * Reasons come from the Fleet, which words them for the seat (`its forge account offers no email this PAT
 * can read`). A failure on the way there reads as `unknown` in fixed words, never with a caught message.
 * @class AgentOS.util.SeatGitIdentity
 * @extends Neo.core.Base
 */
class SeatGitIdentity extends Base {
    static PAIR_REQUIRED = 'Name and email are both required.'
    static REPAIR_STATES = REPAIR_STATES
    static STATES        = STATES

    static config = {
        /**
         * @member {String} className='AgentOS.util.SeatGitIdentity'
         * @protected
         */
        className: 'AgentOS.util.SeatGitIdentity'
    }

    /**
     * @summary The typed declaration as the pair `configureAgent` takes, trimmed; `null` unless both
     * halves are given, since the Brain refuses half a pair.
     * @param {Object} [fields]
     * @param {String} [fields.gitName]
     * @param {String} [fields.gitEmail]
     * @returns {{gitName: String, gitEmail: String}|null}
     */
    static pairOf({gitName, gitEmail}={}) {
        const
            name  = String(gitName  ?? '').trim(),
            email = String(gitEmail ?? '').trim();

        return name && email ? {gitName: name, gitEmail: email} : null
    }

    /**
     * @summary Whether the operator has something to do: `missing`, `mismatch` or `unknown`.
     * @param {Object|null} identity
     * @returns {Boolean}
     */
    static needsRepair(identity) {
        return REPAIR_STATES.includes(identity?.state)
    }

    /**
     * @summary The one line a state reads as, its reason included.
     * @param {Object|null} identity `{state, name?, email?, reason?}`, or `null` before a read.
     * @returns {String}
     */
    static describe(identity) {
        const
            {email, name, reason, state} = identity || {},
            why = String(reason ?? '').trim().replace(/\.+$/, ''),
            because = lead => why ? `${lead}: ${why}.` : `${lead}.`;

        return {
            declared: `Commits as ${name} <${email}> · declared`,
            derived : `Commits as ${name} <${email}> · from its account`,
            missing : because('No commit identity'),
            mismatch: because('Not its own account'),
            unknown : because('Identity not yet read')
        }[state] ?? 'Identity not yet read.'
    }

    /**
     * @summary Read the identity a seat's commits would carry, from the derivation its Start runs. Never
     * throws: a bridge without the verb, a failed call or a shapeless answer is `unknown`.
     * @param {Object|null} bridge The Fleet Registry bridge.
     * @param {String}      id     The seat's registry id.
     * @returns {Promise<Object>} `{state, name?, email?, found?, reason?}`.
     */
    static async read(bridge, id) {
        if (typeof bridge?.fleetSeatGitIdentity !== 'function') {
            return {state: 'unknown', reason: 'this fleet does not report commit identities'}
        }

        try {
            const identity = await bridge.fleetSeatGitIdentity({id});

            return STATES.includes(identity?.state) ? identity : {state: 'unknown', reason: 'the fleet answered without one'}
        } catch {
            return {state: 'unknown', reason: 'the fleet could not be reached'}
        }
    }

    /**
     * @summary Declare the name and email a seat's commits carry, through `configureAgent`. A declaration
     * wins over the derivation, and Start still verifies it. Never throws.
     * @param {Object|null} bridge
     * @param {String}      id
     * @param {Object}      fields
     * @param {String}      fields.gitName
     * @param {String}      fields.gitEmail
     * @returns {Promise<{state: 'accepted'|'rejected', reason: String, definition?: Object}>}
     */
    static async declare(bridge, id, fields) {
        const pair = SeatGitIdentity.pairOf(fields);

        if (!pair) {
            return {state: 'rejected', reason: SeatGitIdentity.PAIR_REQUIRED}
        }

        if (typeof bridge?.configureAgent !== 'function') {
            return {state: 'rejected', reason: 'The fleet is not running. Start it, then declare the identity.'}
        }

        let outcome;

        try {
            outcome = await bridge.configureAgent({id, ...pair})
        } catch {
            return {state: 'rejected', reason: 'Could not reach the fleet. Nothing was saved.'}
        }

        return outcome?.status === 'accepted'
            ? {state: 'accepted', reason: '', definition: outcome.agent}
            : {state: 'rejected', reason: outcome?.reason || 'The fleet refused the identity. Nothing was changed.'}
    }
}

export default Neo.setupClass(SeatGitIdentity);
