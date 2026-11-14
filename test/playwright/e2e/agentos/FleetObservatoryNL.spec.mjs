import {expect, test}       from '../../fixtures.mjs';
import {wholeGraphEnvelope} from '../../fixture/wholeGraphScene.mjs';

/**
 * The Observatory keeper-view, driven by the real shell over the Neural Link: a bounded graph read lands
 * through the cockpit's own write and the canvas worker draws it — the renderer's own statistics say what it
 * holds and how many frames it drew. A drag orbits and the wheel zooms through the DOM → App Worker →
 * canvas-worker path, and an idle second draws nothing. A click on a node selects it by its qualified id,
 * an orbit selects nothing, a shuffled read of the same snapshot keeps the selection and a read without the
 * id clears it with the reason. A budget cut reads partial, degraded draws what it holds, unavailable
 * clears. No fleet server takes part: the first state the pane shows is the unavailable one.
 */
const
    CAPTURED_AT = '2026-07-05T08:00:00.000Z',
    q           = id => `neomjs/neo#${id}`,
    NODES       = [
        {id: q('agent-grace'),  label: 'Grace',             kind: 'agent'},
        {id: q('concept-dock'), label: 'Dock',              kind: 'concept'},
        {id: q('issue-202'),    label: 'second route item', kind: 'issue'},
        {id: q('issue-303'),    label: 'third route item',  kind: 'issue'},
        {id: q('issue-404'),    label: 'two hops out',      kind: 'issue'},
        {id: q('issue-505'),    label: 'no seed reaches',   kind: 'issue'},
        {id: q('pr-101'),       label: 'first route item',  kind: 'pull'}
    ],
    EDGES       = [
        {from: q('agent-grace'),  to: q('issue-202'), type: 'authored'},
        {from: q('agent-grace'),  to: q('pr-101'),    type: 'authored'},
        {from: q('concept-dock'), to: q('issue-404')},
        {from: q('pr-101'),       to: q('concept-dock'), type: 'mentions'}
    ],
    // a `fleetGraphScene` answer as the Brain's bounded read gives it: three seeds, seven nodes, four edges
    read        = (scene = {}, envelope = {}) => ({
        capability: {state: 'current', reason: null},
        scene     : {
            route       : [q('pr-101'), q('issue-202'), q('issue-303')],
            nodes       : NODES,
            edges       : EDGES,
            counts      : {nodes: 7, edges: 4, seeds: 3, communities: 3, paths: 1},
            budget      : {maxNodes: 150, maxEdges: 300, maxBytes: 32768},
            completeness: 'complete',
            ...scene
        },
        snapshotId: 'snap-7f3a',
        capturedAt: CAPTURED_AT,
        ...envelope
    }),
    HOUR        = 3600000,
    // the Brain's attribution, state and recency on the same nodes, around the instant an arm runs: an open PR
    // the operator authored and Vega is assigned, Vega's issue untouched for thirty days, the operator's closed
    // one, Eos's issue whose state the read omits, and an issue without an activity time
    team        = now => ({
        [q('pr-101')]   : {kind: 'PULL_REQUEST', authoredBy: '@tobiu',         assignedTo: ['@neo-opus-vega'], state: 'OPEN',   lastActivityAt: now - HOUR},
        [q('issue-202')]: {kind: 'ISSUE',        authoredBy: '@neo-opus-vega', assignedTo: [],                 state: 'OPEN',   lastActivityAt: now - 30 * 24 * HOUR},
        [q('issue-303')]: {kind: 'ISSUE',        authoredBy: '@tobiu',         assignedTo: [],                 state: 'CLOSED', lastActivityAt: now - 2 * HOUR},
        [q('issue-404')]: {kind: 'ISSUE',        authoredBy: '@neo-preview',   assignedTo: [],                                  lastActivityAt: now},
        [q('issue-505')]: {kind: 'ISSUE',                                                                      state: 'OPEN'}
    });

/**
 * @summary Opens the shell and the Observatory, and binds the handles the arms drive: the cockpit
 * controller's graph write, the canvas's stats and its `locate`, and the pane's three text slots.
 * @param {Object} page
 * @param {Object} neuralLink
 * @returns {Promise<Object>}
 */
async function openObservatory(page, neuralLink) {
    await page.setViewportSize({width: 1600, height: 1100});
    await page.goto('/apps/agentos/index.html');
    await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

    const app = await neuralLink.connectToApp('AgentOS');

    await page.getByRole('tab', {name: 'Observatory', exact: true}).click();

    const pane = page.locator('.fm-observatory-pane');

    await expect(pane).toBeVisible({timeout: 10000});

    const
        [cockpit]    = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
        cockpitState = await app.getComponent(cockpit.properties.id, ['controller']),
        [canvas]     = await app.queryComponent({className: 'AgentOS.view.fleet.goldenpath.ObservatoryCanvas'}, ['id']),
        [container]  = await app.queryComponent({className: 'AgentOS.view.fleet.goldenpath.ObservatoryContainer'}, ['id']);

    const locate = id => app.callMethod(canvas.properties.id, 'locate', [id]);

    return {
        app,
        // the read's complete words, which the head keeps behind Details
        currency : pane.locator('.fm-observatory-details'),
        geography: async () => (await app.getComponent(container.properties.id, ['geography'])).geography,
        hover    : pane.locator('.fm-observatory-hover'),
        land     : envelope => app.callMethod(cockpitState.controller.id, 'writeGraphScene', [envelope]),
        locate,
        pane,
        // clicks a node where the renderer draws it
        selectNode: async id => {
            const rect = await pane.locator('canvas').boundingBox(), at = await locate(id);

            await page.mouse.click(rect.x + at.x, rect.y + at.y)
        },
        // the selected node's label, or why the selection cleared
        selection: pane.locator('.fm-observatory-selected-label'),
        settle   : async () => {
            await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
            await page.waitForTimeout(400)
        },
        stats    : () => app.callMethod(canvas.properties.id, 'readStats', [])
    }
}

test.describe('Agent OS — the Observatory keeper-view (NL)', () => {
    test('a bounded read lands as the scene the canvas worker draws; a click selects by qualified id and an orbit does not; the selection survives a shuffle and clears with its reason; partial, degraded and unavailable keep their meaning', async ({page, neuralLink}) => {
        const {currency, hover, land, pane, selection, selectNode, settle, stats} = await openObservatory(page, neuralLink);

        await expect(currency, 'cold, the read is unavailable').toHaveText(/^Unavailable · /);
        await expect(hover, 'the gesture hint stands in for the hovered node').toHaveText('drag orbits · wheel zooms · click selects');
        await expect(selection).toHaveText('No node selected');

        await land(read());
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · 2 in the halo · complete$/);
        await settle();

        const drawn = await stats();

        expect(drawn).toMatchObject({currency: 'current', completeness: 'complete', snapshotId: 'snap-7f3a', selectedId: null});
        expect(drawn.counts).toEqual({nodes: 7, edges: 4, seeds: 3, communities: 3, paths: 1});
        expect(drawn.canvas[0], 'the drawing buffer is sized').toBeGreaterThan(0);

        const [cssWidth, ratio] = await pane.locator('canvas').evaluate(node => [node.getBoundingClientRect().width, window.devicePixelRatio]);

        expect(Math.abs(drawn.canvas[0] - cssWidth * ratio), 'the drawing buffer follows the host pixel ratio').toBeLessThanOrEqual(1);
        expect(drawn.frames).toBeGreaterThan(0);
        expect(drawn.camera.touched).toBe(false);

        await page.waitForTimeout(1000);

        const idle = await stats();

        expect(idle.frames, 'idle draws nothing').toBe(drawn.frames);

        // a click on a node, found where the renderer draws it, selects it by its qualified id
        const rect = await pane.locator('canvas').boundingBox();

        await selectNode(q('pr-101'));
        await expect(selection).toHaveText('first route item');
        await expect(pane.locator('.fm-observatory-selected-facts')).toHaveText('Golden Path rank 1');
        await expect(hover).toHaveText('first route item · pull · rank 1');
        await page.waitForTimeout(400);
        expect((await stats()).selectedId).toBe(q('pr-101'));

        // drag orbits: the pointer takes the camera through the canvas's own listeners, and selects nothing
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.mouse.move(rect.x + rect.width / 2 + 120, rect.y + rect.height / 2 + 30, {steps: 8});
        await page.mouse.up();
        await page.waitForTimeout(400);

        const orbited = await stats();

        expect(orbited.camera.yaw).not.toBe(drawn.camera.yaw);
        expect(orbited.camera.pitch).not.toBe(drawn.camera.pitch);
        expect(orbited.camera.touched).toBe(true);
        expect(orbited.frames).toBeGreaterThan(idle.frames);
        expect(orbited.selectedId, 'the click that ends an orbit selects nothing').toBe(q('pr-101'));

        // wheel zooms out
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(400);

        const zoomed = await stats();

        expect(zoomed.camera.dist).toBeGreaterThan(orbited.camera.dist);
        expect(zoomed.frames).toBeGreaterThan(orbited.frames);

        // the same snapshot in another row order keeps the selection and the taken camera
        await land(read({nodes: [...NODES].reverse(), edges: [...EDGES].reverse()}));
        await settle();

        const shuffled = await stats();

        expect(shuffled.selectedId).toBe(q('pr-101'));
        expect(shuffled.camera.dist, 'a taken camera keeps its distance across scenes').toBe(zoomed.camera.dist);
        await expect(selection).toHaveText('first route item');

        // a read without the selected id clears the selection and says why
        await land(read({
            route : [q('issue-202'), q('issue-303')],
            nodes : NODES.filter(node => node.id !== q('pr-101')),
            edges : EDGES.filter(edge => edge.from !== q('pr-101') && edge.to !== q('pr-101')),
            counts: {nodes: 6, edges: 2, seeds: 2}
        }, {snapshotId: 'snap-9c40'}));
        await expect(selection).toHaveText('Selection cleared · neomjs/neo#pr-101 is not in snapshot snap-9c40');
        await settle();

        const lost = await stats();

        expect(lost.selectedId).toBeNull();
        // without pr-101 no node holds two relations, so no well forms and all six sit in the halo
        expect(lost.counts).toEqual({nodes: 6, edges: 2, seeds: 2, communities: 0, paths: 1});

        // a click on the empty surface clears a selection
        await selectNode(q('issue-202'));
        await expect(selection).toHaveText('second route item');
        await page.mouse.click(rect.x + 6, rect.y + 6);
        await expect(selection).toHaveText('No node selected');

        await land(read({completeness: 'truncated'}, {snapshotId: 'snap-a1'}));
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · 2 in the halo · partial, budget 150 nodes \/ 300 edges \/ 32 KiB$/);
        await settle();
        expect((await stats()).completeness).toBe('truncated');

        await land(read({}, {capability: {state: 'degraded', reason: 'graph-seam-refused'}}));
        await expect(currency).toHaveText('Degraded · graph-seam-refused · 7 nodes · 4 edges · 2 in the halo · complete');
        await settle();

        const partial = await stats();

        expect(partial.currency).toBe('degraded');
        expect(partial.counts, 'degraded draws what the read holds').toEqual({nodes: 7, edges: 4, seeds: 3, communities: 3, paths: 1});

        await land({capability: {state: 'unavailable', reason: 'route-read-failed'}, scene: null, snapshotId: null, capturedAt: CAPTURED_AT});
        await expect(currency).toHaveText('Unavailable · route-read-failed');
        await settle();

        const cleared = await stats();

        expect(cleared.currency).toBe('unavailable');
        expect(cleared.counts).toEqual({nodes: 0, edges: 0, seeds: 0, communities: 0})
    });

    test('the list and canvas share selection, and reading the Golden Path leaves that selection intact', async ({page, neuralLink}) => {
        const
            {land, pane, selection, selectNode, settle, stats} = await openObservatory(page, neuralLink),
            rows      = pane.locator('.fm-observatory-node-list .neo-list-item'),
            relations = pane.locator('.fm-observatory-relation-list .neo-list-item:not(.neo-list-header)');

        await land(read());
        await expect(rows).toHaveCount(7);
        await settle();

        await rows.nth(0).click();
        await expect(selection).toHaveText('first route item');
        expect((await stats()).selectedId, 'a list row selects on the canvas too').toBe(q('pr-101'));

        await page.keyboard.press('ArrowDown');
        await expect(selection, 'the arrow keys move the selection').toHaveText('second route item');
        expect((await stats()).selectedId).toBe(q('issue-202'));

        await expect(pane.locator('.fm-observatory-relation-list .neo-list-header')).toHaveText([/authored\s*from\s*1/]);
        await expect(relations).toHaveText([/Grace\s*agent/]);

        // relations are read in the Selected section, which browsing the node list leaves at its head
        await pane.getByRole('button', {name: /^Selected node/}).click();

        const held = await stats();

        await relations.nth(0).click();
        await expect(selection, 'a relation row moves to its other end').toHaveText('Grace');
        expect((await stats()).camera, 'following a relation keeps the camera').toEqual(held.camera);
        expect((await stats()).canvas, 'and a selection never resizes the canvas').toEqual(held.canvas);

        await selectNode(q('issue-404'));
        await expect(selection).toHaveText('two hops out');
        await expect(pane.locator('.fm-observatory-node-list .neo-selected'), 'a canvas pick marks its list row').toHaveText(/two hops out/);

        // The human recommendation is a reader: visiting it must preserve the Observatory's selection.
        const
            app          = await neuralLink.connectToApp('AgentOS'),
            [cockpit]    = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
            cockpitState = await app.getComponent(cockpit.properties.id, ['controller']);

        await app.callMethod(cockpitState.controller.id, 'writeGoldenPath', [{
            capability: {state: 'wired', capturedAt: CAPTURED_AT},
            handoff   : {markdown: '## Computed Golden Path\n\nThe full producer recommendation.', stale: false, mtimeMs: Date.parse(CAPTURED_AT)},
            admission : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: [], staleFacets: []},
            route     : {
                schemaVersion: 'computed-route.v1', status: 'fresh', capturedAt: CAPTURED_AT, expiresAt: '2026-07-05T20:00:00.000Z', expired: false,
                kind: 'computed-ranked', freshness: {status: 'fresh'}, provenance: {producer: 'golden-path-synthesizer', runId: 'run-1', algorithmVersion: 'v1'},
                items: [
                    {id: 'pr-101',    title: 'first route item',  score: 3, rank: 1, citations: []},
                    {id: 'issue-202', title: 'second route item', score: 2, rank: 2, citations: []},
                    {id: 'issue-303', title: 'third route item',  score: 1, rank: 3, citations: []}
                ]
            },
            rem: {undigested: 0, digested: 10, recentCycles: 1}, sources: {}
        }]);

        await page.getByRole('tab', {name: 'Fleet', exact: true}).click();
        await page.getByRole('tab', {name: 'Golden Path', exact: true}).click();

        await expect(page.locator('.fm-golden-path-markdown')).toContainText('The full producer recommendation.');
        await expect(page.locator('.fm-golden-path-item')).toHaveCount(0);

        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();
        await expect(selection, 'reading the human recommendation preserves the graph selection').toHaveText('two hops out');
        await page.waitForTimeout(400);
        expect((await stats()).selectedId).toBe(q('issue-404'))
    });

    test('the view keeps its scene and its selection across a switch away and back without a second read, and resizes with the window', async ({page, neuralLink}) => {
        const {currency, land, selection, selectNode, stats} = await openObservatory(page, neuralLink);

        await expect(currency, 'cold, the read is unavailable').toHaveText(/^Unavailable · /);
        await land(read());
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · 2 in the halo · complete$/);
        await page.waitForTimeout(400);

        await selectNode(q('issue-303'));
        await expect(selection).toHaveText('third route item');
        await expect(page.locator('.fm-observatory-pane .fm-observatory-selected-facts')).toHaveText('Golden Path rank 3');
        await page.waitForTimeout(400);

        const before = await stats();

        expect(before.counts).toEqual({nodes: 7, edges: 4, seeds: 3, communities: 3, paths: 1});

        // a read on the way back would answer unavailable (no fleet server takes part), so a current
        // line after the round trip is a read that did not happen
        await page.getByRole('tab', {name: 'Fleet', exact: true}).click();
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible();
        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · 2 in the halo · complete$/);
        await expect(selection).toHaveText('third route item');
        await page.waitForTimeout(400);

        const back = await stats();

        expect(back.currency).toBe('current');
        expect(back.counts, 'the scene survives the round trip').toEqual({nodes: 7, edges: 4, seeds: 3, communities: 3, paths: 1});
        expect(back.selectedId, 'and so does the selection').toBe(q('issue-303'));
        expect(back.canvas).toEqual(before.canvas);

        await page.setViewportSize({width: 1200, height: 800});
        await page.waitForTimeout(600);

        const resized = await stats();

        expect(resized.canvas[0], 'the drawing buffer follows the narrower view').toBeLessThan(back.canvas[0]);
        expect(resized.canvas[1], 'and the shorter one').toBeLessThan(back.canvas[1]);
        expect(resized.counts, 'a resize keeps the scene').toEqual({nodes: 7, edges: 4, seeds: 3, communities: 3, paths: 1});
        expect(resized.frames, 'the resized surface is drawn').toBeGreaterThan(back.frames)
    });

    // A synthetic graph at the proof of concept's scale: it certifies the FM path — envelope admission, the
    // provider leaf, the pane, the layout, the canvas worker — never the Brain's data or the Fleet read.
    test('a whole graph lands through the live read\'s write: 100k nodes draw through the level of detail, the fitted camera every node, the wheel steps it in to near and back out to far, a drag orbits, and the route toggles without moving a node', async ({page, neuralLink}, testInfo) => {
        test.setTimeout(300000);

        const
            {geography, land, locate, pane, stats} = await openObservatory(page, neuralLink),
            envelope                    = wholeGraphEnvelope(),
            started                     = Date.now();

        await land(envelope);
        await expect.poll(async () => (await stats())?.counts?.nodes, {intervals: [250], timeout: 180000}).toBe(100000);
        // a frame of the landed scene, not the canvas's mount frame or the previous scene's
        await expect.poll(async () => (await stats()).sceneFrames, {intervals: [50], timeout: 30000}).toBeGreaterThan(0);

        const landedIn = Date.now() - started, drawn = await stats();

        testInfo.annotations.push({type: 'Neural Link write of the envelope to the first frame of its scene', description: `${landedIn} ms`});
        expect(drawn.counts).toMatchObject({nodes: 100000, seeds: 10, paths: 1});
        expect(drawn.lod.level, 'the fitted camera draws every node').toBe('mid');
        // the pane's default geography is strategic wells; this synthetic read carries no strategic anchor, so it
        // lays out as density wells around its 48 best-connected nodes, plus a halo sector for any node none reaches
        expect(await geography(), 'strategic wells by default').toBe('strategic');
        expect(drawn.lod.clusters, 'the 48 density wells are drawn').toBeGreaterThanOrEqual(48);

        // the pictures a reviewer looks at, attached to the run: never compared, so never goldens
        const picture = async name => testInfo.attach(name, {body: await pane.screenshot(), contentType: 'image/png'});

        await picture('100k · fitted')

        // the wheel over the canvas steps the level of detail in
        const rect = await pane.locator('canvas').boundingBox(), levels = [drawn.lod.level];

        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);

        for (let step = 0; step < 40 && levels.at(-1) !== 'near'; step++) {
            await page.mouse.wheel(0, -120);
            await page.waitForTimeout(80);

            const {level} = (await stats()).lod;

            level !== levels.at(-1) && levels.push(level)
        }

        expect(levels).toEqual(['mid', 'near']);
        await picture('100k · near');

        // a drag orbits
        const {yaw} = (await stats()).camera;

        await page.mouse.down();
        await page.mouse.move(rect.x + rect.width / 2 + 160, rect.y + rect.height / 2 + 40, {steps: 8});
        await page.mouse.up();
        await expect.poll(async () => (await stats()).camera.yaw).not.toBe(yaw);

        // the route is an overlay: it goes and comes back, and no node moves
        const
            ids    = [envelope.scene.route[0], envelope.scene.nodes[12345].id],
            before = await Promise.all(ids.map(locate)),
            toggle = pane.getByRole('button', {name: 'Route'});

        await toggle.click();
        await expect.poll(async () => (await stats()).counts.paths).toBe(0);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(await Promise.all(ids.map(locate))).toEqual(before);
        await picture('100k · near, route off');

        await toggle.click();
        await expect.poll(async () => (await stats()).counts.paths).toBe(1);
        expect(await Promise.all(ids.map(locate))).toEqual(before);
        expect((await stats()).snapshotId).toBe(envelope.snapshotId);

        // drawn back past the whole graph: one centroid per community
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);

        for (let step = 0; step < 40 && levels.at(-1) !== 'far'; step++) {
            await page.mouse.wheel(0, 120);
            await page.waitForTimeout(80);

            const {level} = (await stats()).lod;

            level !== levels.at(-1) && levels.push(level)
        }

        expect(levels).toEqual(['mid', 'near', 'mid', 'far']);
        await picture('100k · far')
    });

    test('the wells are named where they lie: the largest well\'s label draws first and at most 30 draw, Wells leads with it, and a row turns the camera to its hub, keeping the snapshot and the selection', async ({page, neuralLink}) => {
        test.setTimeout(180000);

        const
            {app, land, locate, pane, selectNode, settle, stats} = await openObservatory(page, neuralLink),
            envelope = wholeGraphEnvelope({communities: 16, nodes: 4000, routeLength: 4}),
            seed     = envelope.scene.route[0];

        await land(envelope);
        await expect.poll(async () => (await stats())?.counts?.nodes, {intervals: [250], timeout: 60000}).toBe(4000);
        await settle();

        // the read carries no strategic anchor, so its density wells are what the layout names
        const
            {stores}  = await app.listStores(),
            wellStore = stores.find(store => store.model === 'AgentOS.model.GraphSceneWell');

        expect(wellStore, 'the pane keeps the scene\'s wells in a store').toBeTruthy();

        const {items} = await app.inspectStore(wellStore.id, 50);

        expect(items.length, 'the read lays out density wells').toBeGreaterThan(30);
        await expect.poll(async () => (await stats()).labels?.drawn.length ?? 0, {message: 'a frame draws the wells\' labels'}).toBeGreaterThan(0);

        const {labels} = await stats();

        expect(labels.count, 'every well is a label candidate').toBe(items.length);
        expect(labels.drawn[0], 'the largest well is named first').toMatchObject({id: items[0].id, text: items[0].label});
        expect(labels.drawn.length, 'at most 30 labels on screen').toBeLessThanOrEqual(30);

        // a selection the flight must keep, made before Wells opens: a selection opens the Selected section
        await selectNode(seed);
        await expect.poll(async () => (await stats()).selectedId).toBe(seed);

        // Wells opens from its head and leads with the largest well
        await pane.getByRole('button', {name: /^Wells · /}).click();

        const rows = pane.locator('.fm-observatory-well-list .neo-list-item');

        await expect(rows.first()).toContainText(items[0].label);

        // a row turns the camera to its hub: the hub lands at the canvas centre, and the snapshot and the selection stay
        const {width, height} = await pane.locator('canvas').boundingBox();

        await rows.nth(3).click();
        await expect.poll(async () => {
            const at = await locate(items[3].id);

            return Math.hypot(at.x - width / 2, at.y - height / 2)
        }, {message: 'the fourth well\'s hub at the centre'}).toBeLessThan(2);

        expect(await stats()).toMatchObject({flying: false, selectedId: seed, snapshotId: envelope.snapshotId})
    });

    test('at the deepest zoom on a well, the nodes nearest the target are named where they lie, each once, beside the wells\' labels and over the floor', async ({page, neuralLink}) => {
        test.setTimeout(180000);

        const
            {app, land, locate, pane, settle, stats} = await openObservatory(page, neuralLink),
            envelope = wholeGraphEnvelope({communities: 16, nodes: 4000, routeLength: 4}),
            labelOf  = new Map(envelope.scene.nodes.map(node => [node.id, node.label]));

        await land(envelope);
        await expect.poll(async () => (await stats())?.counts?.nodes, {intervals: [250], timeout: 60000}).toBe(4000);
        await settle();

        const fitted = await stats();

        expect(fitted.near, 'the fitted camera shows none of the near look').toEqual({floor: 0, share: 0});
        expect(fitted.names, 'and has drawn no name').toBeNull();

        const
            {stores} = await app.listStores(),
            {items}  = await app.inspectStore(stores.find(store => store.model === 'AgentOS.model.GraphSceneWell').id, 50),
            wellIds  = new Set(items.map(item => item.id));

        // to the largest well, then the wheel in until it stops: the deepest zoom
        await pane.getByRole('button', {name: /^Wells · /}).click();
        await pane.locator('.fm-observatory-well-list .neo-list-item').first().click();
        await expect.poll(async () => (await stats()).flying).toBe(false);

        const rect = await pane.locator('canvas').boundingBox();

        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);

        let dist = (await stats()).camera.dist;

        for (let turn = 0; turn < 20; turn++) {
            await page.mouse.wheel(0, -600);
            await page.waitForTimeout(80);

            const next = (await stats()).camera.dist;

            if (next === dist) break;
            dist = next
        }

        await expect.poll(async () => {
            const {names, near} = await stats();

            return near.share === 1 && names?.resident > 0
        }, {message: 'the deepest zoom brings the near look'}).toBe(true);

        const
            near  = await stats(),
            ratio = await page.evaluate(() => devicePixelRatio),
            named = near.labels.drawn.filter(({id}) => !wellIds.has(id));

        expect(near.camera.dist, 'the wheel stopped at the deepest zoom').toBe(dist);
        expect(near.near.floor, 'the 7 px floor, in drawing-buffer pixels').toBe(7 * ratio);
        expect(named.length, 'the frame names nodes beside the wells\' labels').toBeGreaterThan(0);
        expect(named.every(({id, text}) => text === labelOf.get(id)), 'each by its own label').toBe(true);
        expect(new Set(near.labels.drawn.map(({id}) => id)).size, 'no node is named twice').toBe(near.labels.drawn.length);
        expect(near.labels.drawn.length, 'within what a frame draws').toBeLessThanOrEqual(30);

        // each name names the point where its node lies, and the engine lifts the label clear above it
        for (const {id, x, y} of named) {
            const at = await locate(id);

            expect(Math.hypot(at.x - x, at.y - y), `${id} sits at its node`).toBeLessThan(1)
        }
    });

    test('the team lens and the heat draw over the same places: a checked peer reaches the worker, the rows name each node\'s role, the Heat toggle counts what it cannot read, and no node moves', async ({page, neuralLink}) => {
        const
            {currency, land, locate, pane, selection, settle, stats} = await openObservatory(page, neuralLink),
            attribution = team(Date.now()),
            details     = pane.getByRole('button', {name: 'Details'});

        await land(read({nodes: NODES.map(node => ({...node, ...attribution[node.id]}))}));
        await settle();

        // the head's first line is the team's sentence, and the counts stay folded until a real click opens Details
        await expect(pane.locator('.fm-observatory-currency')).toHaveText(/^captured .+ · last 3 days: 1 in motion · 2 unknown · attention: #101 · first route item · complete$/);
        await expect(details).toHaveAttribute('aria-expanded', 'false');
        await expect(currency).toBeHidden();
        await details.click();
        await expect(details).toHaveAttribute('aria-expanded', 'true');
        await expect(currency).toBeVisible();
        await expect(currency).toHaveText(/^Current · captured .+ · complete$/);

        const
            places = () => Promise.all(NODES.map(({id}) => locate(id))),
            before = await places(),
            peers  = pane.locator('.fm-observatory-peer-list .neo-list-item'),
            vega   = peers.filter({hasText: '@neo-opus-vega'}),
            heat   = pane.getByRole('button', {name: 'Attention'});

        await expect(peers, 'busiest first').toHaveText([/@neo-opus-vega.*2 nodes/, /@tobiu.*2 nodes/, /@neo-preview.*1 node/]);
        expect((await stats()).lens, 'nothing checked, no lens').toBeNull();

        await vega.click();
        await expect(currency).toHaveText(/ · lens · 2 nodes · 1 peer$/);
        await expect.poll(async () => (await stats()).lens).toEqual({peers: 1, nodes: 2});
        await expect(pane.locator('.fm-observatory-node-list .fm-observatory-row-role'), 'thirty days untouched: authored, not changed recently').toHaveText(['assigned · changed recently', 'authored']);

        await heat.click();
        await expect(heat).toHaveAttribute('aria-pressed', 'true');
        await expect(currency).toHaveText(/ · lens · 2 nodes · 1 peer · heat · last 3 days · 2 unknown$/);
        await expect.poll(async () => (await stats()).heat).toEqual({nodes: 5, unknown: 2});
        expect(await places(), 'the lens and the heat move no node').toEqual(before);

        await vega.click();
        await heat.click();
        await expect.poll(async () => {
            const {heat, lens} = await stats();

            return [heat, lens]
        }).toEqual([null, null]);
        await expect(currency).toHaveText(/ · complete$/);

        // the attention item selects its node
        await pane.locator('.fm-observatory-attention').click();
        await expect(selection).toHaveText('first route item');
        expect((await stats()).selectedId).toBe(q('pr-101'))
    });

    test('the Nodes list leads with what changed, its head names the order, and its toggle reads by relations and back', async ({page, neuralLink}) => {
        const
            {land, pane, settle} = await openObservatory(page, neuralLink),
            attribution = team(Date.now()),
            caption     = pane.locator('.fm-observatory-nodes-caption'),
            labels      = pane.locator('.fm-observatory-node-list .fm-observatory-row-label'),
            nodesHead   = pane.getByRole('button', {name: /^Nodes/}),
            toggle      = pane.getByRole('button', {name: 'by relations', exact: true});

        await land(read({nodes: NODES.map(node => ({...node, ...attribution[node.id]}))}));
        await settle();

        // the read names peers, so Team opens first and Nodes keeps only its chrome line
        await expect(caption, 'collapsed, the order waits with the list').toBeHidden();
        await nodesHead.click();
        await expect(nodesHead).toHaveText('Nodes');
        await expect(caption).toHaveText('changed in the last 3 days first · then by activity');
        await expect(labels, 'the work changed within the window, newest first, the closed issue among it; then by activity').toHaveText(['two hops out', 'first route item', 'third route item', 'second route item', 'Grace', 'Dock', 'no seed reaches']);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(caption).toHaveText('by relations · most related first');
        await expect(labels, 'the most related first, ties in the scene\'s order').toHaveText(['first route item', 'Grace', 'Dock', 'second route item', 'two hops out', 'third route item', 'no seed reaches']);

        await toggle.click();
        await expect(labels.first()).toHaveText('two hops out')
    });

    test('the selected node says what it is and opens its evidence one step away, from the keyboard: a work item its GitHub page, a session its Memories drill in the cockpit, a concept that it has no source view', async ({page, neuralLink}) => {
        const
            {land, pane, selection, settle} = await openObservatory(page, neuralLink),
            session = q('session:019fe5e8-b963-7e93-8762-c8e4af16bdec'),
            now     = Date.now(),
            rows    = pane.locator('.fm-observatory-node-list .neo-list-item'),
            head    = pane.locator('.fm-observatory-selected-head'),
            // the arrow keys walk the focused node list until the section names the node, one landed step at a time
            walkTo  = async label => {
                for (let step = 0; step < 12; step++) {
                    const named = await selection.textContent();

                    if (named === label) break;

                    await page.keyboard.press('ArrowDown');
                    await expect(selection).not.toHaveText(named)
                }

                await expect(selection).toHaveText(label)
            };

        await land(read({
            nodes: [...NODES.map(node => ({...node, ...team(now)[node.id]})), {id: session, label: 'a session', kind: 'SESSION'}],
            edges: [...EDGES, {from: session, to: q('issue-202'), type: 'MENTIONS'}]
        }));
        await settle();

        // the read names peers, so Team opens first: the rows live under Nodes, a node's facts and actions under Selected
        const
            nodesHead    = pane.getByRole('button', {name: /^Nodes/}),
            selectedHead = pane.getByRole('button', {name: /^Selected node/});

        await nodesHead.click();
        await rows.filter({hasText: 'first route item'}).click();
        await expect(selection).toHaveText('first route item');
        await expect(head, 'the qualified id stays out of the head').not.toContainText('neomjs/neo#');
        await selectedHead.click();
        await expect(pane.locator('.fm-observatory-selected-facts')).toHaveText(/^open, as last ingested · authored by @tobiu · assigned to @neo-opus-vega · last activity .+ · Golden Path rank 1$/);
        const
            openOnGitHub = pane.getByRole('link', {name: 'Open on GitHub'}),
            tooltip      = page.locator('.neo-tooltip'),
            appUrl       = page.url();

        await expect(openOnGitHub).toHaveAttribute('href', 'https://github.com/neomjs/neo/pull/101');
        // the link's url arrives with the selection, after the button was built
        await expect(openOnGitHub, 'it opens beside the app, not in place of it').toHaveAttribute('target', '_blank');
        await openOnGitHub.hover();
        await expect(tooltip, 'the control names where it leads').toContainText('https://github.com/neomjs/neo/pull/101');
        await page.context().route('https://github.com/**', route => route.abort());

        const [popup] = await Promise.all([page.waitForEvent('popup'), openOnGitHub.click()]);

        await popup.close();
        await expect(page, 'the app keeps its page, so its window keeps the worker').toHaveURL(appUrl);
        await page.mouse.move(0, 0);
        await expect(tooltip, 'and its tooltip still hides when the pointer leaves, with no reload').toBeHidden();
        await expect(pane.locator('.fm-observatory-relation-list .neo-list-header')).toHaveText([/authored\s*from\s*1/, /mentions\s*to\s*1/]);

        await nodesHead.click();
        await rows.nth(1).click();
        await walkTo('a session');
        await selectedHead.click();
        await pane.getByRole('button', {name: 'Open in Memories'}).press('Enter');
        await expect(page.locator('.fm-fleet-cockpit'), 'the route moves to the cockpit').toBeVisible();
        await expect(page.locator('.fm-memories-drill-title'), 'whose Memories pane drills into the session').toHaveText('a session');

        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();
        await expect(selection, 'the Observatory kept its selection').toHaveText('a session');
        await settle();
        await nodesHead.click();
        await rows.filter({hasText: 'first route item'}).click();
        await expect(selection).toHaveText('first route item');
        await walkTo('Dock');
        await selectedHead.click();
        await expect(pane.locator('.fm-observatory-selected-no-source')).toHaveText('No source view for concept');
        await expect(pane.getByRole('link', {name: 'Open on GitHub'})).toHaveCount(0)
    });

    test('a list selection opens its details and actions below the list without a second click, keeps one row of context below the selected row, sizes up to half the panel, and takes the keyboard from the Nodes head through Open and back via Escape at the same scroll position', async ({page, neuralLink}) => {
        const
            {land, pane, selection, settle, stats} = await openObservatory(page, neuralLink),
            now          = Date.now(),
            nodes        = Array.from({length: 60}, (_, i) => ({
                id            : q(`issue-${1000 + i}`),
                label         : `Fixture work item ${i + 1}: the list row and its detail stay together`,
                kind          : 'ISSUE',
                authoredBy    : i % 2 ? '@neo-opus-vega' : '@tobiu',
                state         : 'OPEN',
                lastActivityAt: now - i * 60000
            })),
            // node 0 carries 18 relations so its split caps around half the panel and scrolls inside; node 23 carries 1 relation
            edges        = [
                ...Array.from({length: 18}, (_, i) => ({from: q('issue-1000'), to: q(`issue-${1001 + i}`), type: 'relates'})),
                {from: q('issue-1023'), to: q('issue-1024'), type: 'mentions'}
            ],
            side         = pane.locator('.fm-observatory-side'),
            list         = pane.locator('.fm-observatory-node-list'),
            rows         = list.locator('.neo-list-item'),
            selectedPane = pane.locator('.fm-observatory-selected'),
            facts        = pane.locator('.fm-observatory-selected-facts'),
            openLink     = pane.getByRole('link', {name: 'Open on GitHub'}),
            clearBtn     = pane.locator('.fm-observatory-selected-actions').getByRole('button', {name: 'Clear'}),
            relationList = pane.locator('.fm-observatory-relation-list'),
            nodesHead    = pane.getByRole('button', {name: /^Nodes/});

        await land(read({
            route : [q('issue-1000'), q('issue-1023')],
            nodes,
            edges,
            counts: {nodes: 60, edges: edges.length, seeds: 2, communities: 2, paths: 1}
        }));
        await settle();

        await nodesHead.click();
        await expect(list).toBeVisible();
        await expect(rows).toHaveCount(60);

        const fullListHeight = await list.evaluate(el => el.clientHeight);

        // AC-4 + Condition 1 & 2: clicking row 23 shows details, facts, Open and relations with no second click,
        // keeps row 23 + row 24 fully inside the list viewport, and sizes the 1-relation selection to its content (< 50% of side panel)
        await rows.nth(23).evaluate(el => el.scrollIntoView({block: 'end'}));
        await rows.nth(23).click();

        await expect(selection).toHaveText(nodes[23].label);
        await expect(selectedPane).not.toHaveClass(/is-collapsed/);
        await expect(selectedPane).toHaveClass(/is-split/);
        await expect(facts).toBeVisible();
        await expect(openLink, 'AC-4: mouse click reaches Open with no second click').toBeVisible();
        await expect(openLink).toHaveAttribute('href', 'https://github.com/neomjs/neo/issues/1023');
        await expect(clearBtn).toBeVisible();

        // Condition 1: row 23 and one row of context below it (row 24) sit completely inside the list's visible box
        await expect.poll(async () => {
            const [listBox, rowBox, nextBox] = await Promise.all([
                list.boundingBox(),
                rows.nth(23).boundingBox(),
                rows.nth(24).boundingBox()
            ]);

            return Boolean(listBox && rowBox && nextBox &&
                rowBox.y >= listBox.y - 1 &&
                nextBox.y + nextBox.height <= listBox.y + listBox.height + 1);
        }, {message: 'selected row is fully in view with one row of context below it'}).toBe(true);

        // Condition 2 (short content): 1 relation takes content height, well under half the side panel
        const [sideBox, shortSelBox] = await Promise.all([side.boundingBox(), selectedPane.boundingBox()]);
        expect(shortSelBox.height).toBeLessThan(sideBox.height * 0.45);

        // Condition 3: Clear closes the split and returns the list to its full height at the same scroll position
        const scrollBeforeClear = await list.evaluate(el => el.scrollTop);
        expect(scrollBeforeClear).toBeGreaterThan(0);

        await clearBtn.click();
        await expect(selectedPane).toHaveClass(/is-collapsed/);
        expect(await list.evaluate(el => el.clientHeight)).toBe(fullListHeight);
        expect(await list.evaluate(el => el.scrollTop)).toBe(scrollBeforeClear);

        // AC-2 + Condition 4: real key events from the NODES head
        await list.evaluate(el => el.scrollTo({top: 0, behavior: 'instant'}));
        await nodesHead.focus();
        await expect(nodesHead).toBeFocused();

        await page.keyboard.press('ArrowDown');
        await expect(rows.nth(0), 'ArrowDown from Nodes head focuses row 0').toBeFocused();
        await expect(selection).toHaveText(nodes[0].label);
        expect((await stats()).selectedId).toBe(q('issue-1000'));

        // Condition 2 (tall content): 18 relations cap around half the side panel and scroll inside
        const tallSelBox = await selectedPane.boundingBox();
        expect(tallSelBox.height).toBeLessThanOrEqual(sideBox.height * 0.52);
        expect(await relationList.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);

        // ArrowUp on row 0 returns focus to the NODES head
        await page.keyboard.press('ArrowUp');
        await expect(nodesHead, 'ArrowUp on the first row returns to the Nodes head').toBeFocused();

        // ArrowDown re-enters the selected row; walk down into scrolled territory
        await page.keyboard.press('ArrowDown');
        await expect(rows.nth(0)).toBeFocused();

        for (let step = 0; step < 18; step++) {
            await page.keyboard.press('ArrowDown');
        }

        await expect(rows.nth(18)).toBeFocused();
        await expect(selection).toHaveText(nodes[18].label);
        await expect.poll(async () => {
            const [listBox, nextBox] = await Promise.all([list.boundingBox(), rows.nth(19).boundingBox()]);
            return Boolean(listBox && nextBox && nextBox.y + nextBox.height <= listBox.y + listBox.height + 1);
        }).toBe(true);

        const heldScrollTop = await list.evaluate(el => el.scrollTop);
        expect(heldScrollTop).toBeGreaterThan(0);

        // Enter moves focus to the selection's first action; Escape returns focus to that row at the same scrollTop
        await page.keyboard.press('Enter');
        await expect(openLink, 'Enter moves focus to the first action').toBeFocused();

        await page.keyboard.press('Escape');
        await expect(rows.nth(18), 'Escape returns focus to the row').toBeFocused();
        expect(await list.evaluate(el => el.scrollTop), 'at the same scroll position').toBe(heldScrollTop);
        expect((await stats()).selectedId).toBe(q('issue-1018'));

        // Space also moves focus to the first action; Escape returns to the row, and a second Escape closes the split at the same scrollTop
        await page.keyboard.press(' ');
        await expect(openLink, 'Space moves focus to the first action').toBeFocused();

        await page.keyboard.press('Escape');
        await expect(rows.nth(18)).toBeFocused();
        expect(await list.evaluate(el => el.scrollTop)).toBe(heldScrollTop);

        await page.keyboard.press('Escape');
        await expect(selectedPane).toHaveClass(/is-collapsed/);
        expect((await stats()).selectedId).toBeNull();
        expect(await list.evaluate(el => el.scrollTop), 'Escape closes the split at the same scroll position').toBe(heldScrollTop);

        // Light-theme WCAG contrast check on .fm-observatory-selected-facts (>= 4.5 : 1)
        await rows.nth(18).click();
        await expect(facts).toBeVisible();
        await page.evaluate(() => {
            document.documentElement.classList.remove('neo-theme-neo-dark');
            document.documentElement.classList.add('neo-theme-neo-light');
            document.body?.classList.remove('neo-theme-neo-dark');
            document.body?.classList.add('neo-theme-neo-light');
        });
        const contrast = await pane.evaluate(paneEl => {
            const
                factsEl = paneEl.querySelector('.fm-observatory-selected-facts'),
                parse   = rgb => rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(v => {
                    const c = Number(v) / 255;
                    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                }),
                lum     = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b,
                fg      = lum(parse(getComputedStyle(factsEl).color)),
                bg      = lum(parse(getComputedStyle(paneEl).backgroundColor));
            return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        });
        expect(contrast, 'facts contrast in neo-theme-neo-light meets 4.5:1').toBeGreaterThanOrEqual(4.5)
    });
});
