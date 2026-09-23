import {test, expect} from '@playwright/test';

let gridId;

/**
 * @summary The mounted roster after a same-key refill (the MailboxGridSeam pattern): the REAL list,
 * pool and cards in a browser, across the worker boundary — the one layer that shows a doubled DOM
 * node. The cockpit writes the roster in two mutations (`clear()`, then `add()` of the surviving
 * keys) on its first live admission and on every instance switch; a pooled card retired on the
 * first mutation and re-created under the SAME id on the second was inserted beside its old node
 * instead of patching it: two cards per `li` after the admission, three after a switch (measured
 * live 2026-09-23). The unit arm in `roster/cardIdentity.spec.mjs` holds the mechanism (the retired
 * card asks its parent to forget it); this arm holds the DOM.
 *
 * All assertions are counts — no fonts, no colors, no geometry.
 */
test.describe('AgentOS.view.fleet.roster — the mounted list after a same-key refill', () => {
    const rows = () => ['alpha', 'bravo', 'charlie'].map((name, i) => ({
        agentId       : `agent-${name}`,
        displayName   : `Agent ${name}`,
        githubUsername: `neo-agent-${name}`,
        state         : 'ok',
        tierRank      : i
    }));

    test.afterEach(async ({page}) => {
        if (gridId) {
            await page.evaluate(id => Neo.worker.App.destroyNeoInstance(id), gridId);
            gridId = null
        }
    });

    test('a refill with the same keys leaves exactly one card per record — the retired card takes its node with it', async ({page}) => {
        await page.goto('test/playwright/component/apps/empty-viewport/index.html');
        await page.waitForSelector('#component-test-viewport', {state: 'attached'});

        // the provider-hosted store class, loaded beside the grid so the config can name it
        const loaded = await page.evaluate(() => Neo.worker.App.loadModule({path: '../../../../apps/agentos/store/FleetRoster.mjs'}));

        if (!loaded.success) {
            throw new Error(`FleetRoster load failed: ${loaded.error?.message ?? loaded.error}`);
        }

        const result = await page.evaluate(config => Neo.worker.App.createNeoInstance(config), {
            importPath: '../../../../apps/agentos/view/fleet/roster/Container.mjs',
            ntype     : 'fm-fleet-grid',
            parentId  : 'component-test-viewport',
            height    : 700,
            width     : 1000,
            store     : {className: 'AgentOS.store.FleetRoster', id: 'seam-roster-store', autoLoad: false, data: rows()}
        });

        if (!result.success) {
            throw new Error(`Component creation failed: ${result.error.message}`);
        }

        gridId = result.id;

        const
            items = page.locator('ul.fm-fleet-cards > li'),
            cards = page.locator('ul.fm-fleet-cards .fm-agent-card'),
            cardsPerItem = () => items.evaluateAll(lis => lis.map(li => li.querySelectorAll('.fm-agent-card').length));

        // 1. the real pipeline seats one pooled card per record
        await page.waitForSelector('.fm-agent-card', {timeout: 30000});
        await expect(items).toHaveCount(3);
        await expect(cards).toHaveCount(3);

        // 2. the writers' shape: re-setting the store's data clears every record and adds the same
        //    keys back — one mutation removes, the next re-adds
        const refilled = await page.evaluate(data => Neo.worker.App.setConfigs({id: 'seam-roster-store', data}), rows());

        expect(refilled.success, 'the store took the refill').toBe(true);

        await expect(items).toHaveCount(3);
        await expect(cards, 'one card per record — a retired card must not stay beside its successor').toHaveCount(3);
        expect(await cardsPerItem(), 'exactly one card inside every li').toEqual([1, 1, 1]);

        // 3. a second refill doubles nothing either — every switch is another refill
        await page.evaluate(data => Neo.worker.App.setConfigs({id: 'seam-roster-store', data}), rows());

        await expect(items).toHaveCount(3);
        await expect(cards).toHaveCount(3);
        expect(await cardsPerItem()).toEqual([1, 1, 1])
    })
});
