import {execSync} from 'node:child_process';
import fs         from 'node:fs';

/**
 * @summary The 1k-LOC bar with teeth: a mechanical size gate over the `apps/**` product surface.
 *
 * The #22 epic decomposed the 3.3k-LOC FleetCockpit god object into responsibility-seam leaves —
 * and its measurements show WHY a gate must outlive the cleanup: the debt class regressed once
 * before (3,327 → 3,487 LOC across a single feature PR) precisely because no gate watched it.
 * This script is the epic's closing clause: every tracked `apps/**` `.mjs` file is measured, and
 * a file past the bar fails CI with the offender list instead of merging silently.
 *
 * One budget, no exemptions — decided at #55 with the childapps question settled by measurement:
 * the demo monolith the epic exempted-in-principle (dockdemo / DemoBWorkspace) had already been
 * relocated out of the product app by the time this guard was born (neomjs/neo#16322 /
 * neomjs/neo#15614), so a childapps carve would exempt nothing today and would HIDE a returning
 * demo monolith tomorrow — the exact debt shape the relocation removed.
 *
 * The ladder: warn ≥ 900 lines (headroom is shrinking — plan the next seam), error > 1,000 lines
 * (the bar itself; the line count of `wc -l`, matching the epic's measurements). The bar is the
 * SYMPTOM threshold — the fix is extraction along responsibility seams, never line golf; #22
 * records the proven seam families.
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
 * count matches `wc -l` — the unit the epic's own measurements use.
 * @param {String} cwd Repository root to measure from.
 * @returns {Object[]} `{path, lines}` per tracked file.
 */
export function collectAppFileSizes(cwd) {
    return execSync(`git ls-files -z '${guardPathspec}'`, {cwd, encoding: 'utf8'})
        .split('\0')
        .filter(Boolean)
        .map(file => {
            const content = fs.readFileSync(`${cwd}/${file}`, 'utf8');

            return {path: file, lines: content.split('\n').length - (content.endsWith('\n') ? 1 : 0)}
        })
}

const invokedAsScript = process.argv[1]?.endsWith('checkAppFileSizes.mjs');

if (invokedAsScript) {
    const {errors, warnings} = classifyEntries(collectAppFileSizes(process.cwd()));

    warnings.forEach(({path, lines}) => console.warn(`⚠ ${path} (${lines} lines, warn ≥ ${WARN_LOC}) — headroom is shrinking; plan the next responsibility-seam cut (#22)`));

    if (errors.length > 0) {
        errors.forEach(({path, lines}) => console.error(`✗ ${path} (${lines} lines > ${ERROR_LOC})`));
        console.error(`\nThe 1k-LOC app-file bar failed. The fix is extraction along responsibility seams (see #22's seam families), never line golf.`);
        process.exit(1)
    }

    console.log(`✓ app file sizes: ${errors.length} over the ${ERROR_LOC}-line bar, ${warnings.length} in the warn band (≥ ${WARN_LOC})`)
}
