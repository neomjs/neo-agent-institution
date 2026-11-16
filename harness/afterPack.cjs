// electron-builder afterPack hook (CJS — the hook is require()d): completes the organism payload.
// The builder's extraResources copier hard-ignores node_modules regardless of filter globs, but
// the STAGED install (rebuilt for the bundled Electron) IS the runtime payload — without it,
// children silently resolve a checkout's system-ABI native modules through the filesystem walk-up
// (measured: ABI 141 vs 148 load failure), and the renderer's fontawesome allowlist entries 404.
'use strict';

const fs   = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
    const
        appName       = `${context.packager.appInfo.productFilename}.app`,
        organismDir   = path.join(context.appOutDir, appName, 'Contents', 'Resources', 'organism'),
        stagedModules = path.join(__dirname, '.stage', 'organism', 'node_modules'),
        targetModules = path.join(organismDir, 'node_modules');

    if (!fs.existsSync(stagedModules)) {
        throw new Error(`afterPack: staged organism node_modules missing at ${stagedModules} — run pack.mjs first`)
    }

    fs.rmSync(targetModules, {force: true, recursive: true});
    // verbatimSymlinks keeps npm's .bin links intact (the chroma CLI resolution rides them).
    // node-gyp writes checkout paths into these two build recipes. Omit them from actual package
    // directories, including scoped and nested installs, before the complete runtime payload is sealed.
    const sqliteBuildMetadata = /^(?:(?:@[^/]+\/)?[^/@][^/]*\/node_modules\/)*better-sqlite3\/build\/(?:Makefile|config\.gypi)$/;
    fs.cpSync(stagedModules, targetModules, {
        recursive       : true,
        verbatimSymlinks: true,
        filter(source) {
            const relative = path.relative(stagedModules, source).split(path.sep).join('/');
            return !sqliteBuildMetadata.test(relative) || !fs.lstatSync(source).isFile()
        }
    });

    // A signed outer app needs its own independently signed hook carrier. Keep native per-Start review there.
    const {stageCodexWakeArtifact} = await import('./packCodexWake.mjs');
    console.log('  • wake hook: ' + await stageCodexWakeArtifact(organismDir, context.packager.config?.mac?.identity));

    const entryCount = fs.readdirSync(targetModules).length;

    console.log(`  • afterPack: organism node_modules completed (${entryCount} top-level entries)`)
};
