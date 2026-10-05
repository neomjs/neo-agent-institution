import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetAwaitingMergeTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * @summary The fleet head's merge queue: zero and an answer nobody gave earn no pixels, a failed read
 * is named once, a stale queue says so, and the floating list binds the provider's Store of records.
 */
test.describe('AwaitingMergeButton — the fleet head\'s merge queue', () => {
    let AwaitingMergeButton, AwaitingMergeMenuList, Container, FleetAwaitingMerge, describeMergeQueue;

    // the button lives in the fleet head, so a show() updates its parent; a parentless button would
    // instead mount itself onto document.body, which needs the VDom worker unit mode does not run
    const createButton = config => {
        const head = Neo.create(Container, {appName, items: [{module: AwaitingMergeButton, reference: 'awaiting-merge', ...config}]});

        return {head, button: head.getReference('awaiting-merge')}
    };

    const
        observedAt = '2026-10-03T08:00:00.000Z',
        ok         = {coverage: 'complete', observedAt, reason: null, state: 'ok'},
        pr         = (number, extra = {}) => ({id: `neomjs/neo#${number}`, repo: 'neomjs/neo', number, ci: 'green', mergeable: 'MERGEABLE', draft: false, observedAt, stale: false, ...extra});

    test.beforeAll(async () => {
        const module = await import('../../../../../../../../apps/agentos/view/fleet/roster/AwaitingMergeButton.mjs');

        AwaitingMergeButton   = module.default;
        describeMergeQueue    = module.describeMergeQueue;
        AwaitingMergeMenuList = (await import('../../../../../../../../apps/agentos/view/fleet/roster/AwaitingMergeMenuList.mjs')).default;
        Container             = (await import('../../../../../../../../node_modules/neo.mjs/src/container/Base.mjs')).default;
        FleetAwaitingMerge    = (await import('../../../../../../../../apps/agentos/store/FleetAwaitingMerge.mjs')).default
    });

    // records which Store handlers a list receives: list.Base subscribes them by name, so the Store
    // resolves them on the prototype at every event, where this spy sits
    const spyStoreHandlers = () => {
        const
            proto    = AwaitingMergeMenuList.prototype,
            names    = ['onStoreFilter', 'onStoreLoad', 'onStoreRecordChange', 'onStoreSort'],
            received = [];

        const owned = names.map(name => Object.getOwnPropertyDescriptor(proto, name));

        names.forEach(name => {
            const original = proto[name];

            proto[name] = function(...args) {
                received.push({name, destroyed: this.isDestroyed === true});
                return this.isDestroyed ? undefined : original.apply(this, args)
            }
        });

        return {
            received,
            restore: () => names.forEach((name, i) => owned[i] ? Object.defineProperty(proto, name, owned[i]) : delete proto[name])
        }
    };

    test('the words follow the read\'s state and the queue\'s rows', () => {
        const now = Date.parse('2026-10-03T08:12:00.000Z');

        expect(describeMergeQueue(null, []).hidden, 'no read yet').toBe(true);
        expect(describeMergeQueue(ok, []).hidden, 'zero earns no pixels').toBe(true);
        expect(describeMergeQueue({...ok, state: 'unavailable', coverage: 'not-wired'}, []).hidden, 'an unwired verb is an expected absence').toBe(true);
        expect(describeMergeQueue({...ok, state: 'unavailable', coverage: 'unanswered'}, []).hidden, 'a thrown read is the spine banner\'s story').toBe(true);

        expect(describeMergeQueue(ok, [pr(1), pr(2)])).toEqual({
            hidden: false, interactive: true, stale: false, unavailable: false,
            text  : '2 awaiting merge',
            title : '2 pull requests approved, green and mergeable, awaiting your merge'
        });

        const stale = describeMergeQueue({...ok, state: 'stale'}, [pr(1)], now);

        expect(stale.text).toBe('1 awaiting merge · stale');
        expect(stale.title).toBe('1 pull request approved, green and mergeable, awaiting your merge · stale, observed 12m ago');

        // a read that failed is named, never shown as an empty queue, and opens nothing
        expect(describeMergeQueue({...ok, state: 'unavailable', coverage: 'unavailable', reason: 'the GitHub read failed'}, [])).toEqual({
            hidden: false, interactive: false, stale: false, unavailable: true,
            text  : 'merge queue unavailable',
            title : 'The merge queue could not be read: the GitHub read failed'
        })
    });

    test('one stale row makes the queue stale under a fresh read, aged from that row', () => {
        const
            now       = Date.parse('2026-10-03T08:12:00.000Z'),
            freshRead = {...ok, observedAt: '2026-10-03T08:10:00.000Z'},
            stale     = describeMergeQueue(freshRead, [pr(1), pr(2, {observedAt: '2026-10-03T07:50:00.000Z', stale: true})], now);

        expect(stale.stale).toBe(true);
        expect(stale.text).toBe('2 awaiting merge · stale');
        expect(stale.title, 'the envelope pulsed at 08:10; the stale row was last seen at 07:50').toBe('2 pull requests approved, green and mergeable, awaiting your merge · stale, observed 22m ago');

        // the control: the same read with every row fresh says nothing about age
        const fresh = describeMergeQueue(freshRead, [pr(1), pr(2)], now);

        expect(fresh.stale).toBe(false);
        expect(fresh.text).toBe('2 awaiting merge');
        expect(fresh.title).toBe('2 pull requests approved, green and mergeable, awaiting your merge')
    });

    test('the button renders from the bound Store and the read\'s state, and re-words on every load', async () => {
        const store          = Neo.create(FleetAwaitingMerge, {data: []}),
              {head, button} = createButton({openWork: ok, store});

        try {
            expect(button.hidden, 'an empty queue').toBe(true);

            store.data = [pr(1), pr(2)];

            expect(button.hidden).toBe(false);
            expect(button.text).toBe('2 awaiting merge');
            expect(button.vdom['aria-label']).toBe('2 pull requests approved, green and mergeable, awaiting your merge');
            expect(button.vdom['aria-haspopup']).toBe('menu');

            // the button reads the rows themselves, not only their count
            store.data = [pr(1), pr(2, {stale: true})];

            expect(button.text).toBe('2 awaiting merge · stale');
            expect(button.cls).toContain('is-stale');

            button.openWork = {...ok, state: 'unavailable', coverage: 'unavailable', reason: 'the GitHub read failed'};
            store.data      = [];

            expect(button.hidden).toBe(false);
            expect(button.text).toBe('merge queue unavailable');
            expect(button.cls).toContain('is-unavailable');
            expect(button.vdom['aria-haspopup'], 'nothing to open').toBeFalsy();
            expect(button.vdom['aria-disabled']).toBe('true')
        } finally {
            head.destroy();
            store.destroy()
        }
    });

    test('the floating list binds the provider Store as given and leaves it alive with the button', async () => {
        const store          = Neo.create(FleetAwaitingMerge, {data: [pr(794, {repo: 'neomjs/neo-agent-brain', id: 'neomjs/neo-agent-brain#794'})]}),
              {head, button} = createButton({openWork: ok, store});

        try {
            await expect.poll(() => Boolean(button.menuList)).toBe(true);

            const menu = button.menuList,
                  row  = menu.createItemContent(store.getAt(0));

            expect(menu.store).toBe(store);
            expect(row.cn[0].text).toBe('neomjs/neo-agent-brain #794');
            expect(row.title).toBe('https://github.com/neomjs/neo-agent-brain/pull/794');
            expect(row.cn.some(node => 'html' in node), 'remote data renders as text nodes').toBe(false)
        } finally {
            head.destroy()
        }

        expect(store.isDestroyed, 'the provider owns the Store').toBeFalsy();
        store.destroy()
    });

    test('a titled row reads #N · title with the repository and the whole title in its tooltip; an untitled row keeps its reference and its link', async () => {
        const
            title          = 'feat(agentos): the awaiting-merge list names each pull request by its title',
            store          = Neo.create(FleetAwaitingMerge, {data: [pr(19499, {title}), pr(799, {repo: 'neomjs/neo-agent-brain', id: 'neomjs/neo-agent-brain#799', stale: true})]}),
            {head, button} = createButton({openWork: ok, store});

        try {
            await expect.poll(() => Boolean(button.menuList)).toBe(true);

            const
                titled   = button.menuList.createItemContent(store.getAt(0)),
                untitled = button.menuList.createItemContent(store.getAt(1));

            expect(titled.cn[0].text).toBe(`#19499 · ${title}`);
            expect(titled.title).toBe(`neomjs/neo #19499 · ${title}`);
            expect(titled.cn[0].href, 'the row stays a link to the PR').toBe('https://github.com/neomjs/neo/pull/19499');

            expect(store.getAt(1).title, 'a row without one reads null').toBeNull();
            expect(untitled.cn[0].text).toBe('neomjs/neo-agent-brain #799');
            expect(untitled.title).toBe('https://github.com/neomjs/neo-agent-brain/pull/799');
            expect(untitled.cn.map(node => node.text), 'the stale chip is unchanged').toEqual(['neomjs/neo-agent-brain #799', 'stale'])
        } finally {
            head.destroy()
        }

        store.destroy()
    });

    test('an open list closes when the queue stops being one', async () => {
        const store          = Neo.create(FleetAwaitingMerge, {data: [pr(1)]}),
              {head, button} = createButton({openWork: ok, store});

        try {
            await expect.poll(() => Boolean(button.menuList)).toBe(true);

            const menu   = button.menuList,
                  closed = [];

            // stand in for an open list without mounting it: the raw backing field skips show()
            menu._hidden = false;
            menu.unmount = () => { closed.push(true); menu._hidden = true };

            store.data = [pr(1), pr(2)];
            expect(closed, 'a queue that grows keeps its list open').toEqual([]);

            store.data = [];
            expect(closed, 'an emptied queue closes its list').toEqual([true]);
            expect(button.hidden).toBe(true)
        } finally {
            head.destroy();
            store.destroy()
        }
    });

    test('a destroyed list leaves no subscriber on the provider Store, however often it is rebuilt', async () => {
        const
            store = Neo.create(FleetAwaitingMerge, {data: [pr(1)]}),
            spy   = spyStoreHandlers();

        try {
            for (let i = 0; i < 3; i++) {
                const {head, button} = createButton({openWork: ok, store});

                await expect.poll(() => Boolean(button.menuList)).toBe(true);
                head.destroy()
            }

            spy.received.length = 0;

            store.data    = [pr(1), pr(2)];
            store.sorters = [{property: 'number', direction: 'DESC'}];
            store.filters = [{property: 'number', operator: '>', value: 1}];
            store.getAt(0).set({ci: 'red'});

            expect(spy.received, 'no Store event reaches a destroyed list').toEqual([]);
            expect(store.isDestroyed, 'the provider owns the Store').toBeFalsy()
        } finally {
            spy.restore();
            store.destroy()
        }
    });

    test('a list handed another Store stops hearing the one it left', async () => {
        const
            left           = Neo.create(FleetAwaitingMerge, {data: [pr(1)]}),
            next           = Neo.create(FleetAwaitingMerge, {data: [pr(2)]}),
            spy            = spyStoreHandlers(),
            {head, button} = createButton({openWork: ok, store: left});

        try {
            await expect.poll(() => Boolean(button.menuList)).toBe(true);

            button.store = next;
            expect(button.menuList.store).toBe(next);

            spy.received.length = 0;
            left.data = [pr(1), pr(3)];

            expect(spy.received, 'the Store it left no longer reaches it').toEqual([]);
            expect(left.isDestroyed, 'a replaced provider Store lives on').toBeFalsy();

            next.data = [pr(2), pr(4)];
            expect(spy.received.map(({name}) => name), 'the Store it holds still does').toContain('onStoreLoad')
        } finally {
            head.destroy();
            spy.restore();
            left.destroy();
            next.destroy()
        }
    });
});
