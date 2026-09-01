import {test, expect, loadAgentOsModule} from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

/**
 * @summary Starts a test-owned Fleet bridge whose roster is EMPTY: the first-run truth the cockpit
 * renders before any agent exists. Every other wire surface answers a deterministic failure so the
 * witness can never pass on a sample seed.
 * @returns {Promise<{bearerToken: String, close: Function, endpoint: String}>}
 */
async function startEmptyFleet() {
    const
        {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
        options                  = authenticatedFleetOptions({
            dispatch: async request => {
                switch (request.method) {
                    case 'resolveViewerIdentity':
                        return fleetE2ESuccess({ok: true, agentIdentityNodeId: '@e2e-operator'});
                    case 'fleetRoster':
                        return fleetE2ESuccess({rows: []});
                    case 'fleetActivity':
                        return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                    default:
                        return fleetE2EFailure(`unexpected empty-fleet method: ${request.method}`)
                }
            }
        }),
        server                   = await startFleetBridgeServer(options);

    return {
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => {
            // the brokered polls leave keep-alive sockets behind — without this, close waits out
            // the idle timeout and the witness eats its own budget
            server.closeAllConnections?.();
            server.close(resolve)
        })
    }
}

/**
 * @summary The empty fleet is the product's first-run moment (#69): with zero residents the roster
 * shows one thing — the path to the first agent — and it must read as the card region's centered
 * call to action in the family's ink, not as chrome parked at the pane bottom in a foreign colour.
 *
 * Proven on the mounted cockpit against a zero-row Fleet roster: the CTA's vertical center is the
 * card region's center (the controls row's bottom edge to the roster's bottom edge), and its label
 * and glyph compute to the ink the cockpit's own buttons wear — in both themes.
 *
 * @see apps/agentos/view/fleet/roster/Container.mjs
 */
test.describe('AgentOS fleet roster — the empty fleet\'s first-run CTA (#69)', () => {
    test.setTimeout(120000);

    test('the CTA centers in the card region and wears the family ink in both themes', async ({page, neuralLink}, testInfo) => {
        const fleet = await startEmptyFleet();

        try {
            await page.goto('/apps/agentos/index.html');
            await expect(page.locator('.fm-fleet-grid')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');

            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);

            expect(cockpit?.properties?.id, 'the FleetCockpit must exist in the App Worker').toBeTruthy();
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');

            await expect(page.locator('.fm-fleet-title')).toHaveText('Fleet · 0 agents', {timeout: 30000});

            const cta = page.locator('.fm-fleet-empty-cta');

            await expect(cta, 'an empty fleet renders its bootstrap CTA').toBeVisible();
            await expect(cta).toHaveText('Add your first agent');

            // ── placement: the CTA's vertical center IS the card region's center ────────────────
            const geometry = await page.evaluate(() => {
                const
                    rect     = selector => document.querySelector(selector).getBoundingClientRect(),
                    roster   = rect('.fm-fleet-grid'),
                    controls = rect('.fm-fleet-controls'),
                    button   = rect('.fm-fleet-empty-cta');

                return {
                    regionTop   : controls.bottom,
                    regionBottom: roster.bottom,
                    regionCenter: (controls.bottom + roster.bottom) / 2,
                    ctaCenter   : button.top + button.height / 2,
                    ctaHeight   : button.height
                }
            });

            expect(geometry.regionBottom - geometry.regionTop, 'the card region has room to center in')
                .toBeGreaterThan(geometry.ctaHeight * 3);
            expect(Math.abs(geometry.ctaCenter - geometry.regionCenter),
                `the CTA (center ${geometry.ctaCenter}px) sits on the card region's center (${geometry.regionCenter}px)`)
                .toBeLessThanOrEqual(2);

            // ── colour: label and glyph wear the family ink, in both themes ─────────────────────
            const
                [viewport]    = await app.queryComponent({className: 'AgentOS.view.Viewport'}, ['id', 'theme']),
                viewportState = await app.getComponent(viewport.properties.id, ['controller']),
                controllerId  = viewportState.controller.id,
                viewportDom   = page.locator('.agent-os-viewport');

            for (const theme of ['neo-theme-neo-dark', 'neo-theme-neo-light']) {
                await app.callMethod(controllerId, 'setTheme', [theme, false]);
                await expect(viewportDom).toHaveClass(new RegExp(`\\b${theme}\\b`));

                const colours = await page.evaluate(() => {
                    // the ink as THIS theme resolves it, read through a probe rather than a token string
                    const probe = document.createElement('span');

                    probe.style.color = 'var(--fm-ink)';
                    document.querySelector('.fm-fleet-grid').append(probe);

                    const
                        ink   = getComputedStyle(probe).color,
                        text  = document.querySelector('.fm-fleet-empty-cta .neo-button-text'),
                        glyph = document.querySelector('.fm-fleet-empty-cta .neo-button-glyph');

                    probe.remove();

                    return {
                        ink,
                        text : text  ? getComputedStyle(text).color  : null,
                        glyph: glyph ? getComputedStyle(glyph).color : null
                    }
                });

                expect(colours.text,  `${theme}: the label wears the family ink`).toBe(colours.ink);
                expect(colours.glyph, `${theme}: the plus glyph wears the family ink`).toBe(colours.ink);

                // ── the interaction states: the Engine re-paints a button's plate, border, label and
                // glyph from its `-hover` / `-active` tokens (`.neo-button:hover` / `:active`, 0,2,0),
                // so a CTA that only sets the resting tokens reverts to the theme's reversed ink and
                // primary surface the moment it is touched — the filed defect, one state deeper.
                const readState = () => page.evaluate(() => {
                    const
                        grid  = document.querySelector('.fm-fleet-grid'),
                        probe = token => {
                            const span = document.createElement('span');

                            span.style.color = `var(${token})`;
                            grid.append(span);

                            const value = getComputedStyle(span).color;

                            span.remove();

                            return value
                        },
                        cta   = document.querySelector('.fm-fleet-empty-cta'),
                        style = getComputedStyle(cta);

                    return {
                        ink               : probe('--fm-ink'),
                        themeHoverSurface : probe('--button-background-color-hover'),
                        themeActiveSurface: probe('--button-background-color-active'),
                        background        : style.backgroundColor,
                        borderStyle       : style.borderTopStyle,
                        text              : getComputedStyle(cta.querySelector('.neo-button-text')).color,
                        glyph             : getComputedStyle(cta.querySelector('.neo-button-glyph')).color
                    }
                });

                const box = await cta.boundingBox();

                // hover: the pointer rests on the CTA
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

                const hovered = await readState();

                expect(hovered.text,        `${theme}: the label keeps the family ink under hover`).toBe(hovered.ink);
                expect(hovered.glyph,       `${theme}: the glyph keeps the family ink under hover`).toBe(hovered.ink);
                expect(hovered.borderStyle, `${theme}: the dashed plate survives hover`).toBe('dashed');
                expect(hovered.background,  `${theme}: hover does not swap the plate for the theme's primary surface`).not.toBe(hovered.themeHoverSurface);

                // press: the button is held down (released off the button, so no click fires)
                await page.mouse.down();

                const pressed = await readState();

                await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40);
                await page.mouse.up();

                expect(pressed.text,        `${theme}: the label keeps the family ink under press`).toBe(pressed.ink);
                expect(pressed.glyph,       `${theme}: the glyph keeps the family ink under press`).toBe(pressed.ink);
                expect(pressed.borderStyle, `${theme}: the dashed plate survives the press`).toBe('dashed');
                expect(pressed.background,  `${theme}: the press does not swap the plate for the theme's primary surface`).not.toBe(pressed.themeActiveSurface);

                // the human receipt beside the DOM receipt: the empty roster as the operator sees it
                await page.screenshot({path: testInfo.outputPath(`empty-fleet-${theme}.png`)})
            }
        } finally {
            await fleet.close()
        }
    })
});
