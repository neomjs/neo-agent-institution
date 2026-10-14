import {test, expect, loadAgentOsModule, loadNeuralLinkModules} from '../../fixtures.mjs';
import {createFleetWireOffer, FLEET_WIRE_METHODS}               from 'neo-agent-brain/fleet-contract';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    reloadRoster,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const {NeuralLink_DataService} = await loadNeuralLinkModules();

const TEST_AGENT_ID = 'nl-lifecycle-agent';

const WIRED_SOURCES = {
    roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
    repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
    runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
};

/**
 * @summary One production-shaped roster DTO row for the lifecycle witness — wired sources (the
 * card gates its controls on a wired runtime; an unwired row renders disabled controls and the
 * test dies honestly) with the lifecycle state the registry double currently holds.
 * @param {String} state `'stopped'` | `'running'` — the registry-side lifecycle truth.
 * @param {String} [id=TEST_AGENT_ID] The fixture's resident identity.
 * @param {String} [participationStatus='active'] The authoritative participation fact.
 * @returns {Object}
 */
function rosterRow(state, id = TEST_AGENT_ID, participationStatus = 'active') {
    return {
        id,
        displayName: 'Lifecycle Witness',
        engineTag  : 'fixture',
        family     : 'claude',
        avatarUrl  : '',
        participationStatus,
        lifecycle  : {source: 'fleet:runtimeStatus', state, confidence: 'observed'},
        sources    : WIRED_SOURCES
    }
}

/**
 * @summary Start a stateful recording loopback Fleet bridge serving one stopped resident or a
 * twelve-seat cohort (eight running, four benched). A
 * successful `startAgent` flips the registry-side lifecycle to running and `stopAgent` flips it
 * back, so the cockpit's settle-time re-poll renders REGISTRY truth — never an optimistic client
 * flip. `rejectStart` makes the start verb answer a deterministic domain rejection instead
 * (registry state untouched).
 * @param {Object} [options]
 * @param {Boolean} [options.rejectStart=false]
 * @param {Boolean} [options.cohort=false] Serve the header's twelve-seat participation witness.
 * @returns {Promise<Object>} Bridge, recorded requests and a fixture-only unbench actuator.
 */
async function startLifecycleFleetBridge({rejectStart = false, cohort = false} = {}) {
    const
        {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
        requests                 = [],
        ids                      = cohort ? [TEST_AGENT_ID, ...Array.from({length: 11}, (_, index) => `header-seat-${index + 1}`)] : [TEST_AGENT_ID],
        running                  = new Set(cohort ? ids.slice(0, 8) : []),
        benched                  = new Set(cohort ? ids.slice(8) : []);

    const options = authenticatedFleetOptions({
        dispatch: async request => {
            requests.push(request);

            if (request.method === 'startAgent') {
                if (rejectStart) {
                    return fleetE2EFailure('fleet: start rejected by lifecycle witness')
                }

                running.add(request.params);
                return fleetE2ESuccess({id: request.params, state: 'running'})
            }

            if (request.method === 'stopAgent') {
                running.delete(request.params);
                return fleetE2ESuccess({id: request.params, state: 'stopped'})
            }

            if (request.method === 'fleetRoster') {
                return fleetE2ESuccess({rows: ids.map(id => rosterRow(running.has(id) ? 'running' : 'stopped', id, benched.has(id) ? 'operator_benched' : 'active'))})
            }

            if (request.method === 'fleetActivity') {
                return fleetE2ESuccess({capability: {source: 'fleet:test', state: 'wired', confidence: 'observed'}, events: []})
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
        unbench    : () => { const id = ids[8]; benched.delete(id); return id },
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    }
}

/**
 * @summary The retired panel spec's minimal-payload contract, re-homed onto the card path: a
 * lifecycle click crosses the fleet wire as the minimal agent-id operation — a registered wire
 * method carrying ONE string param, with no credential-shaped bytes.
 *
 * Minimal describes the PAYLOAD, never the envelope. Every browser-mode request also carries this
 * realm's versioned protocol offer (`installFleetBridge` sends the full `createFleetWireRequest`
 * result; only shell mode strips it back to method/params), so the offer is asserted through the
 * exported builder rather than a literal — exact equality still rejects any extra key, and the next
 * contract revision moves this expectation without touching the spec.
 * @param {Object} request The recorded loopback fleet request.
 * @param {String} [method='startAgent'] The expected registered lifecycle wire method.
 */
function expectMinimalLifecyclePayload(request, method = 'startAgent') {
    expect(FLEET_WIRE_METHODS).toContain(request.method);
    expect(request).toEqual({
        method,
        params  : TEST_AGENT_ID,
        protocol: createFleetWireOffer()
    });
    expect(typeof request.params).toBe('string');
    expect(JSON.stringify(request.params)).not.toMatch(/credential|pat|token/i)
}

/**
 * @summary Boot the app against the loopback, wire the authenticated bridge through the
 * worker-realm product injector, re-poll, and wait for the wired roster to render.
 * @param {Object} page
 * @param {Object} neuralLink
 * @param {Object} fleet The running loopback bridge.
 * @param {Number} [count=1] The fixture roster size.
 * @returns {Promise<Object>} The Neural Link app handle.
 */
async function bootWiredCockpit(page, neuralLink, fleet, count = 1) {
    await page.goto('/apps/agentos/index.html');
    await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
    await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

    // fail-closed boot → bearer through the worker-realm product injector → sanctioned re-poll
    const app = await neuralLink.connectToApp('AgentOS');
    await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});
    await reloadRoster(app);

    await expect(page.locator('.fm-fleet-title')).toHaveText(`Fleet · ${count} agents`, {timeout: 30000});
    await expect(page.locator('.fm-fleet-cards .fm-agent-card')).toHaveCount(count);

    return app
}

/**
 * @summary Read the mounted grid's bound FleetRoster record for the witness resident through the
 * Neural Link — the Body-side truth the assertions close on.
 * @param {Object} app The Neural Link app handle.
 * @param {String} [agentId=TEST_AGENT_ID] The resident to inspect.
 * @returns {Promise<Object|undefined>}
 */
async function getRosterRecord(app, agentId = TEST_AGENT_ID) {
    const
        stores      = await NeuralLink_DataService.listStores({sessionId: app.sessionId}),
        rosterStore = stores.stores.find(candidate => candidate.model === 'AgentOS.model.FleetAgent');

    expect(rosterStore, 'the FleetRoster store should be registered in the App Worker').toBeTruthy();

    const snapshot = await NeuralLink_DataService.inspectStore({sessionId: app.sessionId, storeId: rosterStore.id, limit: 50});

    return snapshot.items.find(item => item.agentId === agentId)
}

/**
 * @summary The card-path lifecycle contract on the REAL mounted composition (the define-agent
 * rebuild re-homed the lifecycle surface onto the cards; the retired Control-panel NL specs died
 * with their subject and this spec is the card path's own witness): the B4 control-toggle →
 * `lifecycleIntent` → the C2
 * adapter → the authenticated bridge — minimal wire payloads across the FULL power cycle
 * (start-when-off, stop-when-running: the one contextual toggle carrying each verb in turn),
 * registry-truth state advance on success, honest terminal rendering + open retry on rejection,
 * and no credential-shaped bytes on any lifecycle request.
 */
test.describe('AgentOS fleet card lifecycle controls (Neural Link)', () => {
    test.setTimeout(90000);

    test('happy path: the toggle drives the FULL power cycle through the wire; Body state advances only via re-polled registry truth', async ({page, neuralLink}) => {
        const fleet = await startLifecycleFleetBridge();

        try {
            const app = await bootWiredCockpit(page, neuralLink, fleet);

            const
                card   = page.locator('.fm-fleet-cards .fm-agent-card'),
                toggle = card.locator('.fm-card-control-verbs button').first();

            // stopped + wired runtime → the Start affordance (one contextual power toggle)
            await expect(toggle.locator('.fa-play')).toBeVisible();

            await toggle.click();

            // the registry flipped to running; the settle re-poll rendered REGISTRY truth: the
            // toggle is now Stop, and no pending/reason residue survives the settled round-trip
            await expect(toggle.locator('.fa-stop')).toBeVisible({timeout: 15000});
            await expect(card.locator('.fm-card-control-status')).not.toBeVisible();

            // exactly one minimal lifecycle operation crossed the wire
            const starts = fleet.requests.filter(request => request.method === 'startAgent');
            expect(starts).toHaveLength(1);
            expectMinimalLifecyclePayload(starts[0]);

            // the Body-side record landed the re-polled state — settled, honest, credential-free
            const started = await getRosterRecord(app);
            expect(started).toBeTruthy();
            expect(started.state).toBe('ok');
            expect(started.pendingAction ?? null).toBeNull();
            expect(started.controlReason ?? null).toBeNull();

            // ── the Stop leg (the cycle's second half, same contextual toggle): the SAME control
            // now carries the Stop verb — the registry flips back to stopped, and the render
            // advance is again the re-poll's, never the click's
            await toggle.click();

            await expect(toggle.locator('.fa-play')).toBeVisible({timeout: 15000});
            await expect(card.locator('.fm-card-control-status')).not.toBeVisible();

            const stops = fleet.requests.filter(request => request.method === 'stopAgent');
            expect(stops).toHaveLength(1);
            expectMinimalLifecyclePayload(stops[0], 'stopAgent');

            // the record returned to the stopped truth with no residue — the cycle is closed
            const stopped = await getRosterRecord(app);
            expect(stopped).toBeTruthy();
            expect(stopped.state).toBe('off');
            expect(stopped.pendingAction ?? null).toBeNull();
            expect(stopped.controlReason ?? null).toBeNull();

            // credential hygiene across EVERY request recorded over the full cycle
            expect(JSON.stringify(fleet.requests)).not.toMatch(/credential|github_pat|bearer/i)
        } finally {
            await fleet.close()
        }
    });

    test('the fleet button over the wire (#618): it reads the plan it would run, the first Stop press renders the plan and sends nothing, the second sends one stop per planned seat, and the settled roster re-words it', async ({page, neuralLink}) => {
        const fleet = await startLifecycleFleetBridge();

        try {
            const app = await bootWiredCockpit(page, neuralLink, fleet);

            const
                button  = page.locator('.fm-cockpit-bar .fm-fleet-start'),
                summary = page.locator('.fm-fleet-start-summary'),
                stops   = () => fleet.requests.filter(request => request.method === 'stopAgent');

            // one stopped, wired seat: the plan is a start of one
            await expect(button).toHaveText('Start fleet · 1');
            await expect(button.locator('.fa-play')).toBeVisible();

            // the press starts it; the settle re-poll re-words the button from registry truth
            await button.click();
            await expect(button).toHaveText('Stop fleet · 1', {timeout: 15000});
            await expect(button.locator('.fa-stop')).toBeVisible();
            await expect(button).toBeEnabled();
            await expect(summary).toHaveText('1\u00a0started');

            // Individual controls must replace the fleet command's receipt with current state.
            const toggle = page.locator('.fm-fleet-cards .fm-card-control-verbs button').first();
            await toggle.click();
            await expect(button).toHaveText('Start fleet · 1', {timeout: 15000});
            await expect(summary).toHaveText('0\u00a0started');
            expect((await getRosterRecord(app)).state).toBe('off');

            await toggle.click();
            await expect(button).toHaveText('Stop fleet · 1', {timeout: 15000});
            await expect(summary).toHaveText('1\u00a0started');
            expect((await getRosterRecord(app)).state).toBe('ok');
            expect(stops()).toHaveLength(1);

            // the first Stop press: the plan where the summaries live, the chip the second press, nothing sent
            await button.click();
            await expect(button).toHaveText('Stop fleet · press again');
            await expect(summary).toHaveText('Stop fleet · 1\u00a0seat: Lifecycle Witness');
            expect(stops()).toHaveLength(1);

            // the second press sends one stop per planned seat; the re-poll re-words the button
            await button.click();
            await expect(button).toHaveText('Start fleet · 1', {timeout: 15000});
            await expect(summary).toHaveText('0\u00a0started');
            expect(stops()).toHaveLength(2);
            expectMinimalLifecyclePayload(stops()[1], 'stopAgent');
            expect(JSON.stringify(fleet.requests)).not.toMatch(/credential|github_pat|bearer/i)
        } finally {
            await fleet.close()
        }
    });

    test('unbenching one stopped seat updates the live excluded count and start plan over the same admitted roster', async ({page, neuralLink}, testInfo) => {
        const fleet = await startLifecycleFleetBridge({cohort: true});

        try {
            const app = await bootWiredCockpit(page, neuralLink, fleet, 12),
                  button = page.locator('.fm-cockpit-bar .fm-fleet-start'),
                  summary = page.locator('.fm-fleet-start-summary');

            await expect(button).toHaveText('Stop fleet · 8');
            await expect(summary).toHaveText('8\u00a0started · 4\u00a0excluded');

            const unbenchedId = fleet.unbench();
            await reloadRoster(app);

            await expect(button).toHaveText('Start fleet · 1');
            await expect(summary).toHaveText('8\u00a0started · 3\u00a0excluded');
            expect((await getRosterRecord(app, unbenchedId))).toMatchObject({state: 'off', participationStatus: 'active'});
            const [header] = await app.queryComponent({reference: 'fleet-start-summary'}, ['text']);
            expect(header.properties.text).toBe('8\u00a0started · 3\u00a0excluded');
            expect(fleet.requests.filter(request => ['startAgent', 'stopAgent'].includes(request.method))).toHaveLength(0);

            for (const width of [1280, 800, 560]) {
                await page.setViewportSize({width, height: 720});
                await expect(summary).toBeVisible();
                await expect(button).toBeVisible();
                const [summaryRect, buttonRect] = await Promise.all([summary.boundingBox(), button.boundingBox()]);
                expect(summaryRect.x + summaryRect.width).toBeLessThanOrEqual(width);
                expect(buttonRect.x + buttonRect.width).toBeLessThanOrEqual(width);
                expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
                await page.locator('.fm-cockpit-bar').screenshot({path: testInfo.outputPath(`fleet-header-${width}.png`)})
            }
        } finally {
            await fleet.close()
        }
    });

    test('rejected path: the reason renders on the card, no fake success, and the retry stays open', async ({page, neuralLink}) => {
        const fleet = await startLifecycleFleetBridge({rejectStart: true});

        try {
            const app = await bootWiredCockpit(page, neuralLink, fleet);

            const
                card   = page.locator('.fm-fleet-cards .fm-agent-card'),
                toggle = card.locator('.fm-card-control-verbs button').first();

            await expect(toggle.locator('.fa-play')).toBeVisible();

            await toggle.click();

            // the honest terminal render: the domain rejection's kind + reason, verbatim — never a
            // fake success, never a silent swallow
            await expect(card.locator('.fm-card-control-status')).toContainText(
                '⚠ rejected: fleet: start rejected by lifecycle witness', {timeout: 15000}
            );

            // no success-driven re-poll fired: the registry was never mutated, so the card still
            // renders the stopped truth with the retry affordance OPEN (enabled Start toggle)
            await expect(toggle.locator('.fa-play')).toBeVisible();
            await expect(toggle).toBeEnabled();

            // the attempt crossed the wire exactly once, still minimal
            const starts = fleet.requests.filter(request => request.method === 'startAgent');
            expect(starts).toHaveLength(1);
            expectMinimalLifecyclePayload(starts[0]);

            // Body-side truth: state unchanged, the terminal reason held on the record (kind +
            // action), pending cleared — the applyRecord matrix's terminal-kind contract
            const record = await getRosterRecord(app);
            expect(record).toBeTruthy();
            expect(record.state).toBe('off');
            expect(record.pendingAction ?? null).toBeNull();
            expect(record.controlReason).toMatchObject({action: 'start', kind: 'rejected'});
            await expect(page.locator('.fm-fleet-start-summary')).toHaveText('0\u00a0started');
            await expect(page.locator('.fm-fleet-start-summary')).toHaveAttribute('title', /start rejected by lifecycle witness/);

            expect(JSON.stringify(fleet.requests)).not.toMatch(/credential|github_pat|bearer/i)
        } finally {
            await fleet.close()
        }
    });
});
