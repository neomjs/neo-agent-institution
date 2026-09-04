import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitTasksReadTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * Covers the cockpit-owned tasks read (`loadTasks`): the wake-routes loader's three laws (typed
 * unavailable envelope, generation fence, write-time pane resolution) PLUS the liveness tick's
 * in-flight accounting — the count rises before the wire call and is released on that read's OWN
 * settle, so a slow snapshot read is never stacked by the next tick and a newer read never
 * releases an older one's slot. Prototype-call harness, bridge mock scoped to the `fleet` subkey.
 */
test.describe('Fleet cockpit — the tasks read (loadTasks)', () => {
    let FleetCockpitController;

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    const clearFleetBridge = () => { delete globalThis.AgentOS?.fleet };
    const setFleetBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };

    const makeHost = pane => Object.assign(Object.create(FleetCockpitController.prototype), {
        component          : {getTasksPane: () => pane},
        isDestroyed        : false,
        tasksReadGeneration: 0,
        tasksReadInFlight  : 0,
        tasksSnapshot      : null
    });

    test('an unwired verb lands as a typed unavailable envelope on the owner AND the live pane', async () => {
        clearFleetBridge();

        const pane = {snapshot: null},
              host = makeHost(pane);

        const snapshot = await host.loadTasks();

        expect(snapshot.capability).toEqual({state: 'unavailable', reason: 'fleet tasks verb not wired'});
        expect(snapshot.running).toEqual([]);
        expect(snapshot.queued).toEqual([]);
        expect(snapshot.recent).toEqual([]);
        expect(host.tasksSnapshot).toBe(snapshot);
        expect(pane.snapshot).toBe(snapshot);
        expect(host.tasksReadInFlight, 'released on settle').toBe(0)
    });

    test('a throwing bridge is transport truth, never fabricated rows — and still releases its slot', async () => {
        setFleetBridge({fleetTasks: () => { throw new Error('boom') }});

        try {
            const host     = makeHost(null),
                  snapshot = await host.loadTasks();

            expect(snapshot.capability.reason).toBe('fleet tasks read failed');
            expect(snapshot.counts).toEqual({running: 0, queued: 0, recent: 0});
            expect(host.tasksReadInFlight).toBe(0)
        } finally {
            clearFleetBridge()
        }
    });

    test('the generation fence + in-flight accounting: the loser never writes, each read releases only itself', async () => {
        const wires = [];

        setFleetBridge({fleetTasks: () => new Promise(resolve => wires.push(resolve))});

        try {
            const pane = {snapshot: null},
                  host = makeHost(pane);

            const slow = host.loadTasks(),
                  fast = host.loadTasks();

            expect(host.tasksReadInFlight, 'two unsettled reads on the wire').toBe(2);

            const newer = {capability: {state: 'wired'}, running: [{id: 'a'}], queued: [], recent: []},
                  older = {capability: {state: 'wired'}, running: [], queued: [], recent: []};

            wires[1](newer);
            await fast;
            expect(host.tasksSnapshot).toBe(newer);
            expect(pane.snapshot).toBe(newer);
            expect(host.tasksReadInFlight, 'the slow read still holds its slot').toBe(1);

            wires[0](older);
            await slow;
            expect(host.tasksSnapshot, 'the loser never writes').toBe(newer);
            expect(pane.snapshot).toBe(newer);
            expect(host.tasksReadInFlight).toBe(0)
        } finally {
            clearFleetBridge()
        }
    })
});
