import {setup} from '../../../../../../../setup.mjs';

const appName = 'FleetAgentCardRotationTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

test.describe('Fleet cockpit AgentCard — the seat\'s session rotation line (#842)', () => {
    let AgentCard, FleetAgent, SessionRotation, Store, ViewerTime, getActivityObjectText, getActivityObjectTitle;

    const
        stores    = [],
        now       = Date.parse('2026-11-14T03:00:00.000Z'),
        decidedAt = '2026-11-14T02:17:00.000Z',
        sources   = {
            roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
            repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
            runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
        },
        completed = {state: 'completed', reason: null, receiptId: 'MESSAGE:r1', decidedAt, oldSessionId: '1a2b3c4d-old', newSessionId: '5e6f7a8b-new', nextEligibleAt: null};

    const makeStore = rows => {
        const store = Neo.create(Store, {keyProperty: 'agentId', model: FleetAgent, data: rows.map(row => ({sources, state: 'ok', ...row}))});

        stores.push(store);
        return store
    };

    const createCard = rotation => {
        const store = makeStore([{agentId: 'ada', displayName: 'Ada', rotation}]);

        return Neo.create(AgentCard, {appName, now, record: store.get('ada'), rosterState: 'live'})
    };

    const line = card => card.getReference('card-rotation');
    const at   = instant => ViewerTime.formatViewerTime(instant, {now}).text;

    test.beforeAll(async () => {
        AgentCard       = (await import('../../../../../../../../../apps/agentos/view/fleet/roster/card/Container.mjs')).default;
        FleetAgent      = (await import('../../../../../../../../../apps/agentos/model/FleetAgent.mjs')).default;
        SessionRotation = (await import('../../../../../../../../../apps/agentos/util/SessionRotation.mjs')).default;
        Store           = (await import('../../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default;
        ViewerTime      = (await import('../../../../../../../../../apps/agentos/util/ViewerTime.mjs')).default;
        ({getActivityObjectText, getActivityObjectTitle} = await import('../../../../../../../../../apps/agentos/view/fleet/activity/RowContainer.mjs'))
    });

    test.afterAll(() => {
        stores.forEach(store => store.destroy());
        stores.length = 0
    });

    test('AC-1: the old session reads retired only once the fresh one registered; before that the card says the rotation is in flight', () => {
        const card = createCard({...completed, state: 'requested', newSessionId: null});

        expect(line(card).hidden).toBe(false);
        expect(line(card).text).toBe(`rotating since ${at(decidedAt)}`);
        expect(line(card).text).not.toContain('rotated');

        card.record.set({rotation: completed});
        card.applyRecord();

        expect(line(card).text).toBe(`rotated ${at(decidedAt)} · from 1a2b3c4d to 5e6f7a8b`);
        expect(line(card).cls).toContain('fm-rotation-completed');
        expect(line(card).vdom.title).toContain('to 5e6f7a8b-new');
        expect(line(card).vdom.title).toContain('receipt MESSAGE:r1');

        card.destroy()
    });

    test('AC-1: a rotation that found no fresh session is reported on the card, and the card starts no stop', () => {
        const card = createCard({...completed, state: 'incomplete', reason: 'no-fresh-session', newSessionId: null});

        expect(line(card).text).toBe('rotation incomplete · no-fresh-session');
        expect(line(card).cls).toContain('fm-rotation-incomplete');
        expect(card.record.pendingAction ?? null).toBeNull();

        card.destroy()
    });

    test('AC-2: a rotation the plane refused inside the minimum interval shows its reason and when the seat may rotate again', () => {
        const
            nextEligibleAt = '2026-11-14T04:30:00.000Z',
            card           = createCard({...completed, state: 'refused', reason: 'minimum-interval', newSessionId: null, nextEligibleAt});

        expect(line(card).text).toBe(`rotation refused · minimum-interval · next ${at(nextEligibleAt)}`);
        expect(line(card).cls).toContain('fm-rotation-refused');

        card.destroy()
    });

    test('a seat with no record, no report, an unreadable record or no answer yet earns no line', () => {
        for (const rotation of [{state: 'none', reason: null}, {state: 'unobserved', reason: null}, {state: 'unknown', reason: 'rotation record unreadable'}, null]) {
            const card = createCard(rotation);

            expect(line(card).hidden).toBe(true);
            expect(line(card).text ?? null).toBeNull();

            card.destroy()
        }
    });

    test('the wake-routes read writes each seat\'s rotation onto its roster record, and an older Fleet or an unreadable answer writes nothing', () => {
        const
            store = makeStore([{agentId: 'ada'}, {agentId: 'clio', rotation: completed}]),
            apply = snapshot => SessionRotation.apply(store, snapshot);

        apply({capability: {state: 'wired'}, seats: [{agentId: 'ada', rotation: completed}, {agentId: 'ghost', rotation: completed}]});
        expect(store.get('ada').rotation).toEqual(completed);

        apply({capability: {state: 'wired'}, seats: [{agentId: 'clio'}]});
        expect(store.get('clio').rotation).toEqual(completed);

        apply({capability: {state: 'unavailable', reason: 'fleet wake-routes read failed'}, seats: [{agentId: 'ada', rotation: null}]});
        expect(store.get('ada').rotation).toEqual(completed);

        apply({capability: {state: 'degraded'}, seats: [{agentId: 'ada', rotation: {state: 'none', reason: null}}]});
        expect(store.get('ada').rotation).toEqual({state: 'none', reason: null})
    });

    test('the rotations are re-read on the first activity page and on a rotation the store has not seen, never per tick', async () => {
        const
            {default: FleetAdmission} = await import('../../../../../../../../../apps/agentos/util/FleetAdmission.mjs'),
            seen                      = new Set(),
            store                     = {get: id => seen.has(id) || null, ingestSnapshot: events => events.forEach(event => seen.add(event.eventId))},
            owner                     = {activityWired: false, reads: 0, getReference: () => null, publishConnection() {},
                bridge: {fleetWakeRoutes: async () => (owner.reads++, {seats: []})}, resolveFleetActivityEventsStore: () => store},
            event = id => ({eventId: id, type: 'session-rotation', source: 'fleet:sessionRotation', confidence: 'observed', occurredAt: decidedAt}),
            admit = events => FleetAdmission.admitActivity(owner, {capability: {state: 'wired'}, events});

        admit([]);
        expect(owner.reads).toBe(1);

        admit([{eventId: 'a2a-1', type: 'a2a-activity'}]);
        expect(owner.reads).toBe(1);

        admit([event('fleet:sessionRotation:MESSAGE:r1:completed')]);
        expect(owner.reads).toBe(2);

        admit([event('fleet:sessionRotation:MESSAGE:r1:completed')]);
        expect(owner.reads).toBe(2)
    });

    test('the cards\' rotation read leaves the Wake pane to the operator: no pane write, no pane snapshot', async () => {
        const
            store = makeStore([{agentId: 'ada'}]),
            pane  = {snapshot: null},
            owner = {
                bridge                 : {fleetWakeRoutes: async () => ({capability: {state: 'wired'}, seats: [{agentId: 'ada', rotation: completed}]})},
                component              : {getWakeRoutesPane: () => pane},
                resolveFleetRosterStore: () => store,
                wakeRoutesSnapshot     : null
            },
            read  = () => SessionRotation.load(owner);

        await read();

        expect(store.get('ada').rotation).toEqual(completed);
        expect(pane.snapshot).toBeNull();
        expect(owner.wakeRoutesSnapshot).toBeNull();

        // a roster that lands after the answer takes it without a second read
        const later = makeStore([{agentId: 'ada'}]);

        owner.resolveFleetRosterStore = () => later;
        SessionRotation.reapply(owner);
        expect(later.get('ada').rotation).toEqual(completed);
        owner.resolveFleetRosterStore = () => store;

        owner.bridge = {fleetWakeRoutes: async () => { throw new Error('fleet read exceeded 20ms') }};
        await read();
        expect(store.get('ada').rotation).toEqual(completed);

        owner.bridge = null;
        await read();
        expect(store.get('ada').rotation).toEqual(completed)
    });

    test('the rotation read belongs to the profile that answered: a switch neither re-applies the held answer nor admits a late one', async () => {
        const
            storeA = makeStore([{agentId: 'ada'}]),
            storeB = makeStore([{agentId: 'ada'}]),
            answer = {capability: {state: 'wired'}, seats: [{agentId: 'ada', rotation: completed}]},
            owner  = {
                bridge                 : {profileId: 'A', fleetWakeRoutes: async () => answer},
                get bridgeProfileId() {return this.bridge?.profileId ?? null},
                resolveFleetRosterStore: () => storeA,
                rotationRead           : null
            },
            switchTo = (profileId, store) => {
                owner.bridge                  = {profileId, fleetWakeRoutes: async () => ({capability: {state: 'wired'}, seats: []})};
                owner.resolveFleetRosterStore = () => store
            };

        await SessionRotation.load(owner);
        expect(storeA.get('ada').rotation).toEqual(completed);

        // instance B's roster lands before its own rotation read: A's held answer stays off it
        switchTo('B', storeB);
        SessionRotation.reapply(owner);
        expect(storeB.get('ada').rotation).toBeNull();

        // a read of A still in flight when the operator switches to B lands nowhere
        let release;

        owner.bridge                  = {profileId: 'A', fleetWakeRoutes: () => new Promise(resolve => release = resolve)};
        owner.resolveFleetRosterStore = () => storeA;

        const inFlight = SessionRotation.load(owner);

        switchTo('B', storeB);
        release(answer);
        await inFlight;
        expect(storeB.get('ada').rotation).toBeNull();
        expect(owner.rotationRead?.profileId ?? null).not.toBe('B')
    });

    test('a seat joining a wired roster takes the held rotation, and a re-apply writes only what changed', () => {
        const
            store  = makeStore([{agentId: 'ada', rotation: completed}]),
            joiner = {...completed, receiptId: 'MESSAGE:r2'},
            owner  = {
                bridge                 : {profileId: 'A'},
                get bridgeProfileId() {return this.bridge?.profileId ?? null},
                resolveFleetRosterStore: () => store,
                rotationRead           : null
            };

        SessionRotation.admit(owner, {capability: {state: 'wired'}, seats: [{agentId: 'ada', rotation: completed}, {agentId: 'clio', rotation: joiner}]}, 'A');

        let writes = 0;

        store.on('recordChange', () => writes++);
        store.add({agentId: 'clio', sources, state: 'ok'});
        SessionRotation.reapply(owner);

        expect(store.get('clio').rotation).toEqual(joiner);
        expect(store.get('ada').rotation).toEqual(completed);
        expect(writes).toBe(1)
    });

    test('the journal words a session-rotation event as the card does, and its title keeps the full ids and the receipt', () => {
        expect(getActivityObjectText({type: 'session-rotation', payload: {...completed, decidedAt: null}})).toBe('rotated · from 1a2b3c4d to 5e6f7a8b');
        expect(getActivityObjectText({type: 'session-rotation', payload: {state: 'incomplete', reason: 'no-fresh-session'}})).toBe('rotation incomplete · no-fresh-session');
        expect(getActivityObjectText({type: 'session-rotation', payload: {state: 'none'}})).toBe('session rotation');

        const title = getActivityObjectTitle({type: 'session-rotation', payload: completed});

        expect(title).toContain('from 1a2b3c4d-old');
        expect(title).toContain('to 5e6f7a8b-new');
        expect(title).toContain('receipt MESSAGE:r1');
        expect(getActivityObjectTitle({type: 'session-rotation', payload: {state: 'none'}})).toBeNull()
    });
});
