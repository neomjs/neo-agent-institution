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
        connect: !home.getReference('first-run').hidden,
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

    test('a packaged shell without a plane gets the product line, the promise, Set up your institution with the quiet Connect door, and nothing that reads as fleet state', () => {
        const {host, home} = createHome();

        home.set({gridAdapterState: 'live', instanceState: 'limited', shellPlaneConfigured: false});
        expect(read(home)).toEqual({lead: PRODUCT_LINE, quiet: false, lede: true, connect: true, doors: false, plane: null});
        // the promise keeps the merge decision the operator's own, never a property of the product
        expect(home.getReference('lede').text).toBe('Set up your own AI engineering team — agents with memory that review each other\'s work, running on your machine. You decide what merges.');
        expect(home.getReference('setup-institution').text).toBe('Set up your institution');
        expect(home.getReference('setup-line').text, 'what the door asks for, without an unmeasured duration').toBe('A GitHub token · where it runs · start.');
        expect(home.getReference('connect-plane').text).toBe('Joining a team that already runs one? Connect to it');

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

    test('each door routes to its keeper view under the question it answers; the first run\'s two doors ask the Viewport controller for the card\'s Create and Connect doors', () => {
        const
            {host, home} = createHome(),
            doors        = home.getReference('doors').items.map(({route, text}) => ({route, text}));

        expect(doors).toEqual([
            {route: '/fleet',       text: 'What is the team doing?'},
            {route: '/observatory', text: 'What does the organism know?'},
            {route: '/system',      text: 'Is the plane healing itself?'}
        ]);
        expect(home.getReference('setup-institution').handler).toBe('onSetupInstitution');
        expect(home.getReference('connect-plane').handler).toBe('onConnectInstitution');

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

test.describe('AgentOS.view.home.Container — the operator\'s own count (#557)', () => {
    const
        ok          = {state: 'ok', coverage: 'complete', observedAt: '2026-10-04T18:00:00.000Z', reason: null},
        partial     = {...ok, coverage: 'partial', reason: 'neomjs/devindex could not be read'},
        stale       = {...ok, state: 'stale'},
        later       = Date.parse(ok.observedAt) + 12 * 60 * 1000,
        unreadable  = reason => ({count: null, reason, state: 'unavailable'}),
        unsupported = {count: null, reason: 'questions are not listed yet', state: 'unsupported'},
        known       = count => ({count, reason: null, state: 'ok'}),
        rows        = (count, extra = {}) => Array.from({length: count}, () => ({observedAt: ok.observedAt, stale: false, ...extra})),
        line        = (openWork, merges, questions, now = later) => HomeView.operatorLine({openWork, mergeRows: rows(merges), questions, now}),
        readLine    = home => {
            const operator = home.getReference('operator-line');

            return operator.hidden ? null : operator.vdom.cn.map(node => node.text).join('')
        },
        pr          = number => ({id: `neomjs/neo#${number}`, repo: 'neomjs/neo', number, ci: 'success', mergeable: true, draft: false, observedAt: ok.observedAt, stale: false});

    test('both axes complete: the counts that wait, and "nothing waits for you" only when both observed zero', () => {
        expect(line(ok, 0, known(0)).text).toBe('nothing waits for you');
        expect(line(ok, 5, known(3)).text).toBe('3 questions · 5 merges wait for you');
        expect(line(ok, 1, known(0)).text).toBe('1 merge waits for you');
        expect(line(ok, 0, known(1)).text).toBe('1 question waits for you');
        expect(line(ok, 1, known(1)).text).toBe('1 question · 1 merge wait for you');
        expect(line(ok, 5, known(3)).title, 'every axis counted: no title').toBe(null);
    });

    test('a zero that is not complete never reads as one: a partial queue names itself and its reason, a stale one keeps its age', () => {
        expect(line(partial, 0, known(0)), 'a partial read is not an empty queue').toEqual({
            hidden  : false,
            segments: [{text: 'your merges could not all be read'}],
            text    : 'your merges could not all be read',
            title   : 'your merges: neomjs/devindex could not be read'
        });
        expect(line(stale, 0, known(0)).text, 'a stale zero is the all-clear of its time, never of now').toBe('nothing waits for you as of 12m ago');
        expect(line(partial, 3, known(0)), 'a partial count is the least that waits, never hidden behind "could not all"')
            .toMatchObject({text: 'at least 3 merges wait for you · some could not be read', title: 'your merges: neomjs/devindex could not be read'});
        expect(line(partial, 1, known(2)).text).toBe('2 questions · at least 1 merge wait for you · some could not be read');
        expect(line(partial, 0, unsupported), 'beside the unlisted questions the partial reason still rides the title').toMatchObject({
            text : 'your questions are not listed yet · your merges could not all be read',
            title: 'your questions: questions are not listed yet · your merges: neomjs/devindex could not be read'
        });
    });

    test('an axis without a number leads, the source\'s reason in the title, and the other keeps its number — never a 0 and never "nothing"', () => {
        expect(line(ok, 5, unsupported)).toMatchObject({
            text : 'your questions are not listed yet · 5 merges wait for you',
            title: 'your questions: questions are not listed yet'
        });
        expect(line(ok, 0, unsupported).text, 'a known zero beside an unlisted axis is not "nothing"').toBe('your questions are not listed yet');
        // a read that failed says so, apart from one that is not listed yet
        expect(line(ok, 5, unreadable('the mailbox read timed out')).text).toBe('your questions could not be read · 5 merges wait for you');
        expect(line({state: 'unavailable', coverage: 'unavailable', reason: 'open-work verb missing'}, 0, known(2))).toMatchObject({
            text : 'your merges could not be read · 2 questions wait for you',
            title: 'your merges: open-work verb missing'
        });
    });

    test('a stale merge queue reads its count as of its oldest row; looking never moves the count', () => {
        expect(line(stale, 5, known(0)).text).toBe('5 merges as of 12m ago wait for you');
        expect(HomeView.operatorLine({openWork: ok, mergeRows: rows(5, {stale: true}), questions: known(3), now: later}).text, 'one stale row makes the queue stale')
            .toBe('3 questions · 5 merges as of 12m ago wait for you');
    });

    test('an answer nobody gave earns no pixels, and never hides an axis that has one', () => {
        expect(line({state: null, coverage: null, observedAt: null, reason: null}, 0, known(0)).hidden, 'one zero cannot say "nothing" alone').toBe(true);
        expect(line(null, 0, null).hidden, 'no answer on either axis').toBe(true);
        // a bridge without the open-work verb, and a read that threw: the plane's story, told elsewhere
        expect(line({state: 'unavailable', coverage: 'not-wired', reason: 'fleet open-work verb not wired'}, 0, null).hidden).toBe(true);
        expect(line({state: 'unavailable', coverage: 'unanswered', reason: 'fleet open-work read failed'}, 0, known(2)), 'a silent merge axis keeps the known questions')
            .toMatchObject({hidden: false, text: '2 questions wait for you', title: null});
        expect(line(ok, 0, null).hidden, 'a zero queue beside unanswered questions').toBe(true);
    });

    test('the merge count is the line\'s one link, to the merge queue; a question count is not', () => {
        expect(line(ok, 5, known(3)).segments).toEqual([
            {text: '3 questions'},
            {text: ' · '},
            {link: 'merges', text: '5 merges'},
            {text: ' wait for you'}
        ]);
        expect(line(ok, 0, known(3)).segments.some(segment => segment.link), 'no merges, nothing to open').toBe(false);
        expect(line({state: 'unavailable', coverage: 'unavailable', reason: 'x'}, 0, known(1)).segments.some(segment => segment.link)).toBe(false);
    });

    test('Home shows the line above everything from the provider: the merge queue, the open-work read and the questions axis its source answers', () => {
        const
            {host, home} = createHome({
                stateProvider: {
                    module: StateProvider,
                    data  : {
                        gridAdapterState    : 'live',
                        gridDegradedReason  : null,
                        instanceState       : 'ok',
                        openWork            : {coverage: null, observedAt: null, reason: null, state: null},
                        questions           : {count: null, reason: null, state: null},
                        shellPlaneConfigured: null
                    },
                    stores: {fleetAwaitingMerge: {module: FleetAwaitingMerge}, fleetRoster: {module: FleetRoster}}
                }
            }),
            provider = host.getStateProvider(),
            merges   = provider.getStore('fleetAwaitingMerge'),
            operator = home.getReference('operator-line');

        expect(readLine(home), 'no open-work answer yet').toBe(null);
        expect(operator, 'the line leads the hero block').toBe(operator.parent.items[0]);

        provider.setData({openWork: ok, questions: unsupported});
        merges.add([pr(1), pr(2)]);
        expect(readLine(home)).toBe('your questions are not listed yet · 2 merges wait for you');
        expect(operator.vdom.title, 'the source\'s reason rides the title').toBe('your questions: questions are not listed yet');
        expect(operator.vdom.cn[2], 'the merge count is a button').toMatchObject({tag: 'button', type: 'button', cls: ['fm-home-operator-link'], text: '2 merges'});

        // the source changes its answer: the line follows without a word of it living in the view
        provider.setData({questions: unreadable('Memory Core refused the read')});
        expect(readLine(home)).toBe('your questions could not be read · 2 merges wait for you');
        expect(operator.vdom.title).toBe('your questions: Memory Core refused the read');

        provider.setData({questions: known(0)});
        merges.removeAt(0);
        merges.removeAt(0);
        expect(readLine(home), 'both axes answered zero').toBe('nothing waits for you');

        provider.setData({shellPlaneConfigured: false});
        expect(readLine(home), 'a packaged shell without a plane shows no fleet state').toBe(null);

        host.destroy()
    });

    test('a click on the merge count asks for the merge queue; a click anywhere else stays the field\'s', () => {
        const
            {host, home} = createHome(),
            asked        = [];

        home.on('mergeQueueOpen', () => asked.push(true));

        home.onFieldClick({path: [{cls: ['fm-home-operator-link']}, {cls: ['fm-home-operator']}]});
        expect(asked.length).toBe(1);

        home.onFieldClick({path: [{cls: ['fm-home-operator']}, {cls: ['fm-home-view']}]});
        expect(asked.length, 'the line itself is not the link').toBe(1);

        host.destroy()
    })
});
