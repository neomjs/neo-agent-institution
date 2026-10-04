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
 *
 * The card names no path, not even in its title: a path is Detail's, where the Repository pane shows
 * the expected folder whole with Copy path. Detail's Seat row adds only where the session opened,
 * shortened to one line.
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
     * @summary The card's line, short enough for the narrowest card, and its title.
     * @param {Object|null} sessionFolder
     * @returns {{text: String, title: String}|null} `null` when there is nothing to say.
     */
    static cardLine(sessionFolder) {
        const reason = sessionFolder?.reason;

        return {
            pending: {
                text : 'session not opened yet · open the folder',
                title: 'No session has opened since the launch. Open the seat\'s folder in Claude\'s Code tab: Detail shows it.'
            },
            unknown: {
                text : `session folder unknown: ${reason}`,
                title: `Where the session opened is unknown: ${reason}.`
            },
            wrong: {
                text : 'session opened in the wrong folder · reopen',
                title: 'The session opened outside the seat\'s folder, so it loads none of its servers, memory or hooks. Detail shows where; reopen it in the seat\'s folder in Claude\'s Code tab.'
            }
        }[sessionFolder?.state] ?? null
    }

    /**
     * @summary The Detail Seat row's one line: the state word, the rest, and its full words as the title.
     * The expected folder is the Repository pane's, so the line points at it rather than repeating it.
     * @param {Object|null} sessionFolder
     * @returns {{state: String, text: String, title: String}|null} `null` when there is nothing to say.
     */
    static detailLine(sessionFolder) {
        const {observed, reason, state} = sessionFolder || {};

        return {
            pending: {
                state: 'not opened yet',
                text : 'expected the repository below · open it in Claude\'s Code tab',
                title: 'No session has opened since the launch. Open the repository below in Claude\'s Code tab.'
            },
            unknown: {
                state: 'folder unknown',
                text : `${reason} · expected the repository below`,
                title: `Where the session opened is unknown: ${reason}. Check which folder Claude's Code tab opened.`
            },
            wrong: {
                state: 'wrong folder',
                text : `opened in ${SeatSessionFolder.shortPath(observed)} · expected the repository below · reopen it there`,
                title: `Opened in ${observed}; expected the repository below. Reopen it there in Claude's Code tab and continue.`
            }
        }[state] ?? null
    }

    /**
     * @summary A folder short enough for one line: its last two segments after an ellipsis.
     * @param {String} path
     * @returns {String}
     */
    static shortPath(path) {
        const parts = String(path ?? '').split('/').filter(Boolean);

        return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : String(path ?? '')
    }
}

export default Neo.setupClass(SeatSessionFolder);
