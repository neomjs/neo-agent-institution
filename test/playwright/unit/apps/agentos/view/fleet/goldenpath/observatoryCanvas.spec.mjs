import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'ObservatoryCanvasTest', isMounted: () => true, vnodeInitialising: false}
});

import {expect, test}    from '@playwright/test';
import Neo               from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core         from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import ObservatoryCanvas from '../../../../../../../../apps/agentos/view/fleet/goldenpath/ObservatoryCanvas.mjs';

const nodeA = {id: 'neomjs/neo#issue-1', label: 'one', kind: 'issue'};

/**
 * @summary The pointer handlers are the class's own methods, through the engine's forwarding: a prototype
 * host whose own data properties shadow the reactive configs, a renderer that records what the worker would
 * receive, and a `fire` that records what the pane would hear.
 * @param {Function} pick The renderer's pick
 * @returns {{canvas: Object, selections: Array}}
 */
function makeCanvas(pick = async () => nodeA) {
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
        scene        : {snapshotId: 'snap-1'},
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

    test('a pick that answers after the scene changed selects nothing; the same pick on an unchanged scene selects', async () => {
        let answer;

        const {canvas, selections} = makeCanvas(() => new Promise(resolve => { answer = resolve }));

        canvas.onMouseDown(at(20, 20, 1));

        const late = canvas.onClick(at(20, 20));

        canvas.scene = {snapshotId: 'snap-2'};
        answer(nodeA);
        await late;

        expect(selections).toEqual([]);

        canvas.onMouseDown(at(20, 20, 1));

        const current = canvas.onClick(at(20, 20));

        answer(nodeA);
        await current;

        expect(selections).toEqual([nodeA.id])
    });
});
