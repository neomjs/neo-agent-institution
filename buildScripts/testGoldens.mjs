import {spawnSync}            from 'node:child_process';
import fs                     from 'node:fs';
import path                   from 'node:path';
import {fileURLToPath}        from 'node:url';
import {resolveFreePortSync}  from '../node_modules/neo.mjs/test/playwright/resolveFreePort.mjs';
import {discoverCaptureSpecs} from './checkVisualBaselines.mjs';

/**
 * @summary Runs every screenshot-asserting Playwright spec across the Institution's browser tiers.
 *
 * Screenshot goldens span three Playwright configs (`playwright.config.visual.mjs`,
 * `playwright.config.e2e.mjs`, and `playwright.config.e2e.nl.mjs`) — and if a future component spec
 * asserts a screenshot, `playwright.config.component.mjs` joins without editing a list. Because five of
 * the capture specs exercise the cross-repository Neural Link whitebox fixture, `test-goldens` requires
 * `NEO_AGENTOS_RUNTIME_ROOT` up front and refuses immediately when no Brain checkout is bound rather
 * than silently skipping or failing halfway through the battery.
 *
 * For the Neural Link bucket, `NEO_NL_PORT` is always assigned a fresh OS-probed free port so an
 * ambient `NEO_NL_PORT=8081` inherited from a Fleet-managed seat shell (or another live Bridge) never
 * rejects the test runner's unauthenticated socket or cross-serves a foreign checkout.
 *
 * Verify:  NEO_AGENTOS_RUNTIME_ROOT=/absolute/path/to/neo-agent-brain npm run test-goldens
 * Refresh: NEO_AGENTOS_RUNTIME_ROOT=/absolute/path/to/neo-agent-brain npm run test-goldens -- --update-snapshots
 */

const
    cwd                = process.cwd(),
    brainSentinelPath  = path.join('ai', 'services', 'neural-link', 'ConnectionService.mjs');

/**
 * @summary Validates that `env` binds `NEO_AGENTOS_RUNTIME_ROOT` to an existing `neo-agent-brain` checkout.
 * @param {Object} [env=process.env]
 * @returns {{ok: Boolean, runtimeRoot?: String, message?: String}}
 */
export function validateGoldenRuntimeEnv(env = process.env) {
    const runtimeRoot = env?.NEO_AGENTOS_RUNTIME_ROOT;

    if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) {
        return {
            ok     : false,
            message:
                'test-goldens: NEO_AGENTOS_RUNTIME_ROOT is required and must be an absolute path to a ' +
                'neo-agent-brain checkout.\n' +
                '  NEO_AGENTOS_RUNTIME_ROOT=/absolute/path/to/neo-agent-brain npm run test-goldens'
        }
    }

    if (!fs.existsSync(path.join(runtimeRoot, brainSentinelPath))) {
        return {
            ok     : false,
            message:
                `test-goldens: NEO_AGENTOS_RUNTIME_ROOT ('${runtimeRoot}') does not point to a neo-agent-brain ` +
                `checkout (missing ${brainSentinelPath}).`
        }
    }

    return {ok: true, runtimeRoot}
}

/**
 * @summary Plans the ordered Playwright runs covering every discovered capture spec under `repoRoot`,
 * partitioned by owning Playwright config so no non-capture spec runs and no Neural Link spec runs twice.
 * @param {String}   [repoRoot=cwd] Repository root containing `test/playwright`.
 * @param {String[]} [extraArgs=[]] Extra CLI flags forwarded to Playwright (e.g. `['--update-snapshots']`).
 * @returns {Array<{label: String, config: String, specs: String[], args: String[], needsNlPort: Boolean}>}
 */
export function planGoldenRuns(repoRoot = cwd, extraArgs = []) {
    const
        discovered = discoverCaptureSpecs(repoRoot),
        buckets    = [
            {
                label      : 'visual',
                config     : 'test/playwright/playwright.config.visual.mjs',
                specs      : discovered.filter(entry => entry.spec.startsWith('test/playwright/visual/')).map(entry => entry.spec),
                needsNlPort: false
            },
            {
                label      : 'component',
                config     : 'test/playwright/playwright.config.component.mjs',
                specs      : discovered.filter(entry => entry.spec.startsWith('test/playwright/component/')).map(entry => entry.spec),
                needsNlPort: false
            },
            {
                label      : 'e2e',
                config     : 'test/playwright/playwright.config.e2e.mjs',
                specs      : discovered.filter(entry => entry.spec.startsWith('test/playwright/e2e/') && !entry.usesNeuralLink).map(entry => entry.spec),
                needsNlPort: false
            },
            {
                label      : 'e2e:nl',
                config     : 'test/playwright/playwright.config.e2e.nl.mjs',
                specs      : discovered.filter(entry => entry.spec.startsWith('test/playwright/e2e/') && entry.usesNeuralLink).map(entry => entry.spec),
                needsNlPort: true
            }
        ];

    return buckets
        .filter(bucket => bucket.specs.length > 0)
        .map(bucket => ({
            ...bucket,
            args: ['test', '-c', bucket.config, ...bucket.specs, ...extraArgs]
        }))
}

const isEntryScript = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntryScript) {
    const validation = validateGoldenRuntimeEnv(process.env);

    if (!validation.ok) {
        console.error(validation.message);
        process.exit(1)
    }

    const
        runs          = planGoldenRuns(cwd, process.argv.slice(2)),
        playwrightBin = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright'),
        failedBuckets = [];

    for (const run of runs) {
        const
            nlPort = run.needsNlPort ? String(resolveFreePortSync()) : null,
            runEnv = {...process.env, ...(nlPort ? {NEO_NL_PORT: nlPort} : {})};

        delete runEnv.CI;
        delete runEnv.NEO_E2E_PORT;
        delete runEnv.NEO_E2E_SKIP_PLATFORM_VISUAL;

        console.log(`\ntest-goldens [${run.label}]: ${run.specs.length} spec(s) via ${run.config}`);

        const result = spawnSync(playwrightBin, run.args, {
            cwd,
            env  : runEnv,
            stdio: 'inherit'
        });

        if (result.status !== 0) {
            failedBuckets.push(run.label)
        }
    }

    if (failedBuckets.length > 0) {
        console.error(`\ntest-goldens: failed in [${failedBuckets.join(', ')}].`);
        process.exit(1)
    }

    console.log(`\ntest-goldens: all ${runs.reduce((sum, run) => sum + run.specs.length, 0)} capture spec(s) passed.`)
}
