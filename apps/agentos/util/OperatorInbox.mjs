import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import TargetBinding from './TargetBinding.mjs';

/**
 * @summary The operator's own inbox, owner-side: the list it shows, compose, and on a message opened from the
 * inbox, read it in full, mark it read and resolve its Task (the Fleet verbs `fleetOwnMessage`,
 * `markOwnMessageRead`, `transitionOwnTask`, all under the operator's transport-stamped identity).
 *
 * Every answer is written back onto the operator mailbox as owner state (`composeOutcome` on the form's
 * path, `messageRead` and `actionOutcome` on the detail's), so a refusal is never invisible and nothing
 * claims a success the source did not report: a row reads as read, and a Task as resolved, only from the
 * inbox re-read that follows. A write that settles after a profile switch lands nowhere.
 *
 * The cockpit controller owns the state (`operatorInboxReadGeneration`, `operatorMessageReadGeneration`, the
 * bridge). Its owned instance serializes list reads; compose and detail routing use the same controller.
 * @class AgentOS.util.OperatorInbox
 * @extends Neo.core.Base
 */
class OperatorInbox extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.OperatorInbox'
         * @protected
         */
        className: 'AgentOS.util.OperatorInbox',
        /**
         * The cockpit creating and destroying this read owner.
         * @member {Object|null} owner=null
         */
        owner: null
    }

    /**
     * Actual unsettled wire count; a bounded-read timeout does not release it.
     * @member {Number} readInFlight=0
     */
    readInFlight = 0

    /**
     * At most one latest explicit read intent waits behind the wire; cadence never queues.
     * @member {Object|null} queuedRead=null
     * @protected
     */
    queuedRead = null

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
     * @summary READ-OBSERVE: one window of the list the operator mailbox shows: all mail from the mirror
     * (`fleetMailboxMirror`, held as the owner's `operatorSnapshot`), or in the open view the operator's open
     * questions (`fleetOwnQuestions`). The gate IS the honest outcome (no pane / no bound subject / no verb →
     * the pane's `unobserved` state stands); a throwing bridge keeps the last-known list with a stale marker.
     * One fence serves both lists: a switch supersedes the other list's read in flight, and a refused intent
     * invalidates older reads. Explicit reads coalesce behind one wire; automatic reads never queue.
     * A bridge bound to another profile first retires the held identity and window, so no page is read as the
     * previous instance's viewer.
     * @param {Object} [params]
     * @param {Number} [params.offset=0]
     * @param {Boolean} [params.automatic=false] Defer first-window replacement while reading older rows.
     * @returns {Promise<void>}
     */
    async read({offset = 0, automatic = false} = {}) {
        const me = this;
        if (me.isDestroyed) return;
        const {owner} = me;
        if (owner.isDestroyed) return;
        const {bridge} = owner;
        if (automatic && (me.readInFlight || owner.livenessHidden)) return;

        TargetBinding.retireOperatorMailbox(owner, {profileId: owner.bridgeProfileId});

        const
            mailbox    = owner.component.getOperatorMailboxPane(),
            subject    = owner.operatorRecord?.agentIdentityNodeId,
            open       = mailbox?.view === 'open',
            profileId  = owner.bridgeProfileId,
            generation = ++owner.operatorInboxReadGeneration,
            current    = () => !me.isDestroyed && !owner.isDestroyed && generation === owner.operatorInboxReadGeneration &&
                owner.bridge === bridge && owner.bridgeProfileId === profileId && owner.operatorRecord?.agentIdentityNodeId === subject &&
                (owner.component.getOperatorMailboxPane()?.view === 'open') === open;

        if (!mailbox || !subject || typeof bridge?.[open ? 'fleetOwnQuestions' : 'fleetMailboxMirror'] !== 'function') {
            return
        }

        if (automatic && !mailbox.canRefreshFirstPage()) return;

        if (me.readInFlight) {
            if (!me.queuedRead) {
                me.queuedRead = {};
                me.queuedRead.promise = new Promise(resolve => { me.queuedRead.resolve = resolve })
            }
            Object.assign(me.queuedRead, {params: {offset}, current});
            return owner.boundedRead(me.queuedRead.promise, () => {}).catch(() => {
                if (current()) {
                    const live = owner.component.getOperatorMailboxPane();
                    if (live) live.readFailed = true
                }
            })
        }

        try {
            me.readInFlight++;
            const answer = await owner.boundedRead(Promise.resolve().then(() => open
                ? bridge.fleetOwnQuestions({offset})
                : bridge.fleetMailboxMirror({subjectAgentId: subject, offset})), () => me.onWireSettled());

            if (current()) {
                // A revoked admission must clear rows even if the operator scrolled during this read.
                const live = owner.component.getOperatorMailboxPane(),
                      refused = open ? answer?.state !== 'ok' : answer?.admission?.state !== 'granted';
                if (automatic && !refused && live && !live.canRefreshFirstPage()) return;

                open || (owner.operatorSnapshot = answer);
                if (live) {
                    live.readFailed = refused || (!open && answer?.capability?.state !== 'wired');
                    live.now = Date.now();
                    live[open ? 'questions' : 'snapshot'] = answer
                }
            }
        } catch (error) {
            if (current()) {
                const live = owner.component.getOperatorMailboxPane();
                if (live) live.readFailed = true
            }
        }
    }

    /**
     * @summary Release the actual wire and service one latest explicit intent if its binding survives.
     * @protected
     */
    onWireSettled() {
        if (this.isDestroyed) return;
        this.readInFlight--;
        const queued = this.queuedRead;
        this.queuedRead = null;
        if (queued) {
            queued.current() ? this.read(queued.params).then(queued.resolve) : queued.resolve()
        }
    }

    /**
     * @summary Retire the queued intent with the creating cockpit; late wires cannot publish or read again.
     * @param {...*} args
     */
    destroy(...args) {
        this.queuedRead?.resolve();
        this.queuedRead = null;
        super.destroy(...args)
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
     * flash if it is still the open one, so the detail shows the Task's new state from the source, and
     * the open work re-reads, so the open-question count moves with the transition.
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

        if (landed && owner.bridgeProfileId === profileId) {
            await Promise.all([OperatorInbox.open(owner, {messageId, refresh: true}), owner.loadOpenWork()])
        }

        return landed
    }

    /**
     * @summary One own-inbox write, settled onto the detail's outcome line: `pending`, then `ok` and the
     * re-read of the list in view, or `refused` with the reason and the Brain's code. A bridge without the
     * verb, an answer that is not a success, and a transport failure all refuse visibly.
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
