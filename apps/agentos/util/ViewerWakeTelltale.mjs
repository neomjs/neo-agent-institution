import Base           from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import AgentFreshness from './AgentFreshness.mjs';

/**
 * @module apps/agentos/util/ViewerWakeTelltale
 * @summary Pure derivation for the cockpit chrome's per-viewer wake-push telltale — the quiet
 * readout of MY push lane's health, a different axis from every existing surface: the spine banner
 * speaks for the fleet transport, the per-agent telltales for each resident's wake ROUTE, and this
 * chip for the viewer's own live stream. Push is latency, poll is truth — so a degraded push lane
 * is a quiet reason here, never a spine incident.
 *
 * Vocabulary is the consumer's, verbatim ({@link module:apps/agentos/fleet/fleetWakeStreamConsumer}
 * `resolveDeliveryLiveness`): `alive: true` is the only positive state; everything else is
 * `unknown` WITH the consumer's own reason — absence of signal, never a fabricated verdict. The
 * catch-up axis keeps its three states apart by construction (`fresh` ≠ `empty` ≠ `failed`), and
 * an absent observation renders as absence (`no catch-up observation`), never borrowed `unknown` —
 * the same tri-state honesty the card telltales pinned.
 */

/**
 * Static viewer-wake telltale derivation utilities.
 * @class AgentOS.util.ViewerWakeTelltale
 * @extends Neo.core.Base
 */
class ViewerWakeTelltale extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.ViewerWakeTelltale'
         * @protected
         */
        className: 'AgentOS.util.ViewerWakeTelltale'
    }

    /**
     * @summary Derives the telltale chip from the provider-held viewer-wake truths.
     *
     * The chip renders only when the viewer's push lane is armed (`armed === true`) or has been
     * alive earlier in this session without an explicit unarmed verdict (`armed !== false && everAlive`).
     * For an unarmed viewer, `hidden` is `true` while `title` and diagnostics detail retain the reason.
     *
     * @param {Object} [options={}]
     * @param {Boolean|null} [options.armed=null] Whether the fleet server armed push for this viewer.
     * @param {Boolean} [options.everAlive=false] Whether push has been armed and live this session.
     * @param {Object|null} [options.stream=null] `{alive: true|'unknown', reason, capturedAt}`.
     * @param {Object|null} [options.catchUp=null] `{state: 'fresh'|'failed'|'empty', at, pending}` or `null`.
     * @param {Object[]} [options.signals=[]] Newest-first `{kind, emittedAt, receivedAt}` rows.
     * @param {Number} [options.nowMs=Date.now()] Injectable clock for relative labels.
     * @returns {{ariaLabel: String, cls: String[], hidden: Boolean, text: String, title: String}}
     */
    static describeViewerWakeTelltale({armed = null, everAlive = false, stream = null, catchUp = null, signals = [], nowMs = Date.now()} = {}) {
        const
            visible    = armed === true || (armed !== false && everAlive === true),
            live       = armed === true && stream?.alive === true,
            reason     = typeof stream?.reason === 'string' && stream.reason.trim() ? stream.reason : 'no stream observation',
            lastSignal = signals[0] ?? null;

        let text;

        if (live) {
            const relative = Number.isFinite(lastSignal?.receivedAt) ? ` · ${AgentFreshness.formatAge(nowMs - lastSignal.receivedAt)}` : '';

            text = `wake live${relative}`
        } else {
            text = 'wake off'
        }

        const catchUpLine = catchUp
            ? `catch-up: ${catchUp.state}${Number.isFinite(catchUp.pending) && catchUp.pending > 0 ? ` (${catchUp.pending} pending drained)` : ''}${Number.isFinite(catchUp.at) ? ` · ${AgentFreshness.formatAge(nowMs - catchUp.at)}` : ''}`
            : 'catch-up: no observation';

        const signalLines = signals.slice(0, 5).map(signal =>
            `${signal.kind ?? 'wake'}${Number.isFinite(signal.receivedAt) ? ` · ${AgentFreshness.formatAge(nowMs - signal.receivedAt)}` : ''}`);

        const title = [
            live ? `wake push live — ${reason}` : `wake push unavailable — ${reason}`,
            catchUpLine,
            signalLines.length ? `last signals: ${signalLines.join(' | ')}` : 'no signals observed on this stream'
        ].join('\n');

        return {
            ariaLabel: live ? `Viewer wake push: ${text}` : `Viewer wake push: ${text} — ${reason}`,
            cls      : ['fm-viewer-wake', live ? 'fm-viewer-wake-live' : 'fm-viewer-wake-degraded'],
            hidden   : !visible,
            text,
            title
        }
    }
}

export default Neo.setupClass(ViewerWakeTelltale);
