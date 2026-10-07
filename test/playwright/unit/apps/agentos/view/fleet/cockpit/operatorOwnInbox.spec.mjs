import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitOperatorOwnInboxTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * The owner side of the operator's own inbox: the cockpit controller reads the open message
 * (`fleetOwnMessage`), marks it read (`markOwnMessageRead`) and resolves its Task (`transitionOwnTask`),
 * and writes each answer back onto the operator mailbox. Same harness as the compose
 * block in operatorMailbox.spec: a fake owner over the controller prototype, a recording mailbox and a
 * spied inbox re-read, so each decision is exercised without a mounted cockpit.
 */
test.describe('Fleet cockpit — the operator\'s own inbox: open, mark read, resolve (#551)', () => {
    let Controller;

    const setBridge   = bridge => { (globalThis.AgentOS ??= {}).fleet = {registryBridge: bridge} };
    const clearBridge = () => { delete globalThis.AgentOS?.fleet };

    // the mailbox records every owner write in order, so `loading → ok` is assertable as a sequence
    const makeOwner = () => {
        const mailbox = {writes: []};

        ['actionOutcome', 'messageRead'].forEach(config => Object.defineProperty(mailbox, config, {
            set(value) { mailbox.writes.push([config, value]) }
        }));

        const owner = Object.assign(Object.create(Controller.prototype), {
            inboxReloads                 : [],
            operatorMessageReadGeneration: 0,
            getReference(name) { return name === 'operator-mailbox' ? mailbox : null },
            loadOperatorInbox(params) { this.inboxReloads.push(params); return Promise.resolve() }
        });

        return {mailbox, owner}
    };

    test.beforeAll(async () => {
        Controller = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    test.afterEach(() => clearBridge());

    test('open · the message reads under the operator\'s identity: loading, then the full message', async () => {
        const asked = [], message = {messageId: 'MESSAGE:q1', body: 'the full body', task: {state: 'InputRequired', assignee: '@tobiu'}};

        setBridge({fleetOwnMessage: async params => { asked.push(params); return message }});

        const {mailbox, owner} = makeOwner();

        await owner.onOperatorMessageOpen({messageId: 'MESSAGE:q1'});

        expect(asked).toEqual([{messageId: 'MESSAGE:q1'}]);
        expect(mailbox.writes).toEqual([
            ['messageRead', {messageId: 'MESSAGE:q1', state: 'loading'}],
            ['messageRead', {message, messageId: 'MESSAGE:q1', state: 'ok'}]
        ]);
        expect(owner.inboxReloads, 'opening reads; it re-reads nothing').toEqual([])
    });

    test('open · a bridge without the verb reads unavailable; a refused read keeps its reason; a rejected answer is refused', async () => {
        const {mailbox, owner} = makeOwner();

        setBridge({});
        await owner.onOperatorMessageOpen({messageId: 'MESSAGE:q1'});
        expect(mailbox.writes.at(-1)).toEqual(['messageRead', {messageId: 'MESSAGE:q1', reason: 'fleet: the message read is not wired', state: 'unavailable'}]);

        setBridge({fleetOwnMessage: async () => { throw Object.assign(new Error('Unauthorized: no CAN_READ_INBOX_OF permission'), {fleetConnectionState: 'refused'}) }});
        await owner.onOperatorMessageOpen({messageId: 'MESSAGE:q1'});
        expect(mailbox.writes.at(-1)).toEqual(['messageRead', {messageId: 'MESSAGE:q1', reason: 'Unauthorized: no CAN_READ_INBOX_OF permission', state: 'refused'}]);

        setBridge({fleetOwnMessage: async () => ({status: 'rejected', reason: 'getMessage: messageId must be a non-empty string'})});
        await owner.onOperatorMessageOpen({messageId: 'MESSAGE:q1'});
        expect(mailbox.writes.at(-1)).toEqual(['messageRead', {code: null, messageId: 'MESSAGE:q1', reason: 'getMessage: messageId must be a non-empty string', state: 'refused'}])
    });

    test('open · a read that settles after another message opened lands nowhere', async () => {
        let releaseFirst;

        setBridge({fleetOwnMessage: ({messageId}) => messageId === 'MESSAGE:a'
            ? new Promise(resolve => { releaseFirst = () => resolve({messageId, body: 'stale'}) })
            : Promise.resolve({messageId, body: 'current'})});

        const {mailbox, owner} = makeOwner(),
              first            = owner.onOperatorMessageOpen({messageId: 'MESSAGE:a'});

        await owner.onOperatorMessageOpen({messageId: 'MESSAGE:b'});
        releaseFirst();
        await first;

        expect(mailbox.writes.at(-1)).toEqual(['messageRead', {message: {messageId: 'MESSAGE:b', body: 'current'}, messageId: 'MESSAGE:b', state: 'ok'}]);
        expect(mailbox.writes.some(([, value]) => value.message?.body === 'stale'), 'the superseded read never lands').toBe(false)
    });

    test('mark read · pending, then ok and one inbox re-read: the row reads as read from the source', async () => {
        const asked = [];

        setBridge({markOwnMessageRead: async params => { asked.push(params); return {results: [{messageId: 'MESSAGE:q1', readAt: '2026-10-07T16:00:00.000Z', status: 'read'}]} }});

        const {mailbox, owner} = makeOwner();

        expect(await owner.onOperatorMarkRead({messageId: 'MESSAGE:q1'})).toBe(true);
        expect(asked).toEqual([{messageId: 'MESSAGE:q1'}]);
        expect(mailbox.writes).toEqual([
            ['actionOutcome', {action: 'markRead', messageId: 'MESSAGE:q1', state: 'pending'}],
            ['actionOutcome', {action: 'markRead', messageId: 'MESSAGE:q1', state: 'ok'}]
        ]);
        expect(owner.inboxReloads).toEqual([{offset: 0}])
    });

    test('mark read · an answer that read nothing refuses with what it said, and re-reads nothing', async () => {
        setBridge({markOwnMessageRead: async () => ({results: [{messageId: 'MESSAGE:q1', retracted: true, status: 'retracted'}]})});

        const {mailbox, owner} = makeOwner();

        expect(await owner.onOperatorMarkRead({messageId: 'MESSAGE:q1'})).toBe(false);
        expect(mailbox.writes.at(-1)).toEqual(['actionOutcome', {action: 'markRead', code: null, messageId: 'MESSAGE:q1', reason: 'retracted', state: 'refused'}]);
        expect(owner.inboxReloads).toEqual([])
    });

    test('resolve · moves the Task to Completed guarded by the read state, then re-reads the inbox and the message without a loading flash', async () => {
        const moves = [], reads = [];

        setBridge({
            fleetOwnMessage  : async params => { reads.push(params); return {messageId: 'MESSAGE:q1', body: 'b', task: {state: 'Completed', assignee: '@tobiu'}} },
            transitionOwnTask: async params => { moves.push(params); return {success: true, rowsAffected: 1, task: {state: 'Completed'}} }
        });

        const {mailbox, owner} = makeOwner();

        expect(await owner.onOperatorResolve({expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1'})).toBe(true);
        expect(moves).toEqual([{expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1', newState: 'Completed'}]);
        expect(owner.inboxReloads).toEqual([{offset: 0}]);
        expect(reads).toEqual([{messageId: 'MESSAGE:q1'}]);
        expect(mailbox.writes.map(([config, value]) => `${config}:${value.state}`)).toEqual(['actionOutcome:pending', 'actionOutcome:ok', 'messageRead:ok'])
    });

    test('resolve · a refused move shows the Brain\'s reason and code, and nothing re-reads', async () => {
        setBridge({transitionOwnTask: async () => ({success: false, rowsAffected: 0, code: 'TASK_TRANSITION_FORBIDDEN', reason: '@tobiu as assignee cannot transition `Completed → Completed`'})});

        const {mailbox, owner} = makeOwner();

        expect(await owner.onOperatorResolve({expectedCurrentState: 'Completed', messageId: 'MESSAGE:q1'})).toBe(false);
        expect(mailbox.writes.at(-1)).toEqual(['actionOutcome', {
            action   : 'resolve',
            code     : 'TASK_TRANSITION_FORBIDDEN',
            messageId: 'MESSAGE:q1',
            reason   : '@tobiu as assignee cannot transition `Completed → Completed`',
            state    : 'refused'
        }]);
        expect(owner.inboxReloads).toEqual([])
    });

    test('resolve · a lost race refuses with its reason; a missing verb and a transport failure refuse visibly too', async () => {
        const {mailbox, owner} = makeOwner();

        setBridge({transitionOwnTask: async () => ({success: false, rowsAffected: 0, reason: 'Race lost: state changed to Completed'})});
        await owner.onOperatorResolve({expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1'});
        expect(mailbox.writes.at(-1)[1]).toMatchObject({code: null, reason: 'Race lost: state changed to Completed', state: 'refused'});

        setBridge({});
        await owner.onOperatorResolve({expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1'});
        expect(mailbox.writes.at(-1)[1]).toMatchObject({reason: 'fleet: transitionOwnTask is not wired', state: 'refused'});

        setBridge({transitionOwnTask: async () => { throw new Error('fleet: request transport failed') }});
        await owner.onOperatorResolve({expectedCurrentState: 'InputRequired', messageId: 'MESSAGE:q1'});
        expect(mailbox.writes.at(-1)[1]).toMatchObject({reason: 'fleet: request transport failed', state: 'refused'})
    });

    test('an action that settles after a profile switch lands nowhere', async () => {
        let release;

        setBridge({profileId: 'a', markOwnMessageRead: () => new Promise(resolve => { release = resolve })});

        const {mailbox, owner} = makeOwner(),
              pending          = owner.onOperatorMarkRead({messageId: 'MESSAGE:q1'});

        setBridge({profileId: 'b'});
        release({results: [{messageId: 'MESSAGE:q1', status: 'read'}]});
        await pending;

        expect(mailbox.writes).toEqual([['actionOutcome', {action: 'markRead', messageId: 'MESSAGE:q1', state: 'pending'}]]);
        expect(owner.inboxReloads, 'and another profile\'s inbox is not re-read for it').toEqual([])
    });
});
