import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitRosterStoreTest'
    }
});

import {test, expect}                                                     from '@playwright/test';
import {readFileSync}                                                     from 'fs';
import Neo                                                                from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                                                          from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                                                                         '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import {makeControllerFake, makeProviderFake, seedPath, wireDetailRecord} from './cockpitFakes.mjs';

/**
 * Covers the Store-backed roster data path: the shared `FleetRoster` singleton contract
 * and the fail-closed routing matrix for `FleetCockpit.loadRoster()` — the app-side consumption of
 * the read-observe `fleetRoster` bridge verb. Like `loadActivity`, the unit is the ROUTING decision;
 * the grid + store are collaborators, mocked with spies that record what `loadRoster` does to them.
 */
test.describe('Fleet cockpit — Store-backed roster (loadRoster)', () => {
    let FleetAgent, FleetCockpit, FleetCockpitController, FleetRoster;

    // reason: null on every fact — the fixture doubles as DTO input AND expected normalized
    // output, and normalization now carries the producer's retained cause (null when absent)
    const liveSources = (runtimeConfidence = 'observed') => ({
        roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed', reason: null},
        repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed', reason: null},
        runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: runtimeConfidence, reason: null}
    });

    // scope the mock to the `fleet` subkey ONLY: `globalThis.AgentOS` is the app's Neo NAMESPACE
    // root — replacing or deleting it wipes every `AgentOS.*` class registration for all later
    // spec files in the shared worker (order-dependent cross-file bleed).
    const clearBridge = () => { delete globalThis.AgentOS?.fleet };

    // a spy store + grid: `loadRoster` clears/adds on the first snapshot, reconciles after (upsert +
    // remove-absent), flips adapterState. `items` feeds the reconciliation's absence sweep.
    const makeGrid = (known = {}, items = []) => {
        const store = {
            added  : [],
            cleared: 0,
            removed: [],
            items,
            clear() { this.cleared++ },
            add(rows) { this.added.push(...[].concat(rows)) },
            get(id) { return known[id] ?? null },
            remove(id) { this.removed.push(id) }
        };

        return {adapterState: 'sample', store}
    };

    // the controller drives; the slim view fake carries only what loadRoster READS from its
    // component: the resident-pane accessors (unmaterialized → null, the same silence contract
    // as getReference), the provider seat and the source-mode config
    const makeRosterHost = (grid, {rosterWired = false, rosterSourceMode = 'sample'} = {}) => {
        const provider = makeProviderFake(),
              view     = {
                  detailRecord          : null,
                  getCatchUpPane        : () => null,
                  getMemoriesPane       : () => null,
                  getOperatorMailboxPane: () => null,
                  getStateProvider      : () => provider,
                  livenessReadTimeout   : 4000,
                  rosterSourceMode
              },
              controller = makeControllerFake(FleetCockpitController, {
                  component              : view,
                  getReference           : reference => reference === 'fleet-grid' ? grid : null,
                  lastLiveRows           : null,
                  // the provider-owned roster authority: in this fixture the grid's bound store IS
                  // the provider store, so the write path and the selection re-seat read one truth
                  resolveFleetRosterStore: () => grid?.store ?? null,
                  rosterWired
              });

        return {controller, grid, provider, view}
    };

    const routeLoadRoster = async (bridge, {known, items, rosterSourceMode, rosterWired} = {}) => {
        bridge ? ((globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge}) : clearBridge();

        const host = makeRosterHost(makeGrid(known, items), {rosterSourceMode, rosterWired});

        await host.controller.loadRoster();

        return host
    };

    test.beforeAll(async () => {
        FleetAgent            = (await import('../../../../../../../../apps/agentos/model/FleetAgent.mjs')).default;
        FleetCockpit          = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs')).default;
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        FleetRoster           = (await import('../../../../../../../../apps/agentos/store/FleetRoster.mjs')).default
    });

    test.afterEach(() => clearBridge());

    test('FleetRoster is a provider-hosted Store CLASS — JSON-fetched seed, durable agentId keying, honest sample', () => {
        // no singleton: the cockpit provider hosts + autoLoads the ONE shared instance; the class
        // carries the url seed (the Portal.store.* house pattern)
        expect(FleetRoster.isClass).toBe(true);
        expect(FleetRoster.config.singleton).toBeFalsy();
        expect(FleetRoster.config.url).toBe('../../apps/agentos/resources/data/fleetRoster.json');

        // the JSON sample seed: the eleven REAL maintainer identities, registry-derived — no invented agents
        const seed = JSON.parse(readFileSync(seedPath, 'utf8')).data;
        expect(seed).toHaveLength(11);
        const knownHandles = ['neo-fable', 'neo-fable-clio', 'neo-gemini-pro', 'neo-gpt', 'neo-gpt-emmy', 'neo-kimi-iris', 'neo-kimi-phoebe', 'neo-opus-ada', 'neo-opus-grace', 'neo-opus-vega', 'neo-preview'];
        expect(seed.map(row => row.agentId).sort()).toEqual(knownHandles);

        // engine tags pinned to the registry designations at seed time — this front-door surface
        // must not silently reintroduce a stale model designation
        const engineTags = Object.fromEntries(seed.map(row => [row.agentId, row.engineTag]));
        expect(engineTags).toEqual({
            'neo-fable'      : 'fable-5',
            'neo-fable-clio' : 'fable-5',
            'neo-gemini-pro' : '3.1-pro',
            'neo-gpt'        : 'gpt-5.6-sol',
            'neo-gpt-emmy'   : 'gpt-5.6-sol',
            'neo-kimi-iris'  : 'kimi-k3',
            'neo-kimi-phoebe': 'kimi-k3',
            'neo-opus-ada'   : 'opus-5',
            'neo-opus-grace' : 'opus-5',
            // rotating seat (weekly Fable/Opus) -> honest absence, never a half-week-stale literal
            'neo-opus-vega'  : null,
            // guest seat, provisioned ahead of first boot -> engine facts are observation-owned and
            // land from the live harness, so a designation here would be a prediction
            'neo-preview'    : null
        });

        // seed rows hydrate as records exposing the model fields — incl the B4/C2 control seam defaults
        const store = Neo.create(FleetRoster, {data: seed});
        expect(store.getKeyProperty()).toBe('agentId');
        expect(store.model.className).toBe('AgentOS.model.FleetAgent');

        const euclid = store.get('neo-gpt');
        expect(euclid.isRecord).toBe(true);
        expect(euclid.displayName).toBe('Euclid');
        expect(euclid.pendingAction).toBeNull();
        expect(euclid.controlReason).toBeNull();

        store.destroy()
    });

    test('no bridge / no verb / malformed rows / thrown → keeps the last-known roster (fail-closed, no crash)', async () => {
        for (const bridge of [
            null,
            {},
            {fleetRoster: async () => ({rows: null})},
            {fleetRoster: async () => { throw new Error('bridge boom') }}
        ]) {
            const {grid, provider} = await routeLoadRoster(bridge);

            expect(grid.adapterState).toBe('sample');
            expect(provider.data.gridAdapterState).toBe('sample');
            expect(grid.store.cleared).toBe(0);
            expect(grid.store.added).toEqual([])
        }
    });

    test('the presence-capability envelope rides every admitted snapshot onto the grid chip config', async () => {
        // the operator falsifier this plumbs for: the plane's who_is_online read failed, every
        // card's band correctly vanished (absence of signal), and the unnamed absence read as
        // "no one is online" — a verdict. The producer's degraded envelope was already on the
        // wire; loadRoster previously dropped it at the destructure.
        const degraded = {
            source    : 'fleet:presenceState',
            state     : 'degraded',
            confidence: 'none',
            capturedAt: '2026-08-10T21:45:00.000Z',
            reason    : 'plane who_is_online read failed'
        };

        const {provider} = await routeLoadRoster({fleetRoster: async () => ({
            capabilities: {presence: degraded},
            rows        : [{id: 'a1', displayName: 'A1'}]
        })});

        expect(provider.data.presenceCapability).toEqual(degraded);

        // a recovered producer (or an assembler omitting the envelope) plumbs null — the chip
        // must claim nothing on the next poll
        const {provider: recovered} = await routeLoadRoster({fleetRoster: async () => ({
            rows: [{id: 'a1', displayName: 'A1'}]
        })});

        expect(recovered.data.presenceCapability).toBeNull()
    });

    test('a resolved EMPTY first snapshot preserves the zero-call sample until a source is selected', async () => {
        const {controller, grid, provider, view} = await routeLoadRoster({fleetRoster: async () => ({rows: []})});

        expect(FleetCockpit.config.rosterSourceMode).toBe('sample');
        expect(grid.store.cleared).toBe(0);   // a fresh empty registry cannot erase first-run truth
        expect(grid.store.added).toEqual([]);
        expect(grid.adapterState).toBe('sample');
        expect(view.rosterSourceMode).toBe('sample');
        expect(controller.rosterWired).toBe(false);
        // the ANSWERED-empty retention: the sample stays, but the cause is on record — the banner
        // names "connected · registry empty" instead of claiming "server offline" against a
        // transport that just replied
        expect(provider.data.gridDegradedReason).toBe('server connected · fleet registry empty — define agents to go live')
    });

    test('the answered-empty reason is RETRACTED on silence — the claim must not outlive the connection', async () => {
        // empty answer retains the cause…
        const {controller, provider} = await routeLoadRoster({fleetRoster: async () => ({rows: []})});

        expect(provider.data.gridDegradedReason).toContain('registry empty');

        // …then the transport dies: back on silence, the generic cold copy is the honest line
        // again, so the never-wired loss edge must drop the retained answered-state cause.
        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetRoster: async () => { throw new Error('transport lost') }}};
        await controller.loadRoster();

        expect(provider.data.gridAdapterState).toBe('sample');
        expect(provider.data.gridDegradedReason).toBe(null)
    });

    test('answered-empty → bridge ABSENT also retracts — absence is its own transition, not a thrown-call proxy', async () => {
        // the exact-head reviewer falsifier: an answered producer-specific cause survived the
        // no-bridge early return while the surface stayed sample — "server connected" rendering
        // against NO bridge at all. Absence must withdraw the answered cause exactly like a
        // thrown call does.
        const {controller, provider} = await routeLoadRoster({fleetRoster: async () => ({rows: []})});

        expect(provider.data.gridDegradedReason).toContain('registry empty');

        clearBridge();
        await controller.loadRoster();

        expect(provider.data.gridAdapterState).toBe('sample');
        expect(provider.data.gridDegradedReason).toBe(null)
    });

    test('answered-empty → verb ABSENT retracts too — a bridge without the verb is the same cold truth', async () => {
        const {controller, provider} = await routeLoadRoster({fleetRoster: async () => ({rows: []})});

        expect(provider.data.gridDegradedReason).toContain('registry empty');

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {}};
        await controller.loadRoster();

        expect(provider.data.gridAdapterState).toBe('sample');
        expect(provider.data.gridDegradedReason).toBe(null)
    });

    test('a resolved EMPTY first snapshot is authoritative after explicit source selection', async () => {
        const {controller, grid} = await routeLoadRoster(
            {fleetRoster: async () => ({rows: []})},
            {rosterSourceMode: 'selected'}
        );

        expect(grid.store.cleared).toBe(1);
        expect(grid.store.added).toEqual([]);
        expect(grid.adapterState).toBe('live');
        expect(controller.rosterWired).toBe(true)
    });

    test('density: openLaneCount survives the FIRST authoritative load — a stamped live count is stored, a missing stamp degrades to null, the sample number never outlives the replacement (#14598)', async () => {
        const {grid} = await routeLoadRoster({fleetRoster: async () => ({rows: [
            {id: 'neo-gpt',   openLaneCount: 23, lifecycle: {source: 'fleet:runtimeStatus', state: 'running', confidence: 'observed'}, sources: liveSources()},
            {id: 'neo-fable', lifecycle: {source: 'fleet:runtimeStatus', state: 'running', confidence: 'observed'}, sources: liveSources()}
        ]})});

        // the first authoritative snapshot REPLACES the sample seed (clear + add through the real
        // loadRoster) — the roster DTO owns the field, so what lands is the DTO's truth:
        expect(grid.store.cleared).toBe(1);
        // a live stamped count is stored (the badge renders it) …
        expect(grid.store.added.find(row => row.agentId === 'neo-gpt').openLaneCount).toBe(23);
        // … and an un-stamped row degrades to an explicit null (the badge hides) — the seeded
        // sample's number must never pose as live truth past this replacement
        expect(grid.store.added.find(row => row.agentId === 'neo-fable').openLaneCount).toBeNull()
    });

    test('mapRosterRow maps a DTO row onto the FleetAgent contract — durable id, identity facts, honest state vocabulary', () => {
        const mapped = FleetCockpitController.prototype.mapRosterRow({
            id         : 'neo-gpt',
            displayName: 'Neo GPT',
            avatarUrl  : 'https://github.com/neo-gpt.png?size=80',
            family     : 'gpt',
            engineTag  : 'GPT-5.6 Sol',
            lifecycle  : {source: 'fleet:runtimeStatus', state: 'running', confidence: 'observed'},
            sources    : liveSources()
        });

        expect(mapped).toEqual({
            agentId    : 'neo-gpt',
            authMode   : null,   // tri-state launch facts: absent on the row → honest null, never guessed
            avatarUrl  : 'https://github.com/neo-gpt.png?size=80',
            displayName: 'Neo GPT',
            engineTag  : 'GPT-5.6 Sol',
            family     : 'gpt',
            // the mailbox identity authority: absent on this row → honest null (unverifiable), never
            // silently substituted with the registry key, which is a different id space entirely
            githubUsername: null,
            lastActivityAt: null,
            launchable    : null,
            openLaneCount : null,   // roster-DTO-owned tri-state: un-stamped → honest null (no badge)
            // the authoritative participation fact: absent on the row → honest null, never guessed
            participationStatus: null,
            // the presence axis rides the same passthrough contract as wake/throttle below
            presence: null,
            sources : liveSources(),
            state   : 'ok',
            // the S2 telltale axes: absent on this row → honest null, never a synthesized 'unknown'.
            // The view must not manufacture the taxonomy's unknown — that value means the PRODUCER
            // looked and could not see, which is a different fact from "this row carried no axis".
            throttle: null,
            wake    : null
        });

        // laneLine is OMITTED, never nulled — a roster merge must not wipe what the activity producer writes
        expect(Object.hasOwn(mapped, 'laneLine')).toBe(false)
    });

    test('mapRosterRow passes the S2 axes through WHOLE — the view never re-derives a produced fact', () => {
        const
            wake     = {source: 'fleet:wakeState', state: 'suppressed', confidence: 'observed'},
            throttle = {source: 'fleet:throttleState', state: 'rate-limited', confidence: 'observed', reason: 'session cap'},
            mapped   = FleetCockpitController.prototype.mapRosterRow({
                id       : 'neo-gpt',
                lifecycle: {source: 'fleet:runtimeStatus', state: 'running', confidence: 'observed'},
                sources  : liveSources(),
                throttle,
                wake
            });

        // Whole objects, not re-derived states: `confidence` and `reason` are the producer's evidence
        // that it actually looked, and a view that rebuilt {state} alone would strip exactly the
        // fields that distinguish an observed fact from a guess.
        expect(mapped.wake).toEqual(wake);
        expect(mapped.throttle).toEqual(throttle);

        // The incident this answers had BOTH at once — orthogonal axes, never collapsed to one enum.
        expect(mapped.wake.state).toBe('suppressed');
        expect(mapped.throttle.state).toBe('rate-limited')
    });

    test('mapRosterRow state vocabulary — running is healthy only behind wired runtime provenance', () => {
        const map = (state, sources = liveSources(), confidence = 'observed') => FleetCockpitController.prototype.mapRosterRow({
            id       : 'x',
            lifecycle: {source: 'fleet:runtimeStatus', state, confidence},
            sources
        }).state;

        expect(map('running')).toBe('ok');
        expect(map('stopped')).toBe('off');
        expect(map('not-wired')).toBe('off');
        expect(map(undefined)).toBe('off');
        expect(map('running', {runtime: {source: 'fleet:runtimeStatus', state: 'not-wired', confidence: 'none'}})).toBe('off');
        expect(map('running', {runtime: {source: 'fleet:runtimeStatus', state: 'missing', confidence: 'none'}})).toBe('off');
        expect(map('running', {})).toBe('off');
        expect(map('running', liveSources('inferred'), 'observed')).toBe('off');

        const
            contradictory = FleetCockpitController.prototype.mapRosterRow({
                id       : 'x',
                lifecycle: {source: 'fleet:runtimeStatus', state: 'running', confidence: 'inferred'},
                sources  : liveSources()
            }),
            stopped       = FleetCockpitController.prototype.mapRosterRow({
                id       : 'x',
                lifecycle: {source: 'fleet:runtimeStatus', state: 'stopped', confidence: 'observed'},
                sources  : liveSources()
            });

        // a lifecycle/runtime confidence contradiction is rejected evidence — the downgrade reads
        // `invalid` with the contradiction named, never a silently calm not-wired
        expect(contradictory).toMatchObject({
            state  : 'off',
            sources: {runtime: {source: 'fleet:runtimeStatus', state: 'invalid', confidence: 'none', reason: 'lifecycle and runtime facts contradict'}}
        });
        expect(stopped).toMatchObject({
            state  : 'off',
            sources: {runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}}
        });

        // un-enriched identity facts flow as nulls (unclassified / tagless)
        const bare = FleetCockpitController.prototype.mapRosterRow({id: 'x'});
        expect(bare.family).toBeNull();
        expect(bare.engineTag).toBeNull()
    });

    test('the FIRST non-empty snapshot populates the Store (replaces the sample seed) and goes live — rows without a durable id are dropped', async () => {
        const {controller, grid, provider} = await routeLoadRoster({fleetRoster: async () => ({rows: [
            {id: 'vega', lifecycle: {source: 'fleet:runtimeStatus', state: 'running', confidence: 'observed'}, sources: liveSources()},
            {noId: true},
            {id: 'ada', lifecycle: {state: 'stopped'}}
        ]})});

        expect(grid.store.cleared).toBe(1);
        // rows arrive MAPPED onto the record contract — durable id → agentId, runtime → session state
        expect(grid.store.added.map(row => [row.agentId, row.state])).toEqual([['vega', 'ok'], ['ada', 'off']]);
        expect(grid.adapterState).toBe('live');
        expect(provider.data.gridAdapterState).toBe('live');
        expect(controller.rosterWired).toBe(true)
    });

    test('later snapshots RECONCILE — record.set per known agentId, add for a joiner, REMOVE for a resident absent from the snapshot (no ghost card)', async () => {
        const writes = [],
              vega   = {agentId: 'vega', set(row) { writes.push(row) }},
              ghost  = {agentId: 'removed-agent'};

        const {grid} = await routeLoadRoster({fleetRoster: async () => ({rows: [
            {id: 'vega', family: 'claude', lifecycle: {source: 'fleet:runtimeStatus', state: 'running', confidence: 'observed'}, sources: liveSources()},
            {id: 'joiner', lifecycle: {state: 'stopped'}}
        ]})}, {known: {vega}, items: [vega, ghost], rosterWired: true});

        // known resident → runtime status reconciled onto ITS record (the store re-renders just that card)
        expect(writes).toEqual([{
            agentId    : 'vega',
            authMode   : null,
            avatarUrl  : null,
            displayName: null,
            engineTag  : null,
            family     : 'claude',
            // the mailbox identity authority rides the reconcile like every other DTO fact —
            // absent on this row → honest null (unverifiable), never the registry key substituted
            githubUsername     : null,
            lastActivityAt     : null,
            launchable         : null,
            openLaneCount      : null,
            participationStatus: null,
            presence           : null,
            sources            : liveSources(),
            state              : 'ok',
            throttle           : null,
            wake               : null
        }]);

        // a resident ABSENT from the authoritative snapshot is removed — define → remove → no ghost card
        expect(grid.store.removed).toEqual(['removed-agent']);
        // new resident → joins the roster; the seed is never re-cleared on a merge
        expect(grid.store.added.map(row => row.agentId)).toEqual(['joiner']);
        expect(grid.store.cleared).toBe(0);
        expect(grid.adapterState).toBe('live')
    });

    // Source precedence: the provider-hosted store autoLoads the JSON sample while loadRoster races
    // the bridge. These run against a REAL isolated FleetRoster instance with the REAL load
    // listener attached (the store fires `load` for its own mutations, so the guard's recursion
    // behavior is only observable through the live listener path — a manual handler call is a
    // mock-hole).
    const makeLiveHost = (store, index, detail = null) => {
        const
            grid         = {adapterState: 'sample', store},
            provider     = makeProviderFake(),
            getReference = reference => reference === 'fleet-grid' ? grid : reference === 'agent-detail' ? detail : null,
            // the REAL View selection surface: applySelection, the phase-blind pane accessors and
            // the store-load guard run as production code over this fake — no stub drift
            view         = wireDetailRecord({
                detachedDetailPane    : null,
                detailRecord          : null,
                getAgentDetailPane    : FleetCockpit.prototype.getAgentDetailPane,
                getCatchUpPane        : () => null,
                getMemoriesPane       : FleetCockpit.prototype.getMemoriesPane,
                getOperatorMailboxPane: () => null,
                getReference,
                getStateProvider      : () => provider,
                id                    : `fake-fleet-cockpit-${index}`,
                livenessReadTimeout   : 4000,
                rosterSourceMode      : 'sample',
                selectionState        : {},
                setState(values) { Object.assign(this.selectionState, values) }
            }, FleetCockpit),
            controller = makeControllerFake(FleetCockpitController, {
                component              : view,
                getReference,
                lastLiveRows           : null,
                memoriesTarget         : null,
                reconcilingRoster      : false,
                // the provider-owned roster authority — the SAME store the grid fake binds, so the
                // write path, the listener latch and the selection re-seat all read one truth
                resolveFleetRosterStore: () => store
            });

        view.getController = () => controller;

        // Observable.fire's scope-liveness probe reads `scope.id` — a config GETTER on the real
        // prototype; the fake shadows it with an own data property (assignment would run the
        // setter into unconstructed private config state)
        Object.defineProperty(controller, 'id', {configurable: true, enumerable: true, value: `fake-cockpit-controller-${index}`, writable: true});

        store.on({load: controller.onRosterStoreLoad, scope: controller});

        return {controller, grid, provider, view}
    };

    test('a sample seed landing AFTER live truth cannot overwrite the roster (fail-closed toward live)', async () => {
        const store        = Neo.create(FleetRoster, {data: []}),
              {controller} = makeLiveHost(store, 1);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetRoster: async () => ({rows: [
            {id: 'ada',  family: 'claude', lifecycle: {state: 'running'}},
            {id: 'vega', family: 'claude', lifecycle: {state: 'stopped'}}
        ]})}};

        // the bridge wins the race: live truth lands first
        await controller.loadRoster();

        expect(controller.rosterWired).toBe(true);
        expect(controller.lastLiveRows.map(row => row.agentId)).toEqual(['ada', 'vega']);
        expect(store.getCount()).toBe(2);

        // now the slower JSON seed lands: replace the items — the store fires `load` itself,
        // reaching the guard through the REAL listener
        store.clear();
        store.add([{agentId: 'sample-1'}, {agentId: 'sample-2'}, {agentId: 'sample-3'}]);

        // live truth is re-asserted: sample rows evicted, live residents restored
        expect(store.getCount()).toBe(2);
        expect(store.get('ada')).toBeTruthy();
        expect(store.get('vega')).toBeTruthy();
        expect(store.get('sample-1')).toBeFalsy();

        store.destroy()
    });

    test('a seed load BEFORE live truth passes through untouched (the normal boot path)', () => {
        const store = Neo.create(FleetRoster, {data: []});

        makeLiveHost(store, 2);

        // the seed lands while nothing live exists yet — the store's own load fires the guard
        store.add([{agentId: 'sample-1'}, {agentId: 'sample-2'}]);

        expect(store.getCount()).toBe(2);
        expect(store.get('sample-1')).toBeTruthy();

        store.destroy()
    });

    test('guard re-entry is latched: reconciling a large snapshot through the live listener cannot overflow the stack', async () => {
        const store        = Neo.create(FleetRoster, {data: []}),
              {controller} = makeLiveHost(store, 3);

        // 1,000 authoritative rows — the unlatched recursion overflowed at ~524 nested frames
        const rows = Array.from({length: 1000}, (item, index) => ({
            id: `agent-${index}`, lifecycle: {state: 'running'}
        }));

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetRoster: async () => ({rows})}};

        await controller.loadRoster();

        expect(controller.rosterWired).toBe(true);
        expect(store.getCount()).toBe(1000);

        // a late seed load now triggers reconciliation of all 1,000 rows THROUGH the listener:
        // every joiner add fires `load` back at the guard — the latch must hold
        store.clear();
        store.add([{agentId: 'sample-1'}]);

        expect(store.getCount()).toBe(1000);
        expect(store.get('agent-0')).toBeTruthy();
        expect(store.get('agent-999')).toBeTruthy();
        expect(store.get('sample-1')).toBeFalsy();

        store.destroy()
    });

    test('reconcileSelection (real Store): first-live clear/add re-seats a surviving selection onto the new instance', async () => {
        const store              = Neo.create(FleetRoster, {data: []}),
              setCalls           = [],
              detail             = {set(config) { setCalls.push(config) }},
              {controller, view} = makeLiveHost(store, 4, detail);

        // a sample 'vega' is open in the inspector before live truth resolves
        store.add([{agentId: 'vega'}, {agentId: 'sample-x'}]);
        view.detailRecord = store.get('vega');
        const sampleInstance = view.detailRecord;

        setCalls.length = 0;   // the SETUP write ran the hook too — the assertion owns the re-seat only

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetRoster: async () => ({rows: [
            {id: 'vega', family: 'claude', lifecycle: {state: 'running'}},
            {id: 'ada',  family: 'claude', lifecycle: {state: 'stopped'}}
        ]})}};

        await controller.loadRoster();                           // first-live clear+add replaces the seed

        const liveInstance = store.get('vega');
        expect(liveInstance).toBeTruthy();
        expect(liveInstance).not.toBe(sampleInstance);           // a genuinely new record instance
        expect(view.detailRecord).toBe(liveInstance);            // re-seated onto the live instance
        expect(view.selectionState).toEqual({selectedAgentId: 'vega', selectedAgentIdentity: null});
        expect(setCalls).toEqual([{record: liveInstance}]);      // the inspector re-rendered

        store.destroy()
    });

    test('reconcileSelection (real Store): a later empty snapshot clears a removed resident to the honest empty state', async () => {
        const store              = Neo.create(FleetRoster, {data: []}),
              setCalls           = [],
              detail             = {set(config) { setCalls.push(config) }},
              {controller, view} = makeLiveHost(store, 5, detail);

        controller.rosterWired = true;                           // past the first-live replacement
        store.add([{agentId: 'vega'}, {agentId: 'ada'}]);
        view.detailRecord = store.get('vega');
        setCalls.length = 0;   // the SETUP write ran the hook too

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetRoster: async () => ({rows: []})}};

        await controller.loadRoster();                           // authoritative empty snapshot → real Store.remove

        expect(store.get('vega')).toBeFalsy();                   // removed via the real Store path
        expect(view.detailRecord).toBeNull();                   // selection cleared
        expect(view.selectionState).toEqual({selectedAgentId: null, selectedAgentIdentity: null});
        expect(setCalls).toEqual([{record: null}]);             // AgentDetail → honest empty state

        store.destroy()
    });

    test('reconcileSelection (real Store): a surviving same-instance reconcile is a no-op (mutation path owns it)', async () => {
        const store              = Neo.create(FleetRoster, {data: []}),
              setCalls           = [],
              detail             = {set(config) { setCalls.push(config) }},
              {controller, view} = makeLiveHost(store, 6, detail);

        controller.rosterWired = true;
        store.add([{agentId: 'vega'}, {agentId: 'ada'}]);
        view.detailRecord = store.get('vega');
        const instance = view.detailRecord;

        setCalls.length = 0;   // the SETUP write ran the hook too

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetRoster: async () => ({rows: [
            {id: 'vega', family: 'claude', lifecycle: {state: 'running'}},
            {id: 'ada',  family: 'claude', lifecycle: {state: 'stopped'}}
        ]})}};

        await controller.loadRoster();                           // reconcile: record.set mutates in place (same object)

        expect(store.get('vega')).toBe(instance);               // same instance, mutated in place
        expect(view.detailRecord).toBe(instance);               // selection unchanged
        expect(setCalls).toEqual([]);                           // no re-seat — recordChange owns mutation

        store.destroy()
    });

    test('onDetailRecordChange routes a roster mutation of the inspected agent to the detail — reactive to record MUTATION, not just a re-seat', () => {
        const
            record  = {agentId: 'vega'},
            applied = [],
            detail  = {applyRecord() { applied.push(true) }},
            host    = Object.create(FleetCockpit.prototype);

        Object.defineProperty(host, 'detailRecord', {configurable: true, value: record, writable: true});
        host.getAgentDetailPane = () => detail;

        // a recordChange for the INSPECTED record re-renders the detail in place — a roster re-poll
        // mutating state/lane/sources on the open agent must never leave a stale inspector
        FleetCockpitController.prototype.onDetailRecordChange.call({component: host}, {record});
        expect(applied).toEqual([true]);

        // a recordChange for a DIFFERENT record is ignored — no needless re-render
        FleetCockpitController.prototype.onDetailRecordChange.call({component: host}, {record: {agentId: 'ada'}});
        expect(applied).toEqual([true]);

        // detail not mounted (auto-hidden, not yet revealed) → the optional chain no-ops safely
        host.getAgentDetailPane = () => null;
        FleetCockpitController.prototype.onDetailRecordChange.call({component: host}, {record});
        expect(applied).toEqual([true])
    });

    test('reconcileSelection re-seats or clears the owner-held selection on authoritative membership changes', () => {
        const
            setCalls = [],
            detail   = {set(config) { setCalls.push(config) }},
            makeHost = (detailRecord, storeGet) => {
                const view = wireDetailRecord({
                          detachedDetailPane: null,
                          detailRecord,
                          getAgentDetailPane: FleetCockpit.prototype.getAgentDetailPane,
                          getMemoriesPane   : () => null,
                          getReference      : name => name === 'agent-detail' ? detail : null,
                          selectionState    : {},
                          setState(values) { Object.assign(this.selectionState, values) }
                      }, FleetCockpit),
                      host = makeControllerFake(FleetCockpitController, {
                          component              : view,
                          memoriesTarget         : null,
                          resolveFleetRosterStore: () => ({get: storeGet})
                      });

                view.getController = () => host;
                host.view          = view;

                return host
            };

        // (1) the inspected resident is REMOVED (absent from the authoritative snapshot / empty
        //     snapshot) → clear the selection to the honest empty state (Store.remove fires no recordChange)
        setCalls.length = 0;
        const removedHost = makeHost({agentId: 'vega'}, () => undefined);
        removedHost.reconcileSelection();
        expect(removedHost.view.detailRecord).toBeNull();
        expect(removedHost.view.selectionState).toEqual({selectedAgentId: null, selectedAgentIdentity: null});
        expect(setCalls).toEqual([{record: null}]);

        // (2) the resident survives as the SAME instance (in-place record.set reconcile) → no re-seat;
        //     the mutation path (recordChange → applyRecord) already keeps the inspector truthful
        setCalls.length = 0;
        const same     = {agentId: 'vega'};
        const sameHost = makeHost(same, id => id === 'vega' ? same : undefined);
        sameHost.reconcileSelection();
        expect(sameHost.view.detailRecord).toBe(same);
        expect(setCalls).toEqual([]);

        // (3) the durable agentId survives as a NEW instance (first-live clear+add replace of the sample
        //     seed) → re-seat detailRecord onto the live instance and re-render
        setCalls.length = 0;
        const stale      = {agentId: 'vega'}, fresh = {agentId: 'vega'};
        const reseatHost = makeHost(stale, id => id === 'vega' ? fresh : undefined);
        reseatHost.reconcileSelection();
        expect(reseatHost.view.detailRecord).toBe(fresh);
        expect(reseatHost.view.selectionState).toEqual({selectedAgentId: 'vega', selectedAgentIdentity: null});
        expect(setCalls).toEqual([{record: fresh}]);

        // (4) nothing selected → no-op, and the Store is never touched
        setCalls.length = 0;
        const noneHost = makeHost(null, () => { throw new Error('store must not be touched when nothing is selected') });
        noneHost.reconcileSelection();
        expect(setCalls).toEqual([])
    });
});
