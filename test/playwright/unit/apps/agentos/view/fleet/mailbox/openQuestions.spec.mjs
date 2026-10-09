import {setup} from '../../../../../../setup.mjs';

const appName = 'OperatorOpenQuestionsTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

const
    CAPTURED_AT = '2026-10-09T04:00:00.000Z',
    NOW         = Date.parse('2026-10-09T04:00:30.000Z'),
    OPERATOR    = {agentIdentityNodeId: '@tobiu', githubUsername: 'tobiu'};

const question = (overrides = {}) => ({
    messageId     : 'MESSAGE:q1',
    subject       : '[question] which plane do the seats bind?',
    from          : '@neo-gpt',
    recipientClass: 'agent',
    priority      : 'high',
    status        : 'unread',
    taskState     : 'InputRequired',
    partOfThread  : null,
    relatedTickets: [],
    wakeSuppressed: false,
    sentAt        : '2026-10-08T22:00:00.000Z',
    readAt        : null,
    archivedAt    : null,
    ...overrides
});

const answered = (rows, page = {}) => ({
    state     : 'ok',
    reason    : null,
    count     : rows.length,
    rows,
    page      : {limit: 50, offset: 0, count: rows.length, hasMore: false, ...page},
    capturedAt: CAPTURED_AT
});

const unreadable = reason => ({state: 'unavailable', reason, count: null, rows: [], page: {limit: 50, offset: 0, count: 0, hasMore: false}, capturedAt: CAPTURED_AT});

/**
 * @summary The operator's open questions in the Mailbox: the head's `all mail` · `for you · 3 open`
 * chips switch the list, the count is the read's own (never a number it did not produce), the open view
 * states its own read honestly, and an archived question that is still open stays listed.
 */
test.describe('AgentOS operator mailbox — what waits for your word (#599)', () => {
    let OperatorMailbox, box;

    const
        createBox = cfg => Neo.create(OperatorMailbox, {appName, ...cfg}),
        pane      = () => box.getReference('operator-inbox-pane'),
        chip      = name => box.getReference(`view-${name}`),
        stateLine = () => pane().getReference('mailbox-state');

    test.beforeAll(async () => {
        OperatorMailbox = (await import('../../../../../../../../apps/agentos/view/fleet/mailbox/OperatorContainer.mjs')).default
    });

    test.afterEach(() => {
        box?.destroy();
        box = null
    });

    test('the head carries the two view chips before compose; all mail is the list in view', () => {
        box = createBox();

        const actions = pane().getReference('mailbox-head').items.at(-1);

        expect(actions.items.map(item => item.text)).toEqual(['all mail', 'for you · open', '✎ compose']);
        expect(chip('all').pressed).toBe(true);
        expect(chip('open').pressed).toBe(false);
        expect(pane().view).toBe('all')
    });

    test('the chip counts only what the read produced: `for you · 3 open`, a complete zero as 0, otherwise plain with the reason on its title', () => {
        box = createBox({questionCount: {count: 3, reason: null, state: 'ok'}});

        expect(chip('open').text).toBe('for you · 3 open');
        expect(chip('open').vdom.title).toBe(null);

        box.questionCount = {count: 0, reason: null, state: 'ok'};
        expect(chip('open').text, 'a complete zero may read 0').toBe('for you · 0 open');

        box.questionCount = {count: null, reason: 'Memory Core refused the read', state: 'unavailable'};
        expect(chip('open').text, 'no number the read did not produce').toBe('for you · open');
        expect(chip('open').vdom.title).toBe('Memory Core refused the read');

        box.questionCount = {count: null, reason: 'questions are not listed yet', state: 'unsupported'};
        expect(chip('open').text).toBe('for you · open');
        expect(chip('open').vdom.title).toBe('questions are not listed yet');

        box.questionCount = {count: null, reason: null, state: null};
        expect(chip('open').text, 'an answer nobody gave says nothing either').toBe('for you · open');
        expect(chip('open').vdom.title).toBe(null)
    });

    test('a switch shows the other list and asks the owner for its first window; without an identity it asks nothing', () => {
        const asked = [];

        box = createBox();
        box.on('inboxPageRequest', data => asked.push(data.offset));

        box.onOpenQuestionsClick();
        expect(asked, 'no identity bound: there is no one to read for').toEqual([]);
        expect(pane().view).toBe('open');

        box.view = 'all';
        box.record = OPERATOR;
        asked.length = 0;

        box.onOpenQuestionsClick();
        expect(pane().view).toBe('open');
        expect(chip('open').pressed).toBe(true);
        expect(chip('all').pressed).toBe(false);
        expect(asked).toEqual([0]);

        box.onAllMailClick();
        expect(pane().view).toBe('all');
        expect(asked, 'back to all mail reads its first window anew').toEqual([0, 0])
    });

    test('a navigation shows the open questions: a switch the first time, a fresh read when they already show', () => {
        const asked = [];

        box = createBox({record: OPERATOR});
        box.on('inboxPageRequest', data => asked.push(data.offset));
        asked.length = 0;

        box.showOpenQuestions();
        expect(pane().view).toBe('open');
        expect(asked).toEqual([0]);

        box.showOpenQuestions();
        expect(asked, 'already open: the list reads anew').toEqual([0, 0])
    });

    test('the open view states its own read: not read yet, could not be read with its reason, nothing waits, or the questions', () => {
        box = createBox({record: OPERATOR, view: 'open'});
        pane().now = NOW;

        expect(pane().getPaneState()).toBe('unobserved');
        expect(stateLine().text).toBe('your open questions have not been read');

        box.questions = unreadable('fleet: the open-questions read failed');
        expect(pane().getPaneState()).toBe('degraded');
        expect(stateLine().text, 'the reason, never an empty list').toBe('your questions could not be read · fleet: the open-questions read failed');
        expect(pane().store.getCount()).toBe(0);

        box.questions = answered([]);
        expect(pane().getPaneState()).toBe('empty');
        expect(stateLine().text).toBe('nothing waits for your word');

        box.questions = answered([question(), question({messageId: 'MESSAGE:q2', archivedAt: '2026-10-08T23:00:00.000Z', status: 'read'})]);
        expect(pane().getPaneState()).toBe('rows');
        expect(stateLine().hidden).toBe(true);
        expect(pane().store.getCount()).toBe(2);
        expect(pane().store.get('MESSAGE:q2').archivedAt, 'an archived question that is still open stays listed').toBe('2026-10-08T23:00:00.000Z');

        box.questions = {rows: [question()]};
        expect(pane().getPaneState(), 'a payload that is not the read renders nothing from it').toBe('unobserved')
    });

    test('the open view keeps its read\'s order (priority, then age) and lists every question on its own row; all mail reads newest first again', () => {
        const order = () => pane().store.items.map(record => record.messageId);

        box = createBox({record: OPERATOR, view: 'open'});
        // the read's order: the high-priority question first, then the oldest; the other two share a thread
        box.questions = answered([
            question({messageId: 'MESSAGE:high', priority: 'high',   sentAt: '2026-10-08T08:00:00.000Z'}),
            question({messageId: 'MESSAGE:old',  priority: 'normal', sentAt: '2026-10-08T09:00:00.000Z', partOfThread: 'THREAD:x'}),
            question({messageId: 'MESSAGE:new',  priority: 'normal', sentAt: '2026-10-08T23:00:00.000Z', partOfThread: 'THREAD:x'})
        ]);

        expect(order(), 'never re-sorted newest first, and no thread hides a question').toEqual(['MESSAGE:high', 'MESSAGE:old', 'MESSAGE:new']);

        box.snapshot = {
            capability: {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', capturedAt: CAPTURED_AT, reason: null},
            admission : {state: 'granted', viewerIdentity: '@tobiu', subjectAgentId: '@tobiu', checkedAt: CAPTURED_AT, reason: null},
            rows      : [question({messageId: 'MESSAGE:a', sentAt: '2026-10-08T08:00:00.000Z'}), question({messageId: 'MESSAGE:b', sentAt: '2026-10-08T12:00:00.000Z'})],
            page      : {limit: 50, offset: 0, count: 2, hasMore: false}
        };
        box.view = 'all';

        expect(order(), 'all mail: newest first').toEqual(['MESSAGE:b', 'MESSAGE:a'])
    });

    test('the freshness chip ages the list in view by its own read', () => {
        box = createBox({record: OPERATOR, view: 'open'});
        pane().now = NOW;

        box.questions = answered([question()]);
        const fresh = pane().getReference('mailbox-freshness').text;

        pane().now = Date.parse('2026-10-09T05:00:00.000Z');
        expect(pane().getReference('mailbox-freshness').text, 'an hour-old read is no longer fresh').not.toBe(fresh)
    });

    test('a window extends only its own list: after a switch, the held all-mail window replaces the questions until its first window lands', () => {
        const allMail = rows => ({
            capability: {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', capturedAt: CAPTURED_AT, reason: null},
            admission : {state: 'granted', viewerIdentity: '@tobiu', subjectAgentId: '@tobiu', checkedAt: CAPTURED_AT, reason: null},
            rows,
            page      : {limit: 50, offset: 50, count: rows.length, hasMore: false}
        });

        box = createBox({record: OPERATOR, snapshot: allMail([question({messageId: 'MESSAGE:m51', taskState: null})]), view: 'open'});
        box.questions = answered([question()]);
        expect(pane().store.getCount()).toBe(1);

        box.view = 'all';
        expect(pane().store.getCount(), 'never the questions plus a follow-up window of all mail').toBe(1);
        expect(pane().store.get('MESSAGE:m51')).toBeTruthy();
        expect(pane().store.get('MESSAGE:q1')).toBeFalsy()
    });

    test('the scroll edge asks for the next window of the list in view', () => {
        const asked = [];

        box = createBox({record: OPERATOR, view: 'open'});
        box.on('inboxPageRequest', data => asked.push(data.offset));
        asked.length = 0;

        box.questions = answered([question()], {limit: 1, hasMore: true});
        pane().onScrollEdge({});
        pane().onScrollEdge({});

        expect(asked, 'one request in flight').toEqual([1]);

        box.questions = answered([question({messageId: 'MESSAGE:q2'})], {limit: 1, offset: 1, hasMore: false});
        expect(pane().store.getCount(), 'the next window extends the questions').toBe(2)
    });

    test('a window can show none of the questions its count holds: what is held stays, the pane asks past it itself, and only a complete zero says nothing waits', () => {
        const
            asked = [],
            read  = (rows, count, page) => ({...answered(rows, page), count});

        box = createBox({record: OPERATOR, view: 'open'});
        box.on('inboxPageRequest', data => asked.push(data.offset));
        asked.length = 0;

        // a middle window the graph could not project: the held question and its detail stay, and since the rows
        // in view did not change, the pane asks for the next window itself
        box.questions = read([question()], 3, {limit: 1, hasMore: true});
        pane().onRowSelect({record: pane().store.get('MESSAGE:q1')});
        box.questions = read([], 3, {limit: 1, offset: 1, hasMore: true});
        expect([pane().store.getCount(), pane().selectedMessageId, stateLine().hidden]).toEqual([1, 'MESSAGE:q1', true]);
        expect(asked).toEqual([2]);

        box.questions = read([question({messageId: 'MESSAGE:q3'})], 3, {limit: 1, offset: 2, hasMore: false});
        expect(pane().store.getCount()).toBe(2);

        // an empty final window after held rows discards nothing and asks nothing
        box.questions = read([], 3, {limit: 1, offset: 3, hasMore: false});
        expect([pane().store.getCount(), stateLine().hidden, asked]).toEqual([2, true, [2]]);

        // a switch starts the run over, and the other list's window request no longer applies
        box.view = 'all';
        expect([pane().emptyWindows, pane().pendingOffset]).toEqual([0, null])
    });

    test('a first window that shows none of a positive count never reads "nothing waits": the pane asks a few windows on, then says what it holds', () => {
        const
            asked = [],
            read  = (rows, count, page) => ({...answered(rows, page), count});

        box = createBox({record: OPERATOR, view: 'open'});
        box.on('inboxPageRequest', data => asked.push(data.offset));
        asked.length = 0;

        box.questions = read([], 3, {limit: 1, hasMore: true});
        expect(pane().getPaneState()).toBe('rows');
        expect(stateLine().text, 'the next window is on its way').toBe('your open questions have not been read');

        box.questions = read([], 3, {limit: 1, offset: 1, hasMore: true});
        box.questions = read([], 3, {limit: 1, offset: 2, hasMore: true});
        box.questions = read([], 3, {limit: 1, offset: 3, hasMore: true});
        expect(asked, 'three windows in a row at most: never a walk through the inbox').toEqual([1, 2, 3]);
        expect(stateLine().text).toBe('3 open · none can be shown here');

        // a window that brings a row shows it and starts the run over
        box.questions = read([question()], 3, {limit: 1, offset: 4, hasMore: false});
        expect([pane().store.getCount(), stateLine().hidden, pane().emptyWindows]).toEqual([1, true, 0]);

        // a complete zero is the one empty read
        box.questions = read([], 0);
        expect([pane().getPaneState(), stateLine().text]).toEqual(['empty', 'nothing waits for your word'])
    });

    test('a question opened from the open view is the operator\'s to resolve without an all-mail read', () => {
        box = createBox({record: OPERATOR, view: 'open'});
        box.questions = answered([question()]);

        pane().onRowSelect({record: pane().store.get('MESSAGE:q1')});

        expect(pane().getReference('mailbox-detail').viewerIdentity, 'the bound identity stands in for the missing admission').toBe('tobiu')
    });
});
