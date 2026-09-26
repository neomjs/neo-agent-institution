import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitActivityFeedTest'
    }
});

import {test, expect}                                 from '@playwright/test';
import Neo                                            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                                      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                                                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import {makeActivityStoreHarness, makeControllerFake} from './cockpitFakes.mjs';

/**
 * Covers the fail-closed matrix for `FleetCockpit.loadActivity()` — the app-side consumption of the
 * read-observe `fleetActivity` bridge verb.
 *
 * `loadActivity`'s unit is its ROUTING decision: given the bridge's honest capability state, which
 * `adapterState` (+ event order) does it apply to the stream? The stream is a collaborator, so it is
 * mocked with a spy that records what `loadActivity` sets — this pins the routing precisely and in
 * isolation. That the REAL `ActivityStream` renders each `adapterState` (cold / live / stale) is
 * covered by `activityStream.spec.mjs`; here we prove `loadActivity` chooses the right one.
 */
test.describe('Fleet cockpit — activity feed binding (loadActivity, #14868)', () => {
    let FleetCockpitController;

    // scope the mock to the `fleet` subkey ONLY: `globalThis.AgentOS` is the app's Neo NAMESPACE
    // root — replacing or deleting it wipes every `AgentOS.*` class registration for all later
    // spec files in the shared worker (order-dependent cross-file bleed).
    const clearBridge = () => { delete globalThis.AgentOS?.fleet };

    // a spy stream: `loadActivity` either assigns `adapterState` directly (stale) or calls `set({...})`
    // (live); both land on the same object so the resulting state is assertable.
    const makeStream = () => ({adapterState: 'cold', set(config) { Object.assign(this, config) }});

    /**
     * @param {Object|null} bridge The stubbed `registryBridge` (or null for "no bridge").
     * @returns {Promise<{stream: Object, cockpit: Object}>} the spy stream AND the owner, after
     *     `loadActivity` routed to them.
     *
     * The owner is returned, not just the stream, because the routing decision has TWO outputs: what
     * the stream is told, and what the OWNER retains (`streamAdapterState`, `degradedReason` — the
     * banner's inputs). Handing back only the stream made the owner's half untestable, which is
     * exactly how the not-wired branch shipped without a witness.
     */
    const routeLoadActivity = async bridge => {
        bridge ? ((globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge}) : clearBridge();

        const stream  = makeStream(),
              harness = makeActivityStoreHarness(),
              // all state writes land on the provider (the banner derives itself there via
              // formula); the controller fake inherits the real loss edge + redaction from the
              // prototype and pins only the view seams.
              controller = makeControllerFake(FleetCockpitController, {
                  ...harness,
                  component   : {getStateProvider: () => harness.activityProvider, livenessReadTimeout: 4000},
                  getReference: reference => reference === 'activity-stream' ? stream : null
              });

        await controller.loadActivity();

        return {stream, controller, store: harness.activityStore, provider: harness.activityProvider}
    };

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    test.afterEach(() => clearBridge());

    test('no bridge → stays cold (fail-closed, no crash)', async () => {
        const {stream, provider} = await routeLoadActivity(null);

        expect(stream.adapterState).toBe('cold');
        // SILENCE: the owner learned nothing, so it retains no cause. This is what lets the banner
        // fall back to "server offline" honestly — it is the only state that implies one.
        expect(provider.data.streamDegradedReason ?? null).toBe(null)
    });

    test('a bridge without fleetActivity → stays cold', async () => {
        const {stream, provider} = await routeLoadActivity({});

        expect(stream.adapterState).toBe('cold');
        expect(provider.data.streamDegradedReason ?? null).toBe(null)
    });

    test('not-wired capability → stays cold AND retains the producer’s reason', async () => {
        // The producer ANSWERED. No events land — the stream really has nothing, so its own state
        // is honestly 'cold' — but an answer is not silence, and the retained reason is
        // the ONLY thing that separates "we never reached the server" from "it answered: my source
        // is unconfigured". Without it the banner told the operator to start a running server.
        //
        // This is the verbatim string the live devFleetServer returns, not one I invented to agree
        // with myself: `{state:'not-wired', reason:'fleet activity source not wired'}`.
        const {stream, provider} = await routeLoadActivity({fleetActivity: async () => ({
            capability: {state: 'not-wired', reason: 'fleet activity source not wired'},
            events    : []
        })});

        expect(stream.adapterState).toBe('cold');
        expect(provider.data.streamAdapterState).toBe('cold');
        expect(provider.data.streamDegradedReason).toBe('fleet activity source not wired')
    });

    test('not-wired WITHOUT a reason retains none — the producer said nothing to relay', async () => {
        // The guard against over-correcting: a bare not-wired teaches the owner no cause, so it must
        // not manufacture one. Falls back to the generic offline copy, which is correct here.
        const {provider} = await routeLoadActivity({fleetActivity: async () => ({capability: {state: 'not-wired'}, events: []})});

        expect(provider.data.streamDegradedReason ?? null).toBe(null)
    });

    test('degraded capability → the stale banner', async () => {
        const {stream} = await routeLoadActivity({fleetActivity: async () => ({capability: {state: 'degraded'}, events: []})});

        expect(stream.adapterState).toBe('stale')
    });

    test('a thrown source → fail-closed, stays cold (never falsely goes live or stale)', async () => {
        const {stream} = await routeLoadActivity({fleetActivity: async () => { throw new Error('bridge boom') }});
        expect(stream.adapterState).toBe('cold')
    });

    test('wired + events → live, admitting producer order into the provider Store', async () => {
        const {stream, store, provider} = await routeLoadActivity({fleetActivity: async () => ({
            capability: {state: 'wired'},
            counts    : [{source: 'memory-core:mailbox', scope: 'total', value: 2, complete: true, capturedAt: '2026-07-04T12:00:00.000Z'}],
            events    : [ // newest-first, as the adapter sorts
                {eventId: 'a2a:newest', type: 'a2a-activity', occurredAt: '2026-07-04T12:00:00.000Z', payload: {subject: 'newest'}},
                {eventId: 'a2a:older',  type: 'a2a-activity', occurredAt: '2026-07-04T11:00:00.000Z', payload: {subject: 'older'}}
            ]
        })});
        expect(stream.adapterState).toBe('live');
        expect(store.pages).toEqual([{
            events: [
                {eventId: 'a2a:newest', type: 'a2a-activity', occurredAt: '2026-07-04T12:00:00.000Z', payload: {subject: 'newest'}},
                {eventId: 'a2a:older',  type: 'a2a-activity', occurredAt: '2026-07-04T11:00:00.000Z', payload: {subject: 'older'}}
            ],
            options: {replace: true}
        }]);
        expect(provider.data.activityCounts).toHaveLength(1)
    });

    test('wired + empty → live (streaming but quiet), never cold — a wired source is live', async () => {
        const {stream, provider, store} = await routeLoadActivity({fleetActivity: async () => ({capability: {state: 'wired'}, events: []})});

        expect(stream.adapterState).toBe('live');
        expect(store.pages).toEqual([{events: [], options: {replace: true}}]);
        // recovery clears the retained cause — a stale reason on a live feed would outlive its truth
        expect(provider.data.streamDegradedReason ?? null).toBe(null)
    });

    test.describe('target binding — retained events belong to the profile that answered (#181)', () => {
        // one host, two profiles: `bridge` resolves fresh per call, so an instance switch is the next
        // read finding a registryBridge with another profileId (what the custody path installs)
        const installBridge = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };
        const pageOf        = (...ids) => ids.map(eventId => ({eventId, type: 'a2a-activity', occurredAt: '2026-09-23T08:00:00.000Z', payload: {subject: eventId}}));
        const counts        = [{source: 'memory-core:mailbox', scope: 'total', value: 2, complete: true, capturedAt: '2026-09-23T08:00:00.000Z'}];
        const wired         = (profileId, events) => ({profileId, fleetActivity: async () => ({capability: {state: 'wired'}, counts, events})});
        const refused       = profileId => ({profileId, fleetActivity: async () => {
            throw Object.assign(new Error('connection refused'), {fleetConnectionState: 'refused'})
        }});

        // profile A's page admitted as the first live snapshot (replace), the feed bound to 'a'
        const admittedA = async () => {
            const host = await routeLoadActivity(wired('a', pageOf('a:1')));

            expect(host.store.pages).toEqual([{events: pageOf('a:1'), options: {replace: true}}]);
            expect(host.controller.activityProfileId).toBe('a');
            expect(host.provider.data.activityCounts).toEqual(counts);

            return host
        };

        test('a reachable new profile is admitted as a FIRST snapshot — the previous profile\'s events never merge in', async () => {
            const host = await admittedA();

            installBridge(wired('b', pageOf('b:1')));
            await host.controller.loadActivity();

            expect(host.store.cleared).toBe(1);
            expect(host.store.pages[1]).toEqual({events: pageOf('b:1'), options: {replace: true}});
            expect(host.controller.activityProfileId).toBe('b');
            expect(host.stream.adapterState).toBe('live')
        });

        test('a switch to a profile whose read fails retires the previous events — never `stale` over another instance', async () => {
            const host = await admittedA();

            installBridge(refused('b'));
            await host.controller.loadActivity();

            expect(host.store.cleared).toBe(1);
            expect(host.controller.activityWired).toBe(false);
            expect(host.controller.activityProfileId).toBeNull();
            // B's failure is B's own cold truth: cold, no cause claimed, A's counts gone, the
            // typed observation names the failure
            expect(host.provider.data.streamAdapterState).toBe('cold');
            expect(host.provider.data.streamDegradedReason).toBeNull();
            expect(host.provider.data.activityCounts).toEqual([]);
            expect(host.stream.adapterState).toBe('cold');
            expect(host.provider.data.streamConnection).toEqual({state: 'refused', reason: 'connection refused'})
        });

        test('control: the same profile keeps its semantics — a later page merges, a transient failure keeps last-known rows as `stale`', async () => {
            const merged = await admittedA();

            installBridge(wired('a', pageOf('a:2')));
            await merged.controller.loadActivity();
            expect(merged.store.cleared).toBe(0);
            expect(merged.store.pages[1].options).toEqual({replace: false});

            const failed = await admittedA();

            installBridge(refused('a'));
            await failed.controller.loadActivity();
            expect(failed.store.cleared).toBe(0);
            expect(failed.controller.activityWired).toBe(true);
            expect(failed.provider.data.streamAdapterState).toBe('stale');
            expect(failed.stream.adapterState).toBe('stale')
        })
    })
});
