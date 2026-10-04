import {test, expect, loadAgentOsModule}                    from '../../fixtures.mjs';
import {createFleetWireResponse, FLEET_WIRE_RESPONSE_STATES} from 'neo-agent-brain/fleet-contract';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    reloadRoster,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const
    TEST_AGENT_ID   = 'nl-memory-agent',
    TEST_CREDENTIAL = 'github_pat_NL_MEMORY_WITNESS_1234abcd';

// the existing agents' memory a host could hold, in the Fleet's `fleetMemoryCandidates` shape
const CANDIDATES = [{
    family     : 'claude',
    source     : '/home/operator/.claude/projects/-work/memory',
    name       : 'Mnemosyne',
    notes      : 12,
    lastChanged: '2026-10-03T18:00:00.000Z'
}, {
    family     : 'codex',
    source     : '/home/operator/.codex/memories',
    name       : 'Hypatia',
    notes      : 3,
    lastChanged: '2026-10-02T09:30:00.000Z'
}];

const WIRED_SOURCES = {
    roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
    repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
    runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
};

// what the Fleet answers to `fleetMemoryCandidates`: only a wired read that finds nothing says "none"
const MEMORY_ANSWERS = {
    wiredEmpty: () => fleetE2ESuccess({capability: {state: 'wired'}, candidates: [], count: 0}),
    unwired   : () => fleetE2ESuccess({capability: {state: 'unavailable', reason: 'memory discovery is not wired on this plane'}, candidates: [], count: 0}),
    degraded  : () => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.degraded, {degraded: 'awaiting-s5', error: "fleet: 'fleetMemoryCandidates' awaits a later slice"}),
    failed    : () => fleetE2EFailure("fleet: 'fleetMemoryCandidates' failed"),
    candidates: candidates => () => fleetE2ESuccess({capability: {state: 'wired'}, candidates, count: candidates.length})
};

// the Brain's refusal of a Start whose consented import did not converge (seatMemoryImport.mjs), as the bridge answers it
const IMPORT_REFUSAL = `agent '${TEST_AGENT_ID}' consented to import its memory from '${CANDIDATES[1].source}', but the source holds no memory to copy. The memory-import step did not converge, so the seat does not start.`;

/**
 * @summary A recording loopback Fleet bridge whose memory answer a spec switches between arms. The roster
 * starts empty, `defineAgent` graduates the agent into it, and `startAgent` answers the import refusal.
 * @param {Function} memory The first `fleetMemoryCandidates` answer.
 * @returns {Promise<{bearerToken: String, close: Function, endpoint: String, memory: Function, requests: Object[]}>}
 */
async function startMemoryFleetBridge(memory) {
    const
        {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
        requests                 = [],
        defined                  = [],
        fleet                    = {memory, requests};

    const rosterRow = agent => ({
        id         : agent.id,
        displayName: agent.githubUsername,
        engineTag  : agent.harnessType,
        family     : 'claude',
        avatarUrl  : '',
        lifecycle  : {source: 'fleet:runtimeStatus', state: 'stopped', confidence: 'observed'},
        sources    : WIRED_SOURCES
    });

    const options = authenticatedFleetOptions({
        dispatch: async request => {
            requests.push(request);

            switch (request.method) {
                case 'fleetMemoryCandidates':
                    return fleet.memory();
                case 'defineAgent': {
                    const {githubUsername, harnessType, memoryImport} = request.params ?? {};

                    defined.push({id: TEST_AGENT_ID, githubUsername, harnessType});
                    return fleetE2ESuccess({id: TEST_AGENT_ID, githubUsername, harnessType, memoryImport, updatedAt: '2026-10-04T00:00:00.000Z'})
                }
                case 'startAgent':
                    return fleetE2ESuccess({status: 'rejected', reason: IMPORT_REFUSAL});
                case 'fleetRoster':
                    return fleetE2ESuccess({rows: defined.map(rosterRow)});
                case 'fleetActivity':
                    return fleetE2ESuccess({capability: {source: 'fleet:test', state: 'wired', confidence: 'observed'}, events: []});
                case 'listAgents':
                case 'fleetStatus':
                case 'fleetRuntimeStatus':
                    return fleetE2ESuccess([]);
                default:
                    return fleetE2EFailure(`fleet: unexpected test method '${request.method}'`)
            }
        }
    });

    const server = await startFleetBridgeServer(options);

    return Object.assign(fleet, {
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    })
}

/**
 * @summary Boot the cockpit, wire it to the fixture Fleet, and open the Add agent zone. The form is built
 * when the zone opens, so it asks the wired Fleet for existing memory.
 * @param {Object} options
 * @param {Object} options.fleet
 * @param {Object} options.neuralLink
 * @param {Object} options.page
 * @returns {Promise<Object>} The visible form's locator.
 */
async function openAddAgent({fleet, neuralLink, page}) {
    await page.goto('/apps/agentos/index.html');
    await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

    const app = await neuralLink.connectToApp('AgentOS');

    await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});
    await reloadRoster(app);

    await page.locator('.neo-dashboard-dock-rail-tab', {hasText: /^\s*Add agent\s*$/i}).first().click();

    const form = page.locator('.fm-add-agent-form:visible');

    await expect(form).toBeVisible({timeout: 30000});
    await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

    return form
}

/**
 * @summary Fill the account fields again: the token field clears on every settle.
 * @param {Object} form
 */
async function fill(form) {
    await form.locator('input[name="githubUsername"]').fill(TEST_AGENT_ID);
    await form.locator('input[type="password"]').fill(TEST_CREDENTIAL)
}

/**
 * @summary Add Agent offers an existing agent's memory only when one exists (#521), on the real mounted
 * cockpit over the authenticated bridge: an unknown is never recorded as "no memory", a candidate is never
 * guessed, the chosen memory reaches `defineAgent`, and a Start the import refuses says why on the card.
 * The captures are the design gate's evidence (AC-5).
 */
test.describe('AgentOS Add agent — existing memory (#521)', () => {
    test.setTimeout(120000);
    test.use({viewport: {width: 1280, height: 800}});

    test('a check that could not answer shows its reason with Retry, only Start fresh records none, and a wired empty read shows nothing (AC-1)', async ({page, neuralLink}) => {
        const fleet = await startMemoryFleetBridge(MEMORY_ANSWERS.failed);

        try {
            const
                form    = await openAddAgent({fleet, neuralLink, page}),
                frame   = form.locator('.fm-add-memory'),
                lead    = frame.locator('.fm-add-memory-lead'),
                retry   = frame.locator('.neo-button', {hasText: 'Retry'}),
                submit  = form.locator('.fm-add-submit'),
                defines = () => fleet.requests.filter(request => request.method === 'defineAgent');

            // a failed read (operation-failed) is unknown, never empty
            await expect(lead).toHaveText("Could not check for existing memory: fleet: 'fleetMemoryCandidates' failed");
            await expect(retry).toBeVisible();
            await expect(frame.locator('.fm-memory-candidates')).toHaveCount(0);
            await test.info().attach('discovery unavailable', {body: await form.screenshot(), contentType: 'image/png'});

            await fill(form);
            await submit.click();

            await expect(form.locator('.fm-add-status.is-rejected')).toHaveText('Existing memory could not be checked. Retry, or choose Start fresh.');
            expect(defines()).toHaveLength(0);

            // the composed service's degraded answer, then an unwired source
            fleet.memory = MEMORY_ANSWERS.degraded;
            await retry.click();
            await expect(lead).toHaveText("Could not check for existing memory: fleet: 'fleetMemoryCandidates' awaits a later slice");

            fleet.memory = MEMORY_ANSWERS.unwired;
            await retry.click();
            await expect(lead).toHaveText('Could not check for existing memory: memory discovery is not wired on this plane');

            // only the operator's own Start fresh records "none"
            await frame.locator('.neo-button', {hasText: 'Start fresh'}).click();
            await fill(form);
            await submit.click();

            await expect(form.locator('.fm-add-status.is-readback-confirmed')).toBeVisible({timeout: 15000});
            expect(defines()).toHaveLength(1);
            expect(defines()[0].params.memoryImport).toBe('none');

            // a wired read that finds nothing shows no frame at all
            fleet.memory = MEMORY_ANSWERS.wiredEmpty;
            await retry.click();
            await expect(frame).toBeHidden()
        } finally {
            await fleet.close()
        }
    });

    test('several candidates wait for a choice, name first; the chosen memory reaches defineAgent, and the card names the Start the import refuses (AC-2, AC-3, AC-4)', async ({page, neuralLink}) => {
        const fleet = await startMemoryFleetBridge(MEMORY_ANSWERS.candidates(CANDIDATES));

        try {
            const
                form    = await openAddAgent({fleet, neuralLink, page}),
                frame   = form.locator('.fm-add-memory'),
                rows    = frame.locator('.fm-memory-candidates .neo-list-item'),
                details = frame.locator('.fm-add-memory-details');

            await expect(frame.locator('.fm-add-memory-lead')).toHaveText('Continue one of these agents\' memory?');
            await expect(rows).toHaveCount(2);
            await expect(rows.nth(0).locator('.fm-memory-candidate-name')).toHaveText('Mnemosyne');
            await expect(rows.nth(0).locator('.fm-memory-candidate-meta')).toContainText('12 notes · last changed');
            await expect(frame.locator('.fm-add-memory-note')).toHaveText('Its notes are copied, never moved; the original stays where it is.');

            // a wrong memory is an identity error: nothing is preselected, and no path rides a row
            await expect(frame.locator('.neo-list-item.neo-selected')).toHaveCount(0);
            await expect(details).toBeHidden();
            await expect(rows).not.toContainText([CANDIDATES[0].source]);
            await test.info().attach('two candidates', {body: await form.screenshot(), contentType: 'image/png'});

            await rows.nth(1).click();
            await expect(rows.nth(1)).toHaveClass(/\bneo-selected\b/);

            await details.locator('summary').click();
            await expect(details.locator('.fm-add-memory-source')).toHaveText(CANDIDATES[1].source);
            await test.info().attach('two candidates, one chosen, Details open', {body: await form.screenshot(), contentType: 'image/png'});

            await fill(form);
            await form.locator('.fm-add-submit').click();
            await expect(form.locator('.fm-add-status.is-readback-confirmed')).toBeVisible({timeout: 15000});

            const define = fleet.requests.find(request => request.method === 'defineAgent');

            expect(define.params.memoryImport).toBe(CANDIDATES[1].source);

            // Start refuses while the import has not converged: the card says so with the source and the step
            const card = page.locator('.fm-fleet-cards .fm-agent-card');

            await expect(card).toHaveCount(1, {timeout: 30000});
            await card.locator('.fm-card-control-verbs button').first().click();

            const status = card.locator('.fm-card-control-status');

            await expect(status).toHaveText(`⚠ rejected: ${IMPORT_REFUSAL}`, {timeout: 15000});
            await expect(status).toHaveAttribute('title', `⚠ rejected: ${IMPORT_REFUSAL}`);
            await test.info().attach('Start refused by the import', {body: await card.screenshot(), contentType: 'image/png'})
        } finally {
            await fleet.close()
        }
    });

    test('one candidate is preselected, its folder under Details (AC-2)', async ({page, neuralLink}) => {
        const fleet = await startMemoryFleetBridge(MEMORY_ANSWERS.candidates([CANDIDATES[0]]));

        try {
            const
                form    = await openAddAgent({fleet, neuralLink, page}),
                frame   = form.locator('.fm-add-memory'),
                details = frame.locator('.fm-add-memory-details');

            await expect(frame.locator('.fm-add-memory-lead')).toHaveText('Continue this agent\'s memory?');
            await expect(frame.locator('.neo-list-item.neo-selected .fm-memory-candidate-name')).toHaveText('Mnemosyne');
            await expect(details).toBeVisible();

            await details.locator('summary').click();
            await expect(details.locator('.fm-add-memory-source')).toHaveText(CANDIDATES[0].source);

            await fill(form);
            await form.locator('.fm-add-submit').click();
            await expect(form.locator('.fm-add-status.is-readback-confirmed')).toBeVisible({timeout: 15000});

            expect(fleet.requests.find(request => request.method === 'defineAgent').params.memoryImport).toBe(CANDIDATES[0].source)
        } finally {
            await fleet.close()
        }
    });
});
