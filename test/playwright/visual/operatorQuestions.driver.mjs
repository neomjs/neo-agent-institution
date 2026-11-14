/**
 * @summary The tests' open-questions driver: loaded into the App worker through `Neo.worker.App.loadModule`, it gives the
 * mounted operator Mailbox an identity, the provider its open-question count and the Mailbox its open-questions read,
 * the way their owners write them, then shows the open view. Three questions on the visual suite's pinned 2026-07-05 day
 * in the read's own order (priority, then age); the oldest is still open although its recipient archived it. The
 * pane's clock is pinned 30 s after the capture, so the freshness chip reads the same on every run. Every distinct URL
 * executes once (module cache), so a spec varies the `t` parameter per call.
 *
 * `state=expired` shows the expired view instead: three asks that expired unanswered within the week before that day,
 * in the producer's order (newest expiry first), the provider's block counting two open questions and three expired
 * asks, and the first ask open in the detail with the Task its body read returned, so the detail says what its sender
 * planned. The detail opens without a `messageOpen`, so no body read of the fixture plane replaces it.
 *
 * `?state=three|expired&t=<n>`
 */
const
    state      = new URL(import.meta.url).searchParams.get('state'),
    capturedAt = '2026-07-05T07:30:00.000Z',
    mailbox    = Neo.manager.Component.find('ntype', 'fm-operator-mailbox').find(component => component.mounted);

if (!mailbox) {
    throw new Error('operatorQuestions driver: no fm-operator-mailbox is mounted')
}

const question = (messageId, from, subject, priority, taskState, sentAt, fields = {}) => ({
    messageId, subject, from, priority, taskState, sentAt,
    recipientClass: 'agent', status: 'unread', partOfThread: null, relatedTickets: [], wakeSuppressed: false,
    readAt: null, archivedAt: null, ...fields
});

const reads = {
    three: [
        question('MESSAGE:q1', '@neo-gpt-emmy',   '[question] which plane do the seats bind?',  'high',   'InputRequired', '2026-07-05T07:10:00.000Z'),
        question('MESSAGE:q3', '@neo-fable-clio', '[question] does row 3 walk before the cut?', 'normal', 'Working',       '2026-07-05T05:20:00.000Z', {
            archivedAt: '2026-07-05T06:00:00.000Z', readAt: '2026-07-05T05:30:00.000Z', relatedTickets: [485], status: 'read'
        }),
        question('MESSAGE:q2', '@neo-opus-grace', '[question] keep the old switcher label?',    'normal', 'Submitted',     '2026-07-05T06:40:00.000Z', {
            readAt: '2026-07-05T06:50:00.000Z', status: 'read'
        })
    ],
    expired: [
        question('MESSAGE:e1', '@neo-gpt-emmy',   '[question] merge the Scheduler before the cut?',  'high',   'Expired', '2026-06-28T09:00:00.000Z', {
            readAt: '2026-06-28T09:20:00.000Z', status: 'read'
        }),
        question('MESSAGE:e2', '@neo-fable-clio', '[question] does the film need your voice?',        'normal', 'Expired', '2026-06-28T08:10:00.000Z'),
        question('MESSAGE:e3', '@neo-opus-grace', '[question] keep both licence drafts as drafts?',  'normal', 'Expired', '2026-06-28T07:40:00.000Z', {
            readAt: '2026-06-28T07:45:00.000Z', relatedTickets: [118], status: 'read'
        })
    ]
};

const rows = reads[state];

if (!rows) {
    throw new Error(`operatorQuestions driver: unknown state '${state}'`)
}

const
    pane = mailbox.getReference('operator-inbox-pane'),
    read = {state: 'ok', reason: null, count: rows.length, rows, page: {limit: 50, offset: 0, count: rows.length, hasMore: false}, capturedAt},
    record = {agentIdentityNodeId: '@visual-operator', githubUsername: 'visual-operator'};

pane.now = Date.parse(capturedAt) + 30_000;

if (state === 'expired') {
    const since = '2026-06-28T07:30:00.000Z';

    mailbox.getStateProvider().setData({questions: {count: 2, reason: null, state: 'ok', expired: {count: rows.length, reason: null, since, state: 'ok'}}});
    mailbox.set({expired: {...read, since}, record, view: 'expired'});

    // the first ask opens the way a selection opens it, with the body read its owner would write
    pane.selectedMessageId = 'MESSAGE:e1';
    pane.applySnapshot();
    mailbox.messageRead = {
        messageId: 'MESSAGE:e1',
        state    : 'ok',
        message  : {
            ...rows[0],
            body: 'The Scheduler PR is approved and green. Merge it before Monday\'s cut, or say no and I hold it for the next one.',
            task: {state: 'Expired', fallback: 'hold the PR for the next cut and say so on it'}
        }
    }
} else {
    mailbox.getStateProvider().setData({questions: {count: rows.length, reason: null, state: 'ok'}});
    mailbox.set({questions: read, record, view: 'open'})
}
