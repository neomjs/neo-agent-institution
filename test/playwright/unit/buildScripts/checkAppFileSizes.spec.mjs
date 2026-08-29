import {test, expect} from '@playwright/test';
import {execSync}     from 'node:child_process';
import fs             from 'node:fs';
import os             from 'node:os';
import path           from 'node:path';
import {classifyEntries, collectAppFileSizes, ERROR_LOC, WARN_LOC} from '../../../../buildScripts/checkAppFileSizes.mjs';

/**
 * The app-file size bar's contract witness, in two halves.
 *
 * The pure classifier arms pin the ladder's boundary semantics (1,000 warns, 1,001 errors — the
 * bar means BELOW ~1k, so the bar line itself is the last warning, not the first failure).
 *
 * The hermetic inventory arms drive the REAL collector over a throwaway git repository, because
 * the guarded breadth is itself the contract: a reviewer falsifier showed that narrowing the
 * pathspec to one subtree left every threshold arm green while the gate silently stopped watching
 * the rest of the surface. The temp-repo witness makes that class red — inclusion across app
 * subtrees (childapps included: no carve exists), exclusion outside `apps/`, and `wc -l` newline
 * counting pinned on the empty and no-final-newline edge cases.
 *
 * Import safety is witnessed implicitly: importing the module runs no git probe and no
 * process.exit (the CLI flow is entry-guarded on the resolved module path) — this suite completing
 * is that witness.
 */
test.describe('checkAppFileSizes — the ladder contract', () => {

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
});

test.describe('checkAppFileSizes — the hermetic inventory contract', () => {

    /**
     * One throwaway git repository per test run: tracked fixtures spanning the guarded surface's
     * breadth (a plain app module, a childapps module, a second product app) plus an out-of-scope
     * module and the two `wc -l` edge cases. `git add` is enough — `ls-files` reads the index, so
     * no commit (and no user identity) is required.
     */
    function makeFixtureRepo() {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'app-size-guard-'));

        const write = (relPath, content) => {
            const abs = path.join(repo, relPath);

            fs.mkdirSync(path.dirname(abs), {recursive: true});
            fs.writeFileSync(abs, content)
        };

        write('apps/agentos/view/Normal.mjs',        'line\n'.repeat(10));
        write('apps/agentos/childapps/demo/Big.mjs', 'line\n'.repeat(ERROR_LOC + 1));
        write('apps/other/App.mjs',                  'line\n'.repeat(3));
        write('docs/Outside.mjs',                    'line\n'.repeat(2000));
        write('apps/agentos/util/Empty.mjs',         '');
        write('apps/agentos/util/NoFinalNewline.mjs', 'one\ntwo\nthree');

        execSync('git init -q && git add .', {cwd: repo});

        return repo
    }

    test('inventory breadth: app subtrees are IN (childapps carve-free), outside modules are OUT, wc -l is exact', () => {
        const repo = makeFixtureRepo();

        try {
            const
                entries = collectAppFileSizes(repo),
                byPath  = Object.fromEntries(entries.map(e => [e.path, e.lines]));

            // inclusion across the surface's breadth — a narrowed pathspec reds here
            expect(byPath['apps/agentos/view/Normal.mjs']).toBe(10);
            expect(byPath['apps/other/App.mjs']).toBe(3);

            // no childapps carve exists — a reintroduced exemption reds here
            expect(byPath['apps/agentos/childapps/demo/Big.mjs']).toBe(ERROR_LOC + 1);

            // exclusion: modules outside apps/ never enter the inventory
            expect(byPath['docs/Outside.mjs']).toBeUndefined();

            // wc -l edge cases: newline counts, not split-based line counts
            expect(byPath['apps/agentos/util/Empty.mjs']).toBe(0);
            expect(byPath['apps/agentos/util/NoFinalNewline.mjs']).toBe(2);

            // and the over-budget childapps module is an ERROR through the same public ladder
            const {errors} = classifyEntries(entries);

            expect(errors.map(e => e.path)).toEqual(['apps/agentos/childapps/demo/Big.mjs'])
        } finally {
            fs.rmSync(repo, {recursive: true, force: true})
        }
    });

    test('live tree: the tracked apps/** surface holds the bar (the adoption proof, kept executable)', () => {
        const entries = collectAppFileSizes(process.cwd());

        expect(entries.length).toBeGreaterThan(0);

        const {errors} = classifyEntries(entries);

        expect(errors, errors.map(e => `${e.path} (${e.lines})`).join(', ')).toEqual([])
    });
});
