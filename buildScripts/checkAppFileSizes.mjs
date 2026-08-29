import {execSync}      from 'node:child_process';
import fs              from 'node:fs';
import path            from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * @summary The 1k-LOC bar with teeth: a mechanical size gate over the `apps/**` product surface.
 *
 * The cockpit decomposition split a 3.3k-line god object into responsibility-seam leaves — and the
 * record shows WHY a gate must outlive the cleanup: the debt class regressed once before
 * (3,327 → 3,487 lines across a single feature PR) precisely because no gate watched it. This
 * script is the closing clause of that decomposition: every tracked `apps/**` `.mjs` file is
 * measured, and a file past the bar fails CI with the offender list instead of merging silently.
 *
 * One budget, no exemptions — settled by measurement at adoption: the demo monolith once
 * considered for a carve had already been relocated out of the product tree by the time this guard
 * was born, so a childapps carve would exempt nothing and would HIDE a returning demo monolith —
 * the exact debt shape the relocation removed. (Historical coordinates live with the guard's
 * ticket and PR, not here: the enforcement contract must stay readable without issue archaeology.)
 *
 * The ladder: warn at 900 lines (headroom is shrinking — plan the next responsibility-seam cut),
 * error above 1,000 lines (the bar itself). Lines are NEWLINE COUNTS, exactly `wc -l`: an empty
 * file and a file without a final newline measure 0 and n respectively, matching the units the
 * decomposition record was measured in. The bar is the SYMPTOM threshold — the fix is extraction
 * along responsibility seams, never line golf.
 *
 * Check: npm run check-app-file-sizes   (CI + local; exits 1 with offenders past the bar)
 */

/**
 * Warn threshold, in `wc -l` lines: at or above, the file is named as approaching the bar.
 * @type {Number}
 */
export const WARN_LOC = 900;

/**
 * Error threshold, in `wc -l` lines: strictly above, the check fails.
 * @type {Number}
 */
export const ERROR_LOC = 1000;

/**
 * The git pathspec defining the guarded surface: every tracked module of the product apps.
 * @type {String}
 */
export const guardPathspec = 'apps/**/*.mjs';

/**
 * @summary The pure verdict half: classify measured entries against the warn/error ladder.
 *
 * Exported for the unit witness — the boundary semantics (1,000 warns, 1,001 errors) are part of
 * the guard's contract, not an accident of the comparison operators.
 * @param {Object[]} entries `{path, lines}` per measured file.
 * @returns {{errors: Object[], warnings: Object[]}} Both lists sorted largest-first.
 */
export function classifyEntries(entries) {
    const
        bySize   = [...entries].sort((a, b) => b.lines - a.lines),
        errors   = bySize.filter(entry => entry.lines > ERROR_LOC),
        warnings = bySize.filter(entry => entry.lines <= ERROR_LOC && entry.lines >= WARN_LOC);

    return {errors, warnings}
}

/**
 * @summary The measurement half: line counts for every tracked file the pathspec matches.
 *
 * `git ls-files` keeps the inventory index-true (untracked scratch files cannot fail CI), and the
 * count is the file's NEWLINE count — exactly `wc -l`, the unit the decomposition record uses.
 * Exported for the hermetic inventory witness: the breadth of the guarded surface is part of the
 * contract, so narrowing the pathspec or carving a subtree out must turn a spec red.
 * @param {String} cwd Repository root to measure from.
 * @returns {Object[]} `{path, lines}` per tracked file.
 */
export function collectAppFileSizes(cwd) {
    return execSync(`git ls-files -z '${guardPathspec}'`, {cwd, encoding: 'utf8'})
        .split('\0')
        .filter(Boolean)
        .map(file => ({
            path : file,
            lines: (fs.readFileSync(`${cwd}/${file}`, 'utf8').match(/\n/g) || []).length
        }))
}

const isEntryScript = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntryScript) {
    const {errors, warnings} = classifyEntries(collectAppFileSizes(process.cwd()));

    warnings.forEach(({path, lines}) => console.warn(`⚠ ${path} (${lines} lines, warn ≥ ${WARN_LOC}) — headroom is shrinking; plan the next responsibility-seam cut`));

    if (errors.length > 0) {
        errors.forEach(({path, lines}) => console.error(`✗ ${path} (${lines} lines > ${ERROR_LOC})`));
        console.error(`\nThe app-file size bar failed. The fix is extraction along responsibility seams, never line golf.`);
        process.exit(1)
    }

    console.log(`✓ app file sizes: ${errors.length} over the ${ERROR_LOC}-line bar, ${warnings.length} in the warn band (≥ ${WARN_LOC})`)
}
