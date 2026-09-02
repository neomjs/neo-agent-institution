import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitProjectionTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

/**
 * The engine Workspace reads its own configs on the projection + view-sync paths (the action-rail
 * flags and their icons, the maximize transient, the host/shell placement). A bare spy host
 * (`Object.create(prototype)`) carries no `#configs` backing, so every such read must land on an
 * OWN property. The values are DERIVED from the classes' declared `static config` layers —
 * Workspace first, then the cockpit's own overrides up the chain — never transcribed, so an
 * Engine default flip (lock joining the default rail) reaches these specs through the pin bump
 * instead of leaving them green on a configuration the real cockpit no longer has.
 * @param {Function} cls The consumer class whose effective dock configs the spy host carries.
 * @param {Function} stopAt The first ancestor NOT to read (the generic dashboard root).
 * @returns {Object}
 */
const declaredDockConfigs = (cls, stopAt) => {
    const layers = [];

    for (let ctor = cls; ctor && ctor !== stopAt; ctor = Object.getPrototypeOf(ctor)) {
        layers.unshift(ctor)
    }

    return layers.reduce((acc, ctor) => {
        Object.entries(ctor.config || {}).forEach(([key, value]) => {
            const name = key.replace(/_$/, '');

            if (/^(dock|enableDock|flipMarkerPrefix|maximizeMarkerPrefix|maximizedNodeId|tearOutHostParam)/.test(name)) {
                acc[name] = value
            }
        });

        return acc
    }, {})
};

/**
 * The two spy-host facts that are fixture identity, not Engine contract: the projection stamps
 * the workspace `id` as the cross-zone motion boundary, and the refresh awaits a mount only for
 * an unmounted host — the spy owner IS its own mounted dock host.
 */
const spyHostIdentity = {
    id     : 'fleet-cockpit-spy-host',
    mounted: true
};

/**
 * Covers the cockpit's dock projection wiring — the live half of the §01 layout: the
 * committed `neo.dock.zone.v1` document as the layout SSOT, projected through
 * `Neo.dashboard.dock.projection.LayoutAdapter`, with the reducer / view-sync commit loop the splitters,
 * cross-zone drops and NL operations all funnel through.
 *
 * The units are the loop's own contracts (prototype-call granularity, spy owners — the
 * adapter's projection internals and the panes' rendering have their own suites):
 * fail-closed reducer purity, the one-tick deferral + destroy guard (the example's documented
 * use-after-destroy trap), instance-bound callback threading, layout-blind panes per the
 * docking design's pane contract, and owner-held pane state surviving re-projection.
 */
test.describe('Fleet cockpit — dock projection wiring (the resize commit loop)', () => {
    let ActivityStream, AgentDetail, CatchUpPane, Reconciler, Workspace, Operations, FleetCockpit, FleetCockpitController, FleetGrid, MemoriesPane, OperatorMailbox, CockpitDockDocument;

    // a projection-capable spy owner: the REAL prototype methods over controlled state, without
    // provider/store/bridge wiring (their routing has its own suite in fleetCockpit.spec.mjs)
    const makeHost = (overrides = {}) => {
        const
            host = Object.create(FleetCockpit.prototype),
            // the resident reading surfaces resolve their owner state + option lists through the
            // CONTROLLER seat; this projection-only host answers with the cold controller surface
            // (all-null owner state), the roster resolving through the host's provider seat as
            // the real controller does
            controllerStub = {
                // the stream resolver joins roster actor facts through the controller now; the
                // honest empty directory is exactly what an unmaterialized roster yields
                buildActivityActorDirectory  : () => ({}),
                buildCatchUpPartitionOptions : () => [],
                buildOperatorRecipientOptions: () => [],
                catchUpMarkOutcome     : null,
                catchUpSnapshot        : null,
                memoriesDrillSession   : null,
                memoriesDrillSnapshot  : null,
                memoriesSnapshot       : null,
                memoriesTarget         : null,
                operatorIdentityPosture: null,
                resolveFleetRosterStore: () => host.getStateProvider?.()?.getStore('fleetRoster') ?? null,
                tasksSnapshot          : null,
                wakeRoutesSnapshot     : null
            },
            // the REAL selection-write site runs over this host (the controller owns it now)
            _wireSelection = (() => {
                controllerStub.component      = host;
                controllerStub.memoriesTarget = null;
                controllerStub.applySelection = FleetCockpitController.prototype.applySelection.bind(controllerStub);
                return true
            })(),
            values = {
                getController        : () => controllerStub,
                getReference         : () => null,
                getMemoriesPane      : () => null,
                // OWN value: the inherited engine accessor walks real config state a bare fake
                // does not carry (the #configs private-member throw)
                getStateProvider     : () => null,
                detailRecord         : null,
                dockModel            : CockpitDockDocument.create(),
                gridAdapterState     : 'sample',
                isDestroyed          : false,
                refreshPromise       : null,
                returningTearOutPanes: {},
                streamAdapterState   : 'sample',
                streamEvents         : [],
                tearOutAdmissions    : new Map(),
                tearOutConnects      : {},
                tearOutPaneHandles   : {},
                tearOutPanes         : {},
                tearOutPlacements    : {},
                timeout              : ms => new Promise(resolve => setTimeout(resolve, ms)),
                ...spyHostIdentity,
                ...declaredDockConfigs(FleetCockpit, Object.getPrototypeOf(Workspace)),
                ...overrides
            };

        Object.defineProperties(host, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
            configurable: true,
            value,
            writable    : true
        }])));

        return host
    };

    // flatten a projected config tree (items recursion) for structural assertions
    const collect = (config, out = []) => {
        out.push(config);
        (config.items || []).forEach(item => collect(item, out));
        return out
    };

    test.beforeAll(async () => {
        ActivityStream      = (await import('../../../../../../../../apps/agentos/view/fleet/activity/Container.mjs')).default;
        AgentDetail         = (await import('../../../../../../../../apps/agentos/view/fleet/detail/Container.mjs')).default;
        CatchUpPane         = (await import('../../../../../../../../apps/agentos/view/fleet/catchup/Container.mjs')).default;
        MemoriesPane        = (await import('../../../../../../../../apps/agentos/view/fleet/memories/Container.mjs')).default;
        OperatorMailbox     = (await import('../../../../../../../../apps/agentos/view/fleet/mailbox/OperatorContainer.mjs')).default;
        Reconciler          = (await import('../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/projection/Reconciler.mjs')).default;
        Workspace           = (await import('../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/Workspace.mjs')).default;
        Operations          = (await import('../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Operations.mjs')).default;
        FleetCockpit        = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs')).default;
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        FleetGrid           = (await import('../../../../../../../../apps/agentos/view/fleet/roster/Container.mjs')).default;
        CockpitDockDocument = (await import('../../../../../../../../apps/agentos/util/CockpitDockDocument.mjs')).default
    });

    test('#17681 consumes the engine host without shadowing its holder or tear-out lifecycle', () => {
        // the #50 factoring: the declared cockpit sits on its vessel layer, which sits on the
        // engine host — one chain, no sideways copies
        const vesselLayer = Object.getPrototypeOf(FleetCockpit.prototype);

        expect(vesselLayer.constructor.name).toBe('VesselContainer');
        expect(Object.getPrototypeOf(vesselLayer) === Workspace.prototype).toBe(true);

        for (const method of [
            'adoptTearOutPane',
            'applyDockZoneOperation',
            'applyTearOutOperation',
            'captureTearOutPane',
            'getDockZoneDocument',
            'onDockCrossZoneDrop',
            'onDockZoneDocumentChange',
            'onWindowConnect',
            'onWindowDisconnect',
            'projectDockModel',
            'refreshDockWorkspace',
            'reintegrateTearOutItem',
            'releaseTearOutPane',
            'reparentTearOutPane'
        ]) {
            expect(Object.hasOwn(FleetCockpit.prototype, method), `${method} is inherited`).toBe(false);
            expect(Object.hasOwn(vesselLayer, method), `${method} is not shadowed by the vessel layer`).toBe(false)
        }
    });

    test('the reducer is pure and fail-closed: a commit advances a NEW document, the held one never mutates', () => {
        const host   = makeHost(),
              before = JSON.stringify(host.dockModel);

        const result = FleetCockpit.prototype.applyDockZoneOperation.call(host, {
            operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.4, 0.6]
        });

        expect(result.errors).toEqual([]);
        expect(result.document.nodes['primary-split'].sizes).toEqual([0.4, 0.6]);

        // purity: the reducer returned a NEW document — the held SSOT is untouched until the
        // view-sync stores the committed result
        expect(JSON.stringify(host.dockModel)).toBe(before);

        // fail-closed: a bogus operation reports errors and cannot advance state
        const rejected = FleetCockpit.prototype.applyDockZoneOperation.call(host, {
            operation: 'resizeSplit', splitNodeId: 'ghost-split', sizes: [0.5, 0.5]
        });

        expect(rejected.errors.length).toBeGreaterThan(0);
        expect(JSON.stringify(host.dockModel)).toBe(before)
    });

    test('the view-sync stores synchronously but re-projects one tick DEFERRED — the committing splitter must survive its own onDragEnd', async () => {
        let refreshed = 0;

        const host = makeHost({refreshDockWorkspace() { refreshed++ }}),
              next = Operations.applyOperation(host.dockModel, {
                  operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.3, 0.7]
              }).document;

        FleetCockpit.prototype.onDockZoneDocumentChange.call(host, next);

        // the document is the SSOT immediately (a follow-up reducer call must see it)...
        expect(host.dockModel).toBe(next);
        // ...but the re-projection has NOT run inside the committing call stack
        expect(refreshed).toBe(0);

        await host.refreshPromise;
        expect(refreshed).toBe(1)
    });

    test('the deferral honors teardown: a host destroyed before the tick never re-projects (the isDestroyed guard)', async () => {
        let refreshed = 0;

        const host = makeHost({refreshDockWorkspace() { refreshed++ }});

        FleetCockpit.prototype.onDockZoneDocumentChange.call(host, CockpitDockDocument.create());
        host.isDestroyed = true;

        await host.refreshPromise;
        expect(refreshed).toBe(0)
    });

    test('two rapid commits serialize their captured document snapshots instead of overlapping shells', async () => {
        const
            first = Operations.applyOperation(CockpitDockDocument.create(), {
                operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.3, 0.7]
            }).document,
            second = Operations.applyOperation(first, {
                operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.4, 0.6]
            }).document,
            starts   = [],
            releases = [],
            host     = makeHost({
                refreshDockWorkspace(tabInsertDescriptor, document) {
                    starts.push(document);
                    return new Promise(resolve => releases.push(resolve))
                }
            });

        FleetCockpit.prototype.onDockZoneDocumentChange.call(host, first);
        FleetCockpit.prototype.onDockZoneDocumentChange.call(host, second);

        await new Promise(resolve => setTimeout(resolve, 5));
        expect(starts).toEqual([first]);

        releases.shift()();
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(starts).toEqual([first, second]);

        releases.shift()();
        await host.refreshPromise
    });

    test('refresh reconciles shell index 1, preserves flex, and decorates a genuinely absent pane', async () => {
        const
            document = CockpitDockDocument.create(),
            original = Reconciler.reconcileProjection,
            preset   = {reference: 'fleet-preset-overview', set(values) { Object.assign(this, values) }},
            error    = {set(values) { Object.assign(this, values) }},
            host     = makeHost({
                id              : 'fleet-test-host',
                items           : [{items: [preset]}],
                perspectiveStore: {collection: {activeLayoutId: 'overview'}},
                presetError     : null,
                getReference(reference) {
                    return reference === 'fleet-preset-error' ? error : null
                }
            });

        let options;

        Reconciler.reconcileProjection = async value => {
            options = value
        };

        try {
            await FleetCockpit.prototype.refreshDockWorkspace.call(host, null, document);

            expect(options.host).toBe(host);
            expect(options.shellIndex).toBe(1);
            expect(options.nextConfig.flex).toBe(1);

            const absent = options.resolveItem('fleet');

            expect(absent.module).toBe(FleetGrid);
            expect(absent.header).toEqual({text: 'Fleet', dockItemId: 'fleet'});
            expect(absent.dockItemId).toBe('fleet');
            expect(absent.data).toMatchObject({componentRef: 'fleet-grid', dockItemId: 'fleet'})
        } finally {
            options?.placeholders?.forEach(placeholder => !placeholder.isDestroyed && placeholder.destroy());
            Reconciler.reconcileProjection = original
        }
    });

    test('the projection threads INSTANCE-BOUND callbacks: a projected affordance routes its commit into this host\'s document', () => {
        const host   = makeHost(),
              config = FleetCockpit.prototype.projectDockModel.call(host);

        // the projection root carries the dock token scope by construction
        expect(config.cls).toContain('neo-dashboard');

        // find a projected affordance carrying the reducer callback (the splitter contract)
        const armed = collect(config).find(node => typeof node.applyDockZoneOperation === 'function');
        expect(armed, 'the projection must thread the reducer onto an affordance').toBeTruthy();

        // behavioral instance-binding proof: invoking the THREADED callback operates on THIS
        // host's committed document (not a stale or global one)
        const result = armed.applyDockZoneOperation({
            operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.25, 0.75]
        });

        expect(result.errors).toEqual([]);
        expect(result.document.nodes['primary-split'].sizes).toEqual([0.25, 0.75])
    });

    test('panes are layout-blind (§2.6) and absent-item fallback reads OWNER-held state', () => {
        const
            definitions = {id: 'definitions-store'},
            tenants     = {id: 'tenants-store'},
            host        = makeHost({
                detailRecord    : {agentId: 'vega', displayName: 'Vega'},
                getStateProvider: () => ({
                    getStore: name => ({
                        agentDefinitions: definitions,
                        fleetTenants    : tenants
                    })[name]
                }),
                gridAdapterState  : 'live',
                streamAdapterState: 'stale'
            });

        const grid = FleetCockpit.prototype.resolveDockComponentRef.call(host, 'fleet-grid', {title: 'Fleet'}, 'fleet');

        expect(grid.module).toBe(FleetGrid);
        // owner-held truth arrives through the provider BINDING now — the bind function IS the route
        expect(grid.bind.adapterState({gridAdapterState: 'live'})).toBe('live');
        expect(grid.bind.store).toBe('stores.fleetRoster');           // provider-scope binding survives projection depth
        expect(grid.cls).toContain('dock-flip-item-fleet');           // the stable FLIP correlation key

        const stream = FleetCockpit.prototype.resolveDockComponentRef.call(host, 'activity-stream', {title: 'Activity'}, 'stream');

        expect(stream.module).toBe(ActivityStream);
        expect(stream.bind.adapterState({streamAdapterState: 'stale'})).toBe('stale');
        expect(stream.bind.counts({activityCounts: [1]})).toEqual([1]);
        expect(stream.bind.store).toBe('stores.fleetActivityEvents');
        expect(stream.cls).toContain('dock-flip-item-stream');

        // agent-detail now renders the real drill-in view from OWNER-held fallback state
        // (the selected record), so returning from true absence never drops the selection
        const detail = FleetCockpit.prototype.resolveDockComponentRef.call(host, 'agent-detail', {title: 'Agent detail'}, 'detail');

        expect(detail.module).toBe(AgentDetail);
        expect(detail.record).toBe(host.detailRecord);   // owner-held selection survives re-projection
        expect(detail.agentDefinitions).toBe(definitions);
        expect(detail.fleetTenants).toBe(tenants);
        expect(detail.cls).toContain('dock-flip-item-detail');

        // §2.6 layout-blind: NOTHING dock-specific reaches a pane config beyond the marker class
        for (const pane of [grid, stream, detail]) {
            for (const forbidden of ['applyDockZoneOperation', 'onDockZoneDocumentChange', 'onDockCrossZoneDrop', 'dockZoneDocument', 'dockNodeId']) {
                expect(pane[forbidden], `a pane config must not carry ${forbidden}`).toBeUndefined()
            }
        }

        // perspectives resolves to its own drawer — LAZY like the wake-routes sibling (a loader,
        // not a class), bound to the projected list, its intent relayed to the controller; the
        // honest placeholder now belongs only to a zone no case knows
        const perspectives = FleetCockpit.prototype.resolveDockComponentRef.call(host, 'perspectives', {title: 'Perspectives'}, 'perspectives');

        expect(typeof perspectives.module, 'a loader, resolved at first reveal').toBe('function');
        expect(perspectives.cls).toEqual(['dock-flip-item-perspectives']);
        expect(perspectives.bind.perspectives({perspectives: 'projected'})).toBe('projected');
        expect(perspectives.listeners.perspectiveRequest).toBe('onPerspectiveRequest');
        expect(perspectives.html).toBeUndefined();

        const unknown = FleetCockpit.prototype.resolveDockComponentRef.call(host, 'no-such-zone', {title: 'Nowhere'}, 'no-such-zone');

        expect(unknown.cls).toContain('fm-pane-placeholder');
        expect(unknown.cls).toContain('dock-flip-item-no-such-zone');
        expect(unknown.html).toContain('Nowhere')
    });

    test('the projected tree renders the document\'s zones: every live pane present, exactly once each', () => {
        const host  = makeHost(),
              nodes = collect(FleetCockpit.prototype.projectDockModel.call(host));

        expect(nodes.filter(node => node.module === FleetGrid).length).toBe(1);
        expect(nodes.filter(node => node.module === ActivityStream).length).toBe(1);

        // the south reading surfaces are resident tabs — projected exactly once each
        expect(nodes.filter(node => node.module === MemoriesPane).length).toBe(1);
        expect(nodes.filter(node => node.module === OperatorMailbox).length).toBe(1);
        expect(nodes.filter(node => node.module === CatchUpPane).length).toBe(1);

        // the auto-hidden chrome (detail + perspectives) must NOT render as full panes — the
        // document declares them rail material (their reveal chain is the shipped machinery)
        expect(nodes.filter(node => node.cls?.includes('fm-pane-placeholder')).length).toBe(0);

        const rails = nodes.filter(node => node.dockNodeType === 'edge-rail');

        expect(rails).toHaveLength(1);
        expect(rails[0].dockEdge).toBe('right');
        expect(rails[0].railItems.map(item => item.dockItemId)).toEqual([
            'detail',
            'perspectives',
            'defineAgent',
            'wakeRoutes'
        ])
    });
});

/**
 * Covers the perspective presets — named workspace-scope layouts switching the committed
 * document through the SAME commit loop every other dock gesture uses. The units: the seeded
 * library validates and adopts, a switch restores fail-closed and commits deferred, pane
 * continuity is STATE continuity (owner-held fields and the preset library untouched by a
 * switch), a refused switch renders visibly with the live layout byte-untouched, and the
 * control bar derives from store state.
 */
test.describe('Fleet cockpit — perspective presets (the switch through the commit loop)', () => {
    let PerspectiveLibrary, Persistence, Document, Workspace, FleetCockpit, FleetCockpitController, CockpitDockDocument, CockpitPresets, Neo;

    const makePresetHost = async (overrides = {}) => {
        const
            store = Neo.create(PerspectiveLibrary, {collection: CockpitPresets.create()}),
            host  = Object.create(FleetCockpit.prototype),
            // the cold controller surface, roster resolving through the host's provider seat as
            // the real controller does (the Review-switch default-selection path reads it)
            controllerStub = {
                // the stream resolver joins roster actor facts through the controller now; the
                // honest empty directory is exactly what an unmaterialized roster yields
                buildActivityActorDirectory  : () => ({}),
                buildCatchUpPartitionOptions : () => [],
                buildOperatorRecipientOptions: () => [],
                catchUpMarkOutcome     : null,
                catchUpSnapshot        : null,
                memoriesDrillSession   : null,
                memoriesDrillSnapshot  : null,
                memoriesSnapshot       : null,
                memoriesTarget         : null,
                operatorIdentityPosture: null,
                resolveFleetRosterStore: () => host.getStateProvider?.()?.getStore('fleetRoster') ?? null,
                tasksSnapshot          : null,
                wakeRoutesSnapshot     : null
            },
            // same wiring for the preset host
            _wireSelection = (() => {
                controllerStub.component      = host;
                controllerStub.memoriesTarget = null;
                controllerStub.applySelection = FleetCockpitController.prototype.applySelection.bind(controllerStub);
                return true
            })(),
            values = {
                getController   : () => controllerStub,
                getReference    : () => null,
                getMemoriesPane : () => null,
                // OWN value — same #configs guard as makeHost
                getStateProvider: () => null,
                detailRecord    : null,
                dockModel       : (await import('../../../../../../../../apps/agentos/util/CockpitDockDocument.mjs')).default.create(),
                gridAdapterState: 'sample',
                isDestroyed     : false,
                perspectiveStore: store,
                presetError     : null,
                refreshPromise  : null,
                selectionState  : {},
                setState(data) {
                    Object.assign(this.selectionState, data)
                },
                streamAdapterState: 'sample',
                streamEvents      : [],
                timeout           : ms => new Promise(resolve => setTimeout(resolve, ms)),
                ...spyHostIdentity,
                ...declaredDockConfigs(FleetCockpit, Object.getPrototypeOf(Workspace)),
                ...overrides
            };

        Object.defineProperties(host, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
            configurable: true,
            value,
            writable    : true
        }])));

        return host
    };

    test.beforeAll(async () => {
        Neo                     = (await import('../../../../../../../../node_modules/neo.mjs/src/Neo.mjs')).default;
        PerspectiveLibrary      = (await import('../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/persistence/PerspectiveLibrary.mjs')).default;
        Persistence             = (await import('../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Persistence.mjs')).default;
        Document                = (await import('../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Document.mjs')).default;
        Workspace               = (await import('../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/Workspace.mjs')).default;
        FleetCockpit            = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs')).default;
        FleetCockpitController  = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        CockpitDockDocument     = (await import('../../../../../../../../apps/agentos/util/CockpitDockDocument.mjs')).default;
        CockpitPresets          = (await import('../../../../../../../../apps/agentos/util/CockpitPresets.mjs')).default
    });

    test('the seeded library validates whole and lists the three duty presets, Overview active', () => {
        const collection = CockpitPresets.create();

        expect(PerspectiveLibrary.validateSavedLayoutCollection(collection)).toEqual([]);
        expect(collection.activeLayoutId).toBe('overview');

        const store = Neo.create(PerspectiveLibrary, {collection});

        expect(store.list().map(preset => preset.perspectiveName)).toEqual(['Overview', 'Focus', 'Review']);
        store.destroy()
    });

    test('a switch restores the preset document through the standard commit loop — stored synchronously, re-projected deferred', async () => {
        let refreshed = 0;

        const host = await makePresetHost({refreshDockWorkspace() { refreshed++ }});

        const verdict = FleetCockpit.prototype.activatePerspective.call(host, 'Focus');

        expect(verdict).toEqual({errors: [], switched: true});
        expect(host.presetError).toBeNull();
        // the restored document is the live SSOT immediately, with Focus geometry
        expect(host.dockModel.nodes['primary-split'].sizes).toEqual([0.85, 0.15]);
        // the preset library tracks the active record
        expect(host.perspectiveStore.collection.activeLayoutId).toBe('focus');
        // deferred view-sync, same as every commit
        expect(refreshed).toBe(0);
        await host.refreshPromise;
        expect(refreshed).toBe(1);

        // Review opens the detail band and leans the split toward the trail
        FleetCockpit.prototype.activatePerspective.call(host, 'Review');
        expect(host.dockModel.nodes['primary-split'].sizes).toEqual([0.45, 0.55]);
        expect(host.dockModel.items.detail.autoHidden).toBe(false);

        host.perspectiveStore.destroy()
    });

    test('pane continuity across a switch is STATE continuity: owner-held fields and the resolver output survive untouched', async () => {
        const events = [{type: 'pr-activity', payload: {text: 'live-held'}}],
              host   = await makePresetHost({
                  gridAdapterState  : 'live',
                  refreshDockWorkspace() {},
                  streamAdapterState: 'live',
                  streamEvents      : events
              });

        FleetCockpit.prototype.activatePerspective.call(host, 'Focus');

        // the switch touched the LAYOUT SSOT only — held pane state is not its surface
        expect(host.gridAdapterState).toBe('live');
        expect(host.streamAdapterState).toBe('live');
        expect(host.streamEvents).toBe(events);

        // and a genuinely absent pane's next materialization binds that state from the provider
        const grid = FleetCockpit.prototype.resolveDockComponentRef.call(host, 'fleet-grid', {title: 'Fleet'}, 'fleet');
        expect(grid.bind.adapterState({gridAdapterState: 'live'})).toBe('live');

        host.perspectiveStore.destroy()
    });

    test('#17451: a Review switch on a cold seat defaults the selection from the PROVIDER roster before the commit, and lands it on the live pane', async () => {
        const record = {agentId: 'vega', githubUsername: 'neo-opus-vega'},
              sets   = [],
              detail = {record: null, set(values) { Object.assign(this, values); sets.push(values) }},
              host   = await makePresetHost({
                  detailRecord      : null,
                  getAgentDetailPane: () => detail,
                  getStateProvider  : () => ({getStore: name => name === 'fleetRoster' ? {first: () => record} : null}),
                  refreshDockWorkspace() {}
              });

        const verdict = FleetCockpit.prototype.activatePerspective.call(host, 'Review');

        expect(verdict).toEqual({errors: [], switched: true});
        // held owner-side BEFORE the deferred re-projection — the materializing resolver reads it
        expect(host.detailRecord).toBe(record);
        expect(host.selectionState).toEqual({
            selectedAgentId      : 'vega',
            selectedAgentIdentity: '@neo-opus-vega'
        });
        // and the live docked/popped pane updates through the select seam's owner accessor
        expect(sets).toEqual([{record}]);

        host.perspectiveStore.destroy()
    });

    test('#17451: a prior selection survives a Review switch untouched — the cold default never overwrites', async () => {
        const prior = {agentId: 'ada', githubUsername: 'neo-opus-ada'},
              sets  = [],
              host  = await makePresetHost({
                  detailRecord      : prior,
                  getAgentDetailPane: () => ({set: values => sets.push(values)}),
                  getStateProvider  : () => ({getStore: () => ({first() { throw new Error('the default path must not consult the roster while a selection exists') }})}),
                  refreshDockWorkspace() {}
              });

        FleetCockpit.prototype.activatePerspective.call(host, 'Review');

        expect(host.detailRecord).toBe(prior);
        expect(sets).toEqual([{record: prior}]);

        host.perspectiveStore.destroy()
    });

    test('#17451: non-revealing and detail-ABSENT documents never mutate the selection', async () => {
        const host = await makePresetHost({
            detailRecord      : null,
            getAgentDetailPane() { throw new Error('a non-revealing switch must not touch the pane') },
            getStateProvider  : () => ({getStore: () => ({first: () => ({agentId: 'vega'})})}),
            refreshDockWorkspace() {}
        });

        // Focus keeps the inspector rail-hidden — a valid, non-revealing switch stays selection-silent
        FleetCockpit.prototype.activatePerspective.call(host, 'Focus');
        expect(host.detailRecord).toBe(null);

        // the round-1 falsifier, pinned at the predicate: a VALIDATOR-CLEAN document with the
        // detail item absent must not read as revealed — `!items.detail?.autoHidden` alone did
        const doc = host.perspectiveStore.loadPerspective('Overview').document;

        doc.nodes['secondary-rail'].items = doc.nodes['secondary-rail'].items.filter(id => id !== 'detail');
        doc.nodes['secondary-rail'].activeItemId = doc.nodes['secondary-rail'].items[0];
        delete doc.items.detail;
        expect(Document.validate(doc)).toEqual([]);
        expect(FleetCockpit.prototype.isInspectorRevealed.call(host, doc)).toBe(false);

        host.perspectiveStore.destroy()
    });

    test('the persistent control bar keeps identities while preset and refusal state change', async () => {
        const
            buttons = ['overview', 'focus', 'review'].map(layoutId => ({
                pressed  : false,
                reference: `fleet-preset-${layoutId}`,
                set(values) { Object.assign(this, values) }
            })),
            error = {
                hidden: true,
                text  : '',
                set(values) { Object.assign(this, values) }
            },
            host = await makePresetHost({
                items: [{items: buttons}],
                getReference(reference) {
                    return reference === 'fleet-preset-error' ? error : null
                }
            }),
            identities = [...buttons];

        FleetCockpit.prototype.syncControlBar.call(host);
        expect(buttons.map(button => button.pressed)).toEqual([true, false, false]);

        host.perspectiveStore.loadPerspective('Focus');
        host.presetError = 'refused visibly';
        FleetCockpit.prototype.syncControlBar.call(host);

        expect(buttons).toEqual(identities);
        expect(buttons.map(button => button.pressed)).toEqual([false, true, false]);
        expect(error).toMatchObject({hidden: false, text: 'refused visibly'});

        host.perspectiveStore.destroy()
    });

    test('a refused switch fails closed VISIBLY: the live layout stays byte-identical and the error syncs in place', async () => {
        let synced = 0;

        const host   = await makePresetHost({syncControlBar() { synced++ }}),
              before = JSON.stringify(host.dockModel);

        const verdict = FleetCockpit.prototype.activatePerspective.call(host, 'ghost');

        expect(verdict.switched).toBe(false);
        expect(verdict.errors.join(' ')).toContain('no perspective named');
        expect(JSON.stringify(host.dockModel)).toBe(before);
        expect(host.presetError).toContain('ghost');
        // the error path updates the persistent bar, without a document commit or shell refresh
        expect(synced).toBe(1);

        // fail-closed on the SSOT too: the active perspective record never moved
        expect(host.perspectiveStore.collection.activeLayoutId).toBe('overview');

        host.perspectiveStore.destroy()
    });

    test('a captured perspective carries a NON-FIRST active south tab and a switch restores it exactly — the active item rides the document, never app state', async () => {
        const host = await makePresetHost({refreshDockWorkspace() {}}),
              live = CockpitDockDocument.create();

        // the operator read Memories: a live `activeIndex` change commits `setActiveItem`, so the
        // document — the only thing a perspective captures — already carries the selection
        live.nodes['stream-tabs'].activeItemId = 'memories';
        expect(Document.validate(live)).toEqual([]);

        const captured = Persistence.capturePerspective(live, {layoutId: 'memories-open', perspectiveName: 'Memories open', title: 'Memories open'});

        expect(captured.errors).toEqual([]);
        expect(host.perspectiveStore.savePerspective(captured.layout, {activate: false}).saved).toBe(true);

        // a Focus switch restores Focus's own recorded selection (the seeded first tab)...
        FleetCockpit.prototype.activatePerspective.call(host, 'Focus');
        expect(host.dockModel.nodes['stream-tabs'].activeItemId).toBe('stream');

        // ...and the captured perspective brings Memories back exactly — no tab-one reset
        const verdict = FleetCockpit.prototype.activatePerspective.call(host, 'Memories open');

        expect(verdict).toEqual({errors: [], switched: true});
        expect(host.dockModel.nodes['stream-tabs'].activeItemId).toBe('memories');
        expect(host.dockModel.nodes['stream-tabs'].items).toEqual(live.nodes['stream-tabs'].items);

        host.perspectiveStore.destroy()
    });
});
