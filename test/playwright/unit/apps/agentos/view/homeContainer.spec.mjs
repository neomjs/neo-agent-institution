import {setup} from '../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'HomeContainerTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer      from '../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import FleetAwaitingMerge from '../../../../../../apps/agentos/store/FleetAwaitingMerge.mjs';
import FleetRoster        from '../../../../../../apps/agentos/store/FleetRoster.mjs';
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
                    stores: {fleetAwaitingMerge: {module: FleetAwaitingMerge}, fleetRoster: {module: FleetRoster}}
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
                    stores: {fleetAwaitingMerge: {module: FleetAwaitingMerge}, fleetRoster: {module: FleetRoster}}
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

test.describe('AgentOS.view.home.Container — the operator\'s own count (#551)', () => {
    const
        ok          = {state: 'ok', coverage: 'complete', observedAt: '2026-10-04T18:00:00.000Z', reason: null},
        unreadable  = reason => ({state: 'unavailable', reason}),
        known       = count => ({state: 'known', count}),
        rows        = (count, extra = {}) => Array.from({length: count}, () => ({observedAt: ok.observedAt, stale: false, ...extra})),
        line        = (openWork, merges, questions) => HomeView.operatorLine({openWork, mergeRows: rows(merges), questions}),
        readLine    = home => {
            const operator = home.getReference('operator-line');

            return operator.hidden ? null : operator.text
        },
        pr          = number => ({id: `neomjs/neo#${number}`, repo: 'neomjs/neo', number, ci: 'success', mergeable: true, draft: false, observedAt: ok.observedAt, stale: false});

    test('both axes complete: the counts that wait, and "nothing waits for you" only when both observed zero', () => {
        expect(line(ok, 0, known(0)).text).toBe('nothing waits for you');
        expect(line(ok, 5, known(3)).text).toBe('3 questions · 5 merges wait for you');
        expect(line(ok, 1, known(0)).text).toBe('1 merge waits for you');
        expect(line(ok, 0, known(1)).text).toBe('1 question waits for you');
        expect(line(ok, 1, known(1)).text).toBe('1 question · 1 merge wait for you');
    });

    test('an axis that cannot be read leads with its reason, and the other keeps its number — never a 0 and never "nothing"', () => {
        expect(line(ok, 5, unreadable('this plane cannot list them yet')).text)
            .toBe('your questions could not be read · this plane cannot list them yet · 5 merges wait for you');
        expect(line(ok, 0, unreadable('this plane cannot list them yet')).text, 'a known zero beside an unread axis is not "nothing"')
            .toBe('your questions could not be read · this plane cannot list them yet');
        expect(line({state: 'unavailable', coverage: 'unavailable', reason: 'open-work verb missing'}, 0, known(2)).text)
            .toBe('your merges could not be read · open-work verb missing · 2 questions wait for you');
    });

    test('a stale merge queue reads its count as of its oldest row; looking never moves the count', () => {
        const
            now   = Date.parse(ok.observedAt) + 12 * 60 * 1000,
            stale = {...ok, state: 'stale'};

        expect(HomeView.operatorLine({openWork: stale, mergeRows: rows(5), questions: known(0), now}).text).toBe('5 merges as of 12m ago wait for you');
        expect(HomeView.operatorLine({openWork: ok, mergeRows: rows(5, {stale: true}), questions: known(3), now}).text, 'one stale row makes the queue stale')
            .toBe('3 questions · 5 merges as of 12m ago wait for you');
    });

    test('before the merge read answers the line stays hidden: an answer nobody gave earns no pixels', () => {
        expect(line({state: null, coverage: null, observedAt: null, reason: null}, 0, known(0)).hidden).toBe(true);
        expect(line(null, 0, known(0)).hidden).toBe(true);
        // a bridge without the open-work verb, and a read that threw: the plane's story, told elsewhere
        expect(line({state: 'unavailable', coverage: 'not-wired', reason: 'fleet open-work verb not wired'}, 0, unreadable('x')).hidden).toBe(true);
        expect(line({state: 'unavailable', coverage: 'unanswered', reason: 'fleet open-work read failed'}, 0, unreadable('x')).hidden).toBe(true);
        expect(line(ok, 0, known(0)).hidden).toBe(false);
    });

    test('Home shows the line above everything, from the provider\'s merge queue and open-work read; the questions axis reads its reason until the Brain lists them', () => {
        const
            {host, home} = createHome({
                stateProvider: {
                    module: StateProvider,
                    data  : {gridAdapterState: 'live', gridDegradedReason: null, instanceState: 'ok', openWork: {coverage: null, observedAt: null, reason: null, state: null}, shellPlaneConfigured: null},
                    stores: {fleetAwaitingMerge: {module: FleetAwaitingMerge}, fleetRoster: {module: FleetRoster}}
                }
            }),
            provider = host.getStateProvider(),
            merges   = provider.getStore('fleetAwaitingMerge');

        expect(readLine(home), 'no open-work answer yet').toBe(null);
        expect(home.getReference('operator-line'), 'the line leads the hero block').toBe(home.getReference('operator-line').parent.items[0]);

        provider.setData({openWork: ok});
        merges.add([pr(1), pr(2)]);
        expect(readLine(home)).toBe('your questions could not be read · this plane cannot list them yet · 2 merges wait for you');

        home.questions = {state: 'known', count: 0};
        merges.removeAt(0);
        merges.removeAt(0);
        expect(readLine(home), 'both axes answered zero').toBe('nothing waits for you');

        provider.setData({shellPlaneConfigured: false});
        expect(readLine(home), 'a packaged shell without a plane shows no fleet state').toBe(null);

        host.destroy()
    })
});
