import {PALETTES} from '../../../../apps/agentos/canvas/fmPalette.mjs';
import {readFileSync}                          from 'node:fs';
import {sampleRoster}                          from '../../fixture/fleetSample.mjs';
import {expect, landFleetRoster, landFleetSample, test} from '../../fixtures.mjs';

const
    engineGlobal  = '/dist/development/css/theme-neo/Global.css',
    fleetGlobal   = '/dist/development/css/theme-neo/apps/agentos/Global.css',
    paintRoles    = {
        backgroundColor: '--neo-color-background-accent',
        color          : '--neo-color-text-on-accent'
    };

/**
 * @summary Resolves the expected tooltip colors from the installed Engine and Fleet source sheets.
 * @param {String} scheme
 * @returns {Promise<Object>}
 */
async function resolveFleetTooltipPaint(scheme) {
    const {readThemeDeclarations, resolveValue} = await import('../../../../node_modules/neo.mjs/buildScripts/util/check-theme-palette.mjs');
    const theme = `neo-theme-neo-${scheme}`;
    const read = path => readThemeDeclarations(readFileSync(new URL(path, import.meta.url), 'utf8')).get(theme);
    const declarations = new Map([
        ...read('../../../../node_modules/neo.mjs/resources/css/theme-neo/Global.css'),
        ...read('../../../../resources/css/theme-neo/apps/agentos/Global.css')
    ]);

    return Object.fromEntries(Object.entries(paintRoles).map(([property, role]) => {
        const value = resolveValue(`var(${role})`, declarations, scheme);

        expect(value, `${theme} declares ${role}`).toBeTruthy();
        return [property, value]
    }))
}

/**
 * @summary Reads the nine live Fleet tokens as the opaque sRGB bytes a canvas can draw.
 * @param {Object} page
 * @returns {Promise<Object>}
 */
function readFleetCanvasPaint(page) {
    return page.locator('.agent-os-viewport').first().evaluate(scope => {
        const probe  = document.createElement('span'),
              canvas = document.createElement('canvas'),
              tokens = {
                  ink: 'ink', inkDim: 'ink-dim', signal: 'signal', route: 'route',
                  line: 'line', lineSoft: 'line-soft', ground: 'ground', panel: 'panel', panel2: 'panel-2'
              };

        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');

        probe.style.position = 'absolute';
        scope.append(probe);

        try {
            return Object.fromEntries(Object.entries(tokens).map(([key, token]) => {
                const name = '--fm-' + token;

                if (!getComputedStyle(probe).getPropertyValue(name).trim()) {
                    throw new Error('Missing Fleet canvas token ' + name)
                }

                probe.style.color = 'var(' + name + ')';
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = getComputedStyle(probe).color;
                context.fillRect(0, 0, 1, 1);

                const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;

                if (alpha !== 255) {
                    throw new Error('Non-opaque Fleet canvas token ' + name)
                }

                return [key, '#' + [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')]
            }))
        } finally {
            probe.remove()
        }
    })
}

/**
 * @summary Checks the loaded stylesheets, resolved roles, and painted colors of a built-in tooltip.
 * @param {Object} page
 * @param {Object} trigger
 * @param {String} text
 * @param {String} surface
 * @param {Object} proof
 * @returns {Promise<void>}
 */
async function expectFleetTooltipPaint(page, trigger, text, surface, proof) {
    const paths = [engineGlobal, fleetGlobal];
    const links = await page.evaluate(() => Array.from(document.styleSheets, sheet => sheet.href && new URL(sheet.href).pathname));
    const requests = proof.responses.get(page);

    expect(links, `${surface} loaded both palette stylesheets`).toEqual(expect.arrayContaining(paths));

    for (const path of paths) {
        expect([200, 304], `${surface} stylesheet response for ${path}`).toContain(requests?.get(path))
    }

    await test.info().attach(`${surface}-palette-stylesheets`, {
        contentType: 'application/json',
        body       : JSON.stringify(Object.fromEntries(requests))
    });

    await trigger.hover();
    const tooltip = page.locator('.neo-tooltip:visible').filter({hasText: text});

    await expect(tooltip).toBeVisible();

    const result = await tooltip.evaluate((node, {expected, roles}) => {
        const probe = document.createElement('span');

        probe.style.position = 'absolute';
        node.append(probe);

        try {
            const style = getComputedStyle(node);
            const normalize = (backgroundColor, color) => {
                probe.style.backgroundColor = backgroundColor;
                probe.style.color = color;

                const computed = getComputedStyle(probe);
                return {backgroundColor: computed.backgroundColor, color: computed.color}
            };

            return {
                paint    : {backgroundColor: style.backgroundColor, color: style.color},
                roles    : normalize(`var(${roles.backgroundColor})`, `var(${roles.color})`),
                expected : normalize(expected.backgroundColor, expected.color),
                floating : !node.closest('.agent-os-viewport')
            }
        } finally {
            probe.remove()
        }
    }, {expected: proof.expected, roles: paintRoles});

    expect(result.floating, `${surface} uses the built-in floating tooltip`).toBe(true);
    expect(result.roles, `${surface} tooltip resolves Fleet's palette roles`).toEqual(result.expected);
    expect(result.paint, `${surface} tooltip paints Fleet's foreground and background`).toEqual(result.expected);
    await page.mouse.move(0, 0)
}

/**
 * Whitebox-e2e for the cockpit's click pop-out: the agent-detail inspector detaches to a REAL
 * second browser window while staying on the ONE SharedWorker App-Worker heap, and comes home —
 * reparent-never-recreate, live through every phase, with the SHELL owning the affordance and the
 * ENGINE owning the vessel lifecycle (the pane carries zero dock semantics):
 *
 * 1. drill: the controller seam seats a resident and reveals the detail inspector (the standard
 *    commit loop);
 * 2. detach: the pane's window-toggle enters the engine's own admission path (the same one the tab
 *    header's pop-out action takes) — the widget-childapp vessel opens, the ONE detach commit prunes
 *    the `detail` item but keeps its catalog record (Neural Link topology stays truthful), the vessel
 *    binds to its reserved Group slot and the SAME AgentDetail instance (App-Worker id) renders in it;
 * 3. live continuity: selecting a DIFFERENT resident from the MAIN window re-renders the
 *    popped-out inspector — main-window intent → App Worker → popup render target, no remount;
 * 4. return: the SAME toggle closes the vessel — vessel death IS the return path — and the engine
 *    brings the item home at its EXACT recorded index, the SAME instance rendering docked with the
 *    state it gathered while windowed.
 *
 * The full gesture-driven drill tour (card → detail → pop-out → return as a narrated journey)
 * is the drill-e2e sibling leaf's scope; this witness proves the capability spine it builds on.
 *
 * Run: NEO_E2E_PORT=8119 npx playwright test agentos/FleetCockpitPopOutNL -c test/playwright/playwright.config.e2e.mjs --workers=1
 */
test.describe('AgentOS Fleet cockpit — agent-detail pop-out round-trip (Neural Link)', () => {
    test.setTimeout(120000);

    const runRoundTrip = async (page, neuralLink, scheme, paletteProof) => {
        const pageErrors = [];

        page.on('pageerror', error => {
            const value = error == null ? '' : String(error.stack || error.message || error);
            value && value !== 'undefined' && pageErrors.push(value)
        });

        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

        const theme = `neo-theme-neo-${scheme}`,
              themePattern = new RegExp(`\\b${theme}\\b`),
              effectiveTheme = locator => locator.evaluate(node => {
                  for (let current = node; current; current = current.parentElement) {
                      const value = [...current.classList].find(name => /^neo-theme-neo-(light|dark)$/.test(name));
                      if (value) return value;
                  }
                  return null
              });

        if (scheme === 'light') await page.locator('.agent-theme-button').click();
        await expect(page.locator('body')).toHaveClass(themePattern);
        await expect.poll(() => effectiveTheme(page.locator('.neo-viewport').first())).toBe(theme);

        if (paletteProof) {
            await expectFleetTooltipPaint(page, page.locator('.agent-theme-button'), 'Switch theme', 'Shell', paletteProof);
            expect(await readFleetCanvasPaint(page), 'the canvas worker mirrors the live Fleet colors').toEqual(PALETTES[scheme])
        }

        // 1) drill through the REAL controller seam (onAgentSelect: owner-held record + the
        // setItemAutoHidden reveal through the commit loop). Driven via callMethod because the
        // card-click → agentSelect DOM chain is regressed on dev (own bug ticket; the full
        // gesture journey belongs to the drill-e2e sibling leaf) — the seam below the gesture is
        // the production path. The tests' sample fleet lands as the fleet's answer first — nothing
        // is seeded any more.
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});
        await landFleetSample(page, {roster: !paletteProof});
        if (paletteProof) {
            await landFleetRoster(page, sampleRoster.map(row => ({...row, repoPath: '/fixture/fleet-palette'})))
        }
        await expect(page.locator('.fm-agent-card').first()).toBeVisible({timeout: 30000});

        const app   = await neuralLink.connectToApp('AgentOS'),
              cards = await app.queryComponent({className: 'AgentOS.view.fleet.roster.card.Container'}, ['record', 'id']);

        expect(cards.length, 'the fleet renders cards with records').toBeGreaterThan(1);

        const controllers  = await app.findInstances({className: 'AgentOS.view.fleet.cockpit.Controller'}, ['id']),
              controllerId = (Array.isArray(controllers) ? controllers[0] : controllers)?.id,
              firstAgentId = cards[0]?.properties?.record?.agentId;

        expect(controllerId, 'the cockpit controller must exist in the App Worker').toBeTruthy();
        expect(firstAgentId, 'the first card carries a resident record').toBeTruthy();

        await app.callMethod(controllerId, 'onAgentSelect', [{agentId: firstAgentId}]);

        const detailRoot = page.locator('.fm-agent-detail');

        await expect(detailRoot).toBeVisible({timeout: 30000});

        // the selection holds the railed detail revealed, and the reveal's toolbar carries the ONE
        // pop-out verb; the SHELL's pane-side verb is the way home and renders only while the pane
        // is away in a vessel — so the detail strip carries no toggle here
        const toggle       = page.locator('.fm-detail-window-toggle'),
              popOutAction = page.locator('.neo-dashboard-dock-reveal-overlay:not(.neo-dashboard-dock-reveal-overlay-hidden)')
                  .filter({has: page.locator('.fm-agent-detail')})
                  .locator('.neo-dashboard-dock-reveal-pop-out');

        await expect(toggle).toHaveCount(0);
        await expect(popOutAction).toBeVisible();

        const cockpits = await app.findInstances({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
              holderId = (Array.isArray(cockpits) ? cockpits[0] : cockpits)?.id,
              details  = await app.findInstances({className: 'AgentOS.view.fleet.detail.Container'}, ['id']),
              detail0  = Array.isArray(details) ? details[0] : details,
              detailId = detail0?.id;

        expect(holderId, 'the FleetCockpit must exist in the App Worker').toBeTruthy();
        expect(detailId, 'the AgentDetail must exist in the App Worker').toBeTruthy();

        const queryDetail = async () => {
            const matches = await app.queryComponent({className: 'AgentOS.view.fleet.detail.Container'}, ['record', 'id']);
            return (Array.isArray(matches) ? matches : [matches]).find(candidate => candidate?.id === detailId)
        };

        // the Group's committed ownership for the item — the one vessel truth the shell reads
        const queryVesselOwned = () => app.callMethod(holderId, 'isVesselOwned', ['detail']);

        const drilledAgentId = (await queryDetail())?.properties?.record?.agentId;

        expect(drilledAgentId, 'the drill seated a resident record').toBeTruthy();
        expect(await queryVesselOwned()).toBe(false);

        const topoDocked = await app.getDockTopology(holderId),
              docDocked  = topoDocked?.document ?? topoDocked;

        expect(docDocked.nodes['secondary-rail'].items).toContain('detail');

        const homeIndexBefore = docDocked.nodes['secondary-rail'].items.indexOf('detail');

        // 2) detach: ONE native click on the reveal's pop-out enters the engine's admission and
        // opens the REAL vessel window over the reveal's pane slot
        const popupPromise = page.waitForEvent('popup', {timeout: 30000});

        await popOutAction.click();

        const popup       = await popupPromise,
              popupErrors = [];

        popup.on('pageerror', error => {
            const value = error == null ? '' : String(error.stack || error.message || error);
            value && value !== 'undefined' && popupErrors.push(value)
        });

        // assert the URL only after the vessel's content proves navigation happened: right after
        // the popup event, `domcontentloaded` can belong to the initial about:blank document and
        // url() reads '' — the pre-existing race the sibling journeys never hit because they wait
        // on a selector first
        await popup.waitForLoadState('domcontentloaded');
        await expect(popup.locator('.fm-agent-detail')).toBeVisible({timeout: 30000});
        expect(popup.url()).toContain('childapps/widget/index.html');
        expect(popup.url()).toContain('tearout=detail');
        await expect(popup.locator('body'), 'the detached window follows the opener').toHaveClass(themePattern);
        await expect.poll(() => effectiveTheme(popup.locator('.neo-viewport').first())).toBe(theme);
        await expect.poll(() => effectiveTheme(popup.locator('.fm-agent-detail'))).toBe(theme);
        expect(new URL(popup.url()).searchParams.get('theme')).toBe(theme);

        if (paletteProof) {
            await expectFleetTooltipPaint(popup, popup.locator('.fm-detail-repo-copy'), 'Copy the clone path', 'Detached Detail', paletteProof);

            if (scheme === 'dark') {
                await page.locator('.agent-theme-button').click();
                await expect(page.locator('body')).toHaveClass(/\bneo-theme-neo-light\b/);
                await expect(popup.locator('body')).toHaveClass(/\bneo-theme-neo-light\b/);
                await expect.poll(() => effectiveTheme(popup.locator('.fm-agent-detail'))).toBe('neo-theme-neo-light');

                const lightProof = {...paletteProof, expected: await resolveFleetTooltipPaint('light')};

                await expectFleetTooltipPaint(page, page.locator('.agent-theme-button'), 'Switch theme', 'Shell after switch', lightProof);
                await expectFleetTooltipPaint(popup, popup.locator('.fm-detail-repo-copy'), 'Copy the clone path', 'Detached Detail after switch', lightProof);
                expect(await readFleetCanvasPaint(page), 'the canvas mirror follows the Light switch').toEqual(PALETTES.light);

                await page.locator('.agent-theme-button').click();
                await expect(page.locator('body')).toHaveClass(themePattern);
                await expect(popup.locator('body')).toHaveClass(themePattern);
                await expect.poll(() => effectiveTheme(popup.locator('.fm-agent-detail'))).toBe(theme)
            }
        }

        // the SAME live instance renders in the popup; the main window no longer shows it
        await expect(popup.locator('.fm-agent-detail')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-agent-detail')).toHaveCount(0);

        // the Group recorded committed ownership: the vessel owns the item, and the traveling
        // toggle names the way home
        await expect.poll(queryVesselOwned, {timeout: 15000}).toBe(true);

        // the reveal ended as the item leaving its rail, not as the person's dismissal: the
        // selection stays
        const selected = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['detailRecord.agentId']);

        expect(selected[0].properties['detailRecord.agentId'], 'the pop-out keeps the selection').toBe(drilledAgentId);
        await expect(popup.locator('.fm-detail-window-toggle')).toHaveAttribute('aria-label', 'Return detail');

        // document truth while detached: out of the tree, still in the catalog
        const topoDetached = await app.getDockTopology(holderId),
              docDetached  = topoDetached?.document ?? topoDetached;

        expect(docDetached.nodes['secondary-rail'].items).not.toContain('detail');
        expect(docDetached.items.detail, 'detachItem keeps the catalog record').toBeTruthy();

        expect((await queryDetail())?.properties?.record?.agentId).toBe(drilledAgentId);

        // 3) live continuity: a MAIN-window drill re-renders the WINDOWED inspector —
        // one heap, two render targets, zero remounts
        const secondAgentId = cards
            .map(candidate => candidate?.properties?.record?.agentId)
            .find(agentId => agentId && agentId !== drilledAgentId);

        expect(secondAgentId, 'a second resident exists to drill into').toBeTruthy();
        await app.callMethod(controllerId, 'onAgentSelect', [{agentId: secondAgentId}]);

        await expect
            .poll(async () => (await queryDetail())?.properties?.record?.agentId, {
                message: 'the detached inspector must re-seat onto the newly selected resident',
                timeout: 15000
            })
            .not.toBe(drilledAgentId);

        const reseatedAgentId = (await queryDetail())?.properties?.record?.agentId;

        // the POPUP's DOM renders the re-seated resident — worker truth reached the second window
        await expect
            .poll(async () => (await popup.locator('.fm-detail-id').textContent())?.trim(), {timeout: 15000})
            .toBe(reseatedAgentId);

        // 4) return via the SAME toggle, now in the vessel: it closes the vessel window, the Group
        // observes the release, and the engine re-trees the item at its EXACT recorded index — the
        // SAME instance renders docked with the state it gathered while windowed
        const popupClosed = popup.waitForEvent('close', {timeout: 30000});

        await popup.locator('.fm-detail-window-toggle').click();
        await popupClosed;

        await expect(page.locator('.fm-agent-detail')).toBeVisible({timeout: 30000});
        await expect.poll(queryVesselOwned, {timeout: 15000}).toBe(false);

        const topoHome = await app.getDockTopology(holderId),
              docHome  = topoHome?.document ?? topoHome;

        expect(docHome.nodes['secondary-rail'].items).toContain('detail');
        expect(docHome.nodes['secondary-rail'].items.indexOf('detail'), 'exact-index restore — never an append').toBe(homeIndexBefore);

        const home      = await app.findInstances({className: 'AgentOS.view.fleet.detail.Container'}, ['id']),
              homeIds   = (Array.isArray(home) ? home : [home]).map(entry => entry?.id),
              homeState = await queryDetail();

        expect(homeIds, 'exactly one AgentDetail instance exists — never a recreation').toEqual([detailId]);
        expect(homeState?.properties?.record?.agentId, 'the windowed-phase selection came home with the instance').toBe(reseatedAgentId);

        expect(pageErrors, 'zero main-window page errors').toEqual([]);
        await expect(page.locator('body')).toHaveClass(themePattern);
        expect(popupErrors, 'zero popup page errors').toEqual([])
    };

    test('detaches, follows live selection and returns on the same heap in Light', ({page, neuralLink}) =>
        runRoundTrip(page, neuralLink, 'light'));
    test('detaches, follows live selection and returns on the same heap in Dark', ({page, neuralLink}) =>
        runRoundTrip(page, neuralLink, 'dark'));

    for (const scheme of ['dark', 'light']) {
        test(`Fleet palette styles and paints floating tooltips in both windows in ${scheme}`, async ({page, neuralLink}) => {
            const context   = page.context();
            const responses = new Map();
            const track     = response => {
                const path = new URL(response.url()).pathname;

                if (path === engineGlobal || path === fleetGlobal) {
                    const window = response.frame().page();
                    const sheets = responses.get(window) ?? new Map();

                    sheets.set(path, response.status());
                    responses.set(window, sheets)
                }
            };

            context.on('response', track);
            try {
                await runRoundTrip(page, neuralLink, scheme, {expected: await resolveFleetTooltipPaint(scheme), responses})
            } finally {
                context.off('response', track)
            }
        })
    }
});
