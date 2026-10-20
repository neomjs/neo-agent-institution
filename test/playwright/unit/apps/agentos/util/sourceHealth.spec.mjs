import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'SourceHealthTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import SourceHealth from '../../../../../../apps/agentos/util/SourceHealth.mjs';

import {SEAT_LIFECYCLE_READ_ONLY_STATES, SEAT_LIFECYCLE_ROW_FALLBACK, SEAT_LIFECYCLE_STATES} from 'neo-agent-brain/fleet-contract';

/**
 * @summary The display-state resolver the card, the detail pane, the health tally and the roster's
 * offline filter share: five states, and why an offline seat is offline as its reason.
 */
test.describe('AgentOS.util.SourceHealth.resolveFleetDisplayState', () => {
    const
        resolve  = row => SourceHealth.resolveFleetDisplayState(row),
        runtime  = state => ({runtime: {source: 'fleet:runtimeStatus', state, confidence: state === 'wired' ? 'observed' : 'none'}}),
        wired    = runtime('wired'),
        unwired  = [undefined, null, {}, runtime('not-wired'), runtime('missing'), {runtime: 'malformed'}];

    test('the bench is the roster\'s fact: a benched seat is offline, benched in every topology', () => {
        for (const sources of [...unwired, wired]) {
            for (const state of ['ok', 'idle', 'wedged', 'limited', 'off', undefined]) {
                expect(resolve({participationStatus: 'operator_benched', sources, state}), JSON.stringify({sources, state}))
                    .toEqual({reason: 'benched', state: 'off'})
            }
        }
    });

    test('a seat Fleet runs no process for is offline, unobserved — whatever its row state claims', () => {
        for (const sources of unwired) {
            for (const state of ['ok', 'idle', 'wedged', 'limited', 'off', 'mysterious', undefined]) {
                expect(resolve({participationStatus: 'active', sources, state}), JSON.stringify({sources, state}))
                    .toEqual({reason: 'unobserved', state: 'off'})
            }
        }

        // no participation fact at all reads the same, and an unmanaged seat never reads benched
        expect(resolve({sources: {}, state: 'off'})).toEqual({reason: 'unobserved', state: 'off'});
        expect(resolve()).toEqual({reason: 'unobserved', state: 'off'})
    });

    test('a wired runtime keeps its session state; a stopped one is offline, stopped', () => {
        for (const state of ['ok', 'idle', 'wedged', 'limited']) {
            expect(resolve({sources: wired, state})).toEqual({reason: null, state})
        }

        expect(resolve({sources: wired, state: 'off'})).toEqual({reason: 'stopped', state: 'off'});
        expect(resolve({sources: wired}), 'a wired row without a state reads stopped').toEqual({reason: 'stopped', state: 'off'});
        // an unrecognized runtime state passes through, so the card can still name it
        expect(resolve({sources: wired, state: 'quarantined'})).toEqual({reason: null, state: 'quarantined'})
    })
});

test.describe('AgentOS.util.SourceHealth.normalizeFleetSources lane axis', () => {
    test('normalizes the Brain mailbox source, leaves absence not-wired, and rejects a different producer', () => {
        const
            lane = {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', reason: null},
            wired = SourceHealth.normalizeFleetSources({lane}),
            empty = SourceHealth.normalizeFleetSources({}),
            wrong = SourceHealth.normalizeFleetSources({lane: {...lane, source: 'fleet:activity-adapters'}});

        expect(SourceHealth.FLEET_SOURCE_KEYS).toContain('lane');
        expect(wired.lane).toEqual(lane);
        expect(empty.lane).toEqual({source: null, state: 'not-wired', confidence: 'none', reason: null});
        expect(wrong.lane).toEqual({
            source    : 'fleet:activity-adapters',
            state     : 'invalid',
            confidence: 'none',
            reason    : 'source fact failed producer validation'
        });
    });
});

test.describe('AgentOS.util.SourceHealth.mapFleetSessionHealth (#725)', () => {
    const
        wired        = {runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed', reason: null}},
        normalized   = SourceHealth.normalizeFleetSources(wired),
        failureReason = '1 helper(s) still alive: pid 4242';

    test('maps {state: "failed", cleanupUnresolved: true, failureReason} to off + the cleanup control reason (#725 AC-1)', () => {
        expect(SourceHealth.mapFleetSessionHealth({
            source           : 'fleet:runtimeStatus',
            state            : 'failed',
            confidence       : 'observed',
            cleanupUnresolved: true,
            failureReason
        }, wired)).toEqual({
            controlReason: {action: 'stop', kind: 'cleanup', reason: failureReason},
            sources      : normalized,
            state        : 'off'
        })
    });
});

/**
 * @summary Every word the Fleet writes maps onto the card's vocabulary with the control it obliges;
 * `unknown` and a word outside the contract stay rejected evidence.
 */
test.describe('AgentOS.util.SourceHealth.mapFleetSessionHealth reads every Fleet lifecycle word (#749)', () => {
    const
        wired      = {runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed', reason: null}},
        normalized = SourceHealth.normalizeFleetSources(wired),
        map        = (state, extra = {}) => SourceHealth.mapFleetSessionHealth({source: 'fleet:runtimeStatus', confidence: 'observed', state, ...extra}, wired),
        invalid    = words => words.filter(word => map(word).sources.runtime.state === 'invalid');

    test('stopping: still up, Stop stays as the pending control, Start reads already up', () => {
        expect(map('stopping')).toEqual({
            controlReason: {action: 'stop', kind: 'pending', reason: 'stopping'},
            sources      : normalized,
            state        : 'ok'
        })
    });

    test('a cleanup-free failed seat is off and startable, with the Fleet\'s failure reason or the contract\'s fallback', () => {
        expect(map('failed', {failureReason: 'spawn ENOENT'})).toEqual({
            controlReason: {action: 'start', kind: 'failed', reason: 'spawn ENOENT'},
            sources      : normalized,
            state        : 'off'
        });

        expect(map('failed').controlReason).toEqual({action: 'start', kind: 'failed', reason: 'a start or stop ended in an error'})
    });

    test('unavailable: off and startable, the reason names why this host cannot launch the harness', () => {
        expect(map('unavailable', {failureReason: 'bundled CLI missing'})).toEqual({
            controlReason: {action: 'start', kind: 'unavailable', reason: 'bundled CLI missing'},
            sources      : normalized,
            state        : 'off'
        });

        expect(map('unavailable').controlReason.reason).toBe('the harness cannot be launched on this host')
    });

    test('exited (read-only): off, and the card names the exit instead of relabelling it stopped', () => {
        expect(map('exited')).toEqual({
            controlReason: {action: 'start', kind: 'exited', reason: 'the harness exited on its own'},
            sources      : normalized,
            state        : 'off'
        })
    });

    test('unknown, a word outside the contract and a CARD word are rejected evidence — nothing passes through unmapped', () => {
        ['unknown', 'limbo', 'idle', 'wedged', 'limited'].forEach(word => {
            const health = map(word);

            expect(health.controlReason, word).toBeUndefined();
            expect(health.state, word).toBe('off');
            expect(health.sources.runtime, word).toEqual({source: 'fleet:runtimeStatus', state: 'invalid', confidence: 'none', reason: 'lifecycle and runtime facts contradict'})
        })
    });

    test('the contract arm: every word neo-agent-brain/fleet-contract exports maps, the row fallback does not, and a planted word turns the arm red (AC-3)', () => {
        expect(invalid([...SEAT_LIFECYCLE_STATES, ...SEAT_LIFECYCLE_READ_ONLY_STATES])).toEqual([]);
        expect(invalid([SEAT_LIFECYCLE_ROW_FALLBACK])).toEqual([SEAT_LIFECYCLE_ROW_FALLBACK]);
        expect(invalid([...SEAT_LIFECYCLE_STATES, 'planted'])).toEqual(['planted'])
    });
});

