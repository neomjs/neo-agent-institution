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
    })
});
