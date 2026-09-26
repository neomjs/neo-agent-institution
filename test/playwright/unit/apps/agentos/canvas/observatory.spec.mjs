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
 * the layout's scene inked into the engine's flat scene by currency and theme, `pick` answering the node
 * rather than the engine's index, and the stats counting the pane's scene.
 */

/**
 * A WebGL2 stand-in for the sizing path: a canvas with a size, and the viewport calls ignored.
 * @returns {Object}
 */
const createContext = () => ({canvas: {width: 400, height: 200}, viewport: () => {}});

/**
 * A layout scene: two items on the route, a citation of the first with an edge to it.
 * @param {String} currency
 * @returns {Object}
 */
const layoutScene = currency => ({
    currency,
    empty: false,
    nodes: [
        {id: 'issue:1', kind: 'item',     label: 'First',  rank: 1, score: 9, weight: 1,   x: 0,    y: 0.5, z: 0},
        {id: 'issue:2', kind: 'item',     label: 'Second', rank: 2, score: 4, weight: 0.5, x: 0.6,  y: 0,   z: 0.2},
        {id: 'pull:3',  kind: 'citation', label: 'Cited',  weight: 0,         x: -0.4, y: 0.4,  z: 0.1}
    ],
    edges: [[0, 2]],
    route: [0, 1]
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

    test('a current scene inks the route and its items in the signal, citations dim, the route as one path', () => {
        const
            flat   = Observatory.ink(layoutScene('current')),
            {dark} = PALETTES;

        expect(colorOf(flat.colors, 0)).toEqual(rgb(dark.signal));
        expect(colorOf(flat.colors, 1)).toEqual(rgb(dark.signal));
        expect(colorOf(flat.colors, 2)).toEqual(rgb(dark.inkDim));
        expect(flat.sizes).toEqual([52, 39.5, 17]);
        expect(flat.positions).toEqual([0, 0.5, 0,  0.6, 0, 0.2,  -0.4, 0.4, 0.1]);
        expect(flat.edges).toEqual([0, 2]);
        expect(flat.paths).toEqual([[0, 1]])
    });

    test('a withheld scene inks its items dim; an empty or missing scene draws nothing', () => {
        const flat = Observatory.ink(layoutScene('withheld'));

        expect(colorOf(flat.colors, 0)).toEqual(rgb(PALETTES.dark.inkDim));
        expect(Observatory.ink({currency: 'degraded', empty: true, nodes: [], edges: [], route: []})).toBeNull();
        expect(Observatory.ink(null)).toBeNull()
    });

    test('pick answers the node under a position, and the stats count the pane scene with its currency', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: layoutScene('current'), windowId: 'window-1'});

        const [x, y] = GraphScene.project(Observatory.matrix(), 0.6, 0, 0.2, 400, 200);

        expect(Observatory.pick({x, y})).toEqual({id: 'issue:2', kind: 'item', label: 'Second', rank: 2, score: 4});
        expect(Observatory.pick({x: -100, y: -100})).toBeNull();
        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 3, edges: 1, route: 2}, currency: 'current'});

        Observatory.setScene({scene: {currency: 'degraded', empty: true, nodes: [], edges: [], route: []}});

        expect(Observatory.getStats()).toMatchObject({counts: {nodes: 0, edges: 0, route: 0}, currency: 'degraded'});
        expect(Observatory.scene, 'an empty scene clears the engine surface').toBeNull()
    });

    test('a theme change inks the drawn scene again in the new palette', () => {
        Observatory.context = createContext();
        Observatory.updateSize({width: 400, height: 200, devicePixelRatio: 1});
        Observatory.setScene({scene: layoutScene('current')});

        Observatory.theme = 'light';

        expect(colorOf(Observatory.scene.colors, 0).map(value => Math.round(value * 1000))).toEqual(rgb(PALETTES.light.signal).map(value => Math.round(value * 1000)))
    });
});
