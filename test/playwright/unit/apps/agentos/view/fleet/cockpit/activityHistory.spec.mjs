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
                activityHistoryGeneration: 0,
                activityHistoryInFlight  : false,
                activityHistoryStalledAt : null,
                activityProfileId        : profileId,
                activityWired            : true,
                component                : {
                    getStateProvider   : () => ({getData: key => data[key], getStore: () => store, setData: values => Object.assign(data, values)}),
                    livenessReadTimeout: 1000
                },
                data,
                isDestroyed: false
            })
        },
        wireBridge = (fleetActivity, profileId = 'profile-a') => {
            (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity, profileId}}
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
    })
});
