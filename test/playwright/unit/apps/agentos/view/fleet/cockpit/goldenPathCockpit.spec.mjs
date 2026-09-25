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

// the load is a CONTROLLER method: a prototype host with a recording provider on the component seat
// drives it as production code, like the catch-up owner spec
const makeHost = () => {
    const writes = [];

    return Object.assign(Object.create(FleetCockpitController.prototype), {
        component               : {getStateProvider: () => ({setData: data => writes.push(data)})},
        goldenPathReadGeneration: 0,
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
        expect(host.writes).toEqual([{goldenPathEnvelope: landed}])
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
