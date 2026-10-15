import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'FleetActivityObserverTest', isMounted: () => true, vnodeInitialising: false}
});

import {expect, test} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import FleetCockpitController from '../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs';
import FleetActivityEvents    from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';

/**
 * @summary The Activity feed's observer modes: the selector each mode sends, the admission that fences
 * what the store holds, the canonical continuation older pages follow, and the read-only message detail. The
 * loads are controller methods, so a prototype host with a store-backed provider drives them as production code.
 */
test.describe('FleetCockpit — the Activity feed observes All A2A and involves me', () => {
    const
        ALL      = {memorySharing: 'team', scope: 'all'},
        INVOLVES = {scope: 'involves-me'},
        mailbox  = (id, minute = id) => ({
            eventId   : `a2a:MESSAGE:${id}`,
            type      : 'a2a-activity',
            source    : 'memory-core:mailbox',
            confidence: 'observed',
            occurredAt: new Date(Date.UTC(2026, 9, 15, 12, minute)).toISOString(),
            payload   : {messageId: `MESSAGE:${id}`, subject: `message ${id}`}
        }),
        prEvent  = id => ({
            eventId   : `pr:${id}`,
            type      : 'pr-activity',
            source    : 'github-workflow:pull-requests',
            confidence: 'observed',
            occurredAt: new Date(Date.UTC(2026, 9, 15, 13, id)).toISOString(),
            payload   : {}
        }),
        a2aOf    = ({key = 'key-1', scope = 'all', policy = 'team', clamped = false, offset = 50} = {}) => ({
            observation : {admissionKey: key, clamped, planeId: 'plane-a', policy, scope, viewer: '@tobiu'},
            page        : {},
            continuation: offset === null ? null : {slots: ['a2a'], offset}
        }),
        answer   = (events, a2a, state = 'wired') => ({capability: {state, reason: state === 'wired' ? null : 'a2a: refused'}, counts: [], events, ...(a2a ? {a2a} : {})});

    let sequence = 0,
        store;

    const
        makeHost = ({mode = 'all', profileId = 'profile-a'} = {}) => {
            const
                data   = {activityMode: mode, activityObservation: {clamped: false, policy: null, reason: null, state: null}, streamHistoryExhausted: false},
                stream = {acceptHistory() {}, adapterState: 'cold', messageRead: null};

            store = Neo.create(FleetActivityEvents, {id: `fleet-activity-observer-test-${++sequence}`});

            return Object.assign(Object.create(FleetCockpitController.prototype), {
                activityAdmissionKey         : null,
                activityContinuation         : null,
                activityHistoryFlight        : null,
                activityHistoryGeneration    : 0,
                activityHistoryStalledAt     : null,
                activityMessageReadGeneration: 0,
                activityProfileId            : null,
                activityWired                : false,
                component                    : {
                    getStateProvider   : () => ({getData: key => data[key], getStore: () => store, setData: values => Object.assign(data, values)}),
                    livenessReadTimeout: 1000
                },
                data,
                getReference        : name => name === 'activity-stream' ? stream : null,
                isDestroyed         : false,
                profileId,
                publishConnection   : (surface, {data: values} = {}) => values && Object.assign(data, values),
                stream,
                streamReadGeneration: 0,
                streamReadInFlight  : 0
            })
        },
        reads      = [],
        wireBridge = (verbs, profileId = 'profile-a') => {
            (globalThis.AgentOS ??= {}).fleet = {registryBridge: {profileId, ...verbs}}
        },
        // a bridge whose every activity read is recorded and answered by `respond(params)`
        serve      = (respond, extra = {}) => wireBridge({
            fleetActivity: async params => { reads.push(params); return respond(params) },
            ...extra
        }),
        heldIds    = () => store.items.map(record => record.eventId);

    test.afterEach(() => {
        delete globalThis.AgentOS?.fleet;
        store?.destroy();
        store        = null;
        reads.length = 0
    });

    test('an observer mode sends its selector, and its first answer replaces the feed under the admission it names', async () => {
        const host = makeHost();

        serve(() => answer([mailbox(2), mailbox(1), prEvent(1)], a2aOf()));
        await host.loadActivity();

        expect(reads).toEqual([{observer: ALL}]);
        expect(heldIds()).toEqual(['pr:1', 'a2a:MESSAGE:2', 'a2a:MESSAGE:1']);
        expect(host.activityAdmissionKey).toBe('key-1');
        expect(host.activityContinuation).toEqual({slots: ['a2a'], offset: 50});
        expect(host.data.activityObservation).toEqual({clamped: false, policy: 'team', reason: null, state: 'admitted'});
        expect(host.data.streamHistoryExhausted).toBe(false);
        expect(host.data.streamAdapterState).toBe('live')
    });

    test('the mailbox mode reads as it always has: no selector, no admission, no observation', async () => {
        const host = makeHost({mode: 'mailbox'});

        serve(() => answer([mailbox(1)]));
        await host.loadActivity();

        expect(reads).toEqual([undefined]);
        expect(heldIds()).toEqual(['a2a:MESSAGE:1']);
        expect(host.activityAdmissionKey).toBeNull();
        expect(host.data.activityObservation.state).toBeNull()
    });

    test('an answer under another admission empties the feed before its page lands; the same admission merges', async () => {
        const host = makeHost();
        let next = answer([mailbox(1)], a2aOf());

        serve(() => next);
        await host.loadActivity();

        next = answer([mailbox(2)], a2aOf());
        await host.loadActivity();
        expect(heldIds(), 'the same admission merges').toEqual(['a2a:MESSAGE:2', 'a2a:MESSAGE:1']);

        const generation = host.activityHistoryGeneration, loads = [];

        store.on('load', () => loads.push(store.count));
        next = answer([mailbox(9)], a2aOf({key: 'key-2', offset: 0}));
        await host.loadActivity();

        expect(heldIds(), 'another admission replaces').toEqual(['a2a:MESSAGE:9']);
        expect(loads, 'in one transaction, never emptied first').toEqual([1]);
        expect(host.activityAdmissionKey).toBe('key-2');
        expect(host.activityContinuation, 'the continuation is the new admission\'s').toEqual({slots: ['a2a'], offset: 0});
        expect(host.activityHistoryGeneration, 'an older page in flight lands nowhere').toBeGreaterThan(generation)
    });

    test('an A2A half that admitted nothing empties the expansion, keeps the other sources\' facts, and reads unavailable', async () => {
        const host = makeHost();
        let next = answer([mailbox(1), prEvent(1)], a2aOf());

        serve(() => next);
        await host.loadActivity();

        next = {
            capability: {state: 'degraded', reason: 'a2a: Message is absent or not admitted to this observer scope'},
            counts    : [{source: 'memory-core:mailbox', scope: 'total', value: 3, complete: true}, {source: 'github-workflow:pull-requests', scope: 'total', value: 1, complete: true}],
            events    : [prEvent(2), {eventId: 'a2a:source-degraded', type: 'source-degraded', source: 'memory-core:mailbox'}]
        };
        await host.loadActivity();

        expect(heldIds()).toEqual(['pr:2']);
        expect(host.activityAdmissionKey).toBeNull();
        expect(host.data.activityCounts.map(row => row.source)).toEqual(['github-workflow:pull-requests']);
        expect(host.data.activityObservation).toEqual({clamped: false, policy: null, reason: 'a2a: Message is absent or not admitted to this observer scope', state: 'unavailable'});
        expect(host.data.streamAdapterState).toBe('partial')
    });

    test('a degraded observer answer with no usable fact still empties the expansion instead of staling it', async () => {
        const host = makeHost();
        let next = answer([mailbox(1)], a2aOf());

        serve(() => next);
        await host.loadActivity();

        next = answer([{eventId: 'a2a:source-degraded', type: 'source-degraded', source: 'memory-core:mailbox'}], null, 'degraded');
        await host.loadActivity();

        expect(heldIds()).toEqual([]);
        expect(host.data.activityObservation.state).toBe('unavailable')
    });

    test('a plane that answers no observer read lands none of its mailbox rows under the observer\'s name', async () => {
        const host = makeHost({mode: 'involves-me'});

        serve(() => answer([mailbox(1), prEvent(1)]));
        await host.loadActivity();

        expect(reads).toEqual([{observer: INVOLVES}]);
        expect(heldIds()).toEqual(['pr:1']);
        expect(host.data.activityObservation).toEqual({clamped: false, policy: null, reason: 'the plane answered no observer read', state: 'unavailable'})
    });

    test('an observation of another scope is no admission of this one', async () => {
        const host = makeHost({mode: 'involves-me'});

        serve(() => answer([mailbox(1)], a2aOf({scope: 'all'})));
        await host.loadActivity();

        expect(heldIds()).toEqual([]);
        expect(host.data.activityObservation.state).toBe('unavailable')
    });

    test('a narrower sharing policy is published with the clamp, never as a team read', async () => {
        const host = makeHost();

        serve(() => answer([mailbox(1)], a2aOf({clamped: true, policy: 'private'})));
        await host.loadActivity();

        expect(host.data.activityObservation).toEqual({clamped: true, policy: 'private', reason: null, state: 'admitted'})
    });

    test('older pages follow the held continuation, advance it, and stop where the population ends', async () => {
        const host = makeHost();

        serve(params => !params.slots
            ? answer([mailbox(60, 59)], a2aOf())
            : params.offset === 50
                ? answer([mailbox(50, 50), prEvent(3)], a2aOf({offset: 100}))
                : answer([mailbox(30, 30)], a2aOf({offset: null})));
        await host.loadActivity();

        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 1});
        expect(reads[1]).toEqual({limit: 50, observer: ALL, offset: 50, slots: ['a2a']});
        expect(host.activityContinuation).toEqual({slots: ['a2a'], offset: 100});

        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 1});
        expect(reads[2].offset).toBe(100);
        expect(host.data.streamHistoryExhausted).toBe(true);

        await expect(host.loadActivityHistory()).resolves.toBeNull();
        expect(reads, 'an ended population is not asked again').toHaveLength(3);
        // the PR row an A2A page carried never lands as history
        expect(heldIds()).toEqual(['a2a:MESSAGE:60', 'a2a:MESSAGE:50', 'a2a:MESSAGE:30'])
    });

    test('an older page under another admission never lands, and leaves the continuation where it was', async () => {
        const host = makeHost();

        serve(params => !params.slots ? answer([mailbox(60, 59)], a2aOf()) : answer([mailbox(50, 50)], a2aOf({key: 'key-2', offset: 100})));
        await host.loadActivity();

        await expect(host.loadActivityHistory()).resolves.toBeNull();
        expect(heldIds()).toEqual(['a2a:MESSAGE:60']);
        expect(host.activityContinuation).toEqual({slots: ['a2a'], offset: 50})
    });

    test('an observer page that adds nothing never stalls the next one: its continuation still moved', async () => {
        const host = makeHost();

        serve(params => !params.slots
            ? answer([mailbox(60, 59), mailbox(50, 50)], a2aOf())
            : params.offset === 50 ? answer([mailbox(50, 50)], a2aOf({offset: 100})) : answer([mailbox(30, 30)], a2aOf({offset: null})));
        await host.loadActivity();

        await expect(host.loadActivityHistory(), 'new arrivals shifted the held row into the page').resolves.toMatchObject({added: 0});
        await expect(host.loadActivityHistory()).resolves.toMatchObject({added: 1});
        expect(reads.map(read => read?.offset)).toEqual([undefined, 50, 100])
    });

    test('an older observer page in flight when the feed returns to the mailbox lands nowhere', async () => {
        const host = makeHost();
        let release;

        serve(params => {
            if (params?.slots) {
                return new Promise(resolve => { release = () => resolve(answer([mailbox(50, 50)], a2aOf({offset: 100}))) })
            }

            return params ? answer([mailbox(60, 59)], a2aOf()) : answer([mailbox(7)])
        });
        await host.loadActivity();

        const late = host.loadActivityHistory();

        await Promise.resolve();
        host.onActivityModeChange({mode: 'mailbox'});
        await expect.poll(() => heldIds()).toEqual(['a2a:MESSAGE:7']);

        release();
        await expect(late).resolves.toBeNull();
        expect(heldIds(), 'the mailbox feed holds no observer row').toEqual(['a2a:MESSAGE:7'])
    });

    test('an older mailbox page in flight when the feed switches to an observer mode lands nowhere', async () => {
        const host = makeHost({mode: 'mailbox'});
        let release;

        serve(params => {
            if (params?.slots) {
                return new Promise(resolve => { release = () => resolve(answer([mailbox(50, 50)])) })
            }

            return params ? answer([mailbox(9)], a2aOf()) : answer([mailbox(60, 59)])
        });
        await host.loadActivity();

        const late = host.loadActivityHistory();

        await Promise.resolve();
        host.onActivityModeChange({mode: 'all'});
        await expect.poll(() => heldIds()).toEqual(['a2a:MESSAGE:9']);

        release();
        await expect(late).resolves.toBeNull();
        expect(heldIds(), 'the observer feed holds no mailbox row').toEqual(['a2a:MESSAGE:9'])
    });

    test('a first answer that ends its population pages nothing', async () => {
        const host = makeHost();

        serve(() => answer([mailbox(1)], a2aOf({offset: null})));
        await host.loadActivity();

        expect(host.data.streamHistoryExhausted).toBe(true);
        await expect(host.loadActivityHistory()).resolves.toBeNull();
        expect(reads).toHaveLength(1)
    });

    test('switching the mode empties the feed, names the new mode, and reads it at once; the current mode is no switch', async () => {
        const host = makeHost();

        serve(params => params.observer.scope === 'all' ? answer([mailbox(1)], a2aOf()) : answer([mailbox(7)], a2aOf({key: 'key-mine', scope: 'involves-me'})));
        await host.loadActivity();

        expect(host.onActivityModeChange({mode: 'all'}), 'the mode in view is no switch').toBe(false);
        expect(host.onActivityModeChange({mode: 'everything'}), 'an unknown mode is refused').toBe(false);
        expect(reads).toHaveLength(1);

        expect(host.onActivityModeChange({mode: 'involves-me'})).toBe(true);
        expect(host.data.activityMode).toBe('involves-me');
        await expect.poll(() => heldIds()).toEqual(['a2a:MESSAGE:7']);
        expect(reads[1]).toEqual({observer: INVOLVES});
        expect(host.activityAdmissionKey).toBe('key-mine')
    });

    test('a switch retires the feed and leaves its rows for the new mode\'s answer to replace in one transaction', async () => {
        const host = makeHost();
        let release;

        serve(params => params.observer.scope === 'all'
            ? answer([mailbox(1), mailbox(2)], a2aOf())
            : new Promise(resolve => { release = () => resolve(answer([mailbox(7)], a2aOf({key: 'key-mine', scope: 'involves-me'}))) }));
        await host.loadActivity();

        const loads = [];

        store.on('load', () => loads.push(store.count));
        host.onActivityModeChange({mode: 'involves-me'});

        // the store keeps the rows out of sight: a cold stream shows none
        expect(heldIds()).toEqual(['a2a:MESSAGE:2', 'a2a:MESSAGE:1']);
        expect(host.data.streamAdapterState).toBe('cold');
        expect(host.stream.adapterState).toBe('cold');
        expect(host.activityWired).toBe(false);

        await expect.poll(() => release).toBeTruthy();
        release();
        await expect.poll(() => heldIds()).toEqual(['a2a:MESSAGE:7']);
        // an empty-then-refilled store keeps stale pooled rows in the DOM; one replace leaves none
        expect(loads, 'one load: the replace').toEqual([1])
    });

    test('an older page in flight when the mode switched lands nowhere', async () => {
        const host = makeHost();
        let release;

        serve(params => {
            if (params.slots) {
                return new Promise(resolve => { release = () => resolve(answer([mailbox(50, 50)], a2aOf({offset: 100}))) })
            }

            return params.observer.scope === 'all' ? answer([mailbox(60, 59)], a2aOf()) : answer([mailbox(7)], a2aOf({key: 'key-mine', scope: 'involves-me'}))
        });
        await host.loadActivity();

        const late = host.loadActivityHistory();

        // the bridge is asked one microtask later
        await Promise.resolve();
        host.onActivityModeChange({mode: 'involves-me'});
        await expect.poll(() => heldIds()).toEqual(['a2a:MESSAGE:7']);

        release();
        await expect(late).resolves.toBeNull();
        expect(heldIds()).toEqual(['a2a:MESSAGE:7']);
        expect(host.activityContinuation).toEqual({slots: ['a2a'], offset: 50})
    });

    test.describe('the message detail', () => {
        const body = (messageId, key = 'key-1') => ({body: 'the words', messageId, observation: {admissionKey: key}, subject: 'message 1'});

        test('an admitted message opens read-only under the held admission', async () => {
            const host = makeHost(), asked = [], written = [];

            serve(() => answer([mailbox(1)], a2aOf()), {fleetOwnMessage: async params => { asked.push(params); return body(params.messageId) }});
            await host.loadActivity();

            Object.defineProperty(host.stream, 'messageRead', {set: value => written.push(value)});
            await host.onActivityMessageOpen({messageId: 'MESSAGE:1'});

            expect(asked).toEqual([{messageId: 'MESSAGE:1', observer: ALL}]);
            expect(written.map(read => read.state)).toEqual(['loading', 'ok']);
            expect(written[1].message.body).toBe('the words')
        });

        test('an answer under another admission never shows its body, and the feed reads again', async () => {
            const host = makeHost(), written = [];

            serve(() => answer([mailbox(1)], a2aOf()), {fleetOwnMessage: async params => body(params.messageId, 'key-2')});
            await host.loadActivity();

            Object.defineProperty(host.stream, 'messageRead', {set: value => written.push(value)});
            await host.onActivityMessageOpen({messageId: 'MESSAGE:1'});

            expect(written.at(-1)).toEqual({messageId: 'MESSAGE:1', reason: 'the admission changed while the message was read', state: 'refused'});
            await expect.poll(() => reads.length, {message: 'the live read that empties the old rows follows'}).toBe(2)
        });

        test('a refusal shows its reason and the Brain\'s code', async () => {
            const host = makeHost(), written = [];

            serve(() => answer([mailbox(1)], a2aOf()), {fleetOwnMessage: async () => {
                throw Object.assign(new Error('Message is absent or not admitted to this observer scope'), {code: 'MAILBOX_OBSERVER_NOT_ADMITTED'})
            }});
            await host.loadActivity();

            Object.defineProperty(host.stream, 'messageRead', {set: value => written.push(value)});
            await host.onActivityMessageOpen({messageId: 'MESSAGE:1'});

            expect(written.at(-1)).toEqual({code: 'MAILBOX_OBSERVER_NOT_ADMITTED', messageId: 'MESSAGE:1', reason: 'Message is absent or not admitted to this observer scope', state: 'refused'})
        });

        test('an answer that settles after the feed\'s authority changed lands nowhere', async () => {
            const host = makeHost(), written = [];
            let release;

            serve(params => params.observer.scope === 'all' ? answer([mailbox(1)], a2aOf()) : answer([mailbox(7)], a2aOf({key: 'key-mine', scope: 'involves-me'})), {
                fleetOwnMessage: params => new Promise(resolve => { release = () => resolve(body(params.messageId)) })
            });
            await host.loadActivity();

            Object.defineProperty(host.stream, 'messageRead', {set: value => written.push(value)});

            const late = host.onActivityMessageOpen({messageId: 'MESSAGE:1'});

            host.onActivityModeChange({mode: 'involves-me'});
            release();
            await late;

            expect(written.map(read => read.state)).toEqual(['loading'])
        });

        test('the mailbox mode opens nothing', async () => {
            const host = makeHost({mode: 'mailbox'}), asked = [];

            serve(() => answer([mailbox(1)]), {fleetOwnMessage: async params => { asked.push(params); return body(params.messageId) }});
            await host.loadActivity();
            await host.onActivityMessageOpen({messageId: 'MESSAGE:1'});

            expect(asked).toEqual([]);
            expect(host.stream.messageRead).toBeNull()
        })
    })
});
