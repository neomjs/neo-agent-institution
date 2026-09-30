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

        expect(Home.moteCount, '90 on screen at one mote per 6000 px², across the 1140 × 840 wrap domain').toBe(160);
        expect(Home.getStats().visible, 'about the 90 the surface shows').toBeGreaterThanOrEqual(81);
        expect(Home.getStats().visible).toBeLessThanOrEqual(99);
        expect([context.canvas.width, context.canvas.height]).toEqual([1800, 1200]);
        expect(Home.ring, 'a wide surface keeps the ring right of the hero').toMatchObject({cx: 648, cy: 300, rx: 180});
        expect(Home.ring.ry).toBeCloseTo(168);

        const rest = Home.motes.slice(0, Home.moteCount * 6);

        Home.seed(900, 600);
        expect(Home.motes.slice(0, Home.moteCount * 6)).toEqual(rest);

        Home.seed(4000, 3000);
        expect(Home.moteCount, 'a large surface stops at the cap of 200 on screen').toBe(229);

        Home.seed(300, 200);
        expect(Home.moteCount, 'a small one keeps the floor of 60 on screen').toBe(238);
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

        expect(Home.getStats()).toMatchObject({still: true, motes: 160, size: {width: 900, height: 600}});
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

test.describe('AgentOS.canvas.Home — the field heals after a click and holds its density (#366)', () => {
    const size = {width: 1392, height: 850, devicePixelRatio: 1}, point = {x: 700, y: 400};

    /**
     * @summary Seeds a moving field without starting its loop, lets `poke` touch it, then steps it frame by frame.
     * @param {Function|null} poke
     * @param {Number} seconds
     */
    const run = (poke, seconds) => {
        mount(size);
        Home.updateMouseState({leave: true});
        Home.still = false;
        poke?.();

        for (let frame = 0; frame < seconds * 60; frame++) {
            Home.step(1 / 60)
        }

        Home.placeMotes()
    };

    /**
     * @returns {Number} The motes drawn within 250 px of the point
     */
    const near = () => {
        let count = 0;

        for (let i = 0; i < Home.moteCount; i++) {
            Math.hypot(Home.drawn[i * 2] - point.x, Home.drawn[i * 2 + 1] - point.y) < 250 && count++
        }

        return count
    };

    test.afterEach(() => {
        clearTimeout(Home.animationId);
        Home.clearGraph()
    });

    test('a click and the pointer move where motes are drawn, never where they are, so neither leaves a hole (AC-1)', () => {
        const state = () => Array.from(Home.motes.slice(0, Home.moteCount * 6));

        run(null, 10);
        const control = near(), untouched = state();

        run(() => Home.onMouseClick(point), 10);
        expect(state(), 'a ripple moves no mote').toEqual(untouched);
        expect(near(), `10 s after a click, against ${control} unclicked`).toBeGreaterThanOrEqual(control * 0.85);

        run(null, 3);
        const untouchedLater = state();

        run(() => Home.updateMouseState(point), 2);
        Home.updateMouseState({leave: true});

        for (let frame = 0; frame < 60; frame++) {
            Home.step(1 / 60)
        }

        expect(state(), 'the pointer moves no mote').toEqual(untouchedLater);
        expect(Home.parting[0], 'a second after it left, almost none of the parting is drawn').toBeLessThan(0.06)
    });

    test('untouched, the motes on screen hold the design density: within 10 % at the seeded frame and at 180 s, and within 15 % at every second between (AC-2)', () => {
        const design = size.width * size.height / Home.field.density, deviation = () => Math.abs(Home.getStats().visible - design) / design;

        run(null, 0);
        expect(deviation(), 'the seeded frame').toBeLessThanOrEqual(0.1);

        let worst = 0;

        for (let second = 1; second <= 180; second++) {
            for (let frame = 0; frame < 60; frame++) {
                Home.step(1 / 60)
            }

            Home.placeMotes();
            worst = Math.max(worst, deviation())
        }

        expect(worst, 'every second of 180 s').toBeLessThanOrEqual(0.15);
        expect(deviation(), 'after 180 s').toBeLessThanOrEqual(0.1);
        test.info().annotations.push({type: 'worst deviation', description: `${(worst * 100).toFixed(1)} % over 180 s`});

        const start = performance.now();

        for (let frame = 0; frame < 60; frame++) {
            Home.draw()
        }

        test.info().annotations.push({type: 'frame time', description: `${((performance.now() - start) / 60).toFixed(3)} ms for ${Home.moteCount} motes`})
    });

    test('a resize to no area holds no motes, and a sliver stays within the cap', () => {
        mount(size);

        expect(() => Home.updateSize({width: 0, height: 850, devicePixelRatio: 1}), 'zero width').not.toThrow();
        expect(Home.moteCount).toBe(0);

        expect(() => Home.updateSize({width: 1392, height: 0, devicePixelRatio: 1}), 'zero height').not.toThrow();
        expect(Home.moteCount).toBe(0);

        Home.updateSize({width: 300, height: 1, devicePixelRatio: 1});
        expect(Home.moteCount, 'the cap bounds the pairwise work').toBeLessThanOrEqual(Home.field.moteCap);
        expect(() => Home.draw()).not.toThrow()
    })
});
