import {access}                       from 'node:fs/promises';
import {spawn}                        from 'node:child_process';
import fs                             from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path                           from 'node:path';

import {newestMtime} from '../node_modules/neo.mjs/buildScripts/util/developmentThemeAssets.mjs';

const
    harnessDir = path.dirname(fileURLToPath(import.meta.url)),
    repoRoot   = path.resolve(harnessDir, '..'),
    assets     = {
        dark       : 'dist/development/css/theme-neo-dark/Global.css',
        fontAwesome: 'node_modules/@fortawesome/fontawesome-free/css/all.min.css',
        light      : 'dist/development/css/theme-neo-light/Global.css',
        logo       : 'resources/images/logo/neo_logo_primary.svg',
        map        : 'resources/theme-map.json',
        source     : 'dist/development/css/src/Global.css'
    };

/**
 * @summary Returns whether a generated harness asset exists in the repo checkout.
 * @param {String} relativePath
 * @returns {Promise<Boolean>}
 */
async function assetExists(relativePath) {
    try {
        await access(path.join(repoRoot, relativePath));
        return true
    } catch {
        return false
    }
}

/**
 * @summary The one theme-build argv a WORKSPACE may run, shared with the pack stage: every theme in
 * one dev build. The engine builder regenerates `resources/theme-map.json` on each run from the
 * engine's own map plus the themes it was asked for, so a single-theme run leaves the product's
 * classes with rows for that theme only — and `-f` (`--framework`) parses the engine's SCSS alone,
 * leaving the map without one `apps.agentos` row. The App worker inserts CSS only for classes the
 * map names: either shape renders the cockpit in the engine's default looks.
 * @type {String[]}
 */
export const THEME_BUILD_ARGS = Object.freeze(['-n', '-e', 'dev', '-t', 'all']);

/**
 * @summary Runs the product's `build-themes` script once, for every development theme.
 * @param {Object} [options]
 * @param {Function} [options.spawnFn=spawn] Injection seam for tests.
 * @returns {Promise<void>}
 */
export function buildThemes({spawnFn = spawn} = {}) {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    return new Promise((resolve, reject) => {
        const child = spawnFn(npmCommand, ['run', 'build-themes', '--', ...THEME_BUILD_ARGS], {cwd: repoRoot, stdio: 'inherit'});

        child.on('error', reject);
        child.on('exit', code => {
            code === 0 ? resolve() : reject(new Error(`Theme build failed with exit code ${code}`))
        })
    })
}

/**
 * @summary True when any SCSS source is newer than the built theme css — the exact failure the
 * harness cannot see otherwise: a merged theming change leaves EXISTING but WRONG css on disk,
 * and the window renders fully broken while every existence probe stays green.
 * @returns {Boolean}
 */
function themesAreStale() {
    const newestScss = newestMtime(path.join(repoRoot, 'resources', 'scss'), '.scss');

    return [assets.dark, assets.light, assets.source].some(asset => {
        try {
            return fs.statSync(path.join(repoRoot, asset)).mtimeMs < newestScss
        } catch {
            return true
        }
    })
}

/**
 * @summary Materializes the generated assets the source-mode Agent OS boot requires — and
 * REBUILDS the themes when any SCSS source is newer than the built css (staleness, not just
 * existence: the fully-broken-visuals class ships through existence-only checks).
 * @param {Object} [options]
 * @param {Function} [options.spawnFn=spawn] Injection seam for tests.
 * @returns {Promise<void>}
 */
export async function prepareAssets({spawnFn = spawn} = {}) {
    const state = Object.fromEntries(
        await Promise.all(Object.entries(assets).map(async ([key, value]) => [key, await assetExists(value)]))
    );

    if (Object.values(state).every(Boolean) && !themesAreStale()) {
        return
    }

    if (Object.values(state).every(Boolean)) {
        console.log('[harness] built themes are older than the SCSS sources — rebuilding');
        await buildThemes({spawnFn});
        return
    }

    if (!state.fontAwesome) {
        throw new Error('Harness source mode requires the repo-root dependencies; run npm install from the repo root')
    }

    await buildThemes({spawnFn});

    const missing = (await Promise.all(
        Object.values(assets).map(async asset => [asset, await assetExists(asset)])
    )).filter(([, exists]) => !exists).map(([asset]) => asset);

    if (missing.length > 0) {
        throw new Error(`Harness asset preparation incomplete: ${missing.join(', ')}`)
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await prepareAssets()
}
