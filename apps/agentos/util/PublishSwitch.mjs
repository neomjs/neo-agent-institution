import Base       from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import ViewerTime from './ViewerTime.mjs';

/**
 * Closed v1 outbound publish channels.
 * @type {ReadonlyArray<String>}
 */
const PUBLISH_CHANNELS = Object.freeze(['x', 'linkedin']);

/**
 * Closed v1 per-peer × per-channel publish gate switch states, ordered from strictest (`0`) to most permissive (`3`).
 * @type {ReadonlyArray<String>}
 */
const PUBLISH_SWITCH_STATES = Object.freeze([
    'approve each',
    'approve the batch',
    'auto-approve after a cross-family review attestation',
    'auto-approve'
]);

/**
 * Rank table mapping each legal switch state to its permissiveness ordinal (`0..3`).
 * @type {Readonly<Record<String, Number>>}
 */
const PUBLISH_SWITCH_RANK = Object.freeze({
    'approve each'                                         : 0,
    'approve the batch'                                    : 1,
    'auto-approve after a cross-family review attestation': 2,
    'auto-approve'                                         : 3
});

/**
 * @summary Pure helpers and Fleet-bridge I/O for the per-peer × per-channel publish gate switch.
 *
 * The switch is Fleet-owned state with an audit record (`who · when · from → to · reason`) and an
 * optional recorded proposal; the cockpit renders a view of it and mutates it exclusively through
 * the operator-authenticated Fleet path (`setPublishSwitch`).
 * @class AgentOS.util.PublishSwitch
 * @extends Neo.core.Base
 */
class PublishSwitch extends Base {
    static CHANNELS      = PUBLISH_CHANNELS
    static DEFAULT_STATE = PUBLISH_SWITCH_STATES[0]
    static RANK          = PUBLISH_SWITCH_RANK
    static STATES        = PUBLISH_SWITCH_STATES

    static config = {
        /**
         * @member {String} className='AgentOS.util.PublishSwitch'
         * @protected
         */
        className: 'AgentOS.util.PublishSwitch'
    }

    /**
     * @summary Canonical `@`-prefixed peer handle for switch queries.
     * @param {Object|String|null} peerOrRecord
     * @returns {String|null}
     */
    static peerIdOf(peerOrRecord) {
        if (!peerOrRecord) return null;
        if (typeof peerOrRecord === 'string') {
            const trimmed = peerOrRecord.trim();
            return trimmed ? (trimmed.startsWith('@') ? trimmed : `@${trimmed}`) : null
        }
        const raw = peerOrRecord.agentIdentityNodeId || peerOrRecord.githubUsername || peerOrRecord.agentId || peerOrRecord.id || null;
        if (typeof raw !== 'string' || !raw.trim()) return null;
        const trimmed = raw.trim();
        return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
    }

    /**
     * @summary Whether moving from `fromState` to `toState` is a promotion (more permissive).
     * @param {String} fromState
     * @param {String} toState
     * @returns {Boolean}
     */
    static isPromotion(fromState, toState) {
        const fromRank = PUBLISH_SWITCH_RANK[fromState] ?? 0,
              toRank   = PUBLISH_SWITCH_RANK[toState]   ?? 0;
        return toRank > fromRank
    }

    /**
     * @summary Whether moving from `fromState` to `toState` is a downgrade (stricter).
     * @param {String} fromState
     * @param {String} toState
     * @returns {Boolean}
     */
    static isDowngrade(fromState, toState) {
        const fromRank = PUBLISH_SWITCH_RANK[fromState] ?? 0,
              toRank   = PUBLISH_SWITCH_RANK[toState]   ?? 0;
        return toRank < fromRank
    }

    /**
     * @summary Normalizes one `(peer, channel)` switch entry from a Fleet read answer.
     * @param {Object|null} raw
     * @param {String}      peer
     * @param {String}      channel
     * @returns {{peer: String, channel: String, state: String, updatedAt: String|null, updatedBy: String|null, audit: Object[], proposal: Object|null}}
     */
    static normalizeChannelSwitch(raw, peer, channel) {
        const state = PUBLISH_SWITCH_STATES.includes(raw?.state) ? raw.state : PUBLISH_SWITCH_STATES[0],
              audit = Array.isArray(raw?.audit)
                  ? raw.audit
                      .filter(entry => entry && typeof entry === 'object')
                      .map(entry => ({
                          who   : String(entry.who    ?? entry.updatedBy ?? '@tobiu'),
                          when  : String(entry.when   ?? entry.at        ?? ''),
                          from  : String(entry.from   ?? PUBLISH_SWITCH_STATES[0]),
                          to    : String(entry.to     ?? state),
                          reason: String(entry.reason ?? '')
                      }))
                  : [],
              proposal = raw?.proposal && typeof raw.proposal === 'object'
                  ? {
                      toState   : String(raw.proposal.toState ?? raw.proposal.proposedState ?? ''),
                      by        : raw.proposal.by ? String(raw.proposal.by) : null,
                      when      : raw.proposal.when ? String(raw.proposal.when) : null,
                      reason    : raw.proposal.reason ? String(raw.proposal.reason) : null,
                      basis     : raw.proposal.basis && typeof raw.proposal.basis === 'object' ? {...raw.proposal.basis} : null,
                      recordedAt: raw.proposal.recordedAt ?? raw.proposal.when ?? null,
                      text      : typeof raw.proposal.text === 'string' ? raw.proposal.text : null
                  }
                  : null;

        return {
            peer     : raw?.peer || peer,
            channel  : raw?.channel || channel,
            state,
            updatedAt: raw?.updatedAt ?? audit.at(-1)?.when ?? null,
            updatedBy: raw?.updatedBy ?? audit.at(-1)?.who  ?? null,
            lastAudit: audit.at(-1) ?? null,
            audit,
            proposal
        }
    }

    /**
     * @summary Normalizes a full peer switch map across `x` and `linkedin`.
     * @param {Object|Array|null} raw
     * @param {String}            peer
     * @returns {{peer: String, channels: Record<String, Object>}}
     */
    static normalizePeerSwitches(raw, peer) {
        const byChannel = {};

        if (Array.isArray(raw)) {
            for (const entry of raw) {
                if (entry?.channel && (!entry.peer || entry.peer === peer || entry.peer === peer?.replace(/^@/, ''))) {
                    byChannel[entry.channel] = entry
                }
            }
        } else if (Array.isArray(raw?.switches)) {
            for (const entry of raw.switches) {
                if (entry?.channel && (!entry.peer || entry.peer === peer || entry.peer === peer?.replace(/^@/, ''))) {
                    byChannel[entry.channel] = entry
                }
            }
        } else if (raw && typeof raw === 'object') {
            const source = (raw.channels && typeof raw.channels === 'object') ? raw.channels : raw;
            for (const channel of PUBLISH_CHANNELS) {
                if (source[channel] && typeof source[channel] === 'object') {
                    byChannel[channel] = source[channel]
                } else if (source[`${peer}:${channel}`] && typeof source[`${peer}:${channel}`] === 'object') {
                    byChannel[channel] = source[`${peer}:${channel}`]
                }
            }
        }

        const channels = {};
        for (const channel of PUBLISH_CHANNELS) {
            channels[channel] = PublishSwitch.normalizeChannelSwitch(byChannel[channel] ?? null, peer, channel)
        }

        return {peer, channels}
    }

    /**
     * @summary Formats one audit entry as `who · when · from → to · reason`.
     * @param {Object|null} entry
     * @param {Number}      [now]
     * @returns {String}
     */
    static formatAuditLine(entry, now) {
        if (!entry || typeof entry !== 'object') {
            return 'no audit history yet'
        }
        const whenText = entry.when ? (ViewerTime.formatViewerTime(entry.when, {now})?.text || entry.when) : 'unknown time',
               parts    = [entry.who || '@tobiu', whenText, `${entry.from} → ${entry.to}`];

        if (entry.reason) {
            parts.push(entry.reason)
        }
        return parts.join(' · ')
    }

    /**
     * @summary Formats a recorded proposal line (`eligible for <toState>: <N> batches released, <M> edits since <date>`),
     * or returns `null` when no proposal is recorded.
     * @param {Object|null} proposal
     * @returns {String|null}
     */
    static formatProposalLine(proposal) {
        if (!proposal || typeof proposal !== 'object') return 'no recorded proposal';
        if (typeof proposal.text === 'string' && proposal.text.trim()) {
            return proposal.text.trim()
        }
        if (!proposal.toState) return 'no recorded proposal';

        const basis = proposal.basis;
        if (basis && typeof basis === 'object') {
            const batches = basis.batches ?? 0,
                  edits   = basis.edits   ?? 0,
                  since   = basis.since   ? ` since ${basis.since}` : '';
            return `eligible for ${proposal.toState}: ${batches} ${batches === 1 ? 'batch' : 'batches'} released, ${edits} ${edits === 1 ? 'edit' : 'edits'}${since}`
        }

        const parts = [`eligible for ${proposal.toState}`];
        if (proposal.by) {
            parts.push(`proposed by ${proposal.by}`)
        }
        if (proposal.reason) {
            parts.push(proposal.reason)
        }
        return parts.join(' · ')
    }

    /**
     * @summary Reads a peer's publish switches from the Fleet bridge. Never throws.
     * @param {Object|null} bridge
     * @param {String}      peer
     * @returns {Promise<{state: 'ok'|'unavailable', peer: String, channels: Record<String, Object>, reason: String|null}>}
     */
    static async read(bridge, peer) {
        const normalizedPeer = PublishSwitch.peerIdOf(peer) || String(peer || '');

        if (typeof bridge?.readPublishSwitches !== 'function') {
            const fallback = PublishSwitch.normalizePeerSwitches(null, normalizedPeer);
            return {
                state   : 'unavailable',
                peer    : normalizedPeer,
                channels: fallback.channels,
                reason  : 'this Fleet does not serve publish switches yet'
            }
        }

        try {
            const answer = await bridge.readPublishSwitches({peer: normalizedPeer});
            if (answer?.status === 'not-wired' || answer?.state === 'unavailable') {
                const fallback = PublishSwitch.normalizePeerSwitches(null, normalizedPeer);
                return {
                    state   : 'unavailable',
                    peer    : normalizedPeer,
                    channels: fallback.channels,
                    reason  : answer.reason || 'publish switch store not wired'
                }
            }
            const normalized = PublishSwitch.normalizePeerSwitches(answer, normalizedPeer);
            return {
                state   : 'ok',
                peer    : normalizedPeer,
                channels: normalized.channels,
                reason  : null
            }
        } catch (error) {
            const fallback = PublishSwitch.normalizePeerSwitches(null, normalizedPeer);
            return {
                state   : 'unavailable',
                peer    : normalizedPeer,
                channels: fallback.channels,
                reason  : error?.message || 'the Fleet could not read publish switches'
            }
        }
    }

    /**
     * @summary Writes a `(peer, channel)` switch state through the operator-authenticated Fleet path
     * (`bridge.setPublishSwitch`), forwarding `expectedFrom` for optimistic concurrency.
     * @param {Object|null} bridge
     * @param {Object}      params
     * @param {String}      params.peer
     * @param {String}      params.channel
     * @param {String}      params.to
     * @param {String}      params.expectedFrom
     * @param {String}      [params.reason]
     * @returns {Promise<{ok: Boolean, switchRecord?: Object, reason?: String, code?: String}>}
     */
    static async write(bridge, {peer, channel, to, expectedFrom, reason = ''} = {}) {
        const normalizedPeer = PublishSwitch.peerIdOf(peer) || String(peer || ''),
              trimmedReason  = String(reason ?? '').trim();

        if (!PUBLISH_CHANNELS.includes(channel)) {
            return {ok: false, code: 'refused: channel', reason: `Unsupported channel '${String(channel)}'.`}
        }

        if (!PUBLISH_SWITCH_STATES.includes(to)) {
            return {ok: false, code: 'refused: state', reason: `Unsupported switch state '${String(to)}'.`}
        }

        if (!expectedFrom || !PUBLISH_SWITCH_STATES.includes(expectedFrom)) {
            return {ok: false, code: 'refused: expectedFrom', reason: 'expectedFrom is required to change a publish switch.'}
        }

        if (PublishSwitch.isPromotion(expectedFrom, to) && !trimmedReason) {
            return {ok: false, code: 'refused: reason', reason: 'A reason is required to promote a publish switch.'}
        }

        if (typeof bridge?.setPublishSwitch !== 'function') {
            return {ok: false, code: 'not-wired', reason: 'This Fleet does not serve setPublishSwitch yet.'}
        }

        try {
            const answer = await bridge.setPublishSwitch({
                peer  : normalizedPeer,
                channel,
                to,
                expectedFrom,
                reason: trimmedReason || 'operator downgrade'
            });

            if (!answer || answer.ok === false || answer.status === 'rejected' || answer.status === 'not-wired' || answer.refused) {
                return {
                    ok    : false,
                    code  : answer?.refused || answer?.code || answer?.status || 'refused',
                    reason: answer?.reason  || 'The Fleet refused the switch change.'
                }
            }

            const record = answer.switch ?? answer.record ?? answer;
            return {
                ok          : true,
                switchRecord: PublishSwitch.normalizeChannelSwitch(record, normalizedPeer, channel)
            }
        } catch (error) {
            return {
                ok    : false,
                code  : error?.code || 'failed',
                reason: error?.message || 'Could not reach the Fleet. The switch was not changed.'
            }
        }
    }
}

export default Neo.setupClass(PublishSwitch);
