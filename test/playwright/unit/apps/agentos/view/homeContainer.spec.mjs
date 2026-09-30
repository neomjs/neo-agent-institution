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
import FleetRoster    from '../../../../../../apps/agentos/store/FleetRoster.mjs';
import StateProvider  from '../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import HomeView       from '../../../../../../apps/agentos/view/home/Container.mjs';

const PRODUCT_LINE = 'Mission control for a cross-model AI engineering team.';

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
 * @returns {Object} What a reader sees: the lead line and whether it is quiet, which parts show, and the plane line.
 */
function read(home) {
    const lead = home.getReference('lead'), plane = home.getReference('plane-line');

    return {
        lead   : lead.text,
        quiet  : lead.cls.includes('is-quiet'),
        lede   : !home.getReference('lede').hidden,
        connect: !home.getReference('connect-plane').hidden,
        doors  : !home.getReference('doors').hidden,
        plane  : plane.hidden ? null : plane.text
    }
}

test.describe('AgentOS.view.home.Container — Home answers its two readers (#244)', () => {
    test('the returning team reads the team line in the display slot, the plane line whenever the chrome\'s verdict is not ok, and the doors', () => {
        const {host, home} = createHome();

        expect(read(home)).toEqual({lead: 'No word from the team yet', quiet: true, lede: false, connect: false, doors: true, plane: 'Plane not connected'});

        home.instanceState = 'ok';
        expect(read(home).plane, 'a connected plane is quiet').toBe(null);

        home.instanceState = 'limited';
        expect(read(home).plane).toBe('Plane degraded');

        home.instanceState = 'starting';
        expect(read(home).plane).toBe('Plane switching');

        home.instanceState = 'toString';
        expect(read(home).plane, 'an unknown key reads as not connected').toBe('Plane not connected');

        host.destroy()
    });

    test('a packaged shell without a plane gets the product line, the lede and Connect a plane, and nothing that reads as fleet state', () => {
        const {host, home} = createHome();

        home.set({gridAdapterState: 'live', instanceState: 'limited', shellPlaneConfigured: false});
        expect(read(home)).toEqual({lead: PRODUCT_LINE, quiet: false, lede: true, connect: true, doors: false, plane: null});

        home.shellPlaneConfigured = true;
        expect(read(home), 'a shell with a plane is a returning reader').toMatchObject({lead: 'No agents yet', lede: false, connect: false, doors: true, plane: 'Plane degraded'});

        host.destroy()
    });

    test('the team line counts who is up once the read answers live, and names the read\'s state before that — never "0 up"; the field\'s team exists only once it answers', () => {
        const line = (adapterState, states = [], degradedReason = null) => HomeView.teamLine({adapterState, degradedReason, states});

        expect(line('cold', ['ok'])).toEqual({answered: false, team: null, text: 'No word from the team yet'});
        expect(line('stale', ['ok'])).toEqual({answered: false, team: null, text: 'Lost touch with the team'});
        expect(line('live', ['ok'], 'fleet: Brain is not ready')).toEqual({answered: false, team: null, text: 'Lost touch with the team'});
        expect(line('live')).toEqual({answered: true, team: {total: 0, up: 0}, text: 'No agents yet'});
        expect(line('live', ['ok'])).toEqual({answered: true, team: {total: 1, up: 1}, text: '1 of 1 agent up'});
        expect(line('live', ['ok', 'idle', 'wedged', 'limited', 'starting', 'stopping', 'off']), 'the online and idle tiers are up').toEqual({answered: true, team: {total: 7, up: 4}, text: '4 of 7 agents up'})
    });

    test('each door routes to its keeper view under the question it answers; Connect a plane asks the Viewport controller', () => {
        const
            {host, home} = createHome(),
            doors        = home.getReference('doors').items.map(({route, text}) => ({route, text}));

        expect(doors).toEqual([
            {route: '/fleet',       text: 'What is the team doing?'},
            {route: '/observatory', text: 'What does the organism know?'},
            {route: '/system',      text: 'Is the plane healing itself?'}
        ]);
        expect(home.getReference('connect-plane').handler).toBe('onAttachPlane');

        host.destroy()
    });

    test('Home binds the Viewport provider\'s truths and follows its roster store', () => {
        const
            {host, home} = createHome({
                stateProvider: {
                    module: StateProvider,
                    data  : {gridAdapterState: 'live', gridDegradedReason: null, instanceState: 'limited', shellPlaneConfigured: null},
                    stores: {fleetRoster: {module: FleetRoster}}
                }
            }),
            provider = host.getStateProvider(),
            store    = provider.getStore('fleetRoster');

        expect(read(home)).toMatchObject({lead: 'No agents yet', quiet: false, plane: 'Plane degraded'});

        store.add([{agentId: 'a', state: 'ok'}, {agentId: 'b', state: 'off'}, {agentId: 'c', state: 'idle'}]);
        expect(read(home).lead, 'a load recounts').toBe('2 of 3 agents up');

        store.get('b').state = 'ok';
        expect(read(home).lead, 'a row\'s state change recounts').toBe('3 of 3 agents up');

        provider.setData({gridAdapterState: 'stale'});
        expect(read(home)).toMatchObject({lead: 'Lost touch with the team', quiet: true});

        provider.setData({shellPlaneConfigured: false});
        expect(read(home)).toMatchObject({lead: PRODUCT_LINE, connect: true, doors: false, plane: null});

        host.destroy()
    });

    test('the field\'s team is the team line\'s read: no marks before it answers live, and after it one per rostered agent, following the roster (AC-2)', () => {
        const
            {host, home} = createHome({
                stateProvider: {
                    module: StateProvider,
                    data  : {gridAdapterState: 'cold', gridDegradedReason: null, instanceState: 'ok', shellPlaneConfigured: null},
                    stores: {fleetRoster: {module: FleetRoster}}
                }
            }),
            provider = host.getStateProvider(),
            store    = provider.getStore('fleetRoster');

        store.add([{agentId: 'a', state: 'ok'}, {agentId: 'b', state: 'off'}, {agentId: 'c', state: 'idle'}]);
        expect(home.team, 'rows the read has not answered for draw no marks').toBe(null);

        provider.setData({gridAdapterState: 'live'});
        expect(home.team).toEqual({total: 3, up: 2});

        store.add({agentId: 'd', state: 'ok'});
        expect(home.team.total, 'the marks follow the roster\'s length').toBe(store.getCount());

        provider.setData({gridDegradedReason: 'fleet: Brain is not ready'});
        expect(home.team, 'a degraded read draws no marks').toBe(null);

        provider.setData({gridDegradedReason: null, shellPlaneConfigured: false});
        expect(home.team, 'a packaged shell without a plane draws no marks').toBe(null);

        expect(home.getReference('canvas'), 'no canvas worker in the unit tier: no field is mounted').toBeFalsy();

        host.destroy()
    })
});
