import {setup} from '../../../../../setup.mjs';

const appName = 'SeatRootContainerTest';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: appName, isMounted: () => true, vnodeInitialising: false}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                          '../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import SeatRootContainer from '../../../../../../../apps/agentos/view/system/SeatRootContainer.mjs';
import SeatRootController from '../../../../../../../apps/agentos/view/system/SeatRootController.mjs';

const
    root = '/Users/example/Seats',
    plan = () => ({
        state      : 'planned',
        from       : root,
        to         : '/Users/example/Seats-v2',
        fingerprint: 'a'.repeat(64),
        rows       : [{id: 'ada', seatHome: `${root}/ada`, destination: `/Users/example/Seats-v2/ada`, state: 'copy', materialized: true}, {
            id: 'sophie', seatHome: `${root}/sophie`, destination: `${root}/sophie`, state: 'untouched', materialized: true, reason: 'already bound to this home'
        }]
    }),
    makePanel = () => Neo.create(SeatRootContainer, {appName});

test.describe('AgentOS.view.system.SeatRootContainer (#582)', () => {
    test('mount starts a status read without planning or consenting to a move', () => {
        const
            calls = [],
            oldNeo = globalThis.Neo;

        globalThis.Neo = {...oldNeo, main: {addon: {ShellPlane: {
            seatRootStatus: async () => { calls.push('status'); return {packaged: false, root: null, pending: null, outcome: null} },
            seatRootPlan  : () => calls.push('plan'),
            seatRootConsent: () => calls.push('consent')
        }}}};

        const panel = makePanel();

        try {
            expect(panel.busy).toBe('status');
            expect(panel.plan).toBeNull();
            expect(calls).toEqual(['status']);
            expect(panel.getReference('consent').hidden).toBe(true)
        } finally {
            panel.destroy();
            globalThis.Neo = oldNeo
        }
    });

    test('a fresh plan keeps untouched rows visible and consents with only its fingerprint', async () => {
        const
            calls = [],
            oldNeo = globalThis.Neo,
            visiblePlan = plan();

        globalThis.Neo = {...oldNeo, main: {addon: {ShellPlane: {
            seatRootStatus: async () => ({packaged: true, root: {root, origin: 'configured'}, pending: null, outcome: {state: 'none'}}),
            seatRootPlan  : async () => visiblePlan,
            seatRootConsent: async request => {
                calls.push(request);
                return {state: 'consented'}
            }
        }}}};

        const panel = makePanel();

        try {
            await panel.controller.readStatus();
            expect(panel.getReference('review').hidden).toBe(false);

            await panel.controller.reviewMove();
            expect(panel.moveStore.items.map(record => record.state)).toEqual(['copy', 'untouched']);
            expect(panel.getReference('consent').hidden).toBe(false);
            expect(panel.getReference('plan-summary').hidden, 'the reviewed rows must be visible before consent').toBe(false);
            expect(panel.getReference('consent').text).toBe('Move seats and relaunch');
            expect(panel.getReference('plan-summary').items[1]).toBeTruthy();

            await panel.controller.consentMove();
            expect(calls).toEqual([{fingerprint: visiblePlan.fingerprint, windowId: panel.windowId}]);
            expect(panel.snapshot.refreshRequired).toBe(true)
        } finally {
            panel.destroy();
            globalThis.Neo = oldNeo
        }
    });

    test('missing boot outcome and unreadable consent state cannot open the planner', () => {
        const panel = makePanel();

        try {
            panel.snapshot = {state: 'available', packaged: true, root: {root, origin: 'configured'}, pending: null, outcome: null};
            expect(panel.canReviewMove()).toBe(false);
            expect(panel.getReference('status-line').text).toContain('not observed');

            panel.snapshot = {state: 'available', packaged: true, root: {root, origin: 'configured'}, pending: {unreadable: 'permission denied'}, outcome: {state: 'none'}};
            expect(panel.canReviewMove()).toBe(false);
            expect(panel.getReference('status-line').text).toContain('permission denied')
        } finally {
            panel.destroy()
        }
    });

    test('a committed move with held retirement does not claim every source folder was archived', () => {
        const panel = makePanel();

        try {
            panel.snapshot = {state: 'available', packaged: true, root: {root: '/Users/example/Seats-v2', origin: 'moved'}, pending: null, outcome: {state: 'committed', retirement: {state: 'held', reason: 'one folder is busy'}}};
            expect(panel.getReference('status-line').text).toContain('old folders were not all archived');
            expect(panel.getReference('status-line').text).toContain('Fleet start held');
            expect(panel.getReference('status-line').text).not.toContain('remain archived')
        } finally {
            panel.destroy()
        }
    });

    test('a committed move leaves no decision: the consented rows and the copy-note give way to the receipt line, retirement held or not (#614)', () => {
        const
            panel   = makePanel(),
            to      = '/Users/example/Seats-v2',
            pending = {from: root, to, rows: Array.from({length: 12}, (_, i) => ({id: `seat-${i}`, from: `${root}/seat-${i}`, to: `${to}/seat-${i}`, materialized: true}))};

        try {
            panel.snapshot = {state: 'available', packaged: true, root: {root: to, origin: 'moved'}, pending, outcome: {state: 'committed'}};
            expect(panel.getReference('status-line').text).toBe(`Root move committed · ${to}`);
            expect(panel.getReference('plan-summary').hidden).toBe(true);

            panel.snapshot = {state: 'available', packaged: true, root: {root: to, origin: 'moved'}, pending, outcome: {state: 'committed', retirement: {state: 'held', reason: 'one folder is busy'}}};
            expect(panel.getReference('status-line').text).toContain('Fleet start held');
            expect(panel.getReference('plan-summary').hidden).toBe(true);

            // the same rows before this boot reports its outcome are still the operator's decision, with the copy-note
            panel.snapshot = {state: 'available', packaged: true, root: {root, origin: 'adopted'}, pending, outcome: null};
            expect(panel.getReference('plan-summary').hidden).toBe(false);
            expect(panel.moveStore.count).toBe(12);
            expect(panel.getReference('plan-summary').items.map(item => item.cls?.[0])).toContain('fm-seat-root-copy-note')
        } finally {
            panel.destroy()
        }
    });

    test('a previously arrived seat remains visible outside the consented moving rows', () => {
        const panel = makePanel();
        try {
            panel.snapshot = {state: 'available', packaged: true, root: {root, origin: 'adopted'}, outcome: {state: 'held', reason: 'writer active'}, pending: {
                from: root, to: '/destination',
                rows: [{id: 'moving', from: `${root}/moving`, to: '/destination/moving', materialized: true}],
                outOfScope: [{id: 'arrived', seatHome: '/destination/arrived', reason: 'already at its destination'}]
            }};
            expect(panel.moveStore.items.map(row => [row.id, row.state, row.seatHome, row.destination, row.reason])).toEqual([
                ['moving', 'pending', `${root}/moving`, '/destination/moving', null],
                ['arrived', 'untouched', '/destination/arrived', null, 'already at its destination']
            ]);
            expect(panel.getReference('plan-summary').hidden).toBe(false);
            expect(panel.getReference('consent').hidden).toBe(true)
        } finally {
            panel.destroy()
        }
    });

    test('malformed or unknown plan rows are never consentable', () => {
        expect(SeatRootController.isConsentablePlan(plan())).toBe(true);
        expect(SeatRootController.isConsentablePlan({...plan(), rows: [{...plan().rows[0], state: 'unknown'}]})).toBe(false);
        expect(SeatRootController.isConsentablePlan({...plan(), rows: [{...plan().rows[0], destination: 'relative'}]})).toBe(false)
    });

    test('a late status reply cannot overwrite a newer check', async () => {
        let resolveFirst;

        let calls = 0;

        const oldNeo = globalThis.Neo;

        globalThis.Neo = {...oldNeo, main: {addon: {ShellPlane: {
            seatRootStatus: () => ++calls === 1
                ? new Promise(resolve => { resolveFirst = resolve })
                : Promise.resolve({packaged: true, root: {root, origin: 'configured'}, pending: null, outcome: {state: 'none'}})
        }}}};

        const panel = makePanel();

        try {
            const first = panel.controller.readStatus();
            await panel.controller.readStatus();
            expect(panel.snapshot.state).toBe('available');

            resolveFirst({packaged: false, root: null, pending: null, outcome: null, reason: 'late old answer'});
            await first;

            expect(panel.snapshot.state).toBe('available');
            expect(panel.snapshot.root).toEqual({root, origin: 'configured'})
        } finally {
            panel.destroy();
            globalThis.Neo = oldNeo
        }
    })
});
