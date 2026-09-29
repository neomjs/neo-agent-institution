import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'ObservatoryRendererTest'
    }
});

import {test, expect}  from '@playwright/test';
import Neo             from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core       from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import GraphScene      from '../../../../../../node_modules/neo.mjs/src/canvas/GraphScene.mjs';
import Observatory            from '../../../../../../apps/agentos/canvas/Observatory.mjs';
import ObservatorySceneLayout from '../../../../../../apps/agentos/util/ObservatorySceneLayout.mjs';
import {PALETTES, rgb}        from '../../../../../../apps/agentos/canvas/fmPalette.mjs';
import {wholeGraphEnvelope}   from '../../../../fixture/wholeGraphScene.mjs';

/**
 * @summary The observatory renderer's own contract on top of `Neo.canvas.GraphScene`, without a GL context:
 * the layout's graph scene, in its wire form, inked into the engine's flat scene by community, route overlay,
 * currency, selection and theme, the communities handed on as `clusters` and the route as a path, `pick` and
 * `locate` answering by node index, and the stats counting the pane's scene.
 */

/**
 * A WebGL2 stand-in for the sizing path: a canvas with a size, and the viewport calls ignored.
 * @returns {Object}
 */
const createContext = () => ({canvas: {width: 400, height: 200}, viewport: () => {}});

/**
 * A layout scene: two seeds (ranks 1 and 3; the budget cut rank 2) in communities 0 and 1, two more nodes in
 * the first seed's community, one unlinked node in its own; the feed's two edges, one untyped.
 * @param {String} currency
 * @returns {Object}
 */
const layoutScene = currency => ({
    currency,
    empty       : false,
    nodes       : [
        {id: 'o#pr-1',    kind: 'pull',    label: 'First',  rank: 1,    hop: 0,    cluster: 0, x: 0,    y: 0.5,  z: 0},
        {id: 'o#issue-3', kind: 'issue',   label: 'Third',  rank: 3,    hop: 0,    cluster: 1, x: 0.6,  y: -0.5, z: 0.2},
        {id: 'o#agent-7', kind: 'agent',   label: 'Near',   rank: null, hop: 1,    cluster: 0, x: -0.3, y: 0.3,  z: 0.1},
        {id: 'o#issue-9', kind: 'issue',   label: 'Far',    rank: null, hop: 2,    cluster: 0, x: -0.5, y: 0.2,  z: 0.3},
        {id: 'o#note-4',  kind: 'concept', label: 'Loose',  rank: null, hop: null, cluster: 2, x: 0.2,  y: -0.9, z: -0.4}
    ],
    edges       : [[0, 2], [2, 3]],
    edgeTypes   : ['authored', null],
    seeds       : [0, 1],
    index       : {'o#pr-1': 0, 'o#issue-3': 1, 'o#agent-7': 2, 'o#issue-9': 3, 'o#note-4': 4},
    communities : 3,
    completeness: 'truncated',
    snapshotId  : 'snap-1'
});

/**
 * The layout scene in the form the App Worker hands the renderer.
 * @param {String} currency
 * @returns {Object}
 */
const wireScene = currency => ObservatorySceneLayout.wire(layoutScene(currency));

/**
 * An empty read's scene, in its wire form.
 * @type {Object}
 */
const EMPTY = ObservatorySceneLayout.wire({currency: 'unavailable', empty: true, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}, communities: 0, completeness: null, snapshotId: null});

/**
 * Reads a colour triple back from the flat scene.
 * @param {Float32Array} colors
 * @param {Number} index
 * @returns {Number[]}
 */
const colorOf = (colors, index) => Array.from(colors.slice(index * 3, index * 3 + 3));

/**
 * A community's tone in the renderer's current skin. The arms test which node takes which community's tone; the
 * palette itself is the arm below.
 * @param {Object} palette Unused: the renderer's skin decides
 * @param {Number} community
 * @returns {Number[]}
 */
const toneOf = (palette, community) => Observatory.toneOf(community);

const rounded = triple => Array.from(triple, value => Math.round(value * 1000));

/**
 * A typed array as plain numbers at a precision a 32-bit float keeps.
 * @param {ArrayLike<Number>} values
 * @returns {Number[]}
 */
const plain = values => Array.from(values, value => Math.round(value * 1000) / 1000);

test.describe('AgentOS.canvas.Observatory', () => {
    test.beforeEach(() => {
        Observatory.isPaused = true;
        Observatory.theme    = 'dark';
        Observatory.setScene({scene: null})
    });

    test('a current read inks by community, the route\'s seeds in its gold sized by rank; the communities and the route path go to the engine', () => {
        const flat = Observatory.ink(wireScene('current')), {dark} = PALETTES;

        expect([0, 1, 2, 3, 4].map(index => rounded(colorOf(flat.colors, index)))).toEqual([rgb(dark.route), rgb(dark.route), toneOf(dark, 0), toneOf(dark, 0), toneOf(dark, 2)].map(rounded));
        expect(plain(flat.sizes), 'rank 1 largest, the last rank smallest, every other node the same').toEqual([10, 6, 5, 5, 5]);
        expect(flat.clusters, 'a small read draws every node, at any distance').toBeNull();
        expect(flat.paths.map(path => plain(path)), 'the route joins its seeds in route order').toEqual([[0, 1]]);
        expect(plain(flat.positions)).toEqual([0, 0.5, 0,  0.6, -0.5, 0.2,  -0.3, 0.3, 0.1,  -0.5, 0.2, 0.3,  0.2, -0.9, -0.4]);
        expect(plain(flat.edges)).toEqual([0, 2, 2, 3])
    });

    test('the communities read apart and never as the route: distinct tones, none in the gold band, lighter in the dark skin than the light', () => {
        const
            hue    = ([r, g, b]) => {
                const max = Math.max(r, g, b), span = max - Math.min(r, g, b);

                return span ? ((max === r ? (g - b) / span % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4) * 60 + 360) % 360 : 0
            },
            // the band's edges are hues a tone may take, so the round trip through rgb gets half a degree
            inGold = tone => hue(tone) > 25.5 && hue(tone) < 84.5,
            dark   = Array.from({length: 64}, (item, community) => Observatory.toneOf(community));

        expect(new Set(dark.slice(0, 4).map(tone => rounded(tone).join())).size, 'four communities, four tones').toBe(4);
        expect(inGold(rgb(PALETTES.dark.route)), 'the band holds the route\'s gold').toBe(true);
        expect(dark.filter(inGold), 'no community of 64 takes a hue in the band').toEqual([]);

        Observatory.theme = 'light';

        const light = Observatory.toneOf(0);

        expect(Math.max(...light), 'the light skin inks its communities darker').toBeLessThan(Math.max(...dark[0]))
    });

    test('a denser read draws smaller nodes: full size up to 400 nodes, then shrinking toward the floor; a selection stands out of the dust', () => {
        const
            sceneOf = count => ObservatorySceneLayout.wire(ObservatorySceneLayout.fromGraphScene(wholeGraphEnvelope({communities: 4, nodes: count, routeLength: 0}))),
            dense   = sceneOf(64000);

        expect(Observatory.ink(sceneOf(400)).sizes[0]).toBe(5);
        expect(Observatory.ink(sceneOf(1600)).sizes[0]).toBeCloseTo(2.5, 6);
        expect(Observatory.ink(dense).sizes[0]).toBeCloseTo(0.4, 6);
        expect(Observatory.ink(dense, 0).sizes[0], 'the selected node takes at least the last seed\'s size').toBe(6)
    });

    test('the wire scene carries the layout as typed arrays by node index, and no node object or id', () => {
        const scene = layoutScene('current'), wire = ObservatorySceneLayout.wire(scene);

        expect(wire.positions).toBeInstanceOf(Float32Array);
        expect([wire.clusters, wire.edges, wire.seeds, wire.ranks].every(array => array instanceof Uint32Array)).toBe(true);
        expect(wire).toMatchObject({communities: 3, completeness: 'truncated', count: 5, currency: 'current', empty: false, snapshotId: 'snap-1'});
        expect([plain(wire.clusters), plain(wire.edges), plain(wire.seeds), plain(wire.ranks)]).toEqual([[0, 1, 0, 0, 2], [0, 2, 2, 3], [0, 1], [1, 3]]);
        expect(Object.keys(wire).filter(key => ['index', 'nodes', 'edgeTypes'].includes(key)), 'nothing per node that is not a number').toEqual([]);
        expect(ObservatorySceneLayout.wire(null)).toBeNull()
    });

    test('a large read hands its communities to the engine: the fitted camera draws every node, a closer one the near level, one drawn back the far', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});

        const scene = ObservatorySceneLayout.wire(ObservatorySceneLayout.fromGraphScene(wholeGraphEnvelope({communities: 8, nodes: 2400, routeLength: 4})));

        Observatory.setScene({scene, windowId: 'window-1'});

        expect(Observatory.getStats().lod).toMatchObject({clusters: scene.communities});
        expect(Observatory.getLodLevel()).toBe('mid');

        Observatory.camera.dist *= 0.5;
        expect(Observatory.getLodLevel()).toBe('near');

        Observatory.camera.dist *= 3;
        expect(Observatory.getLodLevel()).toBe('far')
    });

    test('the dark skin adds its points up, so a dense community glows; the light skin keeps the engine\'s blend', () => {
        const calls = [];

        Observatory.context = {...createContext(), ONE: 1, ONE_MINUS_SRC_ALPHA: 771, blendFunc: (...args) => calls.push(args)};
        Observatory.render();
        Observatory.theme = 'light';
        Observatory.render();

        expect(calls).toEqual([[1, 1], [1, 771]])
    });

    test('the overlay off draws no path and inks the seeds as their communities at node size; positions, communities and edges stay', () => {
        const on = Observatory.ink(wireScene('current')), off = Observatory.ink(wireScene('current'), -1, false), {dark} = PALETTES;

        expect(off.paths).toEqual([]);
        expect([0, 1].map(index => rounded(colorOf(off.colors, index)))).toEqual([toneOf(dark, 0), toneOf(dark, 1)].map(rounded));
        expect(plain(off.sizes)).toEqual([5, 5, 5, 5, 5]);
        expect([off.positions, off.clusters, off.edges]).toEqual([on.positions, on.clusters, on.edges])
    });

    test('the halo\'s sector clusters ink faint and small, never in a community\'s tone; a scene without a halo inks as before', () => {
        const
            {dark} = PALETTES,
            base   = wireScene('current'),
            haloed = {...base, haloFrom: 1},
            flat   = Observatory.ink(haloed, -1, false);

        Array.from(haloed.clusters).forEach((cluster, index) => {
            expect(rounded(colorOf(flat.colors, index)), `node ${index}`).toEqual(rounded(cluster >= 1 ? rgb(dark.line) : toneOf(dark, cluster)));
            expect(Math.round(flat.sizes[index] * 100) / 100).toBe(cluster >= 1 ? 3 : 5)
        });

        expect(Observatory.ink({...base, haloFrom: null}, -1, false)).toEqual(Observatory.ink(base, -1, false))
    });

    test('a degraded read never spends the route\'s gold; an empty or missing scene draws nothing', () => {
        const flat = Observatory.ink(wireScene('degraded')), {dark} = PALETTES;

        expect([0, 1].map(index => rounded(colorOf(flat.colors, index)))).toEqual([dark.ink, dark.ink].map(hex => rounded(rgb(hex))));
        expect(Observatory.ink(EMPTY)).toBeNull();
        expect(Observatory.ink(null)).toBeNull()
    });

    test('a selection grows its node and fades — dims and shrinks — every node but it and its neighbours, while a drawn route only shrinks; an index the scene lacks selects nothing', () => {
        const
            {dark} = PALETTES,
            flat   = Observatory.ink(wireScene('current'), 2);

        expect([0, 1, 2, 3, 4].map(index => rounded(colorOf(flat.colors, index)))).toEqual([rgb(dark.route), rgb(dark.route), toneOf(dark, 0), toneOf(dark, 0), rgb(dark.line)].map(rounded));
        expect(Array.from(flat.sizes, size => Math.round(size * 100) / 100)).toEqual([10, 6 * 0.6, 5 * 1.6, 5, 5 * 0.6].map(size => Math.round(size * 100) / 100));
        expect(Observatory.ink(wireScene('current'), 99)).toEqual(Observatory.ink(wireScene('current')))
    });

    test('the team lens inks each checked peer\'s nodes in its hue, a route\'s too, and fades the rest, where a route node no peer holds keeps its gold; a lens of another scene\'s nodes waits for its own', () => {
        const
            {dark} = PALETTES,
            tones  = Observatory.communityTones,
            peer   = hue => Observatory.hsl(hue, tones.saturation, tones.lightness.dark),
            lens   = {lens: Uint16Array.from([0, 1, 2, 0, 1]), hues: Float32Array.from([120, 240])},
            flat   = Observatory.ink(wireScene('current'), -1, true, {heat: null, lens});

        expect([0, 1, 2, 3, 4].map(index => rounded(colorOf(flat.colors, index)))).toEqual([rgb(dark.route), peer(120), peer(240), rgb(dark.line), peer(120)].map(rounded));
        expect(plain(flat.sizes), 'what no checked peer holds recedes, a seed too').toEqual([6, 6, 5, 3, 5]);
        expect(Observatory.ink(wireScene('current'), -1, true, {heat: null, lens: {lens: new Uint16Array(3), hues: new Float32Array(1)}}), 'three entries are not this scene\'s five')
            .toEqual(Observatory.ink(wireScene('current'), -1, true, {heat: null, lens: null}))
    });

    test('the heat brightens and grows what drew attention, a route\'s nodes too, fades the cold, greys the unknown, and moves nothing', () => {
        const
            {dark} = PALETTES,
            heat   = Float32Array.from([1, 0, 1, 0.5, NaN]),
            flat   = Observatory.ink(wireScene('current'), -1, true, {heat, lens: null}),
            mix    = (from, to, share) => from.map((value, channel) => value + (to[channel] - value) * share);

        expect([0, 1].map(index => rounded(colorOf(flat.colors, index))), 'a hot seed and a cold one, the path still drawn through both').toEqual([rgb(dark.signal), rgb(dark.line)].map(rounded));
        expect(flat.paths.map(path => Array.from(path)), 'the route stays drawn').toEqual([[0, 1]]);
        expect(rounded(colorOf(flat.colors, 2)), 'the hottest takes the signal').toEqual(rounded(rgb(dark.signal)));
        expect(rounded(colorOf(flat.colors, 3)), 'half the heat lies halfway from the line').toEqual(rounded(mix(rgb(dark.line), rgb(dark.signal), 0.5)));
        expect(rounded(colorOf(flat.colors, 4)), 'the unknown takes the dim ink, apart from the cold').toEqual(rounded(rgb(dark.inkDim)));
        expect(plain(flat.sizes)).toEqual([15, 3.6, 7.5, 5.25, 3]);
        expect(plain(flat.positions)).toEqual(plain(Observatory.ink(wireScene('current'), -1, true, {heat: null, lens: null}).positions))
    });

    test('the stats count the channels the drawn scene carries: the heat\'s known and unknown nodes, the lens\'s peers and nodes', () => {
        Observatory.setScene({scene: wireScene('current'), heat: Float32Array.from([1, 0, NaN, NaN, 0.2]), lens: {lens: Uint16Array.from([1, 0, 0, 1, 0]), hues: Float32Array.from([10])}});

        expect(Observatory.getStats().heat).toEqual({nodes: 3, unknown: 2});
        expect(Observatory.getStats().lens).toEqual({peers: 1, nodes: 2});

        Observatory.setHeat({heat: null});
        Observatory.setLens({lens: null});

        expect(Observatory.getStats().heat).toBeNull();
        expect(Observatory.getStats().lens).toBeNull()
    });

    test('pick answers the index under a position and locate is its inverse; the stats count the pane scene with its communities, currency, completeness, snapshot, selection and overlay', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: wireScene('current'), selected: 1, windowId: 'window-1'});

        const [x, y] = GraphScene.project(Observatory.matrix(), 0.6, -0.5, 0.2, 400, 200);

        expect(Observatory.pick({x, y})).toBe(1);
        expect(Observatory.pick({x: -100, y: -100})).toBe(-1);
        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 5, edges: 2, seeds: 2, communities: 3}, currency: 'current', completeness: 'truncated', snapshotId: 'snap-1', selected: 1, routeOverlay: true});

        const at = Observatory.locate({index: 1});

        expect(at.x, 'locate is pick\'s inverse').toBeCloseTo(x, 3);
        expect(at.y).toBeCloseTo(y, 3);
        expect(Observatory.pick(at)).toBe(1);
        expect(Observatory.locate({index: 99})).toBeNull();

        Observatory.setScene({scene: wireScene('current'), selected: 99});
        expect(Observatory.getStats().selected, 'an index the scene lacks is not reported as drawn').toBe(-1);

        // frames count per scene: one drawn after a scene arrives is that scene's, never an earlier one's
        expect(Observatory.getStats().sceneFrames).toBe(0);
        Observatory.frames++;
        expect(Observatory.getStats().sceneFrames).toBe(1);
        Observatory.setSelection({selected: 0});
        expect(Observatory.getStats().sceneFrames, 'a selection inks the same scene again').toBe(1);
        Observatory.setScene({scene: wireScene('current')});
        expect(Observatory.getStats().sceneFrames, 'a new scene starts at none').toBe(0);

        Observatory.setScene({scene: EMPTY});

        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 0, edges: 0, seeds: 0, communities: 0}, currency: 'unavailable'});
        expect(Observatory.scene, 'an empty scene clears the engine surface').toBeNull()
    });

    test('a selection and the overlay ink the drawn scene again without a new one: the path comes and goes, nothing moves', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: wireScene('current'), windowId: 'window-1'});

        const before = Observatory.locate({index: 3});

        Observatory.setRouteOverlay({routeOverlay: false, windowId: 'window-1'});
        expect(Observatory.getStats()).toMatchObject({counts: {paths: 0}, routeOverlay: false});
        expect(Observatory.locate({index: 3})).toEqual(before);

        Observatory.setSelection({selected: 2, windowId: 'window-1'});
        expect(Observatory.getStats()).toMatchObject({selected: 2, routeOverlay: false});

        Observatory.setRouteOverlay({routeOverlay: true, windowId: 'window-1'});
        expect(Observatory.getStats()).toMatchObject({counts: {paths: 1}, routeOverlay: true, selected: 2});
        expect(Observatory.locate({index: 3})).toEqual(before);

        Observatory.setSelection({selected: 99, windowId: 'window-1'});
        expect(Observatory.getStats().selected).toBe(-1)
    });

    test('a scene the engine refuses leaves the drawn one answering: its node, its counts, its currency and its selection', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: wireScene('current'), selected: 0, windowId: 'window-1'});

        const
            [x, y]  = GraphScene.project(Observatory.matrix(), 0.6, -0.5, 0.2, 400, 200),
            refused = layoutScene('degraded');

        refused.edges = [[0, 99]];

        expect(() => Observatory.setScene({scene: ObservatorySceneLayout.wire(refused), selected: 0, windowId: 'window-1'})).toThrow(/index names a node/);

        expect(Observatory.pick({x, y})).toBe(1);
        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 5, edges: 2, seeds: 2}, currency: 'current', selected: 0})
    });

    test('a theme change inks the drawn scene and its selection again in the new palette', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: wireScene('current'), selected: 2});

        Observatory.theme = 'light';

        expect(rounded(colorOf(Observatory.scene.colors, 0))).toEqual(rounded(rgb(PALETTES.light.route)));
        expect(rounded(colorOf(Observatory.scene.colors, 4)), 'the selection still fades the unrelated node').toEqual(rounded(rgb(PALETTES.light.line)))
    });
});
