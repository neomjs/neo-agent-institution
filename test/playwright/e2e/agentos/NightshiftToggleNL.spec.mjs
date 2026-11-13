import {test, expect, loadAgentOsModule} from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    reloadRoster,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

/**
 * @summary Start a loopback Fleet bridge holding one operator presence record. The roster carries it, and
 * `setOperatorPresence` replaces it the way the plane's write does: `since` moves only with the mode, and
 * `changed` says whether readers now see something different.
 * @returns {Promise<Object>} The recorded requests, the bearer, the endpoint and `close`.
 */
async function startPresenceFleetBridge() {
    const
        {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
        requests                 = [];

    let presence = {mode: 'present', since: null, until: null, setBy: null};

    const options = authenticatedFleetOptions({
        dispatch: async request => {
            requests.push(request);

            if (request.method === 'fleetRoster') {
                return fleetE2ESuccess({rows: [], operatorPresence: presence})
            }

            if (request.method === 'setOperatorPresence') {
                const
                    {mode, until = null} = request.params,
                    changed              = mode !== presence.mode || until !== presence.until;

                presence = {mode, since: mode === presence.mode ? presence.since : new Date().toISOString(), until, setBy: '@e2e-operator'};

                return fleetE2ESuccess({operatorPresence: presence, changed, notice: changed ? {messageId: 'MESSAGE:e2e'} : null})
            }

            if (['listAgents', 'fleetStatus', 'fleetRuntimeStatus'].includes(request.method)) {
                return fleetE2ESuccess([])
            }

            return fleetE2EFailure(`fleet: unexpected test method '${request.method}'`)
        }
    });

    const server = await startFleetBridgeServer(options);

    return {
        requests,
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    }
}

/**
 * @summary The product bar's Nightshift toggle on the real mounted composition: the roster's record
 * decides what it shows; a click opens the spans, a span crosses the wire as one `setOperatorPresence`
 * with its `until`, and the toggle shows the record the verb answers; a click while away switches it off
 * without a menu.
 *
 * Run: NEO_AGENTOS_RUNTIME_ROOT=<brain checkout> NEO_NL_PORT=<free port> npx playwright test agentos/NightshiftToggleNL -c test/playwright/playwright.config.e2e.mjs
 */
test.describe('AgentOS product bar — the Nightshift toggle (Neural Link)', () => {
    test.setTimeout(90000);

    test('a span turns Nightshift on and a click turns it off, each one setOperatorPresence, and the toggle shows the answered record', async ({page, neuralLink}) => {
        const fleet = await startPresenceFleetBridge();

        try {
            await page.goto('/apps/agentos/index.html');

            const
                toggle = page.locator('.agent-nightshift-button'),
                menu   = page.locator('.fm-nightshift-menu'),
                writes = () => fleet.requests.filter(request => request.method === 'setOperatorPresence');

            await expect(toggle).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');

            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});
            await reloadRoster(app);

            await expect(toggle).toHaveAttribute('aria-label', 'Nightshift off');
            await expect(toggle).toHaveAttribute('aria-pressed', 'false');

            const clickedAt = Date.now();

            await toggle.click();
            await expect(menu).toBeVisible();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');

            await menu.getByText('For 8 hours', {exact: true}).click();
            await expect(menu).toBeHidden();
            await expect.poll(() => writes().length).toBe(1);

            const {mode, until} = writes()[0].params,
                  spanMs        = Date.parse(until) - clickedAt;

            expect(mode).toBe('away');
            expect(spanMs, 'the span ends 8 hours after the click').toBeGreaterThan(8 * 3_600_000 - 60_000);
            expect(spanMs).toBeLessThan(8 * 3_600_000 + 60_000);

            await expect(toggle).toHaveAttribute('aria-pressed', 'true');
            await expect(toggle).toHaveAttribute('aria-label', /^Nightshift on since \d\d:\d\d, ends \d\d:\d\d$/);
            await expect(toggle).not.toHaveAttribute('aria-haspopup', 'menu');

            // the engine's truth: the toggle holds the plane's record, not a local flip
            const [state] = await app.queryComponent({className: 'AgentOS.view.NightshiftButton'}, ['operatorPresence', 'pressed']);

            expect(state.properties.pressed).toBe(true);
            expect(state.properties.operatorPresence).toMatchObject({mode: 'away', until});

            await toggle.click();
            await expect.poll(() => writes().length).toBe(2);

            expect(writes()[1].params).toEqual({mode: 'present'});
            await expect(toggle).toHaveAttribute('aria-pressed', 'false');
            await expect(toggle).toHaveAttribute('aria-label', 'Nightshift off');
            await expect(menu, 'switching off opens no menu').toBeHidden()
        } finally {
            await fleet.close()
        }
    })
});
