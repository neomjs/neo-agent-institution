import {expect, test}         from '../../fixtures.mjs';
import {sampleShellInitScript} from '../../fixture/setupRecipeSample.mjs';

/**
 * @summary The shell spec's first-run witness on the served cockpit with a fixture shell: before the
 * app boots, the page carries a packaged, unconfigured `window.neoShell` whose setup channels answer
 * the recipe's cold `--json` — the same seam the vessel's preload exposes, so the cockpit runs its
 * real mount path. The setup card is the primary content, inline above the shell, on the Create
 * door; dismissing it before any step ran leaves the frame operable: the switcher stays live, the
 * Connect door is reachable from Home, and the cockpit's panes read their honest cold states. The
 * recipe's projected progress is the chrome's progress line.
 */
test.describe('AgentOS first run — the setup card projects the recipe inline, never as a gate', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({page}) => {
        await page.addInitScript(sampleShellInitScript())
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

        // the Create door is open: the recipe's eleven rows, the status in two channels, the reason verbatim
        await expect(card.locator('.fm-setup-create')).toBeVisible();
        await expect(card.locator('.fm-setup-steps .neo-list-item')).toHaveCount(11, {timeout: 30000});
        await expect(card.locator('.fm-setup-steps .neo-list-item').first()).toHaveClass(/is-ok/);
        await expect(card.locator('.fm-setup-steps .neo-list-item').nth(8).locator('.fm-setup-step-reason')).toHaveText('connection refused');
        await expect(card.locator('.fm-setup-steps .neo-list-item').nth(8).locator('.fm-setup-step-status')).toHaveText('unknown');

        // the three questions read the probe and the table; a refused preset stays visible, disabled, with its shortfall
        await expect(card.locator('.fm-setup-budget')).toHaveText('host 32.0 GiB total · 15.5 GiB available · pressure ok · VM 16.0 GiB cap · 13.5 GiB available');
        await expect(card.locator('.fm-setup-preset')).toHaveCount(3);
        await expect(card.locator('.fm-setup-preset').nth(1)).toHaveClass(/is-refused/);
        await expect(card.locator('.fm-setup-preset').nth(1).locator('.fm-setup-preset-verdict')).toHaveText('refused — the host budget falls 2.2 GiB short');

        // the chrome's progress line IS the recipe's projected progress
        await expect(page.locator('.agent-setup-progress')).toHaveText('2 of 11 observed ok · next: preset');

        // dismiss before any step ran
        await card.locator('.agent-plane-setup-dismiss').click();
        await expect(card).toBeHidden();

        // the frame stays operable: the switcher is live, the cockpit's panes read their cold states
        await expect(page.locator('.agent-top-toolbar .fm-instance-switcher, .agent-top-toolbar .neo-button').first()).toBeVisible();
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible();
        await expect(page.locator('.agent-setup-progress'), 'the progress line stays in the chrome').toHaveText('2 of 11 observed ok · next: preset');

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

    test('a preset choice is one consent re-evaluated by the shell; the credential step keeps a path and the page never holds a value', async ({page}) => {
        await page.goto('/apps/agentos/index.html');

        const card = page.locator('.agent-plane-setup');

        await expect(card.locator('.fm-setup-preset')).toHaveCount(3, {timeout: 60000});

        await card.locator('.fm-setup-preset').first().locator('.fm-setup-preset-choose').click();

        await expect(card.locator('.fm-setup-preset').first()).toHaveClass(/is-chosen/);
        await expect(card.locator('.fm-setup-steps .neo-list-item').nth(1)).toHaveClass(/is-ok/);
        await expect(page.locator('.agent-setup-progress')).toHaveText('3 of 11 observed ok · next: plane-credential');

        await card.locator('.fm-setup-credential-button').click();

        await expect(card.locator('.fm-setup-q-note').first()).toContainText('consented · /Users/op/.neo-ai/setup/credentials/plane-credential');
        await expect(card.locator('.fm-setup-steps .neo-list-item').nth(2)).toHaveClass(/is-ok/);

        const calls = await page.evaluate(() => window.__neoShellCalls);

        expect(calls.filter(([name]) => name === 'setupAnswer')).toEqual([['setupAnswer', {stepId: 'preset', answer: 'hosted'}]]);
        expect(calls.filter(([name]) => name === 'setupCredential')).toEqual([['setupCredential', {stepId: 'plane-credential'}]]);
        expect(await page.evaluate(() => document.body.innerHTML.includes('ghp_') || document.body.innerHTML.includes('glpat-')), 'no credential string in the DOM').toBe(false);

        // the vessel's effect channel: each run consents to one effect in the recipe's order, the
        // row re-reads ok; the third completes the run — the quiet confirmation fires once, the
        // card retires from the primary slot and the chrome's progress line reads complete
        const rows = card.locator('.fm-setup-steps .neo-list-item');

        // the hosted preset requires a provider key: its row got its window once the preset was
        // consented, and the window keeps the key as a file the same way
        await rows.nth(3).locator('.fm-setup-step-action').click();
        await expect(rows.nth(3), 'the provider key consented').toHaveClass(/is-ok/);

        for (const [index, id] of [[6, 'write-secrets'], [5, 'write-env']]) {
            await rows.nth(index).locator('.fm-setup-step-action').click();
            await expect(rows.nth(index), `${id} re-reads ok`).toHaveClass(/is-ok/)
        }

        // the third consent completes the run: the card retires in the same tick, so the quiet
        // confirmation is witnessed by the retirement and the chrome, not by a row
        await rows.nth(7).locator('.fm-setup-step-action').click();
        await expect(card).toBeHidden();
        await expect(page.locator('.agent-setup-progress')).toHaveText('11 of 11 observed ok · complete');

        const effects = (await page.evaluate(() => window.__neoShellCalls)).filter(([name]) => name === 'setupEffect').map(([, request]) => request.effectId);

        expect(effects, 'one consent per effect, in the recipe\'s order').toEqual(['write-secrets', 'write-env', 'compose-up'])
    })
});
