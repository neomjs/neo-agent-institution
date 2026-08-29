import {setup} from '../../../../setup.mjs';

setup({appConfig: {name: 'CockpitSourceReadsTest'}});

import {test, expect}    from '@playwright/test';
import Neo               from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core         from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import CockpitSourceReads from '../../../../../../apps/agentos/util/CockpitSourceReads.mjs';

const {readFencedSource, SOURCE_READS} = CockpitSourceReads;

/**
 * The fenced source-read laws, pinned ONCE at the discipline (#48, first cut of Epic #22) instead
 * of per-source stubs: generation fence, typed fallback on unwired AND throwing bridges,
 * WRITE-time pane resolution (a destroyed-during-await owner never gets written), tasks in-flight
 * release on the read's OWN settle, and the operator-inbox gate + keep-last-truth error mode.
 * The cockpit's verbs are thin delegates over exactly these paths.
 */
test.describe('AgentOS.util.CockpitSourceReads — the one fenced-read discipline', () => {
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

        const snapshot = await withBridge({}, () => readFencedSource(owner, SOURCE_READS.memories, {agentIdentity: '@x'}));

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
            () => readFencedSource(owner, SOURCE_READS.wakeRoutes, {})
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
            () => readFencedSource(owner, SOURCE_READS.memories, {agentIdentity: '@a'})
        );

        await Promise.resolve();   // the slow read has bumped its generation and is awaiting

        await withBridge(
            {fleetMemories: async () => fastSnapshot},
            () => readFencedSource(owner, SOURCE_READS.memories, {agentIdentity: '@b'})
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
            () => readFencedSource(owner, SOURCE_READS.tasks, {})
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
            () => readFencedSource(owner, SOURCE_READS.tasks, {})
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
            () => readFencedSource(owner, SOURCE_READS.operatorInbox, {})
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
            () => readFencedSource(owner, SOURCE_READS.operatorInbox, {})
        );
        expect(owner.operatorSnapshot).toBe(accepted);

        await withBridge(
            {fleetMailboxMirror: async () => { throw new Error('wire down') }},
            () => readFencedSource(owner, SOURCE_READS.operatorInbox, {offset: 50})
        );
        expect(owner.operatorSnapshot).toBe(accepted)
    });

    test('the drill close is TERMINAL for in-flight reads (the clear bumps the fence)', async () => {
        const owner = makeOwner();
        let release;

        const pending = withBridge(
            {fleetSessionMemories: () => new Promise(resolve => { release = () => resolve({capability: {state: 'wired'}, turns: ['late']}) })},
            () => readFencedSource(owner, SOURCE_READS.sessionMemories, {sessionId: 'S1', title: 'T'})
        );

        await Promise.resolve();
        expect(owner.memoriesDrillSession).toEqual({sessionId: 'S1', title: 'T'});

        CockpitSourceReads.clearSessionMemoriesDrill(owner);
        release();
        await pending;

        // the read landed after close: owner state stays cleared, nothing repopulates
        expect(owner.memoriesDrillSession).toBe(null);
        expect(owner.memoriesDrillSnapshot).toBe(null)
    });

    test('the wire payload strips display-only title on the drill read', async () => {
        const owner = makeOwner();
        let seenWire;

        await withBridge(
            {fleetSessionMemories: async wire => { seenWire = wire; return {capability: {state: 'wired'}} }},
            () => readFencedSource(owner, SOURCE_READS.sessionMemories, {sessionId: 'S1', title: 'display only', offset: 5})
        );

        expect(seenWire).toEqual({sessionId: 'S1', offset: 5})
    });
});
