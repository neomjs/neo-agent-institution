import {setup} from '../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'SeatModelTest'}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import SeatModel      from '../../../../../../apps/agentos/util/SeatModel.mjs';

test.describe('AgentOS.util.SeatModel — the Seat group\'s words for a seat\'s model and effort', () => {
    const row = facts => SeatModel.row({field: 'model', harnessType: 'codex-desktop', declared: null, configured: null, ...facts});

    test('a harness Fleet cannot declare for says why it has no action, and what its seat reported once it did', () => {
        expect(row({harnessType: 'claude-desktop'})).toEqual({actions: [], text: 'set per session in the app · not read back yet'});
        expect(row({harnessType: 'claude-desktop', observed: 'claude-opus-5-5'})).toEqual({actions: [], text: 'claude-opus-5-5 · set per session in the app'});
    });

    test('nothing declared reads the configured value as derived, or the harness default before a read', () => {
        expect(row({configured: {model: 'gpt-6-astra', reasoningEffort: null}})).toEqual({actions: ['change'], text: 'derived · reads gpt-6-astra (configured on disk)'});
        expect(row({})).toEqual({actions: ['change'], text: 'derived from the harness default'});
        expect(row({configured: {model: null, reasoningEffort: 'ultra'}}).text, 'a config without the key').toBe('derived from the harness default');
    });

    test('a declaration shows alone where the config agrees or was not read, and beside a different value otherwise', () => {
        expect(row({declared: 'gpt-6-sol', configured: {model: 'gpt-6-sol'}})).toEqual({actions: ['change'], text: 'declared gpt-6-sol'});
        expect(row({declared: 'gpt-6-sol'})).toEqual({actions: ['change'], text: 'declared gpt-6-sol'});
        // running or stopped alike: the harness reads its config when it launches
        expect(row({declared: 'gpt-6-sol', configured: {model: 'gpt-6-astra'}})).toEqual({
            actions: ['change', 'adopt'],
            text   : 'declared gpt-6-sol · reads gpt-6-astra (configured on disk) · applies at next start'
        });
    });

    test('a start refused for the declaration says so in the Fleet\'s words, never what the next start applies', () => {
        expect(row({declared: 'gpt-6-astra', configured: {model: 'gpt-6-luna'}, refused: 'model gpt-6-astra is not available'})).toEqual({
            actions: ['change'],
            text   : 'declared gpt-6-astra · start refused: model gpt-6-astra is not available'
        });
        expect(row({refused: 'model gpt-6-astra is not available'}).text, 'nothing declared, nothing refused').toBe('derived from the harness default');
    });

    test('the effort row reads its own key', () => {
        expect(SeatModel.row({field: 'reasoningEffort', harnessType: 'codex', declared: 'max', configured: {model: 'gpt-6-sol', reasoningEffort: 'ultra'}}).text)
            .toBe('declared max · reads ultra (configured on disk) · applies at next start');
    });

    test('the card speaks only for a refused start: the reason on its line, where to change it in the title', () => {
        expect(SeatModel.refusal({state: 'refused', reason: 'model gpt-x is not available'})).toEqual({
            text : 'start refused: model gpt-x is not available',
            title: 'start refused: model gpt-x is not available — change it in Detail › Configuration'
        });
        expect(SeatModel.refusal({state: 'complete'})).toBeNull();
        expect(SeatModel.refusal({state: 'partial', reason: 'rate limited'}), 'a read that could not say refused nothing').toBeNull();
        expect(SeatModel.refusal(null)).toBeNull();
    });

    test('a refusal speaks for the declaration it was given, never for one changed since', () => {
        const refused = {state: 'refused', model: 'gpt-6-astra', reasoningEffort: null, reason: 'model gpt-6-astra is not available'};

        expect(SeatModel.refusedReason(refused, {model: 'gpt-6-astra', reasoningEffort: null})).toBe('model gpt-6-astra is not available');
        expect(SeatModel.refusedReason(refused, {model: 'gpt-6-sol', reasoningEffort: null}), 'the model changed').toBeNull();
        expect(SeatModel.refusedReason(refused, {model: 'gpt-6-astra', reasoningEffort: 'max'}), 'an effort added').toBeNull();
        expect(SeatModel.refusedReason({...refused, state: 'complete'}, {model: 'gpt-6-astra'})).toBeNull();
        expect(SeatModel.refusedReason(null, null)).toBeNull();
    });

    test('declarability is the shared harness catalog\'s, never a list of the cockpit\'s own', () => {
        expect(['codex', 'codex-desktop', 'claude-code', 'claude-desktop', 'opencode', 'unknown'].map(SeatModel.declarable))
            .toEqual([true, true, true, false, false, false]);
    });
});
