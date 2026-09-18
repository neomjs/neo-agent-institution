import {departedWindowSends, test, expect} from '../../fixtures.mjs';

/**
 * @summary Normalizes a one-match Neural Link component query without weakening a missing match.
 * @param {Object|Object[]} value Query result.
 * @returns {Object|null} First component or null.
 */
function first(value) {
    return (Array.isArray(value) ? value : [value]).filter(Boolean)[0] ?? null
}

/**
 * @summary The tabs node a dock document places an item in, or null for a catalog-only item.
 * @param {Object} document A `neo.dock.zone.v1` document.
 * @param {String} itemId
 * @returns {String|null}
 */
function tabsOf(document, itemId) {
    return Object.entries(document?.nodes ?? {}).find(([, node]) => node.type === 'tabs' && node.items?.includes(itemId))?.[0] ?? null
}

/**
 * @summary A perspective captured while the inspector is away in its own window files the
 * inspector in its home — the live document spells "away" exactly like "closed", and a record of
 * that once restored a cockpit without its inspector. Both halves of the round trip: applied
 * while the inspector is still away, the capture leaves it in its window; applied after it came
 * home and a duty railed it, the capture brings it back, mounted.
 *
 * Run: npx playwright test agentos/FleetPerspectiveCaptureVesseledNL -c test/playwright/playwright.config.e2e.mjs --workers=1
 */
test.describe('AgentOS FleetCockpit — a perspective captured while a pane is in its vessel', () => {
    test.setTimeout(120000);

    test('files the inspector in its home: it stays away while away, and comes back on a later restore', async ({page, neuralLink, workerErrors}) => {
        workerErrors.expect(departedWindowSends);

        await page.goto('/apps/agentos/index.html');
        await page.waitForSelector('.fm-agent-card', {timeout: 30000});

        const app       = await neuralLink.connectToApp('AgentOS'),
              cockpit   = first(await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id', 'windowId'])),
              cockpitId = cockpit?.id,
              inspector = async () => first(await app.queryComponent(
                  {className: 'AgentOS.view.fleet.detail.Container'}, ['id', 'mounted', 'windowId']
              )),
              liveHome  = async () => tabsOf(await app.callMethod(cockpitId, 'getDockZoneDocument'), 'detail');

        expect(cockpitId, 'the FleetCockpit must exist in the bound App Worker').toBeTruthy();

        // one selection act reveals the inspector
        await page.locator('.fm-fleet-cards > .neo-list-item').first().click();

        await expect.poll(async () => (await inspector())?.properties?.mounted, {
            message: 'the inspector must be live before it leaves', timeout: 15000, intervals: [100, 250]
        }).toBe(true);

        const home     = await liveHome(),
              revealed = await inspector();

        expect(home, 'the inspector has a home to return to').toBeTruthy();

        const popupPromise = page.waitForEvent('popup', {timeout: 30000}),
              poppedOut    = await app.callMethod(cockpitId, 'popOutPane', ['detail']),
              popup        = await popupPromise;

        expect(poppedOut).toMatchObject({detached: true, errors: []});

        await expect.poll(() => app.callMethod(cockpitId, 'isVesselOwned', ['detail']), {
            message: 'the vessel must own the inspector', timeout: 15000, intervals: [100, 250]
        }).toBe(true);

        expect(await liveHome(), 'the live document places an away pane nowhere').toBeNull();

        // the capture verb, while the inspector is away
        expect(await app.callMethod(cockpitId, 'controller.capturePerspective', ['Away'])).toMatchObject({saved: true, errors: []});

        const stored = await app.callMethod(cockpitId, 'perspectiveStore.getPerspective', ['Away']);

        expect(tabsOf(stored?.layout?.dockZone, 'detail'), 'the record files the inspector in its home').toBe(home);

        // applied while still away: the document seats it, the vessel keeps the live pane
        expect(await app.callMethod(cockpitId, 'activatePerspective', ['Away'])).toMatchObject({switched: true, errors: []});

        await expect.poll(async () => {
            const away = await inspector();

            return {
                id     : away?.id,
                owned  : await app.callMethod(cockpitId, 'isVesselOwned', ['detail']),
                placed : await liveHome(),
                windowed: away?.properties?.windowId !== cockpit.properties.windowId
            }
        }, {
            message: 'a restore must not steal a pane from its vessel', timeout: 15000, intervals: [100, 250]
        }).toEqual({id: revealed.id, owned: true, placed: home, windowed: true});

        const closed   = popup.waitForEvent('close', {timeout: 30000}),
              returned = await app.callMethod(cockpitId, 'returnPane', ['detail']);

        expect(returned).toMatchObject({returned: true, errors: []});
        await closed;

        await expect.poll(() => app.callMethod(cockpitId, 'isVesselOwned', ['detail']), {
            message: 'nothing owned after the return', timeout: 15000, intervals: [100, 250]
        }).toBe(false);

        // a duty rails the inspector, then the capture brings it back
        expect(await app.callMethod(cockpitId, 'activatePerspective', ['Overview'])).toMatchObject({switched: true});
        expect(await app.callMethod(cockpitId, 'activatePerspective', ['Away'])).toMatchObject({switched: true, errors: []});

        await expect.poll(async () => {
            const back = await inspector();

            return {
                id      : back?.id,
                mounted : back?.properties?.mounted,
                placed  : await liveHome(),
                windowId: back?.properties?.windowId
            }
        }, {
            message: 'the restored capture must seat the same inspector, mounted, in the cockpit window', timeout: 15000, intervals: [100, 250]
        }).toEqual({id: revealed.id, mounted: true, placed: home, windowId: cockpit.properties.windowId})
    })
});
