import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitOpenWorkReadTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * Covers the cockpit-owned open-work read (`loadOpenWork`): the tasks read's laws (a typed unavailable
 * envelope, the generation fence, in-flight accounting released by each read's own settle) plus
 * target binding — a read through another profile's bridge retires the held answer first, and a read
 * through the same profile keeps it. Prototype-call harness, bridge mock scoped to the `fleet` subkey.
 */
test.describe('Fleet cockpit — the open-work read (loadOpenWork)', () => {
    let FleetCockpitController, TargetBinding;

    let OpenWorkRead;

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        OpenWorkRead           = (await import('../../../../../../../../apps/agentos/util/OpenWorkRead.mjs')).default;
        TargetBinding          = (await import('../../../../../../../../apps/agentos/util/TargetBinding.mjs')).default
    });

    const clearFleetBridge = () => { delete globalThis.AgentOS?.fleet };
    const setFleetBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };

    const makeHost = () => Object.assign(Object.create(FleetCockpitController.prototype), {
        component             : {},
        isDestroyed           : false,
        openWorkProfileId     : null,
        openWorkReadGeneration: 0,
        openWorkReadInFlight  : 0,
        openWorkSnapshot      : null
    });

    const answer = (observedAt = '2026-10-02T21:00:00.000Z') => ({
        state        : 'ok',
        observedAt,
        coverage     : 'complete',
        reason       : null,
        seats        : {'@neo-opus-ada': {authored: [{repo: 'neomjs/neo', number: 1, holder: {role: 'reviewer', ids: ['@neo-gpt']}}], reviewing: []}},
        awaitingMerge: [{repo: 'neomjs/neo', number: 2, holder: {role: 'operator', ids: []}}]
    });

    test('an unwired verb lands as a typed unavailable envelope, never as "no open work", and says it is not wired', async () => {
        clearFleetBridge();

        const host     = makeHost(),
              snapshot = await host.loadOpenWork();

        expect(snapshot).toEqual({state: 'unavailable', observedAt: null, coverage: 'not-wired', reason: 'fleet open-work verb not wired', seats: {}, awaitingMerge: []});
        expect(host.openWorkSnapshot).toBe(snapshot);
        expect(host.openWorkReadInFlight, 'released on settle').toBe(0)
    });

    test('a throwing bridge is transport truth, and still releases its slot', async () => {
        setFleetBridge({fleetOpenWork: () => { throw new Error('boom') }});

        try {
            const host     = makeHost(),
                  snapshot = await host.loadOpenWork();

            expect(snapshot.state).toBe('unavailable');
            expect(snapshot.coverage, 'the connection\'s story, not the producer\'s verdict').toBe('unanswered');
            expect(snapshot.reason).toBe('fleet open-work read failed');
            expect(snapshot.awaitingMerge).toEqual([]);
            expect(host.openWorkReadInFlight).toBe(0)
        } finally {
            clearFleetBridge()
        }
    });

    test('the generation fence + in-flight accounting: the loser never writes, each read releases only itself', async () => {
        const wires = [];

        setFleetBridge({fleetOpenWork: () => new Promise(resolve => wires.push(resolve))});

        try {
            const host = makeHost(),
                  slow = host.loadOpenWork(),
                  fast = host.loadOpenWork();

            expect(host.openWorkReadInFlight, 'two unsettled reads on the wire').toBe(2);

            const newer = answer('2026-10-02T21:01:00.000Z'),
                  older = answer('2026-10-02T21:00:00.000Z');

            wires[1](newer);
            await fast;
            expect(host.openWorkSnapshot).toBe(newer);
            expect(host.openWorkReadInFlight, 'the slow read still holds its slot').toBe(1);

            wires[0](older);
            await slow;
            expect(host.openWorkSnapshot, 'the loser never writes').toBe(newer);
            expect(host.openWorkReadInFlight).toBe(0)
        } finally {
            clearFleetBridge()
        }
    });

    test('a read through another profile retires the held answer first, lands its own, and an old read landing late writes nothing', async () => {
        const wires = [];

        setFleetBridge({profileId: 'instance-a', fleetOpenWork: () => new Promise(resolve => wires.push(resolve))});

        try {
            const host = makeHost(),
                  held = answer(),
                  read = host.loadOpenWork();

            wires[0](held);
            await read;
            expect(host.openWorkSnapshot).toBe(held);
            expect(host.openWorkProfileId).toBe('instance-a');

            // the same profile keeps its answer while its next read is on the wire, and that read stays slow
            const lateA = host.loadOpenWork();
            expect(host.openWorkSnapshot, 'same profile keeps its answer').toBe(held);

            // another profile: instance-a's answer is gone before instance-b's arrives
            setFleetBridge({profileId: 'instance-b', fleetOpenWork: () => new Promise(resolve => wires.push(resolve))});
            const switched = host.loadOpenWork();

            expect(host.openWorkSnapshot, 'retired before the new profile answers').toBeNull();
            expect(host.openWorkProfileId).toBeNull();

            const answerB = answer('2026-10-02T21:02:00.000Z');

            wires[2](answerB);
            await switched;
            expect(host.openWorkSnapshot, 'the new profile\'s own read lands').toBe(answerB);
            expect(host.openWorkProfileId).toBe('instance-b');

            // instance-a's slow read lands after the switch: fenced, it writes nothing
            wires[1](answer('2026-10-02T21:03:00.000Z'));
            await lateA;
            expect(host.openWorkSnapshot).toBe(answerB);
            expect(host.openWorkProfileId).toBe('instance-b');
            expect(host.openWorkReadInFlight).toBe(0)
        } finally {
            clearFleetBridge()
        }
    });

    test('retireOpenWork is a no-op without a held answer or for the same profile, and retires across profiles', () => {
        const host = makeHost();

        expect(TargetBinding.retireOpenWork(host, {profileId: 'instance-a'})).toBe(false);

        host.admitOpenWork(answer(), 'instance-a');

        expect(TargetBinding.retireOpenWork(host, {profileId: 'instance-a'})).toBe(false);
        expect(host.openWorkSnapshot).not.toBeNull();
        expect(TargetBinding.retireOpenWork(host, {profileId: 'instance-b'})).toBe(true);
        expect(host.openWorkSnapshot).toBeNull();
        expect(host.openWorkProfileId).toBeNull()
    });

    test('the merge queue\'s rows key each PR by repo and number; an unavailable or absent answer has none', () => {
        expect(OpenWorkRead.mergeRows(answer())).toEqual([{id: 'neomjs/neo#2', number: 2, repo: 'neomjs/neo'}]);
        expect(OpenWorkRead.mergeRows({...answer(), state: 'unavailable'}), 'a blind queue keeps no rows').toEqual([]);
        expect(OpenWorkRead.mergeRows(null)).toEqual([])
    });

    test('every admitted answer reaches its three surfaces: the provider block, the merge queue Store, each roster record', async () => {
        const
            StateProvider      = (await import('../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs')).default,
            FleetAwaitingMerge = (await import('../../../../../../../../apps/agentos/store/FleetAwaitingMerge.mjs')).default,
            FleetRoster        = (await import('../../../../../../../../apps/agentos/store/FleetRoster.mjs')).default,
            provider           = Neo.create(StateProvider, {
                data  : {openWork: {coverage: null, observedAt: null, reason: null, state: null}},
                stores: {
                    fleetAwaitingMerge: {module: FleetAwaitingMerge},
                    fleetRoster       : {module: FleetRoster, data: [
                        {agentId: 'neo-opus-ada', githubUsername: 'neo-opus-ada'},
                        {agentId: 'neo-gpt',      githubUsername: 'neo-gpt'}
                    ]}
                }
            }),
            host               = Object.assign(makeHost(), {component: {getStateProvider: () => provider}}),
            queue              = provider.getStore('fleetAwaitingMerge'),
            roster             = provider.getStore('fleetRoster'),
            observedAt         = '2026-10-03T08:00:00.000Z',
            redHead            = {repo: 'neomjs/neo', number: 1, ci: 'red', holder: {role: 'author', ids: ['@neo-opus-ada']}};

        try {
            host.admitOpenWork({
                state        : 'ok',
                observedAt,
                coverage     : 'complete',
                reason       : null,
                seats        : {'@neo-opus-ada': {authored: [redHead], reviewing: []}, '@neo-gpt': {authored: [], reviewing: [redHead]}},
                awaitingMerge: [{repo: 'neomjs/neo-agent-brain', number: 794, ci: 'green', mergeable: 'MERGEABLE', draft: false, observedAt, stale: false, holder: {role: 'operator', ids: []}}]
            }, 'instance-a');

            expect(provider.getData('openWork')).toEqual({coverage: 'complete', observedAt, reason: null, state: 'ok'});
            expect(queue.count).toBe(1);
            expect(queue.get('neomjs/neo-agent-brain#794').number).toBe(794);
            expect(roster.get('neo-opus-ada').openWork).toEqual({count: 1, worst: 'red', stale: false, observedAt});
            expect(roster.get('neo-gpt').openWork, 'a PR the seat reviews while its author holds it is not the reviewer\'s').toBeNull();

            // the detail's rows ride the same write: the held row, and an answered seat holding nothing
            expect(roster.get('neo-opus-ada').openWorkHeld).toEqual({
                rows: [{kind: 'red', number: 1, observedAt: null, repo: 'neomjs/neo', role: 'author', stale: false, title: null}], stale: false, observedAt
            });
            expect(roster.get('neo-gpt').openWorkHeld).toEqual({rows: [], stale: false, observedAt});

            // another profile's read retires the answer, and with it everything the answer put on screen
            setFleetBridge({profileId: 'instance-b', fleetOpenWork: () => new Promise(() => {})});
            host.loadOpenWork();

            expect(provider.getData('openWork')).toEqual({coverage: null, observedAt: null, reason: null, state: null});
            expect(queue.count).toBe(0);
            expect(roster.get('neo-opus-ada').openWork).toBeNull();
            expect(roster.get('neo-opus-ada').openWorkHeld, 'no answer is not an empty answer').toBeNull()
        } finally {
            clearFleetBridge();
            provider.destroy()
        }
    });

    test('a roster row maps with the seat\'s held open work, so a roster refresh keeps the chip', () => {
        const host = makeHost();

        host.admitOpenWork({
            state     : 'ok',
            observedAt: '2026-10-03T08:00:00.000Z',
            seats     : {'@neo-gpt': {authored: [], reviewing: [{repo: 'neomjs/neo', number: 7, holder: {role: 'reviewer', ids: ['@neo-gpt']}}]}},
            awaitingMerge: []
        }, null);

        expect(host.mapRosterRow({id: 'neo-gpt', githubUsername: 'neo-gpt'}).openWork).toEqual({count: 1, worst: 'review-due', stale: false, observedAt: '2026-10-03T08:00:00.000Z'});
        expect(host.mapRosterRow({id: 'neo-gpt', githubUsername: 'neo-gpt'}).openWorkHeld.rows.map(row => row.number)).toEqual([7]);
        expect(host.mapRosterRow({id: 'neo-opus-ada', githubUsername: 'neo-opus-ada'}).openWork).toBeNull();
        expect(host.mapRosterRow({id: 'neo-opus-ada', githubUsername: 'neo-opus-ada'}).openWorkHeld.rows).toEqual([]);
        expect(host.mapRosterRow({id: 'no-login'}).openWork, 'no identity, no claim').toBeNull();
        expect(host.mapRosterRow({id: 'no-login'}).openWorkHeld).toBeNull()
    });

    test('a card a view filter hides reappears with the answer given while it was hidden, both ways', async () => {
        const
            StateProvider      = (await import('../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs')).default,
            FleetAwaitingMerge = (await import('../../../../../../../../apps/agentos/store/FleetAwaitingMerge.mjs')).default,
            FleetRoster        = (await import('../../../../../../../../apps/agentos/store/FleetRoster.mjs')).default,
            rows               = [{agentId: 'neo-opus-ada', githubUsername: 'neo-opus-ada'}, {agentId: 'neo-gpt', githubUsername: 'neo-gpt'}],
            provider           = Neo.create(StateProvider, {stores: {fleetAwaitingMerge: {module: FleetAwaitingMerge}, fleetRoster: {module: FleetRoster, data: rows}}}),
            host               = Object.assign(makeHost(), {component: {getStateProvider: () => provider}, lastLiveRows: rows}),
            roster             = provider.getStore('fleetRoster'),
            observedAt         = '2026-10-03T08:00:00.000Z',
            held               = {count: 1, worst: 'review-due', stale: false, observedAt},
            hideEuclid         = () => {roster.filters = [{property: 'githubUsername', operator: '!==', value: 'neo-gpt'}]},
            answer             = seats => host.admitOpenWork({state: 'ok', observedAt, seats, awaitingMerge: []}, null);

        try {
            // adding: Euclid's card is hidden when a review lands on it
            hideEuclid();
            expect(roster.get('neo-gpt'), 'hidden from the view').toBeFalsy();

            answer({'@neo-gpt': {authored: [], reviewing: [{repo: 'neomjs/neo', number: 7, observedAt, holder: {role: 'reviewer', ids: ['@neo-gpt']}}]}});

            expect(host.lastLiveRows.find(row => row.agentId === 'neo-gpt').openWork, 'a re-apply of the last live roster keeps the answer').toEqual(held);
            expect(host.lastLiveRows.find(row => row.agentId === 'neo-gpt').openWorkHeld.rows.map(row => row.number)).toEqual([7]);
            expect(host.lastLiveRows.find(row => row.agentId === 'neo-opus-ada').openWork).toBeNull();

            roster.filters = [];
            expect(roster.get('neo-gpt').openWork, 'revealed with the review it gained').toEqual(held);

            // clearing: hidden again when the review is done
            hideEuclid();
            answer({});

            expect(host.lastLiveRows.find(row => row.agentId === 'neo-gpt').openWork).toBeNull();

            roster.filters = [];
            expect(roster.get('neo-gpt').openWork, 'revealed without the review it lost').toBeNull()
        } finally {
            provider.destroy()
        }
    });
});
