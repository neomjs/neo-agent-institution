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
 * Installs a stand-in for the `WS/ShellPlane` main addon's attach remote, recording every request.
 */
function stubAttachPlane(reply) {
    const requests = [];

    Neo.ns('Neo.main.addon', true).ShellPlane = {
        attachPlane: async request => { requests.push(request); return reply }
    };

    return requests
}

/**
 * The card lives inside the Viewport, so it is created inside a host here too: a root component would
 * try to mount itself on `document.body` when shown.
 */
function createPanel() {
    const host = Neo.create(BaseContainer, {windowId: 7, items: [{module: PlaneSetupPanel, reference: 'plane-setup'}]});

    return {host, panel: host.getReference('plane-setup')}
}

test.describe('AgentOS.view.PlaneSetupPanel — the packaged shell\'s connect-to-a-plane card', () => {
    test.afterEach(() => {
        delete Neo.main?.addon?.ShellPlane
    });

    test('a refusal renders its line and re-enables Connect; the request carries only the plane base', async () => {
        const requests      = stubAttachPlane({ok: false, reason: 'rejected', relaunching: false});
        const {host, panel} = createPanel();

        await panel.onConnectClick();

        expect(requests).toEqual([{planeBase: 'http://127.0.0.1:3102', windowId: 7}]);
        expect(panel.getReference('status-line').text).toBe(PlaneSetupPanel.reasonText.rejected);
        expect(panel.getReference('connect-button').disabled).toBe(false);
        host.destroy()
    });

    test('without a shell Connect answers instead of throwing', async () => {
        const {host, panel} = createPanel();

        await panel.onConnectClick();

        expect(panel.getReference('status-line').text).toBe('The plane could not be attached.');
        expect(panel.getReference('connect-button').disabled).toBe(false);
        host.destroy()
    });

    test('a successful attach keeps Connect disabled while the shell relaunches', async () => {
        stubAttachPlane({ok: true, reason: null, relaunching: true});

        const {host, panel} = createPanel();

        await panel.onConnectClick();

        expect(panel.getReference('status-line').text).toBe('Connected. The shell restarts to attach.');
        expect(panel.getReference('connect-button').disabled).toBe(true);
        host.destroy()
    });

    test('dismissing hides the card for the session', () => {
        const {host, panel} = createPanel();

        expect(panel.hidden).toBe(false);
        panel.onDismissClick();
        expect(panel.hidden).toBe(true);
        host.destroy()
    })
});
