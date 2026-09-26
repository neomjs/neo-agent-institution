import {test, expect}             from '@playwright/test';
import {sampleRoster as seedRows} from '../../../fixture/fleetSample.mjs';

const
    STORE_ID = 'seam-roster-store',
    // both paths resolve from the App worker's own file (`node_modules/neo.mjs/src/worker/`)
    GRID     = '../../../../apps/agentos/view/fleet/roster/Container.mjs',
    STORE    = '../../../../apps/agentos/store/FleetRoster.mjs',
    DRIVER   = '../../../../test/playwright/component/apps/agentos/rosterRefill.driver.mjs';

let gridId, tick = 0;

/**
 * @summary The mounted roster after a same-key refill (the MailboxGridSeam pattern): the REAL list,
 * pool and cards in a browser, across the worker boundary — the one layer that shows a doubled DOM
 * node. The cockpit writes the roster in two mutations on its first live admission (`clear()` then
 * `add()` of the surviving keys) and in three on an instance switch (the retirement's `clear()` —
 * nothing is seeded, so nothing reloads — then the next admission's `clear()` and `add()`), and a
 * pooled card retired on the first mutation and re-created under the SAME id on a later one was
 * inserted beside its old node instead of patching it: two cards per `li` after the admission, three
 * after a switch (measured live 2026-09-23). The writer driver (`rosterRefill.driver.mjs`) performs
 * exactly those mutations inside the App worker. The unit
 * arm in `roster/cardIdentity.spec.mjs` holds the mechanism (the retired card asks its parent to
 * forget it); this arm holds the DOM. The grid takes its store as a CONFIG here and owns it: the
 * destroy-and-remount control proves the fixed-id store leaves with the grid.
 *
 * All assertions are counts — no fonts, no colors, no geometry.
 */
test.describe('AgentOS.view.fleet.roster — the mounted list after a same-key refill', () => {
    const
        mount = page => page.evaluate(config => Neo.worker.App.createNeoInstance(config), {
            importPath: GRID,
            ntype     : 'fm-fleet-grid',
            parentId  : 'component-test-viewport',
            height    : 700,
            width     : 1000,
            // the tests' sample rows as the store's data — the grid owns the store, nothing is seeded
            store     : {className: 'AgentOS.store.FleetRoster', id: STORE_ID, data: seedRows}
        }),
        // one writer mutation per call, inside the App worker; every URL is loaded once
        drive = (page, op, extra = '') => page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${DRIVER}?store=${STORE_ID}&op=${op}${extra}&t=${++tick}`);

    test.afterEach(async ({page}) => {
        if (gridId) {
            await page.evaluate(id => Neo.worker.App.destroyNeoInstance(id), gridId);
            gridId = null
        }
    });

    test('clear+add and a switch\'s clear·clear+add of the same keys leave exactly one card per record; the owned store leaves with the grid', async ({page}) => {
        await page.goto('test/playwright/component/apps/empty-viewport/index.html');
        await page.waitForSelector('#component-test-viewport', {state: 'attached'});

        const loaded = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), STORE);

        if (!loaded.success) {
            throw new Error(`FleetRoster load failed: ${loaded.error?.message ?? loaded.error}`);
        }

        let result = await mount(page);

        if (!result.success) {
            throw new Error(`Component creation failed: ${result.error.message}`);
        }

        gridId = result.id;

        const
            items        = page.locator('ul.fm-fleet-cards > li'),
            cards        = page.locator('ul.fm-fleet-cards .fm-agent-card'),
            cardsPerItem = () => items.evaluateAll(lis => lis.map(li => li.querySelectorAll('.fm-agent-card').length)),
            onePerRecord = async why => {
                await expect(items, why).toHaveCount(seedRows.length);
                await expect(cards, `${why} — a retired card must not stay beside its successor`).toHaveCount(seedRows.length);
                expect(await cardsPerItem(), `${why} — exactly one card inside every li`).toEqual(seedRows.map(() => 1))
            };

        // 1. the real pipeline seats one pooled card per record
        await page.waitForSelector('.fm-agent-card', {timeout: 30000});
        await onePerRecord('after the first admission');

        // 2. the first live admission's shape: clear(), then add() of the same keys
        const added = await drive(page, 'clearAdd', `&rows=${encodeURIComponent(JSON.stringify(seedRows))}`);

        expect(added.success, `clear+add drove: ${added.error?.message ?? ''}`).toBe(true);
        await onePerRecord('after clear() + add()');

        // 3. the switch's shape: the retirement's clear() (nothing is seeded, so nothing reloads), then the
        // next profile's admission — clear() and add() of the same keys: three mutations before the pool re-seats
        const switched = await drive(page, 'switchAdd', `&rows=${encodeURIComponent(JSON.stringify(seedRows))}`);

        expect(switched.success, `switch drove: ${switched.error?.message ?? ''}`).toBe(true);
        await onePerRecord('after a switch\'s clear() · clear() + add()');

        // 4. the owned store leaves with the grid: a remount under the same fixed id is clean
        await page.evaluate(id => Neo.worker.App.destroyNeoInstance(id), gridId);
        gridId = null;

        result = await mount(page);

        expect(result.success, `remount under the fixed store id: ${result.error?.message ?? ''}`).toBe(true);
        gridId = result.id;

        await page.waitForSelector('.fm-agent-card', {timeout: 30000});
        await onePerRecord('after the remount')
    })
});
