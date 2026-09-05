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
