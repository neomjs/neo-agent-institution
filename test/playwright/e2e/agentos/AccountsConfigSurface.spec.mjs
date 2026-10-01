import {test, expect, loadAgentOsModule, loadNeuralLinkModules}  from '../../fixtures.mjs';
import {authenticatedFleetOptions, wireAuthenticatedFleetBridge} from './authenticatedFleetHarness.mjs';
import {listHarnessProducts}                                     from 'neo-agent-brain/fleet-contract';
import fs                                                        from 'fs';
import os                                                        from 'os';
import path                                                      from 'path';

const [
    {NeuralLink_DataService},
    {default: FleetRegistryService},
    {startFleetBridgeServer}
] = await Promise.all([
    loadNeuralLinkModules(),
    loadAgentOsModule('ai/services/fleet/FleetRegistryService.mjs'),
    loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs')
]);

/**
 * @summary Verifies the agent-scoped Accounts configuration surface mounts end-to-end: the
 * definitions list derives from the roster store, the configuration card renders the scoped agent's
 * registry-derived configuration (product chips, MCP-server rows, tri-state operational rows),
 * and the shared add-agent form offers one chip per catalog product. The save + operable-cold
 * add journeys use the production App-Worker bridge, a real Brain registry/server, the Viewport's
 * accepted-definition composition handoff, and Neural Link inspection of the deliberately separate
 * AgentDefinitions + FleetRoster stores; this is behavioral evidence rather than a screenshot generator.
 *
 * @see apps/agentos/view/accounts/Panel.mjs
 * @see apps/agentos/view/fleet/detail/AgentConfigComponent.mjs
 */
test.describe('AgentOS Accounts — agent-scoped configuration surface', () => {
    test.setTimeout(120000);

    test('cold-loads, saves config, adds an emergent resident, and freshly rehydrates over the real Fleet wire', async ({page, neuralLink}) => {
        const
            priorDataDir    = FleetRegistryService.dataDir,
            tmpDir          = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-config-e2e-')),
            agentId         = 'config-proof-agent',
            createdAgentId  = 'cold-proof-agent',
            createdSecret   = 'ghp_e2e_add_must_stay_brain_side',
            duplicateSecret = 'ghp_e2e_duplicate_must_stay_brain_side';

        FleetRegistryService.dataDir = tmpDir;
        FleetRegistryService.defineAgent({
            id            : agentId,
            githubUsername: agentId,
            harnessType   : 'codex',
            credential    : 'ghp_e2e_must_stay_brain_side'
        });

        let server;

        try {
            const options = authenticatedFleetOptions();

            server = await startFleetBridgeServer(options);
            const fleetUrl = `http://127.0.0.1:${server.address().port}/fleet`;

            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl})}`);

            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            // Boot installs the FAIL-CLOSED bridge; inject the bearer through the worker-realm
            // product injector BEFORE the Accounts pane mounts, so its cold-hydrate reads live.
            await wireAuthenticatedFleetBridge({app: await neuralLink.connectToApp('AgentOS'), fleetUrl, bearerToken: options.bearerToken});

            await page.locator('.agent-shell').getByText('Accounts', {exact: true}).click();
            await expect(page.locator('.agent-panel-accounts')).toBeVisible({timeout: 30000});

            // The pane constructed at shell boot, so its cold-hydrate raced the fail-closed bridge;
            // re-run the idempotent hydrate now that the injector flipped the bridge live.
            const appHandle  = await neuralLink.connectToApp('AgentOS');
            const [accounts] = await appHandle.queryComponent({className: 'AgentOS.view.accounts.Panel'}, ['id']);

            await appHandle.callMethod(accounts.properties.id, 'loadAgentDefinitions');

            // The provider store cold-hydrates from the REAL Brain registry, and the list renders it.
            const
                accountsView = page.locator('.agent-panel-accounts'),
                listItems    = accountsView.locator('.fm-accounts-list .neo-list-item');

            await expect(listItems.filter({hasText: agentId})).toHaveCount(1);

            await expect(page.locator('.fm-agent-config-card')).toBeVisible();
            // the product chips only: the run-mode, launch-owner and memory-target choices are chips too
            const productChips = page.locator('.fm-config-harness .fm-chip');

            await expect(productChips).toHaveCount(listHarnessProducts().length);
            await expect(productChips.and(page.locator('.is-selected'))).toHaveCount(1);

            const memoryCore = page.locator('.fm-config-toggle').filter({hasText: 'Memory Core'});
            await expect(memoryCore).toHaveClass(/is-enabled/);
            // Docked keeper views may render beyond the browser viewport while remaining the live
            // mounted surface. Dispatch through the real DOM listener instead of weakening the
            // component path with a direct method call.
            await memoryCore.dispatchEvent('click');
            await expect(page.locator('.fm-config-save-status.is-accepted')).toContainText('Configuration saved');
            await expect(memoryCore).toHaveClass(/is-disabled/);

            expect(FleetRegistryService.getDefinition(agentId).mcpServers).toEqual({'memory-core': false});

            // Operable-cold journey: the UI request crosses the production wire once, while the
            // Body applies only the canonical redacted response. The accepted-definition owner
            // intent then makes FleetCockpit re-poll its separate Brain assembler.
            const
                addAction       = accountsView.locator('.fm-accounts-add'),
                form            = accountsView.locator('.fm-add-agent-form'),
                usernameField   = form.getByRole('textbox', {name: 'Username', exact: true}),
                credentialField = form.getByRole('textbox', {name: 'Personal access token', exact: true}),
                productChip     = form.locator('.fm-add-harness-row .fm-chip').filter({hasText: 'Antigravity'}),
                submit          = form.locator('.fm-add-submit');

            await addAction.click();
            await expect(form).toBeVisible();
            await usernameField.fill(createdAgentId);
            await credentialField.fill(createdSecret);
            await productChip.click();
            await expect(productChip).toHaveClass(/is-selected/);
            await submit.click();

            // the form stays up with its outcome line; the new agent is listed, one click from its card
            await expect(form.locator('.fm-add-status.is-readback-confirmed')).toContainText('Agent added');
            await expect(credentialField).toHaveValue('');
            await expect(listItems.filter({hasText: createdAgentId})).toHaveCount(1);
            await listItems.filter({hasText: createdAgentId}).click();
            await expect(page.locator('.fm-agent-config-card')).toContainText(createdAgentId);

            const createdDefinition = FleetRegistryService.getDefinition(createdAgentId);

            expect(createdDefinition).toMatchObject({
                id            : createdAgentId,
                githubUsername: createdAgentId,
                harnessType   : 'antigravity'
            });
            expect(JSON.stringify(createdDefinition)).not.toContain(createdSecret);

            await page.getByRole('tab', {name: 'Fleet', exact: true}).click();

            const createdCard = page.locator('.fm-agent-card').filter({hasText: createdAgentId});

            await expect(createdCard).toHaveCount(1);
            await expect(createdCard).toBeVisible();

            // A registry-domain rejection travels as a controlled outcome: reason visible, no
            // second Body mutation/owner refresh, and the retry PAT is still cleared.
            await page.getByRole('tab', {name: 'Accounts', exact: true}).click();
            await addAction.click();
            await credentialField.fill(duplicateSecret);
            await submit.click();
            await expect(form.locator('.fm-add-status.is-rejected')).toContainText('already exists');
            await expect(credentialField).toHaveValue('');
            expect(FleetRegistryService.listAgents().filter(agent => agent.id === createdAgentId)).toHaveLength(1);

            const
                app             = await neuralLink.connectToApp('AgentOS'),
                stores          = await NeuralLink_DataService.listStores({sessionId: app.sessionId}),
                definitionsMeta = stores.stores.find(candidate => candidate.model === 'AgentOS.model.AgentDefinition'),
                rosterMeta      = stores.stores.find(candidate => candidate.model === 'AgentOS.model.FleetAgent'),
                definitions     = await NeuralLink_DataService.inspectStore({
                    sessionId: app.sessionId,
                    storeId  : definitionsMeta.id,
                    limit    : 10
                }),
                roster          = await NeuralLink_DataService.inspectStore({
                    sessionId: app.sessionId,
                    storeId  : rosterMeta.id,
                    limit    : 10
                }),
                configRow       = definitions.items.find(item => item.id === agentId),
                definitionRow   = definitions.items.find(item => item.id === createdAgentId),
                rosterRow       = roster.items.find(item => item.agentId === createdAgentId),
                cards           = await app.queryComponent({className: 'AgentOS.view.fleet.roster.card.Container'}, ['record', 'id']),
                card            = cards.find(candidate => candidate.properties?.record?.agentId === createdAgentId);

            expect(configRow.mcpServers).toEqual({'memory-core': false});
            expect(definitionRow).toMatchObject({
                id            : createdAgentId,
                githubUsername: createdAgentId,
                harnessType   : 'antigravity'
            });
            expect(JSON.stringify(definitionRow)).not.toMatch(/credential|pat|ghp_e2e_add_must_stay_brain_side/i);
            expect(rosterRow.agentId).toBe(createdAgentId);
            expect(card.properties.record).toMatchObject({
                agentId  : createdAgentId,
                engineTag: null,
                // the Brain derives the display family from the declared harness (neo-agent-brain#656)
                family   : 'gemini'
            });

            // A fresh page/store hydration must re-read the canonical sparse result, not the
            // request or the seed. This also proves persisted state survived the first app session.
            await page.reload();
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            // a reload births a fresh App Worker: the in-memory bearer is gone BY CONSTRUCTION,
            // so the injector + idempotent hydrate run again against the new realm.
            const appReloaded = await neuralLink.connectToApp('AgentOS');

            await wireAuthenticatedFleetBridge({app: appReloaded, fleetUrl, bearerToken: options.bearerToken});

            await page.locator('.agent-shell').getByText('Accounts', {exact: true}).click();
            await expect(page.locator('.agent-panel-accounts')).toBeVisible({timeout: 30000});

            const [accountsReloaded] = await appReloaded.queryComponent({className: 'AgentOS.view.accounts.Panel'}, ['id']);

            await appReloaded.callMethod(accountsReloaded.properties.id, 'loadAgentDefinitions');
            await expect(listItems.filter({hasText: agentId})).toHaveCount(1);
            await expect(listItems.filter({hasText: createdAgentId})).toHaveCount(1);
            await expect(page.locator('.fm-config-toggle').filter({hasText: 'Memory Core'})).toHaveClass(/is-disabled/);

            // the shared form offers one chip per catalog product, never one per harness type
            await addAction.click();
            await expect(form.locator('.fm-add-harness-row:not(.fm-add-runs-as-row) .fm-chip')).toHaveCount(listHarnessProducts().length)
        } finally {
            server && await new Promise(resolve => server.close(resolve));
            FleetRegistryService.dataDir = priorDataDir;
            fs.rmSync(tmpDir, {recursive: true, force: true})
        }
    });
});
