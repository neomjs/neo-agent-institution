import {test, expect} from '../../fixtures.mjs';

/**
 * @summary The fleet grid's scroll contract: at a zone height shorter than the roster, the
 * cards region OWNS the vertical scroll (scrollHeight exceeds clientHeight and the last card
 * is reachable) while the health-summary header stays pinned above it. Written as the executable
 * receipt for a review's scroll-owner Required Action — the defect shape it guards is an
 * overflow rule landing on the shared parent (scrolling the header away) instead of the cards
 * region. Boot geometry is stage sizing, not a product assumption; the app stays responsive.
 *
 * Run: npx playwright test agentos/FleetGridScrollNL -c test/playwright/playwright.config.e2e.mjs --workers=1
 */
test.describe('AgentOS FleetGrid — roster scroll ownership', () => {
    test.setTimeout(90000);
    test.use({viewport: {height: 420, width: 1100}});

    test('the cards region scrolls end-to-end at a short zone height with the header pinned', async ({page, neuralLink}) => {
        await page.goto('/apps/agentos/index.html');
        await page.waitForSelector('.fm-agent-card', {timeout: 30000});

        const app = await neuralLink.connectToApp('AgentOS');

        expect(await app.findInstances({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']))
            .toBeTruthy();

        const metrics = await page.evaluate(() => {
            const cards         = document.querySelector('.fm-fleet-cards'),
                  head          = document.querySelector('.fm-fleet-head'),
                  headTopBefore = head.getBoundingClientRect().top;

            cards.scrollTop = cards.scrollHeight;

            // The animated list positions every card by transform (list.plugin.Animate owns the
            // geometry), so DOM order no longer says which card sits lowest: the visually LAST card
            // is the one whose box ends furthest down, read after the scroll.
            const cardsRect = cards.getBoundingClientRect(),
                  lastRect  = [...cards.querySelectorAll('.fm-agent-card')]
                      .map(card => card.getBoundingClientRect())
                      .reduce((lowest, rect) => rect.bottom > lowest.bottom ? rect : lowest);

            return {
                clientHeight  : cards.clientHeight,
                headBottom    : head.getBoundingClientRect().bottom,
                headTopAfter  : head.getBoundingClientRect().top,
                headTopBefore,
                lastCardBottom: lastRect.bottom,
                lastCardTop   : lastRect.top,
                regionBottom  : cardsRect.bottom,
                regionTop     : cardsRect.top,
                scrollHeight  : cards.scrollHeight
            }
        });

        // the roster overflows the region and the region owns the scroll
        expect(metrics.scrollHeight, 'the 10-resident roster must overflow the cards region')
            .toBeGreaterThan(metrics.clientHeight);

        // the LAST card is reachable: after scrolling to the bottom it lies inside the region
        expect(metrics.lastCardTop, 'the last card must scroll into view').toBeLessThan(metrics.regionBottom);
        expect(metrics.lastCardBottom).toBeLessThanOrEqual(metrics.regionBottom + 1);

        // the health-summary header stayed pinned: its position is identical before and after
        // the scroll — the scroll moved the roster, never the summary
        expect(metrics.headTopAfter, 'the summary header must not move with the scroll')
            .toBe(metrics.headTopBefore);
        // "above the roster" is the cards REGION's top edge, not the lowest card's: at this stage
        // height the region is shorter than one 126px card row, so the reachable last card is
        // legitimately clipped at the region's top while its bottom sits on the region's bottom.
        expect(metrics.headBottom, 'the summary header must stay visible above the roster')
            .toBeLessThanOrEqual(metrics.regionTop)
    })
});
