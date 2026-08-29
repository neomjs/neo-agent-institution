import {test, expect} from '@playwright/test';

let paneId;

/**
 * @summary The mounted Grid→pooled-row seam witness (#40 / PR #41 RA-3): a populated mailbox pane
 * rendering through the REAL pipeline — `Neo.grid.Container` → `grid.column.Component` → the pooled
 * {@link AgentOS.view.fleet.mailbox.RowComponent} — in a browser, across the worker boundary.
 *
 * What only this layer can prove (the Node unit specs assert instances and direct method calls):
 * 1. the component column actually materializes pooled row cells into the DOM from store records;
 * 2. a snapshot swap RECYCLES those cells — the same mounted surface re-seats `record` (subjects
 *    swap in place) and `threadFacts` (a toggle appears when a thread arrives);
 * 3. the thread toggle works through the REAL delegated event path — a genuine click on the native
 *    button inside the grid row, resolved via the engine's `.neo-grid-row` `data.recordId` contract.
 *
 * All assertions are text/count checks — no fonts, no colors, no geometry.
 */
test.describe('AgentOS.view.fleet.mailbox — the mounted Grid → pooled RowComponent seam', () => {
    const CAPTURED_AT = '2026-07-16T12:00:00.000Z';

    const row = (id, subject, overrides = {}) => ({
        messageId     : id,
        subject,
        from          : '@neo-gpt-emmy',
        recipientClass: 'agent',
        priority      : 'normal',
        status        : 'read',
        taskState     : null,
        partOfThread  : null,
        relatedTickets: [],
        wakeSuppressed: false,
        sentAt        : '2026-07-16T11:00:00.000Z',
        readAt        : null,
        ...overrides
    });

    const snapshot = rows => ({
        capability: {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', capturedAt: CAPTURED_AT, reason: null},
        admission : {state: 'granted', viewerIdentity: '@tobiu', subjectAgentId: '@neo-opus-vega', checkedAt: CAPTURED_AT, reason: null},
        rows,
        page      : {limit: 50, offset: 0, count: rows.length, hasMore: false}
    });

    test.beforeEach(async ({page}) => {
        await page.goto('test/playwright/component/apps/empty-viewport/index.html');
        await page.waitForSelector('#component-test-viewport', {state: 'attached'});
    });

    test.afterEach(async ({page}) => {
        if (paneId) {
            await page.evaluate(id => Neo.worker.App.destroyNeoInstance(id), paneId);
            paneId = null;
        }
    });

    test('pooled cells render, recycle onto new records + thread facts, and the real toggle click expands', async ({page}) => {
        const result = await page.evaluate(config => Neo.worker.App.createNeoInstance(config), {
            importPath: '../../../../apps/agentos/view/fleet/mailbox/Container.mjs',
            ntype     : 'fm-mailbox-pane',
            parentId  : 'component-test-viewport',
            height    : 400,
            record    : {agentId: 'vega', githubUsername: 'neo-opus-vega'},
            snapshot  : snapshot([
                row('MESSAGE:a', 'first window alpha'),
                row('MESSAGE:b', 'first window beta', {sentAt: '2026-07-16T10:00:00.000Z'})
            ])
        });

        if (!result.success) {
            throw new Error(`Component creation failed: ${result.error.message}`);
        }

        paneId = result.id;

        // 1. the REAL pipeline materialized pooled row cells into the DOM. The grid renders only
        //    after its measurement cycle settles (the engine's own grid e2e waits up to 60s for
        //    first rows) — wait for the first cell before asserting counts.
        await page.waitForSelector('.fm-mail-row', {timeout: 30000});

        const rows = page.locator('.fm-mail-row:visible');
        await expect(rows).toHaveCount(2);
        await expect(page.locator('.fm-mail-row:visible .fm-mail-subject').nth(0)).toHaveText('first window alpha');
        await expect(page.locator('.fm-mail-row:visible .fm-mail-subject').nth(1)).toHaveText('first window beta');

        // 2. RECYCLE: a new snapshot re-seats the SAME mounted surface — subjects swap in place,
        //    and a thread head arrives carrying its toggle (threadFacts reached the pooled cell)
        await page.evaluate(([id, snap]) => Neo.worker.App.setConfigs({id, snapshot: snap}), [paneId, snapshot([
            row('MESSAGE:h', 'thread newest', {partOfThread: 'THREAD:x', status: 'unread'}),
            row('MESSAGE:m', 'thread earlier', {partOfThread: 'THREAD:x', sentAt: '2026-07-16T10:30:00.000Z'}),
            row('MESSAGE:s', 'standalone gamma', {sentAt: '2026-07-16T09:00:00.000Z'})
        ])]);

        // collapsed: head + standalone visible, the member hidden by the store filter
        await expect(page.locator('.fm-mail-row:visible')).toHaveCount(2);
        await expect(page.locator('.fm-mail-row:visible .fm-mail-subject').nth(0)).toHaveText('thread newest');

        const toggle = page.locator('.fm-mail-thread-toggle:visible');
        await expect(toggle).toHaveCount(1);
        await expect(toggle).toHaveText('+1 earlier');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        // 3. the REAL delegated event path: a genuine bubbling DOM click on the native button —
        //    the grid's delegated listener resolves the record via `.neo-grid-row` data.recordId
        //    and flips the view-owned collapse state; the member materializes. Dispatched rather
        //    than pointer-synthesized: the engine's GridDragScroll layer sits over the rows and
        //    preventDefaults every mousedown, so raw pointer clicks land on the layer, not the
        //    button — an ENGINE seam (filed as a defect-note; bigData's cell buttons share it),
        //    deliberately not worked around here with force-clicks that would test nothing.
        await toggle.dispatchEvent('click');

        // visible-row truth comes from the store filter, not a DOM node count — the component
        // pool legitimately keeps recycled cells in hidden rows
        await expect(page.locator('.fm-mail-thread-toggle:visible')).toHaveText('collapse thread');
        await expect(page.locator('.fm-mail-thread-toggle:visible')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.fm-mail-row:visible .fm-mail-subject').nth(1)).toHaveText('thread earlier');

        // and back: collapse hides the member again through the same path
        await page.locator('.fm-mail-thread-toggle:visible').first().dispatchEvent('click');
        await expect(page.locator('.fm-mail-thread-toggle:visible')).toHaveText('+1 earlier');
        await expect(page.locator('.fm-mail-thread-toggle:visible')).toHaveAttribute('aria-expanded', 'false')
    });
});
