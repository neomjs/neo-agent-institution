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
 * @summary Where a desktop seat's session opened, worded once at two densities: the card names no path,
 * not even in its title; Detail's one line shortens where the session opened and points at the
 * Repository pane for the expected folder.
 */
test.describe('AgentOS.util.SeatSessionFolder', () => {
    const
        expected = '/Users/vega/agents/vega/neomjs/neo',
        observed = '/Users/vega/Desktop/scratch';

    test('the card says a wrong folder short, with one next-action word, and no path in its text or title', () => {
        const line = SeatSessionFolder.cardLine({state: 'wrong', expected, observed});

        expect(line.text).toBe('session opened in the wrong folder · reopen');
        expect(`${line.text} ${line.title}`).not.toContain('/Users')
    });

    test('Detail shortens where the session opened and never repeats the expected folder', () => {
        const line = SeatSessionFolder.detailLine({state: 'wrong', expected, observed});

        expect(line.state).toBe('wrong folder');
        expect(line.text).toBe('opened in …/Desktop/scratch · expected the repository below · reopen it there');
        expect(`${line.text} ${line.title}`).not.toContain(expected);
        expect(SeatSessionFolder.shortPath('/a/b')).toBe('/a/b');
        expect(SeatSessionFolder.shortPath('/a/b/c/d')).toBe('…/c/d')
    });

    test('pending and unknown read as themselves with their reasons, never as ready', () => {
        expect(SeatSessionFolder.cardLine({state: 'pending', expected}).text).toBe('session not opened yet · open the folder');
        expect(SeatSessionFolder.detailLine({state: 'pending', expected}).state).toBe('not opened yet');

        const unknown = {state: 'unknown', expected, reason: 'the session records could not be read'};

        expect(SeatSessionFolder.cardLine(unknown).text).toBe('session folder unknown: the session records could not be read');
        expect(SeatSessionFolder.detailLine(unknown).text).toBe('the session records could not be read · expected the repository below')
    });

    test('ok, a missing fact and an unrecognised state say nothing', () => {
        for (const folder of [{state: 'ok', expected}, null, undefined, {state: 'later'}]) {
            expect(SeatSessionFolder.cardLine(folder)).toBeNull();
            expect(SeatSessionFolder.detailLine(folder)).toBeNull()
        }
    })
});
