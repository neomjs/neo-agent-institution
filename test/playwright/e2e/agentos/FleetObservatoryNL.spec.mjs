import {expect, test} from '../../fixtures.mjs';

/**
 * The Observatory keeper-view, driven by the real shell over the Neural Link: a current route lands through
 * the cockpit's own write and the canvas worker draws it — the renderer's own statistics say what it
 * holds and how many frames it drew; a drag orbits and the wheel zooms through the DOM → App Worker →
 * canvas-worker path; an idle second draws nothing; withheld keeps the scene, degraded clears it. No
 * fleet server takes part: the first state the pane shows is the unavailable one.
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
        // three items, three distinct citations: six nodes, three edges, a route of three
        items        : [
            {id: 'neo#15252', title: 'The five-beat multi-window film', score: 0.91, rank: 1, citations: ['pull:19224', {id: 'issue:19225'}]},
            {id: 'neo-agent-brain#122', title: 'Golden Path v2', score: 0.87, rank: 2, citations: []},
            {id: 'neo#14800', title: 'The 13.2 release notes', score: 0.64, rank: 3, citations: ['pull:19227']}
        ],
        ...overrides
    }),
    wired    = {state: 'wired', capturedAt: CAPTURED_AT},
    rem      = {undigested: 990, digested: 1010, recentCycles: 0},
    current  = {capability: wired, admission: {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: [], staleFacets: []}, route: route(), rem, sources: {}},
    withheld = {capability: wired, admission: {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: ['issues', 'discussions'], staleFacets: ['issues']}, route: route(), rem, sources: {}},
    degraded = {capability: {...wired, state: 'degraded', reason: 'route-sidecar-missing'}, admission: null, route: null, rem, sources: {route: {state: 'degraded', reason: 'route-sidecar-missing'}}};

test.describe('Agent OS — the Observatory keeper-view (NL)', () => {
    test('a current route lands as the scene the canvas worker draws; drag orbits, wheel zooms, idle draws nothing; withheld keeps the scene, degraded clears it', async ({page, neuralLink}) => {
        await page.setViewportSize({width: 1600, height: 1100});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const app = await neuralLink.connectToApp('AgentOS');

        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();

        const
            pane     = page.locator('.fm-observatory-pane'),
            currency = pane.locator('.fm-observatory-currency'),
            hover    = pane.locator('.fm-observatory-hover');

        await expect(pane).toBeVisible({timeout: 10000});
        await expect(currency, 'cold, the read is unavailable').toHaveText(/^Unavailable · /);
        await expect(hover, 'the gesture hint stands in for the hovered node').toHaveText('drag orbits · wheel zooms');

        const
            [cockpit]    = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
            cockpitState = await app.getComponent(cockpit.properties.id, ['controller']),
            [canvas]     = await app.queryComponent({className: 'AgentOS.view.fleet.goldenpath.ObservatoryCanvas'}, ['id']),
            land         = envelope => app.callMethod(cockpitState.controller.id, 'writeGoldenPath', [envelope]),
            stats        = () => app.callMethod(canvas.properties.id, 'readStats', []),
            settle       = async () => {
                await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                await page.waitForTimeout(400)
            };

        await land(current);
        await expect(currency).toHaveText(/^Current · captured .+ · 3 items$/);
        await settle();

        const drawn = await stats();

        expect(drawn.currency).toBe('current');
        expect(drawn.counts).toEqual({nodes: 6, edges: 3, route: 3});
        expect(drawn.canvas[0], 'the drawing buffer is sized').toBeGreaterThan(0);

        const [cssWidth, ratio] = await pane.locator('canvas').evaluate(node => [node.getBoundingClientRect().width, window.devicePixelRatio]);

        expect(Math.abs(drawn.canvas[0] - cssWidth * ratio), 'the drawing buffer follows the host pixel ratio').toBeLessThanOrEqual(1);
        expect(drawn.frames).toBeGreaterThan(0);
        expect(drawn.camera.touched).toBe(false);

        await page.waitForTimeout(1000);

        const idle = await stats();

        expect(idle.frames, 'idle draws nothing').toBe(drawn.frames);

        // drag orbits: the pointer takes the camera through the canvas's own listeners
        const rect = await pane.locator('canvas').boundingBox();

        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.mouse.move(rect.x + rect.width / 2 + 120, rect.y + rect.height / 2 + 30, {steps: 8});
        await page.mouse.up();
        await page.waitForTimeout(400);

        const orbited = await stats();

        expect(orbited.camera.yaw).not.toBe(drawn.camera.yaw);
        expect(orbited.camera.pitch).not.toBe(drawn.camera.pitch);
        expect(orbited.camera.touched).toBe(true);
        expect(orbited.frames).toBeGreaterThan(idle.frames);

        // wheel zooms out
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(400);

        const zoomed = await stats();

        expect(zoomed.camera.dist).toBeGreaterThan(orbited.camera.dist);
        expect(zoomed.frames).toBeGreaterThan(orbited.frames);

        await land(withheld);
        await expect(currency).toHaveText(/^Withheld · freshness-sla-breached · last known good route · captured .+ · 3 items$/);
        await settle();

        const dim = await stats();

        expect(dim.currency).toBe('withheld');
        expect(dim.counts).toEqual({nodes: 6, edges: 3, route: 3});
        expect(dim.camera.dist, 'a taken camera keeps its distance across scenes').toBe(zoomed.camera.dist);

        await land(degraded);
        await expect(currency).toHaveText(/^Degraded · route-sidecar-missing$/);
        await settle();

        const cleared = await stats();

        expect(cleared.currency).toBe('degraded');
        expect(cleared.counts).toEqual({nodes: 0, edges: 0, route: 0})
    });

    test('the view keeps its scene across a switch away and back without a second read, and resizes with the window', async ({page, neuralLink}) => {
        await page.setViewportSize({width: 1600, height: 1100});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const app = await neuralLink.connectToApp('AgentOS');

        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();

        const
            currency = page.locator('.fm-observatory-pane .fm-observatory-currency'),
            [cockpit]    = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
            cockpitState = await app.getComponent(cockpit.properties.id, ['controller']),
            [canvas]     = await app.queryComponent({className: 'AgentOS.view.fleet.goldenpath.ObservatoryCanvas'}, ['id']),
            stats        = () => app.callMethod(canvas.properties.id, 'readStats', []);

        await expect(currency, 'cold, the read is unavailable').toHaveText(/^Unavailable · /);
        await app.callMethod(cockpitState.controller.id, 'writeGoldenPath', [current]);
        await expect(currency).toHaveText(/^Current · captured .+ · 3 items$/);
        await page.waitForTimeout(400);

        const before = await stats();

        expect(before.counts).toEqual({nodes: 6, edges: 3, route: 3});

        // a read on the way back would answer unavailable (no fleet server takes part), so a current
        // line after the round trip is a read that did not happen
        await page.getByRole('tab', {name: 'Fleet', exact: true}).click();
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible();
        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();
        await expect(currency).toHaveText(/^Current · captured .+ · 3 items$/);
        await page.waitForTimeout(400);

        const back = await stats();

        expect(back.currency).toBe('current');
        expect(back.counts, 'the scene survives the round trip').toEqual({nodes: 6, edges: 3, route: 3});
        expect(back.canvas).toEqual(before.canvas);

        await page.setViewportSize({width: 1200, height: 800});
        await page.waitForTimeout(600);

        const resized = await stats();

        expect(resized.canvas[0], 'the drawing buffer follows the narrower view').toBeLessThan(back.canvas[0]);
        expect(resized.canvas[1], 'and the shorter one').toBeLessThan(back.canvas[1]);
        expect(resized.counts, 'a resize keeps the scene').toEqual({nodes: 6, edges: 3, route: 3});
        expect(resized.frames, 'the resized surface is drawn').toBeGreaterThan(back.frames)
    });
});
