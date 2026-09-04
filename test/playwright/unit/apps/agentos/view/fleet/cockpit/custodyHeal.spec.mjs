import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'AgentOSFleetCockpitCustodyHealTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs'; // defines Neo.get — the container child-add path resolves parents through it
import FleetActivityEvents  from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import FleetCockpit         from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import FleetRoster          from '../../../../../../../../apps/agentos/store/FleetRoster.mjs';
import CockpitStateProvider from '../../../../../../../../apps/agentos/view/fleet/cockpit/StateProvider.mjs';
import ViewerWakeFeed       from '../../../../../../../../apps/agentos/store/ViewerWakeFeed.mjs';

/**
 * The liveness owner follows the boot-time custody heal. A fresh boot against an armed fleet server
 * runs its construct-time reads on the fail-closed bridge, gets custody promoted a few hundred
 * milliseconds later, and — before this — sat on that cold verdict until the next cadence tick
 * (measured: promotion at 0.3s, the first wire read at 15s). The boot module publishes the in-flight
 * heal as `AgentOS.fleet.custodyHeal`; `startLiveness` chains exactly one Reconnect-equivalent
 * re-drive onto a `true` resolution, and nothing onto anything else.
 */
test.describe.serial('AgentOS.view.fleet.cockpit.LivenessController — following the custody heal', () => {
    let cockpit, prevFleet, settleHeal;

    const createCockpit = () => {
        cockpit = Neo.create(FleetCockpit, {
            // hermetic: the REAL cockpit provider class, with the store block overridden so no
            // sample-seed fetch runs in the unit env
            stateProvider: {
                module: CockpitStateProvider,
                stores: {
                    fleetActivityEvents: {module: FleetActivityEvents},
                    fleetRoster        : {module: FleetRoster, autoLoad: false},
                    viewerWakeFeed     : {module: ViewerWakeFeed}
                }
            }
        });

        // the heal settles AFTER construction — the spy lands before anything can resolve
        const controller = cockpit.getController();

        controller.reconnectFleetCalls = 0;
        controller.reconnectFleet      = () => { controller.reconnectFleetCalls++ };

        return controller
    };

    test.beforeEach(() => {
        prevFleet = globalThis.AgentOS?.fleet;
        // the boot module's shape: the slot exists before the shell constructs
        globalThis.AgentOS.fleet = {custodyHeal: new Promise(resolve => { settleHeal = resolve })}
    });

    test.afterEach(() => {
        cockpit?.destroy();
        cockpit = null;
        // stub only the `fleet` key and restore it — never delete the AgentOS namespace
        prevFleet === undefined ? delete globalThis.AgentOS?.fleet : globalThis.AgentOS.fleet = prevFleet
    });

    test('a heal that promotes re-drives every seam once — now, not at the next cadence tick', async () => {
        const controller = createCockpit();

        expect(controller.reconnectFleetCalls).toBe(0);

        settleHeal(true);

        await expect.poll(() => controller.reconnectFleetCalls).toBe(1);

        // the promise is settled: nothing fires again, and the cadence timer is untouched
        await Promise.resolve();
        expect(controller.reconnectFleetCalls).toBe(1);
        expect(controller.livenessTimerId).not.toBeNull()
    });

    test('a heal that ends without promotion changes nothing', async () => {
        const controller = createCockpit();

        settleHeal(false);

        await Promise.resolve();
        await Promise.resolve();

        expect(controller.reconnectFleetCalls).toBe(0)
    });

    test('a promotion after liveness stopped re-drives nothing — no read on behalf of a gone surface', async () => {
        const controller = createCockpit();

        controller.stopLiveness();
        settleHeal(true);

        await Promise.resolve();
        await Promise.resolve();

        expect(controller.reconnectFleetCalls).toBe(0)
    });

    test('a boot without a published heal is the boot we had — the owner reads its slot as "no heal"', async () => {
        delete globalThis.AgentOS.fleet.custodyHeal;

        const controller = createCockpit();

        await Promise.resolve();

        expect(controller.reconnectFleetCalls).toBe(0);
        expect(controller.livenessTimerId).not.toBeNull()
    });

    // A promise callback cannot be detached: the liveness owner supports stop → start, and a restart
    // before the heal settles would otherwise leave two callbacks that both see a running timer.
    test('a stop/restart before the heal settles re-drives exactly once — the callback is fenced to the liveness generation that attached it', async () => {
        const controller = createCockpit();

        controller.stopLiveness();
        controller.startLiveness();

        settleHeal(true);

        await expect.poll(() => controller.reconnectFleetCalls).toBe(1);
        await Promise.resolve();
        expect(controller.reconnectFleetCalls).toBe(1)
    });

    test('a second start while liveness runs attaches nothing — the heal still re-drives once', async () => {
        const controller = createCockpit();

        controller.startLiveness();

        settleHeal(true);

        await expect.poll(() => controller.reconnectFleetCalls).toBe(1);
        await Promise.resolve();
        expect(controller.reconnectFleetCalls).toBe(1)
    })
});
