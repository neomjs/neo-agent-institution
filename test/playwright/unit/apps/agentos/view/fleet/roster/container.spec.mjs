import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetGridTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        unitTestMode           : true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

// The setup() mock set carries no Stylesheet addon — the roster list's animate plugin writes its
// per-owner containing-block + transition rules through it at construct/destroy. Stubbed here (the
// animatePlugin spec's own pattern), restored in afterAll so nothing leaks past this file.
let priorInsertCssRules, priorDeleteCssRules;

test.beforeAll(() => {
    Neo.ns('Neo.main.addon.Stylesheet', true);

    priorInsertCssRules = Neo.main.addon.Stylesheet.insertCssRules;
    priorDeleteCssRules = Neo.main.addon.Stylesheet.deleteCssRules;

    Neo.main.addon.Stylesheet.insertCssRules = () => {};
    Neo.main.addon.Stylesheet.deleteCssRules = () => {}
});

test.afterAll(() => {
    Neo.main.addon.Stylesheet.insertCssRules = priorInsertCssRules;
    Neo.main.addon.Stylesheet.deleteCssRules = priorDeleteCssRules
});

test.describe('Fleet roster — the animated store-driven list: sorters rank, filters hide, selection drives', () => {
    let BaseContainer, FleetAgent, FleetGrid, HealthBar, StateProvider, Store, healthCounts, hasAttention, deriveAttention;

    const stores = [];

    // a roster from a list of states; agentIds are shuffled-stable and displayNames alphabet-walk
    // in ARRIVAL order, so both sort axes are provable against scrambled input
    const roster = states => states.map((state, i) => ({
        agentId       : `agent-${String((states.length - i)).padStart(2, '0')}`,
        displayName   : `Agent ${String.fromCharCode(65 + i)}`,
        githubUsername: `neo-agent-${String((states.length - i)).padStart(2, '0')}`,
        state
    }));

    // one Store of FleetAgent records per grid — the production data path (an isolated
    // AgentOS.store.FleetRoster shape; keyProperty mirrored per the collection-default shadow)
    const makeStore = rows => {
        const store = Neo.create(Store, {keyProperty: 'agentId', model: FleetAgent, data: rows});

        stores.push(store);

        return store
    };

    const head     = grid => grid.items.find(item => item.cls.includes('fm-fleet-head'));
    const swatchOf = (bar, state) => bar.items.find(sw => sw.state === state);

    // the animate plugin loads via a dynamic import — await it, hand it a measured rect (the
    // mount-time geometry the headless unit lacks), and build the pooled card items
    const readyList = async grid => {
        const list = grid.getReference('roster-list');

        let plugin = null;

        for (let i = 0; i < 100 && !(plugin = list.getPlugin('list-animate')); i++) {
            await new Promise(resolve => setTimeout(resolve, 10))
        }

        expect(plugin, 'list.plugin.Animate materialized').toBeTruthy();
        plugin.applyGeometry({width: 935, height: 600});
        list.createItems(true);

        return list
    };

    // the pooled AgentCard instances in RENDER order (store order) — the pool is index-keyed and
    // only ever grows, so the live window is the store's current count
    const cards = list => (list.items ?? []).slice(0, list.store.getCount());

    test.beforeAll(async () => {
        const gridMod = await import('../../../../../../../../apps/agentos/view/fleet/roster/Container.mjs'),
              barMod  = await import('../../../../../../../../apps/agentos/view/fleet/health/Container.mjs');

        FleetGrid       = gridMod.default;
        HealthBar       = barMod.default;
        healthCounts    = barMod.healthCounts;
        hasAttention    = barMod.hasAttention;
        deriveAttention = barMod.deriveAttention;
        BaseContainer   = (await import('../../../../../../../../node_modules/neo.mjs/src/container/Base.mjs')).default;
        FleetAgent      = (await import('../../../../../../../../apps/agentos/model/FleetAgent.mjs')).default;
        StateProvider   = (await import('../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs')).default;
        Store           = (await import('../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
    });

    test.afterAll(() => {
        stores.forEach(store => store.destroy());
        stores.length = 0
    });

    test('healthCounts is the pure tally — five buckets through the SAME resolver the cards render; a seat Fleet does not run counts offline (#246)', () => {
        const zero = {ok: 0, idle: 0, wedged: 0, limited: 0, off: 0};

        // roster-only rows (no sources): Fleet supervises nothing, so every one is offline, exactly
        // as the cards display them — the tally and the card grain can never diverge
        expect(healthCounts(roster(['ok', 'ok', 'idle', 'off', 'limited', 'wedged']))).toEqual({...zero, off: 6});

        // a wired runtime keeps the row state as session truth in the tally too — including `off`,
        // the managed-and-stopped seat
        const wiredSources = {
            roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
            repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
            runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
        };
        expect(healthCounts(['ok', 'idle', 'wedged', 'limited', 'off'].map(state => ({state, sources: wiredSources}))))
            .toEqual({ok: 1, idle: 1, wedged: 1, limited: 1, off: 1});

        // the bench is a roster fact: a benched seat counts offline even with a running process
        expect(healthCounts([{participationStatus: 'operator_benched', sources: wiredSources, state: 'ok'}])).toEqual({...zero, off: 1});

        // zero-fill: exactly the five buckets, present even when absent
        expect(healthCounts([])).toEqual(zero);

        // unknown / guest / unsupported rows land in a rendered bucket too — never a sixth key
        const withGuest = healthCounts([...roster(['ok', 'mysterious', 'guest']), {sources: wiredSources, state: 'mysterious'}]);
        expect(withGuest).toEqual({...zero, off: 4});
        expect(Object.keys(withGuest).sort()).toEqual(['idle', 'limited', 'off', 'ok', 'wedged']);
        // the visible counts sum to the roster size — the bar can never undercount
        expect(Object.values(withGuest).reduce((a, b) => a + b, 0)).toBe(4);

        // non-array guard
        expect(healthCounts(null)).toEqual(zero)
    });

    test('the provider roster liveness binding gates launch guidance on pooled cards', async () => {
        const
            sources = {
                roster    : {source: 'fleet:listAgents', state: 'wired', confidence: 'observed'},
                repoStatus: {source: 'fleet:fleetStatus', state: 'wired', confidence: 'observed'},
                runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
            },
            store = makeStore([{
                agentId: 'resident', displayName: 'Resident', state: 'ok', sources,
                launchAdmission: {
                    state: 'stale', reason: 'issuer-replaced', generation: null,
                    since: null, servers: [], recent: []
                }
            }]),
            grid = Neo.create(FleetGrid, {
                appName, store,
                stateProvider: {module: StateProvider, data: {gridAdapterState: 'live'}}
            }),
            list = await readyList(grid),
            card = cards(list)[0],
            status = card.down({reference: 'control-status'}),
            provider = grid.stateProvider;

        expect(provider).toBeTruthy();
        expect(card.rosterState).toBe('live');
        expect(status.hidden).toBe(false);

        provider.setData({gridAdapterState: 'stale'});
        expect(card.rosterState).toBe('stale');
        expect(status.hidden).toBe(true);

        grid.destroy()
    });

    test('hasAttention derives the aggregate header verdict — only actionable buckets carry weight', () => {
        const zero = {ok: 0, idle: 0, wedged: 0, limited: 0, off: 0};

        // a fleet of seats Fleet does not run is CALM — offline is a fact, not an alarm (a header
        // that is always yellow trains the operator to ignore it)
        expect(hasAttention({...zero, off: 9})).toBe(false);
        expect(hasAttention({...zero, ok: 3, idle: 2})).toBe(false);

        // the actionable states carry the weight
        expect(hasAttention({...zero, wedged: 1})).toBe(true);
        expect(hasAttention({...zero, limited: 1})).toBe(true);

        // fail-closed shapes
        expect(hasAttention({})).toBe(false);
        expect(hasAttention(null)).toBe(false)
    });

    test('deriveAttention is the SINGLE aggregate projection — every summarized truth folds, and expected-absence still weighs nothing', () => {
        const zero = {ok: 0, idle: 0, wedged: 0, limited: 0, off: 0};

        // the un-managed normal: not-wired sources everywhere (the FM-as-client topology)
        // must NOT trip attention — weighting expected absence would make the header permanently
        // yellow again, the exact falsified default this projection retires
        const unmanagedRows = [{sources: {}}, {sources: null}, {
            sources: {runtime: {source: 'fleet:runtimeStatus', state: 'not-wired', confidence: 'none'}}
        }];
        expect(deriveAttention({counts: {...zero, off: 3}, rows: unmanagedRows})).toBe(false);

        // an ANSWERED-abnormal source (a producer said `missing`) is real trouble on a real surface
        expect(deriveAttention({counts: {...zero, off: 1}, rows: [{
            sources: {repoStatus: {source: 'fleet:fleetStatus', state: 'missing', confidence: 'none'}}
        }]})).toBe(true);

        // REJECTED evidence (a present fact the contract refused — malformed, cross-axis,
        // contradictory) carries weight too: validation failure must never read as a green surface
        expect(deriveAttention({counts: {...zero, off: 1}, rows: [{
            sources: {runtime: {source: 'fleet:listAgents', state: 'wired', confidence: 'observed'}}
        }]})).toBe(true);

        // the plumbed non-roster facts each trip the fold on their own
        expect(deriveAttention({counts: {...zero, off: 9}, rows: unmanagedRows, daemonFault: true})).toBe(true);
        expect(deriveAttention({counts: {...zero, off: 9}, rows: unmanagedRows, presenceDegraded: true})).toBe(true);

        // session buckets keep their weight through the fold
        expect(deriveAttention({counts: {...zero, wedged: 1}, rows: []})).toBe(true);

        // fail-closed shapes
        expect(deriveAttention({})).toBe(false);
        expect(deriveAttention()).toBe(false)
    });

    test('tierRank is the model-calculated rank axis — one derivation site for "online first"', () => {
        const store = makeStore(roster(['ok', 'wedged', 'limited', 'idle', 'off', 'guest']));

        const rankOf = state => store.items.find(record => record.state === state).tierRank;

        // present-and-engaged leads — a wedged or rate-limited agent is a thing the operator must
        // SEE, never calm background
        expect(rankOf('ok')).toBe(0);
        expect(rankOf('wedged')).toBe(0);
        expect(rankOf('limited')).toBe(0);
        // the calm middle
        expect(rankOf('idle')).toBe(1);
        // the tail: benched / offline / unknown-guest — never dropped
        expect(rankOf('off')).toBe(2);
        expect(rankOf('guest')).toBe(2);

        // the derivation is live: a tier move re-computes on the SAME record
        const record = store.items.find(r => r.state === 'ok');
        record.set({state: 'idle'});
        expect(record.tierRank).toBe(1)
    });

    test('the default order is a STORE sorter set — online first, then case-folded name; seating is idempotent', async () => {
        // arrival order scrambles both axes: names walk A..F over states that interleave tiers
        const store = makeStore(roster(['idle', 'ok', 'off', 'wedged', 'idle', 'ok'])),
              grid  = Neo.create(FleetGrid, {appName, store});

        // the controller seated the default sorters + the three view filters on the store
        expect(store.sorters.length).toBe(2);
        expect(store.sorters[0].property).toBe('tierRank');
        expect(store.filters.length).toBe(3);
        expect(store.filters.every(filter => filter.disabled)).toBe(true);

        // tier leads, name breaks ties within a tier: online (B, D, F) → idle (A, E) → tail (C)
        expect(store.items.map(record => record.displayName)).toEqual(
            ['Agent B', 'Agent D', 'Agent F', 'Agent A', 'Agent E', 'Agent C']
        );

        // idempotent re-seat: a second grid binding the SAME provider-owned store must not stack
        // duplicate sorters/filters or reorder anything
        const second = Neo.create(FleetGrid, {appName, store});
        expect(store.sorters.length).toBe(2);
        expect(store.filters.length).toBe(3);

        // the pooled card instances render in store order
        const list = await readyList(grid);
        expect(cards(list).map(card => card.record.displayName)).toEqual(store.items.map(record => record.displayName));
        expect(cards(list).every(card => card.record.isRecord)).toBe(true);

        second.destroy();
        grid.destroy()
    });

    test('sort modes replace the sorter set: name A–Z case-folds; latest activity is DESC with nulls LAST', () => {
        const rows = roster(['ok', 'idle', 'off', 'ok']);

        // case-fold axis: mixed-case names that would misorder under a case-sensitive compare
        rows[0].displayName = 'ada';
        rows[1].displayName = 'Bo';
        rows[2].displayName = 'ARA';
        rows[3].displayName = 'zed';

        // recency axis: two stamped instants + two never-active rows
        rows[0].lastActivityAt = '2026-08-22T10:00:00.000Z';
        rows[1].lastActivityAt = '2026-08-22T12:00:00.000Z';
        rows[2].lastActivityAt = null;
        rows[3].lastActivityAt = null;

        const store      = makeStore(rows),
              grid       = Neo.create(FleetGrid, {appName, store}),
              controller = grid.getController();

        controller.onSortModeClick({component: grid.getReference('sort-name')});
        expect(store.items.map(record => record.displayName)).toEqual(['ada', 'ARA', 'Bo', 'zed']);
        expect(grid.getReference('sort-name').pressed).toBe(true);
        expect(grid.getReference('sort-online').pressed).toBe(false);

        // "that would move a lot": newest stamped instant first, the never-active rows LAST —
        // the sorter's native null handling, never a fabricated age
        controller.onSortModeClick({component: grid.getReference('sort-activity')});
        expect(store.items.map(record => record.lastActivityAt)).toEqual([
            '2026-08-22T12:00:00.000Z', '2026-08-22T10:00:00.000Z', null, null
        ]);
        expect(grid.getReference('sort-activity').pressed).toBe(true);

        // back to the default tier order
        controller.onSortModeClick({component: grid.getReference('sort-online')});
        expect(store.items[0].tierRank).toBe(0);

        grid.destroy()
    });

    test('a session-state change re-sorts through the store — the tier move IS a store ordering event', () => {
        const store = makeStore(roster(['ok', 'ok', 'idle'])),
              grid  = Neo.create(FleetGrid, {appName, store});

        const first = store.items[0];
        expect(first.tierRank).toBe(0);

        // bench the leading online record — the record must move to the tail of the STORE order
        // (the plugin renders store `sort` events; order is the provable unit-level truth)
        first.set({state: 'off'});

        expect(store.items.at(-1)).toBe(first);
        expect(store.items.map(record => record.tierRank)).toEqual([0, 1, 2]);

        // the store-bound health bar tallies through ITS OWN record seam: none of these roster-only
        // rows has a runtime Fleet supervises, so all three read offline
        const bar = grid.getReference('fleet-health');
        expect(bar.store).toBe(store);
        expect(swatchOf(bar, 'off').count).toBe(3);

        grid.destroy()
    });

    test('filters hide without erasing: hide-offline and hide-benched shape the VIEW; the tally and title keep the whole fleet', async () => {
        const
            wired = {runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}},
            rows  = roster(['ok', 'off', 'idle', 'idle']);

        // working · stopped · benched while running · a seat Fleet does not run
        [0, 1, 2].forEach(index => rows[index].sources = wired);
        rows[2].participationStatus = 'operator_benched';

        const store      = makeStore(rows),
              grid       = Neo.create(FleetGrid, {appName, store}),
              controller = grid.getController(),
              list       = await readyList(grid);

        expect(store.getCount()).toBe(4);

        // hide benched: the operator_benched row leaves the VIEW
        controller.onFilterToggleClick({component: grid.getReference('filter-benched')});
        expect(store.getCount()).toBe(3);
        expect(grid.getReference('filter-benched').pressed).toBe(true);

        // hide offline: what the legend counts offline leaves — stopped and unobserved as well
        controller.onFilterToggleClick({component: grid.getReference('filter-offline')});
        expect(store.items.map(record => record.state)).toEqual(['ok']);

        // the WHOLE fleet stays the counted truth: title + health tally read the unfiltered set
        expect(grid.getReference('fleet-title').text).toBe('Fleet · 4 agents');
        const bar = grid.getReference('fleet-health');
        expect(swatchOf(bar, 'ok').count).toBe(1);
        expect(swatchOf(bar, 'off').count).toBe(3);

        // toggling back restores the view
        controller.onFilterToggleClick({component: grid.getReference('filter-offline')});
        controller.onFilterToggleClick({component: grid.getReference('filter-benched')});
        expect(store.getCount()).toBe(4);
        expect(cards(list).length).toBe(4);

        grid.destroy()
    });

    test('an enabled hide-offline follows every fact the legend reads: a runtime or bench change alone moves a card in or out, both ways; the tally and title keep the whole fleet', () => {
        const
            wired = {runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}},
            rows  = roster(['ok', 'ok']);

        rows[0].sources = wired;   // agent-02 works under a runtime Fleet supervises; agent-01 has none

        const
            store      = makeStore(rows),
            grid       = Neo.create(FleetGrid, {appName, store}),
            controller = grid.getController(),
            bar        = grid.getReference('fleet-health'),
            running    = store.get('agent-02'),
            seat       = store.get('agent-01'),
            visible    = () => store.items.map(record => record.agentId).sort(),
            tally      = () => [swatchOf(bar, 'ok').count, swatchOf(bar, 'off').count];

        controller.onFilterToggleClick({component: grid.getReference('filter-offline')});
        expect(visible()).toEqual(['agent-02']);

        // a source-only change: the seat comes under the runtime and joins the view
        seat.set({sources: wired});
        expect(visible()).toEqual(['agent-01', 'agent-02']);
        expect(tally()).toEqual([2, 0]);

        // a bench-only change: the running seat leaves the view, its process untouched
        running.set({participationStatus: 'operator_benched'});
        expect(visible()).toEqual(['agent-01']);
        expect(tally()).toEqual([1, 1]);

        // and back: the bench lifts, the runtime goes
        running.set({participationStatus: 'active'});
        seat.set({sources: {}});
        expect(visible()).toEqual(['agent-02']);
        expect(tally()).toEqual([1, 1]);

        expect(grid.getReference('fleet-title').text).toBe('Fleet · 2 agents');

        grid.destroy()
    });

    test('the density fold is a filter preset: at threshold the idle tier hides behind the honest head count; the chip toggles it live', () => {
        // 4 online · 6 idle · 2 benched = 12 → folded
        const store = makeStore(roster([
                  'ok', 'ok', 'limited', 'wedged',
                  'idle', 'idle', 'idle', 'idle', 'idle', 'idle',
                  'off', 'off'
              ])),
              grid       = Neo.create(FleetGrid, {appName, foldThreshold: 12, store}),
              controller = grid.getController(),
              chip       = grid.getReference('fold-chip');

        // armed at threshold: the six idle rows leave the VIEW, the chip names the honest count
        expect(store.getCount()).toBe(6);
        expect(store.items.every(record => record.tierRank !== 1)).toBe(true);
        expect(chip.hidden).toBe(false);
        expect(chip.text).toBe('+6 idle · show');

        // the title still counts the whole fleet — a fold is never a silent drop
        expect(grid.getReference('fleet-title').text).toBe('Fleet · 12 agents');

        // the chip toggles the idle tier back in
        controller.onIdleFoldClick({});
        expect(store.getCount()).toBe(12);
        expect(chip.text).toBe('hide idle');
        expect(chip.pressed).toBe(true);

        controller.onIdleFoldClick({});
        expect(store.getCount()).toBe(6);

        grid.destroy()
    });

    test('below the threshold the fold preset stays disarmed — every card renders, no chip', () => {
        const store = makeStore(roster(['ok', 'idle', 'off', 'ok', 'idle', 'wedged'])),
              grid  = Neo.create(FleetGrid, {appName, foldThreshold: 12, store});

        expect(store.getCount()).toBe(6);
        expect(grid.getReference('fold-chip').hidden).toBe(true);
        expect(grid.getReference('fleet-title').text).toBe('Fleet · 6 agents');

        grid.destroy()
    });

    test('a batch that crosses the threshold keeps every non-idle resident — the fold decides inside the mutation, on a projection that already holds the batch', () => {
        // The Engine writes the unfiltered projection inside the mutation, ahead of the store's
        // own synchronous `load` — so the fold toggled in that `load` folds the whole fleet it was
        // handed. Under the previous pin the projection trailed the event and a synchronous
        // toggle emptied the view (`count` 0 right after `add`); the consumer deferred by one
        // microtask. That deferral is gone: everything below holds right after `add`.
        const store = makeStore(roster(['ok', 'ok'])),
              grid  = Neo.create(FleetGrid, {appName, foldThreshold: 12, store}),
              // 2 more online · 14 idle · 2 benched → 20 with the seed pair, over the threshold
              batch = roster(['limited', 'wedged', ...Array(14).fill('idle'), 'off', 'off'])
                  .map((row, i) => ({...row, agentId: `batch-${String(i).padStart(2, '0')}`, displayName: `Batch ${i}`}));

        expect(grid.getReference('fold-chip').hidden).toBe(true);

        const added = store.add(batch);

        // `add` answers the VISIBLE instance per key — the four non-idle rows; the fourteen the
        // fold hides answer null, the store's own contract for a filtered row
        expect(added.filter(Boolean).length, 'add answers a record per visible row').toBe(4);
        expect(store.allItems.getCount(), 'the whole fleet lives in the unfiltered twin').toBe(20);
        expect(store.getCount(), 'the folded view keeps the six non-idle residents, right after add').toBe(6);
        expect(store.items.every(record => record.tierRank !== 1)).toBe(true);
        expect(grid.getReference('fleet-title').text).toBe('Fleet · 20 agents');
        expect(grid.getReference('fold-chip').text).toBe('+14 idle · show');

        grid.destroy()
    });

    test('selection writes the provider truth pair and fires the detail intent; a control click never selects', async () => {
        const
            fired = [],
            store = makeStore(roster(['ok', 'idle', 'off'])),
            // in production the provider lives on the cockpit ancestor; the SEAM under test (the
            // controller writing the truth pair) is identical with the provider seated here — the
            // headless harness has no mounted parent chain to walk
            grid = Neo.create(FleetGrid, {
                appName, store,
                stateProvider: {module: StateProvider, data: {selectedAgentId: null, selectedAgentIdentity: null}}
            }),
            controller = grid.getController(),
            list       = await readyList(grid),
            // the stateProvider config is LAZY — the first getter access materializes it
            provider   = grid.stateProvider;

        grid.on('agentSelect', data => fired.push(data));

        expect(provider).toBeTruthy();
        expect(grid.getStateProvider()).toBe(provider);

        const target = store.items[0];

        // Drive the real model: its view-level `select` event carries `{records, selection}` into
        // the controller. This is the exact mounted click / Enter payload, not an invented fixture.
        list.selectionModel.select(target);

        expect(provider.getData('selectedAgentId')).toBe(target.agentId);
        expect(provider.getData('selectedAgentIdentity')).toBe(`@${target.githubUsername}`);
        expect(fired).toHaveLength(1);
        expect(fired[0].agentId).toBe(target.agentId);

        // the lifecycle-control carve-out: a click whose path enters the control cluster BEFORE
        // the list item belongs to the lifecycle seam — the existing selection stays untouched
        const
            model = list.selectionModel,
            other = store.items[1];

        model.onListClick({
            currentTarget: list.getItemId(target.agentId),
            path         : [
                {cls: ['fm-card-action']},
                {cls: ['fm-card-control-verbs']},
                {cls: ['fm-agent-card']},
                {cls: ['neo-list-item']}
            ]
        });
        expect(model.getSelection()).toEqual([list.getItemId(target.agentId)]);
        expect(provider.getData('selectedAgentId')).toBe(target.agentId);
        expect(fired).toHaveLength(1);

        // an ordinary item click selects a different row through the base path
        model.onListClick({
            currentTarget: list.getItemId(other.agentId),
            path         : [
                {cls: ['fm-card-name']},
                {cls: ['fm-agent-card']},
                {cls: ['neo-list-item']}
            ]
        });
        expect(model.getSelection()).toHaveLength(1);
        expect(provider.getData('selectedAgentId')).toBe(other.agentId);
        expect(fired).toHaveLength(2);

        // an explicit empty event clears the cross-pane truth and fires no detail intent
        model.deselectAll(true);
        controller.onRosterSelect({records: [], selection: []});
        expect(provider.getData('selectedAgentId')).toBeNull();
        expect(provider.getData('selectedAgentIdentity')).toBeNull();
        expect(fired).toHaveLength(2);

        // Enter selects the Navigator-focused row (focusIndex is the base list's navigate state)
        list._focusIndex = 1;
        model.onKeyDownEnter({});

        const selected = model.getSelection();
        expect(selected).toHaveLength(1);
        expect(list.getItemRecordId(selected[0])).toBe(store.items[1].agentId);

        grid.destroy()
    });

    test('a non-state record write updates the ONE pooled card in place — same instance, no rebuild', async () => {
        const store = makeStore(roster(['ok', 'ok', 'idle'])),
              grid  = Neo.create(FleetGrid, {appName, store}),
              list  = await readyList(grid);

        const idsBefore = cards(list).map(card => card.id),
              record    = store.items[0];

        record.set({laneLine: 'rebuilt on records', pendingAction: 'start'});

        // the pool was NOT rebuilt — the same instances survived (instance identity is the
        // animated-move substrate: the plugin translates these, it never recreates them)
        expect(cards(list).map(card => card.id)).toEqual(idsBefore);

        // ...and the one affected card re-rendered its record: lane line + the B4 pending render
        const card = cards(list).find(c => c.record === record);
        expect(card.down({reference: 'card-lane'}).vdom.cn[0].text).toBe('rebuilt on records');
        expect(card.down({reference: 'control-verbs'}).items.every(button => button.disabled)).toBe(true);
        expect(card.down({reference: 'control-status'}).text).toBe('start…');

        grid.destroy()
    });

    test('a store load re-derives the surface — adding a resident extends the roster and the title', async () => {
        const store = makeStore(roster(['ok', 'idle'])),
              grid  = Neo.create(FleetGrid, {appName, store}),
              list  = await readyList(grid);

        expect(cards(list).length).toBe(2);

        store.add({agentId: 'agent-99', displayName: 'Joiner', state: 'ok'});

        list.createItems(true);
        expect(cards(list).length).toBe(3);
        expect(grid.getReference('fleet-title').text).toBe('Fleet · 3 agents');

        grid.destroy()
    });

    test('the presence-capability chip NAMES a degraded producer — and only a degraded one', () => {
        const store = makeStore(roster(['ok', 'idle'])),
              grid  = Neo.create(FleetGrid, {appName, foldThreshold: 12, store}),
              chip  = () => grid.getReference('fleet-presence-cap');

        // no envelope (the boot default): the chip claims nothing
        expect(chip().hidden).toBe(true);

        // a DEGRADED producer renders the named degradation with its retained reason — the
        // roster-level answer to bands vanishing honestly ("no one is online" was a misread of
        // unnamed absence, the live operator falsifier)
        grid.presenceCapability = {source: 'fleet:presenceState', state: 'degraded', confidence: 'none', reason: 'plane who_is_online read failed'};
        expect(chip().hidden).toBe(false);
        expect(chip().text).toBe('presence unobservable · plane who_is_online read failed');
        expect(chip().vdom['aria-label']).toBe('Presence: unobservable. plane who_is_online read failed.');
        expect(chip().vdom.role).toBe('status');

        // a reasonless degradation still names itself
        grid.presenceCapability = {source: 'fleet:presenceState', state: 'degraded', confidence: 'none', reason: null};
        expect(chip().hidden).toBe(false);
        expect(chip().text).toBe('presence unobservable');

        // wired (bands speak for themselves) and not-wired (expected-absent axis — never another
        // permanent line) both render NOTHING; recovery clears the previous claim
        for (const state of ['wired', 'not-wired']) {
            grid.presenceCapability = {source: 'fleet:presenceState', state, confidence: 'observed'};
            expect(chip().hidden, state).toBe(true);
            expect(chip().text, state).toBe('')
        }

        // null (assembler omitted the envelope) clears too
        grid.presenceCapability = {source: 'fleet:presenceState', state: 'degraded', confidence: 'none', reason: 'x'};
        grid.presenceCapability = null;
        expect(chip().hidden).toBe(true);

        // COMPOSITION with the aggregate dot: the chip and the header verdict read ONE fact —
        // a rendered presence degradation always carries attention weight, and recovery clears
        // both together (the chip can never sit over a green dot). The daemon plumb rides the
        // same push seam.
        const bar = grid.getReference('fleet-health');

        grid.presenceCapability = {source: 'fleet:presenceState', state: 'degraded', confidence: 'none', reason: 'plane read failed'};
        expect(chip().hidden).toBe(false);
        expect(bar.cls).toContain('fm-health-attention');

        grid.presenceCapability = null;
        expect(chip().hidden).toBe(true);
        expect(bar.cls).toContain('fm-health-nominal');

        grid.daemonFault = true;
        expect(bar.cls).toContain('fm-health-attention');
        grid.daemonFault = false;
        expect(bar.cls).toContain('fm-health-nominal');

        grid.destroy();

        // the create-time path: an envelope supplied at construction renders once the reference
        // tree exists (the reactive path skips pre-construction)
        const eager = Neo.create(FleetGrid, {
            appName, foldThreshold: 12, store: makeStore(roster(['ok'])),
            presenceCapability: {source: 'fleet:presenceState', state: 'degraded', confidence: 'none', reason: 'boot-time read failed'}
        });

        expect(eager.getReference('fleet-presence-cap').hidden).toBe(false);
        expect(eager.getReference('fleet-presence-cap').text).toBe('presence unobservable · boot-time read failed');

        eager.destroy()
    });

    test('a11y: named landmark region over a REAL list — ul root, li items, no bolted-on roles', () => {
        const grid = Neo.create(FleetGrid, {appName, store: makeStore(roster(['ok', 'idle']))});

        // the roster is a named landmark region so screen-reader users can navigate to it as a
        // distinct cockpit surface; the header/controls mutate in place, so the label persists
        expect(grid.vdom.role).toBe('region');
        expect(grid.vdom['aria-label']).toBe('Fleet roster');

        // the list is semantic HTML: a real ul whose items are real li — implicit list/listitem
        // roles, so no explicit role attributes remain anywhere on the card path
        const list = grid.getReference('roster-list');
        expect(list.vdom.tag).toBe('ul');
        expect(list.itemTagName).toBe('li');

        grid.destroy()
    });

    test('HealthBar is Store-bound — counts tally from records and react through the store seam, swatches stable (no rebuild)', () => {
        const store = makeStore(roster(['ok', 'ok', 'idle', 'off'])),
              bar   = Neo.create(HealthBar, {appName, store});

        // five swatches: working · idle · stuck · rate-limited · offline
        expect(bar.items.map(sw => sw.state)).toEqual(['ok', 'idle', 'wedged', 'limited', 'off']);
        expect(swatchOf(bar, 'off').count).toBe(4);      // Fleet runs none of these roster-only rows
        expect(swatchOf(bar, 'wedged').count).toBe(0);   // zero still renders (confirms "none")

        // the aggregate verdict rides the bar as the nominal class — offline is a fact, not an alarm
        expect(bar.cls).toContain('fm-health-nominal');
        expect(bar.cls).not.toContain('fm-health-attention');

        // stable instances: capture ids, mutate a RECORD, assert SAME swatch instances re-tallied
        const idsBefore = bar.items.map(sw => sw.id);
        store.items[2].set({state: 'wedged'});                   // idle → wedged, via the record seam
        expect(bar.items.map(sw => sw.id)).toEqual(idsBefore);   // not recreated → the count transition can animate
        // an unwired row stays offline in the tally — stuck only counts as session truth under a
        // wired runtime (exactly the card's own honesty rule); the aggregate verdict therefore
        // stays nominal too
        expect(swatchOf(bar, 'wedged').count).toBe(0);
        expect(swatchOf(bar, 'off').count).toBe(4);
        expect(bar.cls).toContain('fm-health-nominal');

        // a store load (roster growth) re-tallies too
        store.add({agentId: 'agent-99', state: 'ok'});
        expect(swatchOf(bar, 'off').count).toBe(5);

        // a SOURCES-only record change re-tallies too: wiring a runtime flips unmanaged→managed
        // truth with no `state` field write — the mutation the old state-only filter dropped
        const wired = {
            roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
            repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
            runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
        };
        store.items[1].set({sources: wired});               // an `ok` row: offline → working, sources-only
        expect(swatchOf(bar, 'ok').count).toBe(1);
        expect(swatchOf(bar, 'off').count).toBe(4);

        // a participation-only change re-tallies too: the bench moves a running seat offline
        store.items[1].set({participationStatus: 'operator_benched'});
        expect(swatchOf(bar, 'ok').count).toBe(0);
        expect(swatchOf(bar, 'off').count).toBe(5);
        store.items[1].set({participationStatus: 'active'});
        expect(swatchOf(bar, 'ok').count).toBe(1);

        // an answered-abnormal source arriving via the SAME sources-only seam trips the aggregate
        store.items[1].set({sources: {...wired, repoStatus: {source: 'fleet:fleetStatus', state: 'missing', confidence: 'none'}}});
        expect(bar.cls).toContain('fm-health-attention');

        // recovery through the seam returns the calm verdict
        store.items[1].set({sources: wired});
        expect(bar.cls).toContain('fm-health-nominal');

        bar.destroy()
    });

    test('HealthBar tallies the WHOLE fleet under view filters — hiding a tier never shrinks its count', () => {
        const
            wired = {runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}},
            store = makeStore(roster(['ok', 'off', 'off', 'idle']).map(row => ({...row, sources: wired}))),
            grid  = Neo.create(FleetGrid, {appName, store}),
            bar   = grid.getReference('fleet-health');

        expect(swatchOf(bar, 'off').count).toBe(2);

        // hide the offline tier — the VIEW loses the rows, the tally must not
        grid.getController().onFilterToggleClick({component: grid.getReference('filter-offline')});

        expect(store.getCount()).toBe(2);
        expect(swatchOf(bar, 'off').count).toBe(2);

        grid.destroy()
    });

    test('HealthBar animateCounts enforces one class membership without disturbing caller or base classes', () => {
        const
            bar      = Neo.create(HealthBar, {animateCounts: false, appName}),
            observed = [];

        bar.addCls('caller-authored');

        const cleanup = bar.observeConfig(bar, 'cls', cls => observed.push([...cls]));

        bar.animateCounts = true;
        bar.animateCounts = true;

        expect(observed).toHaveLength(1);
        expect(observed[0]).toContain('fm-health-bar');
        expect(observed[0]).toContain('caller-authored');
        expect(observed[0].filter(cls => cls === 'fm-animate-counts')).toHaveLength(1);

        bar.animateCounts = false;
        bar.animateCounts = false;

        expect(observed).toHaveLength(2);
        expect(observed[1]).toContain('fm-health-bar');
        expect(observed[1]).toContain('caller-authored');
        expect(observed[1]).not.toContain('fm-animate-counts');

        cleanup();
        bar.destroy()
    });

    test('degrades honestly on adapter loss — a stale header, never a blanked roster', () => {
        const grid = Neo.create(FleetGrid, {appName, adapterState: 'stale', store: makeStore(roster(['ok', 'idle', 'off']))});

        expect(head(grid).cls).toContain('is-stale');
        expect(head(grid).items.find(i => i.cls.includes('fm-fleet-stale')).text).toBe('stale — reconnecting');
        // the store still holds every record — degrade surfaces the state, it does not blank
        expect(grid.store.getCount()).toBe(3);

        grid.destroy()
    });

    test('a cold roster says so — "not answered yet", no offline claim, and the empty CTA stays hidden', () => {
        const grid = Neo.create(FleetGrid, {appName, adapterState: 'cold', store: makeStore([])});

        expect(head(grid).cls).toContain('is-cold');
        // no offline claim: cold only says no source has answered, never WHY — the spine banner
        // owns the why; a badge asserting "offline" against a replying server would repeat the
        // lie the banner used to tell
        expect(head(grid).items.find(i => i.cls.includes('fm-fleet-stale')).text).toBe('not answered yet');
        // an unanswered roster is not an empty fleet: the CTA is the answer-was-EMPTY state
        expect(grid.getReference('empty-cta').hidden).toBe(true);

        // the answer lands empty: live, and the CTA is the roster's word for it
        grid.adapterState = 'live';

        expect(head(grid).cls).toContain('is-live');
        expect(head(grid).items.find(i => i.cls.includes('fm-fleet-stale')).text).toBe('');
        expect(grid.getReference('empty-cta').hidden).toBe(false);

        grid.destroy()
    });

    test('the bootstrap CTA renders ONLY at roster count 0, fires addAgentRequest, and vanishes with the first agent', async () => {
        const
            fired = [],
            store = makeStore([]),
            grid  = Neo.create(FleetGrid, {appName, store}),
            cta   = grid.getReference('empty-cta');

        grid.on('addAgentRequest', data => fired.push(data));

        // empty fleet: the one findable path to the first agent — a native Button, real Tab order
        expect(cta.hidden).toBe(false);
        expect(cta.text).toBe('Add your first agent');

        grid.getController().onEmptyCtaClick({});
        expect(fired).toHaveLength(1);

        // the first agent retires the CTA — it is a bootstrap affordance, never ambient chrome
        store.add({agentId: 'first', displayName: 'First', state: 'ok'});

        expect(cta.hidden).toBe(true);
        expect(grid.getReference('fleet-title').text).toBe('Fleet · 1 agents');

        grid.destroy()
    });

});
