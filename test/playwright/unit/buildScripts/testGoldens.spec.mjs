import {test, expect}                          from '@playwright/test';
import {spawnSync}                             from 'node:child_process';
import fs                                      from 'node:fs';
import os                                      from 'node:os';
import path                                    from 'node:path';
import {launchGoldenRun, planGoldenRuns, resolvePlaywrightCli, validateGoldenRuntimeEnv} from '../../../../buildScripts/testGoldens.mjs';

/**
 * Contract witness for `npm run test-goldens` (`buildScripts/testGoldens.mjs`):
 * 1. Without an absolute `NEO_AGENTOS_RUNTIME_ROOT` pointing to a Brain checkout, the command
 *    refuses and names `NEO_AGENTOS_RUNTIME_ROOT` (both in the pure validator and at CLI entry).
 * 2. Every screenshot-asserting spec across the repository's browser tiers is scheduled under its
 *    owning Playwright config (`visual`, `e2e`, `e2e.nl`), with zero non-screenshot specs and zero
 *    duplicate runs of Neural Link capture specs.
 * 3. A run launches the CLI of the `@playwright/test` package that loads the specs, even when another
 *    Playwright owns `node_modules/.bin/playwright`.
 */
test.describe('testGoldens — the single capture-battery runner (#911)', () => {
    test('refuses and names NEO_AGENTOS_RUNTIME_ROOT when unset, relative, or not a Brain checkout', () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-brain-'));

        try {
            for (const env of [
                {},
                {NEO_AGENTOS_RUNTIME_ROOT: ''},
                {NEO_AGENTOS_RUNTIME_ROOT: '../neo-agent-brain'},
                {NEO_AGENTOS_RUNTIME_ROOT: emptyDir}
            ]) {
                const verdict = validateGoldenRuntimeEnv(env);

                expect(verdict.ok).toBe(false);
                expect(verdict.message).toContain('NEO_AGENTOS_RUNTIME_ROOT')
            }

            // Synthetic Brain checkout sentinel satisfies validation
            const sentinel = path.join(emptyDir, 'ai', 'services', 'neural-link', 'ConnectionService.mjs');
            fs.mkdirSync(path.dirname(sentinel), {recursive: true});
            fs.writeFileSync(sentinel, 'export default {};\n');

            expect(validateGoldenRuntimeEnv({NEO_AGENTOS_RUNTIME_ROOT: emptyDir})).toEqual({
                ok         : true,
                runtimeRoot: emptyDir
            })
        } finally {
            fs.rmSync(emptyDir, {force: true, recursive: true})
        }
    });

    test('CLI entry exits 1 and names NEO_AGENTOS_RUNTIME_ROOT before launching Playwright when unbound', () => {
        const
            env    = {...process.env},
            script = path.join(process.cwd(), 'buildScripts', 'testGoldens.mjs');

        delete env.NEO_AGENTOS_RUNTIME_ROOT;

        const result = spawnSync(process.execPath, [script], {
            cwd     : process.cwd(),
            encoding: 'utf8',
            env
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('NEO_AGENTOS_RUNTIME_ROOT')
    });

    test('plans all eight live capture specs across visual, e2e, and e2e:nl with no duplicates and forwards flags', () => {
        const
            runs     = planGoldenRuns(process.cwd(), ['--update-snapshots']),
            allSpecs = runs.flatMap(run => run.specs);

        expect(runs.map(({label, config, specs, needsNlPort}) => ({label, config, specs, needsNlPort}))).toEqual([
            {
                label      : 'visual',
                config     : 'test/playwright/playwright.config.visual.mjs',
                specs      : [
                    'test/playwright/visual/FleetCockpitVisual.spec.mjs',
                    'test/playwright/visual/SystemViewVisual.spec.mjs'
                ],
                needsNlPort: false
            },
            {
                label      : 'e2e',
                config     : 'test/playwright/playwright.config.e2e.mjs',
                specs      : [
                    'test/playwright/e2e/agentos/FleetCockpitBarCompositionNL.spec.mjs'
                ],
                needsNlPort: false
            },
            {
                label      : 'e2e:nl',
                config     : 'test/playwright/playwright.config.e2e.nl.mjs',
                specs      : [
                    'test/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs',
                    'test/playwright/e2e/agentos/FleetCockpitDrillRoundTripNL.spec.mjs',
                    'test/playwright/e2e/agentos/FleetGoldenPathNL.spec.mjs',
                    'test/playwright/e2e/agentos/FleetMemoriesNL.spec.mjs',
                    'test/playwright/e2e/agentos/FleetNavFamilyPin.spec.mjs'
                ],
                needsNlPort: true
            }
        ]);

        expect(new Set(allSpecs).size, 'every capture spec runs once').toBe(allSpecs.length);
        for (const run of runs) {
            expect(run.args.at(-1)).toBe('--update-snapshots')
        }
    });

    test('launches the test package\'s own CLI when a root playwright of another version owns the shared binary', () => {
        const
            root  = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'goldens-cli-'))),
            write = (file, text) => {
                fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
                fs.writeFileSync(path.join(root, file), text)
            };

        try {
            write('package.json', '{"name": "fixture"}');
            write('node_modules/@playwright/test/package.json',
                '{"name": "@playwright/test", "version": "2.0.0", "exports": {"./cli": "./cli.js"}, "bin": {"playwright": "cli.js"}}');
            write('node_modules/@playwright/test/cli.js', 'console.log("test-package-cli " + process.argv.slice(2).join(" "));\n');
            // The mismatched layout: a transitive playwright of another version, linked as the shared binary.
            write('node_modules/playwright/package.json', '{"name": "playwright", "version": "1.0.0", "bin": {"playwright": "cli.js"}}');
            write('node_modules/playwright/cli.js', 'console.log("root-binary-cli");\nprocess.exit(3);\n');
            fs.mkdirSync(path.join(root, 'node_modules', '.bin'), {recursive: true});
            fs.symlinkSync(path.join('..', 'playwright', 'cli.js'), path.join(root, 'node_modules', '.bin', 'playwright'));

            expect(resolvePlaywrightCli(root)).toBe(path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'));

            const result = launchGoldenRun({args: ['test', '-c', 'some.config.mjs', 'a.spec.mjs']}, {repoRoot: root, stdio: 'pipe'});

            expect(result.status).toBe(0);
            expect(result.stdout.toString()).toContain('test-package-cli test -c some.config.mjs a.spec.mjs');
            expect(result.stdout.toString()).not.toContain('root-binary-cli')
        } finally {
            fs.rmSync(root, {force: true, recursive: true})
        }
    })
});
