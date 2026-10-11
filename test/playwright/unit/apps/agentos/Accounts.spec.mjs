import {setup} from '../../../setup.mjs';

setup({
    appConfig: {
        name: 'AgentOSAccountsTest'
    }
});

import {test, expect}   from '@playwright/test';
import fs               from 'fs';
import path             from 'path';
import {fileURLToPath}  from 'url';
import Neo              from '../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core        from '../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import DataStore        from '../../../../../node_modules/neo.mjs/src/data/Store.mjs';
import StateProvider    from '../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import Instance         from '../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import Accounts         from '../../../../../apps/agentos/view/accounts/Panel.mjs';
import AddAgentForm     from '../../../../../apps/agentos/view/fleet/instances/AddAgentForm.mjs';
import TestFleetTenants from '../../../../../apps/agentos/store/FleetTenants.mjs';
import FleetRoster      from '../../../../../apps/agentos/store/FleetRoster.mjs';

import ConfigIntentRoundTrip                                    from '../../../../../apps/agentos/util/ConfigIntentRoundTrip.mjs';
import {mcpCatalogFor, normalizeMcpOverrides, resolveMcpMatrix} from 'neo-agent-brain/fleet-contract';

const
    __filename     = fileURLToPath(import.meta.url),
    __dirname      = path.dirname(__filename),
    repoRoot       = path.resolve(__dirname, '../../../../..'),
    viewPath       = path.join(repoRoot, 'apps/agentos/view/accounts/Panel.mjs'),
    controllerPath = path.join(repoRoot, 'apps/agentos/view/accounts/Controller.mjs');

let AgentDefinition, Store;
let testInstanceStore, testFleetTenantsStore;

test.beforeAll(() => {
    testInstanceStore     = Neo.create(DataStore, {keyProperty: 'profileId', data: []});
    testFleetTenantsStore = Neo.create(TestFleetTenants, {data: []})
});

test.afterAll(() => {
    testFleetTenantsStore?.destroy();
    testInstanceStore?.destroy()
});

test.beforeAll(async () => {
    AgentDefinition = (await import('../../../../../apps/agentos/model/AgentDefinition.mjs')).default;
    Store           = (await import('../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
});

const makeAgentStore = data => Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data});

/**
 * @summary Create the real Accounts child tree and controller for lifecycle and event tests.
 * @param {Object} config Neo component configuration, including isolated provider Store instances.
 * @returns {Promise<AgentOS.view.accounts.Panel>}
 */
const createAccounts = async config => {
    const stores = {
        agentDefinitions: config.agentDefinitionsStore || {module: DataStore, model: AgentDefinition, data: []},
        fleetTenants    : config.fleetTenantsStore || {module: TestFleetTenants, data: []},
        fleetRoster     : config.fleetRosterStore || {module: DataStore, data: []},
        fleetInstances  : config.instanceStore || {module: DataStore, keyProperty: 'profileId', data: []}
    };
    const view = Neo.create(Accounts, {
        appName: 'AgentOSAccountsTest',
        ...config,
        stateProvider: {
            module: StateProvider,
            data  : {
                boundProfileId: config.boundProfileId ?? null,
                shellCustody  : config.shellCustody === true,
                shellPlaneBase: config.shellPlaneBase ?? null
            },
            stores
        }
    });

    return view
};

test.describe('Accounts live repository operations (#642)', () => {
    const working = {repoSlug: 'example/work'}, extra = {repoSlug: 'example/extra'};

    /** @summary Mount real binding owners and release them after one asynchronous witness. */
    const withRepositories = async run => {
        const definitions = makeAgentStore([
            {id: 'ada', githubUsername: 'ada', metadata: {repo: working, repos: []}},
            {id: 'vega', githubUsername: 'vega', metadata: {repo: working, repos: []}}
        ]);
        const roster = Neo.create(FleetRoster, {data: [{agentId: 'ada', state: 'ok', repoOutcomes: [
            {...extra, state: 'prepared', via: 'prepare', at: '2026-10-11T03:00:00Z'}
        ]}]});
        const prior = globalThis.AgentOS;
        let view;
        try {
            globalThis.AgentOS = {...prior, fleet: {}};
            view = await createAccounts({agentDefinitionsStore: definitions, fleetRosterStore: roster});
            await view.ready();
            view.selectedAgentId = 'ada';
            const card   = view.getReference('agent-repos-card'), controller = view.getController();
            const bridge = {
                setRepos          : async ({id, repos}) => ({status: 'accepted', agent: {id, metadata: {repo: working, repos}}}),
                removeRepoCheckout: async () => ({removed: false, reason: 'changed files'})
            };
            globalThis.AgentOS = {...prior, fleet: {registryBridge: bridge}};
            card.refresh();
            await run({view, card, controller, definitions, roster, bridge})
        } finally {
            globalThis.AgentOS = prior;
            view?.destroy(); definitions.destroy(); roster.destroy()
        }
    };

    for (const [result, words] of [
        [{state: 'at-start', repos: []}, 'clones at the next Start'],
        [{state: 'identity-unavailable', repos: [], reason: 'launch identity unavailable'}, 'launch identity unavailable'],
        [{state: 'superseded', repos: [{repoSlug: 'example/new', state: 'prepared'}]}, 'the launch changed'],
        [null, 'unconfirmed · the next status says'],
        ['throw', 'unconfirmed · the next status says'],
        ['unsupported', 'Configuration saved.']
    ]) {
        test(`preparation answer ${result?.state ?? result} preserves the accepted declaration`, async () => withRepositories(async ({card, controller, definitions, bridge}) => {
            bridge.prepareRepos = async () => {
                if (result === 'throw') throw new Error('private transport detail');
                if (result === 'unsupported') throw Object.assign(new Error('old server'), {fleetWireState: 'unsupported-method'});
                return result
            };
            await controller.onAgentReposIntent({id: 'ada', repos: [{repoSlug: 'example/new'}]});
            expect(definitions.get('ada')['metadata.repos']).toEqual([{repoSlug: 'example/new'}]);
            expect(card.getReference('repos-status').text).toBe(words);
            expect(card.getReference('repo-list').store.get('example/new').checkout.text).not.toContain('ready');
            expect(JSON.stringify(card.vdom)).not.toContain('private transport detail')
        }))
    }

    test('rejected saves and stopped seats never prepare; a missing verb leaves the save accepted', async () => withRepositories(async ({card, controller, definitions, roster, bridge}) => {
        let calls = 0;
        bridge.prepareRepos = async () => {calls++; return {state: 'complete', repos: []}};
        const accepted = bridge.setRepos;
        bridge.setRepos = async () => ({status: 'rejected', reason: 'invalid repository'});
        await controller.onAgentReposIntent({id: 'ada', repos: [extra]});
        expect(definitions.get('ada')['metadata.repos']).toEqual([]);
        bridge.setRepos = accepted;
        roster.get('ada').state = 'off';
        await controller.onAgentReposIntent({id: 'ada', repos: [extra]});
        expect(calls).toBe(0);
        expect(card.getReference('repos-status').text).toBe('clones at the next Start');
        roster.get('ada').state = 'ok';
        delete bridge.prepareRepos;
        await controller.onAgentReposIntent({id: 'ada', repos: [extra]});
        expect(card.getReference('repos-status').text).toBe('Configuration saved.')
    }));

    for (const reason of ['changed files', 'unpushed commits', 'a stash', 'ignored files']) {
        test(`delete refusal retains the row and its reason: ${reason}`, async () => withRepositories(async ({card, controller, bridge}) => {
            let payload;
            bridge.removeRepoCheckout = async value => {payload = value; return {removed: false, reason}};
            expect(card.getReference('repo-list').store.get(extra.repoSlug).dependency.text).toBe('skills unverified');
            await controller.onDeleteCheckout({id: 'ada', repoSlug: extra.repoSlug, force: true});
            expect(payload).toEqual({id: 'ada', repoSlug: extra.repoSlug});
            expect(card.getReference('repo-list').store.get(extra.repoSlug).retained).toBe(true);
            expect(JSON.stringify(card.getReference('repo-list').vdom)).toContain(reason)
        }))
    }

    test('successful deletion retires the row; old dependency history cannot recreate it', async () => withRepositories(async ({card, controller, roster, bridge}) => {
        roster.get('ada').set({dependencyOutcomes: [{...extra, state: 'installed'}]});
        bridge.removeRepoCheckout = async () => ({removed: true, repoPath: '/not-rendered'});
        await controller.onDeleteCheckout({id: 'ada', repoSlug: extra.repoSlug});
        expect(card.getReference('repo-list').store.get(extra.repoSlug)).toBeNull();
        roster.get('ada').set({repoOutcomes: []});
        expect(card.checkoutReceipt).toBeNull();
        expect(card.getReference('repo-list').store.get(extra.repoSlug)).toBeNull();
        expect(JSON.stringify(card.vdom)).not.toContain('/not-rendered')
    }));

    for (const action of ['prepare', 'delete']) {
        test(`${action} held reply cannot overwrite a newer checkout observation`, async () => withRepositories(async ({card, controller, roster, bridge}) => {
            let resolve;
            bridge[action === 'prepare' ? 'prepareRepos' : 'removeRepoCheckout'] = () => new Promise(done => {resolve = done});
            const pending = action === 'prepare'
                ? controller.onAgentReposIntent({id: 'ada', repos: [extra]})
                : controller.onDeleteCheckout({id: 'ada', repoSlug: extra.repoSlug});
            await Promise.resolve(); await Promise.resolve();
            roster.get('ada').set({repoOutcomes: [{...extra, state: 'prepared', via: 'prepare', at: '2026-10-11T04:00:00Z'}]});
            resolve(action === 'prepare'
                ? {state: 'complete', repos: [{...extra, state: 'failed', reason: 'older failure'}]}
                : {removed: true});
            await pending;
            expect(card.getReference('repo-list').store.get(extra.repoSlug)).not.toBeNull();
            expect(JSON.stringify(card.vdom)).not.toContain('older failure');
            expect(card.checkoutReceipt).toBeNull();
            expect(card.getReference('repos-status').text).toBe('repository status changed · refreshing')
        }))
    }

    for (const action of ['prepare', 'delete']) {
        for (const interruption of ['A-B-A', 'definitions-store', 'roster-store', 'destroy', 'other-owner-save', 'same-owner-save']) {
            test(`${action} reply is fenced after ${interruption}`, async () => withRepositories(async ({view, card, controller, definitions, bridge}) => {
                let resolve, replacement;
                const method = action === 'prepare' ? 'prepareRepos' : 'removeRepoCheckout';
                bridge[method] = () => new Promise(done => {resolve = done});
                const pending = action === 'prepare'
                    ? controller.onAgentReposIntent({id: 'ada', repos: [extra]})
                    : controller.onDeleteCheckout({id: 'ada', repoSlug: extra.repoSlug});
                await Promise.resolve(); await Promise.resolve();
                expect(typeof resolve).toBe('function');
                let   paints = 0, refreshes = 0;
                const paint  = card.setRepositoryStatus.bind(card);
                card.setRepositoryStatus = (...args) => {paints++; return paint(...args)};
                view.on('repositoryOperationSettled', () => refreshes++);
                if (interruption === 'A-B-A') {
                    view.selectedAgentId = 'vega'; view.selectedAgentId = 'ada'
                } else if (interruption === 'definitions-store') {
                    replacement = makeAgentStore([{id: 'ada', metadata: {repo: working, repos: []}}]);
                    view.agentDefinitionsStore = replacement
                } else if (interruption === 'roster-store') {
                    replacement = Neo.create(FleetRoster);
                    view.fleetRosterStore = replacement
                } else if (interruption === 'destroy') {
                    view.destroy()
                } else if (interruption === 'same-owner-save') {
                    delete bridge.prepareRepos;
                    await controller.onAgentReposIntent({id: 'ada', repos: []});
                    paints = 0
                } else {
                    await ConfigIntentRoundTrip.runConfigIntentRoundTrip({
                        intent: {id: 'ada', harnessType: 'codex'}, owner: {}, store: definitions,
                        setSaveStatus() {}, bridgeResolver: () => ({configureAgent: async () => ({status: 'rejected', reason: 'newer'})})
                    })
                }
                resolve(action === 'prepare' ? {state: 'complete', repos: [{...extra, state: 'prepared', via: 'prepare'}]} : {removed: true});
                await pending;
                expect(refreshes).toBe(0);
                expect(paints).toBe(interruption === 'other-owner-save' ? 1 : 0);
                if (interruption === 'other-owner-save') expect(card.repositoryStatus.state).toBe('superseded');
                replacement?.destroy()
            }))
        }
    }

    test('prepares only after accepted readback and keeps checkout and dependency facts separate', async () => {
        const definitions = makeAgentStore([{id: 'ada', githubUsername: 'ada', metadata: {repo: working, repos: []}}]);
        const roster      = Neo.create(FleetRoster, {data: [{agentId: 'ada', state: 'ok', repoOutcomes: []}]});
        const prior       = globalThis.AgentOS, calls = [];
        let view, resolveSave;
        try {
            view = await createAccounts({agentDefinitionsStore: definitions, fleetRosterStore: roster});
            await view.ready();
            view.selectedAgentId = 'ada';
            expect(view.getReference('agent-repos-card').record?.id).toBe('ada');
            expect(view.getReference('agent-repos-card').rosterStore?.get('ada')?.state).toBe('ok');
            globalThis.AgentOS = {fleet: {registryBridge: {
                setRepos    : intent => new Promise(resolve => {calls.push(intent); resolveSave = resolve}),
                prepareRepos: async intent => {
                    calls.push(intent);
                    expect(definitions.get('ada')['metadata.repos']).toEqual([extra]);
                    return {state: 'complete', repos: [{...extra, state: 'prepared', via: 'prepare', at: '2026-10-11T03:00:00Z'}]}
                }
            }}};
            const pending = view.getController().onAgentReposIntent({id: 'ada', repos: [extra]});
            expect(calls).toEqual([{id: 'ada', repos: [extra]}]);
            resolveSave({status: 'accepted', agent: {id: 'ada', metadata: {repo: working, repos: [extra]}}});
            await pending;
            expect(calls).toEqual([{id: 'ada', repos: [extra]}, {id: 'ada'}]);
            const card = view.getReference('agent-repos-card');
            expect(card.getReference('repos-heading').text).toBe('Repositories');
            const content = JSON.stringify(card.getReference('repo-list').vdom);
            expect(content).toContain('checkout ready · now');
            expect(content).toContain('skills at the next Start');
            expect(content).not.toContain('skills prepared')
        } finally {
            globalThis.AgentOS = prior;
            view?.destroy(); definitions.destroy(); roster.destroy()
        }
    });
});

test.describe('AgentOS.view.accounts.Panel — the one add-agent form (#245)', () => {
    test('the view mounts the shared AddAgentForm and keeps no form of its own', () => {
        const
            source = fs.readFileSync(viewPath, 'utf8'),
            // modules serialize as their class names, so the item tree reads as what it mounts
            items  = JSON.stringify(Accounts.config.items, (key, value) => typeof value === 'function' ? value.prototype?.className : value);

        expect(items).toContain('"module":"AgentOS.view.fleet.instances.AddAgentForm"');
        expect(items).toContain('"module":"AgentOS.view.accounts.List"');

        // the retired duplicate: its fields, its submit path, its sample and connect actions
        expect(source).not.toMatch(/PasswordField|TextField|Radio|FormContainer/);
        expect(source).not.toMatch(/onSubmitAgentClick|submitToFleetRegistryBridge|clearCredentialField/);
        expect(source).not.toMatch(/Use sample|Connect harness|connectionBridge/);
        // and the setup journey carries no App Worker or credential-ownership prose
        expect(source).not.toMatch(/never enters App Worker state|not retained in the app worker|dev-server mode/)
    });

    test('the Accounts panel forwards bound Agent OS changes to its mounted card', async () => {
        const definitions = makeAgentStore([{id: 'ada', githubUsername: 'ada', harnessType: 'codex'}]);
        const view        = await createAccounts({
            agentDefinitionsStore: definitions,
            fleetTenantsStore    : testFleetTenantsStore,
            instanceStore        : testInstanceStore,
            boundProfileId       : 'fleet-a',
            shellCustody         : true,
            shellPlaneBase       : 'http://127.0.0.1:3102'
        });
        const
            card   = view.getReference('agent-config-card'),
            cardId = card.id;

        expect(card.agentDefinitionsStore).toBe(definitions);
        expect(card.boundProfileId).toBe('fleet-a');
        expect(JSON.stringify(card.vdom.cn)).toContain('Agent OS · 127.0.0.1:3102');

        // The existing reactive Panel configs forward a destination update in place.
        view.stateProvider.setData({boundProfileId: 'fleet-b', shellPlaneBase: 'http://127.0.0.1:4102'});
        expect(view.getReference('agent-config-card')).toBe(card);
        expect(card.id).toBe(cardId);
        expect(card.boundProfileId).toBe('fleet-b');
        expect(JSON.stringify(card.vdom.cn)).toContain('Agent OS · 127.0.0.1:4102');

        view.destroy();
        definitions.destroy()
    });

    test('an accepted definition lands in the roster and re-fires for the Viewport; the form keeps its outcome line', async () => {
        const
            store = makeAgentStore([{id: 'a', githubUsername: 'a', harnessType: 'codex'}]),
            agent = {id: 'canonical-id', githubUsername: 'canonical-login', harnessType: 'claude-desktop', updatedAt: '2026-10-01T00:00:00.000Z'};

        let view;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            const fired = [];
            view.on('agentDefinitionAccepted', data => fired.push(data));

            view.getReference('add-agent-form').fire('agentDefinitionAccepted', {agent});

            expect(store.get('canonical-id')?.githubUsername).toBe('canonical-login');
            expect(store.get('canonical-id')?.harnessType).toBe('claude-desktop');
            expect(store.get('canonical-id')?.credential).toBeUndefined();
            // the detail stays on the form, whose status line carries the outcome (a confirmed add can
            // still say "its working repository is not set")
            expect(view.adding).toBe(true);
            expect(fired).toEqual([{agent, source: view.id}]);
        } finally {
            view?.destroy();
            store.destroy()
        }
    });

    test('a definition the readback guard refuses is neither written nor re-fired', async () => {
        const
            store   = makeAgentStore([{id: 'a', githubUsername: 'a', harnessType: 'codex'}]),
            invalid = [
                {agent: {id: 'echo', githubUsername: 'echo', harnessType: 'codex', credential: 'ghp_must_not_land'}},
                {agent: {id: 'no-harness', githubUsername: 'no-harness'}},
                {}
            ];

        let view;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            const fired = [];
            view.on('agentDefinitionAccepted', data => fired.push(data));
            const form = view.getReference('add-agent-form');

            invalid.forEach(data => form.fire('agentDefinitionAccepted', data));

            expect(store.count).toBe(1);
            expect(store.get('echo')).toBeNull();
            expect(store.get('no-harness')).toBeNull();
            expect(fired).toEqual([]);
        } finally {
            view?.destroy();
            store.destroy()
        }
    });

    test('shell mode mounts the shared form without its token field', async () => {
        const
            previousOS = globalThis.AgentOS,
            bridge     = {credentialIngress: 'shell', defineAgent: async () => ({})};

        globalThis.AgentOS = {...previousOS, fleet: {...previousOS?.fleet, registryBridge: bridge}};

        let view;

        try {
            view = Neo.create(Accounts, {appName: 'AgentOSAccountsTest'});
            await view.initVnode();
            view.mounted = true;
            expect(view.getReference('add-agent-form').items.some(item => item.name === 'credential')).toBe(false)
        } finally {
            view?.destroy();
            globalThis.AgentOS = previousOS
        }
    });

    test('view source stays free of browser persistence and credential logging', () => {
        const source = fs.readFileSync(viewPath, 'utf8');

        expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
        expect(source).not.toMatch(/console\.(log|warn|error)/)
    });

    /**
     * The behavioural half, and the load-bearing one. The source check above proves the STRING
     * `localStorage` is absent from ONE FILE — a different claim from "no credential reaches browser
     * storage", and the two come apart the instant any credential handling moves into a sibling
     * module. Verified, not asserted: with a `rememberCredential()` helper extracted next to the view
     * and persisting the PAT, the source check above still passed and the suite stayed at its exact
     * 22/22 baseline. A guard aimed at a filename stops guarding the moment the code leaves the file,
     * and says nothing while it happens. This one records real writes, so it follows the credential
     * into whatever module holds it.
     *
     * Storage and console are ONE boundary, not two. The source check's sibling line makes the same
     * mistake about `console.*` that its storage line makes about `localStorage`: a `console.log(pat)`
     * inside that same extracted helper leaks the credential to logs by the identical mechanism, and
     * the same refactor blinds both guards in a single commit. Covering the storage half alone would
     * have named the defect and then reproduced it one line down. Credit: @neo-opus-grace spotted the
     * twin on review.
     *
     * Three things here are load-bearing, and the first draft of this test got all three wrong —
     * @neo-gpt falsified each against the real head:
     *
     * 1. It drives the REAL add path: `AddAgentForm#onSubmitClick` → `AddAgentFlow.submitDefineAgent`
     *    through an injected bridge, then the view's `onAddAgentAccepted` / `upsertPublicAgentDefinition`
     *    into a real store. Stubbing those seams deletes the path the credential actually crosses: a
     *    helper extracted INSIDE the real submit method persisted the PAT while all 23 specs stayed
     *    green. A witness that replaces the subject of its own claim proves nothing about it.
     * 2. The recorder is a Proxy, not a plain object. `storage[key] = value` is a real persistent
     *    write in Chromium and calls no method, so a method-only recorder watches it in silence.
     * 3. Teardown deletes an ABSENT global rather than restoring `undefined` (the hosted runner has
     *    no `sessionStorage`), and unwinds LIFO so a throw mid-install still restores what was set.
     *
     * The positive control is not decoration: a run that submits NOTHING also writes and logs
     * nothing, so without proof the accepted-add path actually executed through those real seams,
     * both empty sets are vacuous.
     */
    test('no credential byte reaches browser storage OR the console on an accepted add — real seams, behavioural', async () => {
        let view;

        const
            canonical  = {
                id            : 'resident-42',
                githubUsername: 'canonical-login',
                harnessType   : 'antigravity'
            },
            pat        = 'ghp_should_not_escape',
            writes     = [],
            logged     = [],
            fired      = [],
            store      = makeAgentStore([]),
            form       = Neo.create(AddAgentForm, {
                appName       : 'AgentOSAccountsTest',
                bridgeResolver: () => ({
                    defineAgent          : async () => canonical,
                    // a host with no existing memory: the add records `memoryImport: 'none'`
                    fleetMemoryCandidates: async () => ({capability: {state: 'wired'}, candidates: [], count: 0}),
                    setRepo              : async () => ({status: 'accepted', agent: canonical})
                })
            }),
            // Proxy-backed, not a plain object: `storage[key] = value` is a REAL persistent write in
            // Chromium and reaches no method, so a method-only recorder watches it happen in silence.
            // The trap covers the mutation surface; reads stay inert.
            recorder   = kind => new Proxy({
                clear     : ()     => writes.push([kind, 'clear']),
                getItem   : ()     => null,
                key       : ()     => null,
                length    : 0,
                removeItem: key    => writes.push([kind, 'removeItem', key]),
                setItem   : (k, v) => writes.push([kind, 'setItem', k, v])
            }, {
                defineProperty(target, key, descriptor) {
                    writes.push([kind, 'defineProperty', key, descriptor?.value]);
                    return true
                },
                set(target, key, value) {
                    writes.push([kind, 'set', key, value]);
                    return true
                }
            }),
            kinds      = ['localStorage', 'sessionStorage'],
            levels     = ['debug', 'error', 'info', 'log', 'warn'],
            // LIFO teardown. Each entry is pushed BEFORE its mutation, so a throw part-way through
            // install still unwinds everything already installed.
            undo       = [];

        view = await createAccounts({agentDefinitionsStore: store});
        view.on('agentDefinitionAccepted', data => fired.push(['agentDefinitionAccepted', data]));
        form.on('agentDefinitionAccepted', data => view.getController().onAddAgentAccepted(data));
        await form.readMemory();
        (await form.getField('githubUsername')).value = 'submitted-login';
        (await form.getField('credential')).value     = pat;

        let flowState;

        try {
            kinds.forEach(kind => {
                const original = Object.getOwnPropertyDescriptor(globalThis, kind);

                // an ABSENT global must be deleted, not restored: the hosted runner has no
                // `sessionStorage`, and defineProperty(…, undefined) throws on the way out
                undo.push(() => original ? Object.defineProperty(globalThis, kind, original) : delete globalThis[kind]);
                Object.defineProperty(globalThis, kind, {configurable: true, value: recorder(kind)})
            });

            levels.forEach(level => {
                const original = console[level];

                undo.push(() => {console[level] = original});
                console[level] = (...args) => logged.push([level, ...args])
            });

            await form.onSubmitClick();
            flowState = form.flowStatus.state
        } finally {
            undo.reverse().forEach(fn => fn());
            form.destroy()
        }

        // the positive control: the REAL seams ran to an accepted add, so empty sets mean something
        expect(flowState, 'the accepted-add path must have run through the REAL seams — otherwise both leak checks are vacuous')
            .toBe('readback-confirmed');
        expect(fired).toEqual([['agentDefinitionAccepted', {agent: canonical, source: view.id}]]);
        expect(store.get('resident-42')?.githubUsername, 'the real store must hold the canonical record').toBe('canonical-login');
        expect(store.get('resident-42')?.credential, 'and no credential byte in it').toBeUndefined();

        expect(writes, 'no credential byte may reach browser storage, from ANY module on this path').toEqual([]);
        expect(logged, 'no credential byte may reach the console, from ANY module on this path').toEqual([]);
        expect(JSON.stringify([writes, logged])).not.toContain(pat);

        view.destroy();
        store.destroy()
    });

    test('identity setup writes only the registry\'s public definition to the shared roster', () => {
        const
            source           = fs.readFileSync(viewPath, 'utf8'),
            controllerSource = fs.readFileSync(controllerPath, 'utf8');

        // upsert goes through the provider-bound roster store with the form's readback, behind the
        // flow's own guard — never a request-derived projection or a module-global singleton import.
        expect(source).toContain("agentDefinitionsStore: 'stores.agentDefinitions'");
        expect(source).toContain("fleetRosterStore     : 'stores.fleetRoster'");
        expect(source).toContain("fleetTenantsStore    : 'stores.fleetTenants'");
        expect(controllerSource).toContain('store.add(definition)');
        expect(controllerSource).toContain('AddAgentFlow.validateReadback(definition)');
        expect(controllerSource).not.toContain("from '../store/AgentDefinitions.mjs'");
        expect(controllerSource).not.toMatch(/store\.add\(\s*values/)
    })
});

test.describe('AgentOS.view.accounts.Panel — master-detail (multiple agents)', () => {
    // prototype-call rig with a REAL store attached through the REAL listener path (store
    // mutations fire their own events); list, card, form, empty state and add action are capture
    // stubs. `adding` and `selectedAgentId` are accessors that run the real afterSet hooks and, like
    // the reactive configs they mirror, skip an unchanged value.
    const makeAccounts = store => {
        const
            card  = {
                hidden      : false,
                record      : undefined,
                refreshCount: 0,
                set(config) { Object.assign(this, config) },
                refresh() { this.refreshCount++ },
                setSaveStatus(agentId, state, reason) {
                    if (this.record?.id === agentId) this.saveStatus = {agentId, state, reason}
                }
            },
            list  = {
                selected      : null,
                getItemId     : id => `item-${id}`,
                selectionModel: {
                    deselectAll() { list.selected = null },
                    isSelected(itemId) { return list.selected === itemId },
                    select(record) { list.selected = `item-${record.id}` }
                }
            },
            refs  = {
                'accounts-empty'   : {hidden: false},
                'add-agent-button' : {pressed: false},
                'add-agent-form'   : {hidden: true, set(config) { Object.assign(this, config) }},
                'agent-config-card': card,
                'agent-list'       : list
            };

        const stub = {
            // Observable keys a listener by its scope's id: an id-less scope never hears the store
            id                     : `accounts-master-detail-stub-${store.id}`,
            agentDefinitionsStore  : store,
            agentConfigSaveStatuses: new Map(),
            refs,
            afterSetAdding         : Accounts.prototype.afterSetAdding,
            afterSetSelectedAgentId: Accounts.prototype.afterSetSelectedAgentId,
            getReference           : reference => refs[reference] ?? null,
            onAddAgentClick        : Accounts.prototype.onAddAgentClick,
            onAgentListSelect      : Accounts.prototype.onAgentListSelect,
            onAgentRosterChange    : Accounts.prototype.onAgentRosterChange,
            syncDetail             : Accounts.prototype.syncDetail,
            syncSelection          : Accounts.prototype.syncSelection,
            set(values) { Object.entries(values).forEach(([key, value]) => { this[key] = value }) },

            _adding: false,
            get adding() { return this._adding },
            set adding(value) {
                const oldValue = this._adding;
                if (value === oldValue) return;
                this._adding = value;
                this.afterSetAdding(value, oldValue)
            },
            _selectedAgentId: null,
            get selectedAgentId() { return this._selectedAgentId },
            set selectedAgentId(value) {
                const oldValue = this._selectedAgentId;
                if (value === oldValue) return;
                this._selectedAgentId = value;
                this.afterSetSelectedAgentId(value, oldValue)
            }
        };

        Accounts.prototype.afterSetAgentDefinitionsStore.call(stub, store, null);

        return stub
    };

    // what the detail shows: the card or the form; whether the empty state and the add action read as on
    const detailOf = stub => ({
        card   : !stub.refs['agent-config-card'].hidden,
        form   : !stub.refs['add-agent-form'].hidden,
        empty  : !stub.refs['accounts-empty'].hidden,
        pressed: stub.refs['add-agent-button'].pressed
    });

    test('the list binds the shared store; the first agent is scoped by default', () => {
        expect(fs.readFileSync(viewPath, 'utf8')).toContain("bind     : {store: 'stores.agentDefinitions'}");

        const store = makeAgentStore([
            {id: 'neo-gpt',  githubUsername: 'neo-gpt',  harnessType: 'codex'},
            {id: 'neo-vega', githubUsername: 'neo-vega', harnessType: 'claude-desktop', displayName: 'Vega'}
        ]);
        const stub = makeAccounts(store);

        expect(stub.selectedAgentId).toBe('neo-gpt');
        expect(stub.refs['agent-config-card'].record?.id).toBe('neo-gpt');
        expect(stub.refs['agent-list'].selected).toBe('item-neo-gpt');
        expect(detailOf(stub)).toEqual({card: true, form: false, empty: false, pressed: false});

        store.destroy()
    });

    test('a definition ADDED to the store keeps the scope and refreshes the card — the Viewport upsert path fires `mutate`, not `load` (#15440)', () => {
        const store = makeAgentStore([
            {id: 'neo-gpt', githubUsername: 'neo-gpt', harnessType: 'codex'}
        ]);
        const stub     = makeAccounts(store);
        const refreshs = stub.refs['agent-config-card'].refreshCount;

        // the accepted-definition composition boundary: Viewport lands the canonical readback via
        // `store.add()` — a membership change, which fires `mutate` (`load` never fires for it)
        store.add({id: 'neo-phoebe', githubUsername: 'neo-phoebe', harnessType: 'codex'});

        expect(stub.selectedAgentId).toBe('neo-gpt');
        expect(stub.refs['agent-config-card'].refreshCount).toBeGreaterThan(refreshs);

        store.destroy()
    });

    test('picking a row scopes the card to ITS record and leaves the add form', () => {
        const store = makeAgentStore([
            {id: 'a', githubUsername: 'a', harnessType: 'codex'},
            {id: 'b', githubUsername: 'b', harnessType: 'antigravity', mcpServers: {'github-workflow': true}}
        ]);
        const stub = makeAccounts(store);

        stub.onAddAgentClick();
        stub.onAgentListSelect({records: [store.get('b')]});

        expect(stub.selectedAgentId).toBe('b');
        expect(stub.adding).toBe(false);
        expect(stub.refs['agent-config-card'].record?.id).toBe('b');
        expect(stub.refs['agent-config-card'].record?.mcpServers).toEqual({'github-workflow': true});
        expect(detailOf(stub)).toEqual({card: true, form: false, empty: false, pressed: false});

        store.destroy()
    });

    test('save feedback stays keyed to its agent across selection changes', () => {
        const store = makeAgentStore([
            {id: 'a', githubUsername: 'a', harnessType: 'codex'},
            {id: 'b', githubUsername: 'b', harnessType: 'antigravity'}
        ]);
        const stub = makeAccounts(store);
        const card = stub.refs['agent-config-card'];

        stub.agentConfigSaveStatuses.set('a', {state: 'pending', reason: 'Saving A…'});
        stub.onAgentListSelect({records: [store.get('b')]});
        expect(card.record.id).toBe('b');
        expect(card.saveStatus?.agentId).not.toBe('a');

        stub.onAgentListSelect({records: [store.get('a')]});
        expect(card.saveStatus).toEqual({agentId: 'a', state: 'pending', reason: 'Saving A…'});

        store.destroy()
    });

    test('the Repositories card is scoped with the configuration card, hides with it, and keeps its own save status', () => {
        const store = makeAgentStore([
            {id: 'a', githubUsername: 'a', harnessType: 'codex'},
            {id: 'b', githubUsername: 'b', harnessType: 'antigravity'}
        ]);
        const stub  = makeAccounts(store);
        const card  = stub.refs['agent-config-card'];
        const repos = {
            hidden      : false,
            record      : undefined,
            refreshCount: 0,
            refresh() { this.refreshCount++ },
            setSaveStatus(agentId, state, reason) {
                if (this.record?.id === agentId) this.saveStatus = {agentId, state, reason}
            }
        };

        stub.refs['agent-repos-card'] = repos;
        stub.agentReposSaveStatuses   = new Map();
        stub.setAgentReposSaveStatus  = Accounts.prototype.setAgentReposSaveStatus;

        stub.onAgentListSelect({records: [store.get('b')]});
        expect(repos.record.id).toBe('b');
        expect(card.record.id).toBe('b');

        // a refused repository list paints the Repositories card only, and comes back with its agent
        stub.setAgentReposSaveStatus('b', 'rejected', 'a repository is listed twice.');
        expect(repos.saveStatus).toEqual({agentId: 'b', state: 'rejected', reason: 'a repository is listed twice.'});
        expect(card.saveStatus?.state).not.toBe('rejected');

        stub.onAgentListSelect({records: [store.get('a')]});
        stub.onAgentListSelect({records: [store.get('b')]});
        expect(repos.saveStatus).toEqual({agentId: 'b', state: 'rejected', reason: 'a repository is listed twice.'});

        stub.onAddAgentClick();
        expect(repos.hidden).toBe(true);
        expect(card.hidden).toBe(true);

        // the provider's fleet roster reaches the card as the exact instance it reads outcomes from
        const roster = {};

        Accounts.prototype.afterSetFleetRosterStore.call(stub, roster);
        expect(repos.rosterStore).toBe(roster);

        store.destroy()
    });

    test('roster changes flow through the REAL store listener: removing the scoped agent falls back to the first', () => {
        const store = makeAgentStore([{id: 'a', githubUsername: 'a', harnessType: 'codex'}]);
        const stub  = makeAccounts(store);

        store.add({id: 'b', githubUsername: 'b', harnessType: 'codex'});
        stub.onAgentListSelect({records: [store.get('b')]});
        store.remove('b');

        // the scoped agent vanished — fail toward the first resident, never a dangling scope
        expect(stub.selectedAgentId).toBe('a');
        expect(stub.refs['agent-config-card'].record?.id).toBe('a');
        expect(stub.refs['agent-list'].selected).toBe('item-a');

        store.destroy()
    });

    test('New agent shows the form with no row selected, and a roster change leaves it up', () => {
        const store = makeAgentStore([{id: 'a', githubUsername: 'a', harnessType: 'codex'}]);
        const stub  = makeAccounts(store);

        stub.onAddAgentClick();

        expect(stub.selectedAgentId).toBeNull();
        expect(stub.refs['agent-list'].selected).toBeNull();
        expect(detailOf(stub)).toEqual({card: false, form: true, empty: false, pressed: true});

        // a roster refresh mid-add (a peer's definition landing) must not yank the operator out of the form
        store.add({id: 'b', githubUsername: 'b', harnessType: 'codex'});

        expect(stub.selectedAgentId).toBeNull();
        expect(detailOf(stub)).toEqual({card: false, form: true, empty: false, pressed: true});

        store.destroy()
    });

    test('the first add from an empty roster keeps the form, and its outcome line, up', async () => {
        const store = makeAgentStore([]);
        let view;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            view.getReference('add-agent-form').fire('agentDefinitionAccepted', {
                agent: {id: 'first', githubUsername: 'first', harnessType: 'codex'}
            });

            // the store listener ran (the agent is listed) without taking the scope away from the form
            expect(store.get('first')).not.toBeNull();
            expect(view.selectedAgentId).toBeNull();
            expect(detailOf({refs: Object.fromEntries([
                'agent-config-card', 'agent-repos-card', 'add-agent-form', 'accounts-empty', 'add-agent-button'
            ].map(ref => [ref, view.getReference(ref)]))})).toEqual({card: false, form: true, empty: false, pressed: true});
        } finally {
            view?.destroy();
            store.destroy()
        }
    });

    test('an empty roster opens on the form and says so; a hydrated first definition takes the scope', () => {
        const store = makeAgentStore([]);
        const stub  = makeAccounts(store);

        expect(stub.selectedAgentId).toBeNull();
        expect(detailOf(stub)).toEqual({card: false, form: true, empty: true, pressed: true});

        store.add({id: 'a', githubUsername: 'a', harnessType: 'codex'});

        expect(stub.selectedAgentId).toBe('a');
        expect(detailOf(stub)).toEqual({card: true, form: false, empty: false, pressed: false});

        store.destroy()
    });

});

// The cycle-2 review's falsifier, covered with REAL objects: a recordChange mutates fields
// WITHOUT changing record identity, and the reactive `record` config suppresses same-identity
// assignments — the card must still re-render (refresh), and the intent path must fire from the
// real vdom-derived ids.
test.describe('AgentOS.view.AgentConfigCard — live same-record propagation + configIntent (real objects)', () => {
    let AgentConfigCard, AgentDefinition, FleetTenants, Store, savedAgentOS;

    test.beforeAll(async () => {
        AgentConfigCard = (await import('../../../../../apps/agentos/view/fleet/detail/AgentConfigComponent.mjs')).default;
        AgentDefinition = (await import('../../../../../apps/agentos/model/AgentDefinition.mjs')).default;
        FleetTenants    = (await import('../../../../../apps/agentos/store/FleetTenants.mjs')).default;
        Store           = (await import('../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
    });

    // AgentOS is the APP NAMESPACE (every registered AgentOS.* class lives under it). The bridge
    // stubs below replace it wholesale for their window — fine in-test (nothing here resolves an
    // app class by name) — but it must be RESTORED, never deleted: under fullyParallel a worker
    // interleaves tests from OTHER files, and a deleted namespace makes any later `Neo.create`
    // of an AgentOS view in that worker fail with "Class … does not exist".
    test.beforeEach(() => { savedAgentOS = globalThis.AgentOS });
    test.afterEach(()  => { globalThis.AgentOS = savedAgentOS });

    const cardText = card => JSON.stringify(card.vdom.cn);

    test('a same-record field change re-renders the card through refresh() — the stale-state falsifier', () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'vega', githubUsername: 'vega', harnessType: 'codex', hooksActive: null}
        ]});
        const record = store.get('vega');
        const card   = Neo.create(AgentConfigCard, {record});

        const unreadRows = () => (cardText(card).match(/Not read back yet/g) || []).length;

        expect(unreadRows()).toBe(2); // Hooks + Wake subscriptions both unobserved

        // the review's exact schedule: mutate the SAME record instance, then the same-identity
        // assignment path (suppressed by the reactive config) — refresh() must close the gap
        record.set({hooksActive: true});
        card.record = record;   // suppressed: identity unchanged
        card.refresh();         // the owning view's roster-change hook

        expect(unreadRows()).toBe(1); // Hooks now renders its observed state...
        expect(cardText(card)).toContain('"text":"Hooks"'); // ...as the On row
        expect(cardText(card)).toMatch(/"text":"Hooks"\},\{"cls":\["fm-config-value"\],"text":"On"/);

        // reselection / teardown leaves no stale state behind
        card.record = null;
        expect(cardText(card)).toContain('Select an agent');

        card.destroy();
        store.destroy()
    });

    test('server-row and harness-chip clicks fire the flat sparse intent; pending blocks overlap', () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex', mcpServers: {'memory-core': true}}
        ]});
        const record  = store.get('ada');
        const card    = Neo.create(AgentConfigCard, {record});
        const intents = [];

        card.on('configIntent', data => intents.push(data));

        // the vdom-derived row ids ARE the click contract
        card.onCardClick({path: [{id: `${card.id}__srv__memory-core`}]});
        card.onCardClick({path: [{id: `${card.id}__harness__claude-code`}]});
        card.onCardClick({path: [{id: `${card.id}__harness__codex`}]});      // same harness → no intent
        card.onCardClick({path: [{id: `${card.id}__product__codex`}]});      // same product → no intent
        card.onCardClick({path: [{id: `${card.id}__product__claude`}]});     // a product keeps the run mode: Codex CLI → Claude Code
        card.onCardClick({path: [{id: `${card.id}__product__unknown`}]});    // no such product → no intent
        card.onCardClick({path: [{id: 'unrelated-node'}]});                  // off-card → no intent

        expect(intents.length).toBe(3);
        expect(intents[0]).toMatchObject({id: 'ada', mcpServers: {'memory-core': false}});
        expect(intents[1]).toMatchObject({id: 'ada', harnessType: 'claude-code'});
        expect(intents[2]).toMatchObject({id: 'ada', harnessType: 'claude-code'});
        expect(intents[0].source).toBe(card.id); // event envelope exists; Accounts strips it before wire

        card.setSaveStatus('ada', 'pending', 'Saving configuration…');
        card.onCardClick({path: [{id: `${card.id}__srv__memory-core`}]});
        expect(intents).toHaveLength(3);
        expect(cardText(card)).toContain('Saving configuration');

        // Returning the sole override to its live default emits null, never a resolved matrix.
        card.setSaveStatus('ada', 'idle');
        record.set({mcpServers: {'memory-core': false}});
        card.refresh();
        card.onCardClick({path: [{id: `${card.id}__srv__memory-core`}]});
        expect(intents[3]).toMatchObject({id: 'ada', mcpServers: null});

        // the record itself is untouched — the owning view writes only from the bridge RESPONSE
        expect(record.mcpServers).toEqual({'memory-core': false});
        expect(record.harnessType).toBe('codex');

        card.destroy();
        store.destroy()
    });

    test('a GitLab definition renders its forge defaults and a workflow toggle survives backend readback', () => {
        const
            store   = makeAgentStore([{id: 'gitlab', forge: 'gitlab', harnessType: 'codex', mcpServers: null}]),
            record  = store.get('gitlab'),
            card    = Neo.create(AgentConfigCard, {record}),
            intents = [],
            catalog = mcpCatalogFor('gitlab'),
            find    = (node, id) => node?.id === id ? node : (node?.cn || []).map(child => find(child, id)).find(Boolean),
            row     = key => find(card.vdom, `${card.id}__srv__${key}`);

        card.on('configIntent', intent => intents.push(intent));
        expect(row('gitlab-workflow').cls).toContain('is-enabled');
        expect(row('github-workflow').cls).toContain('is-disabled');

        card.onCardClick({path: [{id: `${card.id}__srv__gitlab-workflow`}]});
        expect(intents[0]).toMatchObject({id: 'gitlab', mcpServers: {'gitlab-workflow': false}});
        expect(record.mcpServers).toBeNull();

        record.set({forge: 'gitlab', mcpServers: normalizeMcpOverrides(intents[0].mcpServers, catalog)});
        card.refresh();
        expect(row('gitlab-workflow').cls).toContain('is-disabled');
        expect(resolveMcpMatrix(record.mcpServers, catalog)['gitlab-workflow']).toBe(false);

        card.onCardClick({path: [{id: `${card.id}__srv__gitlab-workflow`}]});
        expect(intents[1]).toMatchObject({id: 'gitlab', mcpServers: null});
        card.destroy();
        store.destroy()
    });

    test('an unrelated server toggle preserves an explicit GitLab workflow disable', () => {
        const
            store   = makeAgentStore([{id: 'gitlab', forge: 'gitlab', harnessType: 'codex', mcpServers: {'gitlab-workflow': false}}]),
            record  = store.get('gitlab'),
            card    = Neo.create(AgentConfigCard, {record}),
            intents = [],
            catalog = mcpCatalogFor('gitlab');

        card.on('configIntent', intent => intents.push(intent));
        card.onCardClick({path: [{id: `${card.id}__srv__neural-link`}]});
        expect(intents[0]).toMatchObject({id: 'gitlab', mcpServers: {'neural-link': false, 'gitlab-workflow': false}});

        const readback = normalizeMcpOverrides(intents[0].mcpServers, catalog);
        record.set({forge: 'gitlab', mcpServers: readback});
        expect(resolveMcpMatrix(record.mcpServers, catalog)['gitlab-workflow']).toBe(false);
        card.destroy();
        store.destroy()
    });

    test('launch ownership is declared: the recorded owner selected, adoption the one act; a fleet seat is not offered back, and an unreported owner offers none', () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada',   githubUsername: 'ada',   harnessType: 'codex', launchOwner: 'external'},
            {id: 'grace', githubUsername: 'grace', harnessType: 'codex', launchOwner: 'fleet'},
            {id: 'old',   githubUsername: 'old',   harnessType: 'codex'}
        ]});
        const card     = Neo.create(AgentConfigCard, {record: store.get('ada')});
        const intents  = [];
        const findNode = (node, id) => node?.id === id ? node : (node?.cn || []).map(child => findNode(child, id)).find(Boolean);

        card.on('configIntent', data => intents.push(data));

        expect(cardText(card)).toContain('Launched by · declared');
        expect(findNode(card.vdom, `${card.id}__launch__external`).cls).toContain('is-selected');
        expect(findNode(card.vdom, `${card.id}__launch__fleet`).cls).toContain('is-selectable');
        expect(findNode(card.vdom, `${card.id}__launch__fleet`).title).toContain('do not also run it by hand');
        expect(findNode(card.vdom, `${card.id}__launch__external`).title).toContain('Unless the fleet has run it before');

        card.onCardClick({path: [{id: `${card.id}__launch__external`}]});   // the recorded owner → no intent
        card.onCardClick({path: [{id: `${card.id}__launch__fleet`}]});
        card.onCardClick({path: [{id: `${card.id}__launch__anyone`}]});     // not an owner → no intent

        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({id: 'ada', launchOwner: 'fleet'});
        expect(store.get('ada').launchOwner).toBe('external');              // only the bridge RESPONSE writes

        // a release would not stop a fleet that has run the seat from starting it again: never offered
        card.record = store.get('grace');
        expect(findNode(card.vdom, `${card.id}__launch__fleet`).cls).toContain('is-selected');
        expect(findNode(card.vdom, `${card.id}__launch__external`)).toBeUndefined();
        card.onCardClick({path: [{id: `${card.id}__launch__external`}]});
        expect(intents).toHaveLength(1);

        card.record = store.get('old');
        expect(cardText(card)).not.toContain('__launch__');
        expect(cardText(card)).toContain('"text":"Not reported"');

        card.destroy();
        store.destroy()
    });

    test('a server row names the registry as its authority — never a bare Off implying observation (#17306)', () => {
        // The incident: this seat had filed four issues through its github-workflow server within the
        // hour while the pane rendered `GitHub workflow: Off`. The registry declaration was all the
        // pane knew, and a bare `Off` claimed an observation nobody made.
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'clio', githubUsername: 'clio', harnessType: 'codex', mcpServers: {'github-workflow': false, 'memory-core': true}}
        ]});
        const card = Neo.create(AgentConfigCard, {record: store.get('clio')});
        const text = cardText(card);

        expect(text).toContain('"text":"Declared off"');
        expect(text).toContain('"text":"Declared on"');

        // The falsifier for the actual defect: no server row may render the bare observation words.
        // Asserting only the presence of "Declared off" would pass while a sibling row still lied.
        expect(text).not.toMatch(/"cls":\["fm-config-value"\],"text":"Off"/);

        // The section carries the authority too, so the grain is readable without parsing each row.
        expect(text).toContain('Servers · declared');
        expect(text).toContain('Memory & knowledge');

        card.destroy();
        store.destroy()
    });

    test('read-back rows keep the plain state words — the fix must not relabel observations (#17306)', () => {
        // Negative control. Marking every row "declared" would satisfy the assertion above and destroy
        // the distinction the ticket exists to create: Operations rows ARE read back, and an observed
        // `On` must stay an observed `On`.
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'vega', githubUsername: 'vega', harnessType: 'codex', hooksActive: true, wakeSubscriptionsActive: null}
        ]});
        const card = Neo.create(AgentConfigCard, {record: store.get('vega')});
        const text = cardText(card);

        expect(text).toMatch(/"text":"Hooks"\},\{"cls":\["fm-config-value"\],"text":"On"/);
        expect(text).toContain('Not read back yet');
        expect(text).toContain('Operations · read back');

        // and the observed row never borrows the declared vocabulary
        expect(text).not.toMatch(/"text":"Hooks"\},\{"cls":\["fm-config-value"\],"text":"Declared/);

        card.destroy();
        store.destroy()
    });

    test('the bound destination is primary; explicit connection editing retains stable native controls', () => {
        const
            store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [{
                id: 'ada', githubUsername: 'ada', harnessType: 'codex'
            }]}),
            tenants = Neo.create(FleetTenants, {data: [{
                id             : 'tenant-a',
                endpoint       : 'https://tenant-a.example.com/agentos',
                status         : 'connected',
                deploymentClass: 'cloud-tenant',
                connectedAt    : '2026-07-27T00:00:00.000Z',
                credential     : 'must-never-enter-the-model'
            }, {
                id      : 'tenant-b',
                endpoint: 'https://tenant-b.example.com/agentos',
                status  : 'disconnected'
            }]}),
            record  = store.get('ada'),
            card    = Neo.create(AgentConfigCard, {
                record,
                agentDefinitionsStore: store,
                tenantStore          : tenants,
                shellCustody         : true,
                shellPlaneBase       : 'https://fleet.example.com/agentos'
            }),
            intents = [];

        card.on('configIntent', intent => intents.push(intent));

        const find      = (node, id) => node?.id === id ? node : (node?.cn || []).reduce((hit, child) => hit || find(child, id), null);
        const buttonIds = () => {
            const collect = (node, ids=[]) => {
                node?.id?.startsWith(`${card.id}__`) && node.tag === 'button' && ids.push(node.id);
                node?.cn?.forEach(child => collect(child, ids));
                return ids.sort()
            };

            return collect(card.vdom)
        };

        expect(cardText(card)).toContain('Agent OS · fleet.example.com/agentos');
        expect(find(card.vdom, `${card.id}__target__local`)).toBeNull();
        expect(find(card.vdom, `${card.id}__target__tenant-a`)).toBeNull();
        expect(find(card.vdom, `${card.id}__connection__edit`).tag).toBe('button');
        expect(cardText(card)).not.toContain('Plane credential');
        expect(cardText(card)).not.toContain('This fleet ·');

        const beforeOpenIds = buttonIds();
        card.onCardClick({path: [{id: `${card.id}__connection__edit`}]});

        // The competing target list only enters the DOM after the explicit edit action.
        // the chip carries the card's name for the bound Agent OS; the full address is its hover
        expect(find(card.vdom, `${card.id}__target__local`)?.text).toBe('This fleet · fleet.example.com/agentos');
        expect(find(card.vdom, `${card.id}__target__local`)?.title).toBe('https://fleet.example.com/agentos');
        expect(cardText(card)).toContain('Saved connection · https://tenant-a.example.com/agentos');
        expect(cardText(card)).toContain('Saved connection · https://tenant-b.example.com/agentos · Unavailable');
        expect(cardText(card)).not.toContain('must-never-enter-the-model');
        expect(cardText(card)).not.toMatch(/Authorization|Bearer|credentialEnvVar/);
        expect(tenants.get('tenant-a').credential).toBeUndefined();

        const editableIds = buttonIds();
        expect(editableIds.length).toBeGreaterThan(beforeOpenIds.length);
        expect(editableIds.every(id => find(card.vdom, id)?.tag === 'button')).toBe(true);

        card.onCardClick({path: [{id: `${card.id}__target__tenant-a`}]});
        card.onCardClick({path: [{id: `${card.id}__target__tenant-b`}]});

        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({
            id       : 'ada',
            mcpTarget: {kind: 'tenant', tenantId: 'tenant-a'}
        });
        expect(record.mcpTarget).toBeNull();

        record.set({mcpTarget: {kind: 'tenant', tenantId: 'tenant-a'}});
        expect(cardText(card)).toContain('Saved connection · https://tenant-a.example.com/agentos');
        card.onCardClick({path: [{id: `${card.id}__target__local`}]});

        expect(intents[1]).toMatchObject({id: 'ada', mcpTarget: null});
        expect(record.mcpTarget).toEqual({kind: 'tenant', tenantId: 'tenant-a'});

        // VDOM refreshes for each transport state preserve the same native control ids, so a browser
        // can keep focus on the triggering button through pending, acceptance, and rejection.
        const stableIds = buttonIds();
        for (const state of ['pending', 'accepted', 'rejected']) {
            card.setSaveStatus('ada', state, state === 'rejected' ? 'Configuration was rejected.' : 'Saving configuration…');
            expect(buttonIds()).toEqual(stableIds);
            expect(stableIds.every(id => find(card.vdom, id)?.tag === 'button')).toBe(true)
        }

        card.destroy();
        tenants.destroy();
        store.destroy()
    });

    test('unsupported, disconnected, and missing saved targets stay visible but inert', () => {
        const
            store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [{
                id            : 'desktop',
                githubUsername: 'desktop',
                harnessType   : 'antigravity',
                mcpTarget     : {kind: 'tenant', tenantId: 'missing-tenant'}
            }]}),
            tenants = Neo.create(FleetTenants, {data: [{
                id      : 'connected',
                endpoint: 'https://connected.example.com',
                status  : 'connected'
            }, {
                id      : 'offline',
                endpoint: 'https://offline.example.com',
                status  : 'disconnected'
            }]}),
            card    = Neo.create(AgentConfigCard, {
                record               : store.get('desktop'),
                agentDefinitionsStore: store,
                tenantStore          : tenants
            }),
            intents = [];

        card.on('configIntent', intent => intents.push(intent));
        card.onCardClick({path: [{id: `${card.id}__connection__edit`}]});

        expect(cardText(card)).toContain('Unavailable for this harness');
        expect(cardText(card)).toContain('Saved connection unavailable · missing-tenant');

        card.onCardClick({path: [{id: `${card.id}__target__connected`}]});
        card.onCardClick({path: [{id: `${card.id}__target__offline`}]});
        card.onCardClick({path: [{id: `${card.id}__target__missing-tenant`}]});

        expect(intents).toEqual([]);

        card.destroy();
        tenants.destroy();
        store.destroy()
    });

    test('a saved tenant owned by another seat stays visible, explains its owner, and emits no intent', () => {
        const
            store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [{
                id: 'ada', githubUsername: 'ada', harnessType: 'codex'
            }, {
                id       : 'sophie', githubUsername: 'sophie', displayName: 'Sophie', harnessType: 'codex',
                mcpTarget: {kind: 'tenant', tenantId: 'tenant-a'}
            }]}),
            tenants = Neo.create(FleetTenants, {data: [{
                id: 'tenant-a', endpoint: 'http://127.0.0.1:3102', status: 'connected'
            }]}),
            card = Neo.create(AgentConfigCard, {
                record               : store.get('ada'),
                agentDefinitionsStore: store,
                tenantStore          : tenants,
                shellCustody         : true,
                shellPlaneBase       : 'http://127.0.0.1:3102'
            }),
            intents = [],
            find = (node, id) => node?.id === id ? node : (node?.cn || []).reduce((hit, child) => hit || find(child, id), null),
            targetId = `${card.id}__target__tenant-a`;

        card.on('configIntent', intent => intents.push(intent));
        card.onCardClick({path: [{id: `${card.id}__connection__edit`}]});

        const unavailable = find(card.vdom, targetId);
        expect(unavailable.text).toContain('In use by Sophie');
        expect(unavailable['aria-disabled']).toBe('true');
        expect(unavailable.tag).toBe('button');
        expect(cardText(card)).toContain('Agent OS · 127.0.0.1:3102');

        card.onCardClick({path: [{id: targetId}]});
        expect(intents).toEqual([]);

        // A release in the same shared Store immediately refreshes the retained editor row.
        store.get('sophie').set({mcpTarget: null});
        const available = find(card.vdom, targetId);
        expect(available.cls).toContain('is-selectable');
        expect(available['aria-disabled']).toBe('false');

        card.onCardClick({path: [{id: targetId}]});
        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({id: 'ada', mcpTarget: {kind: 'tenant', tenantId: 'tenant-a'}});
        expect(store.get('ada').mcpTarget).toBeNull(); // readback remains the only record writer

        // Once canonical readback names Ada as the owner, her choice stays selected and retained.
        store.get('ada').set({mcpTarget: {kind: 'tenant', tenantId: 'tenant-a'}});
        const selected = find(card.vdom, targetId);
        expect(selected.cls).toContain('is-selected');
        expect(selected['aria-pressed']).toBe('true');
        expect(selected['aria-disabled']).toBe('false');

        // A same-agent canonical readback keeps the editor open; switching to another identity closes it.
        card.record = {
            id        : 'ada', githubUsername: 'ada', harnessType: 'codex',
            mcpTarget : {kind: 'tenant', tenantId: 'tenant-a'},
            statusText: 'canonical refresh'
        };
        expect(card.connectionEditing).toBe(true);
        expect(find(card.vdom, targetId)).toBeTruthy();
        card.record = store.get('sophie');
        expect(card.connectionEditing).toBe(false);
        expect(find(card.vdom, targetId)).toBeNull();

        card.destroy();
        tenants.destroy();
        store.destroy()
    });

    test('an empty but unhydrated definitions Store cannot authorize a new saved-tenant target', () => {
        const
            definitions = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition}),
            tenants     = Neo.create(FleetTenants, {data: [{
                id: 'tenant-a', endpoint: 'https://tenant-a.example.com', status: 'connected'
            }, {
                id: 'tenant-b', endpoint: 'https://tenant-b.example.com', status: 'connected'
            }]}),
            record = {id: 'ada', githubUsername: 'ada', harnessType: 'codex', mcpTarget: {kind: 'tenant', tenantId: 'tenant-a'}},
            card = Neo.create(AgentConfigCard, {
                record,
                agentDefinitionsStore: definitions,
                tenantStore          : tenants
            }),
            intents = [],
            find = (node, id) => node?.id === id ? node : (node?.cn || []).reduce((hit, child) => hit || find(child, id), null),
            selectedId = `${card.id}__target__tenant-a`,
            newTargetId = `${card.id}__target__tenant-b`;

        card.on('configIntent', intent => intents.push(intent));
        card.onCardClick({path: [{id: `${card.id}__connection__edit`}]});
        expect(definitions.data).toBeNull();
        expect(find(card.vdom, selectedId).text).toContain('Assignment not read back');
        expect(find(card.vdom, selectedId)['aria-pressed']).toBe('true');
        expect(find(card.vdom, newTargetId)['aria-disabled']).toBe('true');

        card.onCardClick({path: [{id: newTargetId}]});
        expect(intents).toEqual([]);

        definitions.data = [{id: 'ada', githubUsername: 'ada', harnessType: 'codex', mcpTarget: {kind: 'tenant', tenantId: 'tenant-a'}}];
        expect(find(card.vdom, newTargetId)['aria-disabled']).toBe('false');

        // A saved target already selected before hydration remains truthfully selected.
        expect(find(card.vdom, selectedId)['aria-pressed']).toBe('true');

        card.destroy();
        tenants.destroy();
        definitions.destroy()
    });

    test('the local target is non-actionable when no bound Agent OS is available', () => {
        const
            store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [{
                id       : 'ada', githubUsername: 'ada', harnessType: 'codex',
                mcpTarget: {kind: 'tenant', tenantId: 'saved-a'}
            }]}),
            tenants = Neo.create(FleetTenants, {data: []}),
            card = Neo.create(AgentConfigCard, {
                record               : store.get('ada'),
                agentDefinitionsStore: store,
                tenantStore          : tenants
            }),
            intents = [],
            find = (node, id) => node?.id === id ? node : (node?.cn || []).reduce((hit, child) => hit || find(child, id), null);

        card.on('configIntent', intent => intents.push(intent));
        card.onCardClick({path: [{id: `${card.id}__connection__edit`}]});

        const localChoice = find(card.vdom, `${card.id}__target__local`);
        expect(localChoice['aria-disabled']).toBe('true');

        card.onCardClick({path: [{id: `${card.id}__target__local`}]});
        expect(intents).toEqual([]);
        expect(store.get('ada').mcpTarget).toEqual({kind: 'tenant', tenantId: 'saved-a'});

        card.destroy();
        tenants.destroy();
        store.destroy()
    });

    test('tenant Store record changes refresh target availability without reseating the Store', () => {
        const
            store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [{
                id: 'ada', githubUsername: 'ada', harnessType: 'codex'
            }]}),
            tenants = Neo.create(FleetTenants, {data: [{
                id: 'tenant-a', endpoint: 'https://tenant.example.com', status: 'connected'
            }]}),
            card = Neo.create(AgentConfigCard, {
                record               : store.get('ada'),
                agentDefinitionsStore: store,
                tenantStore          : tenants
            });

        card.onCardClick({path: [{id: `${card.id}__connection__edit`}]});

        expect(cardText(card)).not.toContain('https://tenant.example.com · Unavailable');

        tenants.get('tenant-a').set({status: 'disconnected'});

        expect(cardText(card)).toContain('https://tenant.example.com · Unavailable');

        card.destroy();
        tenants.destroy();
        store.destroy()
    });

    test('superseded is non-latching: the losing surface can immediately correct (#15440)', () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        const card    = Neo.create(AgentConfigCard, {record: store.get('ada')});
        const intents = [];

        card.on('configIntent', data => intents.push(data));

        // pending is the ONLY latching state — a mid-flight save blocks overlap…
        card.setSaveStatus('ada', 'pending', 'Saving configuration…');
        card.onCardClick({path: [{id: `${card.id}__harness__claude-code`}]});
        expect(intents).toHaveLength(0);

        // …but a surface whose request lost to ANOTHER owner's newer change is told so and must
        // stay correctable: a chip latched at pending forever would be a dead affordance
        card.setSaveStatus('ada', 'superseded', 'Superseded by a newer change from another surface.');
        expect(cardText(card)).toContain('Superseded by a newer change');

        card.onCardClick({path: [{id: `${card.id}__harness__claude-code`}]});
        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({id: 'ada', harnessType: 'claude-code'});

        card.destroy();
        store.destroy()
    });

    test('the Accounts round-trip writes the bridge RESPONSE onto the record and reports honestly', async () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        const priorAgentOS = globalThis.AgentOS;
        let view;

        try {
            // Stores are present before the bridge, so construction-time reads fail closed.
            view = await createAccounts({agentDefinitionsStore: store});
            const
                controller    = view.getController(),
                card          = view.getReference('agent-config-card'),
                saveStatuses  = [],
                setSaveStatus = card.setSaveStatus.bind(card);

            card.setSaveStatus = (...args) => {
                saveStatuses.push(args);
                setSaveStatus(...args)
            };

            // no bridge → fail closed, nothing mutates
            delete globalThis.AgentOS;
            await controller.onAgentConfigIntent({id: 'ada', harnessType: 'claude-code'});
            expect(store.get('ada').harnessType).toBe('codex');

            // The real card event is wired to the controller; the canonical RESPONSE lands on the Store.
            let received;
            globalThis.AgentOS = {fleet: {registryBridge: {
                configureAgent: async intent => {
                    received = intent;
                    return {status: 'accepted', agent: {
                        id: 'ada', harnessType: 'native-neo', mcpServers: {'neural-link': false}
                    }}
                },
                setRepos: async () => ({status: 'rejected', reason: 'Repository was refused.'})
            }}};

            card.fire('configIntent', {id: 'ada', harnessType: 'claude-code'});
            await new Promise(resolve => setTimeout(resolve, 0));

            const record = store.get('ada');
            expect(received).toEqual({id: 'ada', harnessType: 'claude-code'});
            expect(record.harnessType).toBe('native-neo'); // response, not request
            expect(record.mcpServers).toEqual({'neural-link': false});
            const states = saveStatuses.map(entry => entry[1]);
            expect(states.filter((state, index) => state !== states[index - 1]))
                .toEqual(['pending', 'rejected', 'pending', 'accepted']);

            await controller.onAgentReposIntent({id: 'ada', repos: []});
            expect(view.agentConfigSaveStatuses.get('ada')).toMatchObject({state: 'accepted', reason: 'Configuration saved.'});
            expect(view.agentReposSaveStatuses.get('ada')).toMatchObject({state: 'rejected', reason: 'Repository was refused.'});
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            store.destroy()
        }
    });

    test('a stale out-of-order save response cannot regress the newer canonical readback', async () => {
        const
            store    = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
                {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
            ]}),
            deferred = [],
            priorAgentOS = globalThis.AgentOS;
        let view;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            const controller = view.getController();
            globalThis.AgentOS = {fleet: {registryBridge: {configureAgent: intent => new Promise(resolve => {
                deferred.push({intent, resolve})
            })}}};

            const older = controller.onAgentConfigIntent({id: 'ada', harnessType: 'claude-code'});
            // Simulate a non-card caller bypassing the pending UI latch: the generation guard is the
            // final defense when two transport responses still overlap.
            view.agentConfigSaveStatuses.set('ada', {state: 'idle', reason: ''});
            const newer = controller.onAgentConfigIntent({id: 'ada', harnessType: 'native-neo'});

            deferred[1].resolve({status: 'accepted', agent: {id: 'ada', harnessType: 'native-neo', mcpServers: null}});
            await newer;
            deferred[0].resolve({status: 'accepted', agent: {id: 'ada', harnessType: 'claude-code', mcpServers: null}});
            await older;

            expect(deferred.map(entry => entry.intent.harnessType)).toEqual(['claude-code', 'native-neo']);
            expect(store.get('ada').harnessType).toBe('native-neo');
            expect(view.agentConfigSaveStatuses.get('ada').state).toBe('accepted');
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            store.destroy()
        }
    });

    test('a rejected domain outcome renders its reason and leaves the real record untouched', async () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        const priorAgentOS = globalThis.AgentOS;
        let view;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            const
                card          = view.getReference('agent-config-card'),
                saveStatuses  = [],
                setSaveStatus = card.setSaveStatus.bind(card);

            card.setSaveStatus = (...args) => {
                saveStatuses.push(args);
                setSaveStatus(...args)
            };
            globalThis.AgentOS = {fleet: {registryBridge: {configureAgent: async () => ({
                status: 'rejected', reason: "Unknown MCP server 'bogus'."
            })}}};

            await view.getController().onAgentConfigIntent({id: 'ada', mcpServers: {bogus: true}});

            expect(store.get('ada').harnessType).toBe('codex');
            expect(saveStatuses.at(-1)).toEqual(['ada', 'rejected', "Unknown MCP server 'bogus'."]);
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            store.destroy()
        }
    });

    test('cold hydration replaces the store from canonical listAgents; failure preserves last state', async () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'stale', githubUsername: 'stale', harnessType: 'codex'}
        ]});
        const priorAgentOS = globalThis.AgentOS;
        let view;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            globalThis.AgentOS = {fleet: {registryBridge: {listAgents: async () => [{
                id: 'canonical', githubUsername: 'canonical', harnessType: 'claude-code', mcpServers: {'memory-core': false}
            }]}}};
            await expect(view.getController().loadAgentDefinitions()).resolves.toBe(true);
            expect(store.get('stale')).toBeNull();
            expect(store.get('canonical').mcpServers).toEqual({'memory-core': false});

            globalThis.AgentOS.fleet.registryBridge.listAgents = async () => { throw new Error('offline') };
            await expect(view.getController().loadAgentDefinitions()).resolves.toBe(false);
            expect(store.get('canonical').harnessType).toBe('claude-code');
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            store.destroy()
        }
    });

    test('tenant hydration curates public fields and preserves last-known rows on malformed or failed reads', async () => {
        const
            tenants = Neo.create(FleetTenants, {data: [{
                id: 'placeholder', endpoint: 'https://placeholder.example.com', status: 'connected'
            }]}),
            priorAgentOS = globalThis.AgentOS;
        let view;

        try {
            view = await createAccounts({fleetTenantsStore: tenants});
            globalThis.AgentOS = {fleet: {registryBridge: {listTenants: async () => [{
                id             : 'tenant-a',
                endpoint       : 'https://tenant.example.com/agentos',
                status         : 'connected',
                deploymentClass: 'cloud-tenant',
                connectedAt    : '2026-07-27T00:00:00.000Z',
                credential     : 'must-not-cross',
                headers        : {Authorization: 'Bearer secret'}
            }]}}};

            await expect(view.getController().loadFleetTenants()).resolves.toBe(true);
            expect(tenants.get('placeholder')).toBeNull();
            expect(tenants.get('tenant-a').toJSON()).toEqual({
                id             : 'tenant-a',
                endpoint       : 'https://tenant.example.com/agentos',
                status         : 'connected',
                deploymentClass: 'cloud-tenant',
                connectedAt    : '2026-07-27T00:00:00.000Z'
            });
            expect(JSON.stringify(tenants.get('tenant-a'))).not.toContain('must-not-cross');
            expect(JSON.stringify(tenants.get('tenant-a'))).not.toContain('Authorization');

            globalThis.AgentOS.fleet.registryBridge.listTenants = async () => [{id: 'broken'}];
            await expect(view.getController().loadFleetTenants()).resolves.toBe(false);
            expect(tenants.get('tenant-a').status).toBe('connected');

            globalThis.AgentOS.fleet.registryBridge.listTenants = async () => { throw new Error('offline') };
            await expect(view.getController().loadFleetTenants()).resolves.toBe(false);
            expect(tenants.get('tenant-a').endpoint).toBe('https://tenant.example.com/agentos');
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            tenants.destroy()
        }
    });

    test('only the newest tenant-list response may replace the provider Store', async () => {
        const
            tenants  = Neo.create(FleetTenants, {data: [{
                id: 'kept', endpoint: 'https://kept.example.com', status: 'connected'
            }]}),
            deferred = [],
            priorAgentOS = globalThis.AgentOS;
        let view;

        try {
            view = await createAccounts({fleetTenantsStore: tenants});
            globalThis.AgentOS = {fleet: {registryBridge: {listTenants: () => new Promise(resolve => {
                deferred.push(resolve)
            })}}};

            const older = view.getController().loadFleetTenants();
            const newer = view.getController().loadFleetTenants();

            deferred[1]([{
                id: 'newer', endpoint: 'https://newer.example.com', status: 'connected'
            }]);
            await expect(newer).resolves.toBe(true);

            deferred[0]([{
                id: 'older', endpoint: 'https://older.example.com', status: 'connected'
            }]);
            await expect(older).resolves.toBe(false);

            expect(tenants.get('newer')).not.toBeNull();
            expect(tenants.get('older')).toBeNull();
            expect(tenants.get('kept')).toBeNull();
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            tenants.destroy()
        }
    });

    test('a replaced definitions or tenant Store rejects the old in-flight read', async () => {
        const
            definitions     = makeAgentStore([{id: 'kept-definition', githubUsername: 'kept', harnessType: 'codex'}]),
            nextDefinitions = makeAgentStore([{id: 'replacement-definition', githubUsername: 'replacement', harnessType: 'codex'}]),
            tenants         = Neo.create(FleetTenants, {data: [{id: 'kept-tenant', endpoint: 'https://kept.example.com', status: 'connected'}]}),
            nextTenants     = Neo.create(FleetTenants, {data: [{id: 'replacement-tenant', endpoint: 'https://replacement.example.com', status: 'connected'}]}),
            pending         = [],
            priorAgentOS    = globalThis.AgentOS;
        let view;

        try {
            view = await createAccounts({agentDefinitionsStore: definitions, fleetTenantsStore: tenants});
            globalThis.AgentOS = {fleet: {registryBridge: {
                listAgents : () => new Promise(resolve => pending.push({kind: 'definitions', resolve})),
                listTenants: () => new Promise(resolve => pending.push({kind: 'tenants', resolve}))
            }}};

            const oldDefinitionsRead = view.getController().loadAgentDefinitions();
            const oldTenantsRead     = view.getController().loadFleetTenants();
            await Promise.resolve();

            // Let the binding hooks observe the new provider Stores without launching extra reads.
            delete globalThis.AgentOS;
            view.agentDefinitionsStore = nextDefinitions;
            view.fleetTenantsStore = nextTenants;

            pending.find(entry => entry.kind === 'definitions').resolve([
                {id: 'stale-definition', githubUsername: 'stale', harnessType: 'codex'}
            ]);
            pending.find(entry => entry.kind === 'tenants').resolve([
                {id: 'stale-tenant', endpoint: 'https://stale.example.com', status: 'connected'}
            ]);

            await expect(oldDefinitionsRead).resolves.toBe(false);
            await expect(oldTenantsRead).resolves.toBe(false);
            expect(definitions.get('kept-definition')).not.toBeNull();
            expect(nextDefinitions.get('replacement-definition')).not.toBeNull();
            expect(tenants.get('kept-tenant')).not.toBeNull();
            expect(nextTenants.get('replacement-tenant')).not.toBeNull();
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            definitions.destroy();
            nextDefinitions.destroy();
            tenants.destroy();
            nextTenants.destroy()
        }
    });

    test('a replacement Store retires pending statuses for matching agent ids', async () => {
        const
            store        = makeAgentStore([{id: 'ada', githubUsername: 'ada', harnessType: 'codex'}]),
            replacement  = makeAgentStore([{id: 'ada', githubUsername: 'ada', harnessType: 'codex'}]),
            priorAgentOS = globalThis.AgentOS;
        let view, resolveConfig, resolveRepos;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            globalThis.AgentOS = {fleet: {registryBridge: {
                configureAgent: () => new Promise(resolve => resolveConfig = resolve),
                setRepos      : () => new Promise(resolve => resolveRepos = resolve)
            }}};

            const controller = view.getController();
            const config     = controller.onAgentConfigIntent({id: 'ada', harnessType: 'native-neo'});
            const repos      = controller.onAgentReposIntent({id: 'ada', repos: []});
            expect(view.agentConfigSaveStatuses.get('ada').state).toBe('pending');
            expect(view.agentReposSaveStatuses.get('ada').state).toBe('pending');

            view.agentDefinitionsStore = replacement;
            expect(view.getReference('agent-config-card').saveStatus.state).toBe('idle');
            expect(view.agentConfigSaveStatuses.size).toBe(0);
            expect(view.agentReposSaveStatuses.size).toBe(0);

            resolveConfig({status: 'rejected', reason: 'old config'});
            resolveRepos({status: 'rejected', reason: 'old repos'});
            await Promise.all([config, repos]);
            expect(view.agentConfigSaveStatuses.size).toBe(0);
            expect(view.agentReposSaveStatuses.size).toBe(0);
            expect(replacement.get('ada').harnessType).toBe('codex');
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            store.destroy();
            replacement.destroy()
        }
    });

    test('destroyed owner discards pending reads and never paints a late save status', async () => {
        const
            definitions  = makeAgentStore([{id: 'ada', githubUsername: 'ada', harnessType: 'codex'}]),
            tenants      = Neo.create(FleetTenants, {data: [{id: 'kept-tenant', endpoint: 'https://kept.example.com', status: 'connected'}]}),
            priorAgentOS = globalThis.AgentOS;
        let view, resolveAgents, resolveTenants, resolveConfig;

        try {
            view = await createAccounts({agentDefinitionsStore: definitions, fleetTenantsStore: tenants});
            globalThis.AgentOS = {fleet: {registryBridge: {
                listAgents    : () => new Promise(resolve => resolveAgents = resolve),
                listTenants   : () => new Promise(resolve => resolveTenants = resolve),
                configureAgent: () => new Promise(resolve => resolveConfig = resolve)
            }}};

            const controller     = view.getController();
            const configStatuses = [];
            const card           = view.getReference('agent-config-card');
            const setSaveStatus  = card.setSaveStatus.bind(card);
            card.setSaveStatus = (...args) => {
                configStatuses.push(args);
                setSaveStatus(...args)
            };

            const definitionsRead = controller.loadAgentDefinitions();
            const tenantsRead     = controller.loadFleetTenants();
            const configSave      = controller.onAgentConfigIntent({id: 'ada', harnessType: 'native-neo'});
            expect(configStatuses.map(entry => entry[1])).toEqual(['pending']);

            view.destroy();
            resolveAgents([{id: 'late-definition', githubUsername: 'late', harnessType: 'codex'}]);
            resolveTenants([{id: 'late-tenant', endpoint: 'https://late.example.com', status: 'connected'}]);
            resolveConfig({status: 'accepted', agent: {id: 'ada', harnessType: 'native-neo', mcpServers: null}});

            await expect(definitionsRead).resolves.toBe(false);
            await expect(tenantsRead).resolves.toBe(false);
            await configSave;

            expect(definitions.get('late-definition')).toBeNull();
            expect(tenants.get('late-tenant')).toBeNull();
            // ConfigIntentRoundTrip keeps canonical admission against the original provider Store;
            // the destroyed component and its status line receive no late paint.
            expect(definitions.get('ada').harnessType).toBe('native-neo');
            expect(configStatuses.map(entry => entry[1])).toEqual(['pending']);
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            definitions.destroy();
            tenants.destroy()
        }
    });

    test('an accepted readback from ANOTHER owner invalidates an older in-flight boot list (#15440)', async () => {
        const store = Neo.create(Store, {keyProperty: 'id', model: AgentDefinition, data: [
            {id: 'ada', githubUsername: 'ada', harnessType: 'codex'}
        ]});
        const priorAgentOS = globalThis.AgentOS;
        let view, resolveList;

        try {
            view = await createAccounts({agentDefinitionsStore: store});
            globalThis.AgentOS = {fleet: {registryBridge: {
                listAgents    : () => new Promise(resolve => resolveList = resolve),
                configureAgent: async () => ({status: 'accepted', agent: {id: 'ada', harnessType: 'native-neo', mcpServers: null}})
            }}};

            // The boot list goes in flight…
            const load = view.getController().loadAgentDefinitions();

            // …and the detail owner lands an accepted configure readback meanwhile.
            await ConfigIntentRoundTrip.runConfigIntentRoundTrip({
                intent       : {id: 'ada', harnessType: 'native-neo'},
                owner        : {},
                setSaveStatus: () => {},
                store
            });

            expect(store.get('ada').harnessType).toBe('native-neo');

            // The older list snapshot carries pre-write truth and must be discarded.
            resolveList([{id: 'ada', githubUsername: 'ada', harnessType: 'codex'}]);
            await expect(load).resolves.toBe(false);
            expect(store.get('ada').harnessType).toBe('native-neo');
        } finally {
            globalThis.AgentOS = priorAgentOS;
            view?.destroy();
            store.destroy()
        }
    });
});
