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

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
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

    test('an unwired verb lands as a typed unavailable envelope, never as "no open work"', async () => {
        clearFleetBridge();

        const host     = makeHost(),
              snapshot = await host.loadOpenWork();

        expect(snapshot).toEqual({state: 'unavailable', observedAt: null, coverage: 'unavailable', reason: 'fleet open-work verb not wired', seats: {}, awaitingMerge: []});
        expect(host.openWorkSnapshot).toBe(snapshot);
        expect(host.openWorkReadInFlight, 'released on settle').toBe(0)
    });

    test('a throwing bridge is transport truth, and still releases its slot', async () => {
        setFleetBridge({fleetOpenWork: () => { throw new Error('boom') }});

        try {
            const host     = makeHost(),
                  snapshot = await host.loadOpenWork();

            expect(snapshot.state).toBe('unavailable');
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
});
