import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitIntentRepollTest'
    }
});

import {test, expect}                                                         from '@playwright/test';
import Neo                                                                    from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                                                              from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                                                                             '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import {makeControllerFake, makeProviderFake, wireDetailRecord, wiredSources} from './cockpitFakes.mjs';

/**
 * Covers the observe half of define→start→observe: after a lifecycle intent SETTLES, the
 * cockpit re-polls the roster so runtime truth re-materializes — `loadRoster` otherwise only fires
 * once at construct, leaving a started resident's card at its stale pre-start state until a reload.
 * `loadRoster` is a spied collaborator here; that it correctly reconciles the Store is covered above.
 */
test.describe('Fleet cockpit — controller re-polls the roster on a settled lifecycle intent (#14978)', () => {
    let FleetCockpitController, FleetCockpit, FleetAgent, Store;

    const settlingBridge  = () => ({startAgent: async () => ({}), stopAgent: async () => ({}), restartAgent: async () => ({})});
    const rejectingBridge = () => ({startAgent: async () => { throw new Error('harness offline') }});

    const setBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };
    const clearBridge = () => { delete globalThis.AgentOS?.fleet };

    // a controller with a spied loadRoster — count the re-polls without a real Store/grid.
    const makeController = calls => {
        const controller = Object.create(FleetCockpitController.prototype);
        controller.loadRoster = () => { calls.push(1) };
        return controller
    };

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        FleetCockpit          = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs')).default;
        FleetAgent            = (await import('../../../../../../../../apps/agentos/model/FleetAgent.mjs')).default;
        Store                 = (await import('../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
    });

    test.afterEach(() => clearBridge());

    test('refreshRosterOnSettle re-polls only when the settle reports a real change', async () => {
        const calls      = [],
              controller = makeController(calls);

        await controller.refreshRosterOnSettle(Promise.resolve(true));
        expect(calls.length).toBe(1);   // a real change → one re-poll

        await controller.refreshRosterOnSettle(Promise.resolve(false));
        expect(calls.length).toBe(1)    // nothing changed (rejected/timeout) → no re-poll, honest reason stands
    });

    test('onAgentLifecycleIntent re-polls the roster once a start settles successfully', async () => {
        setBridge(settlingBridge());

        const calls      = [],
              controller = makeController(calls),
              card       = {record: {agentId: 'vega'}},
              origGet    = Neo.getComponent;

        Neo.getComponent = id => id === 'fm-card-x' ? card : null;

        try {
            await controller.onAgentLifecycleIntent({action: 'start', agentId: 'vega', source: 'fm-card-x'})
        } finally {
            Neo.getComponent = origGet
        }

        expect(calls.length).toBe(1)
    });

    test('a rejected intent does NOT re-poll — the honest failure render is preserved', async () => {
        setBridge(rejectingBridge());

        const calls      = [],
              controller = makeController(calls),
              card       = {record: {agentId: 'vega'}},
              origGet    = Neo.getComponent;

        Neo.getComponent = id => id === 'fm-card-x' ? card : null;

        try {
            await controller.onAgentLifecycleIntent({action: 'start', agentId: 'vega', source: 'fm-card-x'})
        } finally {
            Neo.getComponent = origGet
        }

        expect(calls.length).toBe(0)
    });

    test('onStartFleet fans out N starts but re-polls the roster EXACTLY ONCE after the batch settles', async () => {
        setBridge(settlingBridge());

        const calls      = [],
              controller = makeController(calls),
              cards      = [
                  {ntype: 'fm-agent-card', record: {agentId: 'vega',  sources: wiredSources(), state: 'off'}},
                  {ntype: 'fm-agent-card', record: {agentId: 'ada',   sources: wiredSources(), state: 'off'}},
                  {ntype: 'fm-agent-card', record: {agentId: 'grace', sources: wiredSources(), state: 'off'}}
              ];

        controller.getReference = name => name === 'fleet-cards' ? {items: cards} : null;

        await controller.onStartFleet();

        expect(calls.length).toBe(1)   // three residents started, ONE roster re-poll — never N polls
    });

    test('onAgentSelect: a card select holds the owner-side detailRecord + reveals the auto-hidden inspector through the commit loop', () => {
        const
            record  = {agentId: 'vega', displayName: 'Vega', githubUsername: 'neo-opus-vega'},
            detail  = {record: null, set(cfg) { Object.assign(this, cfg) }},
            applied = [],
            cockpit = {
                detailRecord  : null,
                dockModel     : {items: {detail: {autoHidden: true}}},
                selectionState: {},
                applyDockZoneOperation(op) { applied.push(op); return {document: {revealed: true}, errors: []} },
                // the controller drill routes through the OWNER accessor (docked pane here;
                // the vessel-held handle while detached — the pop-out suite covers that phase)
                getAgentDetailPane() { return detail },
                getMemoriesPane() { return null },
                onDockZoneDocumentChange(doc) { this.committed = doc },
                resolveFleetRosterStore() { return {get: id => id === 'vega' ? record : null} },
                setState(values) { Object.assign(this.selectionState, values) }
            },
            controller = Object.create(FleetCockpitController.prototype);

        wireDetailRecord(cockpit, FleetCockpit);

        controller.component               = cockpit;
        controller.resolveFleetRosterStore = () => cockpit.resolveFleetRosterStore();
        cockpit.getController              = () => controller;

        controller.onAgentSelect({agentId: 'vega'});

        // owner-held selection (survives a later re-projection — resolveDockComponentRef reads it) +
        // the live pane updated in place
        expect(cockpit.detailRecord).toBe(record);
        expect(detail.record).toBe(record);
        expect(cockpit.selectionState).toEqual({
            selectedAgentId      : 'vega',
            selectedAgentIdentity: '@neo-opus-vega'
        });
        // the auto-hidden inspector is revealed through the standard commit loop, not a bespoke path
        expect(applied).toEqual([{operation: 'setItemAutoHidden', itemId: 'detail', autoHidden: false}]);
        expect(cockpit.committed).toEqual({revealed: true})
    });

    test('onAgentSelect: an already-revealed inspector updates in place (no re-projection); an unknown agent is a fail-closed no-op', () => {
        const
            record  = {agentId: 'ada', githubUsername: 'neo-opus-ada'},
            detail  = {record: null, set(cfg) { Object.assign(this, cfg) }},
            applied = [],
            cockpit = {
                detailRecord  : null,
                dockModel     : {items: {detail: {autoHidden: false}}},   // already revealed
                selectionState: {},
                applyDockZoneOperation(op) { applied.push(op); return {document: {}, errors: []} },
                getAgentDetailPane() { return detail },
                getMemoriesPane() { return null },
                onDockZoneDocumentChange() { this.reprojected = true },
                resolveFleetRosterStore() { return {get: id => id === 'ada' ? record : null} },
                setState(values) { Object.assign(this.selectionState, values) }
            },
            controller = Object.create(FleetCockpitController.prototype);

        wireDetailRecord(cockpit, FleetCockpit);

        controller.component               = cockpit;
        controller.resolveFleetRosterStore = () => cockpit.resolveFleetRosterStore();
        cockpit.getController              = () => controller;

        controller.onAgentSelect({agentId: 'ada'});
        expect(cockpit.detailRecord).toBe(record);
        expect(detail.record).toBe(record);
        expect(cockpit.selectionState).toEqual({
            selectedAgentId      : 'ada',
            selectedAgentIdentity: '@neo-opus-ada'
        });
        expect(applied).toEqual([]);                  // already revealed → no reveal op...
        expect(cockpit.reprojected).toBeUndefined();  // ...and no full re-projection

        // unknown agentId → fail-closed no-op, the selection stands
        controller.onAgentSelect({agentId: 'ghost'});
        expect(cockpit.detailRecord).toBe(record)
    });

    // The composition-root binding witness: not "loadRoster was called" (the spy tests above) but
    // "reconciliation reaches the RECORD". Assembles the REAL path end to end — the real controller
    // onAgentLifecycleIntent, the real C2 adapter, a stateful bridge whose `fleetRoster` reflects the
    // start, the real FleetCockpit.loadRoster, and a REAL Store — and asserts the SAME record advances
    // off -> running, so post-settle reconciliation is proven to update the card's data surface.
    test('composition-root witness: a settled card Start reconciles the REAL roster record off -> running via the re-poll (#14978)', async () => {
        let running = false;

        const wired     = channel => ({source: `fleet:${channel}`, state: 'wired', confidence: 'observed'});
        const rosterRow = () => ({
            id         : 'vega',
            displayName: 'Vega',
            family     : 'claude',
            engineTag  : 'opus-4.8',
            // lifecycle 'stopped' -> derived card state 'off'; 'running' -> 'ok' (mapFleetSessionHealth)
            lifecycle: {source: 'fleet:runtimeStatus', state: running ? 'running' : 'stopped', confidence: 'observed'},
            sources  : {roster: wired('listAgents'), repoStatus: wired('fleetStatus'), runtime: wired('runtimeStatus')}
        });

        setBridge({
            startAgent : async () => { running = true; return {ok: true, result: {id: 'vega', state: 'running'}} },
            fleetRoster: async () => ({rows: [rosterRow()]})
        });

        // a REAL store the REAL loadRoster reconciles into — the record is the card's data surface
        const store = Neo.create(Store, {keyProperty: 'agentId', model: FleetAgent});
        // `gridReadGeneration` mirrors the class default because the async-ingress fence reads it: a
        // fake omitting it makes `++undefined` NaN, so the read's generation never matches the
        // owner's and EVERY read silently drops itself — a green suite over state nobody wrote.
        const provider = makeProviderFake(),
              view     = {
                  detailRecord          : null,
                  getCatchUpPane        : () => null,
                  getMemoriesPane       : () => null,
                  getOperatorMailboxPane: () => null,
                  getStateProvider      : () => provider,
                  livenessReadTimeout   : 4000,
                  rosterSourceMode      : 'sample'
              },
              controller = makeControllerFake(FleetCockpitController, {
                  component              : view,
                  getReference           : reference => reference === 'fleet-grid' ? {adapterState: 'sample', store} : null,
                  lastLiveRows           : null,
                  // the provider-owned roster authority — the same REAL store the grid binds
                  resolveFleetRosterStore: () => store
              });

        // boot: the real loadRoster reads the bridge — the agent is stopped, so the record resolves to 'off'
        await controller.loadRoster();
        expect(store.get('vega').state).toBe('off');
        // success-state proof: the load COMPLETED (reached the post-reconcile provider write), not
        // merely mutated the record before a swallowed missing-reconcileSelection error (Euclid's falsifier)
        expect(provider.data.gridAdapterState).toBe('live');

        // drive the REAL controller path for that record — real onAgentLifecycleIntent -> real adapter ->
        // bridge.startAgent -> refreshRosterOnSettle -> real loadRoster -> reconcile
        const origGet = Neo.getComponent;

        Neo.getComponent = id => id === 'card-vega' ? {record: store.get('vega')} : null;

        try {
            await controller.onAgentLifecycleIntent({action: 'start', agentId: 'vega', source: 'card-vega'})
        } finally {
            Neo.getComponent = origGet
        }

        // the binding witness: the SAME real record advanced off -> ok through reconciliation, no reload/rebuild
        expect(store.get('vega').state).toBe('ok');
        // and the re-poll load COMPLETED too (reconcile phase reached success state, not a swallowed error)
        expect(provider.data.gridAdapterState).toBe('live');

        store.destroy()
    })
});
