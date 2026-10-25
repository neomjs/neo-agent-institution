import {test, expect, loadAgentOsModule} from '../../fixtures.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const {createFleetMailboxMirrorSnapshot} = await loadAgentOsModule('ai/services/fleet/fleetMailboxMirrorAdapter.mjs');

const OPERATOR = '@e2e-operator';
const BODY     = 'Seats bind the plane the switcher shows. Which one should Add Agent use?';

/**
 * A fixture plane whose operator inbox holds one open question. It records every wire call and
 * answers the own-inbox verbs the way the Brain does: the body read, a read receipt that
 * the next mirror read reflects, a sent reply, and a Task move refused once with a typed code before
 * it lands.
 */
async function startQuestionFleet() {
    const
        calls    = [],
        question = {
            messageId     : 'MESSAGE:q1',
            subject       : '[question] which plane do the seats bind?',
            from          : '@review-peer-a',
            to            : OPERATOR,
            recipientClass: 'agent',
            priority      : 'high',
            status        : 'unread',
            task          : {state: 'InputRequired', assignee: OPERATOR},
            partOfThread  : null,
            relatedTickets: [],
            wakeSuppressed: false,
            sentAt        : '2026-10-07T11:00:00.000Z',
            readAt        : null
        };

    let moves = 0;

    const {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
          options                  = authenticatedFleetOptions({
              dispatch: async request => {
                  calls.push({method: request.method, params: request.params});

                  switch (request.method) {
                      case 'resolveViewerIdentity':
                          return fleetE2ESuccess({ok: true, agentIdentityNodeId: OPERATOR});
                      case 'fleetRoster':
                          return fleetE2ESuccess({rows: []});
                      case 'fleetActivity':
                          return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                      case 'fleetMailboxMirror':
                          return fleetE2ESuccess(createFleetMailboxMirrorSnapshot({
                              messages: [{...question}],
                              hasMore : false,
                              page    : {limit: 50, offset: 0},
                              subject : OPERATOR,
                              viewer  : OPERATOR
                          }));
                      case 'fleetOwnMessage':
                          return fleetE2ESuccess({...question, body: BODY});
                      case 'markOwnMessageRead':
                          question.status = 'read';
                          question.readAt = '2026-10-07T12:00:00.000Z';
                          return fleetE2ESuccess({results: [{messageId: question.messageId, readAt: question.readAt, status: 'read'}]});
                      case 'composeOperatorMessage':
                          return fleetE2ESuccess({messageId: 'MESSAGE:reply-1', status: 'sent'});
                      case 'transitionOwnTask':
                          if (++moves === 1) {
                              return fleetE2ESuccess({success: false, rowsAffected: 0, code: 'TASK_TRANSITION_FORBIDDEN', reason: 'refused once on purpose'})
                          }

                          question.task = {...question.task, state: 'Completed'};
                          return fleetE2ESuccess({success: true, rowsAffected: 1, task: question.task});
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
 * The operator's own inbox: open a message's full content, mark it read, reply to the selected
 * message, and resolve a question explicitly. A reply never
 * resolves, and a refused move shows its reason and the Brain's code.
 */
test.describe('AgentOS operator mailbox — open, mark read, reply, resolve (#551)', () => {
    test.setTimeout(150000);

    test('the operator opens a question to its full body, marks it read, replies in place and resolves it through one refusal', async ({page, neuralLink}) => {
        const fleet = await startQuestionFleet(), of = method => fleet.calls.filter(call => call.method === method);

        try {
            await page.setViewportSize({width: 1440, height: 1000});
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}`);
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
            await app.callMethod(cockpit.properties.id, 'controller.loadOperatorIdentity');

            await page.getByRole('tab', {name: 'Mailbox', exact: true}).click();

            const
                mailbox = page.locator('.fm-operator-mailbox'),
                row     = mailbox.locator('.fm-mail-row').first(),
                detail  = mailbox.locator('.fm-mailbox-detail'),
                button  = name => detail.getByRole('button', {name, exact: true});

            await expect(row).toBeVisible({timeout: 30000});
            await expect(row).toHaveClass(/is-unread/);
            await expect(row).toContainText('task · InputRequired');
            await expect(detail).toBeHidden();

            // open: the full body beside the list (a narrow pane stacks it under), and opening writes nothing
            await row.click();
            await expect(detail.locator('.fm-mailbox-detail-body')).toHaveText(BODY);

            const
                grid     = mailbox.locator('.fm-mailbox-grid'),
                splitter = mailbox.locator('.fm-mailbox-splitter'),
                [pane]   = await app.queryComponent({className: 'AgentOS.view.fleet.mailbox.Container'}, ['id']);

            expect((await mailbox.locator('.fm-mailbox-pane').boundingBox()).width, 'the fixture viewport gives a wide pane').toBeGreaterThan(720);
            await expect(splitter).toBeVisible();
            expect((await detail.boundingBox()).x, 'a wide pane puts the detail beside the list')
                .toBeGreaterThanOrEqual((await grid.boundingBox()).x + (await grid.boundingBox()).width);

            // a narrow pane (a pop-out, a vessel) stacks the two instead, never a squeezed pair
            await app.setProperties(pane.properties.id, {width: 600});
            await expect(splitter).toBeHidden();
            await expect.poll(async () => {
                const gridBox = await grid.boundingBox(), detailBox = await detail.boundingBox();

                return detailBox.y >= gridBox.y + gridBox.height - 1
            }, {message: 'a narrow pane stacks the detail under the list'}).toBe(true);
            await app.setProperties(pane.properties.id, {width: null});
            await expect(splitter).toBeVisible();
            expect(of('fleetOwnMessage').map(call => call.params)).toEqual([{messageId: 'MESSAGE:q1'}]);
            expect(of('markOwnMessageRead')).toHaveLength(0);

            // mark read: the receipt, then the re-read row says read; the question stays open
            await button('Mark read').click();
            await expect(row).not.toHaveClass(/is-unread/);
            await expect(button('Mark read')).toBeHidden();
            expect(of('markOwnMessageRead').map(call => call.params)).toEqual([{messageId: 'MESSAGE:q1'}]);
            await expect(button('Resolve: mark Completed')).toBeVisible();

            // reply: the compose reveal opens for the sender with Re: and inReplyTo, and leaves the Task open
            const [operatorBox] = await app.queryComponent({className: 'AgentOS.view.fleet.mailbox.OperatorContainer'}, ['id']);
            await app.setProperties(operatorBox.properties.id, {recipientOptions: [
                {id: 'AGENT:*', name: 'All agents (broadcast)'},
                {id: '@review-peer-a', name: 'Peer A'}
            ]});

            await button('Reply').click();

            const form = mailbox.locator('.fm-operator-compose-form');

            await expect(form).toBeVisible();
            // replying, the selected row is the inbox's one row of context and the detail folds
            await expect(row).toBeVisible();
            await expect(detail).toBeHidden();
            await expect(form.locator('.fm-operator-compose-reply')).toHaveText('Reply to: [question] which plane do the seats bind?');
            await expect(form.locator('.fm-compose-recipient-chip')).toHaveCount(1);
            await form.locator('textarea').fill('The switcher\'s plane. Add Agent follows it.');
            await form.getByRole('button', {name: 'Send'}).click();
            await expect(form.locator('.fm-compose-outcome-row.is-sent')).toHaveText('@review-peer-a — sent');

            expect(of('composeOperatorMessage').map(call => call.params)).toEqual([{
                to            : '@review-peer-a',
                subject       : 'Re: [question] which plane do the seats bind?',
                body          : 'The switcher\'s plane. Add Agent follows it.',
                priority      : 'high',
                wakeSuppressed: true,
                inReplyTo     : 'MESSAGE:q1'
            }]);
            expect(of('transitionOwnTask'), 'a reply never resolves').toHaveLength(0);

            // folding the form brings the open message back
            await mailbox.locator('.fm-compose-affordance').click();
            await expect(form).toBeHidden();
            await expect(detail).toBeVisible();

            // resolve: the first move is refused with its reason and code; the second lands, and the
            // re-read message names the Task's new state
            await button('Resolve: mark Completed').click();
            await expect(detail.locator('.fm-mailbox-detail-outcome')).toHaveText('Resolve was refused: refused once on purpose · TASK_TRANSITION_FORBIDDEN');

            await button('Resolve: mark Completed').click();
            await expect(button('Resolve: mark Completed')).toBeHidden();
            await expect(detail.locator('.fm-mailbox-detail-meta')).toContainText('task · Completed');
            await expect(row).toContainText('task · Completed');

            expect(of('transitionOwnTask').map(call => call.params)).toEqual([
                {expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1', newState: 'Completed'},
                {expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1', newState: 'Completed'}
            ])
        } finally {
            await fleet.close()
        }
    });

    test('the operator inbox renders a requestPublish card, jumps to the peer Publishing switch view, and ignores Neural Link set_instance_properties mutations on switch state (#673)', async ({page, neuralLink}) => {
        const
            calls       = [],
            publishTask = {
                messageId     : 'MESSAGE:pub-e2e-1',
                subject       : '[publish] X post on v13.3.1',
                from          : '@neo-opus-ada',
                to            : OPERATOR,
                recipientClass: 'agent',
                priority      : 'normal',
                status        : 'unread',
                task          : {state: 'InputRequired', assignee: OPERATOR},
                partOfThread  : null,
                relatedTickets: ['neomjs/neo#19575'],
                taggedConcepts: ['requestPublish'],
                wakeSuppressed: false,
                sentAt        : '2026-10-25T05:00:00.000Z',
                readAt        : null
            },
            requestPublish = {
                channel   : 'x',
                account   : '@neomjs',
                format    : 'single',
                text      : 'Neo v13.3.1 ships zero-bypass social publishing through the operator gate.',
                media     : [],
                inReplyTo : null,
                hypothesis: 'Concrete architecture receipts outperform generic release announcements.'
            };

        let xSwitchState = 'approve each',
            xAudit       = [{
                who   : OPERATOR,
                when  : '2026-10-25T04:00:00.000Z',
                from  : 'approve each',
                to    : 'approve each',
                reason: 'initial default'
            }];

        const {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
              options                  = authenticatedFleetOptions({
                  dispatch: async request => {
                      calls.push({method: request.method, params: request.params});

                      switch (request.method) {
                          case 'resolveViewerIdentity':
                              return fleetE2ESuccess({ok: true, agentIdentityNodeId: OPERATOR});
                          case 'fleetRoster':
                              return fleetE2ESuccess({rows: [{
                                  id                 : 'neo-opus-ada',
                                  agentId            : 'neo-opus-ada',
                                  githubUsername     : 'neo-opus-ada',
                                  displayName        : 'Ada',
                                  engineTag          : 'opus-5',
                                  family             : 'claude',
                                  state              : 'ok',
                                  avatarUrl          : 'https://github.com/neo-opus-ada.png?size=80',
                                  participationStatus: 'active',
                                  sources            : {roster: {source: 'fleet:listAgents', state: 'wired', confidence: 'high'}}
                              }]});
                          case 'fleetActivity':
                              return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                          case 'fleetMailboxMirror':
                              return fleetE2ESuccess(createFleetMailboxMirrorSnapshot({
                                  messages: [{...publishTask}],
                                  hasMore : false,
                                  page    : {limit: 50, offset: 0},
                                  subject : OPERATOR,
                                  viewer  : OPERATOR
                              }));
                          case 'fleetOwnMessage':
                              return fleetE2ESuccess({
                                  ...publishTask,
                                  body       : requestPublish.text,
                                  requestPublish,
                                  revision   : {
                                      revisionNumber: 1,
                                      attestation   : {
                                          reviewer      : '@neo-gpt',
                                          reviewerFamily: 'gpt',
                                          revisionNumber: 1
                                      }
                                  },
                                  publication: {state: 'queued'},
                                  switchState: xSwitchState
                              });
                          case 'readPublishSwitches':
                              return fleetE2ESuccess({
                                  peer    : '@neo-opus-ada',
                                  channels: {
                                      x: {
                                          state   : xSwitchState,
                                          audit   : xAudit,
                                          proposal: {
                                              toState: 'approve the batch',
                                              basis  : {batches: 6, edits: 0, since: '2026-10-01'}
                                          }
                                      },
                                      linkedin: {
                                          state   : 'approve each',
                                          audit   : [],
                                          proposal: null
                                      }
                                  }
                              });
                          case 'setPublishSwitch':
                              xSwitchState = request.params.to;
                              xAudit = [...xAudit, {
                                  who   : OPERATOR,
                                  when  : '2026-10-25T05:10:00.000Z',
                                  from  : request.params.expectedFrom,
                                  to    : request.params.to,
                                  reason: request.params.reason
                              }];
                              return fleetE2ESuccess({
                                  state : 'ok',
                                  switch: {
                                      peer   : request.params.peer,
                                      channel: request.params.channel,
                                      state  : xSwitchState,
                                      audit  : xAudit
                                  }
                              });
                          default:
                              return fleetE2ESuccess({ok: true})
                      }
                  }
              }),
              server = await startFleetBridgeServer(options),
              fleet  = {
                  bearerToken: options.bearerToken,
                  calls,
                  endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
                  close      : () => new Promise(resolve => server.close(resolve))
              },
              of = method => fleet.calls.filter(call => call.method === method);

        try {
            await page.setViewportSize({width: 1440, height: 1000});
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}`);
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
            await app.callMethod(cockpit.properties.id, 'controller.loadOperatorIdentity');

            await page.getByRole('tab', {name: 'Mailbox', exact: true}).click();

            const
                mailbox = page.locator('.fm-operator-mailbox'),
                row     = mailbox.locator('.fm-mail-row').first(),
                detail  = mailbox.locator('.fm-mailbox-detail');

            await expect(row).toBeVisible({timeout: 30000});
            await row.click();

            // AC-1 & AC-3: PublishRequestComponent renders in DetailContainer and generic Resolve is hidden
            const publishCard = detail.locator('.fm-publish-card');
            await expect(publishCard).toBeVisible();
            await expect(detail.getByRole('button', {name: 'Resolve: mark Completed', exact: true})).toBeHidden();
            await expect(publishCard.locator('.fm-publish-post-text')).toHaveText(requestPublish.text);
            await expect(publishCard.locator('.fm-publish-hypothesis')).toContainText(requestPublish.hypothesis);
            await expect(publishCard.locator('.fm-publish-attestation-chip')).toContainText('@neo-gpt · gpt · attests rev 1');

            // Clicking the effective switch chip opens AgentDetail › Configuration › Publishing
            await publishCard.locator('.fm-publish-switch-chip').click();

            const switchPanel = page.locator('.fm-publish-switches');
            await expect(switchPanel).toBeVisible({timeout: 15000});
            await expect(switchPanel.locator('.fm-publish-switch-row.is-channel-x')).toContainText('approve each');

            // AC-4 (whitebox): Neural Link set_instance_properties on PublishSwitchComponent writes nothing to Fleet and re-reads Fleet state
            const [switchView] = await app.queryComponent(
                {className: 'AgentOS.view.fleet.detail.PublishSwitchComponent'},
                ['id', 'xState', 'linkedinState']
            );
            expect(switchView.properties.xState).toBe('approve each');

            const readsBeforeSet = of('readPublishSwitches').length;
            await app.setProperties(switchView.properties.id, {
                xState  : 'auto-approve',
                switches: {x: {state: 'auto-approve'}, linkedin: {state: 'auto-approve'}}
            });

            await expect.poll(() => of('readPublishSwitches').length, {
                message: 'set_instance_properties triggers a Fleet re-read'
            }).toBeGreaterThan(readsBeforeSet);

            expect(of('setPublishSwitch'), 'set_instance_properties never invokes setPublishSwitch').toHaveLength(0);

            const [afterSetView] = await app.queryComponent(
                {id: switchView.properties.id},
                ['xState', 'linkedinState']
            );
            expect(afterSetView.properties.xState).toBe('approve each');
            expect(afterSetView.properties.linkedinState).toBe('approve each');
            await expect(switchPanel.locator('.fm-publish-switch-row.is-channel-x .fm-publish-switch-current')).toHaveText('approve each');
        } finally {
            await fleet.close()
        }
    });
});
