import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'FleetActivityHistoryTest', isMounted: () => true, vnodeInitialising: false}
});

import {expect, test} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import FleetCockpitController from '../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs';
import FleetActivityEvents    from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import FleetAdmission         from '../../../../../../../../apps/agentos/util/FleetAdmission.mjs';
import TargetBinding          from '../../../../../../../../apps/agentos/util/TargetBinding.mjs';

/**
 * @summary The activity feed's older pages: which page is asked, when none is, and where a page may land.
 * The loads are controller methods, so a prototype host with a store-backed provider drives them as
 * production code.
 */
test.describe('FleetCockpit — the activity feed reads older pages', () => {
    let sequence = 0,
        store;

    const
        mailbox = (id, minute = id) => ({
            eventId   : `a2a:MESSAGE:${id}`,
            type      : 'a2a-activity',
            source    : 'memory-core:mailbox',
            occurredAt: new Date(Date.UTC(2026, 8, 30, 12, minute)).toISOString(),
            payload   : {subject: `event ${id}`}
        }),
        prEvent = id => ({
            eventId   : `pr:${id}`,
            type      : 'pr-activity',
            source    : 'github-workflow:pull-requests',
            occurredAt: new Date(Date.UTC(2026, 8, 30, 13, id)).toISOString(),
            payload   : {}
        }),
        makeHost = ({events = [], maxRecords = 1000, profileId = 'profile-a'} = {}) => {
            const data = {streamHistoryExhausted: false};

            store = Neo.create(FleetActivityEvents, {data: events, id: `fleet-activity-history-test-${++sequence}`, maxRecords});

            return Object.assign(Object.create(FleetCockpitController.prototype), {
                activityHistoryFlight    : null,
                activityHistoryGeneration: 0,
                activityHistoryProfileId : null,
                activityHistoryStalledAt : null,
                activityProfileId        : profileId,
                activityWired            : true,
                component                : {
                    getStateProvider   : () => ({getData: key => data[key], getStore: () => store, setData: values => Object.assign(data, values)}),
                    livenessReadTimeout: 1000
                },
                data,
                getReference     : () => null,
                isDestroyed      : false,
                publishConnection: (surface, {data: values} = {}) => values && Object.assign(data, values)
            })
        },
        wireBridge = (fleetActivity, profileId = 'profile-a') => {
            (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity, profileId}}
        },
        // the production switch: the held profile retires, and the new one's live read lands
        switchProfile = (host, profileId, events) => {
            TargetBinding.retireActivity(host, {profileId, store, stream: null});
            FleetAdmission.admitActivity(host, {events, profileId})
        },
        page = events => ({capability: {state: 'wired'}, counts: [], events});

    test.afterEach(() => {
        delete globalThis.AgentOS?.fleet;
        store?.destroy();
        store = null
    });

    test('the next page asks the mailbox lane alone, at the offset of the mailbox rows held, and lands below', async () => {
        const
            host  = makeHost({events: [...Array.from({length: 50}, (_, index) => mailbox(index + 50)), prEvent(1), prEvent(2)]}),
            asked = [];

        wireBridge(async params => {
            asked.push(params);
            return page(Array.from({length: 50}, (_, index) => mailbox(index, index)))
        });

        const landed = await host.onActivityHistoryRequest();

        // the two PR rows are not mailbox rows, so they never move the mailbox offset
        expect(asked).toEqual([{limit: 50, offset: 50, slots: ['a2a']}]);
        expect(landed).toMatchObject({added: 50, retained: 102});
        expect(store.getAt(store.count - 1).eventId).toBe('a2a:MESSAGE:0');
        expect(host.data.streamHistoryExhausted).toBe(false)
    });

    test('a page with no older row marks the feed exhausted, and no page is asked again', async () => {
        const host = makeHost({events: [mailbox(0)]});
        let reads = 0;

        wireBridge(async () => { reads++; return page([]) });

        await host.loadActivityHistory();
        await host.loadActivityHistory();

        expect(host.data.streamHistoryExhausted).toBe(true);
        expect(reads).toBe(1)
    });

    test('a page that adds nothing stalls the reads until the store moves, so a rebuild cannot loop them', async () => {
        const host = makeHost({events: [mailbox(1), mailbox(2)]});
        let reads = 0;

        // every row of this page is already held: new arrivals shifted the offset under it
        wireBridge(async () => { reads++; return page([mailbox(1), mailbox(2)]) });

        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 0});
        await expect(host.loadActivityHistory()).resolves.toBeNull();
        expect(reads).toBe(1);

        store.ingestSnapshot([mailbox(3)]);
        await host.loadActivityHistory();
        expect(reads).toBe(2)
    });

    test('a full ring asks nothing: the page would be the tail it evicts', async () => {
        const host = makeHost({events: [mailbox(1), mailbox(2)], maxRecords: 2});
        let reads = 0;

        wireBridge(async () => { reads++; return page([mailbox(0)]) });

        await expect(host.loadActivityHistory()).resolves.toBeNull();
        expect(reads).toBe(0)
    });

    test('one page is in flight at a time', async () => {
        const host = makeHost({events: [mailbox(9)]});
        let release, reads = 0;

        wireBridge(() => { reads++; return new Promise(resolve => { release = () => resolve(page([mailbox(1)])) }) });

        const first = host.loadActivityHistory();

        await expect(host.loadActivityHistory()).resolves.toBeNull();
        release();
        await expect(first).resolves.toMatchObject({added: 1});
        expect(reads).toBe(1)
    });

    test('a page answered for another profile never lands, and the retire resets the exhausted mailbox', async () => {
        const host = makeHost({events: [mailbox(9)]});

        wireBridge(async () => page([mailbox(1)]), 'profile-b');

        await expect(host.loadActivityHistory()).resolves.toBeNull();
        expect(store.count).toBe(1);

        host.data.streamHistoryExhausted = true;
        host.publishConnection = (surface, {data}) => Object.assign(host.data, data);
        TargetBinding.retireActivity(host, {profileId: 'profile-b', store, stream: null});

        expect(host.data.streamHistoryExhausted).toBe(false);
        expect(store.count).toBe(0)
    });

    test('a late empty page from before a profile switch cannot exhaust the new profile', async () => {
        const host = makeHost({events: [mailbox(9)]});
        let release, reads = 0;

        wireBridge(() => { reads++; return new Promise(resolve => { release = () => resolve(page([])) }) });

        const late = host.loadActivityHistory();

        // the bridge is asked one microtask later
        await Promise.resolve();
        switchProfile(host, 'profile-b', [mailbox(20)]);
        release();

        await expect(late).resolves.toBeNull();
        expect(host.data.streamHistoryExhausted).toBe(false);

        wireBridge(async () => { reads++; return page([mailbox(19)]) }, 'profile-b');

        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 1});
        expect(reads).toBe(2)
    });

    test('a stalled profile leaves the next one pageable, even at the same retained count', async () => {
        const host = makeHost({events: [mailbox(1)]});
        let reads = 0;

        wireBridge(async () => { reads++; return page([mailbox(1)]) });

        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 0});

        switchProfile(host, 'profile-b', [mailbox(30)]);
        wireBridge(async () => { reads++; return page([mailbox(29)]) }, 'profile-b');

        expect(store.count).toBe(1);
        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 1});
        expect(reads).toBe(2)
    });

    test('a read still in flight for the old profile neither blocks the new one nor lands', async () => {
        const host = makeHost({events: [mailbox(9)]});
        let release, reads = 0;

        wireBridge(() => { reads++; return new Promise(resolve => { release = () => resolve(page([mailbox(8)])) }) });

        const late = host.loadActivityHistory();

        switchProfile(host, 'profile-b', [mailbox(40)]);
        wireBridge(async () => { reads++; return page([mailbox(39)]) }, 'profile-b');

        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 1});
        release();
        await expect(late).resolves.toBeNull();
        expect(store.items.map(record => record.eventId)).toEqual(['a2a:MESSAGE:40', 'a2a:MESSAGE:39']);
        expect(reads).toBe(2)
    });

    test('an older page hands its ids to the stream before they land, so they read as history', async () => {
        const
            host  = makeHost({events: [mailbox(9)]}),
            calls = [];

        host.getReference = name => name === 'activity-stream'
            ? {acceptHistory: eventIds => calls.push({eventIds, held: store.count})}
            : null;

        wireBridge(async () => page([mailbox(1), mailbox(2)]));

        await host.loadActivityHistory();

        expect(calls).toEqual([{eventIds: ['a2a:MESSAGE:1', 'a2a:MESSAGE:2'], held: 1}]);
        expect(store.count).toBe(3)
    })
});
