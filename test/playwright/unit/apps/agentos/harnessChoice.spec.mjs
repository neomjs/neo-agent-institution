import {setup} from '../../../setup.mjs';

setup({
    appConfig: {
        name: 'AgentOSHarnessChoiceTest'
    }
});

import {test, expect}        from '@playwright/test';
import Neo                   from '../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core             from '../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import {listHarnessProducts} from '../../../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';
import HarnessChoice         from '../../../../../apps/agentos/util/HarnessChoice.mjs';

test.describe('AgentOS.util.HarnessChoice — a product first, then App or Command line (#245)', () => {
    test('products follow the catalog, and only a product shipping both modes offers a run-mode choice', () => {
        const products = HarnessChoice.products();

        // the Brain's catalog is the source: same products, same order
        expect(products.map(item => item.product)).toEqual(listHarnessProducts().map(item => item.product));

        const runsAs = Object.fromEntries(products.map(item => [item.product, item.runsAs.map(entry => `${entry.label}:${entry.type}`)]));

        expect(runsAs).toEqual({
            codex       : ['Command line:codex', 'App:codex-desktop'],
            claude      : ['Command line:claude-code', 'App:claude-desktop'],
            opencode    : [],
            'kimi-code' : [],
            antigravity : [],
            'native-neo': []
        });
        expect(products.map(item => item.defaultType)).toEqual(['codex', 'claude-code', 'opencode', 'kimi-code', 'antigravity', 'native-neo'])
    });

    test('a product pick keeps the run mode where the product has it, and an unknown product stores nothing', () => {
        expect(HarnessChoice.typeFor('codex', 'app')).toBe('codex-desktop');
        expect(HarnessChoice.typeFor('claude', 'cli')).toBe('claude-code');
        // a single-type product ignores the mode it does not have
        expect(HarnessChoice.typeFor('kimi-code', 'app')).toBe('kimi-code');
        expect(HarnessChoice.typeFor('codex')).toBe('codex');
        expect(HarnessChoice.typeFor('unknown', 'app')).toBeNull()
    });

    test('a stored type reads back as its choice, and an unknown type has none', () => {
        expect(HarnessChoice.choiceOf('claude-desktop')).toEqual({product: 'claude', runsAs: 'app'});
        expect(HarnessChoice.choiceOf('native-neo')).toEqual({product: 'native-neo', runsAs: null});
        expect(HarnessChoice.choiceOf('unknown')).toBeNull();

        expect(HarnessChoice.describe('claude-desktop')).toBe('Claude · App');
        expect(HarnessChoice.describe('codex')).toBe('Codex · Command line');
        expect(HarnessChoice.describe('kimi-code')).toBe('Kimi Code');
        expect(HarnessChoice.describe('unknown')).toBeNull()
    });
});
