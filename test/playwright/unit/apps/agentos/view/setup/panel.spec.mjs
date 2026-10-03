import {setup} from '../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'SetupPanelTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer  from '../../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import SetupPanel     from '../../../../../../../apps/agentos/view/setup/Panel.mjs';

/**
 * The card inside a host, the way the Viewport inserts it: the host listens the way the Viewport
 * controller does, by the card's own events.
 */
function createCard(listeners) {
    const host = Neo.create(BaseContainer, {windowId: 7, items: [{module: SetupPanel, activeDoor: 'create', listeners, reference: 'plane-setup'}]});

    return {host, card: host.getReference('plane-setup')}
}

test.describe('AgentOS.view.setup.Panel — two doors in one card, the Create door\'s events relayed to the card\'s owner', () => {
    test.afterEach(() => {
        delete Neo.main?.addon?.ShellPlane
    });

    test('the doors switch on the head\'s buttons, one visible at a time, its button pressed', () => {
        const {host, card} = createCard({});

        expect(card.getReference('create-door').hidden).toBe(false);
        expect(card.getReference('connect-door').hidden).toBe(true);
        expect(card.getReference('create-door-button').pressed).toBe(true);

        card.onConnectDoorClick();

        expect(card.activeDoor).toBe('connect');
        expect(card.getReference('create-door').hidden).toBe(true);
        expect(card.getReference('connect-door').hidden).toBe(false);
        expect(card.getReference('connect-door-button').pressed).toBe(true);
        expect(card.getReference('create-door-button').pressed).toBe(false);

        card.onDismissClick();
        expect(card.hidden).toBe(true);

        host.destroy()
    });

    test('the Create door\'s first persistence and open-memories reach the card\'s owner through the card: a listener on the card hears what the door fired', () => {
        const
            heard        = [],
            {host, card} = createCard({
                firstPersistence: data => heard.push(['firstPersistence', data.density]),
                openMemories    : () => heard.push(['openMemories'])
            });

        card.getReference('create-door').fire('firstPersistence', {density: {decisions: 6, manualActions: 0}, evaluation: {}});
        card.getReference('create-door').fire('openMemories', {});

        expect(heard).toEqual([['firstPersistence', {decisions: 6, manualActions: 0}], ['openMemories']]);

        host.destroy()
    })
});
