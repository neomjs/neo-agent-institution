import {test, expect}  from '@playwright/test';
import fs              from 'node:fs';
import path            from 'node:path';
import {fileURLToPath} from 'node:url';

const
    root    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    e2eRoot = path.join(root, 'test/playwright/e2e'),
    specsIn = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
        const file = path.join(dir, entry.name);

        return entry.isDirectory() ? specsIn(file) : entry.name.endsWith('.spec.mjs') ? [file] : []
    }),
    namesNeuralLink = file => /\bneuralLink\b/.test(fs.readFileSync(file, 'utf8'));

/**
 * @summary Which run owns an e2e spec is decided by ONE rule — the spec names `neuralLink` or it
 * does not. A second rule beside it (a file-name pattern in the battery's script) once left two
 * specs to no run at all, and both rotted unseen.
 */
test.describe('e2e selection — one rule decides which run owns a spec', () => {
    test('the Neural Link battery runs every spec that names neuralLink, and only those', async () => {
        const bound = process.env.NEO_AGENTOS_RUNTIME_ROOT;

        let config;

        // the battery refuses to load unbound; the arm reads its selection, it runs nothing
        process.env.NEO_AGENTOS_RUNTIME_ROOT = bound || root;

        try {
            ({default: config} = await import('../../playwright.config.e2e.nl.mjs'))
        } finally {
            bound === undefined ? delete process.env.NEO_AGENTOS_RUNTIME_ROOT : process.env.NEO_AGENTOS_RUNTIME_ROOT = bound
        }

        const specs    = specsIn(e2eRoot),
              selected = specs.filter(file => config.testMatch.some(pattern => pattern.test(file)));

        expect(specs.filter(namesNeuralLink).length, 'the fixture has users').toBeGreaterThan(0);
        expect(selected).toEqual(specs.filter(namesNeuralLink))
    });

    test('the battery\'s script hands the selection to its config: no file filter of its own', () => {
        const {scripts} = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

        expect(scripts['test-e2e:nl']).toBe('playwright test -c test/playwright/playwright.config.e2e.nl.mjs')
    })
});
