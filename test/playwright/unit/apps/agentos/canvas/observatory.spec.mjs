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
 * the layout's graph scene inked into the engine's flat scene by community, route overlay, currency, selection
 * and theme, the communities handed on as `clusters` and the route as a path, `pick` answering the node rather
 * than the engine's index, and the stats counting the pane's scene.
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
 * Reads a colour triple back from the flat scene.
 * @param {Number[]} colors
 * @param {Number} index
 * @returns {Number[]}
 */
const colorOf = (colors, index) => Array.from(colors.slice(index * 3, index * 3 + 3));

/**
 * A community's tone in a palette, as the renderer mixes it: a step from ink toward dim ink.
 * @param {Object} palette
 * @param {Number} community
 * @returns {Number[]}
 */
const toneOf = (palette, community) => {
    const ink = rgb(palette.ink), dim = rgb(palette.inkDim), share = community * 0.618034 % 1 * 0.8;

    return ink.map((value, channel) => value + (dim[channel] - value) * share)
};

const rounded = triple => triple.map(value => Math.round(value * 1000));

test.describe('AgentOS.canvas.Observatory', () => {
    test.beforeEach(() => {
        Observatory.isPaused = true;
        Observatory.theme    = 'dark';
        Observatory.setScene({scene: null})
    });

    test('a current read inks by community, the route\'s seeds in the signal sized by rank; the communities and the route path go to the engine', () => {
        const flat = Observatory.ink(layoutScene('current')), {dark} = PALETTES;

        expect([0, 1, 2, 3, 4].map(index => rounded(colorOf(flat.colors, index)))).toEqual([rgb(dark.signal), rgb(dark.signal), toneOf(dark, 0), toneOf(dark, 0), toneOf(dark, 2)].map(rounded));
        expect(flat.sizes, 'rank 1 largest, the last rank smallest, every other node the same').toEqual([52, 27, 12, 12, 12]);
        expect(flat.clusters, 'a small read draws every node, at any distance').toBeNull();
        expect(flat.paths, 'the route joins its seeds in route order').toEqual([[0, 1]]);
        expect(flat.positions).toEqual([0, 0.5, 0,  0.6, -0.5, 0.2,  -0.3, 0.3, 0.1,  -0.5, 0.2, 0.3,  0.2, -0.9, -0.4]);
        expect(flat.edges).toEqual([0, 2, 2, 3])
    });

    test('a large read hands its communities to the engine: the fitted camera draws the far level, closer ones mid and near', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});

        const scene = ObservatorySceneLayout.fromGraphScene(wholeGraphEnvelope({communities: 8, nodes: 2400, routeLength: 4}));

        Observatory.setScene({scene, windowId: 'window-1'});

        expect(Observatory.getStats().lod).toMatchObject({clusters: scene.communities});
        expect(Observatory.getLodLevel()).toBe('far');

        Observatory.camera.dist *= 0.7;
        expect(Observatory.getLodLevel()).toBe('mid');

        Observatory.camera.dist *= 0.7;
        expect(Observatory.getLodLevel()).toBe('near')
    });

    test('the overlay off draws no path and inks the seeds as their communities at node size; positions, communities and edges stay', () => {
        const on = Observatory.ink(layoutScene('current')), off = Observatory.ink(layoutScene('current'), null, false), {dark} = PALETTES;

        expect(off.paths).toEqual([]);
        expect([0, 1].map(index => rounded(colorOf(off.colors, index)))).toEqual([toneOf(dark, 0), toneOf(dark, 1)].map(rounded));
        expect(off.sizes).toEqual([12, 12, 12, 12, 12]);
        expect([off.positions, off.clusters, off.edges]).toEqual([on.positions, on.clusters, on.edges])
    });

    test('a degraded read never spends the signal; an empty or missing scene draws nothing', () => {
        const flat = Observatory.ink(layoutScene('degraded')), {dark} = PALETTES;

        expect([0, 1].map(index => colorOf(flat.colors, index))).toEqual([dark.ink, dark.ink].map(rgb));
        expect(Observatory.ink({currency: 'unavailable', empty: true, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}, communities: 0})).toBeNull();
        expect(Observatory.ink(null)).toBeNull()
    });

    test('a selection grows its node and fades — dims and shrinks — every node but it and its neighbours; an id the scene lacks selects nothing', () => {
        const
            {dark} = PALETTES,
            flat   = Observatory.ink(layoutScene('current'), 'o#agent-7');

        expect([0, 1, 2, 3, 4].map(index => rounded(colorOf(flat.colors, index)))).toEqual([rgb(dark.signal), rgb(dark.line), toneOf(dark, 0), toneOf(dark, 0), rgb(dark.line)].map(rounded));
        expect(flat.sizes.map(size => Math.round(size * 100) / 100)).toEqual([52, 27 * 0.6, 12 * 1.25, 12, 12 * 0.6].map(size => Math.round(size * 100) / 100));
        expect(Observatory.ink(layoutScene('current'), 'o#gone')).toEqual(Observatory.ink(layoutScene('current')))
    });

    test('pick answers the node under a position; the stats count the pane scene with its communities, currency, completeness, snapshot, selection and overlay', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: layoutScene('current'), selectedId: 'o#issue-3', windowId: 'window-1'});

        const [x, y] = GraphScene.project(Observatory.matrix(), 0.6, -0.5, 0.2, 400, 200);

        expect(Observatory.pick({x, y})).toEqual({id: 'o#issue-3', kind: 'issue', label: 'Third', rank: 3, hop: 0, cluster: 1});
        expect(Observatory.pick({x: -100, y: -100})).toBeNull();
        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 5, edges: 2, seeds: 2, communities: 3}, currency: 'current', completeness: 'truncated', snapshotId: 'snap-1', selectedId: 'o#issue-3', routeOverlay: true});

        const at = Observatory.locate({id: 'o#issue-3'});

        expect(at, 'locate is pick\'s inverse').toEqual({x, y});
        expect(Observatory.pick(at)).toMatchObject({id: 'o#issue-3'});
        expect(Observatory.locate({id: 'o#gone'})).toBeNull();

        Observatory.setScene({scene: layoutScene('current'), selectedId: 'o#gone'});
        expect(Observatory.getStats().selectedId, 'an id the scene lacks is not reported as drawn').toBeNull();

        Observatory.setScene({scene: {currency: 'unavailable', empty: true, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}, communities: 0, completeness: null, snapshotId: null}});

        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 0, edges: 0, seeds: 0, communities: 0}, currency: 'unavailable'});
        expect(Observatory.scene, 'an empty scene clears the engine surface').toBeNull()
    });

    test('a selection and the overlay ink the drawn scene again without a new one: the path comes and goes, nothing moves', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: layoutScene('current'), windowId: 'window-1'});

        const before = Observatory.locate({id: 'o#issue-9'});

        Observatory.setRouteOverlay({routeOverlay: false, windowId: 'window-1'});
        expect(Observatory.getStats()).toMatchObject({counts: {paths: 0}, routeOverlay: false});
        expect(Observatory.locate({id: 'o#issue-9'})).toEqual(before);

        Observatory.setSelection({selectedId: 'o#agent-7', windowId: 'window-1'});
        expect(Observatory.getStats()).toMatchObject({selectedId: 'o#agent-7', routeOverlay: false});

        Observatory.setRouteOverlay({routeOverlay: true, windowId: 'window-1'});
        expect(Observatory.getStats()).toMatchObject({counts: {paths: 1}, routeOverlay: true, selectedId: 'o#agent-7'});
        expect(Observatory.locate({id: 'o#issue-9'})).toEqual(before);

        Observatory.setSelection({selectedId: 'o#gone', windowId: 'window-1'});
        expect(Observatory.getStats().selectedId).toBeNull()
    });

    test('a scene the engine refuses leaves the drawn one answering: its node, its counts, its currency and its selection', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: layoutScene('current'), selectedId: 'o#pr-1', windowId: 'window-1'});

        const
            [x, y]  = GraphScene.project(Observatory.matrix(), 0.6, -0.5, 0.2, 400, 200),
            refused = layoutScene('degraded');

        refused.nodes = refused.nodes.map(node => ({...node, id: `refused:${node.id}`}));
        refused.edges = [[0, 99]];

        expect(() => Observatory.setScene({scene: refused, selectedId: 'refused:o#pr-1', windowId: 'window-1'})).toThrow(/index names a node/);

        expect(Observatory.pick({x, y})).toMatchObject({id: 'o#issue-3'});
        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 5, edges: 2, seeds: 2}, currency: 'current', selectedId: 'o#pr-1'})
    });

    test('a theme change inks the drawn scene and its selection again in the new palette', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: layoutScene('current'), selectedId: 'o#agent-7'});

        Observatory.theme = 'light';

        expect(rounded(colorOf(Observatory.scene.colors, 0))).toEqual(rounded(rgb(PALETTES.light.signal)));
        expect(rounded(colorOf(Observatory.scene.colors, 1)), 'the selection still fades the unrelated seed').toEqual(rounded(rgb(PALETTES.light.line)))
    });
});
