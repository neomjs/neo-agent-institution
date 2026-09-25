import {EventEmitter}  from 'node:events';
import {expect, test}  from '@playwright/test';
import path            from 'node:path';
import {
    THEME_BUILD_ARGS,
    buildThemes
} from '../../../../harness/prepareAssets.mjs';
import {ENGINE_THEME_BUILD, themeBuildArgv} from '../../../../harness/pack.mjs';

/**
 * A stub child for the injected spawn seam: the caller settles on `exit`, so the fake only needs
 * the event surface and a way to end with a chosen code.
 */
function fakeChild() {
    const child = new EventEmitter();

    child.exit = code => child.emit('exit', code);

    return child
}

/**
 * @summary The harness builds the dev themes the way a WORKSPACE must: one `-t all` run over the
 * product's own SCSS, never per theme (a single-theme run regenerates the theme map with only that
 * theme for workspace classes) and never `-f` (`--framework`, which parses the engine's SCSS only and
 * leaves the map without one `apps.agentos` row).
 */
test.describe('harness theme builds — one workspace-shaped run, shared by prepareAssets and pack', () => {
    test('the shared argv is a single dev build of every theme, without the framework switch', () => {
        expect(THEME_BUILD_ARGS).toEqual(['-n', '-e', 'dev', '-t', 'all']);
        expect(THEME_BUILD_ARGS).not.toContain('-f');
    });

    test('buildThemes spawns the product build-themes script ONCE with the shared argv and settles on its exit code', async () => {
        const calls = [];
        let child;

        const spawnFn = (command, args, options) => {
            calls.push({args, command, options});
            child = fakeChild();
            return child
        };

        const pending = buildThemes({spawnFn});

        expect(calls.length).toBe(1);
        expect(calls[0].command).toMatch(/^npm(\.cmd)?$/);
        expect(calls[0].args).toEqual(['run', 'build-themes', '--', ...THEME_BUILD_ARGS]);
        expect(calls[0].options.cwd).toBe(path.resolve(new URL('../../../../', import.meta.url).pathname));

        child.exit(0);
        await expect(pending).resolves.toBeUndefined();

        const failing = buildThemes({spawnFn});

        child.exit(3);
        await expect(failing).rejects.toThrow(/exit code 3/);
        expect(calls.length).toBe(2);
    });

    test('pack stages the organism with the same argv against the pinned Engine builder', () => {
        const argv = themeBuildArgv('/pinned/neo.mjs');

        expect(argv[0]).toBe(path.join('/pinned/neo.mjs', ENGINE_THEME_BUILD));
        expect(argv.slice(1)).toEqual(THEME_BUILD_ARGS);
    });
});
