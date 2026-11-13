import {test, expect, loadAgentOsModule} from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const OPERATOR = '@e2e-operator';

/**
 * A fixture plane with one pull request approved, green and mergeable: the open work's merge queue holds
 * it, and the operator has no open question.
 * @returns {Promise<Object>} The bearer, the endpoint and `close`.
 */
async function startMergeQueueFleet() {
    const
        {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
        options                  = authenticatedFleetOptions({
            dispatch: async request => {
                const observedAt = new Date().toISOString();

                switch (request.method) {
                    case 'resolveViewerIdentity':
                        return fleetE2ESuccess({ok: true, agentIdentityNodeId: OPERATOR});
                    case 'fleetRoster':
                        return fleetE2ESuccess({rows: []});
                    case 'fleetActivity':
                        return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                    case 'fleetOpenWork':
                        return fleetE2ESuccess({
                            state        : 'ok', observedAt, coverage: 'complete', reason: null, seats: {},
                            awaitingMerge: [{
                                repo : 'neomjs/neo', number: 4242, title: 'one lane, ready for the merge',
                                ci   : 'green', mergeable: 'MERGEABLE', draft: false, stale: false, observedAt
                            }],
                            questions: {state: 'ok', count: 0, reason: null}
                        });
                    default:
                        return fleetE2EFailure(`unexpected method: ${request.method}`)
                }
            }
        }),
        server = await startFleetBridgeServer(options);

    return {
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    }
}

/**
 * Boots the app on `route` against the fixture plane and reads the roster, the operator and the open work.
 * @param {Object} options
 * @param {Object} options.fleet      The fixture plane.
 * @param {Object} options.neuralLink The whitebox fixture.
 * @param {Object} options.page
 * @param {String} options.route      `/home` or `/fleet`.
 * @returns {Promise<void>}
 */
async function bootOnFixturePlane({fleet, neuralLink, page, route}) {
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}#${route}`);
    await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

    const app = await neuralLink.connectToApp('AgentOS');
    await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

    const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
    await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
    await app.callMethod(cockpit.properties.id, 'controller.loadOperatorIdentity');
    await app.callMethod(cockpit.properties.id, 'controller.loadOpenWork')
}

/**
 * Home's merge count opens what waits for the operator's merge: a pointer click on `1 merge` moves the route
 * to Fleet and opens the fleet head's list there. The shell drops an inactive view's DOM, so the list can only
 * open once the Fleet cockpit is on screen again.
 *
 * Run: NEO_AGENTOS_RUNTIME_ROOT=<brain checkout> NEO_NL_PORT=<free port> npx playwright test agentos/HomeMergeQueueDoorNL -c test/playwright/playwright.config.e2e.mjs
 */
test.describe('AgentOS Home — the merge count opens the merge queue (#948)', () => {
    test.setTimeout(150000);

    test('a click on Home\'s merge count opens the awaiting-merge list on Fleet', async ({page, neuralLink}) => {
        const fleet = await startMergeQueueFleet();

        try {
            await bootOnFixturePlane({fleet, neuralLink, page, route: '/home'});

            const
                link = page.locator('.fm-home-operator-link.is-merges'),
                list = page.locator('.fm-awaiting-merge-menu');

            await expect(link).toHaveText('1 merge', {timeout: 30000});
            await expect(list, 'the list is closed while Home shows').toHaveCount(0);

            await link.click();

            await expect(page).toHaveURL(/#\/fleet$/);
            await expect(list).toBeVisible({timeout: 10000});
            await expect(list.locator('.fm-awaiting-merge-row')).toHaveCount(1);
            await expect(list.locator('.fm-awaiting-merge-ref')).toHaveText('#4242 · one lane, ready for the merge');
            await expect(page.locator('.fm-awaiting-merge'), 'the head\'s button says the list is open').toHaveAttribute('aria-expanded', 'true')
        } finally {
            await fleet.close()
        }
    });

    // A loaded list opens faster than the shell mounts Fleet back; throttling lets the open win the race (base: 6 of 30 red)
    for (const rate of [8, 16]) test(`under load, the door opens the list after it was opened once on Fleet (CPU ×${rate})`, async ({page, neuralLink}) => {
        const fleet = await startMergeQueueFleet();

        try {
            await bootOnFixturePlane({fleet, neuralLink, page, route: '/fleet'});

            const
                head = page.locator('.fm-awaiting-merge'),
                link = page.locator('.fm-home-operator-link.is-merges'),
                list = page.locator('.fm-awaiting-merge-menu');

            // the operator has used the list on Fleet before: its lazy module is loaded and its menu exists
            await expect(head).toHaveText('1 awaiting merge', {timeout: 30000});
            await head.click();
            await expect(list).toBeVisible({timeout: 10000});
            await page.keyboard.press('Escape');
            await expect(list).toBeHidden();

            await page.evaluate(() => {location.hash = '/home'});
            await expect(link).toHaveText('1 merge', {timeout: 30000});

            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', {rate});

            await link.click();

            await expect(page).toHaveURL(/#\/fleet$/);
            await expect(list).toBeVisible({timeout: 10000});
            await expect(list.locator('.fm-awaiting-merge-ref')).toHaveText('#4242 · one lane, ready for the merge')
        } finally {
            await fleet.close()
        }
    })
});
