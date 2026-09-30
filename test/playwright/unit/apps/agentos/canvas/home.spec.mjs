import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'HomeRendererTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Home           from '../../../../../../apps/agentos/canvas/Home.mjs';

/**
 * @summary Home's field renderer without a canvas: the rest layout seeded by size, the team's marks drawn from
 * `{total, up}` alone, and a still field that draws once per input while a moving one schedules its next frame.
 */

/**
 * @summary A 2D context stand-in: a sized canvas, a gradient that takes its stops, and every other drawing call
 * answered and counted by name.
 * @returns {Object}
 */
const createContext = () => {
    const calls = {};

    return new Proxy({calls, canvas: {height: 0, width: 0}, createRadialGradient: () => ({addColorStop() {}})}, {
        get: (target, key) => key in target ? target[key] : () => {calls[key] = (calls[key] ?? 0) + 1},
        set: (target, key, value) => {target[key] = value; return true}
    })
};

/**
 * @summary Hands the renderer a fresh context at a size, the way the canvas worker's first resize does.
 * @param {Object} [size]
 * @returns {Object} The context
 */
const mount = (size = {width: 900, height: 600, devicePixelRatio: 2}) => {
    const context = createContext();

    Home.clearGraph();
    Home.context = context;
    Home.updateSize(size);

    return context
};

test.describe('AgentOS.canvas.Home — the field claims nothing until the team answers (#244)', () => {
    test.afterEach(() => {
        clearTimeout(Home.animationId);
        Home.clearGraph()
    });

    test('the field seeds by area, sizes its backing store at the pixel ratio, and lays out the same rest field every time', () => {
        const context = mount();

        expect(Home.moteCount, '540000 px² at one mote per 6000').toBe(90);
        expect([context.canvas.width, context.canvas.height]).toEqual([1800, 1200]);
        expect(Home.ring, 'a wide surface keeps the ring right of the hero').toMatchObject({cx: 648, cy: 300, rx: 180});
        expect(Home.ring.ry).toBeCloseTo(168);

        const rest = Home.motes.slice(0, Home.moteCount * 6);

        Home.seed(900, 600);
        expect(Home.motes.slice(0, Home.moteCount * 6)).toEqual(rest);

        Home.seed(4000, 3000);
        expect(Home.moteCount, 'a large surface stops at the cap').toBe(200);

        Home.seed(300, 200);
        expect(Home.moteCount, 'a small one keeps the floor').toBe(60);
        expect(Home.ring.cy, 'a narrow surface drops the ring below the hero').toBeCloseTo(148)
    });

    test('no team draws no marks; a team draws one per rostered agent, `up` of them lit and spread around the ring (AC-2)', () => {
        mount();

        expect(Home.getStats().marks, 'the ambient field claims no team').toBe(null);

        Home.setTeam({team: {total: 5, up: 2}});
        expect(Home.getStats().marks).toEqual({total: 5, up: 2});
        expect(Array.from({length: 5}, (_, i) => Home.constructor.isLit(i, 5, 2))).toEqual([false, false, true, false, true]);
        expect(Home.markXY.length, 'one position per mark').toBe(10);

        Home.setTeam({team: {total: 3, up: 7}});
        expect(Home.getStats().marks, 'more up than rostered is the roster').toEqual({total: 3, up: 3});

        Home.setTeam({team: {total: 0, up: 0}});
        expect(Home.getStats().marks, 'a team of none draws no marks').toBe(null);

        Home.setTeam({team: null});
        expect(Home.getStats().marks).toBe(null);
        expect(Home.markAngles).toBe(null)
    });

    test('a still field draws once per input and schedules nothing, takes no ripple, and returns to rest; a moving one schedules its next frame (AC-1)', () => {
        mount();

        const frames = Home.frames;

        expect(Home.getStats()).toMatchObject({still: true, motes: 90, size: {width: 900, height: 600}});
        expect(Home.animationId, 'a still field schedules nothing').toBe(null);

        Home.setTeam({team: {total: 2, up: 1}});
        expect(Home.frames, 'an input draws one frame').toBe(frames + 1);

        Home.onMouseClick({x: 10, y: 10});
        expect(Array.from(Home.ripples).filter((value, index) => index % 3 === 2 && value >= 0), 'no ripple').toEqual([]);

        Home.setMotion({still: false});
        expect(Home.animationId, 'a moving field schedules its next frame').not.toBe(null);

        Home.onMouseClick({x: 10, y: 10});
        expect(Home.ripples[2], 'a ripple starts where the click landed').toBe(0);

        Home.step(0.5);
        expect(Home.time).toBeCloseTo(0.5);

        clearTimeout(Home.animationId);
        Home.animationId = null;
        Home.seed(900, 600);

        const rest = Home.motes.slice(0, Home.moteCount * 6);

        Home.step(0.5);
        Home.setMotion({still: true});
        expect(Home.motes.slice(0, Home.moteCount * 6), 'a field that turns still returns to rest').toEqual(rest);
        expect(Home.animationId).toBe(null);

        Home.setMotion({still: false});
        clearTimeout(Home.animationId);
        Home.animationId = null;
        Home.setMotion({});
        expect(Home.still, 'anything but an explicit false is still').toBe(true)
    })
});
