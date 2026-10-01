import {test, expect} from '../../fixtures.mjs';

/**
 * @summary The Add agent form in the served cockpit: a blank required field's reason line sits clear of the next
 * field's floating label, and valid fields keep the form's gap. The form zeroes its fields' margins, and the engine
 * draws the reason below a field's fixed-height box, so the room for it is the form's to make.
 *
 * Run: NEO_E2E_PORT=8121 npx playwright test agentos/AddAgentForm -c test/playwright/playwright.config.e2e.mjs --workers=1
 *
 * @see resources/scss/src/apps/agentos/fleet/instances/AddAgentForm.scss
 */
test.describe('AgentOS Add agent form — a reason line takes its own room (#374)', () => {
    test.setTimeout(90000);

    test('a blank required field\'s reason ends above the next field\'s label, and valid fields keep the form\'s gap', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const tab = page.locator('.neo-dashboard-dock-rail-tab', {hasText: /^\s*Add agent\s*$/i}).first();

        await tab.click();
        await expect(tab).toHaveClass(/\bpressed\b/, {timeout: 10000});
        await expect(page.locator('.fm-add-agent-form').first()).toBeVisible({timeout: 30000});
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

        // the form's gap, and each field's box, its floating label's and its reason line's, by the input's name
        const read = () => page.evaluate(() => {
            const form = [...document.querySelectorAll('.fm-add-agent-form')].find(el => el.getClientRects().length),
                  box  = el => el && el.getClientRects().length ? (({bottom, top}) => ({bottom, top}))(el.getBoundingClientRect()) : null;

            return {
                gap   : parseFloat(getComputedStyle(form).rowGap),
                // in form order: the GitHub account (username, token), then the working repository
                fields: Object.fromEntries(['githubUsername', 'credential', 'repoSlug'].map(name => {
                    const field = form.querySelector(`input[name="${name}"]`).closest('.neo-textfield'),
                          error = field.querySelector('.neo-textfield-error');

                    return [name, {error: error?.textContent.trim() ? box(error) : null, field: box(field), label: box(field.querySelector('.neo-textfield-label'))}]
                }))
            }
        });

        const valid = await read(), {githubUsername, repoSlug, credential} = valid.fields;

        expect(credential.field.top - githubUsername.field.bottom, 'valid fields ride the form\'s gap alone').toBeCloseTo(valid.gap, 0);
        expect(repoSlug.field.top - credential.field.bottom).toBeCloseTo(valid.gap, 0);

        await page.locator('.fm-add-agent-form input[name="githubUsername"]').first().focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('.fm-add-agent-form .neo-textfield-error', {hasText: 'Required'}).first()).toBeVisible();

        const blank = await read(), after = blank.fields;

        expect(after.githubUsername.error, 'the blank username says why').not.toBeNull();
        expect(after.githubUsername.error.bottom, 'its reason ends above the next field\'s floating label').toBeLessThanOrEqual(after.credential.label.top);
        expect(after.repoSlug.field.top - after.credential.field.bottom, 'the valid fields below keep the gap').toBeCloseTo(blank.gap, 0)
    })
});
