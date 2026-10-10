import {test, expect, loadAgentOsModule}  from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const {createFleetMailboxMirrorSnapshot} = await loadAgentOsModule('ai/services/fleet/fleetMailboxMirrorAdapter.mjs');

const
    CORPUS = 60,
    WINDOW = 50,
    corpus = Array.from({length: CORPUS}, (v, i) => ({
        messageId     : `MESSAGE:fixture-${i}`,
        subject       : `fixture subject ${i}`,
        from          : '@review-peer-a',
        to            : '@e2e-operator',
        recipientClass: 'agent',
        priority      : 'normal',
        status        : 'unread',
        taskState     : null,
        partOfThread  : null,
        relatedTickets: [],
        wakeSuppressed: false,
        sentAt        : new Date(Date.UTC(2026, 6, 16, 10, 59 - (i % 60), 0)).toISOString(),
        readAt        : null
    }));

/**
 * A fleet whose operator inbox is deeper than one window: 60 rows, served 50 at a time, the
 * mirror reporting `hasMore` honestly. Every request is recorded, offsets included.
 */
async function startDeepInboxFleet() {
    const {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
          requests                 = [],
          options                  = authenticatedFleetOptions({
              dispatch: async request => {
                  requests.push(request);

                  switch (request.method) {
                      case 'resolveViewerIdentity':
                          return fleetE2ESuccess({ok: true, agentIdentityNodeId: '@e2e-operator'});
                      case 'fleetRoster':
                          return fleetE2ESuccess({rows: []});
                      case 'fleetActivity':
                          return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                      case 'fleetMailboxMirror': {
                          const offset = request.params?.offset ?? 0;

                          return fleetE2ESuccess(createFleetMailboxMirrorSnapshot({
                              messages: corpus.slice(offset, offset + WINDOW),
                              hasMore : offset + WINDOW < CORPUS,
                              page    : {limit: WINDOW, offset},
                              subject : '@e2e-operator',
                              viewer  : '@e2e-operator'
                          }))
                      }
                      default:
                          return fleetE2EFailure(`unexpected deep-inbox method: ${request.method}`)
                  }
              }
          }),
          server                   = await startFleetBridgeServer(options);

    return {
        requests,
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    }
}

/**
 * The cockpit's mailbox pane used to walk the operator's whole inbox as soon as its first
 * window landed (one Memory Core page per second, 173 pages on the team plane), and every other
 * read on the plane starved behind it. This journey witnesses the replacement in the real
 * browser from the grid's `scrollEdge` down: a boot reads ONE window and nothing more on its own,
 * the announced edge reads exactly the next window and appends it, and the honest end reads
 * nothing. The body's own detection of that edge is unit-covered; see the note inside.
 */
test.describe('AgentOS operator mailbox — one window at boot, the next at the scroll edge (#416)', () => {
    test.setTimeout(120000);

    test('a boot reads one mirror window; reaching the loaded end reads the next; the honest end reads nothing', async ({page, neuralLink}) => {
        const fleet = await startDeepInboxFleet();

        try {
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}`);
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            expect(cockpit?.properties?.id).toBeTruthy();
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
            await app.callMethod(cockpit.properties.id, 'controller.loadOperatorIdentity');

            const mailboxTab = page.getByRole('tab', {name: 'Mailbox', exact: true});
            await expect(mailboxTab).toHaveCount(1);
            await mailboxTab.click();

            const mailboxPane = page.locator('.fm-operator-mailbox');
            await expect(mailboxPane).toBeVisible({timeout: 10000});

            const
                offsets  = () => fleet.requests.filter(request => request.method === 'fleetMailboxMirror').map(request => request.params?.offset ?? 0),
                unwrap   = answer => (typeof answer === 'object' && answer !== null && 'result' in answer) ? answer.result : answer,
                [pane]   = await app.queryComponent({className: 'AgentOS.view.fleet.mailbox.Container'}, ['id']),
                [grid]   = await app.queryComponent({className: 'AgentOS.view.fleet.mailbox.Grid'}, ['id']),
                held     = async () => unwrap(await app.callMethod(pane.properties.id, 'store.getCount'))

            await expect.poll(held, {timeout: 10000}).toBe(WINDOW);

            // The cockpit's south drawer hands this pane 67 px beside the compose form, so the
            // engine measures 48 px of body, derives zero available rows and renders none
            // (defect-note 2026-10-02; the strip's sizing is the cockpit's, and neither a taller
            // viewport nor a height config on the pane changes what the ResizeObserver measures
            // there). The body's own edge detection is therefore witnessed in the unit arms over
            // the engine's window math; what this journey witnesses is everything downstream of
            // the grid's `scrollEdge` in the real app: the pane's gate, the operator container's
            // relay, the cockpit's bridge read at the next offset, and the append.

            // the viewport never reached an edge: nothing is asked for beyond the boot read
            await page.waitForTimeout(500);
            expect(offsets()).toEqual([0]);

            // the grid announces the loaded end: ONE more read, at the next offset, appended
            await app.callMethod(grid.properties.id, 'fire', ['scrollEdge', {startIndex: 41, endIndex: 50, count: 50}]);
            await expect.poll(offsets, {timeout: 15000}).toEqual([0, WINDOW]);
            await expect.poll(held, {timeout: 15000}).toBe(CORPUS);

            const [after] = await app.queryComponent({className: 'AgentOS.view.fleet.mailbox.Container'}, ['snapshot', 'pendingOffset']);
            expect(after.properties.snapshot.page).toMatchObject({offset: WINDOW, count: CORPUS - WINDOW, hasMore: false});
            expect(after.properties.pendingOffset).toBeNull();

            // the honest end: the mirror said hasMore: false, so the next edge reads nothing
            await app.callMethod(grid.properties.id, 'fire', ['scrollEdge', {startIndex: 51, endIndex: 60, count: 60}]);
            await page.waitForTimeout(800);
            expect(offsets()).toEqual([0, WINDOW])
        } finally {
            await fleet.close()
        }
    })
});

test('older pages preserve the visible reading anchor, thread facts and selected detail', async ({page, neuralLink}) => {
    await neuralLink.routeConfig(page, config => ({
        ...config,
        themes     : ['neo-theme-neo-dark', 'neo-theme-neo-light'],
        useAiClient: true
    }));
    await page.goto('/test/playwright/component/apps/empty-viewport/index.html');
    await expect(page.locator('#component-test-viewport')).toBeVisible();

    const
        app        = await neuralLink.connectToApp(),
        capturedAt = '2026-10-10T12:00:00.000Z',
        rows       = Array.from({length: 150}, (_, i) => ({
            ...corpus[0],
            messageId   : `MESSAGE:reading-${i}`,
            subject     : `Reading message ${i}`,
            sentAt      : new Date(Date.parse(capturedAt) - i * 1000).toISOString(),
            partOfThread: [0, 1, 51].includes(i) ? 'THREAD:expanded' : [2, 3, 50, 100].includes(i) ? 'THREAD:collapsed' : null
        })),
        snapshot = (offset, values=rows.slice(offset, offset + WINDOW)) => ({
            capability: {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', capturedAt, reason: null},
            admission : {state: 'granted', viewerIdentity: '@tobiu', subjectAgentId: '@neo-opus-vega', checkedAt: capturedAt, reason: null},
            rows      : values,
            page      : {limit: WINDOW, offset, count: values.length, hasMore: offset + WINDOW < rows.length}
        }),
        created = await page.evaluate(config => Neo.worker.App.createNeoInstance(config), {
            importPath: '../../../../apps/agentos/view/fleet/mailbox/Container.mjs',
            ntype     : 'fm-mailbox-pane',
            parentId  : 'component-test-viewport',
            height    : 600,
            record    : {agentId: 'vega', githubUsername: 'neo-opus-vega'},
            snapshot  : snapshot(0)
        });

    expect(created.success).toBe(true);

    try {
        await expect(page.locator('.fm-mail-subject').first()).toHaveText('Reading message 0');
        const [grid] = await app.queryComponent({ntype: 'fm-mailbox-grid'}, ['store', 'view', 'body']);
        const {store, view, body} = grid.properties;
        const scroller = page.locator(`[id="${view.id}"]`);
        const paneState = () => app.getComponent(created.id, ['selectedMessageId', 'pendingOffset']);

        expect((await paneState()).pendingOffset).toBeNull();
        expect((await app.inspectStore(store.id, 150)).count).toBe(48);

        await scroller.evaluate(element => { element.scrollTop = 1 });
        await page.locator('.fm-mail-row').filter({has: page.getByText('Reading message 0', {exact: true})})
            .locator('.fm-mail-thread-toggle').dispatchEvent('click');
        await expect(page.locator('.fm-mail-thread-toggle').first()).toHaveText('collapse thread');
        await expect.poll(async () => (await app.inspectStore(store.id, 150)).count).toBe(49);
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);

        for (const offset of [50, 100]) {
            await scroller.evaluate(element => { element.scrollTop = element.scrollHeight });
            await expect.poll(async () => (await paneState()).pendingOffset).toBe(offset);
            await expect.poll(async () => (await app.getComponent(body.id, ['startIndex'])).startIndex).toBeGreaterThan(35);

            const anchor = await scroller.evaluate(element => {
                const top = element.getBoundingClientRect().top;
                const row = [...element.querySelectorAll('.neo-grid-row')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).find(row => {
                    const rect = row.getBoundingClientRect();
                    return rect.bottom > top && rect.top < top + element.clientHeight && row.querySelector('.fm-mail-subject')
                });
                return {subject: row.querySelector('.fm-mail-subject').textContent, offset: row.getBoundingClientRect().top - top, scrollTop: element.scrollTop}
            });

            if (offset === 50) {
                await page.getByText(anchor.subject, {exact: true}).dispatchEvent('click');
                await expect.poll(async () => (await paneState()).selectedMessageId).toBe(`MESSAGE:reading-${anchor.subject.split(' ').at(-1)}`)
            }

            const selectedId = (await paneState()).selectedMessageId;
            await scroller.evaluate((element, subject) => {
                window.mailboxFrames = [];
                window.mailboxSampling = true;
                const sample = () => {
                    const row = [...element.querySelectorAll('.neo-grid-row')].find(row => row.querySelector('.fm-mail-subject')?.textContent === subject);
                    window.mailboxFrames.push({
                        scrollTop: element.scrollTop,
                        offset   : row ? row.getBoundingClientRect().top - element.getBoundingClientRect().top : null
                    });
                    if (window.mailboxSampling) requestAnimationFrame(sample)
                };
                requestAnimationFrame(sample)
            }, anchor.subject);

            await app.setProperties(created.id, {snapshot: snapshot(offset)});
            await expect.poll(async () => (await app.inspectStore(store.id, 150)).count).toBe(offset === 50 ? 98 : 147);

            // Observe every paint through the body's deferred reset window, including the frames
            // between projection and settlement; a final-position-only assertion misses a jump back.
            const frames = await page.evaluate(() => new Promise(resolve => {
                const until = performance.now() + 200;
                const finish = () => {
                    if (performance.now() < until) return requestAnimationFrame(finish);
                    window.mailboxSampling = false;
                    resolve(window.mailboxFrames)
                };
                requestAnimationFrame(finish)
            }));
            expect(frames.length).toBeGreaterThan(1);
            for (const frame of frames) {
                expect(frame.scrollTop).toBe(anchor.scrollTop);
                expect(frame.offset).not.toBeNull();
                expect(Math.abs(frame.offset - anchor.offset)).toBeLessThan(1)
            }

            const held = await app.inspectStore(store.id, 150);
            expect(new Set(held.items.map(item => item.messageId)).size).toBe(held.count);
            expect(held.items.every(item => item.status === 'unread')).toBe(true);
            const rendered = await scroller.locator('.fm-mail-subject:visible').allTextContents();
            expect(new Set(rendered).size).toBe(rendered.length);
            expect(rendered.every(subject => held.items.some(item => item.subject === subject))).toBe(true);
            expect(held.items.find(item => item.messageId === 'MESSAGE:reading-0').threadFacts).toMatchObject({isHead: true, collapsed: false, hiddenCount: 2});
            expect(held.items.find(item => item.messageId === 'MESSAGE:reading-2').threadFacts).toMatchObject({isHead: true, collapsed: true, hiddenCount: offset === 50 ? 2 : 3});
            expect((await paneState()).selectedMessageId).toBe(selectedId);
            expect((await paneState()).pendingOffset).toBeNull();
            const selection = (await app.getComponent(view.id, ['rowSelectionModel'])).rowSelectionModel;
            expect(selection.selectedRows).toHaveLength(1);
            const selectedRecord = await app.callMethod(store.id, 'get', [selection.selectedRows[0]]);
            expect(selectedRecord?.messageId).toBe(selectedId);
            const [detail] = await app.queryComponent({reference: 'mailbox-detail'}, ['row', 'hidden']);
            expect(detail.properties.hidden).toBe(false);
            expect(detail.properties.row.messageId).toBe(selectedId)
        }

        await app.setProperties(created.id, {snapshot: snapshot(0, [rows[149]])});
        await expect.poll(async () => (await app.inspectStore(store.id)).count).toBe(1);
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
        expect((await paneState()).selectedMessageId).toBeNull();
        expect((await app.getComponent(view.id, ['rowSelectionModel'])).rowSelectionModel.selectedRows).toEqual([]);
        const [detail] = await app.queryComponent({reference: 'mailbox-detail'}, ['row', 'hidden']);
        expect(detail.properties.hidden).toBe(true);
        expect(detail.properties.row).toBeNull();

        await page.getByText(rows[149].subject, {exact: true}).dispatchEvent('click');
        await expect.poll(async () => (await paneState()).selectedMessageId).toBe(rows[149].messageId);
        await app.setProperties(created.id, {record: {agentId: 'other', githubUsername: 'another-resident'}});
        await expect.poll(async () => (await app.inspectStore(store.id)).count).toBe(0);
        expect((await paneState()).selectedMessageId).toBeNull();
        expect((await app.getComponent(view.id, ['rowSelectionModel'])).rowSelectionModel.selectedRows).toEqual([])
    } finally {
        await page.evaluate(id => Neo.worker.App.destroyNeoInstance(id), created.id)
    }
});
