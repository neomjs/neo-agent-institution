import {test, expect, landAgentDefinitions, loadAgentOsModule, loadNeuralLinkModules} from '../../fixtures.mjs';
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

    /**
     * @summary Body gestures keep their native meaning; only the Accounts header admits a
     * dashboard drag. The native selection guard and App-worker sort state must agree.
     */
    test('Accounts body gestures stay native and its header still tears out', async ({page, neuralLink}, testInfo) => {
        await page.setViewportSize({width: 1400, height: 700});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
        const app = await neuralLink.connectToApp('AgentOS');
        await landAgentDefinitions(page);
        await page.getByRole('tab', {name: 'Accounts', exact: true}).click();

        const
            panel = page.locator('.agent-panel-accounts'),
            [accounts] = await app.queryComponent({className: 'AgentOS.view.accounts.Panel'}, ['id', 'parentId']),
            dashboardId = accounts.properties.parentId;
        await expect(panel).toBeVisible();
        await expect.poll(async () => (await app.getComponent(dashboardId, ['sortZone.id']))['sortZone.id']).toBeTruthy();
        const sortZoneId = (await app.getComponent(dashboardId, ['sortZone.id']))['sortZone.id'];

        for (const [label, target, whitespace] of [
            ['body whitespace', panel.locator('.fm-accounts-master'), true],
            ['list text', panel.locator('.fm-accounts-list .neo-list-item').first(), false],
            ['detail text', panel.locator('.fm-config-name'), false]
        ]) {
            await target.scrollIntoViewIfNeeded();
            const box = await target.boundingBox(), before = await panel.boundingBox();
            const x = whitespace ? box.x + box.width - 4 : box.x + 4;
            const y = box.y + (whitespace ? box.height - 12 : box.height / 2);
            await page.evaluate(() => getSelection().removeAllRanges());
            await page.mouse.move(x, y);
            await page.mouse.down();
            try {
                expect(await page.evaluate(() => document.body.classList.contains('neo-drag-active')), label).toBe(false);
                await page.mouse.move(x + (whitespace ? -50 : 80), y, {steps: 15});
                expect((await app.getComponent(sortZoneId, ['currentIndex'])).currentIndex, label).toBe(-1);
                expect(await panel.boundingBox(), label).toEqual(before);
                expect(page.context().pages(), label).toHaveLength(1)
            } finally {
                await page.mouse.up()
            }
            if (label === 'detail text') {
                expect(await page.evaluate(() => getSelection().toString())).not.toBe('')
            }
        }

        await panel.locator('.fm-accounts-add').click();
        const input = panel.getByRole('textbox', {name: 'Username', exact: true});
        await input.fill('selection-stays-native');
        await input.scrollIntoViewIfNeeded();
        const inputBox = await input.boundingBox();
        await page.mouse.move(inputBox.x + 8, inputBox.y + inputBox.height / 2);
        await page.mouse.down();
        try {
            expect(await page.evaluate(() => document.body.classList.contains('neo-drag-active'))).toBe(false);
            await page.mouse.move(inputBox.x + 90, inputBox.y + inputBox.height / 2, {steps: 15})
        } finally {
            await page.mouse.up()
        }
        await expect(input).toHaveValue('selection-stays-native');
        await page.setViewportSize({width: 1400, height: 420});
        const detail = panel.locator('.fm-accounts-detail');
        await expect.poll(() => detail.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
        await detail.hover();
        await page.mouse.wheel(0, 400);
        await expect.poll(() => detail.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        expect((await app.getComponent(sortZoneId, ['currentIndex'])).currentIndex).toBe(-1);
        expect(page.context().pages()).toHaveLength(1);

        await page.setViewportSize({width: 1400, height: 700});
        const handle = panel.locator('.fm-accounts-drag-handle');
        await handle.scrollIntoViewIfNeeded();
        const box = await handle.boundingBox();
        const motion = app.observeMotion([accounts.properties.id], 800, 50);
        const popupPromise = page.waitForEvent('popup', {timeout: 15000});
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        try {
            await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, {steps: 20});
            await expect.poll(async () => (await app.getComponent(sortZoneId, ['dragComponent.id']))['dragComponent.id']).toBe(accounts.properties.id);
            expect(await page.evaluate(() => document.body.classList.contains('neo-drag-active'))).toBe(true);
            await page.mouse.move(4, 4, {steps: 40});
            const popup = await popupPromise;
            await expect(popup.locator('.agent-panel-accounts')).toBeVisible({timeout: 30000});
            await expect(popup.locator('.agent-panel-accounts')).toHaveAttribute('id', accounts.properties.id);
            await expect(popup.getByRole('textbox', {name: 'Username', exact: true})).toHaveValue('selection-stays-native');
            expect((await app.getComponent(accounts.properties.id, ['windowId'])).windowId)
                .not.toBe((await app.getComponent(dashboardId, ['windowId'])).windowId);
            await popup.screenshot({path: testInfo.outputPath('accounts-header-popup.png')})
        } finally {
            await page.mouse.up();
            await testInfo.attach('header-motion', {body: JSON.stringify(await motion), contentType: 'application/json'});
            await testInfo.attach('header-drag-trace', {body: JSON.stringify(await app.getDragTrace()), contentType: 'application/json'})
        }
    });

    test('cold-loads, saves config, adds an emergent resident, and freshly rehydrates over the real Fleet wire', async ({page, neuralLink}, testInfo) => {
        await page.setViewportSize({width: 1400, height: 900});
        const
            priorDataDir    = FleetRegistryService.dataDir,
            tmpDir          = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-config-e2e-')),
            agentId         = 'config-proof-agent',
            gitlabAgentId   = 'gitlab-seat-proof',
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
        FleetRegistryService.defineAgent({
            id            : gitlabAgentId,
            githubUsername: gitlabAgentId,
            forge         : 'gitlab',
            forgeHost     : 'https://gitlab.example.test',
            harnessType   : 'codex',
            credential    : 'glpat_e2e_config_must_stay_brain_side'
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

            const
                configView   = accountsView.locator('.fm-agent-config-card'),
                [configCard] = await appHandle.queryComponent({id: await configView.getAttribute('id')}, ['id']),
                edit         = configView.locator('.fm-config-connection-edit');

            await expect(configView.locator('.fm-config-plane-credential')).toHaveCount(0);
            await expect(configView.locator('.fm-target-choice')).toHaveCount(0);
            await expect(edit).toHaveText('Edit connection');
            await edit.click();
            await expect(edit).toBeFocused();

            const target = configView.getByRole('button', {name: /^This fleet ·/});
            await target.click();

            const focusedId = await target.getAttribute('id');
            expect(await page.evaluate(() => document.activeElement?.id)).toBe(focusedId);

            // Drive the same card method the real round-trip calls, while the browser owns focus.
            for (const state of ['pending', 'rejected', 'accepted']) {
                await appHandle.callMethod(configCard.properties.id, 'setSaveStatus', [agentId, state, `Focus witness: ${state}`]);
                await expect(configView.locator('.fm-config-save-status')).toContainText(`Focus witness: ${state}`);
                expect(await page.evaluate(() => document.activeElement?.id), state).toBe(focusedId)
            }

            await appHandle.callMethod(configCard.properties.id, 'setSaveStatus', [agentId, 'idle', '']);
            await target.press('Enter');
            await expect(target).toBeFocused();
            await configView.getByRole('button', {name: 'Close connection options', exact: true}).click();
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
            await expect(form.locator('.fm-add-destination')).toContainText('Agent OS:');
            await expect(form.locator('.fm-add-credential-help')).toHaveText('This token gives the agent access to its repositories and the connected Agent OS.');
            await page.screenshot({path: testInfo.outputPath('add-agent-and-configuration.png'), fullPage: true});
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
                // the Brain derives the display family from the declared harness
                family   : 'gemini'
            });

            await listItems.filter({hasText: gitlabAgentId}).click();
            const
                gitlabWorkflow = page.locator('.fm-config-toggle').filter({hasText: 'GitLab workflow'}),
                githubWorkflow = page.locator('.fm-config-toggle').filter({hasText: 'GitHub workflow'}),
                neuralLinkRow  = page.locator('.fm-config-toggle').filter({hasText: 'Neural Link'});

            await expect(gitlabWorkflow).toHaveClass(/is-enabled/);
            await expect(githubWorkflow).toHaveClass(/is-disabled/);
            await gitlabWorkflow.dispatchEvent('click');
            await expect(gitlabWorkflow).toHaveClass(/is-disabled/);
            await neuralLinkRow.dispatchEvent('click');
            await expect(neuralLinkRow).toHaveClass(/is-disabled/);
            await expect(gitlabWorkflow).toHaveClass(/is-disabled/);
            expect(FleetRegistryService.getDefinition(gitlabAgentId)).toMatchObject({
                forge     : 'gitlab',
                mcpServers: {'neural-link': false, 'gitlab-workflow': false}
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
            await listItems.filter({hasText: gitlabAgentId}).click();
            await expect(gitlabWorkflow).toHaveClass(/is-disabled/);
            await expect(githubWorkflow).toHaveClass(/is-disabled/);
            await expect(neuralLinkRow).toHaveClass(/is-disabled/);

            // the shared form offers one chip per catalog product, never one per harness type
            await addAction.click();
            await expect(form.locator('.fm-add-harness-row:not(.fm-add-runs-as-row) .fm-chip')).toHaveCount(listHarnessProducts().length)
        } finally {
            server && await new Promise(resolve => server.close(resolve));
            FleetRegistryService.dataDir = priorDataDir;
            fs.rmSync(tmpDir, {recursive: true, force: true})
        }
    });

    test('the Repositories card adds and removes repositories over the real Fleet wire, and a refused list shows the Fleet\'s reason', async ({page, neuralLink}) => {
        const
            priorDataDir = FleetRegistryService.dataDir,
            tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-repos-e2e-')),
            agentId      = 'repos-proof-agent',
            extra        = 'neomjs/neo-agent-brain';

        FleetRegistryService.dataDir = tmpDir;
        FleetRegistryService.defineAgent({
            id            : agentId,
            githubUsername: agentId,
            harnessType   : 'codex',
            credential    : 'ghp_e2e_repos_must_stay_brain_side'
        });
        FleetRegistryService.updateAgent(agentId, {metadata: {repo: {repoSlug: 'neomjs/neo', cloneUrl: 'https://github.com/neomjs/neo.git'}}});

        let server;

        try {
            const options = authenticatedFleetOptions();

            server = await startFleetBridgeServer(options);
            const fleetUrl = `http://127.0.0.1:${server.address().port}/fleet`;

            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl})}`);
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
            await wireAuthenticatedFleetBridge({app: await neuralLink.connectToApp('AgentOS'), fleetUrl, bearerToken: options.bearerToken});

            await page.locator('.agent-shell').getByText('Accounts', {exact: true}).click();
            await expect(page.locator('.agent-panel-accounts')).toBeVisible({timeout: 30000});

            const
                app        = await neuralLink.connectToApp('AgentOS'),
                [accounts] = await app.queryComponent({className: 'AgentOS.view.accounts.Panel'}, ['id']);

            await app.callMethod(accounts.properties.id, 'loadAgentDefinitions');

            const
                card   = page.locator('.fm-agent-repos-card'),
                rows   = card.locator('.fm-repository-list .neo-list-item'),
                field  = card.getByRole('textbox', {name: 'Add a repository', exact: true}),
                add    = card.locator('.fm-repos-add-button'),
                status = card.locator('.fm-repos-status');

            // the working repository, as the registry declares it
            await expect(rows).toHaveCount(1);
            await expect(rows.first()).toContainText('neomjs/neo');
            await expect(rows.first()).toContainText('Working');

            // an add crosses the wire as one setRepos with the whole list, and the readback renders it
            await field.fill(extra);
            await add.dispatchEvent('click');
            await expect(status).toHaveClass(/is-accepted/);
            await expect(rows).toHaveCount(2);
            expect(FleetRegistryService.getDefinition(agentId).metadata.repos).toEqual([{repoSlug: extra, cloneUrl: `https://github.com/${extra}.git`}]);

            // a refused list shows the Fleet's own reason, keeps the typed slug, and the rows keep
            // what the registry holds
            await field.fill(extra);
            await add.dispatchEvent('click');
            await expect(status).toHaveClass(/is-rejected/);
            await expect(status).toHaveText('a repository is listed twice.');
            await expect(field).toHaveValue(extra);
            await expect(rows).toHaveCount(2);
            expect(FleetRegistryService.getDefinition(agentId).metadata.repos).toHaveLength(1);

            // a Remove sends the list without it
            await rows.filter({hasText: extra}).locator('.fm-repo-remove').dispatchEvent('click');
            await expect(status).toHaveClass(/is-accepted/);
            await expect(rows).toHaveCount(1);
            expect(FleetRegistryService.getDefinition(agentId).metadata.repos).toEqual([])
        } finally {
            server && await new Promise(resolve => server.close(resolve));
            FleetRegistryService.dataDir = priorDataDir;
            fs.rmSync(tmpDir, {recursive: true, force: true})
        }
    });

    test('a GitLab seat added through the form lands on its own instance, and its repositories keep their forge on every change (#448)', async ({page, neuralLink}) => {
        const
            priorDataDir = FleetRegistryService.dataDir,
            tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-gitlab-e2e-')),
            agentId      = 'gitlab-proof-agent',
            instance     = 'https://gitlab.example.test',
            secret       = 'glpat-e2e_form_must_stay_brain_side',
            onInstance   = repoSlug => ({repoSlug, cloneUrl: `${instance}/${repoSlug}.git`, forge: 'gitlab'});

        FleetRegistryService.dataDir = tmpDir;

        let server;

        try {
            const options = authenticatedFleetOptions();

            server = await startFleetBridgeServer(options);
            const fleetUrl = `http://127.0.0.1:${server.address().port}/fleet`;

            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl})}`);
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
            await wireAuthenticatedFleetBridge({app: await neuralLink.connectToApp('AgentOS'), fleetUrl, bearerToken: options.bearerToken});

            await page.locator('.agent-shell').getByText('Accounts', {exact: true}).click();
            await expect(page.locator('.agent-panel-accounts')).toBeVisible({timeout: 30000});

            const
                app          = await neuralLink.connectToApp('AgentOS'),
                [accounts]   = await app.queryComponent({className: 'AgentOS.view.accounts.Panel'}, ['id']),
                accountsView = page.locator('.agent-panel-accounts'),
                form         = accountsView.locator('.fm-add-agent-form'),
                listItems    = accountsView.locator('.fm-accounts-list .neo-list-item');

            await app.callMethod(accounts.properties.id, 'loadAgentDefinitions');

            // the add form: the GitLab chip shows the instance; the repository is the seat's own group path
            await accountsView.locator('.fm-accounts-add').click();
            await form.locator('.fm-add-forge-row .fm-chip').filter({hasText: 'GitLab'}).click();
            await form.getByRole('textbox', {name: 'GitLab instance', exact: true}).fill(instance);
            await form.getByRole('textbox', {name: 'Username', exact: true}).fill(agentId);
            await form.getByRole('textbox', {name: 'Personal access token', exact: true}).fill(secret);
            await form.getByRole('textbox', {name: 'Working repository', exact: true}).fill('group/sub/project');
            await form.locator('.fm-add-submit').click();

            // no reason line: the Fleet composed the working repository on the seat's own instance
            await expect(form.locator('.fm-add-status.is-readback-confirmed')).toHaveText('Agent added.');

            const defined = FleetRegistryService.getDefinition(agentId);

            expect(defined).toMatchObject({forge: 'gitlab', forgeHost: instance, metadata: {repo: onInstance('group/sub/project')}});
            expect(JSON.stringify(defined)).not.toContain(secret);

            // the Repositories card: an add and a remove re-send the other entries with their forge
            await listItems.filter({hasText: agentId}).click();

            const
                card  = page.locator('.fm-agent-repos-card'),
                rows  = card.locator('.fm-repository-list .neo-list-item'),
                field = card.getByRole('textbox', {name: 'Add a repository', exact: true}),
                add   = card.locator('.fm-repos-add-button');

            // each change waits on the readback's rows: the status line stays `is-accepted` between them
            for (const [repoSlug, count] of [['group/tools', 2], ['group/sub/docs', 3]]) {
                await field.fill(repoSlug);
                await add.dispatchEvent('click');
                await expect(rows).toHaveCount(count)
            }

            expect(FleetRegistryService.getDefinition(agentId).metadata.repos).toEqual([onInstance('group/tools'), onInstance('group/sub/docs')]);

            await rows.filter({hasText: 'group/tools'}).locator('.fm-repo-remove').dispatchEvent('click');
            await expect(rows).toHaveCount(2);
            expect(FleetRegistryService.getDefinition(agentId).metadata.repos).toEqual([onInstance('group/sub/docs')])
        } finally {
            server && await new Promise(resolve => server.close(resolve));
            FleetRegistryService.dataDir = priorDataDir;
            fs.rmSync(tmpDir, {recursive: true, force: true})
        }
    });
});
