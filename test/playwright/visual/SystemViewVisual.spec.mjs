import {test, expect} from '@playwright/test';

/**
 * The System keeper-view's visual baseline — the design gate's mechanical guard for the engine
 * room's COLD state: the registry bridge stays unwired in this harness, so the view renders its
 * honest never-answered picture BY DESIGN (head line, empty plane grid, three lanes reading
 * "not observed", the logs region naming its missing verb). A diff here means a DESIGN
 * regression — an off-token color, a lane that lost its rhythm — never content churn.
 *
 * Determinism stack: the config's `reducedMotion: 'reduce'`, `document.fonts.ready` before the
 * capture, the pinned viewport, and the globalSetup's theme-freshness refusal.
 */
test.describe('System keeper-view — visual baseline (the cold engine room)', () => {
    test.setTimeout(120000);

    test.skip(process.env.NEO_TEST_SKIP_CI === 'true', 'visual baselines are rendered-platform artifacts — local harness only');

    test('the cold System view: head · empty planes · three lanes · logs absence', async ({page}) => {
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

        // the rail's own route reaches the keeper-view — the same path an operator's click takes
        await page.evaluate(() => { location.hash = '#/system' });
        await expect(page.locator('.fm-system-view')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-system-fresh')).toHaveText('not observed yet');
        await page.evaluate(() => document.fonts.ready);

        await expect(page.locator('.fm-system-view')).toHaveScreenshot('system-view-cold.png')
    })
});

/**
 * The populated System view at the operator's own window widths (#508): six plane cards, one carrying
 * the installed picture's longest words (a 240+ character diagnosis, a long class) and one an unmapped
 * compose id. The guard is the reading contract: every line on a card wraps inside it, a card is as tall
 * as its content, a column is at least 360 px, and a narrow list is one column. The picture lands through
 * `systemPlanes.driver.mjs` in the wire shape; its age is fixed and every row shares its `generatedAt`,
 * so "observed 12s ago" never churns.
 */
test.describe('System keeper-view — visual baseline (populated plane cards)', () => {
    test.setTimeout(120000);

    test.skip(process.env.NEO_TEST_SKIP_CI === 'true', 'visual baselines are rendered-platform artifacts — local harness only');

    const
        DRIVER        = '../../../../test/playwright/visual/systemPlanes.driver.mjs',
        recoveryClass = 'sustained-memory-saturation: the container stayed above its class threshold across three ' +
            'consecutive observation windows while restart churn stayed under its baseline, so the orchestrator ' +
            'recommends one supervised restart',
        generatedAt   = 1790000000000,
        service       = (serviceKey, serviceClass, overrides = {}) => ({
            serviceKey, status: 'available', observedAt: generatedAt,
            memoryPressure: {disposition: 'below'},
            restartChurn  : {baseline: 'available', detecting: false},
            classification: {serviceClass, appliedMemoryThreshold: 85, sampleCount: 120},
            diagnosis     : {status: 'healthy'},
            ...overrides
        }),
        rows = [
            service('chroma',       'vector-store'),
            service('kb-server',    'knowledge-base'),
            service('mc-server',    'stateful-memory-core-with-sqlite-holder-and-embedding-drain', {
                status        : 'degraded',
                memoryPressure: {disposition: 'at-cap', reason: 'heap observation unavailable: the container reports no cgroup memory limit, so no ratio is computed'},
                restartChurn  : {baseline: 'available', detecting: true},
                diagnosis     : {status: 'recommend', recoveryClass, confidence: 0.92, actionClass: 'supervised-restart'}
            }),
            service('fleet-server', 'fleet-control'),
            service('orchestrator', 'orchestrator'),
            service('neo-agent-os-embedding-gateway-sidecar-canonical-plane-01', 'sidecar')
        ],
        picture = {state: 'ok', ageMs: 12000, observedAt: null, generatedAt, services: rows};

    // 1504: the operator's window (its System list is 1432 px, three columns) · 700: one column
    for (const width of [1504, 700]) {
        test(`the populated System view at a ${width} px window: every card reads in full`, async ({page}) => {
            await page.setViewportSize({width, height: 1257});
            await page.goto('/apps/agentos/index.html');
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            await page.evaluate(() => { location.hash = '#/system' });
            await expect(page.locator('.fm-system-view')).toBeVisible({timeout: 30000});

            const result = await page.evaluate(path => Neo.worker.App.loadModule({path}),
                `${DRIVER}?picture=${encodeURIComponent(JSON.stringify(picture))}&t=${width}`);

            expect(result.success, `systemPlanes driver: ${result.error?.message ?? ''}`).toBe(true);
            await expect(page.locator('.fm-plane-card')).toHaveCount(rows.length, {timeout: 30000});
            await page.evaluate(() => document.fonts.ready);

            await expect(page.locator('.fm-system-view')).toHaveScreenshot(`system-view-populated-${width}.png`)
        })
    }
});
