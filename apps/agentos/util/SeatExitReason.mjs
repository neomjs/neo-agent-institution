import Base       from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import ViewerTime from './ViewerTime.mjs';

const VALID_STATES = new Set(['harness-update', 'unknown']);

/**
 * @summary Why a supervised Fleet seat exited without a `stop(id)` request from Fleet Manager,
 * worded once for the roster card and for Agent Detail. The fact is the roster row's `exitReason`:
 * `{state: 'harness-update'|'unknown', exitedAt, logPath?, matchedLine?, reason?}`.
 *
 * Arbitrary child `stderr` is never status authority (ADR 0038 §2.5.2); the harness's own update
 * marker in `~/Library/Logs/Claude/main.log` within the 60 s before the observed exit is the single
 * named match (`harness-update`), with `unknown` as the default. Intentional Stops and running seats
 * report `null` and say nothing here.
 *
 * @class AgentOS.util.SeatExitReason
 * @extends Neo.core.Base
 */
class SeatExitReason extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.SeatExitReason'
         * @protected
         */
        className: 'AgentOS.util.SeatExitReason'
    }

    /**
     * @summary The stopped seat's unplanned-exit head, line, next step, and single-line log detail,
     * with the observed exit formatted in the reader's clock beside its UTC form.
     * @param {Object|null} exitReason The roster row's `exitReason` object.
     * @param {Object} [options={}] Forwarded to {@link AgentOS.util.ViewerTime#formatViewerTime}.
     * @returns {{detail: (String|null), head: String, line: String, next: String, state: String, text: String, title: String}|null}
     */
    static cardLine(exitReason, options = {}) {
        if (!exitReason || typeof exitReason !== 'object' || Array.isArray(exitReason) || !VALID_STATES.has(exitReason.state)) {
            return null
        }

        const stamp = ViewerTime.formatViewerTime(exitReason.exitedAt, options);

        if (!stamp) return null;

        const
            {state}     = exitReason,
            utcTime     = `${stamp.title.slice(11, 19)}Z`,
            timeText    = `${stamp.text} · ${utcTime}`,
            logPath     = typeof exitReason.logPath === 'string' && exitReason.logPath.trim() ? exitReason.logPath.trim() : null,
            matchedLine = typeof exitReason.matchedLine === 'string' && exitReason.matchedLine.trim() ? exitReason.matchedLine.trim() : null,
            reason      = typeof exitReason.reason === 'string' && exitReason.reason.trim() ? exitReason.reason.trim() : null;

        if (state === 'harness-update') {
            const
                head   = 'stopped · harness update',
                line   = `Claude Desktop quit this seat to install its own update (${timeText}). FM did not stop it, and nothing of its work was stopped on purpose.`,
                next   = 'Start the seat again once the update has finished. If Claude keeps quitting, close every Claude window first so the update can complete.',
                detail = matchedLine && logPath ? `${matchedLine} (${logPath})` : matchedLine ?? logPath,
                text   = `${head} — ${line} ${next}`,
                title  = [text, detail, stamp.title].filter(Boolean).join(' · ');

            return {detail, head, line, next, state, text, title}
        }

        const
            head   = 'stopped · reason unknown',
            line   = reason
                ? `The seat's process exited at ${timeText} without a Stop from FM, and its harness log could not be read: ${reason}.`
                : `The seat's process exited at ${timeText} without a Stop from FM, and its harness log names no reason.`,
            next   = 'Start the seat. If it exits again, read its harness log before a third Start.',
            detail = logPath,
            text   = `${head} — ${line} ${next}`,
            title  = [text, detail, stamp.title].filter(Boolean).join(' · ');

        return {detail, head, line, next, state, text, title}
    }

    /**
     * @summary The full Detail wording, including the quoted single matched log line and `logPath`
     * when present.
     * @param {Object|null} exitReason The roster row's `exitReason` object.
     * @param {Object} [options={}] Forwarded to {@link AgentOS.util.ViewerTime#formatViewerTime}.
     * @returns {String|null}
     */
    static detailText(exitReason, options = {}) {
        const described = SeatExitReason.cardLine(exitReason, options);

        if (!described) return null;

        return [described.text, described.detail].filter(Boolean).join(' · ')
    }
}

export default Neo.setupClass(SeatExitReason);
