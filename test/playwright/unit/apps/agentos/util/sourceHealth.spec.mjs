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
