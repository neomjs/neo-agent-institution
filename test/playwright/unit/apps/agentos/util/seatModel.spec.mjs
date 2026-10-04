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

    test('a harness Fleet cannot declare for shows what its seat reported, or that nothing has, with no action', () => {
        expect(row({harnessType: 'claude-desktop'})).toEqual({actions: [], text: 'not read back yet'});
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
        expect(row({declared: 'gpt-6-sol', configured: {model: 'gpt-6-astra'}})).toEqual({
            actions: ['change'],
            text   : 'declared gpt-6-sol · reads gpt-6-astra (configured on disk) · applies at next start'
        });
        expect(row({declared: 'gpt-6-sol', configured: {model: 'gpt-6-astra'}, running: true}), 'drift on a running seat').toEqual({
            actions: ['reapply', 'adopt'],
            text   : 'declared gpt-6-sol · now reads gpt-6-astra (configured on disk)'
        });
    });

    test('the effort row reads its own key', () => {
        expect(SeatModel.row({field: 'reasoningEffort', harnessType: 'codex', declared: 'max', configured: {model: 'gpt-6-sol', reasoningEffort: 'ultra'}}).text)
            .toBe('declared max · reads ultra (configured on disk) · applies at next start');
    });

    test('the card speaks only for a refused start, in the design read\'s words', () => {
        expect(SeatModel.refusal({state: 'refused', reason: 'model gpt-x is not available'})).toBe('start refused: model gpt-x is not available — change it in Detail › Configuration');
        expect(SeatModel.refusal({state: 'complete'})).toBeNull();
        expect(SeatModel.refusal({state: 'partial', reason: 'rate limited'}), 'a read that could not say refused nothing').toBeNull();
        expect(SeatModel.refusal(null)).toBeNull();
    });

    test('declarability is the shared harness catalog\'s, never a list of the cockpit\'s own', () => {
        expect(['codex', 'codex-desktop', 'claude-code', 'claude-desktop', 'opencode', 'unknown'].map(SeatModel.declarable))
            .toEqual([true, true, true, false, false, false]);
    });
});
