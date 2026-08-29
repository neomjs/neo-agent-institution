import {test, expect} from '@playwright/test';
import {classifyEntries, collectAppFileSizes, ERROR_LOC, WARN_LOC} from '../../../../buildScripts/checkAppFileSizes.mjs';

/**
 * The 1k-bar guard's contract witness. The pure classifier arms pin the ladder's boundary
 * semantics (1,000 warns, 1,001 errors — the bar means BELOW ~1k, so the bar line itself is the
 * last warning, not the first failure), and the live arm runs the real collector over the tracked
 * tree: the guard was born with the bar HOLDING (#22's extractions landed first), and this arm
 * keeps that adoption proof executable.
 *
 * Import safety is witnessed implicitly: importing the module runs no git probe and no
 * process.exit (the CLI flow is entry-guarded) — this suite completing is that witness.
 */
test.describe('checkAppFileSizes — the 1k-LOC bar\'s ladder contract', () => {

    test('a file past the bar is an error; the bar line itself is the last warning', () => {
        const {errors, warnings} = classifyEntries([
            {path: 'apps/agentos/view/A.mjs', lines: ERROR_LOC + 1},
            {path: 'apps/agentos/view/B.mjs', lines: ERROR_LOC}
        ]);

        expect(errors.map(e => e.path)).toEqual(['apps/agentos/view/A.mjs']);
        expect(warnings.map(w => w.path)).toEqual(['apps/agentos/view/B.mjs'])
    });

    test('the warn band opens at WARN_LOC and everything below stays silent', () => {
        const {errors, warnings} = classifyEntries([
            {path: 'apps/agentos/view/C.mjs', lines: WARN_LOC},
            {path: 'apps/agentos/view/D.mjs', lines: WARN_LOC - 1}
        ]);

        expect(errors).toEqual([]);
        expect(warnings.map(w => w.path)).toEqual(['apps/agentos/view/C.mjs'])
    });

    test('both lists render largest-first — the worst offender leads the CI output', () => {
        const {errors} = classifyEntries([
            {path: 'apps/agentos/view/E.mjs', lines: ERROR_LOC + 5},
            {path: 'apps/agentos/view/F.mjs', lines: ERROR_LOC + 500}
        ]);

        expect(errors.map(e => e.path)).toEqual(['apps/agentos/view/F.mjs', 'apps/agentos/view/E.mjs'])
    });

    test('live tree: the tracked apps/** surface holds the bar (the adoption proof, kept executable)', () => {
        const entries = collectAppFileSizes(process.cwd());

        expect(entries.length).toBeGreaterThan(0);

        const {errors} = classifyEntries(entries);

        expect(errors, errors.map(e => `${e.path} (${e.lines})`).join(', ')).toEqual([])
    });
});
