import {test, expect, loadAgentOsModule} from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const {createFleetMailboxMirrorRow, createFleetMailboxMirrorSnapshot} = await loadAgentOsModule('ai/services/fleet/fleetMailboxMirrorAdapter.mjs');

const OPERATOR = '@e2e-operator';

/**
 * A fixture plane whose operator holds two open questions, one of them archived, beside a plain message.
 * It answers the reads the way the Brain does: the open questions (non-terminal Tasks, archived ones
 * included) with their complete count, the open work's `questions` count from the same set, the all-mail
 * mirror without archived mail, and a read receipt that changes a message's status and never its Task.
 */
async function startOpenQuestionsFleet() {
    const
        calls    = [],
        messages = [{
            messageId: 'MESSAGE:q1',
            subject  : '[question] which plane do the seats bind?',
            from     : '@review-peer-a',
            to       : OPERATOR,
            priority : 'high',
            task     : {state: 'InputRequired', assignee: OPERATOR},
            sentAt   : '2026-10-08T21:00:00.000Z',
            readAt   : null
        }, {
            messageId : 'MESSAGE:q2',
            subject   : '[question] keep the old switcher label?',
            from      : '@review-peer-b',
            to        : OPERATOR,
            priority  : 'normal',
            task      : {state: 'Submitted', assignee: OPERATOR},
            sentAt    : '2026-10-08T22:00:00.000Z',
            readAt    : '2026-10-08T22:30:00.000Z',
            archivedAt: '2026-10-08T23:00:00.000Z'
        }, {
            messageId: 'MESSAGE:m1',
            subject  : '[status] the night shift continues',
            from     : '@review-peer-b',
            to       : OPERATOR,
            sentAt   : '2026-10-08T23:30:00.000Z',
            readAt   : null
        }],
        open = () => messages.filter(message => ['InputRequired', 'Submitted', 'Working'].includes(message.task?.state));

    const {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
          options                  = authenticatedFleetOptions({
              dispatch: async request => {
                  const observedAt = new Date().toISOString();

                  calls.push({method: request.method, params: request.params});

                  switch (request.method) {
                      case 'resolveViewerIdentity':
                          return fleetE2ESuccess({ok: true, agentIdentityNodeId: OPERATOR});
                      case 'fleetRoster':
                          return fleetE2ESuccess({rows: []});
                      case 'fleetActivity':
                          return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                      case 'fleetOpenWork':
                          return fleetE2ESuccess({
                              state    : 'ok', observedAt, coverage: 'complete', reason: null, seats: {}, awaitingMerge: [],
                              questions: {state: 'ok', count: open().length, reason: null}
                          });
                      case 'fleetOwnQuestions': {
                          const rows = open().map(message => createFleetMailboxMirrorRow(message, observedAt));

                          return fleetE2ESuccess({
                              state: 'ok', reason: null, count: rows.length, rows, capturedAt: observedAt,
                              page : {limit: 50, offset: 0, count: rows.length, hasMore: false}
                          })
                      }
                      case 'fleetMailboxMirror':
                          return fleetE2ESuccess(createFleetMailboxMirrorSnapshot({
                              capturedAt: observedAt,
                              messages  : messages.filter(message => !message.archivedAt),
                              hasMore   : false,
                              page      : {limit: 50, offset: 0},
                              subject   : OPERATOR,
                              viewer    : OPERATOR
                          }));
                      case 'fleetOwnMessage': {
                          const message = messages.find(candidate => candidate.messageId === request.params.messageId);

                          return fleetE2ESuccess({...message, body: `the body of ${message.messageId}`})
                      }
                      case 'markOwnMessageRead': {
                          const message = messages.find(candidate => candidate.messageId === request.params.messageId);

                          message.readAt = '2026-10-09T04:30:00.000Z';
                          return fleetE2ESuccess({results: [{messageId: message.messageId, readAt: message.readAt, status: 'read'}]})
                      }
                      default:
                          return fleetE2EFailure(`unexpected method: ${request.method}`)
                  }
              }
          }),
          server                   = await startFleetBridgeServer(options);

    return {
        bearerToken: options.bearerToken,
        calls,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    }
}

/**
 * Home's question count opens what waits for the operator's word: the Mailbox with `for you · 2 open`
 * active, an archived question still listed and counted, and a read receipt that moves neither.
 */
test.describe('AgentOS operator mailbox — the open questions (#599)', () => {
    test.setTimeout(150000);

    test('Home\'s count opens the open questions; an archived one stays listed and counted; marking read moves neither', async ({page, neuralLink}) => {
        const fleet = await startOpenQuestionsFleet(), of = method => fleet.calls.filter(call => call.method === method);

        try {
            await page.setViewportSize({width: 1440, height: 1000});
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}#/home`);
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
            await app.callMethod(cockpit.properties.id, 'controller.loadOperatorIdentity');
            await app.callMethod(cockpit.properties.id, 'controller.loadOpenWork');

            // Home: the count is a link into the list it counts
            const link = page.locator('.fm-home-operator-link.is-questions');

            await expect(link).toHaveText('2 questions', {timeout: 30000});
            await link.click();

            const
                mailbox  = page.locator('.fm-operator-mailbox'),
                row      = text => mailbox.locator('.fm-mail-row', {hasText: text}),
                chip     = mailbox.locator('.fm-mailbox-view-chip', {hasText: 'for you'}),
                detail   = mailbox.locator('.fm-mailbox-detail'),
                // the store is the list: the buffered grid pools row elements beyond it
                listed   = async () => {
                    const [pane] = await app.queryComponent({className: 'AgentOS.view.fleet.mailbox.Container'}, ['id']);

                    return pane ? app.callMethod(pane.properties.id, 'store.getCount') : null
                },
                q1       = row('which plane do the seats bind?'),
                q2       = row('keep the old switcher label?');

            await expect(chip).toHaveText('for you · 2 open', {timeout: 30000});
            await expect(chip).toHaveClass(/pressed/);
            await expect.poll(listed, {timeout: 15000}).toBe(2);

            // AC-1: the archived question is still open, so it is listed beside the other and counted, and the
            // read's order holds: the high-priority question reads first although it is the older one
            await expect(q1).toBeVisible();
            await expect(q2.locator('.fm-mail-archived')).toHaveText('archived');
            expect((await q1.boundingBox()).y, 'priority, then age').toBeLessThan((await q2.boundingBox()).y);
            await expect(q1.locator('.fm-mail-archived')).toHaveCount(0);
            expect(of('fleetOwnQuestions').length, 'the open view read its own list').toBeGreaterThan(0);

            // AC-2: a read receipt moves neither the list nor the count
            await q1.click();
            await expect(detail.locator('.fm-mailbox-detail-body')).toHaveText('the body of MESSAGE:q1');
            await detail.getByRole('button', {name: 'Mark read', exact: true}).click();
            await expect(q1).not.toHaveClass(/is-unread/);
            expect(await listed(), 'the question it marked is still open').toBe(2);

            await app.callMethod(cockpit.properties.id, 'controller.loadOpenWork');
            await expect(chip, 'the count read anew after the receipt').toHaveText('for you · 2 open');

            // all mail: the mirror's active inbox, where the archived question does not appear
            await mailbox.locator('.fm-mailbox-view-chip', {hasText: 'all mail'}).click();
            await expect(row('the night shift continues')).toBeVisible({timeout: 15000});
            await expect(q2).toHaveCount(0);
            expect(await listed()).toBe(2)
        } finally {
            await fleet.close()
        }
    });
});
