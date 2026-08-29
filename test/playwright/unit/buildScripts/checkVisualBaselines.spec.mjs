import {test, expect} from '@playwright/test';
import {execSync}     from 'node:child_process';
import {digestListing, diffStamp, inputScopes, scopeListing} from '../../../../buildScripts/checkVisualBaselines.mjs';

/**
 * The drift gate's negative coverage — born from a review falsifier: the input-only digest scope
 * false-greened when a committed golden was REMOVED through an alternate index. The golden dirs
 * are digest scopes now, and this suite pins the sensitivity contract of the pure halves.
 *
 * Import safety is witnessed implicitly: importing the script module must execute NO git probe and
 * no process.exit — this suite completing at all is that witness (the main flow is entry-guarded).
 */
test.describe('checkVisualBaselines — the render-free drift gate\'s sensitivity contract', () => {
    const
        goldenA = '100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 0\ttest/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/cockpit-vessel-314.png',
        goldenB = '100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 0\ttest/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/fleet-grid-cards.png',
        goldenC = '100644 cccccccccccccccccccccccccccccccccccccccc 0\ttest/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs/activity-stream-chips.png';

    test('a REMOVED golden changes the digest — the falsifier class that once exited 0', () => {
        const full    = [goldenA, goldenB, goldenC].join('\n'),
              removed = [goldenA, goldenC].join('\n');

        expect(digestListing(full)).not.toBe(digestListing(removed))
    });

    test('a rewritten golden (same path, new blob id) changes the digest', () => {
        const swapped = goldenB.replace(/b{40}/, 'd'.repeat(40));

        expect(digestListing([goldenA, goldenB].join('\n'))).not.toBe(digestListing([goldenA, swapped].join('\n')))
    });

    test('listing order carries no meaning — git output ordering can never fake drift', () => {
        expect(digestListing([goldenA, goldenB, goldenC].join('\n')))
            .toBe(digestListing([goldenC, goldenA, goldenB].join('\n')))
    });

    test('diffStamp names exactly the drifted scopes; identical maps read fresh', () => {
        const
            paths   = ['apps/agentos', 'test/playwright/visual/__screenshots__/FleetCockpitVisual.spec.mjs'],
            stamp   = {engine: 'e1', inputs: {[paths[0]]: 'x', [paths[1]]: digestListing([goldenA, goldenB].join('\n'))}},
            current = {engine: 'e1', inputs: {[paths[0]]: 'x', [paths[1]]: digestListing([goldenA].join('\n'))}};

        expect(diffStamp(stamp, {engine: 'e1', inputs: {...stamp.inputs}}, paths)).toEqual([]);
        expect(diffStamp(stamp, current, paths)).toEqual([paths[1]])
    });

    test('the engine axis reports as its own named row', () => {
        const inputs = {'apps/agentos': 'same'};

        expect(diffStamp({engine: 'old', inputs}, {engine: 'new', inputs}, ['apps/agentos']))
            .toEqual(['package-lock.json → node_modules/neo.mjs (engine version)'])
    });

    test('the design-carve scope contract: SPEC documents never move the style digest; style-owning files still do', () => {
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
        // contract digest to be UNCHANGED while the old unfiltered scope drifts. Cleaned up in
        // finally so the index leaves the test exactly as it entered.
        const witnessPath = 'apps/agentos/design/__scope-witness__.html';

        try {
            const blob = execSync('git hash-object -w --stdin', {input: '<!-- scope witness -->', encoding: 'utf8'}).trim();

            execSync(`git update-index --add --cacheinfo 100644,${blob},${witnessPath}`, {encoding: 'utf8'});

            const
                filteredAfter   = scopeListing(agentosScope),
                unfilteredAfter = scopeListing({key: agentosScope.key});

            expect(unfilteredAfter, 'the staged design file IS in the index').toContain(witnessPath);
            expect(filteredAfter,   'the contract listing never sees it').not.toContain(witnessPath);
            expect(digestListing(filteredAfter), 'a design change leaves the contract digest unchanged').toBe(digestListing(filtered));
            expect(digestListing(unfilteredAfter), 'the OLD un-carved scope would have drifted').not.toBe(digestListing(unfiltered))
        } finally {
            execSync(`git update-index --force-remove ${witnessPath}`, {encoding: 'utf8'})
        }

        // the POSITIVE arm: a style-owning delta still changes the contract digest — the gate
        // keeps its teeth (pure, over the digest function the checker uses)
        const withStyleChange = filtered + '100644 ' + 'f'.repeat(40) + ' 0\tapps/agentos/view/fleet/cockpit/Container.mjs\n';

        expect(digestListing(withStyleChange)).not.toBe(digestListing(filtered))
    });

});
