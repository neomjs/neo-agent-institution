import {test, expect} from '@playwright/test';
import {execSync}     from 'node:child_process';
import fs             from 'node:fs';
import os             from 'node:os';
import path           from 'node:path';
import {
    buildInputScopes,
    diffStamp,
    discoverCaptureSpecs,
    engineDrift,
    formatDriftRecoveryMessage,
    formatMissingStampMessage,
    inputScopes,
    listingEntries,
    nextStampEngine,
    parseStamp,
    scopeListing,
    serializeStamp,
    stampHeader
} from '../../../../buildScripts/checkVisualBaselines.mjs';

/**
 * The drift gate's negative coverage — born from a review falsifier: the input-only scope
 * false-greened when a committed golden was REMOVED through an alternate index. The golden dirs
 * are stamp scopes now, and this suite pins the sensitivity contract of the pure halves, plus the
 * merge property the per-file stamp exists for.
 *
 * Import safety is witnessed implicitly: importing the script module must execute NO git probe and
 * no process.exit — this suite completing at all is that witness (the main flow is entry-guarded).
 */
test.describe('checkVisualBaselines — the render-free drift gate\'s sensitivity contract', () => {
    const
        goldenA = '100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 0\ttest/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/cockpit-vessel-314.png',
        goldenB = '100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 0\ttest/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/fleet-grid-cards.png',
        goldenC = '100644 cccccccccccccccccccccccccccccccccccccccc 0\ttest/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/activity-stream-chips.png',
        stampOf = (...lines) => ({engine: 'e1', entries: listingEntries(lines.join('\n'))});

    test('a REMOVED golden is drift — the falsifier class that once exited 0', () => {
        expect(diffStamp(stampOf(goldenA, goldenB, goldenC), stampOf(goldenA, goldenC)))
            .toEqual(['test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/fleet-grid-cards.png (removed)'])
    });

    test('a rewritten golden (same path, new blob id) and a new golden are drift, each named', () => {
        const swapped = goldenB.replace(/b{40}/, 'd'.repeat(40));

        expect(diffStamp(stampOf(goldenA, goldenB), stampOf(goldenA, swapped)))
            .toEqual(['test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/fleet-grid-cards.png (changed)']);
        expect(diffStamp(stampOf(goldenA), stampOf(goldenA, goldenC)))
            .toEqual(['test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/activity-stream-chips.png (added)'])
    });

    test('listing order carries no meaning — git output ordering can never fake drift', () => {
        expect(diffStamp(stampOf(goldenA, goldenB, goldenC), stampOf(goldenC, goldenA, goldenB))).toEqual([])
    });

    test('a moved engine is named, never a drifted row: the Engine tracks dev and moves without any Institution change', () => {
        const entries = listingEntries(goldenA);

        expect(diffStamp({engine: 'd75cc68', entries}, {engine: '7aae7c3', entries})).toEqual([]);
        expect(engineDrift({engine: 'd75cc68'}, {engine: '7aae7c3'})).toContain('last verified at engine d75cc68, running 7aae7c3');
        expect(engineDrift({engine: null}, {engine: '7aae7c3'}), 'a stamp from before the revision').toContain('last verified at engine unknown');
        expect(engineDrift({engine: '7aae7c3'}, {engine: '7aae7c3'})).toBeNull()
    });

    test('stamping keeps the previous engine unless a golden changed or no previous stamp exists (#852)', () => {
        const
            sourceA  = '100644 1111111111111111111111111111111111111111 0\tapps/agentos/util/LivenessCadence.mjs',
            sourceB  = '100644 2222222222222222222222222222222222222222 0\tapps/agentos/util/LivenessCadence.mjs',
            e2eSnapA = '100644 3333333333333333333333333333333333333333 0\ttest/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs-snapshots/card-darwin.png',
            e2eSnapB = '100644 4444444444444444444444444444444444444444 0\ttest/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs-snapshots/card-darwin.png',
            previous = {engine: '95e63df6', entries: listingEntries([goldenA, e2eSnapA, sourceA].join('\n'))};

        // AC-1: a stamp in which only non-golden inputs changed keeps the previous engine line
        expect(nextStampEngine(previous, {
            engine : '990669e5',
            entries: listingEntries([goldenA, e2eSnapA, sourceB].join('\n'))
        })).toBe('95e63df6');

        // AC-2: a stamp in which a golden's blob changed (or was added/removed) records the running engine
        expect(nextStampEngine(previous, {
            engine : '990669e5',
            entries: listingEntries([goldenB, e2eSnapA, sourceA].join('\n'))
        })).toBe('990669e5');
        expect(nextStampEngine(previous, {
            engine : '990669e5',
            entries: listingEntries([goldenA, e2eSnapB, sourceA].join('\n'))
        })).toBe('990669e5');

        // AC-3: a first stamp (no previous file or no previous engine) records the running engine
        expect(nextStampEngine(null, {engine: '990669e5', entries: previous.entries})).toBe('990669e5');
        expect(nextStampEngine({engine: null, entries: previous.entries}, {engine: '990669e5', entries: previous.entries})).toBe('990669e5')
    });

    test('the stamp text: the engine, then one entry per file sorted by path — path, indented blob id, blank line', () => {
        const
            stamp = stampOf(goldenB, goldenA),
            text  = serializeStamp(stamp);

        expect(text.slice(text.indexOf('\nengine\n') + 1)).toBe([
            'engine', '    e1', '',
            'test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/cockpit-vessel-314.png', `    ${'a'.repeat(40)}`, '',
            'test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/fleet-grid-cards.png', `    ${'b'.repeat(40)}`, '',
            '# end of stamp', ''
        ].join('\n'));
        expect(parseStamp(text).engine).toBe('e1');
        expect(diffStamp(parseStamp(text), stamp), 'parse inverts serialize').toEqual([])
    });

    test('a CRLF checkout parses to the same stamp — the engine line stays put, nothing drifts (#949)', () => {
        const
            stamp     = stampOf(goldenA, goldenB, goldenC),
            text      = serializeStamp(stamp),
            // Git for Windows with core.autocrlf=true checks the stamp out with CRLF line endings
            crlf      = text.replace(/\n/g, '\r\n'),
            lfParsed  = parseStamp(text),
            crlfParse = parseStamp(crlf);

        // AC-1: the stamp and its CRLF copy parse to the same {engine, entries}
        expect(crlfParse.engine).toBe(lfParsed.engine);
        expect([...crlfParse.entries]).toEqual([...lfParsed.entries]);
        expect(crlfParse.entries.size, 'no key keeps a trailing carriage return').toBe(lfParsed.entries.size);

        // AC-2: with no golden changed, the CRLF stamp keeps its engine through nextStampEngine…
        expect(nextStampEngine(crlfParse, {engine: '990669e5', entries: lfParsed.entries})).toBe('e1');

        // …and diffStamp against matching entries reports nothing (it once reported every input drifted)
        expect(diffStamp(crlfParse, lfParsed)).toEqual([])
    });

    test('pull requests that stamp different files merge cleanly, even as neighbours; the same file conflicts', () => {
        const
            folder   = 'test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs',
            // sorted neighbours: activity-…, (bus-lane-…), cockpit-…, fleet-…, (grid-strip-…)
            activity = `${folder}/activity-stream-chips.png`,
            busLane  = `${folder}/bus-lane-strip.png`,
            cockpit  = `${folder}/cockpit-vessel-314.png`,
            fleet    = `${folder}/fleet-grid-cards.png`,
            grid     = `${folder}/grid-strip.png`,
            base     = stampOf(goldenA, goldenB, goldenC),
            set      = (file, blob) => stamp => ({engine: stamp.engine, entries: new Map([...stamp.entries, [file, blob]])}),
            drop     = file => stamp => ({engine: stamp.engine, entries: new Map([...stamp.entries].filter(([key]) => key !== file))}),
            // each branch stamps its own change over `base`; the merged stamp, or null on a conflict
            merge    = (one, two) => {
                const
                    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-merge-')),
                    file = path.join(repo, 'baseline-inputs.txt'),
                    git  = command => execSync(`git -c user.name=spec -c user.email=spec@example.invalid -c commit.gpgsign=false ${command}`, {cwd: repo, encoding: 'utf8', stdio: 'pipe'});

                try {
                    git('init -q -b dev');
                    fs.writeFileSync(file, serializeStamp(base));
                    git('add .');
                    git('commit -q -m base');

                    git('checkout -q -b one');
                    fs.writeFileSync(file, serializeStamp(one(base)));
                    git('commit -q -am one');

                    git('checkout -q -b two dev');
                    fs.writeFileSync(file, serializeStamp(two(base)));
                    git('commit -q -am two');

                    try {
                        git('merge -q --no-edit one')
                    } catch {
                        return null
                    }

                    return parseStamp(fs.readFileSync(file, 'utf8'))
                } finally {
                    fs.rmSync(repo, {force: true, recursive: true})
                }
            };

        // the blank line fences an entry from an add or remove right after it, the closing line
        // does the same for the last entry
        for (const [label, one, two] of [
            ['neighbours both changed',              set(activity, '1'.repeat(40)), set(cockpit, '2'.repeat(40))],
            ['a file added after a changed one',     set(activity, '1'.repeat(40)), set(busLane, '2'.repeat(40))],
            ['a file added before a changed one',    set(busLane,  '1'.repeat(40)), set(cockpit, '2'.repeat(40))],
            ['a file removed after a changed one',   set(activity, '1'.repeat(40)), drop(cockpit)],
            ['a file removed before a changed one',  drop(cockpit),                 set(fleet,   '2'.repeat(40))],
            ['a file added after the last, changed', set(fleet,    '1'.repeat(40)), set(grid,    '2'.repeat(40))]
        ]) {
            const merged = merge(one, two);

            expect(merged, `${label}: merges without a conflict`).not.toBeNull();
            expect(diffStamp(merged, two(one(base))), `${label}: the merged stamp is both changes`).toEqual([])
        }

        expect(merge(set(cockpit, '1'.repeat(40)), set(cockpit, '2'.repeat(40))), 'the same file stamped twice conflicts').toBeNull()
    });

    test('the design-carve scope contract: SPEC documents never enter the stamp; style-owning files still do', () => {
        // the contract row under witness
        const agentosScope = inputScopes.find(scope => scope.key === 'apps/agentos');

        expect(agentosScope.exclude).toContain('apps/agentos/design');

        // baseline over the REAL index
        const
            unfiltered = scopeListing({key: agentosScope.key}),
            filtered   = scopeListing(agentosScope);

        expect(unfiltered).toContain('apps/agentos/design/');
        expect(filtered).not.toContain('apps/agentos/design/');

        // the NEGATIVE arm, for real: stage a synthetic design document into the actual index
        // (cacheinfo — no worktree file), re-run the CONTRACT listing pipeline, and require the
        // contract entries to be UNCHANGED while the old unfiltered scope drifts. Cleaned up in
        // finally so the index leaves the test exactly as it entered.
        const witnessPath = 'apps/agentos/design/__scope-witness__.html';

        try {
            const blob = execSync('git hash-object -w --stdin', {input: '<!-- scope witness -->', encoding: 'utf8'}).trim();

            execSync(`git update-index --add --cacheinfo 100644,${blob},${witnessPath}`, {encoding: 'utf8'});

            const
                filteredAfter   = scopeListing(agentosScope),
                unfilteredAfter = scopeListing({key: agentosScope.key}),
                entriesOf       = listing => ({engine: 'e1', entries: listingEntries(listing)});

            expect(unfilteredAfter, 'the staged design file IS in the index').toContain(witnessPath);
            expect(filteredAfter,   'the contract listing never sees it').not.toContain(witnessPath);
            expect(diffStamp(entriesOf(filtered), entriesOf(filteredAfter)), 'a design change leaves the contract stamp unchanged').toEqual([]);
            expect(diffStamp(entriesOf(unfiltered), entriesOf(unfilteredAfter)), 'the OLD un-carved scope would have drifted').toEqual([`${witnessPath} (added)`])
        } finally {
            execSync(`git update-index --force-remove ${witnessPath}`, {encoding: 'utf8'})
        }

        // the POSITIVE arm: a style-owning delta is still drift — the gate keeps its teeth (pure,
        // over the listing function the checker uses)
        const withStyleChange = filtered + '100644 ' + 'f'.repeat(40) + ' 0\tapps/agentos/view/fleet/cockpit/Container.mjs\n';

        expect(diffStamp({engine: 'e1', entries: listingEntries(filtered)}, {engine: 'e1', entries: listingEntries(withStyleChange)}))
            .toEqual(['apps/agentos/view/fleet/cockpit/Container.mjs (changed)'])
    });

    test('source-derived golden scopes (#911): every screenshot-asserting spec and its golden folder join without a hand list', () => {
        const
            discovered   = discoverCaptureSpecs(process.cwd()),
            expectedLive = [
                ['test/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs',        'test/playwright/e2e/agentos/AgentCardSynthesisRenderNL.spec.mjs-snapshots'],
                ['test/playwright/e2e/agentos/FleetCockpitBarCompositionNL.spec.mjs',      'test/playwright/e2e/agentos/FleetCockpitBarCompositionNL.spec.mjs-snapshots'],
                ['test/playwright/e2e/agentos/FleetCockpitDrillRoundTripNL.spec.mjs',      'test/playwright/e2e/agentos/FleetCockpitDrillRoundTripNL.spec.mjs-snapshots'],
                ['test/playwright/e2e/agentos/FleetGoldenPathNL.spec.mjs',                 'test/playwright/e2e/agentos/FleetGoldenPathNL.spec.mjs-snapshots'],
                ['test/playwright/e2e/agentos/FleetMemoriesNL.spec.mjs',                   'test/playwright/e2e/agentos/FleetMemoriesNL.spec.mjs-snapshots'],
                ['test/playwright/e2e/agentos/FleetNavFamilyPin.spec.mjs',                 'test/playwright/e2e/agentos/FleetNavFamilyPin.spec.mjs-snapshots'],
                ['test/playwright/visual/FleetCockpitVisual.spec.mjs',                     'test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs'],
                ['test/playwright/visual/SystemViewVisual.spec.mjs',                       'test/playwright/visual/__screenshots__/SystemViewVisual.spec.mjs']
            ];

        expect(discovered.map(({spec, goldenDir}) => [spec, goldenDir])).toEqual(expectedLive);

        for (const [spec, goldenDir] of expectedLive) {
            expect(inputScopes).toContainEqual({key: spec});
            expect(inputScopes).toContainEqual({key: goldenDir, golden: true})
        }

        // Hermetic witness: a new capture spec joins buildInputScopes automatically with no list edit
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-scope-discovery-'));

        try {
            const write = (relPath, content) => {
                const abs = path.join(repo, relPath);
                fs.mkdirSync(path.dirname(abs), {recursive: true});
                fs.writeFileSync(abs, content)
            };

            write('test/playwright/visual/NewSurfaceVisual.spec.mjs', `await expect(pane).toHaveScreenshot('surface.png');\n`);
            write('test/playwright/e2e/agentos/NewJourneyNL.spec.mjs', `test('nl', async ({page, neuralLink}) => { await expect(page).toHaveScreenshot('journey.png'); });\n`);
            write('test/playwright/e2e/agentos/PlainInteraction.spec.mjs', `test('plain', async ({page}) => { await expect(page.locator('.x')).toBeVisible(); });\n`);
            write('test/playwright/unit/buildScripts/Meta.spec.mjs', `// unit specs never render screenshots even if mentioning toHaveScreenshot\n`);

            expect(buildInputScopes(repo)).toEqual([
                {key: 'apps/agentos', exclude: ['apps/agentos/design']},
                {key: 'resources/scss'},
                {key: 'test/playwright/e2e/agentos/NewJourneyNL.spec.mjs'},
                {key: 'test/playwright/e2e/agentos/NewJourneyNL.spec.mjs-snapshots', golden: true},
                {key: 'test/playwright/visual/NewSurfaceVisual.spec.mjs'},
                {key: 'test/playwright/visual/__screenshots__/NewSurfaceVisual.spec.mjs', golden: true}
            ])
        } finally {
            fs.rmSync(repo, {force: true, recursive: true})
        }
    });

    test('stamp header and drift recovery guidance name npm run test-goldens (#911)', () => {
        expect(stampHeader.join('\n')).toContain('npm run test-goldens');
        expect(formatMissingStampMessage()).toContain('npm run test-goldens');
        expect(formatDriftRecoveryMessage(['resources/scss/theme-neo-dark/apps/agentos/Viewport.scss (changed)']))
            .toContain('npm run test-goldens')
    });

    test('every capture instruction asks for the mode that rewrites all goldens: the default leaves a change inside the tolerance behind', () => {
        const mode = '--update-snapshots=all';

        expect(stampHeader.join('\n')).toContain(mode);
        expect(formatMissingStampMessage()).toContain(mode);
        expect(formatDriftRecoveryMessage(['apps/agentos/view/Viewport.mjs (changed)'])).toContain(mode)
    });

});
