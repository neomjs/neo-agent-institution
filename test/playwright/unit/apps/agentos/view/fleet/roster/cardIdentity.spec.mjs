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
        const store = makeStore(roster(['ok', 'ok', 'ok'])),
              grid  = Neo.create(FleetGrid, {appName, store}),
              list  = await readyList(grid);

        const
            bravo    = cards(list)[1],
            bravoId  = bravo.id,
            bravoKey = bravo.record.agentId,
            liBefore = list.getItemId(bravoKey);

        expect(cards(list).map(card => card.record.displayName)).toEqual(['Agent A', 'Agent B', 'Agent C']);
        expect(bravoId).toBe(`${list.id}__${bravoKey}__component`);
        expect(liIds(list)).toContain(liBefore);

        // the joiner ranks equal and sorts first by name — every existing card shifts one seat
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

    test('a record that leaves keeps its card behind the seats; the survivors keep theirs; a joiner gets its own', async () => {
        const store = makeStore(roster(['ok', 'ok', 'ok'])),
              grid  = Neo.create(FleetGrid, {appName, store}),
              list  = await readyList(grid);

        const
            [alpha, bravo, charlie] = cards(list),
            ids                     = [alpha.id, bravo.id, charlie.id];

        store.remove(charlie.record.agentId);
        store.add({...joiner});
        list.createItems(true);

        expect(cards(list).map(card => card.record.displayName)).toEqual(['AAA', 'Agent A', 'Agent B']);
        expect(cards(list)[1]).toBe(alpha);
        expect(cards(list)[2]).toBe(bravo);
        expect([alpha.id, bravo.id]).toEqual([ids[0], ids[1]]);
        // a card is never re-keyed onto another record: the joiner's is new, under the joiner's id
        expect(cards(list)[0]).not.toBe(charlie);
        expect(cards(list)[0].id).toBe(`${list.id}__agent-00__component`);
        // Charlie's card stays behind the rendered seats, still Charlie's
        expect(list.items.length).toBe(4);
        expect(list.items[3]).toBe(charlie);
        expect(charlie.id).toBe(ids[2]);

        grid.destroy()
    });

    test('an explicit sort — the Animate path — reorders the pool without touching a single id', async () => {
        const store = makeStore(roster(['ok', 'ok', 'ok'])),
              grid  = Neo.create(FleetGrid, {appName, store}),
              list  = await readyList(grid);

        const before = cards(list).map(card => ({card, id: card.id, key: card.record.agentId}));

        list.sortItems({
            items        : [...store.items].reverse(),
            previousItems: [...store.items]
        });

        expect(list.items.map(card => card.record.agentId)).toEqual(before.map(entry => entry.key).reverse());
        before.forEach(({card, id}) => expect(card.id).toBe(id));

        grid.destroy()
    })
});
