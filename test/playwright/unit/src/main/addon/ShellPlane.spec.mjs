import {setup} from '../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'ShellPlaneAddonTest'}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import ShellPlane     from '../../../../../../src/main/addon/ShellPlane.mjs';

/**
 * The addon's two remotes forward to the shell's preload. Neither reads instance state, so they are
 * exercised straight off the prototype, with and without a `neoShell` on the global.
 */
test.describe('Neo.main.addon.ShellPlane — the cockpit\'s reach into the shell\'s plane broker', () => {
    const {attachPlane, planeStatus} = ShellPlane.prototype;

    test.afterEach(() => {
        delete globalThis.neoShell
    });

    test('without a shell both calls answer "not available" instead of failing', async () => {
        expect(await planeStatus()).toEqual({available: false});
        expect(await attachPlane({planeBase: 'http://127.0.0.1:3102'})).toEqual({ok: false, reason: 'no-shell', relaunching: false})
    });

    test('with a shell, status is forwarded and attach passes only the plane base', async () => {
        const requests = [];

        globalThis.neoShell = {
            attachPlane: async request => { requests.push(request); return {ok: true, reason: null, relaunching: true} },
            planeStatus: async () => ({attached: false, configured: false, packaged: true, planeBase: null})
        };

        expect(await planeStatus()).toEqual({attached: false, available: true, configured: false, packaged: true, planeBase: null});
        expect(await attachPlane({planeBase: 'http://127.0.0.1:3102', windowId: 7})).toEqual({ok: true, reason: null, relaunching: true});
        expect(requests, 'the window id stays in the App worker\'s envelope').toEqual([{planeBase: 'http://127.0.0.1:3102'}])
    });

    test('the six setup remotes forward their named request shapes, and answer the one no-shell refusal in a browser', async () => {
        const {setupAnswer, setupCredential, setupEffect, setupEvaluate, setupPresets, setupProbe} = ShellPlane.prototype;

        for (const call of [setupAnswer({stepId: 'preset', answer: 'hosted'}), setupCredential({stepId: 'plane-credential'}), setupEffect({effectId: 'write-env'}), setupEvaluate(), setupPresets(), setupProbe()]) {
            expect(await call).toEqual({ok: false, reason: 'no-shell'})
        }

        const calls = [];

        globalThis.neoShell = Object.fromEntries(['setupAnswer', 'setupCredential', 'setupEffect', 'setupEvaluate', 'setupPresets', 'setupProbe'].map(name => [name, async request => { calls.push([name, request]); return {ok: true, name} }]));

        expect(await setupAnswer({stepId: 'preset', answer: 'hosted', windowId: 7})).toEqual({ok: true, name: 'setupAnswer'});
        await setupCredential({stepId: 'plane-credential', windowId: 7});
        await setupEffect({effectId: 'write-env', windowId: 7});
        await setupEffect({effectId: 'verify', newAttempt: true, windowId: 7});
        await setupEffect({effectId: 'verify', newAttempt: 'yes', windowId: 7});
        await setupEvaluate({target: {planeId: 'p'}, windowId: 7});
        await setupEvaluate({windowId: 7});
        await setupPresets({windowId: 7});
        await setupProbe({windowId: 7});

        expect(calls, 'only the named fields cross; the window id stays in the App worker\'s envelope; a new attempt crosses only as true').toEqual([
            ['setupAnswer',     {answer: 'hosted', stepId: 'preset'}],
            ['setupCredential', {stepId: 'plane-credential'}],
            ['setupEffect',     {effectId: 'write-env'}],
            ['setupEffect',     {effectId: 'verify', newAttempt: true}],
            ['setupEffect',     {effectId: 'verify'}],
            ['setupEvaluate',   {target: {planeId: 'p'}}],
            ['setupEvaluate',   {target: null}],
            ['setupPresets',    {}],
            ['setupProbe',      {}]
        ])
    });

    test('seat placement forwards plain answers and only the reviewed fingerprint', async () => {
        const {seatRootStatus, seatRootPlan, seatRootConsent} = ShellPlane.prototype;
        for (const result of [seatRootStatus(), seatRootPlan(), seatRootConsent({fingerprint: 'reviewed'})]) {
            expect(await result).toEqual({state: 'refused', code: 'no-shell', reason: 'no-shell'})
        }

        const calls = [], held = {root: null, pending: null, outcome: {state: 'held', reason: 'unreadable record'}};
        globalThis.neoShell = {
            seatRootStatus : async () => held,
            seatRootPlan   : async () => ({state: 'refused', reason: 'occupied destination', rows: []}),
            seatRootConsent: async request => { calls.push(request); return {state: 'consented'} }
        };
        expect(await seatRootStatus()).toEqual(held);
        expect((await seatRootPlan()).state).toBe('refused');
        expect(await seatRootConsent({fingerprint: 'reviewed', from: '/injected', to: '/elsewhere', windowId: 7})).toEqual({state: 'consented'});
        expect(calls).toEqual([{fingerprint: 'reviewed'}]);
        globalThis.neoShell.seatRootPlan = async () => { throw new Error('transport lost') };
        await expect(seatRootPlan()).rejects.toThrow('transport lost')
    })
});
