import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'ObservatoryCanvasTest', isMounted: () => true, vnodeInitialising: false}
});

import {expect, test}    from '@playwright/test';
import Neo               from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core         from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import ObservatoryCanvas from '../../../../../../../../apps/agentos/view/fleet/goldenpath/ObservatoryCanvas.mjs';

const
    nodeA = {id: 'neomjs/neo#issue-1', label: 'one', kind: 'issue', rank: 1,    hop: 0, cluster: 0, x: 0.1, y: 0.2, z: 0.3},
    nodeB = {id: 'neomjs/neo#issue-2', label: 'two', kind: 'issue', rank: null, hop: 1, cluster: 0, x: 0.4, y: 0.5, z: 0.6};

/**
 * @summary A layout scene of the two nodes, the first a seed, one edge between them.
 * @param {String} snapshotId
 * @returns {Object}
 */
const sceneOf = snapshotId => ({
    communities : 1,
    completeness: 'complete',
    currency    : 'current',
    edges       : [[0, 1]],
    edgeTypes   : ['relates'],
    empty       : false,
    index       : {[nodeA.id]: 0, [nodeB.id]: 1},
    nodes       : [nodeA, nodeB],
    seeds       : [0],
    snapshotId
});

/**
 * @summary The pointer handlers are the class's own methods, through the engine's forwarding: a prototype
 * host whose own data properties shadow the reactive configs, a renderer that records what the worker would
 * receive, and a `fire` that records what the pane would hear.
 * @param {Function} pick The renderer's pick, which answers a node index
 * @returns {{canvas: Object, selections: Array}}
 */
function makeCanvas(pick = async () => 0) {
    const
        canvas     = Object.create(ObservatoryCanvas.prototype),
        selections = [];

    Object.entries({
        canvasRect   : {left: 0, top: 0},
        fire         : (name, {node}) => name === 'nodeSelect' && selections.push(node?.id ?? null),
        hoveredId    : null,
        isCanvasReady: true,
        isDestroyed  : false,
        pressedAt    : null,
        renderer     : {pick, updateMouseState: () => {}},
        scene        : sceneOf('snap-1'),
        windowId     : 'window-1'
    }).forEach(([key, value]) => Object.defineProperty(canvas, key, {configurable: true, enumerable: true, value, writable: true}));

    return {canvas, selections}
}

const
    at      = (offsetX, offsetY, buttons = 0) => ({buttons, offsetX, offsetY}),
    gesture = async (canvas, points) => {
        canvas.onMouseDown(at(...points[0], 1));

        for (const point of points.slice(1)) {
            await canvas.onMouseMove(at(...point, 1))
        }

        const [x, y] = points.at(-1);

        canvas.onMouseUp(at(x, y));
        await canvas.onClick(at(x, y))
    };

test.describe('AgentOS.view.fleet.goldenpath.ObservatoryCanvas — a click selects, an orbit never does', () => {
    test('a press the pointer never carried past the slop selects; an orbit selects nothing, even when it returns to its press point', async () => {
        const {canvas, selections} = makeCanvas();

        await gesture(canvas, [[20, 20]]);
        expect(selections, 'a plain click').toEqual([nodeA.id]);

        await gesture(canvas, [[20, 20], [22, 21], [20, 20]]);
        expect(selections, 'a hand that jitters inside the slop still clicks').toEqual([nodeA.id, nodeA.id]);

        await gesture(canvas, [[20, 20], [140, 50]]);
        expect(selections, 'a straight orbit').toHaveLength(2);

        await gesture(canvas, [[20, 20], [140, 50], [20, 20]]);
        expect(selections, 'an orbit that comes back to where it was pressed').toHaveLength(2)
    });

    test('a pick that answers after the scene changed selects nothing; the same pick on an unchanged scene selects; a miss selects nothing', async () => {
        let answer;

        const {canvas, selections} = makeCanvas(() => new Promise(resolve => { answer = resolve }));

        canvas.onMouseDown(at(20, 20, 1));

        const late = canvas.onClick(at(20, 20));

        canvas.scene = sceneOf('snap-2');
        answer(0);
        await late;

        expect(selections).toEqual([]);

        canvas.onMouseDown(at(20, 20, 1));

        const current = canvas.onClick(at(20, 20));

        answer(1);
        await current;

        canvas.onMouseDown(at(20, 20, 1));

        const miss = canvas.onClick(at(20, 20));

        answer(-1);
        await miss;

        expect(selections, 'the index resolves against the held scene; -1 is the empty surface').toEqual([nodeB.id, null])
    });

    test('a new selection, overlay or channel crosses to the worker alone; only a new scene carries the scene, with all of them, as typed arrays by index and no node object or id', () => {
        const
            {canvas} = makeCanvas(),
            calls    = [],
            heat     = Float32Array.from([1, 0]),
            lens     = {lens: Uint16Array.from([0, 1]), hues: Float32Array.from([178.75])};

        canvas.renderer = {
            setHeat        : data => calls.push(['setHeat', data]),
            setLens        : data => calls.push(['setLens', data]),
            setRouteOverlay: data => calls.push(['setRouteOverlay', data]),
            setScene       : data => calls.push(['setScene', data]),
            setSelection   : data => calls.push(['setSelection', data])
        };

        ['heat', 'lens', 'routeOverlay', 'selectedId'].forEach(key => Object.defineProperty(canvas, key, {configurable: true, enumerable: true, value: null, writable: true}));

        canvas.afterSetSelectedId(nodeB.id, null);
        canvas.afterSetRouteOverlay(false, true);
        canvas.afterSetHeat(heat, null);
        canvas.afterSetLens(lens, null);
        Object.assign(canvas, {heat, lens, selectedId: nodeB.id});
        canvas.pushScene();

        expect(calls.slice(0, 4)).toEqual([
            ['setSelection',    {selected: 1, windowId: 'window-1'}],
            ['setRouteOverlay', {routeOverlay: false, windowId: 'window-1'}],
            ['setHeat',         {heat, windowId: 'window-1'}],
            ['setLens',         {lens, windowId: 'window-1'}]
        ]);

        const [name, {scene, ...rest}] = calls[4];

        expect(name).toBe('setScene');
        expect(rest).toEqual({heat, lens, routeOverlay: null, selected: 1, windowId: 'window-1'});
        expect(scene.positions).toBeInstanceOf(Float32Array);
        expect([scene.clusters, scene.edges, scene.seeds, scene.ranks].every(array => array instanceof Uint32Array)).toBe(true);
        expect(Object.values(scene).filter(value => Array.isArray(value) || (value && typeof value === 'object' && !ArrayBuffer.isView(value))), 'no plain array or object crosses').toEqual([]);

        canvas.afterSetSelectedId('neomjs/neo#gone', null);
        expect(calls.at(-1), 'an id the scene lacks crosses as no index').toEqual(['setSelection', {selected: -1, windowId: 'window-1'}])
    });

    test('a hover names the held scene\'s node; locate asks by index; the stats name the drawn selection by its id', async () => {
        const {canvas} = makeCanvas(async () => 1), hovers = [], asked = [];

        canvas.fire = (name, {node}) => name === 'nodeHover' && hovers.push(node?.id ?? null);

        await canvas.onMouseMove(at(30, 30));
        expect(hovers).toEqual([nodeB.id]);

        canvas.renderer.locate   = async data => (asked.push(data), {x: 1, y: 2});
        canvas.renderer.getStats = async () => ({counts: {nodes: 2}, selected: 1});

        expect(await canvas.locate(nodeB.id)).toEqual({x: 1, y: 2});
        expect(await canvas.locate('neomjs/neo#gone'), 'an id the scene lacks is not asked about').toBeNull();
        expect(asked).toEqual([{index: 1, windowId: 'window-1'}]);
        expect(await canvas.readStats()).toEqual({counts: {nodes: 2}, selectedId: nodeB.id})
    });
});
