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
import {installFleetBridge} from '../../../../../../../../apps/agentos/fleet/installFleetBridge.mjs';
import {
    createFleetWireResponse,
    FLEET_WIRE_RESPONSE_STATES
} from 'neo-agent-brain/fleet-contract';

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
    });

    test('the pipeline (#113): a starved-plane envelope through the REAL bridge lands on the live pane and renders — the wait as text, the row\'s own cause, the lease line, counts starved · known · shown', async () => {
        const
            TasksPane = (await import('../../../../../../../../apps/agentos/view/fleet/tasks/Container.mjs')).default,
            checkedAt = '2026-09-05T12:49:36.362Z',
            envelope  = {
                capability: {state: 'wired', capturedAt: '2026-09-05T12:50:00.000Z'},
                viewer    : '@neo-fable-clio',
                sources   : {
                    deployment: {state: 'wired', reason: null, observedAt: '2026-09-05T12:47:55.668Z'},
                    rem       : {state: 'wired', reason: null},
                    ingestion : {state: 'unwired', reason: 'ingestion-verb-unreachable-from-this-process', scope: null}
                },
                scheduler: {leaseHolder: 'summary', leaseStatus: null, checkedAt, degradeAfterMs: 3600000, posture: 'degraded', starvedTotal: 1, unreadableCount: 0},
                running  : [],
                queued   : [{id: 'orchestrator:starvation:dream', section: 'queued', name: 'dream', source: 'orchestrator', state: 'starved', at: '2026-09-05T10:05:51.967Z', progress: null, detail: null, waitMs: 9824395, thresholdMs: 3600000, checkedAt, reasonCode: 'heavy-maintenance-lease-held', blockingTaskName: null, leaseOwner: 'summary', priorityZero: false, bootstrapCritical: false}],
                recent   : [],
                counts   : {running: 0, queued: 1, recent: 0, queuedKnown: 1}
            },
            previous  = globalThis.AgentOS?.fleet;

        // the production proxy over a controllable wire: the envelope rides a validated ok response
        installFleetBridge({credentialIngress: 'shell', send: () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result: envelope}), target: globalThis});

        const pane = Neo.create(TasksPane),
              host = makeHost(pane);

        try {
            const snapshot = await host.loadTasks();

            expect(snapshot.scheduler).toEqual(envelope.scheduler);
            // the reactive config holds its own copy of the envelope — same facts, not the same object
            expect(pane.snapshot).toEqual(snapshot);

            const
                nodes = pane.getReference('tasks-list').getVdomRoot().cn.filter(Boolean),
                head  = nodes.find(node => node.cls?.includes('fm-tasks-section-head') && node.cls?.includes('is-queued')),
                lease = nodes.find(node => node.cls?.includes('fm-tasks-section-meta')),
                row   = nodes.find(node => node.cls?.includes('fm-task-row') && node.cls?.includes('is-queued')),
                cell  = cls => row.cn.find(child => child.cls?.includes(cls));

            expect(head.cn.find(child => child.cls?.includes('fm-tasks-section-count')).html).toBe('<b>1</b> starved · <b>1</b> known · <b>1</b> shown');
            expect(head.cn.find(child => child.cls?.includes('is-source-orchestrator')).text, 'one source → hoisted to the head').toBe('orchestrator');
            expect(lease.cn[0].html).toContain('maintenance lease · <b>summary</b> · posture <span class="is-degraded">degraded</span>');
            expect(cell('fm-task-state').text).toBe('starved');
            expect(cell('fm-task-wait').cn[0].text).toBe('waiting 2 h 43 min');
            expect(cell('fm-task-wait').cn[1].text).toBe('threshold 1 h');
            expect(cell('fm-task-cause').html).toBe('lease held by <b>summary</b>');
            expect(cell('is-source-orchestrator'), 'no row chip in a homogeneous section').toBeUndefined();
            expect(host.tasksReadInFlight, 'released on settle').toBe(0)
        } finally {
            pane.destroy();
            if (previous === undefined) { delete globalThis.AgentOS.fleet } else { globalThis.AgentOS.fleet = previous }
        }
    })
});
