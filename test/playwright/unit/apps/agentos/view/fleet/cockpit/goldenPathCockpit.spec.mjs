import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'FleetGoldenPathCockpitTest', isMounted: () => true, vnodeInitialising: false}
});

import {expect, test}         from '@playwright/test';
import Neo                    from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core              from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import FleetCockpitController from '../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs';
import GoldenPathEnvelope     from '../../../../../../../../apps/agentos/util/GoldenPathEnvelope.mjs';
import GraphSceneEnvelope     from '../../../../../../../../apps/agentos/util/GraphSceneEnvelope.mjs';
import LivenessCadence        from '../../../../../../../../apps/agentos/util/LivenessCadence.mjs';
import Provider               from '../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';

// the load is a CONTROLLER method: a prototype host with a recording provider on the component seat
// drives it as production code, like the catch-up owner spec
const makeHost = () => {
    const writes = [];

    return Object.assign(Object.create(FleetCockpitController.prototype), {
        component               : {getStateProvider: () => ({getData: () => undefined, setData: data => writes.push(data)}), livenessReadTimeout: 10000},
        goldenPathReadGeneration: 0,
        graphSceneReadGeneration: 0,
        isDestroyed             : false,
        writes
    })
};

// the same host on a real provider: the failed re-read reads the landed leaf back through the engine
const makeProviderHost = () => {
    const
        provider = Neo.create(Provider, {data: {goldenPathEnvelope: GoldenPathEnvelope.blank()}}),
        host     = makeHost();

    host.component = {getStateProvider: () => provider, livenessCadence: LivenessCadence.DEFAULT_INTERVALS, livenessReadTimeout: 10000};

    return {host, provider}
};

const clearBridge = () => { delete globalThis.AgentOS?.fleet };

test.describe('FleetCockpit — Golden Path owner routing', () => {
    test.afterEach(() => clearBridge());

    test('the load reads the authenticated verb and lands the envelope in the provider leaf', async () => {
        const envelope = {capability: {state: 'wired'}, admission: {admitted: true}, route: {status: 'fresh', items: []}},
              host     = makeHost(),
              landed   = GoldenPathEnvelope.fromWire(envelope);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGoldenPath: async () => envelope}};

        await expect(host.onGoldenPathRequest()).resolves.toEqual(landed);
        // the request reads the route's graph neighbourhood beside it, into its own leaf
        expect(host.writes).toEqual([
            {graphSceneEnvelope: GraphSceneEnvelope.fromWire({capability: {state: 'unavailable', reason: 'fleet graph scene verb not wired'}})},
            {goldenPathEnvelope: landed}
        ])
    });

    test('an unwired verb or a failed read lands as unavailable, never as an empty route', async () => {
        const unwired = makeHost();

        await unwired.loadGoldenPath();
        expect(unwired.writes).toEqual([{goldenPathEnvelope: GoldenPathEnvelope.fromWire({capability: {state: 'unavailable', reason: 'fleet golden path verb not wired'}})}]);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGoldenPath: async () => { throw new Error('secret read detail') }}};

        const failed = makeHost(),
              landed = await failed.loadGoldenPath();

        expect(landed.capability).toEqual({state: 'unavailable', capturedAt: null, reason: 'fleet golden path read failed'});
        expect(GoldenPathEnvelope.routeOf(landed)).toBeNull();
        expect(failed.writes).toHaveLength(1)
    });

    test('a request while a read is on the wire shares it: the cadence, Refresh, Reconnect and admission ask one wire (#898 AC-3)', async () => {
        let release,
            reads = 0;

        const
            host     = makeHost(),
            envelope = {capability: {state: 'degraded', reason: 'route-sidecar-missing'}},
            landed   = GoldenPathEnvelope.fromWire(envelope);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGoldenPath: () => { reads++; return new Promise(resolve => { release = resolve }) }}};

        // the cadence's launch holds the wire; Refresh, then Reconnect or the admission recovery, ask meanwhile
        const asked = [host.loadGoldenPath(), host.onGoldenPathRequest(), host.loadGoldenPath()];

        await Promise.resolve();
        expect(reads, 'one wire').toBe(1);
        expect(host.goldenPathReadInFlight).toBe(1);

        release(envelope);

        expect(await Promise.all(asked)).toEqual([landed, landed, landed]);
        expect(host.writes.filter(write => write.goldenPathEnvelope), 'one landing').toEqual([{goldenPathEnvelope: landed}]);
        expect(host.goldenPathReadInFlight, 'the wire\'s settle frees the next read').toBe(0);

        const next = host.loadGoldenPath();

        await Promise.resolve();
        expect(reads, 'a request after the settle reads anew').toBe(2);
        release(envelope);
        await next
    });

    test('a read that fails after its owner is destroyed lands nothing and reaches no provider', async () => {
        let fail;

        const
            host     = makeHost(),
            {writes} = host;

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGoldenPath: () => new Promise((resolve, reject) => { fail = reject })}};

        const read = host.loadGoldenPath();

        await Promise.resolve();

        // what Neo's destroy leaves (core.Base#destroy): every own entry deleted, then the flag
        Object.keys(host).forEach(key => delete host[key]);
        host.isDestroyed = true;

        fail(new Error('secret read detail'));

        await expect(read).resolves.toEqual(GoldenPathEnvelope.fromWire({capability: {state: 'unavailable', reason: 'fleet golden path read failed'}}));
        expect(writes).toEqual([])
    });

    test('a read through another profile\'s bridge retires the landed route and the read in flight; a same-profile failure keeps its own (#898 AC-4)', async () => {
        let releaseA;

        const
            {host, provider} = makeProviderHost(),
            leaf             = () => provider.getData('goldenPathEnvelope'),
            items            = id => [{id, title: id, score: 0.9, rank: 1, citations: []}],
            answer           = id => ({capability: {state: 'wired'}, admission: {admitted: true},
                route: {status: 'fresh', expiresAt: new Date(Date.now() + 3600000).toISOString(), expired: false, items: items(id)}}),
            bridge           = (profileId, fleetGoldenPath) => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: {profileId, fleetGoldenPath}} };

        bridge('profile-a', async () => answer('neo#1'));
        await host.loadGoldenPath();
        expect(GoldenPathEnvelope.currency(leaf())).toBe('current');

        bridge('profile-a', () => new Promise(resolve => { releaseA = resolve }));
        const lateA = host.loadGoldenPath();

        // the switch: B reads at once, though A's read still holds its wire, and B's first read fails
        bridge('profile-b', async () => { throw new Error('secret read detail') });
        await host.loadGoldenPath();

        expect(GoldenPathEnvelope.currency(leaf()), 'never A\'s route, withheld under B').toBe('unavailable');
        expect(GoldenPathEnvelope.routeOf(leaf())).toBeNull();

        releaseA(answer('neo#2'));
        await lateA;
        expect(GoldenPathEnvelope.currency(leaf()), 'A\'s late answer lands nowhere').toBe('unavailable');

        bridge('profile-b', async () => answer('neo#3'));
        await host.loadGoldenPath();
        expect(GoldenPathEnvelope.currency(leaf())).toBe('current');

        bridge('profile-b', async () => { throw new Error('secret read detail') });
        await host.loadGoldenPath();
        expect(GoldenPathEnvelope.currency(leaf()), 'a same-profile failure keeps the route').toBe('withheld');
        expect(leaf().route.items).toEqual(items('neo#3'));

        bridge('profile-b', async () => answer('neo#3'));
        await host.loadGoldenPath();
        expect(GoldenPathEnvelope.currency(leaf()), 'and its next answer recovers it').toBe('current');

        provider.destroy()
    });

    test('a failed re-read keeps the route in the real provider leaf, withheld with the read\'s reason (#898 AC-4)', async () => {
        const
            {host, provider} = makeProviderHost(),
            items            = [{id: 'neo#210', title: 'Golden Path pane', score: 0.87, rank: 1, citations: []}],
            route            = {status: 'fresh', expiresAt: new Date(Date.now() + 3600000).toISOString(), expired: false, items};

        let fail = false;

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGoldenPath: async () => {
            if (fail) throw new Error('secret read detail');
            return {capability: {state: 'wired'}, admission: {admitted: true}, route}
        }}};

        await host.loadGoldenPath();
        expect(GoldenPathEnvelope.currency(provider.getData('goldenPathEnvelope'))).toBe('current');

        fail = true;

        const kept = await host.loadGoldenPath(),
              leaf = provider.getData('goldenPathEnvelope');

        expect(GoldenPathEnvelope.currency(leaf), 'never current').toBe('withheld');
        expect(GoldenPathEnvelope.withheldReason(leaf)).toBe('fleet golden path read failed');
        expect(leaf.route.items, 'never an empty pane').toEqual(items);
        expect(kept.read).toEqual({state: 'failed', reason: 'fleet golden path read failed'});

        fail = false;
        await host.loadGoldenPath();
        expect(GoldenPathEnvelope.currency(provider.getData('goldenPathEnvelope')), 'the next answer clears the mark').toBe('current');

        provider.destroy()
    });

    test('a landed route sets the next read: at a current route\'s expiry, else one interval out; one read counts in flight (#898 AC-3)', async () => {
        const
            {host, provider} = makeProviderHost(),
            now              = Date.now(),
            expiresAt        = now + 3600000;

        host.livenessSchedule = LivenessCadence.create(now, LivenessCadence.DEFAULT_INTERVALS);

        host.writeGoldenPath({capability: {state: 'wired'}, admission: {admitted: true}, route: {status: 'fresh', expiresAt: new Date(expiresAt).toISOString(), items: []}}, now);
        expect(host.livenessSchedule.goldenPath, 'an hour-long route is read again at its expiry, not every two minutes').toBe(expiresAt);

        host.writeGoldenPath({capability: {state: 'degraded', reason: 'route-sidecar-missing'}}, now);
        expect(host.livenessSchedule.goldenPath).toBe(now + LivenessCadence.DEFAULT_INTERVALS.goldenPath);

        let resolve;

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGoldenPath: () => new Promise(done => { resolve = done })}};

        const read = host.loadGoldenPath();

        expect(host.goldenPathReadInFlight).toBe(1);
        await Promise.resolve();
        resolve({capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}});
        await read;
        expect(host.goldenPathReadInFlight).toBe(0);

        provider.destroy()
    });
});

test.describe('FleetCockpit — graph scene owner routing', () => {
    test.afterEach(() => clearBridge());

    const scene = {
        capability: {state: 'current', reason: null},
        scene     : {route: ['neomjs/neo#issue-1'], nodes: [{id: 'neomjs/neo#issue-1', label: 'one', kind: 'issue'}], edges: [],
            counts: {nodes: 1, edges: 0, seeds: 1}, budget: {maxNodes: 150, maxEdges: 300, maxBytes: 32768}, completeness: 'complete'},
        snapshotId: 'snap-1',
        capturedAt: '2026-09-26T22:00:00.000Z'
    };

    test('the load reads the verb into the graph scene leaf and never writes the Golden Path leaf', async () => {
        const host = makeHost();

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGraphScene: async () => scene}};

        await expect(host.loadGraphScene()).resolves.toEqual(GraphSceneEnvelope.fromWire(scene));
        expect(host.writes).toEqual([{graphSceneEnvelope: GraphSceneEnvelope.fromWire(scene)}])
    });

    test('an unwired verb or a failed read lands as unavailable with its own reason', async () => {
        const unwired = makeHost();

        expect((await unwired.loadGraphScene()).capability).toEqual({state: 'unavailable', reason: 'fleet graph scene verb not wired'});

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGraphScene: async () => { throw new Error('secret read detail') }}};

        const failed = makeHost();

        expect((await failed.loadGraphScene()).capability).toEqual({state: 'unavailable', reason: 'fleet graph scene read failed'});
        expect(failed.writes).toHaveLength(1)
    });

    test('an older read loses the generation race and writes nothing', async () => {
        let resolveOld,
            reads = 0;

        const host = makeHost(),
              old  = new Promise(resolve => { resolveOld = resolve });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGraphScene: () => ++reads === 1 ? old : Promise.resolve({capability: {state: 'degraded', reason: 'new'}})}};

        const first  = host.loadGraphScene(),
              second = host.loadGraphScene();

        await second;
        resolveOld(scene);
        await first;

        expect(host.writes.map(({graphSceneEnvelope}) => graphSceneEnvelope.capability.reason)).toEqual(['new'])
    });

    test('a read through another profile\'s bridge retires the landed scene before it waits; a same-profile refresh keeps its own', async () => {
        let resolveB;

        const host     = makeHost(),
              sceneB   = {...scene, snapshotId: 'snap-b'},
              pendingB = new Promise(resolve => { resolveB = resolve });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {profileId: 'profile-a', fleetGraphScene: async () => scene}};
        await host.loadGraphScene();
        await host.loadGraphScene();

        expect(host.writes.map(({graphSceneEnvelope}) => graphSceneEnvelope.snapshotId), 'a same-profile refresh never blanks').toEqual(['snap-1', 'snap-1']);

        globalThis.AgentOS.fleet.registryBridge = {profileId: 'profile-b', fleetGraphScene: () => pendingB};

        const readB = host.loadGraphScene();

        expect(host.writes.at(-1), 'profile A\'s scene is retired while B is pending').toEqual({graphSceneEnvelope: GraphSceneEnvelope.blank()});

        resolveB(sceneB);
        await readB;

        expect(host.writes.at(-1)).toEqual({graphSceneEnvelope: GraphSceneEnvelope.fromWire(sceneB)});
        expect(host.writes).toHaveLength(4)
    });
});
