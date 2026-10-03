import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'OpenWorkSeatTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import OpenWorkSeat from '../../../../../../apps/agentos/util/OpenWorkSeat.mjs';

/**
 * @summary One seat's held open work as its roster card shows it: which rows count, the worst first,
 * and the open-lane badge's rule that unknown never poses as zero.
 */
test.describe('AgentOS.util.OpenWorkSeat', () => {
    const
        ada  = '@neo-opus-ada',
        row  = (number, holder, extra = {}) => ({repo: 'neomjs/neo', number, holder, ...extra}),
        held = (authored = [], reviewing = [], extra = {}) => ({
            state     : 'ok',
            observedAt: '2026-10-03T08:00:00.000Z',
            seats     : {[ada]: {authored, reviewing}},
            ...extra
        });

    test('a row counts only when its holder is the author or a requested reviewer naming the seat', () => {
        expect(OpenWorkSeat.kindOf(row(1, {role: 'author', ids: [ada]}, {ci: 'red'}), ada)).toBe('red');
        expect(OpenWorkSeat.kindOf(row(2, {role: 'author', ids: [ada]}, {ci: 'green'}), ada)).toBe('changes-requested');
        expect(OpenWorkSeat.kindOf(row(3, {role: 'reviewer', ids: ['@neo-gpt', ada]}), ada)).toBe('review-due');

        // another seat's turn, and the roles that name nobody
        expect(OpenWorkSeat.kindOf(row(4, {role: 'reviewer', ids: ['@neo-gpt']}), ada)).toBeNull();
        ['operator', 'rotation', 'none', 'unknown'].forEach(role => {
            expect(OpenWorkSeat.kindOf(row(5, {role, ids: []}), ada), role).toBeNull()
        });
        expect(OpenWorkSeat.kindOf(row(6, null), ada)).toBeNull()
    });

    test('the held rows count once each, and the worst is named: red > changes requested > review due', () => {
        const
            red    = row(1, {role: 'author', ids: [ada]}, {ci: 'red'}),
            change = row(2, {role: 'author', ids: [ada]}, {ci: 'pending'}),
            review = row(3, {role: 'reviewer', ids: [ada]});

        expect(OpenWorkSeat.summarize(held([change, red], [review]), ada)).toEqual({count: 3, worst: 'red', stale: false, observedAt: '2026-10-03T08:00:00.000Z'});
        expect(OpenWorkSeat.summarize(held([change], [review]), ada).worst).toBe('changes-requested');
        expect(OpenWorkSeat.summarize(held([], [review]), ada).worst).toBe('review-due');

        // one PR listed twice for the seat is still one PR
        expect(OpenWorkSeat.summarize(held([red], [red]), ada).count).toBe(1)
    });

    test('nothing held, another seat\'s rows, an unknown read or no seat put nothing on the card', () => {
        const operatorRow = row(1, {role: 'operator', ids: []});

        expect(OpenWorkSeat.summarize(held([operatorRow]), ada), 'zero is not chip value').toBeNull();
        expect(OpenWorkSeat.summarize(held([row(2, {role: 'author', ids: [ada]}, {ci: 'red'})], [], {state: 'unavailable'}), ada)).toBeNull();
        expect(OpenWorkSeat.summarize(null, ada), 'unanswered').toBeNull();
        expect(OpenWorkSeat.summarize(held(), null), 'a seat without an identity').toBeNull();
        expect(OpenWorkSeat.summarize(held(), '@neo-gpt'), 'a seat the answer does not list').toBeNull()
    });

    test('a stale read, or one stale row, makes the summary stale', () => {
        const red = row(1, {role: 'author', ids: [ada]}, {ci: 'red'});

        expect(OpenWorkSeat.summarize(held([red], [], {state: 'stale'}), ada).stale).toBe(true);
        expect(OpenWorkSeat.summarize(held([{...red, stale: true}]), ada).stale).toBe(true)
    });

    test('describe words the chip as one unit: text, aria-label and title from the same facts', () => {
        expect(OpenWorkSeat.describe(null)).toEqual({hidden: true, stale: false, text: '', ariaLabel: null, title: null});

        expect(OpenWorkSeat.describe({count: 1, worst: 'review-due', stale: false, observedAt: null})).toEqual({
            hidden   : false,
            stale    : false,
            text     : '1 PR · review due',
            ariaLabel: 'Open work: 1 pull request waiting on this seat, worst review due.',
            title    : '1 pull request waiting on this seat · worst: review due'
        });

        const now   = Date.parse('2026-10-03T08:07:00.000Z'),
              stale = OpenWorkSeat.describe({count: 3, worst: 'red', stale: true, observedAt: '2026-10-03T08:00:00.000Z'}, now);

        expect(stale.text).toBe('3 PRs · red');
        expect(stale.stale).toBe(true);
        expect(stale.title).toBe('3 pull requests waiting on this seat · worst: red · stale · observed 7m ago');
        expect(stale.ariaLabel).toBe('Open work: 3 pull requests waiting on this seat, worst red, stale.')
    });
});
