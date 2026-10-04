import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'SeatSessionFolderTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import SeatSessionFolder from '../../../../../../apps/agentos/util/SeatSessionFolder.mjs';

/**
 * @summary Where a desktop seat's session opened, worded once at each density: the card names no path,
 * not even in its title; Detail's Seat row carries the state word, and the Repository pane the whole
 * words, against the launch's own folder.
 */
test.describe('AgentOS.util.SeatSessionFolder', () => {
    const
        expected = '/Users/vega/agents/vega/neomjs/neo',
        observed = '/Users/vega/Desktop/scratch',
        unknown  = {state: 'unknown', expected, reason: 'the session records could not be read'};

    test('the card says a wrong folder short, with one next-action word, and no path in its text or title', () => {
        const line = SeatSessionFolder.cardLine({state: 'wrong', expected, observed});

        expect(line.text).toBe('session opened in the wrong folder · reopen');
        expect(`${line.text} ${line.title}`).not.toContain('/Users')
    });

    test('pending and unknown read as themselves with their reasons, never as ready', () => {
        expect(SeatSessionFolder.cardLine({state: 'pending', expected}).text).toBe('session not opened yet · open the folder');
        expect(SeatSessionFolder.cardLine(unknown).text).toBe('session folder unknown: the session records could not be read');

        expect(SeatSessionFolder.stateWord({state: 'pending', expected})).toBe('not opened yet');
        expect(SeatSessionFolder.stateWord(unknown)).toBe('folder unknown');
        expect(SeatSessionFolder.stateWord({state: 'wrong', expected, observed})).toBe('wrong folder')
    });

    test('while the repository is the launch\'s folder, the pane calls it this folder and never repeats it', () => {
        expect(SeatSessionFolder.paneText({state: 'wrong', expected, observed}, expected))
            .toBe(`The session opened in ${observed}, so it loads none of the seat's servers, memory or hooks. Reopen this folder in Claude's Code tab.`);
        expect(SeatSessionFolder.paneText({state: 'pending', expected}, expected))
            .toBe("No session has opened since the launch. Open this folder in Claude's Code tab.");
        expect(SeatSessionFolder.paneText(unknown, expected))
            .toBe("Where the session opened is unknown: the session records could not be read. Check that Claude's Code tab has this folder open.")
    });

    test('once the repository changed or was cleared since the launch, the pane names the launch\'s folder, and a Restart only into a repository it shows', () => {
        const other = '/Users/vega/agents/vega/neomjs/other';

        expect(SeatSessionFolder.paneText({state: 'wrong', expected, observed}, other))
            .toBe(`The session opened in ${observed}, so it loads none of the seat's servers, memory or hooks. This launch expected ${expected}. Reopen that folder in Claude's Code tab, or Restart it on the card to launch in this repository.`);
        expect(SeatSessionFolder.paneText({state: 'pending', expected}, other))
            .toBe(`No session has opened since the launch. This launch expected ${expected}. Open that folder in Claude's Code tab, or Restart it on the card to launch in this repository.`);
        expect(SeatSessionFolder.paneText(unknown, null))
            .toBe(`Where the session opened is unknown: the session records could not be read. This launch expected ${expected}. Check that Claude's Code tab has that folder open.`)
    });

    test('ok, a missing fact and an unrecognised state say nothing', () => {
        for (const folder of [{state: 'ok', expected}, null, undefined, {state: 'later'}]) {
            expect(SeatSessionFolder.cardLine(folder)).toBeNull();
            expect(SeatSessionFolder.stateWord(folder)).toBeNull();
            expect(SeatSessionFolder.paneText(folder, expected)).toBeNull()
        }
    })
});
