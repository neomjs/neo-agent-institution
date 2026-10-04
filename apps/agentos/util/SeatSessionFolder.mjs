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
 * The card names no path, not even in its title. Paths are Detail's, and Detail says each one once:
 * its Seat row carries only the state word, and the Repository pane carries the full words under its
 * clone path. The launch's `expected` folder is the verdict's authority, because the repository can
 * change or be cleared while that launch runs.
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
     * @summary The Detail Seat row's state word. The row stays compact; the Repository pane says the rest.
     * @param {Object|null} sessionFolder
     * @returns {String|null} `null` when there is nothing to say.
     */
    static stateWord(sessionFolder) {
        return {pending: 'not opened yet', unknown: 'folder unknown', wrong: 'wrong folder'}[sessionFolder?.state] ?? null
    }

    /**
     * @summary The Repository pane's words under its clone path: what happened, every folder whole, and
     * the next step. The pane's path stands for the launch's folder only while the two are the same.
     * Otherwise the words name the launch's folder, and offer a Restart into the repository the pane
     * shows, since a Restart provisions from the current repository.
     * @param {Object|null} sessionFolder
     * @param {String|null} repoPath The clone path the pane shows, or `null` when none is declared.
     * @returns {String|null} `null` when there is nothing to say.
     */
    static paneText(sessionFolder, repoPath) {
        if (!SeatSessionFolder.stateWord(sessionFolder)) return null;

        const
            {expected, observed, reason, state} = sessionFolder,
            here   = repoPath === expected,
            folder = here ? 'this folder' : 'that folder',
            what   = {
                pending: 'No session has opened since the launch.',
                unknown: `Where the session opened is unknown: ${reason}.`,
                wrong  : `The session opened in ${observed}, so it loads none of the seat's servers, memory or hooks.`
            }[state],
            step   = {
                pending: `Open ${folder} in Claude's Code tab`,
                unknown: `Check that Claude's Code tab has ${folder} open`,
                wrong  : `Reopen ${folder} in Claude's Code tab`
            }[state];

        return here
            ? `${what} ${step}.`
            : `${what} This launch expected ${expected}. ${step}${repoPath ? ', or Restart it on the card to launch in this repository' : ''}.`
    }
}

export default Neo.setupClass(SeatSessionFolder);
