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
    let AwaitingMergeButton, Container, FleetAwaitingMerge, describeMergeQueue;

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

        AwaitingMergeButton = module.default;
        describeMergeQueue  = module.describeMergeQueue;
        Container           = (await import('../../../../../../../../node_modules/neo.mjs/src/container/Base.mjs')).default;
        FleetAwaitingMerge  = (await import('../../../../../../../../apps/agentos/store/FleetAwaitingMerge.mjs')).default
    });

    test('the words follow the read\'s state and the queue\'s size', () => {
        const now = Date.parse('2026-10-03T08:12:00.000Z');

        expect(describeMergeQueue(null, 0).hidden, 'no read yet').toBe(true);
        expect(describeMergeQueue(ok, 0).hidden, 'zero earns no pixels').toBe(true);
        expect(describeMergeQueue({...ok, state: 'unavailable', coverage: 'not-wired'}, 0).hidden, 'an unwired verb is an expected absence').toBe(true);
        expect(describeMergeQueue({...ok, state: 'unavailable', coverage: 'unanswered'}, 0).hidden, 'a thrown read is the spine banner\'s story').toBe(true);

        expect(describeMergeQueue(ok, 2)).toEqual({
            hidden: false, interactive: true, stale: false, unavailable: false,
            text  : '2 awaiting merge',
            title : '2 pull requests approved, green and mergeable, awaiting your merge'
        });

        const stale = describeMergeQueue({...ok, state: 'stale'}, 1, now);

        expect(stale.text).toBe('1 awaiting merge · stale');
        expect(stale.title).toBe('1 pull request approved, green and mergeable, awaiting your merge · stale, observed 12m ago');

        // a read that failed is named, never shown as an empty queue, and opens nothing
        expect(describeMergeQueue({...ok, state: 'unavailable', coverage: 'unavailable', reason: 'the GitHub read failed'}, 0)).toEqual({
            hidden: false, interactive: false, stale: false, unavailable: true,
            text  : 'merge queue unavailable',
            title : 'The merge queue could not be read: the GitHub read failed'
        })
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
});
