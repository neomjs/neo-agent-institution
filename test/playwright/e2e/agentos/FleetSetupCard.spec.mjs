import path                                              from 'node:path';
import {expect, readSetupRun, test}                       from '../../fixtures.mjs';
import {MACHINES, installPinnedSetupShell, pinnedSetupHost} from '../../fixture/pinnedSetupHost.mjs';

/**
 * @summary The shell spec's first-run witness on the served cockpit: before the app boots, the page
 * carries a packaged, unconfigured `window.neoShell` whose setup channels reach the real setup broker
 * over the pinned Brain on a scripted host (`pinnedSetupHost`) — the seam the vessel's preload
 * exposes, so the cockpit runs its real mount path and every row is the recipe's own answer. The
 * setup card is the primary content, inline above the shell, on the Create door; dismissing it before
 * any step ran leaves the frame operable: the switcher stays live, the Connect door is reachable from
 * Home, and the cockpit's panes read their honest cold states. The recipe's projected progress is the
 * chrome's progress line.
 */
test.describe('AgentOS first run — the setup card projects the recipe inline, never as a gate', () => {
    test.setTimeout(120000);

    let run;

    test.beforeEach(async ({page}) => {
        // a 32 GiB laptop under other use: the hosted preset is recommended, the two local ones are refused
        run = await pinnedSetupHost({machine: MACHINES.laptop});
        await installPinnedSetupShell(page, run)
    });

    test('the card is primary content on the Create door; dismissed before any step ran, the frame stays operable and Connect is reachable', async ({page}) => {
        await page.goto('/apps/agentos/index.html');

        const card = page.locator('.agent-plane-setup');

        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
        await expect(card).toBeVisible({timeout: 60000});

        // inline above the shell, never a modal: the card and the shell are siblings in the viewport
        expect(await page.evaluate(() => {
            const card = document.querySelector('.agent-plane-setup'), shell = document.querySelector('.agent-shell');

            return card.parentElement === shell.parentElement && card.compareDocumentPosition(shell) === Node.DOCUMENT_POSITION_FOLLOWING
        })).toBe(true);

        // the Create door is open: the recipe's twelve rows, the status in two channels, the reason verbatim
        await expect(card.locator('.fm-setup-create')).toBeVisible();
        await expect(card.locator('.fm-setup-steps .neo-list-item')).toHaveCount(12, {timeout: 30000});
        await expect(card.locator('.fm-setup-steps .neo-list-item').first()).toHaveClass(/is-ok/);
        await expect(card.locator('.fm-setup-steps .neo-list-item').nth(8).locator('.fm-setup-step-reason')).toHaveText('connect ECONNREFUSED 127.0.0.1:3102');
        await expect(card.locator('.fm-setup-steps .neo-list-item').nth(8).locator('.fm-setup-step-status')).toHaveText('unknown');

        // the three questions read the probe and the table; a refused preset stays visible, disabled, with its shortfall
        await expect(card.locator('.fm-setup-budget')).toHaveText('host 32.0 GiB total · 15.5 GiB available · pressure ok · VM 16.0 GiB cap · 13.5 GiB available');
        await expect(card.locator('.fm-setup-preset')).toHaveCount(3);
        await expect(card.locator('.fm-setup-preset').nth(1)).toHaveClass(/is-refused/);
        await expect(card.locator('.fm-setup-preset').nth(1).locator('.fm-setup-preset-verdict')).toHaveText('refused — the host budget falls 2.2 GiB short');

        // the chrome's progress line IS the recipe's projected progress
        await expect(page.locator('.agent-setup-progress')).toHaveText('2 of 12 observed ok · next: preset');

        // dismiss before any step ran
        await card.locator('.agent-plane-setup-dismiss').click();
        await expect(card).toBeHidden();

        // the frame stays operable: the switcher is live, the cockpit's panes read their cold states
        await expect(page.locator('.agent-top-toolbar .fm-instance-switcher, .agent-top-toolbar .neo-button').first()).toBeVisible();
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible();
        await expect(page.locator('.agent-setup-progress'), 'the progress line stays in the chrome').toHaveText('2 of 12 observed ok · next: preset');

        // Connect is reachable from Home: the card returns on its Connect door
        await page.locator('.agent-shell').getByText('Home', {exact: true}).click();
        await expect(page.locator('.fm-home-connect')).toBeVisible({timeout: 30000});
        await page.locator('.fm-home-connect').click();
        await expect(card).toBeVisible();
        await card.locator('.fm-setup-door-button', {hasText: 'Connect'}).click();
        await expect(card.locator('.fm-setup-connect')).toBeVisible();
        await expect(card.locator('.fm-setup-create')).toBeHidden();

        // no step ran: the fixture shell saw reads only
        const calls = await page.evaluate(() => window.__neoShellCalls.map(([name]) => name));

        expect(calls.filter(name => ['setupAnswer', 'setupEffect', 'setupCredential', 'attachPlane'].includes(name))).toEqual([])
    });

    test('a run the card starts reaches done on the real broker: one consent per choice, the credentials kept as paths, each effect in the recipe\'s order, one command and one witness row, and the card retires', async ({page}) => {
        await page.goto('/apps/agentos/index.html');

        const
            card     = page.locator('.agent-plane-setup'),
            rows     = card.locator('.fm-setup-steps .neo-list-item'),
            row      = id => rows.filter({has: page.locator(`.fm-setup-step-id:text-is("${id}")`)}),
            progress = page.locator('.agent-setup-progress');

        await expect(card.locator('.fm-setup-preset')).toHaveCount(3, {timeout: 60000});
        await expect(card.locator('.fm-setup-preset').first().locator('.fm-setup-preset-verdict')).toContainText('recommended — fits with 13.0 GiB host margin');

        await card.locator('.fm-setup-preset').first().locator('.fm-setup-preset-choose').click();

        await expect(card.locator('.fm-setup-preset').first()).toHaveClass(/is-chosen/);
        await expect(row('preset')).toHaveClass(/is-ok/);
        // the hosted preset requires a provider key: the recipe turns that row into a question of its own
        await expect(row('provider-key').locator('.fm-setup-step-reason')).toHaveText('unanswered');
        await expect(progress).toHaveText('3 of 12 observed ok · next: plane-credential');

        await card.locator('.fm-setup-credential-button').click();

        await expect(card.locator('.fm-setup-q-note').first()).toContainText(`consented · ${path.join(run.setupRoot, 'credentials', 'plane-credential')}`);
        await expect(row('plane-credential')).toHaveClass(/is-ok/);

        await row('provider-key').locator('.fm-setup-step-action').click();
        await expect(row('provider-key'), 'the provider key consented').toHaveClass(/is-ok/);
        await expect(progress).toHaveText('5 of 12 observed ok · next: write-secrets');

        // the first effect: the secret files land under the run's state root, and nothing has left the host's files
        await row('write-secrets').locator('.fm-setup-step-action').click();
        await expect(row('write-secrets'), 'write-secrets re-reads ok').toHaveClass(/is-ok/);
        await expect(row('write-secrets').locator('.fm-setup-step-reason')).toHaveText('observed; matches the accepted receipt');

        expect(await page.evaluate(() => document.body.innerHTML.includes('ghp_') || document.body.innerHTML.includes('glpat-')), 'no credential string in the DOM').toBe(false);
        expect(run.world.commands, 'nothing was asked of the host yet').toEqual([]);

        // the env file names the plane the profile declares: the card sent no target, the broker bound it
        await row('write-env').locator('.fm-setup-step-action').click();
        await expect(row('write-env'), 'write-env re-reads ok').toHaveClass(/is-ok/);

        await row('compose-up').locator('.fm-setup-step-action').click();
        await expect(row('served-plane'), 'the plane that came up is the run\'s own').toHaveClass(/is-ok/);
        await expect(progress).toHaveText('10 of 12 observed ok · next: verify');

        // the witness: written once, read back and recalled; the card retires in the same tick, so the
        // quiet confirmation is witnessed by the retirement and the chrome, not by a row
        run.world.recallLands = true;
        await row('verify').locator('.fm-setup-step-action').click();
        await expect(card).toBeHidden();
        await expect(progress).toHaveText('12 of 12 observed ok · complete');

        const calls = await page.evaluate(() => window.__neoShellCalls);

        expect(calls.filter(([name]) => name === 'setupAnswer')).toEqual([['setupAnswer', {stepId: 'preset', answer: 'hosted'}]]);
        expect(calls.filter(([name]) => name === 'setupCredential')).toEqual([['setupCredential', {stepId: 'plane-credential'}], ['setupCredential', {stepId: 'provider-key'}]]);
        expect(calls.filter(([name]) => name === 'setupEffect').map(([, request]) => request.effectId), 'one consent per effect, in the recipe\'s order').toEqual(['write-secrets', 'write-env', 'compose-up', 'verify']);
        expect(calls.filter(([name]) => name === 'setupEvaluate').every(([, request]) => !request?.target), 'the card never names a target').toBe(true);
        expect(run.world.commands, 'one command reached the host').toHaveLength(1);
        expect(run.world.rows, 'one witness row').toHaveLength(1);

        // the completed run's density on the mounted provider: three answered questions and four consented
        // effects, no instruction handed to the operator, and the plane it is bound to
        expect(await readSetupRun(page)).toMatchObject({decisions: 7, manualActions: 0, preset: 'hosted', planeId: run.profile.planeId, dataRoot: run.profile.dataRoot})
    });

    test('a witness that does not land has a way out through the card: a waiting row says what it waits for, re-check searches and writes nothing, write again asks once where a second row is possible, and the run reaches done over one row', async ({page}) => {
        await page.goto('/apps/agentos/index.html');

        const
            card     = page.locator('.agent-plane-setup'),
            rows     = card.locator('.fm-setup-steps .neo-list-item'),
            row      = id => rows.filter({has: page.locator(`.fm-setup-step-id:text-is("${id}")`)}),
            chip     = (id, verb) => row(id).locator('.fm-setup-step-action', {hasText: verb}),
            progress = page.locator('.agent-setup-progress');

        await expect(card.locator('.fm-setup-preset')).toHaveCount(3, {timeout: 60000});
        await card.locator('.fm-setup-preset').first().locator('.fm-setup-preset-choose').click();
        await expect(row('preset')).toHaveClass(/is-ok/);
        await card.locator('.fm-setup-credential-button').click();
        await expect(row('plane-credential')).toHaveClass(/is-ok/);
        await chip('provider-key', 'open window').click();
        await expect(row('provider-key')).toHaveClass(/is-ok/);

        // every effect behind the next one waits, and says for which step, in place of a chip
        await expect(row('write-env').locator('.fm-setup-step-wait')).toHaveText('waits for write-secrets');
        await expect(row('verify').locator('.fm-setup-step-wait')).toHaveText('waits for write-secrets');
        await expect(row('verify').locator('.fm-setup-step-action')).toHaveCount(0);

        for (const id of ['write-secrets', 'write-env', 'compose-up']) {
            await chip(id, 'run').click();
            await expect(row(id), `${id} re-reads ok`).toHaveClass(/is-ok/)
        }

        // the witness is dispatched and its acknowledgement never arrives; no row lands
        run.world.dropWrite = true;
        await chip('verify', 'run').click();
        await expect(row('verify')).toHaveClass(/is-reconcile-required/);
        await expect(row('verify').locator('.fm-setup-step-action')).toHaveText(['re-check']);

        // re-check searches the plane for the attempt and writes nothing; the Brain then names the new attempt
        await chip('verify', 're-check').click();
        await expect(row('verify').locator('.fm-setup-step-action')).toHaveText(['re-check', 'write again']);
        await expect(chip('verify', 'write again')).toHaveClass(/is-quiet/);
        await expect(row('verify').locator('.fm-setup-step-reason')).toContainText('consent to a new attempt writes a second row');
        expect(run.world.rows, 'nothing was written').toEqual([]);

        // the first press says what the write can cost; the second sends it — to a plane that refuses it
        run.world.dropWrite   = false;
        run.world.refuseWrite = true;
        await chip('verify', 'write again').click();
        await expect(row('verify').locator('.fm-setup-step-confirm')).toContainText('a second row on the plane is possible');
        expect((await page.evaluate(() => window.__neoShellCalls)).filter(([name, request]) => name === 'setupEffect' && request.newAttempt), 'not sent yet').toEqual([]);

        await chip('verify', 'write again').click();
        await expect(row('verify')).toHaveClass(/is-failed/);
        await expect(row('verify').locator('.fm-setup-step-confirm')).toHaveCount(0);
        await expect(row('verify').locator('.fm-setup-step-action'), 'a refused write minted no row: one exit').toHaveText(['write again']);

        // the plane admits the write again: one press, no confirmation, and the run completes
        run.world.refuseWrite = false;
        run.world.recallLands = true;
        await chip('verify', 'write again').click();
        await expect(card).toBeHidden();
        await expect(progress).toHaveText('12 of 12 observed ok · complete');

        const verifyRequests = (await page.evaluate(() => window.__neoShellCalls)).filter(([name, request]) => name === 'setupEffect' && request.effectId === 'verify').map(([, request]) => request);

        expect(verifyRequests, 'run, the re-check, and the two consented new attempts').toEqual([{effectId: 'verify'}, {effectId: 'verify'}, {effectId: 'verify', newAttempt: true}, {effectId: 'verify', newAttempt: true}]);
        expect(run.world.rows, 'one witness row on the plane').toHaveLength(1)
    })
});
