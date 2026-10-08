import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetLifecycleIntentAdapterTest';

setup({
    neoConfig: {
        unitTestMode: true
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import FleetLifecycleIntentAdapter from '../../../../../../../../apps/agentos/util/FleetLifecycleIntentAdapter.mjs';

// a record double: bulk `set()` like a Neo.data record (the C2 write seam), fields readable as
// plain properties — mirrors AgentOS.model.FleetAgent's pendingAction/controlReason contract.
const createRecord = (data = {}) => ({
    pendingAction: null,
    controlReason: null,
    ...data,
    writes: [],

    set(values) {
        this.writes.push({...values});
        Object.assign(this, values)
    }
});

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject  = rejectPromise
    });

    return {promise, resolve, reject}
};

const createTimer = () => {
    const timers       = [],
          setTimeoutFn = (fn, ms) => {
              const timer = {fn, ms, cleared: false};

              timers.push(timer);

              return timer
          },
          clearTimeoutFn = timer => { timer.cleared = true };

    return {timers, setTimeoutFn, clearTimeoutFn}
};

const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve()
};

test.describe('fleetLifecycleIntentAdapter — lifecycleIntent → registry bridge → record state (#14889)', () => {
    test('maps start/stop/restart intents to existing bridge verbs with agentId-only payloads', async () => {
        const
            record = createRecord({controlReason: {action: 'stop', kind: 'rejected', reason: 'old failure'}}),
            calls  = [],
            bridge = {
                startAgent  : async id => { calls.push(['startAgent', id]); return {state: 'running'} },
                stopAgent   : async id => { calls.push(['stopAgent', id]); return {state: 'stopped'} },
                restartAgent: async id => { calls.push(['restartAgent', id]); return {state: 'running'} }
            };

        await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {bridge});
        await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'stop', agentId: 'vega'}, record, {bridge});
        await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'restart', agentId: 'vega'}, record, {bridge});

        expect(calls).toEqual([
            ['startAgent', 'vega'],
            ['stopAgent', 'vega'],
            ['restartAgent', 'vega']
        ]);
        // Secret boundary: bridge verbs receive the operation-specific id only, never an object carrying PATs.
        expect(calls.every(([, payload]) => typeof payload === 'string')).toBe(true);
        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toBeNull()
    });

    test('sets pendingAction and clears stale controlReason when an accepted intent enters pending', async () => {
        const
            record       = createRecord({controlReason: {action: 'start', kind: 'rejected', reason: 'old'}}),
            bridge       = {startAgent: () => Promise.resolve({state: 'running'})},
            settleResult = await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {bridge});

        expect(record.writes[0]).toEqual({controlReason: null, pendingAction: 'start'});
        expect(record.writes.at(-1)).toEqual({controlReason: null, pendingAction: null});
        expect(settleResult).toMatchObject({accepted: true, action: 'start', method: 'startAgent', ok: true, status: 'settled'})
    });

    test('bridge rejection clears pendingAction and writes a sanitized rejected reason', async () => {
        const
            record = createRecord(),
            bridge = {restartAgent: async () => { throw new Error('PAT: github_pat_secretvalue') }},
            result = await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'restart', agentId: 'vega'}, record, {bridge});

        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toEqual({
            action: 'restart',
            kind  : 'rejected',
            reason: '[redacted]'
        });
        expect(result).toMatchObject({accepted: true, ok: false, status: 'rejected'})
    });

    test('missing bridge fails closed as unauthorized without accepting a pending action', async () => {
        const
            record = createRecord(),
            result = await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'stop', agentId: 'vega'}, record, {bridge: null});

        expect(record.writes).toEqual([{
            pendingAction: null,
            controlReason: {action: 'stop', kind: 'unauthorized', reason: 'Fleet Registry bridge unavailable'}
        }]);
        expect(result).toMatchObject({accepted: false, ok: false, status: 'unauthorized'})
    });

    test('unsupported action rejects before calling the bridge', async () => {
        const
            record = createRecord(),
            bridge = {startAgent: async () => { throw new Error('must not call') }},
            result = await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'remove', agentId: 'vega'}, record, {bridge});

        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toEqual({
            action: 'remove',
            kind  : 'rejected',
            reason: "Unsupported lifecycle action 'remove'"
        });
        expect(result).toMatchObject({accepted: false, method: null, ok: false, status: 'rejected'})
    });

    test('timeout clears pendingAction and writes a timeout reason', async () => {
        const
            record  = createRecord(),
            bridge  = {startAgent: () => new Promise(() => {})},
            timer   = createTimer(),
            pending = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {
                bridge,
                ...timer,
                timeoutMs: 1
            });

        await flushMicrotasks();
        timer.timers[0].fn();

        const result = await pending;

        expect(timer.timers[0].ms).toBe(1);
        expect(timer.timers[0].cleared).toBe(true);
        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toEqual({
            action: 'start',
            kind  : 'timeout',
            reason: 'start timed out after 1ms'
        });
        expect(result).toMatchObject({accepted: true, ok: false, status: 'timeout'});
        expect(result.isCurrent()).toBe(true);
        expect(FleetLifecycleIntentAdapter.rosterMayRead(result)).toBe(false)
    });

    test('a timeout is an early answer; a late success settles the same current attempt and clears its reason', async () => {
        const
            record   = createRecord(),
            response = deferred(),
            timer    = createTimer(),
            pending  = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {
                bridge: {startAgent: () => response.promise},
                ...timer,
                timeoutMs: 1
            });

        await flushMicrotasks();
        timer.timers[0].fn();

        const timeoutResult = await pending;

        expect(timeoutResult.status).toBe('timeout');
        expect(record.controlReason).toEqual({action: 'start', kind: 'timeout', reason: 'start timed out after 1ms'});
        expect(record.writes).toHaveLength(2);

        response.resolve({state: 'running'});

        const settlement = await timeoutResult.settlement;

        expect(settlement).toMatchObject({accepted: true, ok: true, status: 'settled'});
        expect(settlement.isCurrent()).toBe(true);
        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toBeNull();
        expect(record.writes.at(-1)).toEqual({controlReason: null, pendingAction: null});
        expect(FleetLifecycleIntentAdapter.rosterMayRead(settlement)).toBe(true)
    });

    test('late domain refusals and thrown errors replace the current timeout with sanitized outcomes', async () => {
        for (const outcome of [
            {
                label   : 'domain refusal',
                finish  : response => response.resolve({status: 'rejected', reason: 'agent vega cannot start'}),
                expected: {kind: 'rejected', reason: 'agent vega cannot start'}
            }, {
                label   : 'thrown error',
                finish  : response => response.reject(new Error('PAT: github_pat_secretvalue')),
                expected: {kind: 'rejected', reason: '[redacted]'}
            }
        ]) {
            const
                record   = createRecord(),
                response = deferred(),
                timer    = createTimer(),
                pending  = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'restart', agentId: 'vega'}, record, {
                    bridge: {restartAgent: () => response.promise},
                    ...timer,
                    timeoutMs: 2
                });

            await flushMicrotasks();
            timer.timers[0].fn();

            const timeoutResult = await pending;

            expect(timeoutResult.status, outcome.label).toBe('timeout');
            outcome.finish(response);

            const settlement = await timeoutResult.settlement;

            expect(settlement, outcome.label).toMatchObject({accepted: true, ok: false, status: 'rejected'});
            expect(record.controlReason, outcome.label).toEqual({action: 'restart', ...outcome.expected});
            expect(record.pendingAction, outcome.label).toBeNull();
            expect(FleetLifecycleIntentAdapter.rosterMayRead(settlement), outcome.label).toBe(true)
        }
    });

    test('an older timeout and late reply cannot overwrite a newer pending or settled attempt', async () => {
        const
            record       = createRecord(),
            older        = deferred(),
            newer        = deferred(),
            timer        = createTimer(),
            olderPending = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {
                bridge: {startAgent: () => older.promise}, ...timer, timeoutMs: 3
            });

        await flushMicrotasks();

        const newerPending = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'stop', agentId: 'vega'}, record, {
            bridge: {stopAgent: () => newer.promise}, ...timer, timeoutMs: 4
        });

        await flushMicrotasks();

        const writesWhileNewerPending = record.writes.length;

        timer.timers[0].fn();

        const olderTimeout = await olderPending;

        expect(olderTimeout.status).toBe('superseded');
        expect(olderTimeout.isCurrent()).toBe(false);
        expect(record.writes).toHaveLength(writesWhileNewerPending);
        expect(record.pendingAction).toBe('stop');

        newer.resolve({state: 'stopped'});

        const newerResult = await newerPending;

        expect(newerResult).toMatchObject({accepted: true, ok: true, status: 'settled'});
        expect(newerResult.isCurrent()).toBe(true);
        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toBeNull();

        const writesAfterNewerSettled = record.writes.length;

        // An older wire can answer after the latest intent has already completed.
        older.resolve({state: 'running'});

        const olderSettlement = await olderTimeout.settlement;

        expect(olderSettlement.status).toBe('superseded');
        expect(record.writes).toHaveLength(writesAfterNewerSettled);
        expect(FleetLifecycleIntentAdapter.rosterMayRead(olderSettlement)).toBe(false);
        expect(FleetLifecycleIntentAdapter.rosterMayRead(newerResult)).toBe(true)
    });

    test('a newer local refusal invalidates an older bridge answer', async () => {
        const
            record   = createRecord(),
            response = deferred(),
            timer    = createTimer(),
            pending  = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {
                bridge: {startAgent: () => response.promise}, ...timer, timeoutMs: 5
            });

        await flushMicrotasks();

        const invalid = await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'teleport', agentId: 'vega'}, record, {bridge: {}}),
              writes  = record.writes.length;

        expect(invalid).toMatchObject({accepted: false, ok: false, status: 'rejected'});
        expect(invalid.isCurrent()).toBe(true);

        timer.timers[0].fn();

        const olderTimeout = await pending;

        expect(olderTimeout.status).toBe('superseded');
        response.resolve({state: 'running'});

        expect((await olderTimeout.settlement).status).toBe('superseded');
        expect(record.writes).toHaveLength(writes);
        expect(record.controlReason).toMatchObject({action: 'teleport', kind: 'rejected'});
        expect(FleetLifecycleIntentAdapter.rosterMayRead(invalid)).toBe(false)
    });

    test('a removed or rebound target fails the caller fence and receives no late write', async () => {
        const
            record     = createRecord(),
            response   = deferred(),
            timer      = createTimer(),
            targetLive = {value: true},
            pending    = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {
                bridge: {startAgent: () => response.promise},
                ...timer,
                timeoutMs: 6,
                isCurrent: () => targetLive.value
            });

        await flushMicrotasks();
        timer.timers[0].fn();

        const timeoutResult       = await pending,
              writesBeforeRemoval = record.writes.length;

        targetLive.value = false;
        response.resolve({state: 'running'});

        const settlement = await timeoutResult.settlement;

        expect(timeoutResult.isCurrent()).toBe(false);
        expect(settlement.status).toBe('superseded');
        expect(record.writes).toHaveLength(writesBeforeRemoval);
        expect(FleetLifecycleIntentAdapter.rosterMayRead(timeoutResult)).toBe(false);
        expect(FleetLifecycleIntentAdapter.rosterMayRead(settlement)).toBe(false)
    });

    test('completion at the injected timeout boundary writes one terminal outcome', async () => {
        const
            record  = createRecord(),
            timer   = createTimer(),
            pending = FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {
                bridge: {startAgent: async () => ({state: 'running'})},
                ...timer,
                timeoutMs: 7
            });

        // Queue the timeout as soon as the adapter installs it, at the same turn boundary as the
        // bridge's already-resolved answer. This exercises whichever microtask reaches the race first.
        queueMicrotask(() => timer.timers[0].fn());

        const result = await pending;

        if (result.status === 'timeout') {
            await result.settlement
        }

        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toBeNull();
        expect(record.writes).toHaveLength(2);
        expect(record.writes.at(-1)).toEqual({controlReason: null, pendingAction: null});
        expect(timer.timers[0].cleared).toBe(true)
    });

    test('immediate completion clears the timer and cannot be replaced by its queued callback', async () => {
        const
            record = createRecord(),
            timer  = createTimer(),
            result = await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {
                bridge: {startAgent: async () => ({state: 'running'})},
                ...timer,
                timeoutMs: 8
            });

        expect(result.status).toBe('settled');
        expect(timer.timers[0].cleared).toBe(true);

        // Simulate a callback already queued when clearTimeout ran.
        timer.timers[0].fn();
        await flushMicrotasks();

        expect(result.isCurrent()).toBe(true);
        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toBeNull();
        expect(record.writes).toHaveLength(2);
        expect(FleetLifecycleIntentAdapter.rosterMayRead(result)).toBe(true)
    });

    test('the record writer supports record-style set() and the plain field-bag fallback (dock snapshot)', () => {
        const record = createRecord();

        FleetLifecycleIntentAdapter.writeLifecycleControlState(record, {
            controlReason: FleetLifecycleIntentAdapter.createControlReason('start', 'rejected', 'no slot'),
            pendingAction: null
        });

        expect(record.controlReason).toEqual({action: 'start', kind: 'rejected', reason: 'no slot'});

        // a plain field bag (the dock-blueprint snapshot shape) is mutated in place
        const bag = {pendingAction: 'stop', controlReason: null};
        FleetLifecycleIntentAdapter.writeLifecycleControlState(bag, {pendingAction: null});
        expect(bag.pendingAction).toBeNull()
    });

    test('reason sanitization redacts token-shaped strings', () => {
        expect(FleetLifecycleIntentAdapter.sanitizeControlReason('token: ghp_abc123 should not render')).toBe('[redacted] should not render');
        expect(FleetLifecycleIntentAdapter.sanitizeControlReason('plain lifecycle failure')).toBe('plain lifecycle failure')
    });

    test('a refusal the Fleet answers as data ends rejected with its words, never settled (#443)', async () => {
        const
            reason = "agent 'vega' was released to its own harness.",
            record = createRecord(),
            bridge = {startAgent: async () => ({status: 'rejected', reason})},
            result = await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'vega'}, record, {bridge});

        expect(record.pendingAction).toBeNull();
        expect(record.controlReason).toEqual({action: 'start', kind: 'rejected', reason});
        expect(result).toMatchObject({accepted: true, ok: false, status: 'rejected'})
    });

    test('a memory import that did not converge refuses Start with its source and its step intact (#521 AC-4)', async () => {
        // the Brain's refusal (seatMemoryImport.mjs), after the bridge drops its caller prefix
        const
            reason = "agent 'mnemosyne' consented to import its memory from '/home/operator/.claude/projects/-work/memory', but the source holds no memory to copy. The memory-import step did not converge, so the seat does not start.",
            record = createRecord(),
            bridge = {startAgent: async () => ({status: 'rejected', reason})};

        await FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: 'mnemosyne'}, record, {bridge});

        expect(record.controlReason).toEqual({action: 'start', kind: 'rejected', reason})
    });

    test('a refusal\'s bare words survive the redaction, a labelled value does not (#443)', () => {
        const reason = "agent 'vega' has no GitHub PAT stored; store one before starting it.";

        expect(FleetLifecycleIntentAdapter.sanitizeControlReason(reason)).toBe(reason);
        expect(FleetLifecycleIntentAdapter.sanitizeControlReason('PAT=github_pat_x stored')).toBe('[redacted] stored')
    });
});
