import {execSync} from 'node:child_process';
import crypto     from 'node:crypto';
import fs         from 'node:fs';
import path       from 'node:path';

/**
 * @summary The Darwin-golden drift signal: a render-free freshness gate over the visual baselines.
 *
 * The pixel goldens under `test/playwright` are rendered-platform artifacts: they are captured on
 * Darwin, and the visual/e2e capture configs are deliberately absent from Ubuntu CI, because a
 * cross-platform pixel comparison would assert authority the renderer does not have. That honesty
 * created a blind spot — an SCSS or view change could merge with stale goldens and nothing on any
 * platform would ever say so.
 *
 * This script closes the blind spot WITHOUT granting Ubuntu pixel authority. It never renders and
 * never compares pixels; it compares INPUT IDENTITY. `--stamp` records a digest of every
 * style-owning input (the staged blob ids of `resources/scss`, `apps/agentos`, and the two capture
 * specs) next to the baselines; the default check recomputes the digest and fails when the inputs
 * moved past the stamp — the signal that the goldens were left behind and must be re-captured on a
 * rendering platform.
 *
 * Digest source: `git ls-files -s` (staged blob ids). The stamp is taken from the same index state
 * the baseline commit ships, so in CI — where the checkout IS the committed state — the digest is
 * exact, with no mtime or filesystem noise.
 *
 * Stamp:  npm run stamp-visual-baselines   (run together with `--update-snapshots` captures,
 *                                           after staging the capture's input + golden changes)
 * Check:  npm run check-visual-baselines   (CI + local; exits 1 on drift with the recovery steps)
 */

const
    cwd       = process.cwd(),
    stampFile = 'test/playwright/visual/__screenshots__/baseline-inputs.json',
    // The style-owning inputs of the rendered surfaces the goldens pin. Scope deliberately: theme
    // sources + the app's own view code + the two capture specs. Engine version moves are visible
    // through package-lock.json's neo.mjs entry, captured below as its own axis.
    inputPaths = [
        'apps/agentos',
        'resources/scss',
        'test/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs',
        'test/playwright/visual/FleetCockpitVisual.spec.mjs'
    ];

/**
 * @summary One digest per input scope from the staged blob ids — index-exact, platform-free.
 * @param {String} scope A path passed to `git ls-files -s`.
 * @returns {String} sha256 over the sorted staged-object listing.
 */
function scopeDigest(scope) {
    const listing = execSync(`git ls-files -s -- "${scope}"`, {cwd, encoding: 'utf8'})
        .split('\n').filter(Boolean).sort().join('\n');

    return crypto.createHash('sha256').update(listing).digest('hex')
}

/**
 * @summary The engine axis: the locked neo.mjs resolution — a version bump re-renders every surface.
 * @returns {String}
 */
function engineDigest() {
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'));

    return crypto.createHash('sha256')
        .update(JSON.stringify(lock.packages?.['node_modules/neo.mjs'] ?? null))
        .digest('hex')
}

const current = {
    engine: engineDigest(),
    inputs: Object.fromEntries(inputPaths.map(p => [p, scopeDigest(p)]))
};

if (process.argv.includes('--stamp')) {
    fs.writeFileSync(path.join(cwd, stampFile), JSON.stringify({
        note   : 'Input-identity stamp for the Darwin visual baselines — regenerate via `npm run stamp-visual-baselines` whenever goldens are re-captured. The check compares digests only; it never grants CI pixel authority.',
        engine : current.engine,
        inputs : current.inputs
    }, null, 4) + '\n');

    console.log(`visual-baselines: stamp written to ${stampFile}`);
    process.exit(0)
}

if (!fs.existsSync(path.join(cwd, stampFile))) {
    console.error(
        'visual-baselines: no input stamp found — the goldens carry no freshness identity.\n' +
        'Capture (Darwin): the visual + e2e capture suites with --update-snapshots, then:\n' +
        '  npm run stamp-visual-baselines  (stage the changes first — the stamp reads the index)'
    );
    process.exit(1)
}

const
    stamp   = JSON.parse(fs.readFileSync(path.join(cwd, stampFile), 'utf8')),
    drifted = [
        ...(stamp.engine !== current.engine ? ['package-lock.json → node_modules/neo.mjs (engine version)'] : []),
        ...inputPaths.filter(p => stamp.inputs?.[p] !== current.inputs[p])
    ];

if (drifted.length > 0) {
    console.error(
        'visual-baselines: style-owning inputs moved past the golden stamp — the Darwin baselines are\n' +
        'potentially stale. This check compares input identity only (no pixels, no CI render authority).\n\n' +
        'Drifted:\n' + drifted.map(p => `  - ${p}`).join('\n') + '\n\n' +
        'Recovery (on a rendering platform):\n' +
        '  1. re-run the visual + e2e capture suites, with --update-snapshots when the delta is an\n' +
        '     intended design outcome (the refreshed golden diff is the review surface)\n' +
        '  2. stage the changes, then: npm run stamp-visual-baselines'
    );
    process.exit(1)
}

console.log('visual-baselines: input identity matches the golden stamp.');
process.exit(0)
