import {test, expect} from '../../fixtures.mjs';

/**
 * Whitebox-e2e for the cockpit's dock projection commit loop — the live half of the §01
 * mission-control layout: the committed `dockZone.v1` document is the layout SSOT, the visible
 * tree is its projection, and the full dock-holder contract works on the mounted cockpit:
 * 1. the initial projection RENDERS (both live panes + the primary splitter in the DOM);
 * 2. the READ half (`getDockZoneDocument`) serves Neural Link topology before any operation;
 * 3. a REAL pointer drag on the projected splitter commits `resizeSplit` through the reducer /
 *    view-sync split — the document advances, the reconciler takes its geometry fast path
 *    (`resizeSplit` declares the `geometry` change class): the ONE live splitter
 *    instance and its DOM node survive the commit, the pane sizes re-project from the committed
 *    ratio, and the toolbar plus keeper panes preserve component and DOM identity;
 * 4. the WRITE half (`executeDockOperation`) round-trips the same loop programmatically — a
 *    human drag and an NL operation are the same commit path, and the same retained identity.
 *
 * Post-commit witnesses deliberately pair App Worker identity through the Neural Link with exact
 * DOM-node identity. A geometry commit replaces nothing: splitter, toolbar and pane nodes all
 * carry through the reconciled shell; only a topology change stages a new shell.
 *
 * State-relative throughout (the SharedWorker heap is shared across a sweep): every target
 * derives from the CURRENT committed sizes, never from assumed seeds.
 *
 * Run: NEO_E2E_PORT=8117 npx playwright test agentos/FleetCockpitDockNL -c test/playwright/playwright.config.e2e.mjs --workers=1
 */
test.describe('AgentOS Fleet cockpit — dock projection commit loop (Neural Link)', () => {
    test.setTimeout(90000);

    test('the mounted cockpit projects the committed document; splitter drag + NL operation both commit through the reducer', async ({page, neuralLink}) => {
        const pageErrors    = [],
              runtimeErrors = [];

        await page.context().exposeFunction('__recordFleetProjectionRuntimeError', payload => runtimeErrors.push(payload));
        await page.context().addInitScript(() => {
            globalThis.addEventListener('error', event => {
                globalThis.__recordFleetProjectionRuntimeError({
                    column : event.colno,
                    line   : event.lineno,
                    message: event.message,
                    source : event.filename,
                    type   : 'error'
                })
            });
            globalThis.addEventListener('unhandledrejection', event => {
                globalThis.__recordFleetProjectionRuntimeError({
                    reason: String(event.reason?.stack || event.reason?.message || event.reason),
                    type  : 'unhandledrejection'
                })
            })
        });
        page.on('pageerror', error => {
            const value = error == null ? '' : String(error.stack || error.message || error);
            value && value !== 'undefined' && pageErrors.push(value)
        });

        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

        // 1) the initial projection renders: Fleet is the default keeper-view (mission control
        // first) — the primary split projects its splitter, both live panes mount in their zones
        const splitter = page.locator('.fm-fleet-cockpit .neo-dashboard-dock-splitter').first();
        await expect(splitter, 'the projected primary split must render a splitter').toBeVisible({timeout: 30000});
        await expect(page.locator('[class*="dock-flip-item-fleet"]').first()).toBeVisible();
        await expect(page.locator('[class*="dock-flip-item-stream"]').first()).toBeVisible();

        const app      = await neuralLink.connectToApp('AgentOS'),
              cockpits = await app.findInstances({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
              holderId = Array.isArray(cockpits) ? cockpits[0]?.id : cockpits?.id;

        expect(holderId, 'the FleetCockpit must exist in the App Worker').toBeTruthy();

        // 2) READ half of the dock-holder contract: topology serves BEFORE any operation ran
        const topo0  = await app.getDockTopology(holderId),
              doc0   = topo0?.document ?? topo0,
              sizes0 = doc0.nodes['primary-split'].sizes;

        expect(doc0.nodes['primary-split'].children).toEqual(['fleet-tabs', 'stream-tabs']);
        // the final model reads nested zone descriptors only: the center names its node, the right
        // edge carries the committed extent + resizable policy the splitter and the reveal both read
        expect(doc0.nodes['cockpit-root'].zones.center).toEqual({nodeId: 'primary-split'});
        expect(doc0.nodes['cockpit-root'].zones.right).toEqual({nodeId: 'secondary-rail', extent: 0.25, resizable: true});

        const fleetGrids = await app.findInstances({className: 'AgentOS.view.fleet.roster.Container'}, ['id']),
              streams    = await app.findInstances({className: 'AgentOS.view.fleet.activity.Container'}, ['id']),
              identity   = {
                  fleetGrid: (Array.isArray(fleetGrids) ? fleetGrids[0] : fleetGrids)?.id,
                  stream   : (Array.isArray(streams) ? streams[0] : streams)?.id,
                  toolbar  : await page.locator('.fm-cockpit-bar').getAttribute('id')
              },
              splitterId0 = await splitter.getAttribute('id');

        expect(Object.values(identity).every(Boolean), 'toolbar and keeper pane component ids are mounted').toBe(true);
        expect(splitterId0, 'the projection holds one live splitter instance').toBeTruthy();
        expect(await page.evaluate(({identity, splitterId}) => {
            globalThis.__fleetProjectionIdentity = {
                ...Object.fromEntries(Object.entries(identity).map(([key, id]) => [key, document.getElementById(id)])),
                splitter: document.getElementById(splitterId)
            };

            return Object.values(globalThis.__fleetProjectionIdentity).every(Boolean)
        }, {identity, splitterId: splitterId0}), 'all permanence targets start as exact mounted DOM nodes').toBe(true);

        const assertPersistentIdentity = async message => {
            expect(await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([key, id]) => [
                key,
                globalThis.__fleetProjectionIdentity?.[key] === document.getElementById(id)
            ])), identity), message).toEqual({fleetGrid: true, stream: true, toolbar: true});

            const live = await Promise.all(Object.values(identity).map(id => app.getComponent(id, ['id'])));
            expect(live.map(component => component.id), `${message} in the App Worker`).toEqual(Object.values(identity))
        };

        // 3) the REAL gesture: drag the primary splitter downward (vertical split → ns-resize),
        // at real pointer cadence — clear the drag threshold first, then travel, then let the
        // move stream round-trip (main thread → worker → vdom) BEFORE releasing
        const box = await splitter.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, {steps: 4});
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, {steps: 15});
        await page.waitForTimeout(400);

        expect(await page.evaluate(id => globalThis.__fleetProjectionIdentity?.splitter === document.getElementById(id), splitterId0),
            'the committing splitter remains the exact live DOM node until pointer release').toBe(true);
        expect((await app.getComponent(splitterId0, ['id'])).id,
            'the committing splitter remains live in the App Worker until pointer release').toBe(splitterId0);
        const topoDuringDrag = await app.getDockTopology(holderId),
              docDuringDrag  = topoDuringDrag?.document ?? topoDuringDrag;
        expect(docDuringDrag.nodes['primary-split'].sizes,
            'the reducer document stays unchanged before pointer release').toEqual(sizes0);

        await page.mouse.up();

        // the commit loop advanced the DOCUMENT (state-relative: any change from the captured
        // sizes is the claim — the exact ratio depends on live pixel math)
        await expect.poll(async () => {
            const topo = await app.getDockTopology(holderId),
                  doc  = topo?.document ?? topo;
            return doc.nodes['primary-split'].sizes[0]
        }, {message: 'the splitter drag must COMMIT resizeSplit through the reducer', timeout: 10000, intervals: [100]}).not.toBe(sizes0[0]);

        // `resizeSplit` declares the `geometry` change class (`dock/model/Operations.mjs`), so the
        // commit takes the reconciler's geometry fast path: the ONE live splitter
        // instance and its DOM node survive the commit — only the projected sizes move. The
        // pre-pin contract (a fresh splitter per commit) is gone with it.
        const splitterIds = () => page.locator('.fm-fleet-cockpit .neo-dashboard-dock-splitter').evaluateAll(elements =>
            elements.map(element => element.id)
        );

        // the projected geometry follows the committed ratio: the fleet pane's share of the split
        const fleetShare = async () => {
            const fleet  = await page.locator('[class*="dock-flip-item-fleet"]').first().boundingBox(),
                  stream = await page.locator('[class*="dock-flip-item-stream"]').first().boundingBox();
            return fleet && stream ? fleet.height / (fleet.height + stream.height) : null
        };

        await expect.poll(async () => {
            const topo = await app.getDockTopology(holderId),
                  doc  = topo?.document ?? topo,
                  share = await fleetShare();
            return share !== null && Math.abs(share - doc.nodes['primary-split'].sizes[0]) < 0.06
        }, {message: 'the geometry commit re-projects the pane sizes from the committed ratio', timeout: 10000, intervals: [100]}).toBe(true);

        expect(await splitterIds(), 'the geometry commit keeps the one live splitter instance').toEqual([splitterId0]);
        expect(await page.evaluate(id => globalThis.__fleetProjectionIdentity?.splitter === document.getElementById(id), splitterId0),
            'the committed splitter DOM node survives the commit').toBe(true);
        await assertPersistentIdentity('the toolbar and keeper panes survive the real splitter commit');

        // 4) the WRITE half: an NL-driven operation commits through the SAME loop
        const topo1  = await app.getDockTopology(holderId),
              doc1   = topo1?.document ?? topo1,
              cur    = doc1.nodes['primary-split'].sizes,
              target = cur[0] < 0.5 ? [0.65, 0.35] : [0.3, 0.7];

        const result = await app.executeDockOperation(holderId, {
            operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: target
        });

        expect(result.errors).toEqual([]);
        expect(result.applied).toBe(true);

        await expect.poll(async () => {
            const topo = await app.getDockTopology(holderId),
                  doc  = topo?.document ?? topo;
            return doc.nodes['primary-split'].sizes
        }, {message: 'the NL operation must land in the committed document', timeout: 10000, intervals: [100]}).toEqual(target);

        await expect.poll(async () => {
            const share = await fleetShare();
            return share !== null && Math.abs(share - target[0]) < 0.06
        }, {message: 'the NL operation re-projects the pane sizes like the human gesture', timeout: 10000, intervals: [100]}).toBe(true);

        expect(await splitterIds(), 'the NL geometry commit keeps the same live splitter instance').toEqual([splitterId0]);
        await assertPersistentIdentity('the toolbar and keeper panes survive the NL splitter commit');
        expect(runtimeErrors, 'no global error or unhandled rejection across both projection paths').toEqual([]);
        expect(pageErrors, 'no Playwright pageerror across both projection paths').toEqual([])
    });

    test('perspective presets switch the committed document — one real click, then NL-verifiable switching through the same loop', async ({page, neuralLink}) => {
        const pageErrors    = [],
              runtimeErrors = [];

        await page.context().exposeFunction('__recordFleetPerspectiveRuntimeError', payload => runtimeErrors.push(payload));
        await page.context().addInitScript(() => {
            globalThis.addEventListener('error', event => {
                globalThis.__recordFleetPerspectiveRuntimeError({
                    column : event.colno,
                    line   : event.lineno,
                    message: event.message,
                    source : event.filename,
                    type   : 'error'
                })
            });
            globalThis.addEventListener('unhandledrejection', event => {
                globalThis.__recordFleetPerspectiveRuntimeError({
                    reason: String(event.reason?.stack || event.reason?.message || event.reason),
                    type  : 'unhandledrejection'
                })
            })
        });
        page.on('pageerror', error => {
            const value = error == null ? '' : String(error.stack || error.message || error);
            value && value !== 'undefined' && pageErrors.push(value)
        });

        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

        // perspectives switch from their drawer: the boot bar carries no perspective buttons
        await expect(page.locator('.fm-cockpit-bar'), 'the control bar must render on the boot surface').toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-preset-button'), 'no perspective button sits in the bar').toHaveCount(0);

        const app      = await neuralLink.connectToApp('AgentOS'),
              cockpits = await app.findInstances({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
              holderId = Array.isArray(cockpits) ? cockpits[0]?.id : cockpits?.id;

        expect(holderId, 'the FleetCockpit must exist in the App Worker').toBeTruthy();

        const fleetGrids = await app.findInstances({className: 'AgentOS.view.fleet.roster.Container'}, ['id']),
              streams    = await app.findInstances({className: 'AgentOS.view.fleet.activity.Container'}, ['id']),
              keepers    = {
                  fleetGrid: (Array.isArray(fleetGrids) ? fleetGrids[0] : fleetGrids)?.id,
                  stream   : (Array.isArray(streams) ? streams[0] : streams)?.id,
                  toolbar  : await page.locator('.fm-cockpit-bar').getAttribute('id')
              };

        expect(Object.values(keepers).every(Boolean), 'perspective permanence targets start mounted').toBe(true);
        await page.evaluate(ids => {
            globalThis.__fleetPerspectiveIdentity = Object.fromEntries(
                Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)])
            )
        }, keepers);

        const primarySizes = async () => {
            const topo = await app.getDockTopology(holderId),
                  doc  = topo?.document ?? topo;
            return doc.nodes['primary-split'].sizes
        };

        // 1) the REAL gesture in the drawer: reveal it from the rail, then apply Focus from its card
        await page.locator('.neo-dashboard-dock-rail-tab', {hasText: 'Perspectives'}).first().click();
        await page.locator('.fm-perspectives-card', {hasText: 'Focus'}).locator('.fm-perspectives-apply').click();

        await expect.poll(primarySizes, {message: 'the Focus click must commit the preset document', timeout: 10000, intervals: [100]})
            .toEqual([0.85, 0.15]);

        // 2) NL-verifiable switching: the same public seam a switcher UI calls
        const review = await app.callMethod(holderId, 'activatePerspective', ['Review']);
        expect(review).toMatchObject({switched: true});

        await expect.poll(primarySizes, {message: 'the Review switch must commit', timeout: 10000, intervals: [100]})
            .toEqual([0.45, 0.55]);

        const topoReview = await app.getDockTopology(holderId),
              docReview  = topoReview?.document ?? topoReview;
        expect(docReview.nodes['review-split']?.children, 'Review docks the inspector as a center column beside the split').toEqual(['primary-split', 'detail-tabs']);
        expect(docReview.nodes['detail-tabs']?.items).toEqual(['detail']);

        await expect(page.locator('.fm-agent-detail'), 'Review materializes the genuinely absent detail pane')
            .toBeVisible({timeout: 10000});
        const details = await app.findInstances({className: 'AgentOS.view.fleet.detail.Container'}, ['id']),
              detail  = Array.isArray(details) ? details[0] : details;
        expect(detail?.id, 'the absent-item resolver returns one live AgentDetail component').toBeTruthy();

        // After the second commit in a row (Focus by click, Review through the seam) the host holds
        // ONE shell at its shell index — no staged shell survives the projection — and that shell is
        // visible; every item the committed document shows resolves to exactly one live pane, mounted
        // and in the DOM, and no item is ever duplicated by a successor — an item a tab or a collapsed
        // rail keeps back may not exist yet (the rail tools are lazy until their first reveal).
        const host = await app.getComponent(holderId, ['dockShellIndex', 'items.length', 'items.1.id']);

        expect(host.dockShellIndex).toBe(1);
        expect(host['items.length'], 'the control bar and one shell, nothing staged left behind').toBe(2);
        await expect(page.locator(`#${host['items.1.id']}`), 'the shell at shellIndex is visible').toBeVisible();

        const edgeNodes = Object.entries(docReview.nodes[docReview.root].zones).filter(([zone]) => zone !== 'center').map(([, zone]) => zone.nodeId),
              tabsOf    = itemId => Object.keys(docReview.nodes).find(nodeId => docReview.nodes[nodeId].items?.includes(itemId));

        for (const [itemId, item] of Object.entries(docReview.items)) {
            const found     = (await app.findInstances({reference: item.reference}, ['id', 'mounted'])).filter(entry => entry?.className?.startsWith('AgentOS.view.')),
                  tabs      = docReview.nodes[tabsOf(itemId)],
                  shown     = tabs && (tabs.activeItemId === itemId || tabs.items.length === 1) && !(item.autoHidden === true && edgeNodes.includes(tabsOf(itemId)));

            expect(found.length, `${itemId}: never a successor beside a live pane`).toBeLessThanOrEqual(1);

            if (shown) {
                expect(found.length, `${itemId}: the pane the document shows exists`).toBe(1);
                expect(found[0].properties.mounted, `${itemId}: mounted where the document shows it`).toBe(true);
                await expect(page.locator(`#${found[0].id}`), `${itemId}: reachable in the DOM`).toBeAttached()
            }
        }

        // ...and back to the default duty
        await app.callMethod(holderId, 'activatePerspective', ['Overview']);

        await expect.poll(primarySizes, {message: 'the Fleet switch must restore the default split', timeout: 10000, intervals: [100]})
            .toEqual([0.6078, 0.3922]);

        await expect(page.locator('.fm-agent-detail'), 'returning to Fleet un-trees the no-longer-projected detail pane')
            .toHaveCount(0);
        // a DECLARED pane is parked, never retired: the same instance survives out of the tree,
        // so the next reveal or the next Review switch returns it — one instance, never a successor
        const detailsAfter = await app.findInstances({className: 'AgentOS.view.fleet.detail.Container'}, ['id']);
        expect((Array.isArray(detailsAfter) ? detailsAfter : [detailsAfter]).filter(entry => entry?.id).map(entry => entry.id),
            'the un-treed inspector is the parked declared instance — the same one Review projected').toEqual([detail.id]);

        expect(await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([key, id]) => [
            key,
            globalThis.__fleetPerspectiveIdentity?.[key] === document.getElementById(id)
        ])), keepers), 'Fleet and Activity plus the toolbar survive Focus → Review → Fleet')
            .toEqual({fleetGrid: true, stream: true, toolbar: true});
        const keeperComponents = await Promise.all(Object.values(keepers).map(id => app.getComponent(id, ['id'])));
        expect(keeperComponents.map(component => component.id), 'keeper component identities survive every preset')
            .toEqual(Object.values(keepers));

        // a refused switch fails closed: worker truth unchanged, the refusal recorded
        const ghost = await app.callMethod(holderId, 'activatePerspective', ['Ghost']);
        expect(ghost?.switched).toBe(false);
        expect(await primarySizes()).toEqual([0.6078, 0.3922]);
        const drawers  = await app.findInstances({className: 'AgentOS.view.fleet.perspectives.Container'}, ['id']),
              drawerId = (Array.isArray(drawers) ? drawers[0] : drawers)?.id;

        await expect.poll(async () => (await app.getComponent(drawerId, ['perspectives']))?.perspectives?.applyNote ?? '',
            {message: 'a refused switch is named in the drawer', timeout: 10000, intervals: [100]})
            .toContain('Ghost');
        expect(runtimeErrors, 'no global error or unhandled rejection across perspective reconciliation').toEqual([]);
        expect(pageErrors, 'no Playwright pageerror across perspective reconciliation').toEqual([])
    });
});
