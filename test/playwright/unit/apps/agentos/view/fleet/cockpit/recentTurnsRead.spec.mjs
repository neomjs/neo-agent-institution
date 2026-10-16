import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitRecentTurnsReadTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * Covers the cockpit-owned recent-turns read (`loadRecentTurns`, #476): the open-work read's laws (a typed
 * unavailable envelope, the generation fence, in-flight accounting released by each read's own settle,
 * target binding across profiles) plus the seat binding — the owner reads the seat the detail shows and
 * nothing without one, a seat switch mid-read drops the earlier seat's answer, a cleared selection drops the
 * stream, and every admission reaches the live detail pane. Prototype-call harness, bridge mock scoped to
 * the `fleet` subkey.
 */
test.describe('Fleet cockpit — the recent-turns read (loadRecentTurns, #476)', () => {
    let FleetCockpitController, RecentTurnsRead;

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        RecentTurnsRead        = (await import('../../../../../../../../apps/agentos/util/RecentTurnsRead.mjs')).default
    });

    const clearFleetBridge = () => { delete globalThis.AgentOS?.fleet };
    const setFleetBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };
    const settle           = () => new Promise(resolve => setTimeout(resolve, 0));

    // the live detail pane, recording every owner push
    const makePane = () => ({writes: [], set(values) { this.writes.push(values) }});

    const makeHost = (pane = makePane()) => Object.assign(Object.create(FleetCockpitController.prototype), {
        component                : {getAgentDetailPane: () => pane},
        isDestroyed              : false,
        recentTurnsProfileId     : null,
        recentTurnsReadGeneration: 0,
        recentTurnsReadInFlight  : 0,
        recentTurnsSnapshot      : null,
        recentTurnsTarget        : null
    });

    const answer = (target, capturedAt = '2026-10-16T18:00:00.000Z') => ({
        capability   : {state: 'wired', capturedAt},
        viewer       : '@operator',
        target,
        page         : {limit: 20, before: null},
        turns        : [{id: `${target}-1`, sessionId: 'session-1', timestamp: capturedAt, summary: 'a turn', summaryFallback: false, projectionPending: false}],
        count        : 1,
        nextCursor   : null,
        memorySharing: {policy: 'team', clamped: false}
    });

    test('no seat shown: no wire read, no answer, nothing pushed', async () => {
        setFleetBridge({fleetRecentTurns: () => { throw new Error('must not be asked') }});

        try {
            const pane = makePane(),
                  host = makeHost(pane);

            expect(await host.loadRecentTurns()).toBeNull();
            expect(host.recentTurnsReadInFlight).toBe(0);
            expect(host.recentTurnsSnapshot).toBeNull();
            expect(pane.writes).toEqual([])
        } finally {
            clearFleetBridge()
        }
    });

    test('an unwired verb lands as a typed not-wired envelope for the seat asked, pushed to the pane, never as an empty stream', async () => {
        clearFleetBridge();

        const pane     = makePane(),
              host     = makeHost(pane),
              snapshot = await host.loadRecentTurns({agentIdentity: '@neo-opus-ada'});

        expect(snapshot).toEqual({
            capability   : {state: 'unavailable', reason: 'fleet recent-turns verb not wired', capturedAt: null},
            coverage     : 'not-wired',
            viewer       : null,
            target       : '@neo-opus-ada',
            page         : {limit: 20, before: null},
            turns        : [],
            count        : 0,
            nextCursor   : null,
            memorySharing: null
        });
        expect(host.recentTurnsSnapshot).toBe(snapshot);
        expect(host.recentTurnsTarget).toBe('@neo-opus-ada');
        expect(host.recentTurnsReadInFlight, 'released on settle').toBe(0);
        expect(pane.writes).toEqual([{recentTurns: snapshot}])
    });

    test('a throwing bridge is transport truth (unanswered), and still releases its slot', async () => {
        setFleetBridge({fleetRecentTurns: () => { throw new Error('boom') }});

        try {
            const host     = makeHost(),
                  snapshot = await host.loadRecentTurns({agentIdentity: '@neo-opus-ada'});

            expect(snapshot.capability).toEqual({state: 'unavailable', reason: 'fleet recent-turns read failed', capturedAt: null});
            expect(snapshot.coverage, 'the connection\'s story, not the producer\'s verdict').toBe('unanswered');
            expect(snapshot.target).toBe('@neo-opus-ada');
            expect(snapshot.turns).toEqual([]);
            expect(host.recentTurnsReadInFlight).toBe(0)
        } finally {
            clearFleetBridge()
        }
    });

    test('the read asks for the seat shown with the pane\'s page, the answer passes through untouched, and the cadence re-asks for the same seat', async () => {
        const calls = [];

        setFleetBridge({fleetRecentTurns: params => { calls.push(params); return Promise.resolve(answer(params.agentIdentity)) }});

        try {
            const pane     = makePane(),
                  host     = makeHost(pane),
                  snapshot = await host.loadRecentTurns({agentIdentity: '@neo-opus-ada'});

            expect(calls).toEqual([{agentIdentity: '@neo-opus-ada', limit: 20}]);
            expect(snapshot.turns).toHaveLength(1);
            expect(host.recentTurnsSnapshot).toBe(snapshot);
            expect(pane.writes).toEqual([{recentTurns: snapshot}]);

            // the liveness pass carries no seat: the read keeps the one shown
            const again = await host.loadRecentTurns();

            expect(calls).toHaveLength(2);
            expect(calls[1]).toEqual({agentIdentity: '@neo-opus-ada', limit: 20});
            expect(host.recentTurnsSnapshot).toBe(again);
            expect(pane.writes.at(-1)).toEqual({recentTurns: again})
        } finally {
            clearFleetBridge()
        }
    });

    test('the generation fence + in-flight accounting: the loser never writes, each read releases only itself', async () => {
        const wires = [];

        setFleetBridge({fleetRecentTurns: () => new Promise(resolve => wires.push(resolve))});

        try {
            const host = makeHost(),
                  slow = host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
                  fast = host.loadRecentTurns();

            expect(host.recentTurnsReadInFlight, 'two unsettled reads on the wire').toBe(2);

            const newer = answer('@neo-opus-ada', '2026-10-16T18:01:00.000Z'),
                  older = answer('@neo-opus-ada', '2026-10-16T18:00:00.000Z');

            wires[1](newer);
            await fast;
            expect(host.recentTurnsSnapshot).toBe(newer);
            expect(host.recentTurnsReadInFlight, 'the slow read still holds its slot').toBe(1);

            wires[0](older);
            await slow;
            expect(host.recentTurnsSnapshot, 'the loser never writes').toBe(newer);
            expect(host.recentTurnsReadInFlight).toBe(0)
        } finally {
            clearFleetBridge()
        }
    });

    test('AC-3: a seat switch while a read is in flight drops the earlier seat\'s answer; a cleared selection drops the stream and fences a late answer', async () => {
        const wires = [];

        setFleetBridge({fleetRecentTurns: ({agentIdentity}) => new Promise(resolve => wires.push({agentIdentity, resolve}))});

        try {
            const pane     = makePane(),
                  host     = makeHost(pane),
                  adaRead  = host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
                  vegaRead = host.loadRecentTurns({agentIdentity: '@neo-opus-vega'});

            expect(wires.map(wire => wire.agentIdentity)).toEqual(['@neo-opus-ada', '@neo-opus-vega']);

            wires[0].resolve(answer('@neo-opus-ada'));
            await adaRead;
            expect(host.recentTurnsSnapshot, 'the earlier seat\'s answer lands nowhere').toBeNull();
            expect(pane.writes).toEqual([]);

            wires[1].resolve(answer('@neo-opus-vega'));
            await vegaRead;
            expect(host.recentTurnsSnapshot.target).toBe('@neo-opus-vega');
            expect(pane.writes.at(-1).recentTurns.target).toBe('@neo-opus-vega');

            // a re-read on the wire, then the selection clears: the stream goes, the late answer is fenced
            const late = host.loadRecentTurns();

            expect(RecentTurnsRead.clear(host)).toBe(true);
            expect(host.recentTurnsSnapshot).toBeNull();
            expect(host.recentTurnsTarget).toBeNull();
            expect(pane.writes.at(-1)).toEqual({recentTurns: null});

            wires[2].resolve(answer('@neo-opus-vega', '2026-10-16T18:05:00.000Z'));
            await late;
            expect(host.recentTurnsSnapshot).toBeNull();
            expect(pane.writes.at(-1)).toEqual({recentTurns: null});
            expect(RecentTurnsRead.clear(host), 'nothing held and no seat: nothing to clear').toBe(false)
        } finally {
            clearFleetBridge()
        }
    });

    test('a read through another profile retires the held answer first, lands its own, and an old read landing late writes nothing', async () => {
        const wires = [];

        setFleetBridge({profileId: 'instance-a', fleetRecentTurns: () => new Promise(resolve => wires.push(resolve))});

        try {
            const pane = makePane(),
                  host = makeHost(pane),
                  held = answer('@neo-opus-ada'),
                  read = host.loadRecentTurns({agentIdentity: '@neo-opus-ada'});

            wires[0](held);
            await read;
            expect(host.recentTurnsSnapshot).toBe(held);
            expect(host.recentTurnsProfileId).toBe('instance-a');

            // the same profile keeps its answer while its next read is on the wire
            const lateA = host.loadRecentTurns();
            expect(host.recentTurnsSnapshot, 'same profile keeps its answer').toBe(held);

            // another profile: instance-a's answer is gone before instance-b's arrives, the pane told
            setFleetBridge({profileId: 'instance-b', fleetRecentTurns: () => new Promise(resolve => wires.push(resolve))});
            const switched = host.loadRecentTurns();

            expect(host.recentTurnsSnapshot, 'retired before the new profile answers').toBeNull();
            expect(host.recentTurnsProfileId).toBeNull();
            expect(host.recentTurnsTarget, 'the seat shown stays the seat asked for').toBe('@neo-opus-ada');
            expect(pane.writes.at(-1)).toEqual({recentTurns: null});

            const answerB = answer('@neo-opus-ada', '2026-10-16T18:02:00.000Z');

            wires[2](answerB);
            await switched;
            expect(host.recentTurnsSnapshot, 'the new profile\'s own read lands').toBe(answerB);
            expect(host.recentTurnsProfileId).toBe('instance-b');

            // instance-a's slow read lands after the switch: fenced, it writes nothing
            wires[1](answer('@neo-opus-ada', '2026-10-16T18:03:00.000Z'));
            await lateA;
            expect(host.recentTurnsSnapshot).toBe(answerB);
            expect(host.recentTurnsProfileId).toBe('instance-b')
        } finally {
            clearFleetBridge()
        }
    });

    test('applySelection reads a newly shown seat once, re-reads nothing for the same seat, and drops the stream for no seat or one without identity', async () => {
        const calls = [];

        setFleetBridge({fleetRecentTurns: ({agentIdentity}) => { calls.push(agentIdentity); return Promise.resolve(answer(agentIdentity)) }});

        try {
            const pane = makePane(),
                  host = makeHost(pane),
                  ada  = {agentId: 'neo-opus-ada', githubUsername: 'neo-opus-ada'};

            host.component = {detailRecord: null, getAgentDetailPane: () => pane, getMemoriesPane: () => null, setState() {}};

            host.applySelection(ada);
            await settle();
            expect(calls).toEqual(['@neo-opus-ada']);
            expect(host.component.detailRecord).toBe(ada);
            expect(host.recentTurnsSnapshot.target).toBe('@neo-opus-ada');

            // the same seat seated again (a re-click, a roster re-seat): the cadence keeps it fresh, no new read
            host.applySelection({...ada});
            await settle();
            expect(calls).toEqual(['@neo-opus-ada']);
            expect(host.recentTurnsSnapshot.target).toBe('@neo-opus-ada');

            // a seat the roster names no identity for: the held stream goes, nothing is asked
            host.applySelection({agentId: 'ghost', githubUsername: null});
            await settle();
            expect(calls).toEqual(['@neo-opus-ada']);
            expect(host.recentTurnsSnapshot).toBeNull();
            expect(host.recentTurnsTarget).toBeNull();
            expect(pane.writes.at(-1)).toEqual({recentTurns: null});

            // another seat: its own read
            host.applySelection({agentId: 'neo-opus-vega', githubUsername: 'neo-opus-vega'});
            await settle();
            expect(calls).toEqual(['@neo-opus-ada', '@neo-opus-vega']);
            expect(host.recentTurnsSnapshot.target).toBe('@neo-opus-vega');

            // the selection clears
            host.applySelection(null);
            expect(host.recentTurnsSnapshot).toBeNull();
            expect(host.recentTurnsTarget).toBeNull();
            expect(pane.writes.at(-1)).toEqual({recentTurns: null})
        } finally {
            clearFleetBridge()
        }
    })
});
