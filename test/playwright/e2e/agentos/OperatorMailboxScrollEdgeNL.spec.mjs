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
