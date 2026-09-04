import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetRosterCardIdentityTest';

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
// per-owner rules through it at construct/destroy. Stubbed here (the roster container spec's own
// pattern), restored in afterAll so nothing leaks past this file.
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

/**
 * @summary A roster card and its list item belong to a RECORD, not to a position. The base component
 * list seats cards by index and renumbers their ids on every rebuild; on the roster that replaced the
 * DOM node of a card the moment a joiner sorted ahead of it — and the keyboard focus inside the node
 * died with it. Measured on engine dev@205bc52f8a, where a joiner finally sorts by the record's
 * `tierRank` instead of landing last as a raw row. These arms pin the record-keyed identity in the
 * unit tier, where a rebuild is `createItems()` after a store mutation.
 */
test.describe('Fleet roster — cards and list items keep their identity across a re-sort', () => {
    let FleetAgent, FleetGrid, Store;

    const stores = [];

    // displayNames alphabet-walk in arrival order, agentIds count down — the two sort axes disagree
    const roster = states => states.map((state, i) => ({
        agentId       : `agent-${String(states.length - i).padStart(2, '0')}`,
        displayName   : `Agent ${String.fromCharCode(65 + i)}`,
        githubUsername: `neo-agent-${String(states.length - i).padStart(2, '0')}`,
        state
    }));

    const makeStore = rows => {
        const store = Neo.create(Store, {keyProperty: 'agentId', model: FleetAgent, data: rows});

        stores.push(store);

        return store
    };

    // the animate plugin loads via a dynamic import — await it, hand it a measured rect, build the pool
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

    // the pooled cards in RENDER order — position i is the card of record i
    const cards  = list => (list.items ?? []).slice(0, list.store.getCount());
    const liIds  = list => list.getVdomRoot().cn.map(node => node.id);
    const joiner = {agentId: 'agent-00', displayName: 'AAA', githubUsername: 'neo-agent-00', state: 'ok'};

    // the joiner must sort AHEAD on every engine this repo pins: the shipped "online first" order
    // ranks by the calculated `tierRank`, which a raw row lacks on engines before neomjs/neo#18269
    // (a raw joiner sorted last there, which is how this defect stayed hidden). Name order reads a
    // plain field, so `AAA` leads on either engine — the tier axis is the pin battery's witness.
    const byName = store => {
        store.sorters = [{direction: 'ASC', property: 'displayName', sortBy: (a, b) => (a.displayName ?? '').toLowerCase().localeCompare((b.displayName ?? '').toLowerCase())}]
    };

    test.beforeAll(async () => {
        FleetGrid  = (await import('../../../../../../../../apps/agentos/view/fleet/roster/Container.mjs')).default;
        FleetAgent = (await import('../../../../../../../../apps/agentos/model/FleetAgent.mjs')).default;
        Store      = (await import('../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs')).default
    });

    test.afterAll(() => {
        stores.forEach(store => store.destroy());
        stores.length = 0
    });

    test('a joiner that sorts ahead moves the existing cards — same instance, same card id, same li id', async () => {
        const store = makeStore(roster(['ok', 'ok', 'ok']));

        // seated BEFORE the grid: the controller keeps a store's own sorters, and no `sort` event
        // fires inside the arm — the plugin's transition timer would outlive the grid otherwise
        byName(store);

        const grid = Neo.create(FleetGrid, {appName, store}),
              list = await readyList(grid);

        const
            bravo    = cards(list)[1],
            bravoId  = bravo.id,
            bravoKey = bravo.record.agentId,
            liBefore = list.getItemId(bravoKey);

        expect(cards(list).map(card => card.record.displayName)).toEqual(['Agent A', 'Agent B', 'Agent C']);
        expect(bravoId).toBe(`${list.id}__card-${bravoKey}`);
        expect(liBefore).toBe(`${list.id}__item-${bravoKey}`);
        expect(liIds(list)).toContain(liBefore);

        // the joiner sorts first by name — every existing card shifts one seat
        store.add({...joiner});
        list.createItems(true);

        expect(cards(list).map(card => card.record.displayName)).toEqual(['AAA', 'Agent A', 'Agent B', 'Agent C']);
        expect(cards(list)[2], 'the same AgentCard instance moved with its record').toBe(bravo);
        expect(bravo.record.agentId).toBe(bravoKey);
        expect(bravo.id, 'the card id follows the record, not the seat').toBe(bravoId);
        expect(list.getItemId(bravoKey), 'the li id follows the record').toBe(liBefore);
        expect(liIds(list)).toContain(liBefore);
        expect(list.getItemRecordId(liBefore)).toBe(bravoKey);

        grid.destroy()
    });

    test('a record that leaves retires its card — destroyed and dropped, the pool bounded by the fleet; survivors keep theirs, a joiner gets its own', async () => {
        const store = makeStore(roster(['ok', 'ok', 'ok']));

        byName(store);

        const grid = Neo.create(FleetGrid, {appName, store}),
              list = await readyList(grid);

        const
            [alpha, bravo, charlie] = cards(list),
            ids                     = [alpha.id, bravo.id, charlie.id],
            charlieRow              = {...roster(['ok', 'ok', 'ok'])[2]},
            charlieKey              = charlie.record.agentId;

        // the removal's own `mutate` retires Charlie's card — no rebuild in between: the store's
        // event names the records that left, so the retirement never reads a projection that may
        // trail the event on an older engine
        store.remove(charlieKey);

        expect(charlie.isDestroyed, 'retired on the mutation that removed the record').toBe(true);
        expect(Neo.get(ids[2])).toBeFalsy();
        expect(list.items.length, 'the pool is bounded by the fleet').toBe(2);

        // a joiner's fresh card survives its own mutation — nothing retires on an add
        store.add({...joiner});
        list.createItems(true);

        expect(cards(list).map(card => card.record.displayName)).toEqual(['AAA', 'Agent A', 'Agent B']);
        expect(cards(list)[1]).toBe(alpha);
        expect(cards(list)[2]).toBe(bravo);
        expect([alpha.id, bravo.id]).toEqual([ids[0], ids[1]]);
        // a card is never re-keyed onto another record: the joiner's is new, under the joiner's id
        expect(cards(list)[0]).not.toBe(charlie);
        expect(cards(list)[0].id).toBe(`${list.id}__card-agent-00`);
        expect(cards(list)[0].isDestroyed).toBeFalsy();
        expect(Neo.get(`${list.id}__card-agent-00`)).toBe(cards(list)[0]);
        expect(list.items.length).toBe(3);

        // join/leave cycles of unique agents leave nothing behind — pool and registry stay bounded;
        // the rebuild after the add is the production `load` path's job, the retirement is not
        for (let i = 0; i < 5; i++) {
            store.add({agentId: `cycle-${i}`, displayName: `Cycle ${i}`, githubUsername: `neo-cycle-${i}`, state: 'ok'});
            list.createItems(true);
            expect(Neo.get(`${list.id}__card-cycle-${i}`), `cycle ${i}: the joiner's card is registered`).toBeTruthy();
            expect(Neo.get(`${list.id}__card-cycle-${i}`).isDestroyed).toBeFalsy();
            store.remove(`cycle-${i}`);

            expect(Neo.get(`${list.id}__card-cycle-${i}`)).toBeFalsy();
            expect(list.items.length).toBe(3)
        }

        // the same agent returning gets a fresh card under the same id — freed with the old one
        store.add(charlieRow);
        list.createItems(true);

        const returned = cards(list).find(card => card.record.agentId === charlieKey);

        expect(returned).toBeTruthy();
        expect(returned).not.toBe(charlie);
        expect(returned.id).toBe(ids[2]);
        expect(list.items.length).toBe(4);

        grid.destroy()
    });

    test('agent ids are whatever the Brain accepted — item and card namespaces never meet, and every id round-trips DOM-safe', async () => {
        const rows  = ['plain', 'plain__component', 'item-plain', 'card-plain', 'with space', 'ünïcode', '_', 'a.b/c#d']
                  .map((agentId, i) => ({agentId, displayName: `N${i}`, githubUsername: `g${i}`, state: 'ok'})),
              store = makeStore(rows),
              grid  = Neo.create(FleetGrid, {appName, store}),
              list  = await readyList(grid);

        const itemIds = rows.map(row => list.getItemId(row.agentId)),
              cardIds = cards(list).map(card => card.id),
              all     = [...itemIds, ...cardIds];

        expect(cardIds.length).toBe(rows.length);
        expect(new Set(all).size, 'no two ids collide across both namespaces').toBe(all.length);
        all.forEach(id => expect(id, 'DOM-safe: letters, digits, hyphen, underscore').toMatch(/^[A-Za-z0-9_-]+$/));
        rows.forEach(row => expect(list.getItemRecordId(list.getItemId(row.agentId)), `round-trip ${row.agentId}`).toBe(row.agentId));
        // the rendered lis carry exactly the item ids, and no li id is any card's id
        expect(liIds(list).sort()).toEqual([...itemIds].sort());
        expect(cardIds.some(id => liIds(list).includes(id))).toBe(false);

        grid.destroy()
    });

    test('a sort through the Animate plugin moves the same nodes — translated mid-motion, rebuilt after the transition under the same ids', async () => {
        const store  = makeStore(roster(['ok', 'ok', 'ok'])),
              grid   = Neo.create(FleetGrid, {appName, store}),
              list   = await readyList(grid),
              plugin = list.getPlugin('list-animate');

        plugin.transitionDuration = 20;

        const
            before    = cards(list).map(card => ({card, id: card.id, key: card.record.agentId})),
            reversed  = before.map(entry => entry.key).reverse(),
            nodeOf    = key => list.getVdomRoot().cn.find(node => node.id === list.getItemId(key)),
            seatOf    = key => nodeOf(key)?.style?.transform,
            seats     = Object.fromEntries(before.map(({key}) => [key, seatOf(key)])),
            itemIds   = before.map(({key}) => list.getItemId(key)).sort();

        before.forEach(({key}) => expect(seats[key], `${key} sits on a translated seat`).toMatch(/^translate\(/));

        // the store's own `sort` event drives the plugin's `sortComponentList`: the pool follows the
        // records at once, and not one id changes — the nodes the transition will move are the same
        store.sorters = [{direction: 'DESC', property: 'displayName'}];

        expect(list.items.map(card => card.record.agentId), 'the pool follows the sorted records').toEqual(reversed);
        before.forEach(({card, id}) => expect(card.id).toBe(id));
        expect(liIds(list).sort(), 'the same lis, no new node').toEqual(itemIds);

        // the transition callback rebuilds the items: the same instances under the same ids, and the
        // moved records' nodes carry NEW seats — the transform changed on the same node id, which is
        // what lets the CSS transition play instead of a rebuilt card flashing in
        await new Promise(resolve => setTimeout(resolve, 80));

        expect(cards(list).map(card => card.record.agentId)).toEqual(reversed);
        before.forEach(({card, id, key}) => {
            const now = cards(list).find(candidate => candidate.record.agentId === key);

            expect(now, `${key} is the same AgentCard instance`).toBe(card);
            expect(now.id).toBe(id)
        });
        expect(liIds(list).sort()).toEqual(itemIds);
        expect(seatOf(before[0].key), 'the first record moved to the last seat').not.toBe(seats[before[0].key]);
        expect(seatOf(before[2].key), 'the last record moved to the first seat').not.toBe(seats[before[2].key]);
        expect(seatOf(before[1].key), 'the middle record kept its seat').toBe(seats[before[1].key]);
        expect(seatOf(before[2].key)).toBe(seats[before[0].key]);

        grid.destroy()
    })
});
