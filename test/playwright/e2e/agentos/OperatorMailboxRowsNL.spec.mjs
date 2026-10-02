import {test, expect, loadAgentOsModule}  from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const {createFleetMailboxMirrorSnapshot} = await loadAgentOsModule('ai/services/fleet/fleetMailboxMirrorAdapter.mjs');

const corpus = Array.from({length: 50}, (v, i) => ({
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
 * A fleet whose operator inbox holds one full window of rows.
 */
async function startInboxFleet() {
    const {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
          options                  = authenticatedFleetOptions({
              dispatch: async request => {
                  switch (request.method) {
                      case 'resolveViewerIdentity':
                          return fleetE2ESuccess({ok: true, agentIdentityNodeId: '@e2e-operator'});
                      case 'fleetRoster':
                          return fleetE2ESuccess({rows: []});
                      case 'fleetActivity':
                          return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                      case 'fleetMailboxMirror':
                          return fleetE2ESuccess(createFleetMailboxMirrorSnapshot({
                              messages: corpus,
                              hasMore : false,
                              page    : {limit: 50, offset: 0},
                              subject : '@e2e-operator',
                              viewer  : '@e2e-operator'
                          }));
                      default:
                          return fleetE2EFailure(`unexpected inbox method: ${request.method}`)
                  }
              }
          }),
          server                   = await startFleetBridgeServer(options);

    return {
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    }
}

/**
 * The operator mailbox used to render no rows in the cockpit's south strip at any window height:
 * the always-open compose form took the strip at its natural height and the inbox was pinned to a
 * 96 px floor, under one 84 px row, so the engine derived zero available rows (measured at 1280×720
 * and 1440×1800 before the reveal). This journey reads the strip the operator actually gets.
 */
test.describe('AgentOS operator mailbox — the inbox gets the strip, compose is a reveal', () => {
    test.setTimeout(120000);

    test('at 1280×720 the operator inbox renders rows; the compose chip reveals the form over one row of context and Escape folds it', async ({page, neuralLink}) => {
        const fleet = await startInboxFleet();

        try {
            await page.setViewportSize({width: 1280, height: 720});
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

            const
                mailboxPane = page.locator('.fm-operator-mailbox'),
                body        = page.locator('.fm-mailbox-grid .neo-grid-body').first(),
                firstRow    = page.locator('.fm-mailbox-grid .fm-mail-row').first(),
                form        = page.locator('.fm-operator-compose-form'),
                chip        = page.locator('.fm-compose-affordance').first(),
                ROW         = 84,
                bodyHeight  = async () => (await body.boundingBox())?.height ?? 0;

            await expect(mailboxPane).toBeVisible({timeout: 10000});

            // the strip is the inbox's: the body holds at least one lattice row and rows render
            // where before none did (dev at 1280×720: a 48px body, zero rows)
            await expect.poll(bodyHeight, {timeout: 15000}).toBeGreaterThan(ROW);
            await expect(firstRow).toBeVisible({timeout: 10000});
            await expect(page.locator('.fm-mailbox-grid')).toContainText('fixture subject 0');
            await expect(form).toBeHidden();
            await expect(chip).toBeVisible();
            const folded = await bodyHeight();

            // the chip reveals the form; the inbox keeps one row of context, the form has room
            await chip.click();
            await expect(form).toBeVisible({timeout: 5000});
            await expect.poll(bodyHeight, {timeout: 15000}).toBeGreaterThan(ROW);
            await expect(firstRow).toBeVisible();
            expect((await form.boundingBox()).height, 'the form has room to scroll in').toBeGreaterThan(40);

            // Escape inside the form folds it, and the rows get the strip back
            await page.getByRole('textbox', {name: 'Subject'}).focus();
            await page.keyboard.press('Escape');
            await expect(form).toBeHidden({timeout: 5000});
            await expect.poll(bodyHeight, {timeout: 15000}).toBeGreaterThanOrEqual(folded)
        } finally {
            await fleet.close()
        }
    })
});
