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
 * Covers the cockpit's recent-turns reader (`loadRecentTurns`): the open-work read's laws (a typed
 * unavailable envelope, the generation fence, in-flight accounting released by each read's own settle,
 * target binding across profiles) plus the seat binding — the reader reads the seat the detail shows and
 * nothing without one, a seat switch mid-read drops the earlier seat's answer, a cleared selection drops the
 * stream, a destroyed reader admits nothing, and every admission reaches the live detail pane.
 * Prototype-call harness, bridge mock scoped to the `fleet` subkey.
 */
test.describe('Fleet cockpit — the recent-turns reader (loadRecentTurns)', () => {
    let FleetCockpitController;

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    const clearFleetBridge = () => { delete globalThis.AgentOS?.fleet };
    const setFleetBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };
    const settle           = () => new Promise(resolve => setTimeout(resolve, 0));

    // the live detail pane, recording every owner push
    const makePane = () => ({writes: [], set(values) { this.writes.push(values) }});

    const makeHost = (pane = makePane()) => Object.assign(Object.create(FleetCockpitController.prototype), {
        component        : {getAgentDetailPane: () => pane},
        isDestroyed      : false,
        recentTurnsReader: null
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

    test.afterEach(() => clearFleetBridge());

    test('no seat shown: no wire read, no answer, nothing pushed — and no reader before the first call', async () => {
        setFleetBridge({fleetRecentTurns: () => { throw new Error('must not be asked') }});

        const pane = makePane(),
              host = makeHost(pane);

        expect(host.recentTurnsReadInFlight, 'no reader reads as nothing in flight').toBe(0);
        expect(await host.loadRecentTurns()).toBeNull();
        expect(host.recentTurnsReader.snapshot).toBeNull();
        expect(host.recentTurnsReadInFlight).toBe(0);
        expect(pane.writes).toEqual([]);

        host.recentTurnsReader.destroy()
    });

    test('an unwired verb lands as a typed not-wired envelope for the seat asked, pushed to the pane, never as an empty stream', async () => {
        clearFleetBridge();

        const pane     = makePane(),
              host     = makeHost(pane),
              snapshot = await host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
              reader   = host.recentTurnsReader;

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
        expect(reader.snapshot).toBe(snapshot);
        expect(reader.target).toBe('@neo-opus-ada');
        expect(reader.readInFlight, 'released on settle').toBe(0);
        expect(pane.writes).toEqual([{recentTurns: snapshot}]);

        reader.destroy()
    });

    test('a throwing bridge is transport truth (unanswered), and still releases its slot', async () => {
        setFleetBridge({fleetRecentTurns: () => { throw new Error('boom') }});

        const host     = makeHost(),
              snapshot = await host.loadRecentTurns({agentIdentity: '@neo-opus-ada'});

        expect(snapshot.capability).toEqual({state: 'unavailable', reason: 'fleet recent-turns read failed', capturedAt: null});
        expect(snapshot.coverage, 'the connection\'s story, not the producer\'s verdict').toBe('unanswered');
        expect(snapshot.target).toBe('@neo-opus-ada');
        expect(snapshot.turns).toEqual([]);
        expect(host.recentTurnsReadInFlight).toBe(0);

        host.recentTurnsReader.destroy()
    });

    test('the read asks for the seat shown with the pane\'s page, the answer passes through untouched, and the cadence re-asks for the same seat', async () => {
        const calls = [];

        setFleetBridge({fleetRecentTurns: params => { calls.push(params); return Promise.resolve(answer(params.agentIdentity)) }});

        const pane     = makePane(),
              host     = makeHost(pane),
              snapshot = await host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
              reader   = host.recentTurnsReader;

        expect(calls).toEqual([{agentIdentity: '@neo-opus-ada', limit: 20}]);
        expect(snapshot.turns).toHaveLength(1);
        expect(reader.snapshot).toBe(snapshot);
        expect(pane.writes).toEqual([{recentTurns: snapshot}]);

        // the liveness pass carries no seat: the read keeps the one shown
        const again = await host.loadRecentTurns();

        expect(calls).toHaveLength(2);
        expect(calls[1]).toEqual({agentIdentity: '@neo-opus-ada', limit: 20});
        expect(reader.snapshot).toBe(again);
        expect(pane.writes.at(-1)).toEqual({recentTurns: again});

        reader.destroy()
    });

    test('the generation fence + in-flight accounting: the loser never writes, each read releases only itself', async () => {
        const wires = [];

        setFleetBridge({fleetRecentTurns: () => new Promise(resolve => wires.push(resolve))});

        const host = makeHost(),
              slow = host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
              fast = host.loadRecentTurns(),
              reader = host.recentTurnsReader;

        expect(host.recentTurnsReadInFlight, 'two unsettled reads on the wire').toBe(2);

        const newer = answer('@neo-opus-ada', '2026-10-16T18:01:00.000Z'),
              older = answer('@neo-opus-ada', '2026-10-16T18:00:00.000Z');

        wires[1](newer);
        await fast;
        expect(reader.snapshot).toBe(newer);
        expect(host.recentTurnsReadInFlight, 'the slow read still holds its slot').toBe(1);

        wires[0](older);
        await slow;
        expect(reader.snapshot, 'the loser never writes').toBe(newer);
        expect(host.recentTurnsReadInFlight).toBe(0);

        reader.destroy()
    });

    test('AC-3: a seat switch while a read is in flight drops the earlier seat\'s answer; a cleared selection drops the stream and fences a late answer', async () => {
        const wires = [];

        setFleetBridge({fleetRecentTurns: ({agentIdentity}) => new Promise(resolve => wires.push({agentIdentity, resolve}))});

        const pane     = makePane(),
              host     = makeHost(pane),
              adaRead  = host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
              vegaRead = host.loadRecentTurns({agentIdentity: '@neo-opus-vega'}),
              reader   = host.recentTurnsReader;

        expect(wires.map(wire => wire.agentIdentity)).toEqual(['@neo-opus-ada', '@neo-opus-vega']);

        wires[0].resolve(answer('@neo-opus-ada'));
        await adaRead;
        expect(reader.snapshot, 'the earlier seat\'s answer lands nowhere').toBeNull();
        expect(pane.writes).toEqual([]);

        wires[1].resolve(answer('@neo-opus-vega'));
        await vegaRead;
        expect(reader.snapshot.target).toBe('@neo-opus-vega');
        expect(pane.writes.at(-1).recentTurns.target).toBe('@neo-opus-vega');

        // a re-read on the wire, then the selection clears: the stream goes, the late answer is fenced
        const late = host.loadRecentTurns();

        expect(reader.clear()).toBe(true);
        expect(reader.snapshot).toBeNull();
        expect(reader.target).toBeNull();
        expect(pane.writes.at(-1)).toEqual({recentTurns: null});

        wires[2].resolve(answer('@neo-opus-vega', '2026-10-16T18:05:00.000Z'));
        await late;
        expect(reader.snapshot).toBeNull();
        expect(pane.writes.at(-1)).toEqual({recentTurns: null});
        expect(reader.clear(), 'nothing held and no seat: nothing to clear').toBe(false);

        reader.destroy()
    });

    test('a read through another profile retires the held answer first, lands its own, and an old read landing late writes nothing', async () => {
        const wires = [];

        setFleetBridge({profileId: 'instance-a', fleetRecentTurns: () => new Promise(resolve => wires.push(resolve))});

        const pane   = makePane(),
              host   = makeHost(pane),
              held   = answer('@neo-opus-ada'),
              read   = host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
              reader = host.recentTurnsReader;

        wires[0](held);
        await read;
        expect(reader.snapshot).toBe(held);
        expect(reader.profileId).toBe('instance-a');

        // the same profile keeps its answer while its next read is on the wire
        const lateA = host.loadRecentTurns();
        expect(reader.snapshot, 'same profile keeps its answer').toBe(held);

        // another profile: instance-a's answer is gone before instance-b's arrives, the pane told
        setFleetBridge({profileId: 'instance-b', fleetRecentTurns: () => new Promise(resolve => wires.push(resolve))});
        const switched = host.loadRecentTurns();

        expect(reader.snapshot, 'retired before the new profile answers').toBeNull();
        expect(reader.profileId).toBeNull();
        expect(reader.target, 'the seat shown stays the seat asked for').toBe('@neo-opus-ada');
        expect(pane.writes.at(-1)).toEqual({recentTurns: null});

        const answerB = answer('@neo-opus-ada', '2026-10-16T18:02:00.000Z');

        wires[2](answerB);
        await switched;
        expect(reader.snapshot, 'the new profile\'s own read lands').toBe(answerB);
        expect(reader.profileId).toBe('instance-b');

        // instance-a's slow read lands after the switch: fenced, it writes nothing
        wires[1](answer('@neo-opus-ada', '2026-10-16T18:03:00.000Z'));
        await lateA;
        expect(reader.snapshot).toBe(answerB);
        expect(reader.profileId).toBe('instance-b');

        reader.destroy()
    });

    test('a destroyed reader admits nothing: a reply still on its way finds no fence and no pane', async () => {
        const wires = [];

        setFleetBridge({fleetRecentTurns: () => new Promise(resolve => wires.push(resolve))});

        const pane   = makePane(),
              host   = makeHost(pane),
              read   = host.loadRecentTurns({agentIdentity: '@neo-opus-ada'}),
              reader = host.recentTurnsReader;

        reader.destroy();
        host.recentTurnsReader = null;

        wires[0](answer('@neo-opus-ada'));
        await read;
        expect(pane.writes).toEqual([]);
        expect(host.recentTurnsReadInFlight).toBe(0)
    });

    test('applySelection reads a newly shown seat once, re-reads nothing for the same seat, and drops the stream for no seat or one without identity', async () => {
        const calls = [];

        setFleetBridge({fleetRecentTurns: ({agentIdentity}) => { calls.push(agentIdentity); return Promise.resolve(answer(agentIdentity)) }});

        const pane = makePane(),
              host = makeHost(pane),
              ada  = {agentId: 'neo-opus-ada', githubUsername: 'neo-opus-ada'};

        host.component = {detailRecord: null, getAgentDetailPane: () => pane, getMemoriesPane: () => null, setState() {}};

        host.applySelection(ada);
        await settle();
        expect(calls).toEqual(['@neo-opus-ada']);
        expect(host.component.detailRecord).toBe(ada);
        expect(host.recentTurnsReader.snapshot.target).toBe('@neo-opus-ada');

        // the same seat seated again (a re-click, a roster re-seat): the cadence keeps it fresh, no new read
        host.applySelection({...ada});
        await settle();
        expect(calls).toEqual(['@neo-opus-ada']);
        expect(host.recentTurnsReader.snapshot.target).toBe('@neo-opus-ada');

        // a seat the roster names no identity for: the held stream goes, nothing is asked
        host.applySelection({agentId: 'ghost', githubUsername: null});
        await settle();
        expect(calls).toEqual(['@neo-opus-ada']);
        expect(host.recentTurnsReader.snapshot).toBeNull();
        expect(host.recentTurnsReader.target).toBeNull();
        expect(pane.writes.at(-1)).toEqual({recentTurns: null});

        // another seat: its own read
        host.applySelection({agentId: 'neo-opus-vega', githubUsername: 'neo-opus-vega'});
        await settle();
        expect(calls).toEqual(['@neo-opus-ada', '@neo-opus-vega']);
        expect(host.recentTurnsReader.snapshot.target).toBe('@neo-opus-vega');

        // the selection clears
        host.applySelection(null);
        expect(host.recentTurnsReader.snapshot).toBeNull();
        expect(host.recentTurnsReader.target).toBeNull();
        expect(pane.writes.at(-1)).toEqual({recentTurns: null});

        host.recentTurnsReader.destroy()
    })
});
