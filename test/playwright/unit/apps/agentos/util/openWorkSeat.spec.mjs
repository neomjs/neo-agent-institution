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

    test('explicit producer actions own the card and detail words, even when CI alone suggests another action', () => {
        const actions = [
            ['repair-ci',       'red',               'author',   'red',               'green'],
            ['address-changes', 'changes-requested', 'author',   'changes requested', 'red'],
            ['rebase',          'rebase',            'author',   'rebase required',   'green'],
            ['review',          'review-due',        'reviewer', 'review due',        'green'],
            ['route-review',    'route-review',      'author',   'request review',    'red']
        ];

        actions.forEach(([kind, displayKind, role, words, ci], index) => {
            const answer = held([row(index + 1, {kind, role, ids: [ada]}, {ci, observedAt: '2026-10-03T08:00:00.000Z'})]),
                entry    = OpenWorkSeat.held(answer, ada).rows[0],
                chip     = OpenWorkSeat.describe(OpenWorkSeat.summarize(answer, ada)),
                detail   = OpenWorkSeat.describeRow(entry, Date.parse('2026-10-03T08:03:00.000Z'));

            expect(entry.kind, kind).toBe(displayKind);
            expect(chip.text, kind).toBe(`1 PR · ${words}`);
            expect(chip.ariaLabel, kind).toBe(`Open work: 1 pull request waiting on this seat, worst: ${words}.`);
            expect(chip.title, kind).toBe(`1 pull request waiting on this seat · worst: ${words}`);
            expect(detail.line, kind).toBe(`${role} · ${words} · observed 3m ago`)
        })
    });

    test('unsupported string kinds remain held and counted, with neutral words below known actions', () => {
        ['', 'future-action', 'constructor', '__proto__'].forEach(kind => {
            const unknown = row(2, {kind, role: 'author', ids: [ada]}, {ci: 'green'}),
                red       = row(1, {kind: 'repair-ci', role: 'author', ids: [ada]}, {ci: 'red'}),
                answer    = held([unknown, red]),
                entries   = OpenWorkSeat.held(answer, ada).rows,
                summary   = OpenWorkSeat.summarize(answer, ada);

            expect(OpenWorkSeat.kindOf(unknown, ada), kind).toBe('unknown');
            expect(entries.map(entry => entry.kind), kind).toEqual(['red', 'unknown']);
            expect(summary, kind).toMatchObject({count: 2, worst: 'red'});
            expect(OpenWorkSeat.describe(summary).text, kind).toBe('2 PRs · red');
            expect(OpenWorkSeat.describe(summary).ariaLabel, kind).toBe('Open work: 2 pull requests waiting on this seat, worst: red.');
            expect(OpenWorkSeat.describeRow(entries[1]).line, kind).toBe('author · next action unknown');
            expect(OpenWorkSeat.describe(OpenWorkSeat.summarize(held([unknown]), ada)).text, kind)
                .toBe('1 PR · next action unknown')
        })
    });

    test('explicit null or non-string kinds and non-seat holders never invent an actionable row', () => {
        const unsupported = [null, undefined, false, 1, {}, []];

        unsupported.forEach(kind => {
            const value = row(1, {kind, role: 'author', ids: [ada]}, {ci: 'green'});
            expect(OpenWorkSeat.kindOf(value, ada), String(kind)).toBeNull();
            expect(OpenWorkSeat.held(held([value]), ada).rows).toEqual([])
        });
        ['operator', 'rotation', 'none', 'unknown'].forEach(role => {
            expect(OpenWorkSeat.kindOf(row(1, {kind: 'route-review', role, ids: [ada]}), ada), role).toBeNull()
        });
        expect(OpenWorkSeat.kindOf(row(1, {kind: 'rebase', role: 'author', ids: ['@neo-gpt']}), ada)).toBeNull();

        // The property is absent on legacy producer rows; that is distinct from explicit null/unknown.
        expect(OpenWorkSeat.kindOf(row(1, {role: 'author', ids: [ada]}, {ci: 'green'}), ada)).toBe('changes-requested');
        expect(OpenWorkSeat.kindOf(row(1, {role: 'reviewer', ids: [ada]}), ada)).toBe('review-due')
    });

    test('mixed explicit kinds share one rank while preserving deduplication and stale age', () => {
        const observedAt = '2026-10-03T07:40:00.000Z', now = Date.parse('2026-10-03T08:00:00.000Z'),
            routing      = row(5, {role: 'author', kind: 'route-review', ids: [ada]}, {ci: 'green'}),
            review       = row(4, {role: 'reviewer', kind: 'review', ids: [ada]}),
            rebase       = row(3, {role: 'author', kind: 'rebase', ids: [ada]}, {ci: 'green', stale: true, observedAt}),
            changes      = row(2, {role: 'author', kind: 'address-changes', ids: [ada]}, {ci: 'green'}),
            repair       = row(1, {role: 'author', kind: 'repair-ci', ids: [ada]}, {ci: 'red'}),
            unknown      = row(6, {role: 'author', kind: 'future-action', ids: [ada]}),
            answer       = held([unknown, routing, rebase, changes, repair], [review, rebase]),
            entries      = OpenWorkSeat.held(answer, ada),
            summary      = OpenWorkSeat.summarize(answer, ada);

        expect(entries.rows.map(entry => entry.kind)).toEqual(['red', 'changes-requested', 'rebase', 'review-due', 'route-review', 'unknown']);
        expect(summary).toEqual({count: 6, worst: 'red', stale: true, observedAt});
        expect(OpenWorkSeat.describe(summary, now).title).toBe('6 pull requests waiting on this seat · worst: red · stale · observed 20m ago');
        expect(OpenWorkSeat.describeRow(entries.rows[2], now).line).toBe('author · rebase required · observed 20m ago · stale');
        expect(OpenWorkSeat.describeRow(entries.rows[4], now).line).toBe('author · request review')
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

    test('the chip ages from the oldest held row, not from a fresher envelope', () => {
        const
            fresh = row(1, {role: 'author', ids: [ada]}, {ci: 'red', observedAt: '2026-10-03T07:58:00.000Z'}),
            stale = row(2, {role: 'reviewer', ids: [ada]}, {observedAt: '2026-10-03T07:40:00.000Z', stale: true});

        // the envelope pulsed at 08:00; the row that makes the chip stale was last seen at 07:40
        expect(OpenWorkSeat.summarize(held([fresh], [stale]), ada)).toEqual({count: 2, worst: 'red', stale: true, observedAt: '2026-10-03T07:40:00.000Z'});

        // rows that carry no observation of their own age from the envelope
        expect(OpenWorkSeat.summarize(held([row(3, {role: 'author', ids: [ada]})]), ada).observedAt).toBe('2026-10-03T08:00:00.000Z')
    });

    test('held lists the seat\'s rows worst first, tells nothing held from no answer, and summarize counts the same rows', () => {
        const
            review = row(3, {role: 'reviewer', ids: [ada]}, {repo: 'neomjs/neo-agent-brain', observedAt: '2026-10-03T07:50:00.000Z'}),
            change = row(2, {role: 'author', ids: [ada]}, {ci: 'pending', title: 'feat: the pane reads open work'}),
            red    = row(1, {role: 'author', ids: [ada]}, {ci: 'red', stale: true}),
            answer = held([change, red], [review]);

        expect(OpenWorkSeat.held(answer, ada)).toEqual({
            rows: [
                {id: 'neomjs/neo#1',             kind: 'red',               number: 1, observedAt: null,                       repo: 'neomjs/neo',             role: 'author',   stale: true,  title: null},
                {id: 'neomjs/neo#2',             kind: 'changes-requested', number: 2, observedAt: null,                       repo: 'neomjs/neo',             role: 'author',   stale: false, title: 'feat: the pane reads open work'},
                {id: 'neomjs/neo-agent-brain#3', kind: 'review-due',        number: 3, observedAt: '2026-10-03T07:50:00.000Z', repo: 'neomjs/neo-agent-brain', role: 'reviewer', stale: false, title: null}
            ],
            stale     : true,
            observedAt: '2026-10-03T07:50:00.000Z'
        });
        expect(OpenWorkSeat.summarize(answer, ada)).toEqual({count: 3, worst: 'red', stale: true, observedAt: '2026-10-03T07:50:00.000Z'});

        // an answer that lists nothing for the seat holds nothing; no answer is no answer
        expect(OpenWorkSeat.held(held(), '@neo-gpt')).toEqual({rows: [], stale: false, observedAt: '2026-10-03T08:00:00.000Z'});
        expect(OpenWorkSeat.held(held([row(4, {role: 'operator', ids: []})]), ada).rows).toEqual([]);
        expect(OpenWorkSeat.held(null, ada), 'unanswered').toBeNull();
        expect(OpenWorkSeat.held(held([red], [], {state: 'unavailable'}), ada), 'unavailable').toBeNull();
        expect(OpenWorkSeat.held(answer, null), 'a seat without an identity').toBeNull()
    });

    test('describeRow words one held row in the chip\'s vocabulary, and its link comes from the row\'s own fields', () => {
        const now = Date.parse('2026-10-03T08:07:00.000Z');

        expect(OpenWorkSeat.describeRow({kind: 'red', number: 504, observedAt: '2026-10-03T08:04:00.000Z', repo: 'neomjs/neo-agent-institution', role: 'author', stale: false, title: 'fix: the card names no path'}, now)).toEqual({
            href : 'https://github.com/neomjs/neo-agent-institution/pull/504',
            ref  : 'neomjs/neo-agent-institution #504',
            title: 'fix: the card names no path',
            line : 'author · red · observed 3m ago'
        });
        expect(OpenWorkSeat.describeRow({kind: 'review-due', number: 7, observedAt: null, repo: 'neomjs/neo', role: 'reviewer', stale: true}, now).line)
            .toBe('reviewer · review due · stale');
        expect(OpenWorkSeat.PANE_WORDS).toEqual({none: 'no pull request waits on this seat', unanswered: 'open-work read unanswered'})
    });

    test('describe words the chip as one unit: text, aria-label and title from the same facts', () => {
        expect(OpenWorkSeat.describe(null)).toEqual({hidden: true, stale: false, text: '', ariaLabel: null, title: null});

        expect(OpenWorkSeat.describe({count: 1, worst: 'review-due', stale: false, observedAt: null})).toEqual({
            hidden   : false,
            stale    : false,
            text     : '1 PR · review due',
            ariaLabel: 'Open work: 1 pull request waiting on this seat, worst: review due.',
            title    : '1 pull request waiting on this seat · worst: review due'
        });

        const now   = Date.parse('2026-10-03T08:07:00.000Z'),
              stale = OpenWorkSeat.describe({count: 3, worst: 'red', stale: true, observedAt: '2026-10-03T08:00:00.000Z'}, now);

        expect(stale.text).toBe('3 PRs · red');
        expect(stale.stale).toBe(true);
        expect(stale.title).toBe('3 pull requests waiting on this seat · worst: red · stale · observed 7m ago');
        expect(stale.ariaLabel).toBe('Open work: 3 pull requests waiting on this seat, worst: red, stale.')
    });
});
