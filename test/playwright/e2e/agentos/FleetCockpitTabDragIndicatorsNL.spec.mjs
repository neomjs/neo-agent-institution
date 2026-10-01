import {test, expect} from '../../fixtures.mjs';

/**
 * Whitebox-e2e for the cockpit's in-window dock drag feedback: a tab header held over another
 * cockpit pane must be answered by the engine's drop-indicator menu, and releasing on an indicator
 * must commit exactly one dock operation through the cockpit's reducer.
 *
 * The engine composes that tier (preview renderer, indicator menu, gesture controller) through the
 * workspace's window Participation on first use; a workspace that never creates one drags a header
 * into a layout that never answers — the operator's 2026-10-01 observation in the installed shell,
 * reproduced headless in the served cockpit (zero indicators, DragCoordinator `claimTrace: []`).
 *
 * Indicator DOM is the engine's: `neo-dashboard-dock-drop-indicator` chips inside the
 * `neo-dashboard-dock-drop-indicators` menu (`src/dashboard/dock/interaction/DropIndicators.mjs`);
 * the permanent `neo-dashboard-dock-edge-zone` on the cockpit root is a zone container, never an
 * indicator, so it is deliberately not matched here.
 *
 * Run: NEO_E2E_PORT=8117 npx playwright test agentos/FleetCockpitTabDragIndicatorsNL -c test/playwright/playwright.config.e2e.mjs --workers=1
 */
test.describe('AgentOS Fleet cockpit — tab-header drag shows drop indicators and commits (Neural Link)', () => {
    test.setTimeout(90000);

    test('a held tab header over the other pane raises the indicator menu; releasing on it commits one operation', async ({page, neuralLink}) => {
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

        const cockpit = page.locator('.fm-fleet-cockpit');
        await expect(cockpit).toBeVisible({timeout: 30000});
        await expect(page.locator('[class*="dock-flip-item-fleet"]').first()).toBeVisible();
        await expect(page.locator('[class*="dock-flip-item-stream"]').first()).toBeVisible();

        const app      = await neuralLink.connectToApp('AgentOS'),
              cockpits = await app.findInstances({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
              holderId = Array.isArray(cockpits) ? cockpits[0]?.id : cockpits?.id;

        expect(holderId, 'the FleetCockpit must exist in the App Worker').toBeTruthy();

        const readDocument = async () => {
            const topo = await app.getDockTopology(holderId);
            return topo?.document ?? topo
        };

        const doc0        = await readDocument(),
              fleetItems  = doc0.nodes['fleet-tabs'].items,
              streamItems = doc0.nodes['stream-tabs'].items,
              draggedId   = fleetItems[0];

        expect(draggedId, 'the fleet zone holds an item to drag').toBeTruthy();
        expect(streamItems.includes(draggedId), 'the dragged item starts outside the stream zone').toBe(false);

        // the first header of the fleet zone is the dragged item's tab; the stream pane is the target
        const header   = cockpit.locator('.neo-tab-header-button').first(),
              hBox     = await header.boundingBox(),
              stream   = page.locator('[class*="dock-flip-item-stream"]').first(),
              sBox     = await stream.boundingBox(),
              menu     = page.locator('.neo-dashboard-dock-drop-indicators'),
              chips    = page.locator('.neo-dashboard-dock-drop-indicator'),
              active   = page.locator('.neo-dashboard-dock-drop-indicator-active');

        // the menu is a persistent overlay: its chips exist at rest and the engine hides the layer
        // by class until a gesture supplies a candidate set
        await expect(menu, 'the indicator menu is mounted at rest').toHaveCount(1);
        await expect(menu, 'the indicator menu is hidden before the drag').toHaveClass(/neo-dashboard-dock-drop-indicators-hidden/);
        await expect(active, 'no chip is active before the drag').toHaveCount(0);

        // real pointer cadence: clear the drag threshold inside the header first, then travel
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(hBox.x + hBox.width / 2 + 14, hBox.y + hBox.height / 2 + 6, {steps: 4});
        await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2, {steps: 20});

        // AC-1: the menu answers the held header — chips exist, one of them is the active candidate,
        // and the coordinator has claimed a target zone for the gesture
        await expect(menu, 'the indicator menu shows for a held header').not.toHaveClass(/neo-dashboard-dock-drop-indicators-hidden/, {timeout: 2000});
        await expect.poll(() => chips.count(), {message: 'the menu renders at least one indicator chip', timeout: 2000}).toBeGreaterThan(0);
        await expect(active, 'the chip under the pointer is the active candidate').toHaveCount(1, {timeout: 2000});
        // the in-window tier is the gesture controller's, not the cross-window coordinator's: the
        // `…-indicator-active` class IS the App Worker's active candidate, written by the menu's
        // own `afterSetActiveCandidate`; the committed document below is the release-side truth
        const menus = await app.findInstances({className: 'Neo.dashboard.dock.interaction.DropIndicators'}, ['id']);
        expect(Array.isArray(menus) ? menus.length : (menus ? 1 : 0), 'the cockpit composes exactly one indicator menu').toBe(1);

        // AC-2: release on the active candidate → exactly one operation commits through the reducer
        const activeBox = await active.boundingBox();
        await page.mouse.move(activeBox.x + activeBox.width / 2, activeBox.y + activeBox.height / 2, {steps: 6});
        await page.waitForTimeout(100);
        await page.mouse.up();

        await expect.poll(async () => {
            const doc = await readDocument();
            return Object.values(doc.nodes).some(node => node !== doc.nodes['fleet-tabs'] && node.items?.includes(draggedId))
        }, {message: 'the dropped item leaves the fleet zone through the committed document', timeout: 10000, intervals: [100]}).toBe(true);

        // the committed document is the commit witness; `getDockTopology().operations` is the
        // executable vocabulary, not a history, so it is deliberately not counted here
        const docAfter = await readDocument();

        expect(fleetItems.filter(itemId => itemId !== draggedId).every(itemId => docAfter.nodes['fleet-tabs'].items.includes(itemId)),
            'the fleet zone keeps every item that was not dragged').toBe(true);

        await expect(menu, 'the menu hides again after the release').toHaveClass(/neo-dashboard-dock-drop-indicators-hidden/, {timeout: 2000});
        await expect(active, 'no chip stays active after the release').toHaveCount(0)
    });
});
