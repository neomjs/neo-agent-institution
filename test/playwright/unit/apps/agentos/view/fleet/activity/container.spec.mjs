import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetActivityBufferedStreamTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        unitTestMode           : true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect}                                               from '@playwright/test';
import Neo                                                          from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                                                    from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import DomApiVnodeCreator                                           from '../../../../../../../../node_modules/neo.mjs/src/vdom/util/DomApiVnodeCreator.mjs';
import Instance                                                     from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import VdomHelper                                                   from '../../../../../../../../node_modules/neo.mjs/src/vdom/Helper.mjs';
import ActivityStream, {describeActivityCounts, describeQuietSince} from '../../../../../../../../apps/agentos/view/fleet/activity/Container.mjs';
import {formatConversationRef, getActivityObjectText, getActivityObjectTitle} from '../../../../../../../../apps/agentos/view/fleet/activity/RowContainer.mjs';
import FleetActivityEvents                                          from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import ViewerTime                                                   from '../../../../../../../../apps/agentos/util/ViewerTime.mjs';

test.describe('Fleet activity — Store-backed list.Buffered history (#17550)', () => {
    let sequence = 0,
        store,
        stream;

    const event = (id, minute=id, overrides={}) => ({
        eventId   : `a2a:MESSAGE:${id}`,
        type      : 'a2a-activity',
        source    : 'memory-core:mailbox',
        agentId   : `agent-${id}`,
        occurredAt: new Date(Date.UTC(2026, 7, 22, 12, minute)).toISOString(),
        payload   : {subject: `event ${id}`, to: '@neo-gpt', recipientClass: 'agent'},
        ...overrides
    });

    const makeEvents = count => Array.from({length: count}, (_, index) => event(index, index));

    const createStream = async ({count=500, counts=[], maxRecords=1000, viewportHeight=156}={}) => {
        store = Neo.create(FleetActivityEvents, {
            data: makeEvents(count),
            id  : `fleet-activity-events-test-${++sequence}`,
            maxRecords
        });
        stream = Neo.create(ActivityStream, {
            actorDirectory: {'agent-499': {displayName: 'Newest Agent'}},
            appName,
            counts,
            id            : `fleet-activity-stream-test-${sequence}`,
            store
        });

        await stream.initVnode();
        stream.mounted = true;

        const list = stream.getReference('list');

        list.onResize({rect: {height: viewportHeight}});
        list.createItems(true);

        return {list, store, stream}
    };

    test.afterEach(() => {
        stream?.destroy();
        store?.destroy();
        stream = null;
        store  = null
    });

    test('500 records mount only viewport + buffer rows; fold and row rebuild are gone', async () => {
        const {list} = await createStream();

        expect(store.count).toBe(500);
        // 156px viewport over the 32px density-contract rows: 5 visible + 2×4 buffer = 13 pooled
        expect(list.availableRows).toBe(5);
        expect(list.items.filter(Boolean)).toHaveLength(13);
        expect(list.vdom.cn.slice(1, -1)).toHaveLength(13);
        expect(stream.down({cls: 'fm-stream-fold'})).toBeNull();
        expect(stream.vdom.role).toBe('log');
        expect(list.vdom['aria-live']).toBe('off');
        expect(stream.getReference('announcer').vdom.role).toBe('status')
    });

    test('scroll recycling preserves each pooled row and its fixed five child identities', async () => {
        const {list} = await createStream({count: 100});

        const
            slot        = list.recordSlotMap.get(store.first().eventId),
            row         = list.items[slot],
            rowId       = row.id,
            childIds    = row.items.map(item => item.id),
            physicalIds = new Set(list.items.filter(Boolean).map(item => item.id));

        expect(row.items).toHaveLength(5);

        list.onScrollCapture({target: {id: list.id}, scrollLeft: 0, scrollTop: 208});

        expect(new Set(list.items.filter(Boolean).map(item => item.id))).toEqual(physicalIds);
        expect(row.id).toBe(rowId);
        expect(row.items.map(item => item.id)).toEqual(childIds)
    });

    test('one recycle batch converges record, child VDOM, VNode and fixed optional cell roots', async () => {
        const {list} = await createStream({count: 20});
        const row    = list.items[0];

        store.ingestSnapshot([event('newest', 200, {
            eventId: 'a2a:MESSAGE:newest',
            payload: {subject: 'newest object', to: null, recipientClass: 'unknown'},
            agentId: null
        })], {replace: true});

        await row.promiseUpdate();

        expect(row.record.eventId).toBe('a2a:MESSAGE:newest');
        expect(row.getReference('object').text).toBe('newest object');
        expect(row.getReference('object').vnode.textContent).toBe('newest object');
        expect(row.getReference('actor').hidden).toBe(false);
        expect(row.getReference('actor').cls).toContain('is-empty');
        expect(row.getReference('recipient').hidden).toBe(false);
        expect(row.getReference('recipient').cls).toContain('is-empty');
        expect(row.vnode.childNodes.map(node => node.id)).toEqual(row.items.map(item => item.id))
    });

    test('prepend while reading history preserves record + pixel offset and surfaces new ids', async () => {
        const {list} = await createStream({count: 100});

        list.onScrollCapture({target: {id: list.id}, scrollLeft: 0, scrollTop: 265});

        const
            anchorId     = list.anchorRecordId,
            anchorOffset = list.anchorOffset,
            anchorBefore = store.get(anchorId),
            result       = store.ingestSnapshot([
                event('new-1', 200, {eventId: 'a2a:MESSAGE:new-1'}),
                event('new-2', 201, {eventId: 'a2a:MESSAGE:new-2'})
            ]);

        expect(result.newEventIds).toEqual(['a2a:MESSAGE:new-1', 'a2a:MESSAGE:new-2']);
        expect(list.anchorRecordId).toBe(anchorId);
        expect(list.anchorOffset).toBe(anchorOffset);
        expect(store.get(anchorId)).toBe(anchorBefore);
        expect(store.getAt(Math.floor(list.scrollTop / list.itemHeight)).eventId).toBe(anchorId);
        expect(stream.pendingNewEventCount).toBe(2);
        expect(stream.getReference('new-events').text).toBe('2 new events ↑');
        expect(stream.getReference('announcer').text).toContain('2 new fleet activity events');

        stream.onNewEventsClick();
        expect(list.scrollTop).toBe(0);
        expect(stream.pendingNewEventCount).toBe(0);
        expect(stream.getReference('new-events').hidden).toBe(true)
    });

    test('Store upserts by producer id, sorts deterministically, and counts local eviction', () => {
        store = Neo.create(FleetActivityEvents, {id: `fleet-activity-events-test-${++sequence}`, maxRecords: 3});

        store.ingestSnapshot([event(1, 1), event(2, 2), event(3, 3)]);
        const retained = store.get('a2a:MESSAGE:2');

        const result = store.ingestSnapshot([
            event(2, 2, {payload: {subject: 'updated'}}),
            event(4, 4)
        ]);

        expect(store.count).toBe(3);
        expect(store.items.map(record => record.eventId)).toEqual([
            'a2a:MESSAGE:4',
            'a2a:MESSAGE:3',
            'a2a:MESSAGE:2'
        ]);
        expect(store.get('a2a:MESSAGE:2')).toBe(retained);
        expect(retained.payload.subject).toBe('updated');
        expect(result).toMatchObject({added: 1, dropped: 1, retained: 3});
        expect(store.droppedCount).toBe(1)
    });

    test('Store refuses missing or duplicate producer identity before mutating retained truth', () => {
        store = Neo.create(FleetActivityEvents, {id: `fleet-activity-events-test-${++sequence}`});
        store.ingestSnapshot([event(1)]);

        expect(() => store.ingestSnapshot([{type: 'a2a-activity'}])).toThrow('producer-owned eventId');
        expect(() => store.ingestSnapshot([event(2), event(2)])).toThrow('duplicate eventId');
        expect(store.items.map(record => record.eventId)).toEqual(['a2a:MESSAGE:1'])
    });

    test('row keeps actor once, named object, local time + exact ISO title in stable children', async () => {
        const pr = event('pr-17550', 10, {
            eventId: 'github-workflow:pull-requests:17550',
            type   : 'pr-activity',
            agentId: 'neo-gpt-emmy',
            payload: {number: 17550, title: 'Activity stream buffered list'}
        });

        store = Neo.create(FleetActivityEvents, {data: [pr], id: `fleet-activity-events-test-${++sequence}`});
        stream = Neo.create(ActivityStream, {
            actorDirectory: {'neo-gpt-emmy': {displayName: 'Emmy'}},
            appName,
            id            : `fleet-activity-stream-test-${sequence}`,
            store
        });
        await stream.initVnode();

        const row = stream.getReference('list').items[0];

        expect(row.items).toHaveLength(5);
        expect(row.getReference('actor').label).toBe('Emmy');
        expect(row.getReference('object').text).toBe('#17550 · Activity stream buffered list');
        expect(row.getReference('object').text).not.toContain('neo-gpt-emmy');
        expect(row.getReference('time').vdom.title).toBe(pr.occurredAt);
        expect(row.vdom['aria-label']).toContain('#17550 · Activity stream buffered list')
    });

    test('object grammar handles A2A, issue, stall and malformed subjects without duplication', () => {
        expect(getActivityObjectText({type: 'a2a-activity', payload: {subject: 'Review requested'}})).toBe('Review requested');
        expect(getActivityObjectText({type: 'issue-activity', payload: {number: 17550, title: 'Buffered history'}})).toBe('#17550 · Buffered history');
        expect(getActivityObjectText({type: 'work-stall', payload: {findingClass: 'ownership-gap', subject: {id: 'LANE:x'}}})).toBe('stalled · LANE:x');
        expect(getActivityObjectText({type: 'a2a-activity', payload: {subject: {unexpected: true}}})).toBe('a2a-activity')
    });

    test('object refs name their repository: bare at home, a declared short slug across origins, the full slug in the title', () => {
        // AC-1: a home row, with or without the field, renders exactly as before
        expect(getActivityObjectText({type: 'issue-activity', payload: {number: 7, repoSlug: 'neo', title: 'home'}})).toBe('#7 · home');
        expect(getActivityObjectText({type: 'issue-activity', payload: {number: 7, title: 'no field'}})).toBe('#7 · no field');
        // AC-2: a foreign origin renders its declared short name; an unknown slug renders itself
        expect(getActivityObjectText({type: 'pr-activity', payload: {number: 410, repoSlug: 'neo-agent-brain', title: 'leaf'}})).toBe('brain#410 · leaf');
        expect(getActivityObjectText({type: 'lane-claim', payload: {issueNumber: 178, repoSlug: 'neo-agent-institution', issueTitle: 'learn tree'}})).toBe('institution#178 · learn tree');
        expect(getActivityObjectText({type: 'issue-activity', payload: {number: 3, repoSlug: 'neo-unknown-repo', title: 'x'}})).toBe('neo-unknown-repo#3 · x');
        expect(getActivityObjectText({type: 'work-stall', payload: {findingClass: 'STALE_DEFER', subject: {number: 9, repoSlug: 'neo-agent-skills', title: 't'}}})).toBe('stalled · skills#9 · t');
        expect(formatConversationRef(null, 12)).toBe('#12');
        // AC-3: the title carries the full slug, home included; rows without a number carry none
        expect(getActivityObjectTitle({type: 'issue-activity', payload: {number: 7}})).toBe('neomjs/neo#7');
        expect(getActivityObjectTitle({type: 'pr-activity', payload: {number: 410, repoSlug: 'neo-agent-brain'}})).toBe('neomjs/neo-agent-brain#410');
        expect(getActivityObjectTitle({type: 'work-stall', payload: {subject: {number: 9, repoSlug: 'devindex'}}})).toBe('neomjs/devindex#9');
        expect(getActivityObjectTitle({type: 'a2a-activity', payload: {subject: 'hello'}})).toBeNull()
    });

    test('a foreign-origin row carries the short ref in its object cell and the full slug in that cell\'s title', async () => {
        const pr = event('pr-brain-410', 10, {
            eventId: 'github-workflow:pull-requests:neo-agent-brain#410',
            type   : 'pr-activity',
            agentId: 'neo-fable-clio',
            payload: {number: 410, repoSlug: 'neo-agent-brain', title: 'the activity feed reads a declared content root'}
        });

        store = Neo.create(FleetActivityEvents, {data: [pr], id: `fleet-activity-events-test-${++sequence}`});
        stream = Neo.create(ActivityStream, {
            actorDirectory: {'neo-fable-clio': {displayName: 'Clio'}},
            appName,
            id            : `fleet-activity-stream-test-${sequence}`,
            store
        });
        await stream.initVnode();

        const row    = stream.getReference('list').items[0],
              object = row.getReference('object');

        expect(object.text).toBe('brain#410 · the activity feed reads a declared content root');
        expect(object.vdom.title).toBe('neomjs/neo-agent-brain#410');
        expect(row.vdom['aria-label']).toContain('brain#410')
    });

    test('count header labels producer truth and ignores incomplete rows', () => {
        const view = describeActivityCounts([{
            source    : 'memory-core:mailbox',
            scope     : 'last24h',
            value     : 36,
            complete  : true,
            capturedAt: '2026-08-22T21:00:00.000Z'
        }, {
            source    : 'memory-core:mailbox',
            scope     : 'total',
            value     : 412,
            complete  : true,
            capturedAt: '2026-08-22T21:00:00.000Z'
        }, {
            source    : 'github-workflow:pull-requests',
            scope     : 'total',
            value     : 99,
            complete  : false,
            capturedAt: '2026-08-22T21:00:00.000Z'
        }]);

        expect(view.text).toBe('mailbox · 36 / 24h · 412 total');
        expect(view.title).toContain('memory-core:mailbox total=412');
        expect(describeActivityCounts([{scope: 'total', value: 1, complete: true}])).toBeNull()
    });

    test('count chrome stays mounted while complete producer truth appears and disappears', async () => {
        await createStream({count: 1});

        const countCell = stream.getReference('counts');

        expect(countCell.hidden).toBe(false);
        expect(countCell.cls).toContain('is-empty');

        stream.counts = [{
            source    : 'memory-core:mailbox',
            scope     : 'total',
            value     : 412,
            complete  : true,
            capturedAt: '2026-08-22T21:00:00.000Z'
        }];
        await stream.timeout(20);

        expect(countCell.text).toBe('mailbox · 412 total');
        expect(countCell.cls).not.toContain('is-empty');
        expect(countCell.vnode.textContent).toBe('mailbox · 412 total');

        stream.counts = [];
        await stream.timeout(20);

        expect(countCell.text).toBe('');
        expect(countCell.cls).toContain('is-empty')
    });

    test('stale state keeps retained rows and names the degrade', async () => {
        const {list}  = await createStream({count: 20});
        const mounted = list.items.filter(Boolean).length;

        stream.adapterState = 'stale';

        expect(stream.getReference('header').cls).toContain('is-stale');
        expect(stream.getReference('state').text).toBe('stale — reconnecting');
        expect(list.items.filter(Boolean)).toHaveLength(mounted)
    });

    test('describeQuietSince states an old newest event, and claims nothing it cannot read', () => {
        const
            now   = Date.UTC(2026, 8, 19, 12),
            old   = new Date(now - 25 * 60 * 60 * 1000).toISOString(),
            fresh = new Date(now - 60 * 60 * 1000).toISOString(),
            quiet = describeQuietSince(old, now);

        expect(quiet.text).toBe(`quiet since ${ViewerTime.formatViewerTime(old, {now}).text}`);
        expect(quiet.title).toContain(old);
        expect(quiet.title).toContain('the fleet was quiet, or an activity source stopped delivering');

        expect(describeQuietSince(fresh, now)).toBeNull();
        expect(describeQuietSince(null, now)).toBeNull();
        expect(describeQuietSince('not a date', now)).toBeNull()
    });

    test('a live feed over old rows says so beside its connection word', async () => {
        await createStream({count: 20});

        stream.adapterState = 'live';

        const
            state  = stream.getReference('state'),
            newest = store.getAt(0).occurredAt;

        expect(state.text).toBe(`● streaming · quiet since ${ViewerTime.formatViewerTime(newest).text}`);
        expect(state.vdom.title).toContain(newest);
        expect(stream.getReference('header').cls).toEqual(expect.arrayContaining(['is-live', 'is-quiet']))
    });

    test('a live feed with a fresh newest event, or with no rows, keeps the bare connection word', async () => {
        await createStream({count: 20});

        stream.adapterState = 'live';
        store.add(event(900, 0, {occurredAt: new Date(Date.now() - 60 * 1000).toISOString()}));

        expect(stream.getReference('state').text).toBe('● streaming');
        expect(stream.getReference('state').vdom.title ?? null).toBeNull();
        expect(stream.getReference('header').cls).toContain('is-live');
        expect(stream.getReference('header').cls).not.toContain('is-quiet');

        store.clear();

        expect(stream.getReference('state').text).toBe('● streaming');
        expect(stream.getReference('header').cls).not.toContain('is-quiet')
    });

    test('sample and stale keep their own words over old rows', async () => {
        await createStream({count: 20});

        expect(stream.getReference('state').text).toBe('sample · live feed pending');
        expect(stream.getReference('header').cls).not.toContain('is-quiet');

        stream.adapterState = 'stale';

        expect(stream.getReference('state').text).toBe('stale — reconnecting');
        expect(stream.getReference('header').cls).not.toContain('is-quiet')
    })
});
