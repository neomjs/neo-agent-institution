import {expect, test} from '@playwright/test';
import {
    blankNoticeState,
    createOperatorNotifier,
    planOperatorNotices
} from '../../../../harness/operatorNotifications.mjs';

/**
 * @summary The operator notifier: a launch baselines, a new merge or a high-priority question raises one notice, a
 * repeat raises none, the operator's absence holds and counts, the return raises one summary, and a focused window
 * raises nothing. A failed read changes nothing.
 */
test.describe('harness operator notifications', () => {
    const
        merge    = (number, title = `PR ${number}`) => ({repo: 'neomjs/neo', number, title}),
        question = (id, priority = 'high') => ({messageId: `MESSAGE:${id}`, subject: `ask ${id}`, from: '@neo-opus-vega', priority}),
        plan     = (state, read) => planOperatorNotices(state, {mode: 'present', merges: [], questions: [], ...read});

    test('the first read baselines, so a launch raises nothing', () => {
        const {state, notices} = plan(blankNoticeState(), {merges: [merge(1)], questions: [question('a')]});

        expect(notices).toEqual([]);
        expect([...state.merges]).toEqual(['neomjs/neo#1']);
        expect([...state.questions]).toEqual(['MESSAGE:a'])
    });

    test('a new merge and a new high-priority question raise one notice each; a repeat raises none', () => {
        let {state} = plan(blankNoticeState(), {merges: [merge(1)]});

        // the first read baselined both axes, an empty questions answer included
        const second = plan(state, {merges: [merge(1), merge(2, 'the toggle')], questions: [question('a'), question('b', 'normal')]});

        expect(second.notices, 'the ordinary question raises nothing').toEqual([
            {kind: 'merge', title: 'Ready to merge', body: 'neomjs/neo #2 · the toggle'},
            {kind: 'question', title: 'A question waits for you', body: '@neo-opus-vega: ask a'}
        ]);

        expect(plan(second.state, {merges: [merge(1), merge(2)], questions: [question('a'), question('b', 'normal')]}).notices, 'nothing new').toEqual([])
    });

    test('a merge that leaves the queue and comes back raises again', () => {
        let {state} = plan(blankNoticeState(), {merges: [merge(7)]});

        ({state} = plan(state, {merges: []}));

        expect(plan(state, {merges: [merge(7)]}).notices.map(notice => notice.kind)).toEqual(['merge'])
    });

    test('while away nothing is raised and the work is counted; the return raises one summary', () => {
        let {state} = plan(blankNoticeState(), {});

        const away = planOperatorNotices(state, {mode: 'away', merges: [merge(1), merge(2)], questions: [question('a'), question('b', 'normal')]});

        expect(away.notices).toEqual([]);
        expect(away.state.waited).toEqual({merges: 2, questions: 1});

        const back = plan(away.state, {merges: [merge(1), merge(2)], questions: [question('a')]});

        expect(back.notices).toEqual([{kind: 'summary', title: 'While you were away', body: '2 merges and 1 question waited'}]);
        expect(back.state.waited).toEqual({merges: 0, questions: 0});

        // a quiet absence returns quietly
        const quiet = planOperatorNotices(back.state, {mode: 'away', merges: [merge(1), merge(2)], questions: [question('a')]});

        expect(plan(quiet.state, {merges: [merge(1), merge(2)], questions: [question('a')]}).notices).toEqual([])
    });

    test('an unknown presence raises like present; a focused window raises nothing but still sees', () => {
        let {state} = plan(blankNoticeState(), {});

        expect(planOperatorNotices(state, {mode: null, merges: [merge(3)], questions: []}).notices).toHaveLength(1);

        const focused = plan(state, {merges: [merge(3)], focused: true});

        expect(focused.notices).toEqual([]);
        expect(plan(focused.state, {merges: [merge(3)]}).notices, 'seen while focused').toEqual([])
    });

    test('a failed read keeps what was seen and raises nothing', () => {
        let {state} = plan(blankNoticeState(), {merges: [merge(1)], questions: [question('a')]});

        const failed = planOperatorNotices(state, {mode: 'present', merges: null, questions: null});

        expect(failed.notices).toEqual([]);
        expect([...failed.state.merges]).toEqual(['neomjs/neo#1']);

        // the next answer that still holds the first pull request raises nothing for it
        expect(plan(failed.state, {merges: [merge(1)], questions: [question('a')]}).notices).toEqual([])
    });

    test('the notifier reads all three axes through main\'s Fleet read and shows each notice', async () => {
        const
            calls   = [],
            shown   = [],
            logged  = [],
            answers = {
                fleetRoster      : {state: 'ok', result: {rows: [], operatorPresence: {mode: 'present'}}},
                fleetOpenWork    : {state: 'ok', result: {awaitingMerge: [merge(1)]}},
                fleetOwnQuestions: {state: 'ok', result: {rows: []}}
            },
            notifier = createOperatorNotifier({
                isFocused: () => false,
                log      : line => logged.push(line),
                read     : async (method, params) => { calls.push([method, params]); return answers[method] },
                show     : notice => shown.push(notice)
            });

        expect(await notifier.tick()).toEqual([]);
        expect(calls).toEqual([['fleetRoster', undefined], ['fleetOpenWork', undefined], ['fleetOwnQuestions', {offset: 0}]]);

        answers.fleetOpenWork = {state: 'ok', result: {awaitingMerge: [merge(1), merge(2)]}};
        await notifier.tick();

        expect(shown.map(notice => notice.body)).toEqual(['neomjs/neo #2 · PR 2']);
        expect(logged, 'every read answered').toEqual([]);

        // a refused read is no evidence: nothing raised, one log line for the change, none for its repeat
        answers.fleetOpenWork = {state: 'refused', error: 'fleet: Brain is not ready'};
        await notifier.tick();
        await notifier.tick();

        expect(shown).toHaveLength(1);
        expect(logged).toEqual(['operator notices: roster, open work, questions answer ok refused ok']);

        expect(() => createOperatorNotifier({read: null, show: () => {}, isFocused: () => false})).toThrow(TypeError)
    })
});
