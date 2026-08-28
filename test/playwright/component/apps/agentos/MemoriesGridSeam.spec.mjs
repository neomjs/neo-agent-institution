import {test, expect} from '@playwright/test';

let paneId;

/**
 * @summary The mounted memories seam witness (#44): the pane rendering through the REAL pipeline —
 * `Neo.grid.Container` → `grid.column.Component` → the pooled SummaryRow/TurnRow cells — in a
 * browser, across the worker boundary (the MailboxGridSeam pattern, applied from day one).
 *
 * What only this layer can prove (the Node unit specs assert instances and direct calls):
 * 1. the summary register materializes pooled card cells (band eyebrow included) from store records;
 * 2. a snapshot swap RECYCLES those cells — the same mounted surface re-seats new bags in place;
 * 3. the drill-open works through the REAL delegated event path — a genuine click on the native
 *    button inside the grid row, resolved via the engine's `.neo-grid-row` `data.recordId`
 *    contract — and the drill register renders the injected session turns; back restores the list.
 *
 * All assertions are text/count checks — no fonts, no colors, no geometry.
 */
test.describe('AgentOS.view.fleet.memories — the mounted grid registers seam', () => {
    const summaryRow = (id, title, timestamp) => ({
        id,
        sessionId            : `${id}-session`,
        timestamp,
        title,
        summary              : `Summary of ${title}`,
        category             : 'analysis',
        memoryCount          : 2,
        quality              : 88,
        impact               : 40,
        sourceAgentIdentities: []
    });

    const envelope = (sessions, total = sessions.length) => ({
        capability: {state: 'wired', capturedAt: '2026-08-28T12:00:00.000Z'},
        viewer    : '@e2e-operator',
        target    : '@neo-opus-vega',
        page      : {offset: 0, limit: 20},
        sessions,
        count     : sessions.length,
        total
    });

    const drillEnvelope = (sessionId, turns) => ({
        capability: {state: 'wired', capturedAt: '2026-08-28T12:00:00.000Z'},
        viewer    : '@e2e-operator',
        sessionId,
        page      : {offset: 0, limit: 20},
        turns,
        count     : turns.length,
        total     : turns.length
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

    test('pooled cards render with band facts, recycle onto new bags, and the real drill round-trip works', async ({page}) => {
        const result = await page.evaluate(config => Neo.worker.App.createNeoInstance(config), {
            importPath: '../../../../apps/agentos/view/fleet/memories/Container.mjs',
            ntype     : 'fm-memories-pane',
            parentId  : 'component-test-viewport',
            height    : 500,
            snapshot  : envelope([
                summaryRow('s1', 'Mailbox grid conversion', '2026-07-02T10:00:00.000Z'),
                summaryRow('s2', 'Design sketch arc', '2026-07-01T10:00:00.000Z')
            ])
        });

        if (!result.success) {
            throw new Error(`Component creation failed: ${result.error.message}`);
        }

        paneId = result.id;

        // 1. the REAL pipeline materialized pooled card cells (the grid renders after its
        //    measurement cycle settles — wait for the first cell before asserting counts)
        await page.waitForSelector('.fm-memories-card-cell', {timeout: 30000});

        await expect(page.locator('.fm-memories-card-cell:visible')).toHaveCount(2);
        await expect(page.locator('.fm-memories-card-cell:visible .fm-memories-card-title').nth(0)).toHaveText('Mailbox grid conversion');
        await expect(page.locator('.fm-memories-card-cell:visible .fm-memories-card-title').nth(1)).toHaveText('Design sketch arc');
        // the stamped band facts reached the pooled cells: far-past stamps fall in the ONE
        // 'earlier' viewer-calendar band under ANY live clock → exactly one eyebrow, first card
        await expect(page.locator('.fm-memories-band:visible')).toHaveCount(1);

        // 2. RECYCLE: a new snapshot re-seats the SAME mounted surface — titles swap in place
        await page.evaluate(([id, snap]) => Neo.worker.App.setConfigs({id, snapshot: snap}), [paneId, envelope([
            summaryRow('s3', 'Institution debt matrix', '2026-07-03T11:00:00.000Z'),
            summaryRow('s4', 'Fleet contract successors', '2026-07-02T11:00:00.000Z'),
            summaryRow('s5', 'Scroll edge seam', '2026-07-01T11:00:00.000Z')
        ])]);

        await expect(page.locator('.fm-memories-card-cell:visible')).toHaveCount(3);
        await expect(page.locator('.fm-memories-card-cell:visible .fm-memories-card-title').nth(0)).toHaveText('Institution debt matrix');

        // 3. the REAL delegated event path: a genuine bubbling DOM click on the native open
        //    button — the grid resolves the record via `.neo-grid-row` data.recordId and the pane
        //    fires the drill intent. Dispatched rather than pointer-synthesized: the engine's
        //    GridDragScroll layer preventDefaults every mousedown over the rows (the seam recorded
        //    on MailboxGridSeam.spec.mjs; defect-note broadcast 2026-08-28).
        await page.locator('.fm-memories-card-open:visible').first().dispatchEvent('click');

        // the drill chrome takes the zone: head + honest pending copy, summary cards gone
        await expect(page.locator('.fm-memories-drill-title')).toHaveText('Institution debt matrix');
        await expect(page.locator('.fm-memories-card-cell:visible')).toHaveCount(0);
        await expect(page.locator('.fm-memories-empty:visible')).toContainText('Reading this session');

        // the session's turns answer: the turn register renders through ITS grid
        await page.evaluate(([id, snap]) => Neo.worker.App.setConfigs({id, drillSnapshot: snap}), [paneId, drillEnvelope('s3-session', [
            {id: 't1', sessionId: 's3-session', timestamp: '2026-08-28T10:30:00.000Z', prompt: 'map the debt', thought: null, response: 'Controllers and providers mapped.', agentIdentity: '@neo-fable-clio', amountToolCalls: 7},
            {id: 't2', sessionId: 's3-session', timestamp: '2026-08-28T10:20:00.000Z', prompt: null, thought: null, response: 'Matrix drafted.', agentIdentity: '@neo-fable-clio', amountToolCalls: 3}
        ])]);

        await expect(page.locator('.fm-memories-turn-cell:visible')).toHaveCount(2);
        await expect(page.locator('.fm-memories-turn-cell:visible .fm-memories-turn-response').nth(0)).toHaveText('Controllers and providers mapped.');
        await expect(page.locator('.fm-memories-turn-cell:visible .fm-memories-turn-prompt')).toHaveCount(1);

        // back restores the summary register — the pane chrome button sits outside the grid's
        // drag layer, so a real pointer click works here
        await page.locator('.fm-memories-drill-back').click();

        await expect(page.locator('.fm-memories-card-cell:visible')).toHaveCount(3);
        await expect(page.locator('.fm-memories-turn-cell:visible')).toHaveCount(0)
    });
});
