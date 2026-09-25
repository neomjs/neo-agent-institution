import {setup} from '../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'PlaneSetupPanelTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect}  from '@playwright/test';
import Neo             from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core       from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                      '../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer   from '../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import PlaneSetupPanel from '../../../../../../apps/agentos/view/PlaneSetupPanel.mjs';

/**
 * Installs a stand-in for the `WS/ShellPlane` main addon's remotes, recording every attach request.
 * `status` is what `planeStatus()` answers; `reply` is what `attachPlane()` answers.
 */
function stubShellPlane({status, reply = {ok: false, reason: 'rejected', relaunching: false}}) {
    const requests = [];

    Neo.ns('Neo.main.addon', true).ShellPlane = {
        attachPlane: async request => { requests.push(request); return reply },
        planeStatus: async () => status
    };

    return requests
}

/**
 * The card lives inside the Viewport, so it is created inside a host here too: a root component would
 * try to mount itself on `document.body` when shown.
 */
async function createPanel() {
    const
        host  = Neo.create(BaseContainer, {windowId: 7, items: [{module: PlaneSetupPanel, reference: 'plane-setup'}]}),
        panel = host.getReference('plane-setup');

    await panel.readPlaneStatus();

    return {host, panel}
}

const UNCONFIGURED = {available: true, packaged: true, configured: false};

test.describe('AgentOS.view.PlaneSetupPanel — the packaged shell\'s connect-to-a-plane card', () => {
    test.afterEach(() => {
        delete Neo.main?.addon?.ShellPlane
    });

    test('shows only for a packaged shell with no plane configured', async () => {
        const cases = [
            [{available: false},                                    true],
            [{available: true, packaged: false, configured: false}, true],
            [{available: true, packaged: true,  configured: true},  true],
            [UNCONFIGURED,                                          false]
        ];

        for (const [status, hidden] of cases) {
            stubShellPlane({status});

            const {host, panel} = await createPanel();

            expect(panel.hidden, JSON.stringify(status)).toBe(hidden);
            host.destroy()
        }
    });

    test('without a shell nothing shows and nothing throws', async () => {
        const {host, panel} = await createPanel();

        expect(panel.hidden).toBe(true);
        host.destroy()
    });

    test('a refusal renders its line and re-enables Connect; the request carries only the plane base', async () => {
        const requests      = stubShellPlane({status: UNCONFIGURED});
        const {host, panel} = await createPanel();

        await panel.onConnectClick();

        expect(requests).toEqual([{planeBase: 'http://127.0.0.1:3102', windowId: 7}]);
        expect(panel.getReference('status-line').text).toBe(PlaneSetupPanel.reasonText.rejected);
        expect(panel.getReference('connect-button').disabled).toBe(false);
        host.destroy()
    });

    test('a successful attach keeps Connect disabled while the shell relaunches', async () => {
        stubShellPlane({status: UNCONFIGURED, reply: {ok: true, reason: null, relaunching: true}});

        const {host, panel} = await createPanel();

        await panel.onConnectClick();

        expect(panel.getReference('status-line').text).toBe('Connected. The shell restarts to attach.');
        expect(panel.getReference('connect-button').disabled).toBe(true);
        host.destroy()
    });

    test('dismissing hides the card for the session', async () => {
        stubShellPlane({status: UNCONFIGURED});

        const {host, panel} = await createPanel();

        expect(panel.hidden).toBe(false);
        panel.onDismissClick();
        expect(panel.hidden).toBe(true);
        host.destroy()
    })
});
