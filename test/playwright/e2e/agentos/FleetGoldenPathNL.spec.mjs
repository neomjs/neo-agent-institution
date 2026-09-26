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
    STATES = [
        ['current', {capability: wired, admission: {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: [], staleFacets: []}, route: route(), rem, sources: {}}],
        ['withheld', {capability: wired, admission: {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: ['issues', 'discussions'], staleFacets: ['issues']}, route: route(), rem, sources: {}}],
        ['degraded', {capability: {...wired, state: 'degraded', reason: 'route-sidecar-missing'}, admission: null, route: null, rem, sources: {route: {state: 'degraded', reason: 'route-sidecar-missing'}}}],
        ['unavailable', {capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}, admission: null, route: null, rem: null, sources: {}}]
    ];

test.describe('Fleet cockpit — the Golden Path pane (NL)', () => {
    test('each currency state leads with its line, in both skins', async ({page, neuralLink}) => {
        await page.setViewportSize({width: 1600, height: 1100});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const app = await neuralLink.connectToApp('AgentOS');

        await page.getByRole('tab', {name: 'Golden Path', exact: true}).click();

        const pane     = page.locator('.fm-golden-path-pane'),
              currency = pane.locator('.fm-golden-path-currency');

        await expect(pane).toBeVisible({timeout: 10000});
        await expect(currency, 'the failed read answers first, as unavailable').toHaveText(/^Unavailable · fleet golden path read failed$/);

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

            for (const [skin, theme] of skins) {
                await app.callMethod(viewportState.controller.id, 'setTheme', [theme, false]);
                await expect(page.locator('.agent-os-viewport')).toHaveClass(new RegExp(`(?:^|\\s)${theme}(?:\\s|$)`));
                await settle();
                await expect(pane).toHaveScreenshot(`golden-path-${state}-${skin}.png`)
            }
        }

        // producer order, not rank order: the current route's items read top to bottom as the producer wrote them
        await land(STATES[0][1]);
        await expect(pane.locator('.fm-golden-path-item-title')).toHaveText([
            'The five-beat multi-window film', 'Golden Path v2', 'The 13.2 release notes'
        ])
    });
});
