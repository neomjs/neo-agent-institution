import {test, expect} from '@playwright/test';
import {digestListing, diffStamp} from '../../../../buildScripts/checkVisualBaselines.mjs';

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
});
