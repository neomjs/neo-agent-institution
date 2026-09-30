import {setup} from '../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'HomeContainerTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer  from '../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import StateProvider  from '../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import HomeView       from '../../../../../../apps/agentos/view/home/Container.mjs';

/**
 * Home lives inside the Viewport, so it is created inside a host here too: a root component would try
 * to mount itself on `document.body`.
 * @param {Object} [hostConfig]
 * @returns {{host: Neo.container.Base, home: AgentOS.view.home.Container}}
 */
function createHome(hostConfig = {}) {
    const host = Neo.create(BaseContainer, {...hostConfig, items: [{module: HomeView, reference: 'home'}]});

    return {host, home: host.getReference('home')}
}

/**
 * @param {AgentOS.view.home.Container} home
 * @returns {Object} What a reader sees: which parts show, and the plane line's words.
 */
function read(home) {
    return {
        connect: !home.getReference('connect-plane').hidden,
        doors  : !home.getReference('doors').hidden,
        plane  : home.getReference('plane-line').hidden ? null : home.getReference('plane-word').text
    }
}

test.describe('AgentOS.view.home.Container — Home answers its two readers (#244)', () => {
    test('the returning team gets the doors, and the plane line whenever the chrome\'s verdict is not ok', () => {
        const {host, home} = createHome();

        expect(read(home)).toEqual({connect: false, doors: true, plane: 'Plane not connected'});

        home.instanceState = 'ok';
        expect(read(home).plane, 'a connected plane is quiet').toBe(null);

        home.instanceState = 'limited';
        expect(read(home)).toEqual({connect: false, doors: true, plane: 'Plane degraded'});

        home.instanceState = 'starting';
        expect(read(home).plane).toBe('Plane switching');

        home.instanceState = 'toString';
        expect(read(home).plane, 'an unknown key reads as not connected').toBe('Plane not connected');

        host.destroy()
    });

    test('a packaged shell without a plane gets Connect a plane and nothing that reads as fleet state', () => {
        const {host, home} = createHome();

        home.set({instanceState: 'limited', shellPlaneConfigured: false});
        expect(read(home)).toMatchObject({connect: true, doors: false, plane: null});

        home.shellPlaneConfigured = true;
        expect(read(home), 'a shell with a plane is a returning reader').toMatchObject({connect: false, doors: true, plane: 'Plane degraded'});

        host.destroy()
    });

    test('each door routes to its keeper view under the question it answers; the plane line opens System; Connect a plane asks the Viewport controller', () => {
        const
            {host, home} = createHome(),
            doors        = home.getReference('doors').items.map(({route, text}) => ({route, text})),
            planeDoor    = home.getReference('plane-line').items[1];

        expect(doors).toEqual([
            {route: '/fleet',       text: 'What is the team doing?'},
            {route: '/observatory', text: 'What does the organism know?'},
            {route: '/system',      text: 'Is the plane healing itself?'}
        ]);
        expect({route: planeDoor.route, text: planeDoor.text}).toEqual({route: '/system', text: 'Open System'});
        expect(home.getReference('connect-plane').handler).toBe('onAttachPlane');

        host.destroy()
    });

    test('Home binds the Viewport provider\'s truths', () => {
        const {host, home} = createHome({
            stateProvider: {module: StateProvider, data: {instanceState: 'limited', shellPlaneConfigured: null}}
        });

        expect(read(home).plane).toBe('Plane degraded');

        host.getStateProvider().setData({shellPlaneConfigured: false});
        expect(read(home)).toMatchObject({connect: true, doors: false, plane: null});

        host.destroy()
    })
});
