import {defineConfig}        from '@playwright/test';
import fs                    from 'node:fs';
import path                  from 'node:path';
import {fileURLToPath}       from 'node:url';
import {resolveFreePortSync} from '../../node_modules/neo.mjs/test/playwright/resolveFreePort.mjs';

const
    filename = fileURLToPath(import.meta.url),
    dirname  = path.dirname(filename),
    port     = resolveFreePortSync(process.env.NEO_E2E_PORT);

process.env.NEO_E2E_PORT = String(port);

/**
 * @summary Finds specs whose source matches a capability marker.
 * @param {String} root
 * @param {RegExp} pattern
 * @returns {RegExp[]}
 * @private
 */
function discoverSpecs(root, pattern) {
    const files = [];

    for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
        const file = path.join(root, entry.name);

        if (entry.isDirectory()) {
            files.push(...discoverSpecs(file, pattern))
        } else if (entry.name.endsWith('.spec.mjs') && pattern.test(fs.readFileSync(file, 'utf8'))) {
            const relative = path.relative(path.join(dirname, 'e2e'), file)
                .split(path.sep)
                .map(part => part.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'))
                .join('[\\\\/]');

            files.push(new RegExp(`[\\\\/]${relative}$`))
        }
    }

    return files
}

/**
 * @summary Finds specs that explicitly request the separately installed Brain whitebox fixture.
 * @param {String} root
 * @returns {RegExp[]}
 */
export function discoverExternalBrainSpecs(root) {
    return discoverSpecs(root, /\bneuralLink\b/)
}

/**
 * @summary Finds platform-golden specs; CI has no cross-platform baseline authority.
 * @param {String} root
 * @returns {RegExp[]}
 */
export function discoverPlatformVisualSpecs(root) {
    return discoverSpecs(root, /\btoHaveScreenshot\b/)
}

const
    e2eRoot                  = path.join(dirname, 'e2e'),
    hasAgentOsRuntimeBinding = path.isAbsolute(process.env.NEO_AGENTOS_RUNTIME_ROOT || ''),
    skipPlatformVisual       = Boolean(process.env.CI || process.env.NEO_E2E_SKIP_PLATFORM_VISUAL === '1'),
    testIgnore               = [
        ...(hasAgentOsRuntimeBinding ? [] : discoverExternalBrainSpecs(e2eRoot)),
        ...(skipPlatformVisual ? discoverPlatformVisualSpecs(e2eRoot) : [])
    ];

export default defineConfig({
    testDir      : path.join(dirname, 'e2e'),
    testIgnore,
    outputDir    : path.join(dirname, 'test-results/e2e/artifacts'),
    fullyParallel: false,
    workers      : 1,
    timeout      : 120000,

    reporter: [
        ['list'],
        ['html', {outputFolder: path.join(dirname, 'test-results/e2e/html-report'), open: 'never'}],
        ['json', {outputFile: path.join(dirname, 'test-results/e2e/results.json')}]
    ],

    use: {
        baseURL: `http://localhost:${port}`,
        trace  : 'on'
    },

    webServer: {
        command            : `npm run build-themes -- -n -t all -e dev && npm run server-start-ci -- --port ${port}`,
        url                : `http://localhost:${port}/apps/agentos/`,
        reuseExistingServer: false,
        timeout            : 120000
    },

    projects: [{
        name: 'chromium',
        use : {
            channel      : process.env.CI ? 'chromium' : 'chrome',
            launchOptions: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-dev-shm-usage'
                ]
            }
        }
    }]
});
