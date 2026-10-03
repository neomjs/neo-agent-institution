import {expect, test} from '../../fixtures.mjs';

/**
 * The Golden Path pane's currency states, rendered by the real shell in both skins.
 *
 * The pane under test is the one the cockpit mounts in its stream tabs. Each state is landed through
 * the cockpit's own write over the Neural Link, and the pane renders it through its bind to the
 * provider leaf, as in production. No fleet server takes part: the bridge knows the verb and the read
 * fails, so the first state the pane shows is the unavailable one, never an empty route.
 *
 * Instants are a fixed older day: ViewerTime's older-day form carries no year, so the goldens read
 * the same on every capture day (the visual-baseline determinism rule).
 */
const
    CAPTURED_AT = '2026-07-05T08:00:00.000Z',
    EXPIRES_AT  = '2026-07-05T20:00:00.000Z',
    LONG_TITLE  = 'Keep the full recommendation title and its supporting context readable when the pane narrows, so the operator can choose the next task without guessing at clipped labels',
    route       = overrides => ({
        schemaVersion: 'computed-route.v1',
        status       : 'fresh',
        freshness    : {status: 'fresh'},
        capturedAt   : CAPTURED_AT,
        expiresAt    : EXPIRES_AT,
        expired      : false,
        routeVersion : 'rv-7',
        provenance   : {producer: 'golden-path-synthesizer', runId: 'run-42', algorithmVersion: 'gp-v2'},
        kind         : 'computed-ranked',
        items        : [
            {id: 'neo#15252', title: 'The five-beat multi-window film', score: 0.91, rank: 1, citations: ['pull:19224', {id: 'issue:19225'}]},
            {id: 'neo-agent-brain#122', title: 'Golden Path v2', score: 0.87, rank: 2, citations: []},
            {id: 'neo#14800', title: 'The 13.2 release notes', score: 0.64, rank: 3, citations: ['pull:19227']}
        ],
        ...overrides
    }),
    wired  = {state: 'wired', capturedAt: CAPTURED_AT},
    rem    = {undigested: 990, digested: 1010, recentCycles: 0},
    handoff = {
        markdown: `## Computed Golden Path (Strategic Recommendation)\n\nCaptured at: 2026-07-05 08:00 UTC\n\n1. **neo#15252**: Score 0.91 (Semantic: 0.61, Structural: 0.30)\n   - *The five-beat multi-window film*\n\n2. **neo#210**: Score 0.87 (Semantic: 0.57, Structural: 0.30)\n   - *${LONG_TITLE}*\n\n> **Routing Guard:** Contradictory immediate routes were filtered by the producer.\n\n### Strategic Interpretation\n\nThe complete producer interpretation is a normal reading surface, not another reduced route list.`,
        mtimeMs: Date.parse('2026-07-05T08:05:00.000Z'), ageMs: 60000, staleAfterMs: 129600000, stale: false, reason: null
    },
    // the section exactly as GoldenPathSynthesizer writes it: heading, captured-at, introduction, a tight list of ten
    PRODUCER_MARKDOWN = [
        '## Computed Golden Path (Strategic Recommendation)\n\nCaptured at: 2026-07-05 08:00 UTC\n',
        'Based on the latest Tri-Vector Synthesis and Topological Priorities, the following tasks are mathematically recommended as the next immediate focus:\n',
        Array.from({length: 10}, (_, i) => `${i + 1}. **issue-${14647 + i}**: Score ${(5 - i / 4).toFixed(2)} (Semantic: 0.83, Structural: 3.33)\n   - *${i ? `Ranked item ${i + 1}, titled as long as the synthesizer's real items run` : 'Institution Cockpit demo: the object-permanent selves tour (v14 home)'}*`).join('\n')
    ].join('\n'),
    STATES = [
        ['current', {capability: wired, handoff, admission: {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: [], staleFacets: []}, route: route(), rem, sources: {}}],
        ['withheld', {capability: wired, handoff: {...handoff, stale: true}, admission: {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: ['issues', 'discussions'], staleFacets: ['issues']}, route: route(), rem, sources: {}}],
        ['degraded', {capability: {...wired, state: 'degraded', reason: 'route-sidecar-missing'}, handoff, admission: null, route: null, rem, sources: {route: {state: 'degraded', reason: 'route-sidecar-missing'}}}],
        ['unavailable', {capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}, handoff: {...handoff, markdown: null, mtimeMs: null, stale: true, reason: 'handoff-not-found'}, admission: null, route: null, rem: null, sources: {}}]
    ];

test.describe('Fleet cockpit — the Golden Path pane (NL)', () => {
    test('complete recommendations stay readable with independent currency states in both skins', async ({page, neuralLink}) => {
        await page.setViewportSize({width: 1600, height: 1100});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const app = await neuralLink.connectToApp('AgentOS');

        await page.getByRole('tab', {name: 'Golden Path', exact: true}).click();

        const pane     = page.locator('.fm-golden-path-pane'),
              currency = pane.locator('.fm-golden-path-currency');

        await expect(pane).toBeVisible({timeout: 10000});
        await expect(currency, 'the failed read answers first, as unavailable').toHaveText(/^Typed route · unavailable · fleet golden path read failed$/);

        const
            [cockpit]     = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
            cockpitState  = await app.getComponent(cockpit.properties.id, ['controller']),
            [viewport]    = await app.queryComponent({className: 'AgentOS.view.Viewport'}, ['id']),
            viewportState = await app.getComponent(viewport.properties.id, ['controller']),
            land          = envelope => app.callMethod(cockpitState.controller.id, 'writeGoldenPath', [envelope]),
            skins         = [['dark', 'neo-theme-neo-dark'], ['light', 'neo-theme-neo-light']],
            settle        = async () => {
                await page.mouse.move(8, 8);
                await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                await page.evaluate(() => document.fonts.ready)
            };

        for (const [state, envelope] of STATES) {
            await land(envelope);
            await expect(currency).toHaveClass(new RegExp(`(?:^|\\s)is-${state}(?:\\s|$)`));
            // the chip's frame is the currency: only a current route earns a solid line
            await expect(currency).toHaveCSS('border-top-style', state === 'current' ? 'solid' : 'dashed');

            for (const [skin, theme] of skins) {
                await app.callMethod(viewportState.controller.id, 'setTheme', [theme, false]);
                await expect(page.locator('.agent-os-viewport')).toHaveClass(new RegExp(`(?:^|\\s)${theme}(?:\\s|$)`));
                await settle();
                await expect(pane).toHaveScreenshot(`golden-path-${state}-${skin}.png`)
            }
        }

        // The primary content is the whole producer section: its captured-at line, score breakdown and
        // interpretation survive without re-rendering the same titles as route cards.
        await land(STATES[0][1]);
        await expect(pane.locator('.fm-golden-path-markdown')).toContainText('Captured at: 2026-07-05 08:00 UTC');
        await expect(pane.locator('.fm-golden-path-markdown')).toContainText('Score 0.91 (Semantic: 0.61, Structural: 0.30)');
        await expect(pane.locator('.fm-golden-path-markdown')).toContainText('Routing Guard: Contradictory immediate routes were filtered by the producer.');
        await expect(pane.locator('.fm-golden-path-markdown')).toContainText('The complete producer interpretation is a normal reading surface');
        const fonts = await pane.locator('.fm-golden-path-markdown').evaluate(el => ({
            body: getComputedStyle(el).fontFamily,
            heading: getComputedStyle(el.querySelector('h2')).fontFamily,
            paragraph: getComputedStyle(el.querySelector('p')).fontFamily
        }));
        expect(fonts.heading).toBe(fonts.body);
        expect(fonts.paragraph).toBe(fonts.body);
        await expect(pane.locator('.fm-golden-path-item')).toHaveCount(0);
        await expect(pane.locator('.fm-golden-path-markdown ol').nth(1)).toHaveAttribute('start', '2');

        await page.setViewportSize({width: 620, height: 1100});
        await settle();
        await expect(pane.locator('.fm-golden-path-markdown')).toContainText(LONG_TITLE);
        const width = await pane.evaluate(el => ({visible: el.clientWidth, content: el.scrollWidth}));
        expect(width.content, 'the full recommendation wraps inside the narrow pane').toBeLessThanOrEqual(width.visible + 1);
        await expect(pane).toHaveScreenshot('golden-path-current-narrow.png');
        // the recommendation column is the pane's one scroll seat; the pane itself never scrolls
        await pane.locator('.fm-golden-path-markdown').evaluate(el => { el.scrollTop = el.scrollHeight });
        await expect(pane.locator('.fm-golden-path-markdown p').last()).toBeInViewport();
        await expect(pane).toHaveScreenshot('golden-path-current-narrow-bottom.png')
    });

    test('the facts row stays on screen at the lower dock\'s default height and only the recommendation column scrolls', async ({page, neuralLink}) => {
        // 1056 × 900 lands the pane at the 988 × 282 the installed vessel measured for the lower split's default
        await page.setViewportSize({width: 1056, height: 900});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});
        const app = await neuralLink.connectToApp('AgentOS');
        await page.getByRole('tab', {name: 'Golden Path', exact: true}).click();

        const
            pane     = page.locator('.fm-golden-path-pane'),
            facts    = pane.locator('.fm-golden-path-facts'),
            column   = pane.locator('.fm-golden-path-markdown'),
            [cockpit]    = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
            cockpitState = await app.getComponent(cockpit.properties.id, ['controller']),
            producerHandoff = {...handoff, markdown: PRODUCER_MARKDOWN},
            boxes        = async () => {
                const paneBox   = await pane.evaluate(el => ({width: el.getBoundingClientRect().width, bottom: el.getBoundingClientRect().bottom, scroll: el.scrollHeight, client: el.clientHeight})),
                      factsBox  = await facts.evaluate(el => el.getBoundingClientRect()),
                      columnBox = await column.evaluate(el => ({scroll: el.scrollHeight, client: el.clientHeight, first: el.querySelector('ol li')?.getBoundingClientRect().bottom ?? null}));
                return {paneBox, factsBox, columnBox}
            };

        await expect(pane).toBeVisible({timeout: 10000});
        // the producer's real worst case: ten items and the null-run sentence, which wraps the facts to two lines
        await app.callMethod(cockpitState.controller.id, 'writeGoldenPath', [{...STATES[0][1], handoff: producerHandoff, route: route({provenance: {producer: 'GoldenPathSynthesizer', runId: null, algorithmVersion: 'golden-path.tri-vector.v1'}})}]);
        await expect(facts.locator('.fm-golden-path-provenance')).toHaveText(/^GoldenPathSynthesizer · run id not recorded by the synthesizer · golden-path\.tri-vector\.v1 · expires /);
        await page.evaluate(() => document.fonts.ready);

        const fold = await boxes();

        expect(Math.round(fold.paneBox.width), 'the pane is the installed default width').toBe(988);
        expect(fold.paneBox.client, 'the lower dock default leaves the pane well under the content height').toBeLessThan(400);
        expect(fold.factsBox.bottom, 'the four facts are fully inside the pane without scrolling').toBeLessThanOrEqual(fold.paneBox.bottom);
        expect(fold.columnBox.first, 'the first ranked item, its reference line and its title, is on screen with the facts').toBeLessThanOrEqual(fold.paneBox.bottom);
        expect(fold.paneBox.scroll, 'the pane itself does not scroll').toBeLessThanOrEqual(fold.paneBox.client + 1);
        expect(fold.columnBox.scroll, 'the recommendation column is the scroll seat').toBeGreaterThan(fold.columnBox.client);

        // a route that recorded its run names it
        await app.callMethod(cockpitState.controller.id, 'writeGoldenPath', [{...STATES[0][1], handoff: producerHandoff}]);
        await expect(facts.locator('.fm-golden-path-provenance')).toHaveText(/run run-42/);

        // a pane taller than its content scrolls nowhere: the column only moves when it has to
        await app.callMethod(cockpitState.controller.id, 'writeGoldenPath', [STATES[0][1]]);
        await page.setViewportSize({width: 1056, height: 2000});
        await page.mouse.move(8, 8);
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

        const tallPane = await boxes();

        expect(tallPane.paneBox.client, 'the taller viewport gives the pane more height than the short fixture needs').toBeGreaterThan(400);
        expect(tallPane.columnBox.scroll).toBeLessThanOrEqual(tallPane.columnBox.client + 1);
        expect(tallPane.paneBox.scroll).toBeLessThanOrEqual(tallPane.paneBox.client + 1)
    });
});
