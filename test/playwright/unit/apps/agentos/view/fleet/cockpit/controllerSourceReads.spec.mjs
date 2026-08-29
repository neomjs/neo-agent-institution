import {setup} from '../../../../../../setup.mjs';

setup({appConfig: {name: 'CockpitSourceReadsTest'}});

import {test, expect}       from '@playwright/test';
import Neo                  from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core            from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import FleetCockpitController from '../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs';

/**
 * Drive one controller verb against a view stub — prototype dispatch with `this.component`
 * bound, no instance lifecycle (the laws under test are the verbs', not the controller's).
 * @param {Object} view @param {String} verb @param {...*} args @returns {*}
 */
const drive = (view, verb, ...args) => FleetCockpitController.prototype[verb].call({component: view}, ...args);

/**
 * The fenced source-read laws, pinned ONCE at the discipline (#48, first cut of Epic #22) instead
 * of per-source stubs: generation fence, typed fallback on unwired AND throwing bridges,
 * WRITE-time pane resolution (a destroyed-during-await owner never gets written), tasks in-flight
 * release on the read's OWN settle, and the operator-inbox gate + keep-last-truth error mode.
 * The cockpit's verbs are thin delegates over exactly these paths.
 */
test.describe('AgentOS.view.fleet.cockpit.Controller — the fenced source-read + liveness disciplines', () => {
    /** @returns {Object} a minimal owner carrying the fields the descriptors touch */
    function makeOwner(pane = {}) {
        return {
            isDestroyed: false,

            catchUpReadGeneration      : 0,
            memoriesReadGeneration     : 0,
            memoriesDrillReadGeneration: 0,
            wakeRoutesReadGeneration   : 0,
            tasksReadGeneration        : 0,
            operatorInboxReadGeneration: 0,
            tasksReadInFlight          : 0,

            catchUpSnapshot: null, memoriesSnapshot: null, memoriesDrillSnapshot: null,
            wakeRoutesSnapshot: null, tasksSnapshot: null, operatorSnapshot: null,
            memoriesTarget: null, memoriesDrillSession: null,
            operatorRecord: {agentIdentityNodeId: '@e2e-operator'},

            getCatchUpPane        : () => pane,
            getMemoriesPane       : () => pane,
            getWakeRoutesPane     : () => pane,
            getTasksPane          : () => pane,
            getOperatorMailboxPane: () => pane
        }
    }

    const withBridge = async (bridge, run) => {
        const held = globalThis.AgentOS;
        globalThis.AgentOS = {fleet: {registryBridge: bridge}};
        try { return await run() } finally { globalThis.AgentOS = held }
    };

    test('an unwired verb lands the typed unavailable fallback — never a fabricated success', async () => {
        const owner = makeOwner();

        const snapshot = await withBridge({}, () => drive(owner, 'loadMemories', {agentIdentity: '@x'}));

        expect(snapshot.capability).toEqual({state: 'unavailable', reason: 'fleet memories verb not wired'});
        expect(snapshot.target).toBe('@x');
        expect(owner.memoriesSnapshot).toBe(snapshot);
        // the pre-await hold ran even though the verb was absent — the pending truth is honest
        expect(owner.memoriesTarget).toBe('@x')
    });

    test('a throwing bridge lands the typed failed fallback under the same envelope shape', async () => {
        const owner = makeOwner();

        const snapshot = await withBridge(
            {fleetWakeRoutes: async () => { throw new Error('boom') }},
            () => drive(owner, 'loadWakeRoutes', {})
        );

        expect(snapshot.capability.reason).toBe('fleet wake-routes read failed');
        expect(snapshot.seats).toEqual([]);
        expect(owner.wakeRoutesSnapshot).toBe(snapshot)
    });

    test('the generation fence: a slow OLDER read never overwrites a newer one', async () => {
        const owner = makeOwner();
        let releaseSlow;

        const slowSnapshot = {capability: {state: 'wired'}, sessions: ['old'], count: 1};
        const fastSnapshot = {capability: {state: 'wired'}, sessions: ['new'], count: 1};

        const slow = withBridge(
            {fleetMemories: () => new Promise(resolve => { releaseSlow = () => resolve(slowSnapshot) })},
            () => drive(owner, 'loadMemories', {agentIdentity: '@a'})
        );

        await Promise.resolve();   // the slow read has bumped its generation and is awaiting

        await withBridge(
            {fleetMemories: async () => fastSnapshot},
            () => drive(owner, 'loadMemories', {agentIdentity: '@b'})
        );

        expect(owner.memoriesSnapshot).toBe(fastSnapshot);

        releaseSlow();
        await slow;

        // the loser returned its payload but wrote NOTHING
        expect(owner.memoriesSnapshot).toBe(fastSnapshot);
        expect(owner.memoriesTarget).toBe('@b')
    });

    test('WRITE-time resolution: an owner destroyed during the await is never written', async () => {
        const owner = makeOwner();
        let release;

        const pending = withBridge(
            {fleetTasks: () => new Promise(resolve => { release = () => resolve({capability: {state: 'wired'}}) })},
            () => drive(owner, 'loadTasks', {})
        );

        await Promise.resolve();
        owner.isDestroyed = true;
        release();
        await pending;

        expect(owner.tasksSnapshot).toBe(null)
    });

    test('tasks in-flight accounting releases on the read\'s OWN settle — throw included', async () => {
        const owner = makeOwner();

        expect(owner.tasksReadInFlight).toBe(0);

        let observedDuring;

        await withBridge(
            {fleetTasks: async () => { observedDuring = owner.tasksReadInFlight; throw new Error('down') }},
            () => drive(owner, 'loadTasks', {})
        );

        expect(observedDuring).toBe(1);
        expect(owner.tasksReadInFlight).toBe(0)
    });

    test('the operator-inbox gate refuses honestly (no write) and a throwing bridge KEEPS the last truth', async () => {
        const owner = makeOwner();

        // gate: no bound subject → silent honest return, nothing written, nothing thrown
        owner.operatorRecord = null;
        const refused = await withBridge(
            {fleetMailboxMirror: async () => ({rows: ['never']})},
            () => drive(owner, 'loadOperatorInbox', {})
        );
        expect(refused).toBe(undefined);
        expect(owner.operatorSnapshot).toBe(null);

        // keep-last-truth: an accepted snapshot survives a later throwing read
        owner.operatorRecord = {agentIdentityNodeId: '@e2e-operator'};
        const accepted = {rows: ['truth'], page: {offset: 0}};

        await withBridge(
            {fleetMailboxMirror: async wire => {
                expect(wire).toEqual({subjectAgentId: '@e2e-operator', offset: 0});
                return accepted
            }},
            () => drive(owner, 'loadOperatorInbox', {})
        );
        expect(owner.operatorSnapshot).toBe(accepted);

        await withBridge(
            {fleetMailboxMirror: async () => { throw new Error('wire down') }},
            () => drive(owner, 'loadOperatorInbox', {offset: 50})
        );
        expect(owner.operatorSnapshot).toBe(accepted)
    });

    test('the drill close is TERMINAL for in-flight reads (the clear bumps the fence)', async () => {
        const owner = makeOwner();
        let release;

        const pending = withBridge(
            {fleetSessionMemories: () => new Promise(resolve => { release = () => resolve({capability: {state: 'wired'}, turns: ['late']}) })},
            () => drive(owner, 'loadSessionMemories', {sessionId: 'S1', title: 'T'})
        );

        await Promise.resolve();
        expect(owner.memoriesDrillSession).toEqual({sessionId: 'S1', title: 'T'});

        drive(owner, 'clearSessionMemoriesDrill');
        release();
        await pending;

        // the read landed after close: owner state stays cleared, nothing repopulates
        expect(owner.memoriesDrillSession).toBe(null);
        expect(owner.memoriesDrillSnapshot).toBe(null)
    });

    test('loadOperatorIdentity dispatches posture through the OWNER — a custom override is invoked, never the private default', async () => {
        const calls = [];
        const pane  = {set(values) { calls.push(values) }};
        const owner = {
            isDestroyed           : false,
            operatorRecord        : null,
            operatorIdentityPosture: null,
            getOperatorMailboxPane: () => pane,
            // the sentinel override — the shipped virtual seam this witness pins (review control
            // on the first head returned static-bypass; this test is red against that head)
            deriveOperatorIdentityPosture(nodeId) {
                calls.push({override: nodeId});
                return {conflated: false, seatIdentity: nodeId, sentinel: true}
            }
        };

        await withBridge(
            {resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@sentinel-seat'})},
            () => drive(owner, 'loadOperatorIdentity')
        );

        expect(calls[0]).toEqual({override: '@sentinel-seat'});
        expect(owner.operatorIdentityPosture).toEqual({conflated: false, seatIdentity: '@sentinel-seat', sentinel: true});
        expect(owner.operatorRecord).toEqual({agentIdentityNodeId: '@sentinel-seat', githubUsername: 'sentinel-seat'});
        expect(calls[1]).toEqual({record: owner.operatorRecord, identityPosture: owner.operatorIdentityPosture})
    });

    test('liveness class: owner overrides seat for the collaborator seams (the #49 virtual-dispatch law)', async () => {
        const calls = [];
        const store = {items: [], clear() { calls.push('clear') }, add(rows) { calls.push({add: rows.length}) }};
        const owner = {
            isDestroyed: false,
            gridReadGeneration: 0, gridReadInFlight: 0,
            rosterWired: true, rosterSourceMode: 'selected', lastLiveRows: null,
            gridAdapterState: 'live', gridDegradedReason: 'stale-cause',
            livenessReadTimeout: 500,
            operatorRecord: null,
            catchUpSnapshot: null,
            resolveFleetRosterStore: () => store,
            getReference: () => null,
            getCatchUpPane: () => null,
            getOperatorMailboxPane: () => null,
            mapRosterRow: row => ({agentId: row.id, mapped: true}),
            // the sentinels — a static bypass of either fails this witness
            reconcileRoster(target, mapped) { calls.push({reconcile: mapped.length, target: target === store}) },
            reconcileSelection() { calls.push('reselect') },
            clearDegradedReason(surface) { calls.push({clear: surface}); this.gridDegradedReason = null },
            buildCatchUpPartitionOptions: () => [],
            buildActivityActorDirectory : () => ({}),
            buildOperatorRecipientOptions: () => [],
            deriveOperatorIdentityPosture: () => null,
            syncSpineBanner() { calls.push('banner') },
            degradeWiredSurface() { calls.push('degrade') }
        };

        await withBridge(
            {selected: true, fleetRoster: async () => ({capabilities: {}, rows: [{id: 'a'}, {id: 'b'}]})},
            () => drive(owner, 'loadRoster')
        );

        expect(calls).toContainEqual({reconcile: 2, target: true});
        expect(calls).toContainEqual({clear: 'grid'});
        expect(calls).toContain('banner');
        expect(owner.gridAdapterState).toBe('live')
    });

    test('liveness class: the fence bumps BEFORE the cold-truth exit — an absence tick invalidates an older in-flight read', async () => {
        const owner = {
            isDestroyed: false,
            streamReadGeneration: 0, streamReadInFlight: 0,
            streamAdapterState: 'sample', streamDegradedReason: 'left-over',
            activityWired: false,
            livenessReadTimeout: 500,
            resolveFleetActivityEventsStore: () => null,   // cold truth
            getReference: () => null,
            getStateProvider: () => null,
            syncSpineBanner() {},
            degradeWiredSurface() { throw new Error('must not degrade on the cold path') },
            clearDegradedReason() {}
        };

        await withBridge({}, () => drive(owner, 'loadActivity'));

        // the cold tick bumped the fence (newer knowledge) and retracted the sample-state cause
        expect(owner.streamReadGeneration).toBe(1);
        expect(owner.streamDegradedReason).toBe(null)
    });

    test('liveness class: a degrade in the catch dispatches the OWNER seam, fenced', async () => {
        const calls = [];
        const owner = {
            isDestroyed: false,
            streamReadGeneration: 0, streamReadInFlight: 0,
            streamAdapterState: 'live', streamDegradedReason: null,
            activityWired: true,
            livenessReadTimeout: 500,
            resolveFleetActivityEventsStore: () => ({ingestSnapshot() {}}),
            getReference: () => null,
            getStateProvider: () => null,
            syncSpineBanner() { calls.push('banner') },
            degradeWiredSurface(surface, error) { calls.push({degrade: surface, safe: typeof error}) },
            clearDegradedReason() {}
        };

        await withBridge(
            {fleetActivity: async () => { throw new Error('wire down') }},
            () => drive(owner, 'loadActivity')
        );

        expect(calls[0]).toEqual({degrade: 'stream', safe: 'object'});
        expect(calls).toContain('banner')
    });

    test('the wire payload strips display-only title on the drill read', async () => {
        const owner = makeOwner();
        let seenWire;

        await withBridge(
            {fleetSessionMemories: async wire => { seenWire = wire; return {capability: {state: 'wired'}} }},
            () => drive(owner, 'loadSessionMemories', {sessionId: 'S1', title: 'display only', offset: 5})
        );

        expect(seenWire).toEqual({sessionId: 'S1', offset: 5})
    });
});
