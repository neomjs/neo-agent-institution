import {test, expect, loadAgentOsModule} from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    reloadRoster,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const SEAT = 'seat-model-witness';

const WIRED_SOURCES = {
    roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
    repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
    runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
};

/**
 * @summary A loopback Fleet answering for one Codex app seat the way the Brain does: its definition through
 * `listAgents`, its row with what its config is set to and what its last start found, the catalog its harness
 * offers, a `configureAgent` that answers the whole definition, and a Start refused for a declared model the
 * harness no longer lists, which records that refusal on the seat.
 * @param {Object} [options]
 * @param {Object} [options.declared={}] The seat's declared `model` and `reasoningEffort`.
 * @param {String} [options.state='stopped'] The seat's runtime state.
 * @returns {Promise<{bearerToken: String, close: Function, endpoint: String, requests: Object[]}>}
 */
async function startSeatFleet({declared = {}, state = 'stopped'} = {}) {
    const
        {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
        requests   = [],
        definition = {id: SEAT, githubUsername: SEAT, displayName: 'Seat Witness', harnessType: 'codex-desktop', launchOwner: 'fleet', mcpServers: null, mcpTarget: null, ...declared},
        seat       = {seatModel: null},
        row        = () => ({
            id             : SEAT,
            githubUsername : SEAT,
            displayName    : 'Seat Witness',
            engineTag      : null,
            family         : 'gpt',
            avatarUrl      : '',
            harnessType    : 'codex-desktop',
            harnessSettings: {model: 'gpt-6-luna', reasoningEffort: 'high'},
            seatModel      : seat.seatModel,
            lifecycle      : {source: 'fleet:runtimeStatus', state, confidence: 'observed'},
            sources        : WIRED_SOURCES
        });

    const options = authenticatedFleetOptions({
        dispatch: async request => {
            requests.push(request);

            switch (request.method) {
                case 'listAgents':
                    return fleetE2ESuccess([{...definition}]);
                case 'fleetRoster':
                    return fleetE2ESuccess({rows: [row()]});
                case 'fleetSeatModelCatalog':
                    return fleetE2ESuccess({state: 'complete', reason: null, models: [
                        {id: 'gpt-6-luna',   slug: 'gpt-6-luna',   efforts: ['low', 'high'], defaultEffort: 'low', hidden: false, isDefault: true},
                        {id: 'gpt-6-astra',  slug: 'gpt-6-astra',  efforts: ['low', 'max'],  defaultEffort: 'low', hidden: false, isDefault: false},
                        {id: 'gpt-6-hidden', slug: 'gpt-6-hidden', efforts: ['low'],         defaultEffort: 'low', hidden: true,  isDefault: false}
                    ]});
                case 'configureAgent': {
                    const {id, ...fields} = request.params;

                    for (const [key, value] of Object.entries(fields)) {
                        value === null ? delete definition[key] : definition[key] = value
                    }

                    return fleetE2ESuccess({status: 'accepted', agent: {...definition}})
                }
                case 'startAgent': {
                    const reason = `model ${definition.model} is not available`;

                    seat.seatModel = {state: 'refused', model: definition.model, reasoningEffort: definition.reasoningEffort ?? null, reason};

                    return fleetE2ESuccess({status: 'rejected', reason: `agent '${SEAT}' cannot start: ${reason}. Nothing was cloned or configured and the harness did not start. Change it in Detail › Configuration, then start it again.`})
                }
                case 'fleetActivity':
                    return fleetE2ESuccess({capability: {source: 'fleet:test', state: 'wired', confidence: 'observed'}, events: []});
                case 'fleetSeatGitIdentity':
                    return fleetE2ESuccess({state: 'derived', source: 'verified-primary', name: 'Seat Witness', email: 'seat@example.test'});
                case 'fleetStatus':
                case 'fleetRuntimeStatus':
                    return fleetE2ESuccess([]);
                default:
                    return fleetE2EFailure(`fleet: unexpected test method '${request.method}'`)
            }
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
 * @summary Boot the app, wire the authenticated bridge, and re-read what the boot read before it was live: the
 * roster, and the definitions the Detail joins on (the Accounts pane's idempotent hydrate).
 * @param {Object} page
 * @param {Object} neuralLink
 * @param {Object} fleet The running loopback bridge.
 * @returns {Promise<Object>} The Neural Link app handle.
 */
async function bootWiredCockpit(page, neuralLink, fleet) {
    await page.goto('/apps/agentos/index.html');
    await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
    await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

    const app = await neuralLink.connectToApp('AgentOS');

    await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});
    await reloadRoster(app);

    const [accounts] = await app.queryComponent({className: 'AgentOS.view.accounts.Panel'}, ['id']);

    await app.callMethod(accounts.properties.id, 'loadAgentDefinitions');
    await expect(page.locator('.fm-fleet-cards .fm-agent-card')).toHaveCount(1, {timeout: 30000});

    return app
}

/**
 * @summary Configuration's Seat group over the real Fleet wire: what a seat's config is set to beside what is
 * declared, the values its harness lists, one field per declaration, and the card's line for a Start refused for
 * the declared model.
 */
test.describe('AgentOS Detail › Configuration — the Seat group over the Fleet wire (#559)', () => {
    test.setTimeout(90000);

    const parts = page => {
        const
            card   = page.locator('.fm-fleet-cards .fm-agent-card'),
            detail = page.locator('.fm-agent-detail:visible').first(),
            group  = detail.locator('.fm-seat-model');

        return {
            card,
            detail,
            group,
            effort: group.locator('.fm-seat-model-line').nth(1),
            model : group.locator('.fm-seat-model-line').first(),
            offer : group.locator('.fm-seat-model-offer'),
            status: card.locator('.fm-card-control-status'),
            open  : async () => {
                await card.click();
                await detail.getByRole('tab', {name: 'Configuration', exact: true}).click();
                await expect(group).toBeVisible({timeout: 30000})
            }
        }
    };

    test('a seat started on its defaults: the group reads its config, Change offers what the harness lists, a declaration crosses as one field and keeps both values, and a refused Start reads its reason on the card and on the row', async ({page, neuralLink}) => {
        const fleet = await startSeatFleet();

        try {
            await bootWiredCockpit(page, neuralLink, fleet);

            const
                {card, group, model, offer, open, status} = parts(page),
                sent                                     = method => fleet.requests.filter(request => request.method === method).map(request => request.params);

            // nothing about the model reaches the card before a Start is refused
            await expect(status).toBeHidden();

            await open();
            await expect(model).toHaveText('derived · reads gpt-6-luna (configured on disk)');

            // Change asks the seat's harness, and offers what it lists, without the hidden entry
            await group.locator('.fm-seat-model-change').first().click();
            await expect(offer.locator('.fm-chip')).toHaveText(['gpt-6-luna', 'gpt-6-astra', 'Use the harness default']);
            await expect(offer.locator('.fm-chip.is-selected')).toHaveText('Use the harness default');
            expect(sent('fleetSeatModelCatalog')).toEqual([{id: SEAT}]);

            await offer.getByText('gpt-6-astra', {exact: true}).click();
            await expect(model).toHaveText('declared gpt-6-astra · reads gpt-6-luna (configured on disk) · applies at next start');
            await expect(offer).toBeHidden();
            expect(sent('configureAgent')).toEqual([{id: SEAT, model: 'gpt-6-astra'}]);

            // the refusal re-polls the roster, so the seat's recorded cause puts its reason on the line without a
            // second press or the 60 s poll; the title says where to change it
            await card.locator('.fm-card-control-verbs button').first().click();
            await expect(status).toHaveText('start refused: model gpt-6-astra is not available', {timeout: 15000});
            await expect(status).toHaveAttribute('title', 'start refused: model gpt-6-astra is not available — change it in Detail › Configuration');
            await expect(status).toHaveClass(/is-model-refused/);

            // the row the card sends the operator to says the same
            await expect(model).toHaveText('declared gpt-6-astra · start refused: model gpt-6-astra is not available');

            expect(JSON.stringify(fleet.requests)).not.toMatch(/credential|github_pat|bearer/i)
        } finally {
            await fleet.close()
        }
    });

    test('a running seat on other values: both show with when the declaration applies, and Adopt declares what the config reads', async ({page, neuralLink}) => {
        const fleet = await startSeatFleet({declared: {model: 'gpt-6-astra', reasoningEffort: 'max'}, state: 'running'});

        try {
            await bootWiredCockpit(page, neuralLink, fleet);

            const {effort, group, model, open} = parts(page);

            await open();
            await expect(model).toHaveText('declared gpt-6-astra · reads gpt-6-luna (configured on disk) · applies at next start');
            await expect(effort).toHaveText('declared max · reads high (configured on disk) · applies at next start');

            // a hidden action leaves the DOM, so the row, not an index across rows, names the link
            const adopt = group.locator('.fm-seat-model-row').nth(1).locator('.fm-seat-model-adopt');

            await expect(adopt).toHaveText('Adopt high');
            await adopt.click();
            await expect(effort).toHaveText('declared high');
            expect(fleet.requests.filter(request => request.method === 'configureAgent').map(request => request.params)).toEqual([{id: SEAT, reasoningEffort: 'high'}])
        } finally {
            await fleet.close()
        }
    });
});
