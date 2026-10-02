import {setup} from '../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'SetupConnectContainerTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer  from '../../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import ConnectContainer    from '../../../../../../../apps/agentos/view/setup/ConnectContainer.mjs';
import PlaneVerdict   from '../../../../../../../apps/agentos/util/PlaneVerdict.mjs';

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
 * The door lives inside the card inside the Viewport, so it is created inside a host here too: a root
 * component would try to mount itself on `document.body` when shown.
 */
function createDoor() {
    const host = Neo.create(BaseContainer, {windowId: 7, items: [{module: ConnectContainer, reference: 'connect-door'}]});

    return {host, door: host.getReference('connect-door')}
}

test.describe('AgentOS.view.setup.ConnectContainer — the setup card\'s connect-to-a-plane door', () => {
    test.afterEach(() => {
        delete Neo.main?.addon?.ShellPlane
    });

    test('a refusal renders its line and re-enables Connect; the request carries only the plane base', async () => {
        const requests     = stubAttachPlane({ok: false, reason: 'rejected', relaunching: false});
        const {host, door} = createDoor();

        await door.onConnectClick();

        expect(requests).toEqual([{planeBase: 'http://127.0.0.1:3102', windowId: 7}]);
        expect(door.getReference('status-line').text).toBe(ConnectContainer.reasonText.rejected);
        expect(door.getReference('connect-button').disabled).toBe(false);
        host.destroy()
    });

    test('without a shell Connect answers instead of throwing', async () => {
        const {host, door} = createDoor();

        await door.onConnectClick();

        expect(door.getReference('status-line').text).toBe('The plane could not be attached.');
        expect(door.getReference('connect-button').disabled).toBe(false);
        host.destroy()
    });

    test('the addon\'s own no-shell refusal names the browser path', async () => {
        stubAttachPlane({ok: false, reason: 'no-shell', relaunching: false});

        const {host, door} = createDoor();

        await door.onConnectClick();

        expect(door.getReference('status-line').text).toBe(ConnectContainer.reasonText['no-shell']);
        host.destroy()
    });

    test('a successful attach keeps Connect disabled while the shell relaunches', async () => {
        stubAttachPlane({ok: true, reason: null, relaunching: true});

        const {host, door} = createDoor();

        await door.onConnectClick();

        expect(door.getReference('status-line').text).toBe('Connected. The shell restarts to attach.');
        expect(door.getReference('connect-button').disabled).toBe(true);
        host.destroy()
    });

    test('a plane\'s own verdicts read the sentences the spine banner shares, word for word as before', () => {
        expect(ConnectContainer.reasonText).toMatchObject({
            'no-identity': 'The plane accepted that PAT but named no identity for it. Nothing was stored.',
            'not-a-plane': 'That address is not a Neo plane. Nothing was stored.',
            rejected     : 'The plane refused that PAT. Nothing was stored.',
            unreachable  : 'No plane answered at that address.'
        });

        for (const [verdict, sentence] of Object.entries(PlaneVerdict.sentences)) {
            expect(ConnectContainer.reasonText[verdict].startsWith(sentence), verdict).toBe(true)
        }
    })
});
