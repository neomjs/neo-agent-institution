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

// the load is a CONTROLLER method: a prototype host with a recording provider on the component seat
// drives it as production code, like the catch-up owner spec
const makeHost = () => {
    const writes = [];

    return Object.assign(Object.create(FleetCockpitController.prototype), {
        component               : {getStateProvider: () => ({setData: data => writes.push(data)})},
        goldenPathReadGeneration: 0,
        graphSceneReadGeneration: 0,
        isDestroyed             : false,
        writes
    })
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

    test('an older read loses the generation race and writes nothing', async () => {
        let resolveOld,
            reads = 0;

        const host = makeHost(),
              old  = new Promise(resolve => { resolveOld = resolve });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetGoldenPath: () => ++reads === 1 ? old : Promise.resolve({capability: {state: 'degraded', reason: 'new'}})}};

        const first  = host.loadGoldenPath(),
              second = host.loadGoldenPath();

        await second;
        resolveOld({capability: {state: 'wired'}});
        await first;

        expect(host.writes.map(({goldenPathEnvelope}) => goldenPathEnvelope.capability.reason)).toEqual(['new'])
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
