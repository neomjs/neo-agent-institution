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
        [canvas]     = await app.queryComponent({className: 'AgentOS.view.fleet.goldenpath.ObservatoryCanvas'}, ['id']);

    const locate = id => app.callMethod(canvas.properties.id, 'locate', [id]);

    return {
        currency : pane.locator('.fm-observatory-currency'),
        hover    : pane.locator('.fm-observatory-hover'),
        land     : envelope => app.callMethod(cockpitState.controller.id, 'writeGraphScene', [envelope]),
        locate,
        pane,
        // clicks a node where the renderer draws it
        selectNode: async id => {
            const rect = await pane.locator('canvas').boundingBox(), at = await locate(id);

            await page.mouse.click(rect.x + at.x, rect.y + at.y)
        },
        selection: pane.locator('.fm-observatory-selection'),
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
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · complete$/);
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
        await expect(selection).toHaveText('Selected · first route item · pull · neomjs/neo#pr-101 · rank 1 · 2 relations (1 authored, 1 mentions)');
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
        await expect(selection).toHaveText(/^Selected · first route item · /);

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
        expect(lost.counts).toEqual({nodes: 6, edges: 2, seeds: 2, communities: 3, paths: 1});

        // a click on the empty surface clears a selection
        await selectNode(q('issue-202'));
        await expect(selection).toHaveText(/^Selected · second route item · /);
        await page.mouse.click(rect.x + 6, rect.y + 6);
        await expect(selection).toHaveText('No node selected');

        await land(read({completeness: 'truncated'}, {snapshotId: 'snap-a1'}));
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · partial, budget 150 nodes \/ 300 edges \/ 32 KiB$/);
        await settle();
        expect((await stats()).completeness).toBe('truncated');

        await land(read({}, {capability: {state: 'degraded', reason: 'graph-seam-refused'}}));
        await expect(currency).toHaveText('Degraded · graph-seam-refused · 7 nodes · 4 edges · complete');
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
            relations = pane.locator('.fm-observatory-relation-list .neo-list-item');

        await land(read());
        await expect(rows).toHaveCount(7);
        await settle();

        await rows.nth(0).click();
        await expect(selection).toHaveText(/^Selected · first route item · pull · neomjs\/neo#pr-101 · /);
        expect((await stats()).selectedId, 'a list row selects on the canvas too').toBe(q('pr-101'));

        await page.keyboard.press('ArrowDown');
        await expect(selection, 'the arrow keys move the selection').toHaveText(/^Selected · second route item · issue · neomjs\/neo#issue-202 · /);
        expect((await stats()).selectedId).toBe(q('issue-202'));

        await expect(relations).toHaveText([/authored\s*from\s*Grace\s*agent/]);
        await relations.nth(0).click();
        await expect(selection, 'a relation row moves to its other end').toHaveText(/^Selected · Grace · agent · neomjs\/neo#agent-grace · /);

        await selectNode(q('issue-404'));
        await expect(selection).toHaveText(/^Selected · two hops out · /);
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
        await expect(selection, 'reading the human recommendation preserves the graph selection').toHaveText(/^Selected · two hops out · /);
        await page.waitForTimeout(400);
        expect((await stats()).selectedId).toBe(q('issue-404'))
    });

    test('the view keeps its scene and its selection across a switch away and back without a second read, and resizes with the window', async ({page, neuralLink}) => {
        const {currency, land, selection, selectNode, stats} = await openObservatory(page, neuralLink);

        await expect(currency, 'cold, the read is unavailable').toHaveText(/^Unavailable · /);
        await land(read());
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · complete$/);
        await page.waitForTimeout(400);

        await selectNode(q('issue-303'));
        await expect(selection).toHaveText(/^Selected · third route item · issue · neomjs\/neo#issue-303 · rank 3 · /);
        await page.waitForTimeout(400);

        const before = await stats();

        expect(before.counts).toEqual({nodes: 7, edges: 4, seeds: 3, communities: 3, paths: 1});

        // a read on the way back would answer unavailable (no fleet server takes part), so a current
        // line after the round trip is a read that did not happen
        await page.getByRole('tab', {name: 'Fleet', exact: true}).click();
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible();
        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();
        await expect(currency).toHaveText(/^Current · captured .+ · 7 nodes · 4 edges · complete$/);
        await expect(selection).toHaveText(/^Selected · third route item · /);
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
            {land, locate, pane, stats} = await openObservatory(page, neuralLink),
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
        expect(drawn.lod.clusters, 'most of the 64 generated groups are found').toBeGreaterThan(48);

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
});
