import {setup} from '../../../../../../setup.mjs';

const appName = 'DetailContainerTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: false,
        unitTestMode           : true,
        useDomApiRenderer      : false
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect}  from '@playwright/test';
import Neo             from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core       from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import InstanceManager from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import DetailContainer from '../../../../../../../../apps/agentos/view/fleet/mailbox/DetailContainer.mjs';

const VIEWER = '@tobiu';

function row(overrides = {}) {
    return {
        messageId     : 'MESSAGE:q1',
        from          : '@neo-gpt',
        subject       : '[question] which plane do the seats bind?',
        status        : 'unread',
        taskState     : 'InputRequired',
        priority      : 'high',
        sentAt        : '2026-10-07T11:00:00.000Z',
        relatedTickets: [],
        ...overrides
    }
}

function okRead(task = {state: 'InputRequired', assignee: VIEWER}, overrides = {}) {
    return {messageId: 'MESSAGE:q1', state: 'ok', message: {messageId: 'MESSAGE:q1', body: 'line one\nline two', task, ...overrides}}
}

function createDetail(config = {}) {
    return Neo.create(DetailContainer, {appName, viewerIdentity: VIEWER, ...config})
}

const ref   = (detail, name) => detail.getReference(name);
const shown = (detail, name) => ref(detail, name).hidden !== true;

test.describe('AgentOS.view.fleet.mailbox.DetailContainer — one message, two entries (#551)', () => {
    let detail;

    test.afterEach(() => {
        detail?.destroy();
        detail = null
    });

    test('the observer entry renders the message read-only: facts and body, no strip', () => {
        detail = createDetail({row: row(), read: okRead()});

        expect(ref(detail, 'detail-body').text).toBe('line one\nline two');
        expect(shown(detail, 'detail-strip'), 'an observer gets no actions').toBe(false);
        expect(JSON.stringify(ref(detail, 'detail-facts').vdom.cn)).toContain('which plane do the seats bind?')
    });

    test('the body says what stands in its place: reading, refused with its code, unavailable, retracted', () => {
        detail = createDetail({entry: 'own', row: row()});
        expect(ref(detail, 'detail-body').text, 'not asked yet reads as reading').toBe('Reading the message…');

        detail.read = {messageId: 'MESSAGE:q1', state: 'refused', code: 'MAILBOX_FORBIDDEN', reason: 'no CAN_READ_INBOX_OF permission'};
        expect(ref(detail, 'detail-body').text).toBe('The message could not be opened: no CAN_READ_INBOX_OF permission · MAILBOX_FORBIDDEN');

        detail.read = {messageId: 'MESSAGE:q1', state: 'unavailable', reason: 'fleet: request transport failed'};
        expect(ref(detail, 'detail-body').text).toBe('The message could not be read: fleet: request transport failed');

        detail.read = okRead();
        detail.row  = row({status: 'retracted'});
        expect(ref(detail, 'detail-body').text, 'a retracted message keeps its placeholder, never a stale body').toBe('The sender retracted this message.');
        expect(shown(detail, 'detail-strip'), 'and offers no action').toBe(false)
    });

    test('a read about another message is not this message\'s body', () => {
        detail = createDetail({row: row(), read: {...okRead(), messageId: 'MESSAGE:other'}});

        expect(ref(detail, 'detail-body').text).toBe('Reading the message…')
    });

    test('own entry: Mark read only while unread; Reply always; Resolve only for the viewer\'s movable Task', () => {
        detail = createDetail({entry: 'own', row: row(), read: okRead()});

        expect(shown(detail, 'detail-strip')).toBe(true);
        expect(shown(detail, 'detail-mark-read')).toBe(true);
        expect(shown(detail, 'detail-reply')).toBe(true);
        expect(shown(detail, 'detail-resolve')).toBe(true);
        expect(ref(detail, 'detail-resolve').text, 'the label names the move').toBe('Resolve: mark Completed');

        detail.row = row({status: 'read'});
        expect(shown(detail, 'detail-mark-read'), 'a read message has nothing to mark').toBe(false);

        detail.read = okRead({state: 'Working', assignee: 'tobiu'});
        expect(shown(detail, 'detail-resolve'), 'Working is movable; the @ prefix is not identity').toBe(true);

        detail.read = okRead({state: 'Completed', assignee: VIEWER});
        expect(shown(detail, 'detail-resolve'), 'a terminal Task cannot be resolved again').toBe(false);

        detail.read = okRead({state: 'InputRequired', assignee: '@neo-opus-ada'});
        expect(shown(detail, 'detail-resolve'), 'someone else\'s Task is not the viewer\'s to move').toBe(false);

        detail.read = okRead(undefined, {task: undefined});
        expect(shown(detail, 'detail-resolve'), 'a plain message has no Task').toBe(false);

        detail.read = {messageId: 'MESSAGE:q1', state: 'loading'};
        expect(shown(detail, 'detail-resolve'), 'Resolve waits for the read that names the Task').toBe(false)
    });

    test('the outcome line: pending disables the strip; a refusal shows its reason and the Brain\'s code; ok says nothing', () => {
        detail = createDetail({entry: 'own', row: row(), read: okRead()});

        detail.outcome = {messageId: 'MESSAGE:q1', action: 'resolve', state: 'pending'};
        expect(ref(detail, 'detail-outcome').text).toBe('Resolve…');
        expect(ref(detail, 'detail-resolve').disabled).toBe(true);
        expect(ref(detail, 'detail-reply').disabled).toBe(true);

        detail.outcome = {messageId: 'MESSAGE:q1', action: 'resolve', state: 'refused', code: 'TASK_TRANSITION_FORBIDDEN', reason: 'the assignee cannot move InputRequired → Completed'};
        expect(shown(detail, 'detail-outcome')).toBe(true);
        expect(ref(detail, 'detail-outcome').text).toBe('Resolve was refused: the assignee cannot move InputRequired → Completed · TASK_TRANSITION_FORBIDDEN');
        expect(ref(detail, 'detail-resolve').disabled, 'a refusal leaves the action available').toBe(false);

        detail.outcome = {messageId: 'MESSAGE:q1', action: 'markRead', state: 'ok'};
        expect(shown(detail, 'detail-outcome'), 'success shows in the re-read row, not as a line').toBe(false);

        detail.outcome = {messageId: 'MESSAGE:other', action: 'markRead', state: 'refused', reason: 'x'};
        expect(shown(detail, 'detail-outcome'), 'another message\'s outcome is not this one\'s').toBe(false)
    });

    test('the strip fires intents only: mark read, reply to the sender, resolve guarded by the read state', () => {
        detail = createDetail({entry: 'own', row: row(), read: okRead()});

        const fired = [];

        ['markReadRequest', 'replyRequest', 'resolveRequest'].forEach(name => detail.on(name, data => fired.push([name, data])));

        detail.onMarkReadClick();
        detail.onReplyClick();
        detail.onResolveClick();

        const source = detail.id;

        expect(fired).toEqual([
            ['markReadRequest', {messageId: 'MESSAGE:q1', source}],
            ['replyRequest',    {messageId: 'MESSAGE:q1', source, subject: '[question] which plane do the seats bind?', to: '@neo-gpt'}],
            ['resolveRequest',  {expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1', source}]
        ])
    });
});
