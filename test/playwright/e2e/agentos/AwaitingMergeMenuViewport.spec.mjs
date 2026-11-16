import {expect, test}      from '@playwright/test';
import {landFleetOpenWork} from '../../fixtures.mjs';
import {sampleOpenWork}    from '../../fixture/fleetSample.mjs';

const queue = Array.from({length: 33}, (_, index) => ({
    ...sampleOpenWork.awaitingMerge[0],
    number: 30001 + index,
    title : `Pull request ${index + 1} with a long title that wraps across two lines in the merge queue`
}));

for (const skin of ['dark', 'light']) {
    test(`the long awaiting-merge menu stays on screen and scrolls to the last link in ${skin}`, async ({page}, testInfo) => {
        const chip  = page.locator('.fm-fleet-head .fm-awaiting-merge'),
              menu  = page.getByRole('menu', {name: 'Pull requests awaiting your merge'}),
              links = menu.getByRole('link');

        await page.setViewportSize({width: 1600, height: 900});
        await page.context().route('https://github.com/neomjs/neo/pull/*', route => route.fulfill({body: 'Test pull request'}));
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});
        await landFleetOpenWork(page, {...sampleOpenWork, awaitingMerge: queue});

        if (skin === 'light') {
            await page.locator('.agent-theme-button').click();
            await expect(page.locator('.agent-os-viewport.neo-theme-neo-light')).toBeVisible()
        }

        for (const size of [{width: 1600, height: 900}, {width: 1024, height: 640}]) {
            await page.setViewportSize(size);
            await chip.click();
            await expect(menu).toHaveClass(/neo-aligned-/);
            await expect(links).toHaveCount(queue.length);

            const geometry = await menu.evaluate(el => {
                const {x, y, right, bottom, width, height} = el.getBoundingClientRect();
                return {x, y, right, bottom, width, height, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
                    pageWidth: document.documentElement.scrollWidth}
            });

            await testInfo.attach(`bounds-${size.width}`, {body: JSON.stringify(geometry), contentType: 'application/json'});
            expect(geometry.x).toBeGreaterThanOrEqual(-1);
            expect(geometry.y).toBeGreaterThanOrEqual(-1);
            expect(geometry.right).toBeLessThanOrEqual(size.width + 1);
            expect(geometry.bottom).toBeLessThanOrEqual(size.height + 1);
            expect(geometry.width).toBeGreaterThanOrEqual(240);
            expect(geometry.pageWidth).toBeLessThanOrEqual(size.width + 1);
            expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);

            await expect(links.first()).toHaveAttribute('href', 'https://github.com/neomjs/neo/pull/30001');
            await expect(links.first()).toBeInViewport({ratio: 1});
            await links.first().click({trial: true});
            await menu.hover();
            await page.mouse.wheel(0, geometry.scrollHeight);
            await expect(links.last()).toBeInViewport({ratio: 1});
            await expect(links.last()).toHaveAttribute('href', 'https://github.com/neomjs/neo/pull/30033');
            await testInfo.attach(`last-link-${size.width}`, {body: await page.screenshot(), contentType: 'image/png'});
            const popupOpened = page.waitForEvent('popup');
            await links.last().click();
            const popup = await popupOpened;
            await expect(popup).toHaveURL('https://github.com/neomjs/neo/pull/30033');
            await popup.close();
            await expect(menu).toBeHidden()
        }
    })
}
