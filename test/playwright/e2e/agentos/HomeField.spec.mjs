import {test, expect} from '../../fixtures.mjs';

/**
 * @summary AC-1 of #244, in the browser: Home's field draws on the canvas worker, and its renderer's own statistics
 * say so. Under `no-preference` the field moves, drawing frame after frame; once the host prefers reduced motion,
 * the next mount reads the motion vocabulary's collapsed `--motion-base` and the field holds one still frame. The
 * cockpit boots without a fleet server, so the roster never answers and the field draws no marks (AC-2's cold half).
 * The Home field driver reads the statistics in the App worker and throws with them when the field contradicts the
 * state it is asked to hold.
 *
 * Run: NEO_E2E_PORT=8121 npx playwright test agentos/HomeField -c test/playwright/playwright.config.e2e.mjs --workers=1
 *
 * @see apps/agentos/canvas/Home.mjs
 * @see test/playwright/e2e/agentos/homeField.driver.mjs
 */
const FIELD_DRIVER = '../../../../test/playwright/e2e/agentos/homeField.driver.mjs';

test.describe('AgentOS Home — the field draws on the canvas worker and idles under reduced motion (#244)', () => {
    test.setTimeout(90000);

    test('the field moves under no-preference, holds one still frame once reduced motion is preferred, and draws no marks while the roster has not answered', async ({page}) => {
        let tick = 0;

        const
            home   = page.locator('.fm-home-view'),
            settle = async query => page.evaluate(async path => {
                const {error, success} = await Neo.worker.App.loadModule({path});

                return {error: error?.message ?? null, success}
            }, `${FIELD_DRIVER}?${query}&t=${++tick}`),
            openTab = async name => page.getByRole('tab', {name, exact: true}).click();

        await page.emulateMedia({reducedMotion: 'no-preference'});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        await openTab('Home');
        await expect(home.locator('.fm-home-canvas')).toBeVisible();

        const moving = await settle('still=false&marks=none');

        expect(moving.success, `the field moves: ${moving.error}`).toBe(true);

        await page.emulateMedia({reducedMotion: 'reduce'});
        await openTab('Fleet');
        await expect(home).toBeHidden();
        await openTab('Home');
        await expect(home.locator('.fm-home-canvas')).toBeVisible();

        const still = await settle('still=true&marks=none');

        expect(still.success, `the field holds still: ${still.error}`).toBe(true)
    })
});
