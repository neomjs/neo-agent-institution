/**
 * @summary The tests' open-questions driver: loaded into the App worker through `Neo.worker.App.loadModule`, it gives the
 * mounted operator Mailbox an identity, the provider its open-question count and the Mailbox its open-questions read,
 * the way their owners write them, then shows the open view. Three questions on the visual suite's pinned 2026-07-05 day
 * in the read's own order (priority, then age); the oldest is still open although its recipient archived it. The
 * pane's clock is pinned 30 s after the capture, so the freshness chip reads the same on every run. Every distinct URL
 * executes once (module cache), so a spec varies the `t` parameter per call.
 *
 * `?state=three&t=<n>`
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
    ]
};

const rows = reads[state];

if (!rows) {
    throw new Error(`operatorQuestions driver: unknown state '${state}'`)
}

mailbox.getReference('operator-inbox-pane').now = Date.parse(capturedAt) + 30_000;
mailbox.getStateProvider().setData({questions: {count: rows.length, reason: null, state: 'ok'}});
mailbox.set({
    questions: {state: 'ok', reason: null, count: rows.length, rows, page: {limit: 50, offset: 0, count: rows.length, hasMore: false}, capturedAt},
    record   : {agentIdentityNodeId: '@visual-operator', githubUsername: 'visual-operator'},
    view     : 'open'
});
