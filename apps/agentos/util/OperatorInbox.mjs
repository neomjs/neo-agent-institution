import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary The operator's own inbox, owner-side: compose, and on a message opened from the inbox, read
 * it in full, mark it read and resolve its Task (the Fleet verbs `fleetOwnMessage`, `markOwnMessageRead`,
 * `transitionOwnTask`, all under the operator's transport-stamped identity).
 *
 * Every answer is written back onto the operator mailbox as owner state (`composeOutcome` on the form's
 * path, `messageRead` and `actionOutcome` on the detail's), so a refusal is never invisible and nothing
 * claims a success the source did not report: a row reads as read, and a Task as resolved, only from the
 * inbox re-read that follows. A write that settles after a profile switch lands nowhere.
 *
 * The cockpit controller owns the state (`operatorMessageReadGeneration`, the bridge, the inbox read);
 * this class reads and writes it, like {@link AgentOS.util.OpenWorkRead}.
 * @class AgentOS.util.OperatorInbox
 * @extends Neo.core.Base
 */
class OperatorInbox extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.OperatorInbox'
         * @protected
         */
        className: 'AgentOS.util.OperatorInbox'
    }

    /**
     * @summary WRITE: route one operator-composed message — one target, several (fan-out, one
     * authenticated call and one honest outcome per recipient), or the `AGENT:*` broadcast (a
     * single call; the server expands the sentinel). The sender is server-stamped at the
     * authenticated ingress, never carried here. The inbox re-polls exactly ONCE for the batch,
     * and only when a real send landed and the profile that sent it is still the bridge in hand.
     * @param {Object} owner   The cockpit controller
     * @param {Object} message `{to, subject, body, priority?, wakeSuppressed?, relatedTickets?, inReplyTo?}`
     * @returns {Promise<Object>} `{results: [{to, outcome}]}` in order.
     */
    static async compose(owner, message) {
        const
            {bridge}  = owner,
            profileId = owner.bridgeProfileId,
            targets   = Array.isArray(message.to) ? message.to : (message.to == null ? [] : [message.to]),
            wired     = typeof bridge?.composeOperatorMessage === 'function',
            results   = [];

        for (const to of targets) {
            if (!wired) {
                results.push({to, outcome: {status: 'not-wired', reason: 'fleet: operator compose verb not wired'}});
                continue
            }

            let outcome;

            try {
                // one target per call; the spread never mutates the caller's payload
                outcome = await bridge.composeOperatorMessage({...message, to})
            } catch (error) {
                outcome = {status: 'error', reason: error?.message || 'compose failed'}
            }

            results.push({to, outcome})
        }

        if (results.some(result => result.outcome?.messageId) && owner.bridgeProfileId === profileId) {
            await owner.loadOperatorInbox({offset: 0})
        }

        return {results}
    }

    /**
     * @summary READ: the open message in full (`fleetOwnMessage`, which writes no receipt). An open shows
     * `loading` first and supersedes every earlier read: one that settles after another message opened
     * lands nowhere. A `refresh` re-reads the message still open under that open's fence, keeping the
     * shown body until the answer lands. It reads nothing once another message opened, and never
     * supersedes the newer read. A bridge without the verb reads `unavailable`, never an empty body.
     * @param {Object} owner The cockpit controller
     * @param {Object} data  `{messageId, refresh?}`
     * @returns {Promise<void>}
     */
    static async open(owner, data) {
        const {bridge} = owner, {messageId, refresh} = data;

        if (refresh && owner.operatorOpenMessageId !== messageId) {
            return
        }

        const
            generation = refresh ? owner.operatorMessageReadGeneration : ++owner.operatorMessageReadGeneration,
            write      = OperatorInbox.writer(owner, 'messageRead', () => generation === owner.operatorMessageReadGeneration);

        if (!refresh) {
            owner.operatorOpenMessageId = messageId;
            write({messageId, state: 'loading'})
        }

        if (typeof bridge?.fleetOwnMessage !== 'function') {
            write({messageId, reason: 'fleet: the message read is not wired', state: 'unavailable'});
            return
        }

        try {
            const answer = await bridge.fleetOwnMessage({messageId});

            write(answer?.messageId === messageId
                ? {message: answer, messageId, state: 'ok'}
                : {code: answer?.code ?? null, messageId, reason: answer?.reason || 'the message read answered no message', state: answer?.status === 'rejected' ? 'refused' : 'unavailable'})
        } catch (error) {
            write({messageId, reason: error?.message || 'the message could not be read', state: error?.fleetConnectionState === 'refused' ? 'refused' : 'unavailable'})
        }
    }

    /**
     * @summary WRITE: mark the open message read (`markOwnMessageRead`, a receipt only, so an open Task
     * stays open).
     * @param {Object} owner The cockpit controller
     * @param {Object} data  `{messageId}`
     * @returns {Promise<Boolean>} Whether the receipt landed
     */
    static markRead(owner, {messageId}) {
        return OperatorInbox.settle(owner, {
            action  : 'markRead',
            messageId,
            params  : {messageId},
            verb    : 'markOwnMessageRead',
            accepted: answer => answer?.results?.some(result => result.messageId === messageId && result.status === 'read'),
            refusal : answer => answer?.results?.find(result => result.messageId === messageId)?.status
        })
    }

    /**
     * @summary WRITE: resolve the open message's Task by moving it to Completed (`transitionOwnTask`),
     * guarded by the state the detail read. Once it lands, the message re-reads without a loading
     * flash if it is still the open one, so the detail shows the Task's new state from the source.
     * @param {Object} owner The cockpit controller
     * @param {Object} data  `{expectedCurrentState, messageId}`
     * @returns {Promise<Boolean>} Whether the move landed
     */
    static async resolve(owner, {expectedCurrentState, messageId}) {
        const
            profileId = owner.bridgeProfileId,
            landed    = await OperatorInbox.settle(owner, {
                action  : 'resolve',
                messageId,
                params  : {expectedCurrentState, messageId, newState: 'Completed'},
                verb    : 'transitionOwnTask',
                accepted: answer => answer?.success === true
            });

        landed && owner.bridgeProfileId === profileId && await OperatorInbox.open(owner, {messageId, refresh: true});

        return landed
    }

    /**
     * @summary One own-inbox write, settled onto the detail's outcome line: `pending`, then `ok` and the
     * inbox re-read, or `refused` with the reason and the Brain's code. A bridge without the verb, an
     * answer that is not a success, and a transport failure all refuse visibly.
     * @param {Object}   owner The cockpit controller
     * @param {Object}   options
     * @param {String}   options.action    `markRead` | `resolve`
     * @param {String}   options.messageId
     * @param {Object}   options.params
     * @param {String}   options.verb      The bridge verb
     * @param {Function} options.accepted  Whether the verb's answer is a success
     * @param {Function} [options.refusal] A reason the answer carries other than `reason`
     * @returns {Promise<Boolean>} Whether the write landed
     */
    static async settle(owner, {action, messageId, params, verb, accepted, refusal}) {
        const
            {bridge}  = owner,
            profileId = owner.bridgeProfileId,
            write     = OperatorInbox.writer(owner, 'actionOutcome');

        write({action, messageId, state: 'pending'});

        if (typeof bridge?.[verb] !== 'function') {
            write({action, messageId, reason: `fleet: ${verb} is not wired`, state: 'refused'});
            return false
        }

        try {
            const answer = await bridge[verb](params);

            if (accepted(answer)) {
                write({action, messageId, state: 'ok'});
                // like compose: the inbox re-reads only while the profile that wrote is still in hand
                owner.bridgeProfileId === profileId && await owner.loadOperatorInbox({offset: 0});
                return true
            }

            write({action, code: answer?.code ?? null, messageId, reason: answer?.reason || refusal?.(answer) || 'no reason given', state: 'refused'})
        } catch (error) {
            write({action, messageId, reason: error?.message || `${verb} failed`, state: 'refused'})
        }

        return false
    }

    /**
     * @summary A writer onto the operator mailbox's owner-written state, fenced to the profile in hand
     * when the action began, and to the caller's own fence when it has one.
     * @param {Object}   owner     The cockpit controller
     * @param {String}   config    The OperatorContainer config to write
     * @param {Function} [current] Whether the caller's answer is still the current one
     * @returns {Function} `value => void`
     */
    static writer(owner, config, current = () => true) {
        const profileId = owner.bridgeProfileId;

        return value => {
            const mailbox = owner.getReference('operator-mailbox');

            owner.bridgeProfileId === profileId && current() && mailbox && (mailbox[config] = value)
        }
    }
}

export default Neo.setupClass(OperatorInbox);
