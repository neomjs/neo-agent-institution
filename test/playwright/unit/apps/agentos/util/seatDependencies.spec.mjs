import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'SeatDependenciesTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import SeatDependencies from '../../../../../../apps/agentos/util/SeatDependencies.mjs';

/**
 * @summary Each checkout's dependency row from a Fleet Start, worded once: the card speaks only for a
 * running seat's working checkout the last start did not prepare, and the Repository pane gives every
 * checkout its own word, the dependency row first.
 */
test.describe('AgentOS.util.SeatDependencies', () => {
    const
        working = 'neomjs/neo',
        brain   = 'neomjs/neo-agent-brain',
        npm     = 'npm ci exited 1: ERESOLVE could not resolve dependency tree';

    test('the card warns for the working checkout\'s skipped, failed, unverified and canceled rows, with the row and its reason in the title', () => {
        for (const [state, reason, word] of [
            ['skipped',    'skipped during the install',                          'Skipped'],
            ['failed',     npm,                                                   'Failed'],
            ['unverified', 'the checkout is not a current repository assignment', 'Unverified'],
            ['canceled',   'stopped during the install',                          'Canceled']
        ]) {
            const line = SeatDependencies.cardLine([{repoSlug: working, state, reason}], working);

            expect(line.text).toBe('skills not verified');
            expect(line.title).toBe(`Skills not verified. The working checkout ${working} reads ${word} after the last start (${reason}). Detail › Repositories shows each checkout.`)
        }

        expect(SeatDependencies.cardLine([{repoSlug: working, state: 'unverified'}], working).title)
            .toBe(`Skills not verified. The working checkout ${working} reads Unverified after the last start. Detail › Repositories shows each checkout.`)
    });

    test('a prepared working checkout, no preparation step, an install still running, or an unknown state say nothing on the card', () => {
        for (const state of ['installed', 'present', 'not-applicable', 'installing', 'queued']) {
            expect(SeatDependencies.cardLine([{repoSlug: working, state}], working)).toBeNull()
        }
    });

    test('the card finds the working checkout by its slug, never by position, and another repository\'s failure stays off it', () => {
        // a live report leaves undecided rows out, so the first row need not be the working checkout
        expect(SeatDependencies.cardLine([{repoSlug: brain, state: 'failed', reason: npm}, {repoSlug: working, state: 'installed'}], working)).toBeNull();
        expect(SeatDependencies.cardLine([{repoSlug: brain, state: 'installed'}, {repoSlug: working, state: 'skipped'}], working).text).toBe('skills not verified');

        // a working repository changed since that start has no row of its own: unknown, so nothing
        expect(SeatDependencies.cardLine([{repoSlug: brain, state: 'failed', reason: npm}], working)).toBeNull()
    });

    test('missing data says nothing: no rows, an older Brain\'s null, or no working repository', () => {
        for (const [rows, repoSlug] of [[null, working], [undefined, working], [[], working], [[{repoSlug: working, state: 'failed'}], null]]) {
            expect(SeatDependencies.cardLine(rows, repoSlug)).toBeNull()
        }
    });

    test('the pane folds the dependency row first, never older than the clone; without one a failed clone reads failed and a prepared clone unverified', () => {
        const cloneFailure = 'git clone exited 128: remote: Repository not found.';

        // installed and present are both prepared; a note on an install stays with it
        expect(SeatDependencies.paneRow({state: 'prepared'}, {state: 'installed'})).toEqual({state: 'prepared', reason: null});
        expect(SeatDependencies.paneRow(null, {state: 'present'})).toEqual({state: 'prepared', reason: null});
        expect(SeatDependencies.paneRow(null, {state: 'installed', reason: 'the seat receipt could not record it'})).toEqual({state: 'prepared', reason: 'the seat receipt could not record it'});
        // every other state keeps its own word and reason
        for (const state of ['installing', 'skipped', 'canceled', 'failed', 'unverified', 'not-applicable']) {
            expect(SeatDependencies.paneRow({state: 'prepared'}, {state, reason: 'why'})).toEqual({state, reason: 'why'})
        }
        // the previous launch's clone failure never speaks over this start's row
        expect(SeatDependencies.paneRow({state: 'failed', reason: cloneFailure}, {state: 'installing'})).toEqual({state: 'installing', reason: null});
        expect(SeatDependencies.paneRow({state: 'failed', reason: cloneFailure}, {state: 'installed'})).toEqual({state: 'prepared', reason: null});
        // no dependency row: a failed clone had nothing installed, and a prepared one had no install reported
        expect(SeatDependencies.paneRow({state: 'failed', reason: cloneFailure}, null)).toEqual({state: 'failed', reason: cloneFailure});
        expect(SeatDependencies.paneRow({state: 'prepared'}, null)).toEqual({state: 'unverified', reason: 'no dependency install reported'});
        expect(SeatDependencies.paneRow(undefined, undefined)).toEqual({state: null, reason: null})
    });

    test('the panes\' rows: the reported checkouts in their order, then each repository known only from its clone unless a Start installs; an unknown state is left out', () => {
        const cloneFailure = 'git clone exited 128: remote: Repository not found.';

        expect(SeatDependencies.checkouts(
            [{repoSlug: working, state: 'installed'}, {repoSlug: brain, state: 'queued'}, {repoSlug: 'neomjs/create-app', state: 'skipped', reason: 'skipped during the install'}],
            [{repoSlug: brain, state: 'prepared'}, {repoSlug: 'neomjs/neo-agent-institution', state: 'failed', reason: cloneFailure}]
        )).toEqual([
            {repoSlug: working,                        state: 'prepared', reason: null},
            {repoSlug: 'neomjs/create-app',            state: 'skipped',  reason: 'skipped during the install'},
            {repoSlug: 'neomjs/neo-agent-institution', state: 'failed',   reason: cloneFailure}
        ]);

        // while a Start installs, the clones are the previous launch's: the rows are this start's alone
        const previous = [{repoSlug: brain, state: 'failed', reason: cloneFailure}, {repoSlug: 'neomjs/neo-agent-institution', state: 'prepared'}];

        expect(SeatDependencies.checkouts([{repoSlug: working, state: 'installed'}, {repoSlug: brain, state: 'installing'}], previous)).toEqual([
            {repoSlug: working, state: 'prepared',   reason: null},
            {repoSlug: brain,   state: 'installing', reason: null}
        ]);
        // once it ends, a repository known only from its clone is back, and a prepared clone claims nothing
        expect(SeatDependencies.checkouts([{repoSlug: working, state: 'installed'}], previous)).toEqual([
            {repoSlug: working,                        state: 'prepared',   reason: null},
            {repoSlug: brain,                          state: 'failed',     reason: cloneFailure},
            {repoSlug: 'neomjs/neo-agent-institution', state: 'unverified', reason: 'no dependency install reported'}
        ]);

        for (const [dependencies, clones] of [[null, null], [undefined, []], [[{state: 'installed'}], null]]) {
            expect(SeatDependencies.checkouts(dependencies, clones)).toEqual([])
        }
    });

    test('a live Start counts its reported checkouts and names each row; a retained set, with nothing installing, is never live (#616)', () => {
        expect(SeatDependencies.liveLine([
            {repoSlug: working, state: 'installing'},
            {repoSlug: brain,   state: 'present'},
            {repoSlug: 'neomjs/create-app', state: 'failed', reason: npm}
        ])).toEqual({
            done : 2,
            text : 'preparing dependencies (2/3 done)',
            title: `${working}: installing · ${brain}: prepared · neomjs/create-app: failed`,
            total: 3
        });

        for (const rows of [null, [], [{repoSlug: working, state: 'installed'}, {repoSlug: brain, state: 'canceled'}], [{state: 'installing'}]]) {
            expect(SeatDependencies.liveLine(rows)).toBeNull()
        }
    });

    test('the pane\'s words: prepared is never claimed for a skipped, canceled or unverified checkout, and an unknown state has none', () => {
        expect(['prepared', 'installing', 'skipped', 'canceled', 'failed', 'unverified', 'not-applicable'].map(SeatDependencies.label))
            .toEqual(['Prepared', 'Installing', 'Skipped', 'Canceled', 'Failed', 'Unverified', 'No preparation step']);

        for (const state of [null, undefined, 'installed', 'queued']) {
            expect(SeatDependencies.label(state)).toBeNull()
        }
    })
});
