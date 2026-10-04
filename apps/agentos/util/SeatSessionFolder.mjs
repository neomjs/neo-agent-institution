import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary Where a Claude Desktop seat's session opened, against the folder it should have opened in,
 * worded once for the card and for Detail. The fact is the roster row's `sessionFolder`:
 * `{state: 'pending'|'ok'|'wrong'|'unknown', expected, observed?, reason?}`, with `observed` only for
 * `wrong` and `reason` only for `unknown`.
 *
 * Desktop cannot be launched into a folder, so a session can open elsewhere while the launch reads
 * green, and that session loads none of the seat's servers, memory or hooks. These words are where the
 * operator learns it. `ok`, and a row that reports no fact, say nothing.
 * @class AgentOS.util.SeatSessionFolder
 * @extends Neo.core.Base
 */
class SeatSessionFolder extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.SeatSessionFolder'
         * @protected
         */
        className: 'AgentOS.util.SeatSessionFolder'
    }

    /**
     * @summary The card's line, short enough for the narrowest card, with its full words as the title.
     * @param {Object|null} sessionFolder
     * @returns {{text: String, title: String}|null} `null` when there is nothing to say.
     */
    static cardLine(sessionFolder) {
        const detail = SeatSessionFolder.detailLine(sessionFolder);

        if (!detail) {
            return null
        }

        const text = {
            pending: 'session not opened yet · open the folder',
            unknown: `session folder unknown: ${sessionFolder.reason}`,
            wrong  : 'session opened in the wrong folder · reopen'
        }[sessionFolder.state];

        return {text, title: `${detail.text}. ${detail.action}`}
    }

    /**
     * @summary The Detail Seat row's line and its next action, spelled out.
     * @param {Object|null} sessionFolder
     * @returns {{text: String, action: String}|null} `null` when there is nothing to say.
     */
    static detailLine(sessionFolder) {
        const {expected, observed, reason, state} = sessionFolder || {};

        return {
            pending: {
                text  : `no session has opened since the launch · expected ${expected}`,
                action: 'Open the expected folder in Claude\'s Code tab.'
            },
            unknown: {
                text  : `the session's folder is unknown: ${reason} · expected ${expected}`,
                action: 'Check which folder Claude\'s Code tab opened.'
            },
            wrong: {
                text  : `opened in ${observed} · expected ${expected}`,
                action: 'Open the expected folder in Claude\'s Code tab and continue there.'
            }
        }[state] ?? null
    }
}

export default Neo.setupClass(SeatSessionFolder);
