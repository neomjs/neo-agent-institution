/**
 * @summary The tests' publish-gate driver (#673): loaded into the App worker through `Neo.worker.App.loadModule`, it drives
 * the operator Mailbox's `PublishRequestComponent` (`?state=queued|publishing|published&t=<n>`) and AgentDetail's
 * `PublishSwitchComponent` (`?state=switches&t=<n>`) with pinned 2026-07-05 instants so `ViewerTime` renders identical
 * strings on every capture day.
 */
const
    params     = new URL(import.meta.url).searchParams,
    state      = params.get('state'),
    capturedAt = '2026-07-05T07:30:00.000Z',
    now        = Date.parse(capturedAt) + 30_000,
    digest     = '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069';

if (state === 'switches') {
    const switchComp = Neo.manager.Component.find('ntype', 'fm-publish-switch-container').find(component => component.mounted);

    if (!switchComp) {
        throw new Error('publishGate driver: no fm-publish-switch-container is mounted')
    }

    switchComp.applyFleetSwitches({
        peer    : switchComp.peerId || '@neo-opus-ada',
        channels: {
            x: {
                state: 'approve the batch',
                audit: [{
                    who   : '@tobiu',
                    when  : '2026-07-05T06:45:00.000Z',
                    from  : 'approve each',
                    to    : 'approve the batch',
                    reason: 'initial release batch verified'
                }],
                proposal: {
                    toState: 'auto-approve after a cross-family review attestation',
                    basis  : {batches: 5, edits: 0, since: '2026-06-20'}
                }
            },
            linkedin: {
                state   : 'approve each',
                audit   : [],
                proposal: null
            }
        }
    });
} else {
    const mailbox = Neo.manager.Component.find('ntype', 'fm-operator-mailbox').find(component => component.mounted);

    if (!mailbox) {
        throw new Error('publishGate driver: no fm-operator-mailbox is mounted')
    }

    const
        inbox       = mailbox.getReference('operator-inbox-pane'),
        detail      = inbox.getReference('mailbox-detail'),
        publishCard = detail.getReference('publish-card'),
        payload     = {
            schemaVersion: 1,
            channel      : 'x',
            account      : '@neomjs',
            format       : 'post',
            text         : 'Neo.mjs v13.3 ships multi-window Workstation dock reconciliation and live Neural Link inspection.',
            hypothesis   : 'Concrete multi-window + Neural Link receipts resonate with systems engineers.',
            inReplyTo    : '1900000000000000001',
            media        : []
        },
        attestation = {
            reviewer      : '@neo-gpt-sophie',
            family        : 'gpt',
            revisionNumber: 1,
            revisionDigest: digest
        },
        approved = {
            approvedBy    : '@tobiu',
            revisionNumber: 1,
            revisionDigest: digest
        },
        publications = {
            queued: {
                taskState  : 'InputRequired',
                approval   : null,
                publication: {
                    state                : 'queued',
                    currentRevisionNumber: 1,
                    currentRevisionDigest: digest
                }
            },
            publishing: {
                taskState  : 'Working',
                approval   : approved,
                publication: {
                    state                : 'publishing',
                    reservedAt           : '2026-07-05T07:25:00.000Z',
                    currentRevisionNumber: 1,
                    currentRevisionDigest: digest
                }
            },
            published: {
                taskState  : 'Completed',
                approval   : approved,
                publication: {
                    state                : 'published',
                    providerId           : '1900000000000000777',
                    readbackAt           : '2026-07-05T07:28:00.000Z',
                    currentRevisionNumber: 1,
                    currentRevisionDigest: digest
                }
            }
        },
        spec = publications[state];

    if (!spec) {
        throw new Error(`publishGate driver: unknown state '${state}'`)
    }

    const row = {
        messageId      : 'MESSAGE:pub-1',
        subject        : '[requestPublish · x · @neomjs] Neo.mjs v13.3 ships multi-window Workstation dock',
        from           : '@neo-opus-ada',
        priority       : 'high',
        taskState      : spec.taskState,
        sentAt         : '2026-07-05T07:20:00.000Z',
        recipientClass : 'agent',
        status         : 'unread',
        partOfThread   : null,
        relatedTickets : [673],
        wakeSuppressed : false,
        readAt         : null,
        archivedAt     : null,
        requestPublish : payload,
        switchState    : 'auto-approve after a cross-family review attestation',
        replyTargetText: 'What is new in v13.3?',
        revision       : {
            revisionNumber: 1,
            revisionDigest: digest,
            createdAt     : '2026-07-05T07:20:00.000Z',
            payload,
            attestation,
            approval      : spec.approval
        },
        publication: spec.publication,
        task       : {
            type          : 'requestPublish',
            state         : spec.taskState,
            assignee      : '@visual-operator',
            requestPublish: payload,
            revision      : {
                revisionNumber: 1,
                revisionDigest: digest,
                payload,
                attestation,
                approval: spec.approval
            },
            publication: spec.publication
        }
    };

    inbox.now = now;
    publishCard && (publishCard.now = now);
    mailbox.getStateProvider().setData({questions: {count: 1, reason: null, state: 'ok'}});
    mailbox.set({
        questions  : {state: 'ok', reason: null, count: 1, rows: [row], page: {limit: 50, offset: 0, count: 1, hasMore: false}, capturedAt},
        record     : {agentIdentityNodeId: '@visual-operator', githubUsername: 'visual-operator'},
        view       : 'open',
        messageRead: {messageId: 'MESSAGE:pub-1', state: 'ok', message: row}
    });
    inbox.selectedMessageId = 'MESSAGE:pub-1';
    inbox.applyDetail();
    publishCard && (publishCard.now = now);
}
