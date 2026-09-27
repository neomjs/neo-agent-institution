import {execSync}      from 'node:child_process';
import crypto          from 'node:crypto';
import fs              from 'node:fs';
import path            from 'node:path';
import {fileURLToPath} from 'node:url';

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
 * never compares pixels; it compares INPUT IDENTITY. `--stamp` records the staged blob id of every
 * style-owning input file (`resources/scss`, `apps/agentos`, the two capture specs and their golden
 * sets) plus the engine's locked resolution; the default check recomputes them and fails when any
 * input moved past the stamp — the signal that the goldens were left behind and must be re-captured
 * on a rendering platform.
 *
 * The stamp holds one entry per FILE: its path, its blob id on an indented line, a blank line. Git
 * conflicts on edits that touch and merges edits an unchanged line separates. A changed file moves
 * only its blob line, fenced by its own path and blank line, so pull requests that stamp different
 * files merge cleanly, whether they change, add or remove them, and the merged stamp is the merged
 * inputs. Two pull requests that change the same file, or add and remove files at the same spot of
 * the sorted list, still conflict: a combined state neither of them stamped.
 *
 * Source: `git ls-files -s` (staged blob ids). The stamp is taken from the same index state the
 * baseline commit ships, so in CI — where the checkout IS the committed state — it is exact, with no
 * mtime or filesystem noise.
 *
 * Stamp:  npm run stamp-visual-baselines   (run together with `--update-snapshots` captures,
 *                                           after staging the capture's input + golden changes)
 * Check:  npm run check-visual-baselines   (CI + local; exits 1 on drift with the recovery steps)
 */

/**
 * The input-scope CONTRACT: the paths whose files the stamp covers; `exclude` carves non-style
 * content out via git pathspec magic. `apps/agentos/design` holds SPEC documents (design contracts
 * and direction mocks) — they specify surfaces, they do not style them. The golden sets are scopes
 * too, so a removed or rewritten golden is drift instead of vanishing silently.
 * Exported for the scope-contract regression witness.
 * @type {Object[]}
 */
export const inputScopes = [
        {key: 'apps/agentos', exclude: ['apps/agentos/design']},
        {key: 'resources/scss'},
        {key: 'test/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs'},
        {key: 'test/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs-snapshots'},
        {key: 'test/playwright/visual/FleetCockpitVisual.spec.mjs'},
        {key: 'test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs'}
];

const
    cwd         = process.cwd(),
    stampFile   = 'test/playwright/visual/__screenshots__/baseline-inputs.txt',
    stampHeader = [
        '# Input-identity stamp for the Darwin visual baselines (buildScripts/checkVisualBaselines.mjs).',
        '# Written by `npm run stamp-visual-baselines`; on a merge conflict, re-stamp instead of resolving',
        '# by hand. One entry per style-owning input file: its path, its staged blob id, a blank line.'
    ],
    // a fixed last line, so the final entry's blank line is never the end of the file
    stampFooter = '# end of stamp',
    engineKey   = 'engine',
    engineRow   = 'package-lock.json → node_modules/neo.mjs (engine version)';

/**
 * @summary The pure listing half: `git ls-files -s` output as a map of path → staged blob id.
 * Order-free by construction, so git output ordering can never fake drift.
 * @param {String} listing Raw `git ls-files -s` output (`<mode> <blob> <stage>\t<path>` per line).
 * @returns {Map<String, String>}
 */
export function listingEntries(listing) {
    const entries = new Map();

    for (const line of listing.split('\n')) {
        const tab = line.indexOf('\t');

        if (tab > -1) {
            entries.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[1])
        }
    }

    return entries
}

/**
 * @summary The stamp file's text: the header, the engine entry, then one entry per input file sorted
 * by path. An entry is its key, its value on an indented line, and a blank line.
 * @param {Object}              stamp
 * @param {String}              stamp.engine  The engine digest.
 * @param {Map<String, String>} stamp.entries Path → blob id.
 * @returns {String}
 */
export function serializeStamp({engine, entries}) {
    const rows = [[engineKey, engine], ...[...entries.keys()].sort().map(file => [file, entries.get(file)])];

    return [...stampHeader, '', ...rows.flatMap(([key, value]) => [key, `    ${value}`, '']), stampFooter, ''].join('\n')
}

/**
 * @summary The inverse of {@link serializeStamp}: an indented line is the value of the key above it;
 * comment and blank lines carry no data.
 * @param {String} text
 * @returns {{engine: String|null, entries: Map<String, String>}}
 */
export function parseStamp(text) {
    const entries = new Map();
    let key = null;

    for (const line of text.split('\n')) {
        if (line.startsWith(' ')) {
            entries.set(key, line.trim())
        } else if (line && !line.startsWith('#')) {
            key = line
        }
    }

    const engine = entries.get(engineKey) ?? null;

    entries.delete(engineKey);

    return {engine, entries}
}

/**
 * @summary The pure verdict half: every input that moved past the stamp, by name.
 * @param {Object} stamp   `{engine, entries}` as parsed from the stamp file.
 * @param {Object} current Same shape, freshly computed.
 * @returns {String[]} Human-readable drifted rows; empty = fresh.
 */
export function diffStamp(stamp, current) {
    const rows = stamp.engine !== current.engine ? [engineRow] : [];

    for (const file of new Set([...stamp.entries.keys(), ...current.entries.keys()])) {
        const was = stamp.entries.get(file), is = current.entries.get(file);

        if (was !== is) {
            rows.push(`${file} (${!was ? 'added' : !is ? 'removed' : 'changed'})`)
        }
    }

    return rows
}

/**
 * @summary The raw staged-blob listing for one scope, exclusions applied — exported so the scope
 * CONTRACT (what is carved out of the stamp) has direct regression coverage.
 * @param {Object}   scope
 * @param {String}   scope.key       The path passed to `git ls-files -s`.
 * @param {String[]} [scope.exclude] Sub-paths carved out via git pathspec exclude magic.
 * @returns {String}
 */
export function scopeListing({key, exclude = []}) {
    const pathspecs = [`"${key}"`, ...exclude.map(sub => `":(exclude)${sub}"`)].join(' ');

    return execSync(`git ls-files -s -- ${pathspecs}`, {cwd, encoding: 'utf8'})
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

// Import-safe by construction: the pure halves above are unit-testable, and the git-touching main
// flow runs ONLY when this file is the entry script — an importing spec must never probe the index
// or exit the process.
const isEntryScript = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (!isEntryScript) {
    /* exports only */
} else {

const current = {
    engine : engineDigest(),
    entries: new Map(inputScopes.flatMap(scope => [...listingEntries(scopeListing(scope))]))
};

if (process.argv.includes('--stamp')) {
    fs.writeFileSync(path.join(cwd, stampFile), serializeStamp(current));

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

const drifted = diffStamp(parseStamp(fs.readFileSync(path.join(cwd, stampFile), 'utf8')), current);

if (drifted.length > 0) {
    console.error(
        'visual-baselines: style-owning inputs moved past the golden stamp — the Darwin baselines are\n' +
        'potentially stale. This check compares input identity only (no pixels, no CI render authority).\n\n' +
        `Drifted (${drifted.length}):\n` + drifted.slice(0, 20).map(row => `  - ${row}`).join('\n') +
        (drifted.length > 20 ? `\n  … and ${drifted.length - 20} more` : '') + '\n\n' +
        'Recovery (on a rendering platform):\n' +
        '  1. re-run the visual + e2e capture suites, with --update-snapshots when the delta is an\n' +
        '     intended design outcome (the refreshed golden diff is the review surface)\n' +
        '  2. stage the changes, then: npm run stamp-visual-baselines'
    );
    process.exit(1)
}

console.log('visual-baselines: input identity matches the golden stamp.');
process.exit(0)

}
