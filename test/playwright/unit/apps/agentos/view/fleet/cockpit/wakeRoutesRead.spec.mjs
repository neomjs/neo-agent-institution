import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitWakeRoutesReadTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * Covers the cockpit-owned wake-routes read (`loadWakeRoutes`): the memories-sibling loader under
 * the same three laws — a typed unavailable envelope for an unwired or throwing bridge (never
 * fabricated seats), the generation fence (a slow older read never overwrites a newer one), and
 * write-time pane resolution (the accepted truth reaches the LIVE pane, and an owner-held snapshot
 * survives pane rematerialization). Prototype-call harness; the bridge mock is scoped to the
 * `fleet` subkey only, per the loadActivity block's discipline.
 */
test.describe('Fleet cockpit — the wake-routes read (loadWakeRoutes)', () => {
    let FleetCockpitController;

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    const clearFleetBridge = () => { delete globalThis.AgentOS?.fleet };
    const setFleetBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };

    const makeHost = pane => Object.assign(Object.create(FleetCockpitController.prototype), {
        component               : {getWakeRoutesPane: () => pane},
        isDestroyed             : false,
        wakeRoutesReadGeneration: 0,
        wakeRoutesSnapshot      : null
    });

    test('an unwired verb lands as a typed unavailable envelope on the owner AND the live pane', async () => {
        clearFleetBridge();

        const pane = {snapshot: null},
              host = makeHost(pane);

        const snapshot = await host.loadWakeRoutes();

        expect(snapshot.capability).toEqual({state: 'unavailable', reason: 'fleet wake-routes verb not wired'});
        expect(snapshot.seats).toEqual([]);
        expect(host.wakeRoutesSnapshot).toBe(snapshot);
        expect(pane.snapshot).toBe(snapshot)
    });

    test('a throwing bridge is transport truth, never fabricated seats', async () => {
        setFleetBridge({fleetWakeRoutes: () => { throw new Error('boom') }});

        try {
            const host     = makeHost(null),
                  snapshot = await host.loadWakeRoutes();

            expect(snapshot.capability.reason).toBe('fleet wake-routes read failed');
            expect(snapshot.seats).toEqual([])
        } finally {
            clearFleetBridge()
        }
    });

    test('the generation fence: a slow older read never overwrites the newer accepted truth', async () => {
        const wires = [];

        setFleetBridge({fleetWakeRoutes: () => new Promise(resolve => wires.push(resolve))});

        try {
            const pane = {snapshot: null},
                  host = makeHost(pane);

            const slow = host.loadWakeRoutes(),
                  fast = host.loadWakeRoutes();

            const newer = {capability: {state: 'wired'}, count: 1, seats: [{agentIdentity: '@a'}]},
                  older = {capability: {state: 'wired'}, count: 9, seats: []};

            wires[1](newer);
            await fast;
            expect(host.wakeRoutesSnapshot).toBe(newer);
            expect(pane.snapshot).toBe(newer);

            wires[0](older);
            await slow;
            expect(host.wakeRoutesSnapshot, 'the loser never writes').toBe(newer);
            expect(pane.snapshot).toBe(newer)
        } finally {
            clearFleetBridge()
        }
    })
});
