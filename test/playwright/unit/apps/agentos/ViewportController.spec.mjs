import {setup} from '../../../setup.mjs';

setup({
    appConfig: {
        name: 'AgentOSViewportControllerRouteTest'
    }
});

import {test, expect}     from '@playwright/test';
import Neo                from '../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core          from '../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import AgentDefinitions   from '../../../../../apps/agentos/store/AgentDefinitions.mjs';
import FleetCockpit       from '../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import FleetTenants       from '../../../../../apps/agentos/store/FleetTenants.mjs';
import {deriveFleetProfileId} from '../../../../../apps/agentos/fleet/connectionProfiles.mjs';
import PlaneSetupPanel    from '../../../../../apps/agentos/view/PlaneSetupPanel.mjs';
import Viewport           from '../../../../../apps/agentos/view/Viewport.mjs';
import ViewportController from '../../../../../apps/agentos/view/ViewportController.mjs';

test.describe('AgentOS.view.ViewportController — route → keeper-view tab', () => {
    function createController() {
        const tabButtons = [
            {route: '/home',     index: 0},
            {route: '/fleet',    index: 1},
            {route: '/system',   index: 2},
            {route: '/accounts', index: 3},
            {route: '/chat',     index: 4}
        ];

        const shell = {
            activeIndex: null,
            getTabBar  : () => ({items: tabButtons})
        };

        const controller = Object.create(ViewportController.prototype);

        controller.getReference = reference => reference === 'shell' ? shell : null;

        return {controller, shell}
    }

    test('declares routes for each left-rail keeper-view', () => {
        expect(ViewportController.config.routes).toEqual({
            '/accounts': 'onAccountsRoute',
            '/chat'    : 'onChatRoute',
            '/fleet'   : 'onFleetRoute',
            '/home'    : 'onHomeRoute',
            '/system'  : 'onSystemRoute'
        })
    });

    test('activates the Fleet keeper-view from the fleet route without a hardcoded array lookup', () => {
        const {controller, shell} = createController();

        controller.onFleetRoute();

        expect(shell.activeIndex).toBe(1)
    });

    test('activates every shell route by matching the tab header route', () => {
        const {controller, shell} = createController();

        controller.onHomeRoute();
        expect(shell.activeIndex).toBe(0);

        controller.onSystemRoute();
        expect(shell.activeIndex).toBe(2);

        controller.onAccountsRoute();
        expect(shell.activeIndex).toBe(3);

        controller.onChatRoute();
        expect(shell.activeIndex).toBe(4)
    });

    test('leaves the active shell view unchanged when the route has no tab match', () => {
        const {controller, shell} = createController();

        shell.activeIndex = 1;

        controller.activateRoute('/unknown');

        expect(shell.activeIndex).toBe(1)
    });

    test('keeps the authored shell header routes aligned with the controller routes', () => {
        const shellConfig = Viewport.config.items.find(item => item.reference === 'shell'),
              routes      = shellConfig.items.map(item => item.header.route);

        expect(routes).toEqual(['/home', '/fleet', '/system', '/accounts', '/chat']);
        expect(routes.sort()).toEqual(Object.keys(ViewportController.config.routes).sort())
    })
});

test.describe('AgentOS.view.ViewportController — the plane-setup card mounts only when the shell needs a plane', () => {
    test.afterEach(() => {
        delete Neo.main?.addon?.ShellPlane
    });

    async function mountWith(planeStatus, act = controller => controller.mountPlaneSetup()) {
        const
            shell      = {},
            inserted   = [],
            controller = Object.create(ViewportController.prototype);

        if (planeStatus) {
            Neo.ns('Neo.main.addon', true).ShellPlane = {planeStatus}
        }

        controller.component    = {items: [{}, shell], insert: (index, config) => inserted.push({index, config})};
        controller.getReference = reference => reference === 'shell' ? shell : null;
        controller.windowId     = 7;

        await act(controller);

        return inserted
    }

    test('a packaged shell with no plane gets the card, above the shell', async () => {
        const inserted = await mountWith(async () => ({available: true, packaged: true, configured: false}));

        expect(inserted).toEqual([{index: 1, config: {module: PlaneSetupPanel, flex: 'none', reference: 'plane-setup'}}])
    });

    test('a browser, an unpackaged shell, a configured shell and a failed read create nothing', async () => {
        const cases = [
            null,
            async () => ({available: false}),
            async () => ({available: true, packaged: false, configured: false}),
            async () => ({available: true, packaged: true,  configured: true}),
            async () => { throw new Error('remote gone') }
        ];

        for (const planeStatus of cases) {
            expect(await mountWith(planeStatus), String(planeStatus)).toEqual([])
        }
    });

    test('the banner\'s Connect brings a dismissed card back, and mounts one this boot never created', async () => {
        const
            card       = {hidden: true},
            controller = Object.create(ViewportController.prototype);

        controller.getReference = reference => reference === 'plane-setup' ? card : null;

        await controller.showPlaneSetup();
        expect(card.hidden, 'the dismissed card shows again').toBe(false);

        const mounts = [];

        controller.getReference   = () => null;
        controller.mountPlaneSetup = async options => { mounts.push(options) };

        await controller.showPlaneSetup();
        expect(mounts, 'no card yet: it mounts on request, configured plane or not').toEqual([{force: true}])
    });

    test('a request mounts the card for a configured shell too: another plane, or one that refused this shell (#241)', async () => {
        const inserted = await mountWith(
            async () => ({available: true, packaged: true, configured: true, planeBase: 'http://127.0.0.1:3102'}),
            controller => controller.showPlaneSetup()
        );

        expect(inserted).toEqual([{index: 1, config: {module: PlaneSetupPanel, flex: 'none', reference: 'plane-setup'}}]);

        expect(await mountWith(async () => ({available: false}), controller => controller.showPlaneSetup()), 'a browser still gets none').toEqual([])
    });

    test('the shell switcher\'s attach intent opens the card (#241)', () => {
        let shown = 0;

        const controller = Object.assign(Object.create(ViewportController.prototype), {showPlaneSetup: () => { shown++ }});

        controller.onAttachPlane();
        expect(shown).toBe(1)
    });

    test('under shell custody the switcher mirrors the shell\'s binding: custody at once, then the plane main attached (#241)', async () => {
        const
            writes     = [],
            controller = Object.assign(Object.create(ViewportController.prototype), {
                component: {stateProvider: {setData: data => writes.push(data)}},
                windowId : 7
            });

        Neo.ns('Neo.main.addon', true).ShellPlane = {
            planeStatus: async () => ({available: true, packaged: true, configured: true, attached: true, planeBase: 'http://127.0.0.1:3102'})
        };

        await controller.syncShellBinding();

        expect(writes).toEqual([{shellCustody: true}, {shellPlaneBase: 'http://127.0.0.1:3102'}])
    });

    test('the shell skips the browser-custody roster; a browser hydrates it (#241)', () => {
        const
            calls        = [],
            original     = globalThis.AgentOS,
            addon        = Neo.ns('Neo.main.addon', true),
            localStorage = addon.LocalStorage,
            make         = () => Object.assign(Object.create(ViewportController.prototype), {
                initInstanceRoster: () => calls.push('roster'),
                mountPlaneSetup   : () => calls.push('card'),
                syncShellBinding  : () => calls.push('shell'),
                windowId          : 7
            });

        addon.LocalStorage = {readLocalStorageItem: async () => ({value: null})};

        try {
            globalThis.AgentOS = {fleet: {registryBridge: {credentialIngress: 'shell'}}};
            make().onComponentConstructed();

            globalThis.AgentOS = {fleet: {registryBridge: {credentialIngress: 'worker'}}};
            make().onComponentConstructed()
        } finally {
            globalThis.AgentOS = original;
            addon.LocalStorage = localStorage
        }

        expect(calls).toEqual(['shell', 'card', 'roster', 'card'])
    })
});

test.describe('AgentOS.view.Viewport — accepted-definition composition boundary', () => {
    test('hosts the exact shared definition and public-tenant Stores at the Viewport provider root', () => {
        const stores = Viewport.config.stateProvider.stores;

        expect(stores.agentDefinitions).toEqual({module: AgentDefinitions});
        expect(stores.fleetTenants).toEqual({module: FleetTenants})
    });

    test('authors the Accounts intent listener and FleetCockpit reference at the shared owner', () => {
        const
            shellConfig  = Viewport.config.items.find(item => item.reference === 'shell'),
            fleetConfig  = shellConfig.items.find(item => item.header.route === '/fleet'),
            accountsHost = shellConfig.items.find(item => item.header.route === '/accounts'),
            accounts     = accountsHost.items.find(item => item.reference === 'accounts');

        expect(fleetConfig.reference).toBe('fleet-cockpit');
        expect(accounts.listeners).toEqual({agentDefinitionAccepted: 'up.onAgentDefinitionAccepted'})
    });

    test('refreshes the separate Fleet roster only for a valid accepted definition', async () => {
        const
            calls   = [],
            // the REAL cockpit's surface over a stubbed controller: a hand-written cockpit once kept
            // answering for a method the class had lost, and the handler failed closed on every call
            cockpit = Object.assign(Object.create(FleetCockpit.prototype), {
                getController: () => ({loadRoster: async () => calls.push('loadRoster')})
            }),
            stub    = {getReference: reference => reference === 'fleet-cockpit' ? cockpit : null};

        await expect(Viewport.prototype.onAgentDefinitionAccepted.call(stub, {agent: {id: 'resident-42'}}))
            .resolves.toBe(true);
        expect(calls).toEqual(['loadRoster']);

        await expect(Viewport.prototype.onAgentDefinitionAccepted.call(stub, {agent: {}}))
            .resolves.toBe(false);
        expect(calls).toEqual(['loadRoster'])
    });

    /**
     * @summary Drives the PRODUCTION `initInstanceRoster()` against one stored value and reports both
     * observable effects — what the operator was told, and whether the boot seed was written back.
     *
     * The pair is the point. A reviewer falsifier on the first head deleted the warning branch and
     * left every arm green, because the arms exercised the helper's classification and the caller's
     * read failure but never the edge between them — and the warning itself promised the value was
     * "still on disk" while this same function overwrote it. Splitting those two facts across
     * separate stubs is what let both defects hide.
     * @param {Object} [options]
     * @param {String|null} [options.value=null] Stored value, or `null` for an unset key.
     * @param {Error|null} [options.readError=null] Thrown by the storage read instead of returning.
     * @returns {Promise<{persisted: Boolean, warnings: String[]}>}
     */
    async function runInitInstanceRoster({value = null, readError = null} = {}) {
        const warnings     = [],
              originalLS   = Neo.main?.addon?.LocalStorage,
              originalWarn = console.warn;

        let persisted = false;

        // `resolveFleetUrl()` reads `Neo.config.url.search` when it seeds the boot profile, which the
        // unit harness does not set. Harness scaffolding, downstream of the behaviour under test.
        Neo.config.url              = Neo.config.url || {search: ''};
        Neo.main                    = Neo.main       || {};
        Neo.main.addon              = Neo.main.addon || {};
        Neo.main.addon.LocalStorage = {
            readLocalStorageItem: async () => {
                if (readError) {
                    throw readError
                }

                return {value}
            }
        };
        console.warn = (...args) => warnings.push(args.join(' '));

        const stub = {
            windowId : 1,
            component: {stateProvider: {getStore: () => ({add() {}, get: () => null})}},
            persistInstanceRoster() { persisted = true },
            syncBoundInstance() {}
        };

        try {
            await ViewportController.prototype.initInstanceRoster.call(stub)
        } finally {
            console.warn                = originalWarn;
            Neo.main.addon.LocalStorage = originalLS
        }

        return {persisted, warnings}
    }

    test('#17368: an UNREADABLE store warns, and does not write over the roster it calls recoverable', async () => {
        // The worse half of the defect. The caller collapsed a storage-read failure into `value = null`,
        // which is also what an unset key looks like — so the roster is intact on disk, maximally
        // recoverable, and the operator is told nothing while the UI seeds one instance and appears
        // completely normal.
        const {persisted, warnings} = await runInitInstanceRoster({readError: new Error('storage denied')});

        expect(warnings.some(line => /storage unreadable/.test(line))).toBe(true);
        // The message must tell the operator their instances are missing, not merely that a read
        // failed — the actionable fact is what they are no longer seeing.
        expect(warnings.some(line => /configured instances/.test(line))).toBe(true);
        expect(persisted).toBe(false)
    });

    test('#17368: BOTH malformed envelope shapes reach the operator, and neither is written over', async () => {
        const unparseable = await runInitInstanceRoster({value: '{not json'}),
              notAnArray  = await runInitInstanceRoster({value: '{"profiles":[]}'});

        expect(unparseable.warnings.some(line => /stored value is unparseable/ .test(line))).toBe(true);
        expect(notAnArray .warnings.some(line => /stored value is not-an-array/.test(line))).toBe(true);

        // Both messages promise the value survives. These two assertions are what make that promise
        // true: without them the seed write lands milliseconds after the sentence, and the warning
        // becomes a receipt for the destruction rather than a route to recovery.
        expect(unparseable.persisted).toBe(false);
        expect(notAnArray .persisted).toBe(false);

        // A stored empty string is a value somebody WROTE, and `JSON.parse('')` throws. Admitting it
        // to the absent branch would rebuild the conflation this change removes, one state over.
        const emptyString = await runInitInstanceRoster({value: ''});

        expect(emptyString.warnings.some(line => /stored value is unparseable/.test(line))).toBe(true);
        expect(emptyString.persisted).toBe(false)
    });

    test('#17368 CONTROL: an absent key and a valid empty roster stay quiet AND still seed to disk', async () => {
        // Two controls in one, guarding opposite over-corrections. Without the quiet half, the arms
        // above are satisfied by a build that warns at every startup. Without the persisted half,
        // they are satisfied by a build that simply stopped writing — which would break first-boot
        // seeding outright while every damage assertion above still went green.
        const absent = await runInitInstanceRoster({value: null}),
              // Valid JSON, valid array, zero rows: the honest empty roster. `null` alone cannot
              // separate "no key" from "nothing readable", so the empty ARRAY is the real control.
              empty  = await runInitInstanceRoster({value: '[]'});

        expect(absent.warnings.filter(line => /instance roster/.test(line))).toEqual([]);
        expect(empty .warnings.filter(line => /instance roster/.test(line))).toEqual([]);
        expect(absent.persisted).toBe(true);
        expect(empty .persisted).toBe(true)
    });

    test('fails closed when the Fleet cockpit is absent', async () => {
        const stub = {getReference: () => null};

        await expect(Viewport.prototype.onAgentDefinitionAccepted.call(stub, {agent: {id: 'resident-42'}}))
            .resolves.toBe(false)
    });

    test('switchToProfile answers an endpoint the bridge refuses as a verdict: a remote row resolves false and touches no state — never a throw that strands the switcher in "starting"', async () => {
        const
            writes     = [],
            controller = Object.assign(Object.create(ViewportController.prototype), {
                component   : {stateProvider: {setData: data => writes.push(data)}},
                getReference: () => null
            });

        await expect(controller.switchToProfile({canonicalEndpoint: 'https://switcher-test.example/fleet'}))
            .resolves.toBe(false);

        expect(writes, 'nothing was bound, so nothing changes').toEqual([])
    });

    /**
     * @summary A controller over the REAL cockpit's surface: only the cockpit's `getController` and
     * the controller's own collaborators are stubbed, so a method the class lacks throws here as it
     * does in the app.
     * @param {Object} options
     * @param {String[]} options.calls  Receives the cockpit-side calls.
     * @param {Object[]} options.writes Receives the provider writes.
     * @returns {Object} The controller.
     */
    function createControllerOverRealCockpit({calls, writes}) {
        const cockpit = Object.assign(Object.create(FleetCockpit.prototype), {
            getController: () => ({reconnectFleet: () => calls.push('reconnectFleet')})
        });

        return Object.assign(Object.create(ViewportController.prototype), {
            component        : {stateProvider: {setData: data => writes.push(data)}},
            getReference     : reference => reference === 'fleet-cockpit' ? cockpit : null,
            pushTearOutTitles: () => calls.push('pushTearOutTitles'),
            syncBoundInstance: () => calls.push('syncBoundInstance')
        })
    }

    test('an instance switch re-drives the cockpit and settles its verdict — it never stays "starting"', async () => {
        const
            calls      = [],
            writes     = [],
            controller = createControllerOverRealCockpit({calls, writes}),
            original   = globalThis.AgentOS;

        try {
            // bearer-less and deliberate: the fail-closed bridge is published, verification answers false
            await expect(controller.switchToProfile({canonicalEndpoint: 'http://127.0.0.1:8083/fleet'}))
                .resolves.toBe(false)
        } finally {
            globalThis.AgentOS = original
        }

        expect(calls).toEqual(['syncBoundInstance', 'pushTearOutTitles', 'reconnectFleet']);
        expect(writes).toEqual([{instanceState: 'starting'}, {instanceState: 'off'}])
    });

    test('under shell custody a switch or a connect answers false and the shell bridge stays published (#241)', async () => {
        const
            calls      = [],
            writes     = [],
            controller = createControllerOverRealCockpit({calls, writes}),
            original   = globalThis.AgentOS,
            shell      = {credentialIngress: 'shell', profileId: null},
            record     = {canonicalEndpoint: 'http://127.0.0.1:8083/fleet', profileId: 'fleet-profile:v1:http://127.0.0.1:8083/fleet'},
            source     = {};

        controller.component.stateProvider.getStore = () => ({get: () => record});

        try {
            globalThis.AgentOS = {fleet: {registryBridge: shell}};

            await expect(controller.switchToProfile(record)).resolves.toBe(false);
            await controller.onConnectInstance({profileId: record.profileId, bearerToken: 'a'.repeat(43), source});

            expect(globalThis.AgentOS.fleet.registryBridge).toBe(shell)
        } finally {
            globalThis.AgentOS = original
        }

        expect(source.notice?.tone).toBe('refused');
        expect(calls, 'nothing re-drives: nothing was bound').toEqual([]);
        expect(writes).toEqual([])
    });

    test('a connected tenant re-drives the cockpit after its success notice', async () => {
        const
            calls      = [],
            controller = createControllerOverRealCockpit({calls, writes: []}),
            original   = globalThis.AgentOS,
            source     = {};

        globalThis.AgentOS = {fleet: {registryBridge: {connectTenant: async () => ({id: 'tenant-7', status: 'connected'})}}};

        try {
            await controller.onConnectPlane({credential: 'forge-credential', source, tenantUrl: 'https://forge.example/acme'})
        } finally {
            globalThis.AgentOS = original
        }

        expect(source.notice).toEqual({tone: 'ok', text: 'tenant connected — tenant-7'});
        expect(calls).toEqual(['reconnectFleet'])
    });

    test('every method the Viewport and its controller call on the cockpit exists on the real class', () => {
        ['loadRoster', 'pushVesselTitles', 'reconnectFleet'].forEach(method => {
            expect(typeof FleetCockpit.prototype[method], method).toBe('function')
        })
    });

    /**
     * The engine's `fire` stamps the firer's ID onto every object-format event, so the manager's
     * intents reach these handlers with `source` as a STRING; each handler writes its notice onto
     * the instance, so it resolves it first. A registered stand-in is the manager: `Neo.getComponent`
     * must find it by id, exactly as it finds the real drawer.
     */
    test.describe('instance manager intents — `source` arrives as the firer\'s id', () => {
        let manager;

        const makeController = ({calls, records = {}, boundProfileId = null, verified = true}) => Object.assign(Object.create(ViewportController.prototype), {
            component: {stateProvider: {
                getData : key => key === 'boundProfileId' ? boundProfileId : null,
                getStore: name => name === 'fleetInstances' ? {
                    get   : id => records[id] ?? null,
                    add   : record => calls.push(['add', record.profileId]),
                    remove: record => calls.push(['remove', record.profileId])
                } : null
            }},
            getReference         : () => null,
            persistInstanceRoster: () => calls.push(['persist']),
            switchToProfile      : async (record, opts) => { calls.push(['switch', record.profileId, opts.bearerToken]); return verified }
        });

        test.beforeEach(() => {
            manager = Neo.create(Neo.ns('Neo.component.Base'), {id: 'seam-instance-manager'});
            manager.onClearClick       = () => manager.cleared = (manager.cleared ?? 0) + 1;
            manager.updateInstanceList = () => manager.refreshed = (manager.refreshed ?? 0) + 1
        });

        test.afterEach(() => {
            manager.destroy();
            manager = null
        });

        test('Add: the row is added, the editor cleared and the notice lands on the manager instance', () => {
            const calls = [], controller = makeController({calls});

            controller.onSaveInstance({endpoint: 'http://127.0.0.1:8096/fleet', label: 'second', source: manager.id});

            expect(calls.map(call => call[0])).toEqual(['add', 'persist']);
            expect(manager.cleared, 'the editor cleared through the instance').toBe(1);
            expect(manager.refreshed, 'the roster consumers re-rendered through the instance').toBe(1);
            expect(manager.notice?.tone).toBe('ok');
            expect(manager.notice?.text).toMatch(/^added — /)
        });

        test('Connect + switch: the bearer reaches the custody switch and the verdict lands on the instance', async () => {
            const calls = [], records = {p1: {profileId: 'p1', canonicalEndpoint: 'http://127.0.0.1:8095/fleet'}};

            await makeController({calls, records}).onConnectInstance({profileId: 'p1', bearerToken: 'process-bearer', source: manager.id});

            expect(calls).toEqual([['switch', 'p1', 'process-bearer']]);
            expect(manager.notice).toEqual({tone: 'ok', text: 'connected — custody verified, ingress retired'});

            // no bearer: refused on the instance, no switch attempted
            calls.length = 0;
            await makeController({calls, records}).onConnectInstance({profileId: 'p1', bearerToken: null, source: manager.id});

            expect(calls).toEqual([]);
            expect(manager.notice?.tone).toBe('refused')
        });

        test('Retire: an unbound row leaves, the bound one refuses — both notices on the instance', () => {
            const calls = [], records = {p1: {profileId: 'p1'}};

            makeController({calls, records}).onRetireInstance({profileId: 'p1', source: manager.id});

            expect(calls).toEqual([['remove', 'p1'], ['persist']]);
            expect(manager.notice).toEqual({tone: 'ok', text: 'retired'});
            expect(manager.refreshed).toBe(1);

            calls.length = 0;
            makeController({calls, records, boundProfileId: 'p1'}).onRetireInstance({profileId: 'p1', source: manager.id});

            expect(calls).toEqual([]);
            expect(manager.notice?.tone).toBe('refused')
        });

        test('Probe: the reachability verdict lands on the instance', async () => {
            const priorFetch = globalThis.fetch, records = {p1: {profileId: 'p1', canonicalEndpoint: 'http://127.0.0.1:8095/fleet'}};

            globalThis.fetch = async () => ({status: 401});

            try {
                await makeController({calls: [], records}).onProbeInstance({profileId: 'p1', source: manager.id})
            } finally {
                globalThis.fetch = priorFetch
            }

            expect(manager.notice).toEqual({tone: 'ok', text: 'reachable — HTTP 401 (authentication required)'})
        });

        test('Plane admission: the tenant verdict lands on the instance (the instance form still passes through)', async () => {
            const original = globalThis.AgentOS, direct = {};

            globalThis.AgentOS = {fleet: {registryBridge: {connectTenant: async () => ({status: 'rejected', reason: 'forge said no'})}}};

            try {
                const controller = makeController({calls: []});

                await controller.onConnectPlane({credential: 'c', source: manager.id, tenantUrl: 'https://forge.example/acme'});
                await controller.onConnectPlane({credential: 'c', source: direct, tenantUrl: 'https://forge.example/acme'})
            } finally {
                globalThis.AgentOS = original
            }

            expect(manager.notice).toEqual({tone: 'refused', text: 'forge said no'});
            expect(direct.notice).toEqual({tone: 'refused', text: 'forge said no'})
        })
    });

    test('wireFleetBridge stamps the endpoint\'s canonical profile identity onto the injected bridge; an explicit identity passes through', () => {
        const
            original    = globalThis.AgentOS,
            bearerToken = 'A'.repeat(43),
            url         = 'http://127.0.0.1:8095/fleet',
            controller  = Object.create(ViewportController.prototype);

        try {
            expect(controller.wireFleetBridge({url, bearerToken})).toBe(true);
            expect(globalThis.AgentOS.fleet.registryBridge.profileId, 'the custody switch\'s own identity contract').toBe(deriveFleetProfileId(url));
            expect(globalThis.AgentOS.fleet.registryBridge.selected).toBe(true);

            // the same endpoint wired again is the same target — one identity, not a new one
            controller.wireFleetBridge({url, bearerToken});
            expect(globalThis.AgentOS.fleet.registryBridge.profileId).toBe(deriveFleetProfileId(url));

            // a caller that already holds the identity keeps it
            controller.wireFleetBridge({url, bearerToken, profileId: 'fleet-profile:v1:explicit'});
            expect(globalThis.AgentOS.fleet.registryBridge.profileId).toBe('fleet-profile:v1:explicit')
        } finally {
            globalThis.AgentOS = original
        }
    })
});
