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
import Observatory     from '../../../../../../apps/agentos/canvas/Observatory.mjs';
import {PALETTES, rgb} from '../../../../../../apps/agentos/canvas/fmPalette.mjs';

/**
 * @summary The observatory renderer's own contract on top of `Neo.canvas.GraphScene`, without a GL context:
 * the layout's graph scene inked into the engine's flat scene by hop, currency, selection and theme, only the
 * feed's edges drawn, `pick` answering the node rather than the engine's index, and the stats counting the
 * pane's scene.
 */

/**
 * A WebGL2 stand-in for the sizing path: a canvas with a size, and the viewport calls ignored.
 * @returns {Object}
 */
const createContext = () => ({canvas: {width: 400, height: 200}, viewport: () => {}});

/**
 * A layout scene: two seeds (ranks 1 and 3; the budget cut rank 2), one node a hop out of the first, one two
 * hops out, one no seed reaches; the feed's two edges, one untyped.
 * @param {String} currency
 * @returns {Object}
 */
const layoutScene = currency => ({
    currency,
    empty       : false,
    nodes       : [
        {id: 'o#pr-1',    kind: 'pull',    label: 'First',  rank: 1,    hop: 0,    cluster: 'o#pr-1', x: 0,    y: 0.5,  z: 0},
        {id: 'o#issue-3', kind: 'issue',   label: 'Third',  rank: 3,    hop: 0,    cluster: 'o#issue-3', x: 0.6, y: -0.5, z: 0.2},
        {id: 'o#agent-7', kind: 'agent',   label: 'Near',   rank: null, hop: 1,    cluster: 'o#pr-1', x: -0.3, y: 0.3,  z: 0.1},
        {id: 'o#issue-9', kind: 'issue',   label: 'Far',    rank: null, hop: 2,    cluster: 'o#pr-1', x: -0.5, y: 0.2,  z: 0.3},
        {id: 'o#note-4',  kind: 'concept', label: 'Loose',  rank: null, hop: null, cluster: null,     x: 0.2,  y: -0.9, z: -0.4}
    ],
    edges       : [[0, 2], [2, 3]],
    edgeTypes   : ['authored', null],
    seeds       : [0, 1],
    index       : {'o#pr-1': 0, 'o#issue-3': 1, 'o#agent-7': 2, 'o#issue-9': 3, 'o#note-4': 4},
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

test.describe('AgentOS.canvas.Observatory', () => {
    test.beforeEach(() => {
        Observatory.isPaused = true;
        Observatory.theme    = 'dark';
        Observatory.setScene({scene: null})
    });

    test('a current read inks down by hop — seeds in the signal, one hop out in ink, further dim — sizes the seeds by rank, and draws only the feed\'s edges', () => {
        const
            flat   = Observatory.ink(layoutScene('current')),
            {dark} = PALETTES;

        expect([0, 1, 2, 3, 4].map(index => colorOf(flat.colors, index))).toEqual([dark.signal, dark.signal, dark.ink, dark.inkDim, dark.inkDim].map(rgb));
        expect(flat.sizes, 'rank 1 largest, the last rank smallest, then one hop, then the rest').toEqual([52, 27, 17, 12, 12]);
        expect(flat.positions).toEqual([0, 0.5, 0,  0.6, -0.5, 0.2,  -0.3, 0.3, 0.1,  -0.5, 0.2, 0.3,  0.2, -0.9, -0.4]);
        expect(flat.edges).toEqual([0, 2, 2, 3]);
        expect(flat.paths, 'no line joins the route\'s ranks').toBeUndefined()
    });

    test('a degraded read never spends the signal; an empty or missing scene draws nothing', () => {
        const flat = Observatory.ink(layoutScene('degraded')), {dark} = PALETTES;

        expect([0, 2, 3].map(index => colorOf(flat.colors, index))).toEqual([dark.ink, dark.inkDim, dark.inkDim].map(rgb));
        expect(Observatory.ink({currency: 'unavailable', empty: true, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}})).toBeNull();
        expect(Observatory.ink(null)).toBeNull()
    });

    test('a selection grows its node and fades — dims and shrinks — every node but it and its neighbours; an id the scene lacks selects nothing', () => {
        const
            {dark} = PALETTES,
            flat   = Observatory.ink(layoutScene('current'), 'o#agent-7');

        expect([0, 1, 2, 3, 4].map(index => colorOf(flat.colors, index))).toEqual([dark.signal, dark.line, dark.ink, dark.inkDim, dark.line].map(rgb));
        expect(flat.sizes.map(size => Math.round(size * 100) / 100)).toEqual([52, 27 * 0.6, 17 * 1.25, 12, 12 * 0.6].map(size => Math.round(size * 100) / 100));
        expect(Observatory.ink(layoutScene('current'), 'o#gone')).toEqual(Observatory.ink(layoutScene('current')))
    });

    test('pick answers the node under a position; the stats count the pane scene with its currency, completeness, snapshot and the drawn selection', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: layoutScene('current'), selectedId: 'o#issue-3', windowId: 'window-1'});

        const [x, y] = GraphScene.project(Observatory.matrix(), 0.6, -0.5, 0.2, 400, 200);

        expect(Observatory.pick({x, y})).toEqual({id: 'o#issue-3', kind: 'issue', label: 'Third', rank: 3, hop: 0, cluster: 'o#issue-3'});
        expect(Observatory.pick({x: -100, y: -100})).toBeNull();
        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 5, edges: 2, seeds: 2}, currency: 'current', completeness: 'truncated', snapshotId: 'snap-1', selectedId: 'o#issue-3'});

        const at = Observatory.locate({id: 'o#issue-3'});

        expect(at, 'locate is pick\'s inverse').toEqual({x, y});
        expect(Observatory.pick(at)).toMatchObject({id: 'o#issue-3'});
        expect(Observatory.locate({id: 'o#gone'})).toBeNull();

        Observatory.setScene({scene: layoutScene('current'), selectedId: 'o#gone'});
        expect(Observatory.getStats().selectedId, 'an id the scene lacks is not reported as drawn').toBeNull();

        Observatory.setScene({scene: {currency: 'unavailable', empty: true, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}, completeness: null, snapshotId: null}});

        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 0, edges: 0, seeds: 0}, currency: 'unavailable'});
        expect(Observatory.scene, 'an empty scene clears the engine surface').toBeNull()
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

        const rounded = triple => triple.map(value => Math.round(value * 1000));

        expect(rounded(colorOf(Observatory.scene.colors, 0))).toEqual(rounded(rgb(PALETTES.light.signal)));
        expect(rounded(colorOf(Observatory.scene.colors, 1)), 'the selection still fades the unrelated seed').toEqual(rounded(rgb(PALETTES.light.line)))
    });
});
