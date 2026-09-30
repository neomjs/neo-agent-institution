/**
 * @file test/playwright/unit/apps/agentos/view/homeCanvas.spec.mjs
 * @summary Pins who may set Home's motion: each mount of `AgentOS.view.home.Canvas` starts still, and only the
 * latest motion read of the current mount answers. The host's style read is held open here, so a test decides
 * when, and in which order, the answers arrive.
 */

import {setup} from '../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'HomeCanvasMotionTest'}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import HomeCanvas     from '../../../../../../apps/agentos/view/home/Canvas.mjs';

/**
 * The host without its worker and DOM seams: no renderer module to load, no canvas to transfer, no size to observe.
 * @class Test.Unit.AgentOS.HomeCanvas.MotionHost
 * @extends AgentOS.view.home.Canvas
 */
class MotionHost extends HomeCanvas {
    static config = {
        className         : 'Test.Unit.AgentOS.HomeCanvas.MotionHost',
        monitorSize       : false,
        offscreen         : false,
        rendererClassName : 'Test.Unit.AgentOS.HomeCanvas.Renderer',
        rendererImportPath: null
    }
}

Neo.setupClass(MotionHost);

const
    renderer = {
        motion: [],
        quiet : [],
        clearGraph() {},
        setMotion({still}) {this.motion.push(still)},
        setQuiet({rects}) {this.quiet.push(rects)},
        setTeam() {},
        setTheme() {}
    },
    // one pending style read per entry, answered by the test
    reads = [];

let domAccess, originalGetComputedStyle;

/**
 * @param {Number} index
 * @param {String} value `--motion-base` as the host's window would answer it
 */
function answer(index, value) {
    reads[index]({'--motion-base': value})
}

/**
 * Lets the answered reads settle.
 */
function flush() {
    return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Mounts the host and waits until its motion read is pending.
 * @param {MotionHost} host
 */
async function mount(host) {
    const count = reads.length;

    host.mounted = true;
    await expect.poll(() => reads.length).toBe(count + 1)
}

test.describe('AgentOS.view.home.Canvas — each mount starts still, and only its latest read answers (#244)', () => {
    let host;

    test.beforeEach(() => {
        Neo.ns('Test.Unit.AgentOS.HomeCanvas', true).Renderer = renderer;
        renderer.motion.length = 0;
        reads.length = 0;

        domAccess                = Neo.ns('Neo.main.DomAccess', true);
        originalGetComputedStyle = domAccess.getComputedStyle;
        domAccess.getComputedStyle = () => new Promise(resolve => reads.push(resolve));

        host = Neo.create(MotionHost)
    });

    test.afterEach(() => {
        host.destroy();
        domAccess.getComputedStyle = originalGetComputedStyle
    });

    test('a remount publishes still at readiness while its read is pending, not the last mount\'s permission', async () => {
        await mount(host);
        answer(0, '240ms');
        await flush();
        expect(host.still, 'the first mount allows motion').toBe(false);

        host.mounted = false;
        await flush();
        expect(host.still, 'an unmount returns the field to still').toBe(true);

        await mount(host);
        host.isCanvasReady = true;
        expect(renderer.motion, 'readiness publishes still').toEqual([true]);

        answer(1, '0ms');
        await flush();
        expect(host.still).toBe(true);
        expect(renderer.motion, 'reduced motion never moves the field').toEqual([true])
    });

    test('a late answer from an earlier mount cannot resume the current reduced-motion field', async () => {
        await mount(host);
        host.mounted = false;
        await flush();

        await mount(host);
        host.isCanvasReady = true;
        answer(1, '0ms');
        await flush();

        renderer.motion.length = 0;
        answer(0, '240ms');
        await flush();

        expect(host.still).toBe(true);
        expect(renderer.motion, 'the earlier mount\'s answer reaches no renderer').toEqual([])
    });

    test('the current mount\'s own answer still sets motion', async () => {
        await mount(host);
        host.isCanvasReady = true;
        renderer.motion.length = 0;

        answer(0, '240ms');
        await flush();

        expect(host.still).toBe(false);
        expect(renderer.motion).toEqual([false])
    })
});

test.describe('AgentOS.view.home.Canvas — the field goes quiet under the lines the Home view names (#365)', () => {
    let host;

    test.beforeEach(() => {
        Neo.ns('Test.Unit.AgentOS.HomeCanvas', true).Renderer = renderer;
        renderer.quiet.length = 0;

        host            = Neo.create(MotionHost, {quietIds: ['line-a', 'line-b']});
        host.canvasRect = {x: 100, y: 50}
    });

    test.afterEach(() => {
        host.destroy()
    });

    test('the lines reach the renderer relative to the canvas, and only the latest measurement answers', async () => {
        const answers = [];

        host.getDomRect    = () => new Promise(resolve => answers.push(resolve));
        host.isCanvasReady = true;

        const first = host.measureQuiet(), second = host.measureQuiet();

        await expect.poll(() => answers.length, 'the outdated call never measures').toBe(1);
        answers[0]([{x: 140, y: 130, width: 300, height: 40}, {x: 140, y: 190, width: 0, height: 0}]);
        await Promise.all([first, second]);

        expect(renderer.quiet).toEqual([[{height: 40, width: 300, x: 40, y: 80}, {height: 0, width: 0, x: 40, y: 140}]]);

        const third = host.measureQuiet();
        await expect.poll(() => answers.length).toBe(2);

        const fourth = host.measureQuiet();
        await expect.poll(() => answers.length).toBe(3);

        answers[2]([{x: 100, y: 50, width: 10, height: 10}]);
        answers[1]([{x: 900, y: 900, width: 10, height: 10}]);
        await Promise.all([third, fourth]);

        expect(renderer.quiet, 'an answer that lands after a newer one is dropped').toHaveLength(2);
        expect(renderer.quiet.at(-1)).toEqual([{height: 10, width: 10, x: 0, y: 0}])
    })
});
