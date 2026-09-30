import {test, expect} from '../../fixtures.mjs';

/**
 * @summary In the browser, Home's field draws on the canvas worker, and its renderer's own statistics say so. Under `no-preference` the field moves, drawing frame after frame; once the host prefers reduced motion,
 * the next mount reads the motion vocabulary's collapsed `--motion-base` and the field holds one still frame. The
 * cockpit boots without a fleet server, so the roster never answers and the field draws no marks (AC-2's cold half).
 * The Home field driver reads the statistics in the App worker and throws with them when the field contradicts the
 * state it is asked to hold, or when the rects it is quiet under are not where the hero's lines stand.
 *
 * Run: NEO_E2E_PORT=8121 npx playwright test agentos/HomeField -c test/playwright/playwright.config.e2e.mjs --workers=1
 *
 * @see apps/agentos/canvas/Home.mjs
 * @see test/playwright/e2e/agentos/homeField.driver.mjs
 * @see test/playwright/visual/homeState.driver.mjs
 */
const
    FIELD_DRIVER = '../../../../test/playwright/e2e/agentos/homeField.driver.mjs',
    HOME_DRIVER  = '../../../../test/playwright/visual/homeState.driver.mjs';

let tick = 0;

/**
 * @summary Loads a driver into the App worker, fresh each time, and answers whether it ran through.
 * @param {Object} page
 * @param {String} driver
 * @param {String} query
 * @returns {Promise<{error: String|null, success: Boolean}>}
 */
const load = (page, driver, query) => page.evaluate(async path => {
    const {error, success} = await Neo.worker.App.loadModule({path});

    return {error: error?.message ?? null, success}
}, `${driver}?${query}&t=${++tick}`);

test.describe('AgentOS Home — the field draws on the canvas worker and idles under reduced motion (#244)', () => {
    test.setTimeout(90000);

    test('the field moves under no-preference, holds one still frame once reduced motion is preferred, and draws no marks while the roster has not answered', async ({page}) => {
        const
            home    = page.locator('.fm-home-view'),
            settle  = query => load(page, FIELD_DRIVER, query),
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

test.describe('AgentOS Home — the field is quiet under the hero\'s lines wherever they stand (#365)', () => {
    test.setTimeout(90000);

    test('a reader switch and a resize both move the lines, and the field follows them (AC-2)', async ({page}) => {
        const
            home   = page.locator('.fm-home-view'),
            // the shown lines as the page lays them out
            boxes  = () => home.locator('.fm-home-eyebrow, .fm-home-h1, .fm-home-lede, .fm-home-plane').evaluateAll(nodes => nodes
                .map(node => node.getBoundingClientRect())
                .filter(rect => rect.width && rect.height)
                .map(rect => [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(' '))),
            follow = async surface => {
                const {error, success} = await load(page, FIELD_DRIVER, 'still=false&marks=none');

                expect(success, `${surface}: ${error}`).toBe(true)
            };

        await page.setViewportSize({width: 1392, height: 850});
        await page.emulateMedia({reducedMotion: 'no-preference'});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        await page.getByRole('tab', {name: 'Home', exact: true}).click();
        await expect(home.locator('.fm-home-canvas')).toBeVisible();
        await follow('the returning reader');

        const returning = await boxes();

        expect((await load(page, HOME_DRIVER, 'shellPlaneConfigured=false')).success).toBe(true);
        await expect(home.locator('.fm-home-lede')).toBeVisible();
        await follow('the first-run reader');

        const firstRun = await boxes();

        expect(firstRun, 'the reader switch moves the lines').not.toEqual(returning);

        await page.setViewportSize({width: 1000, height: 850});
        await expect.poll(boxes, {message: 'the resize moves them'}).not.toEqual(firstRun);
        await follow('the resized surface')
    })
});
