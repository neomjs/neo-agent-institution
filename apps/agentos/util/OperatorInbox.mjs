import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import PublishSwitch from './PublishSwitch.mjs';
import TargetBinding from './TargetBinding.mjs';

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/**
 * @summary Pure UTF-8 FIPS 180-4 SHA-256 hex digest computation, usable synchronously in both Node
 * and App Worker realms.
 * @param {String} input
 * @returns {String} 64-character lowercase hex digest.
 */
function sha256Hex(input) {
    const bytes = new TextEncoder().encode(String(input ?? '')),
          bitLen = bytes.length * 8,
          padLen = (((bytes.length + 8) >> 6) + 1) << 6,
          padded = new Uint8Array(padLen),
          view   = new DataView(padded.buffer),
          w      = new Uint32Array(64);

    padded.set(bytes);
    padded[bytes.length] = 0x80;
    view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(padLen - 4, bitLen >>> 0, false);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const rotr = (n, x) => (x >>> n) | (x << (32 - n));

    for (let offset = 0; offset < padLen; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4, false)
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3),
                  s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
        }

        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

        for (let i = 0; i < 64; i++) {
            const S1  = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e),
                  ch  = (e & f) ^ (~e & g),
                  t1  = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0,
                  S0  = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a),
                  maj = (a & b) ^ (a & c) ^ (b & c),
                  t2  = (S0 + maj) >>> 0;

            h = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0
        }

        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => v.toString(16).padStart(8, '0')).join('')
}

/**
 * @summary Canonical JSON serializer with lexicographically sorted keys at every object depth,
 * matching `ai/services/memory-core/helpers/publishDigest.mjs` in `neo-agent-brain`.
 * @param {*} value
 * @returns {String}
 */
function canonicalizePublishJson(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => canonicalizePublishJson(item)).join(',')}]`
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalizePublishJson(value[key])}`).join(',')}}`
}

/**
 * @summary Computes the deterministic SHA-256 hex digest over the 6 canonical `requestPublish`
 * payload fields (`account, channel, format, inReplyTo, media, schemaVersion: 1, text`), matching
 * `computePublishRevisionDigest` in `neo-agent-brain`.
 * @param {Object} payload
 * @returns {String} 64-character lowercase hex SHA-256 digest.
 */
function computePublishRevisionDigest(payload = {}) {
    const media = Array.isArray(payload.media)
        ? payload.media.map(item => ({
            mimeType: String(item?.mimeType ?? ''),
            sha256  : String(item?.sha256 ?? '').toLowerCase(),
            uri     : String(item?.uri ?? '')
        }))
        : [];

    const canonical = {
        account      : String(payload.account ?? ''),
        channel      : String(payload.channel ?? ''),
        format       : String(payload.format ?? 'post'),
        inReplyTo    : payload.inReplyTo ?? null,
        media,
        schemaVersion: 1,
        text         : String(payload.text ?? '')
    };

    return sha256Hex(canonicalizePublishJson(canonical))
}

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
                    live.set({now: Date.now(), readFailed: refused || (!open && answer?.capability?.state !== 'wired'),
                        [open ? 'questions' : 'snapshot']: answer})
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
     * @summary Whether a message or row record is a `requestPublish` Task.
     * @param {Object|null} source
     * @returns {Boolean}
     */
    static isPublishRequest(source) {
        if (!source || typeof source !== 'object') return false;
        const msg = source.message && typeof source.message === 'object' ? source.message : source;
        return Boolean(
            msg.requestPublish ||
            msg.task?.requestPublish ||
            msg.revision ||
            msg.task?.revision ||
            msg.publication ||
            msg.task?.publication ||
            (Array.isArray(msg.taggedConcepts) && msg.taggedConcepts.includes('requestPublish'))
        )
    }

    /**
     * @summary Computes the deterministic SHA-256 hex digest over the 6 canonical `requestPublish` fields.
     * @param {Object} payload
     * @returns {String}
     */
    static computeRevisionDigest(payload) {
        return computePublishRevisionDigest(payload)
    }

    /**
     * @summary WRITE: approve the displayed `requestPublish` revision digest (`approvePublishRevision`
     * + `publish`) and refresh the open message.
     * @param {Object} owner The cockpit controller
     * @param {Object} data  `{messageId, revisionDigest, revisionNumber}`
     * @returns {Promise<Boolean>}
     */
    static async approvePublish(owner, {messageId, revisionDigest, revisionNumber} = {}) {
        const
            {bridge}  = owner,
            profileId = owner.bridgeProfileId,
            write     = OperatorInbox.writer(owner, 'actionOutcome');

        if (!messageId || !revisionDigest) {
            write({action: 'approvePublish', messageId, reason: 'messageId and revisionDigest are required', state: 'refused'});
            return false
        }

        write({action: 'approvePublish', messageId, revisionDigest, state: 'pending'});

        const hasApprove = typeof bridge?.approvePublishRevision === 'function',
              hasPublish = typeof bridge?.publish === 'function';

        if (!hasApprove && !hasPublish) {
            write({action: 'approvePublish', messageId, reason: 'fleet: publish executor is not wired', state: 'refused'});
            return false
        }

        try {
            if (hasApprove) {
                const approval = await bridge.approvePublishRevision({
                    messageId,
                    taskId: messageId,
                    revisionDigest,
                    revisionNumber
                });
                if (approval && (approval.ok === false || approval.status === 'rejected' || approval.status === 'not-wired' || approval.refused)) {
                    write({
                        action: 'approvePublish',
                        code  : approval.refused || approval.code || null,
                        messageId,
                        reason: approval.reason || 'approval refused',
                        state : 'refused'
                    });
                    return false
                }
            }

            if (hasPublish) {
                const published = await bridge.publish({
                    messageId,
                    requestId: messageId,
                    revisionDigest
                });
                if (!published || published.ok === false || published.status === 'rejected' || published.status === 'not-wired' || published.refused) {
                    write({
                        action: 'approvePublish',
                        code  : published?.refused || published?.code || null,
                        messageId,
                        reason: published?.reason || 'publish refused',
                        state : 'refused'
                    });
                    owner.bridgeProfileId === profileId && await OperatorInbox.open(owner, {messageId, refresh: true});
                    return false
                }
            }

            write({action: 'approvePublish', messageId, revisionDigest, state: 'ok'});
            if (owner.bridgeProfileId === profileId) {
                await Promise.all([
                    OperatorInbox.open(owner, {messageId, refresh: true}),
                    owner.loadOperatorInbox?.({offset: 0})
                ])
            }
            return true
        } catch (error) {
            write({action: 'approvePublish', messageId, reason: error?.message || 'publish failed', state: 'refused'});
            return false
        }
    }

    /**
     * @summary WRITE: save an operator Edit on a `requestPublish` Task (`editPublishRequest`), creating
     * revision `N+1` with a new digest and clearing approval and attestation.
     * @param {Object} owner The cockpit controller
     * @param {Object} data  `{messageId, patch}`
     * @returns {Promise<Boolean>}
     */
    static async editPublish(owner, {messageId, patch} = {}) {
        const
            {bridge}  = owner,
            profileId = owner.bridgeProfileId,
            write     = OperatorInbox.writer(owner, 'actionOutcome');

        if (!messageId || !patch || typeof patch !== 'object') {
            write({action: 'editPublish', messageId, reason: 'messageId and patch are required', state: 'refused'});
            return false
        }

        write({action: 'editPublish', messageId, state: 'pending'});

        if (typeof bridge?.editPublishRequest !== 'function') {
            write({action: 'editPublish', messageId, reason: 'fleet: editPublishRequest is not wired', state: 'refused'});
            return false
        }

        try {
            const answer = await bridge.editPublishRequest({
                messageId,
                taskId: messageId,
                patch
            });

            if (!answer || answer.ok === false || answer.status === 'rejected' || answer.status === 'not-wired' || answer.refused) {
                write({
                    action: 'editPublish',
                    code  : answer?.refused || answer?.code || null,
                    messageId,
                    reason: answer?.reason || 'edit refused',
                    state : 'refused'
                });
                return false
            }

            write({
                action        : 'editPublish',
                messageId,
                revisionDigest: answer.revisionDigest ?? answer.revision?.revisionDigest ?? null,
                revisionNumber: answer.revisionNumber ?? answer.revision?.revisionNumber ?? null,
                state         : 'ok'
            });

            if (owner.bridgeProfileId === profileId) {
                await Promise.all([
                    OperatorInbox.open(owner, {messageId, refresh: true}),
                    owner.loadOperatorInbox?.({offset: 0})
                ])
            }
            return true
        } catch (error) {
            write({action: 'editPublish', messageId, reason: error?.message || 'editPublishRequest failed', state: 'refused'});
            return false
        }
    }

    /**
     * @summary WRITE: drop a `requestPublish` Task with a required operator reason, sending `Rejected`
     * through `transitionOwnTask`.
     * @param {Object} owner The cockpit controller
     * @param {Object} data  `{expectedCurrentState, messageId, reason}`
     * @returns {Promise<Boolean>}
     */
    static async dropPublish(owner, {expectedCurrentState, messageId, reason} = {}) {
        const
            profileId     = owner.bridgeProfileId,
            trimmedReason = String(reason ?? '').trim(),
            write         = OperatorInbox.writer(owner, 'actionOutcome');

        if (!trimmedReason) {
            write({action: 'dropPublish', messageId, reason: 'A reason is required to drop a publish request.', state: 'refused'});
            return false
        }

        const landed = await OperatorInbox.settle(owner, {
            action  : 'dropPublish',
            messageId,
            params  : {expectedCurrentState, messageId, newState: 'Rejected', reason: trimmedReason},
            verb    : 'transitionOwnTask',
            accepted: answer => answer?.success === true
        });

        if (landed && owner.bridgeProfileId === profileId) {
            await Promise.all([
                OperatorInbox.open(owner, {messageId, refresh: true}),
                owner.loadOpenWork?.()
            ])
        }

        return landed
    }

    /**
     * @summary Jumps from the `requestPublish` card's switch chip to the peer's Publishing switch
     * section inside `AgentDetail` › `Configuration`.
     * @param {Object} owner The cockpit controller or component
     * @param {Object} data  `{channel, peer}`
     */
    static openPublishSwitch(owner, {channel, peer} = {}) {
        const
            cockpit  = owner?.component ?? owner,
            barePeer = String(peer ?? '').replace(/^@/, '');

        if (barePeer && typeof owner?.onAgentSelect === 'function') {
            owner.onAgentSelect({agentId: barePeer})
        }

        const
            detail     = cockpit?.getAgentDetailPane?.() ??
                         cockpit?.getReference?.('agent-detail') ??
                         Neo.manager.Component.find('ntype', 'fm-agent-detail').find(c => c.mounted) ??
                         Neo.manager.Component.find('ntype', 'fm-agent-detail')[0] ??
                         null,
            rosterRows = owner?.resolveFleetRosterStore?.()?.items ??
                         cockpit?.getStateProvider?.()?.getData?.('agents')?.rows ??
                         cockpit?.rosterStore?.items ??
                         [];

        if (!detail) return;

        const matchedRecord = rosterRows.find(row =>
            row?.agentId === barePeer ||
            row?.githubUsername === barePeer ||
            PublishSwitch.peerIdOf(row) === PublishSwitch.peerIdOf(peer)
        );

        if (matchedRecord && detail.record !== matchedRecord) {
            detail.record = matchedRecord
        }

        const tabs = detail.getReference?.('detail-tabs');
        if (tabs) {
            tabs.activeIndex = 1
        }

        detail.getReference?.('publish-switches')?.focusChannel?.(channel)
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
