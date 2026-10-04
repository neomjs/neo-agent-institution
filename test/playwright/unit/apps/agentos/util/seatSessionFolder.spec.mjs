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
 * @summary Where a desktop seat's session opened, worded once at two densities: the card's short line
 * with its full words as the title, and the Detail Seat row's line with its next action.
 */
test.describe('AgentOS.util.SeatSessionFolder', () => {
    const expected = '/seats/vega/neomjs/neo';

    test('a session in another folder names both folders in Detail, and the card says it short with one next-action word', () => {
        const folder = {state: 'wrong', expected, observed: '/Users/vega/elsewhere'};

        expect(SeatSessionFolder.detailLine(folder)).toEqual({
            text  : `opened in /Users/vega/elsewhere · expected ${expected}`,
            action: 'Open the expected folder in Claude\'s Code tab and continue there.'
        });
        expect(SeatSessionFolder.cardLine(folder)).toEqual({
            text : 'session opened in the wrong folder · reopen',
            title: `opened in /Users/vega/elsewhere · expected ${expected}. Open the expected folder in Claude's Code tab and continue there.`
        })
    });

    test('pending and unknown read as themselves with their reasons, never as ready', () => {
        expect(SeatSessionFolder.cardLine({state: 'pending', expected}).text).toBe('session not opened yet · open the folder');
        expect(SeatSessionFolder.detailLine({state: 'pending', expected}).text).toBe(`no session has opened since the launch · expected ${expected}`);

        const unknown = {state: 'unknown', expected, reason: 'the session records could not be read'};

        expect(SeatSessionFolder.cardLine(unknown).text).toBe('session folder unknown: the session records could not be read');
        expect(SeatSessionFolder.detailLine(unknown).text).toBe(`the session's folder is unknown: the session records could not be read · expected ${expected}`)
    });

    test('ok, a missing fact and an unrecognised state say nothing', () => {
        for (const folder of [{state: 'ok', expected}, null, undefined, {state: 'later'}]) {
            expect(SeatSessionFolder.cardLine(folder)).toBeNull();
            expect(SeatSessionFolder.detailLine(folder)).toBeNull()
        }
    })
});
