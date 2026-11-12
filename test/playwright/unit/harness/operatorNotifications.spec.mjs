import {expect, test} from '@playwright/test';
import {
    blankNoticeState,
    createNoticePresenter,
    createOperatorNotifier,
    OPERATOR_NOTICE_RETAINED,
    OPERATOR_NOTICE_ROUTE,
    OPERATOR_NOTICE_SEEN_CAP,
    planOperatorNotices
} from '../../../../harness/operatorNotifications.mjs';

/**
 * @summary The operator notifier: a launch baselines, a new merge or a high-priority question raises one notice, a
 * repeat raises none, the operator's absence holds and counts, the return raises one summary, and a focused window
 * raises nothing. A failed read changes nothing.
 */
test.describe('harness operator notifications', () => {
    const
        merge    = (number, title = `PR ${number}`, head = 'a1') => ({repo: 'neomjs/neo', number, head, title}),
        question = (id, priority = 'high') => ({messageId: `MESSAGE:${id}`, subject: `ask ${id}`, from: '@neo-opus-vega', priority}),
        plan     = (state, read) => planOperatorNotices(state, {mode: 'present', merges: [], questions: [], ...read});

    test('the first read baselines, so a launch raises nothing', () => {
        const {state, notices} = plan(blankNoticeState(), {merges: [merge(1)], questions: [question('a')]});

        expect(notices).toEqual([]);
        expect([...state.merges]).toEqual(['neomjs/neo#1@a1']);
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

    test('a merge that drops out of a read returns quietly at the same head and raises again at a new one', () => {
        let {state} = plan(blankNoticeState(), {merges: [merge(7)]});

        ({state} = plan(state, {merges: []}));

        const same = plan(state, {merges: [merge(7)]});

        expect(same.notices, 'a mergeable flicker is not new work').toEqual([]);
        expect(plan(same.state, {merges: [merge(7, 'PR 7', 'b2')]}).notices.map(notice => notice.kind)).toEqual(['merge'])
    });

    test('the seen keys stay bounded: the longest unseen go first', () => {
        let {state} = plan(blankNoticeState(), {merges: [merge(0)]});

        ({state} = plan(state, {merges: Array.from({length: OPERATOR_NOTICE_SEEN_CAP}, (_, index) => merge(index + 1))}));

        expect(state.merges.size).toBe(OPERATOR_NOTICE_SEEN_CAP);
        expect(state.merges.has('neomjs/neo#0@a1'), 'the oldest unseen key went').toBe(false);
        expect(state.merges.has(`neomjs/neo#${OPERATOR_NOTICE_SEEN_CAP}@a1`)).toBe(true)
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
        expect([...failed.state.merges]).toEqual(['neomjs/neo#1@a1']);

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
                fleetOpenWork    : {state: 'ok', result: {state: 'ok', awaitingMerge: [merge(1)]}},
                fleetOwnQuestions: {state: 'ok', result: {state: 'ok', rows: []}}
            },
            notifier = createOperatorNotifier({
                isFocused: () => false,
                log      : line => logged.push(line),
                read     : async (method, params) => { calls.push([method, params]); return answers[method] },
                show     : notice => shown.push(notice)
            });

        expect(await notifier.tick()).toEqual([]);
        expect(calls).toEqual([['fleetRoster', undefined], ['fleetOpenWork', undefined], ['fleetOwnQuestions', {offset: 0}]]);

        answers.fleetOpenWork = {state: 'ok', result: {state: 'stale', awaitingMerge: [merge(1), merge(2)]}};
        await notifier.tick();

        expect(shown.map(notice => notice.body), 'a stale answer still carries rows').toEqual(['neomjs/neo #2 · PR 2']);
        expect(logged, 'one line for the stale answer').toEqual(['operator notices: roster, open work, questions answer ok stale ok']);

        // a refused read is no evidence: nothing raised, one log line for the change, none for its repeat
        answers.fleetOpenWork = {state: 'refused', error: 'fleet: Brain is not ready'};
        await notifier.tick();
        await notifier.tick();

        expect(shown).toHaveLength(1);
        expect(logged.at(-1)).toBe('operator notices: roster, open work, questions answer ok refused ok');
        expect(logged).toHaveLength(2);

        expect(() => createOperatorNotifier({read: null, show: () => {}, isFocused: () => false})).toThrow(TypeError)
    });

    test('an unavailable result inside an ok answer is no evidence, before the baseline and after it', async () => {
        const
            shown    = [],
            logged   = [],
            waiting  = {state: 'ok', result: {state: 'ok', awaitingMerge: [merge(1), merge(2)]}},
            booting  = {state: 'ok', result: {state: 'unavailable', awaitingMerge: []}},
            answers  = {
                fleetRoster      : {state: 'ok', result: {rows: [], operatorPresence: {mode: 'present'}}},
                fleetOpenWork    : booting,
                fleetOwnQuestions: {state: 'ok', result: {state: 'unavailable', rows: []}}
            },
            notifier = createOperatorNotifier({
                isFocused: () => false,
                log      : line => logged.push(line),
                read     : async method => answers[method],
                show     : notice => shown.push(notice)
            });

        // the producer has not polled yet: nothing is baselined, so its first real answer baselines quietly
        await notifier.tick();

        expect(notifier.state.merges).toBeNull();
        expect(notifier.state.questions).toBeNull();
        expect(logged).toEqual(['operator notices: roster, open work, questions answer ok unavailable unavailable']);

        answers.fleetOpenWork = waiting;
        await notifier.tick();

        expect(shown, 'the waiting merges were there before the first poll').toEqual([]);

        // after the baseline, an unavailable answer keeps what was seen, and the same rows after it stay quiet
        answers.fleetOpenWork = booting;
        await notifier.tick();
        answers.fleetOpenWork = waiting;
        await notifier.tick();

        expect(shown).toEqual([]);
        expect(notifier.state.merges.size).toBe(2)
    })
});

/**
 * @summary The notice presenter keeps each OS notification referenced until it is clicked or closed, and a click
 * shows the cockpit on the Fleet view.
 */
test.describe('harness operator notice presenter', () => {
    /**
     * @summary A stand-in for Electron's notification: records its options, its listeners and whether it showed.
     */
    class FakeNotification {
        static made = [];

        constructor(options) {
            this.options   = options;
            this.listeners = {};
            this.shown     = false;
            FakeNotification.made.push(this)
        }

        on(event, listener) {
            this.listeners[event] = listener
        }

        show() {
            this.shown = true
        }
    }

    test.beforeEach(() => {
        FakeNotification.made = []
    });

    test('a shown notice stays referenced until its click or its close, and a click shows the Fleet view', () => {
        const
            routes    = [],
            presenter = createNoticePresenter({Notification: FakeNotification, navigate: route => routes.push(route), openCockpit: () => true});

        presenter.show({title: 'Ready to merge', body: 'neomjs/neo #2'});
        presenter.show({title: 'A question waits for you', body: '@neo-opus-vega: ask a'});

        const [first, second] = FakeNotification.made;

        expect(first.options).toEqual({title: 'Ready to merge', body: 'neomjs/neo #2'});
        expect(first.shown && second.shown).toBe(true);
        expect(presenter.retained).toBe(2);

        first.listeners.click();

        expect(routes).toEqual([OPERATOR_NOTICE_ROUTE]);
        expect(presenter.retained).toBe(1);

        second.listeners.close();

        expect(presenter.retained).toBe(0);
        expect(routes, 'a close navigates nowhere').toHaveLength(1)
    });

    test('a click with no cockpit to show navigates nowhere', () => {
        const
            routes    = [],
            presenter = createNoticePresenter({Notification: FakeNotification, navigate: route => routes.push(route), openCockpit: () => false});

        presenter.show({title: 'Ready to merge', body: 'neomjs/neo #2'});
        FakeNotification.made[0].listeners.click();

        expect(routes).toEqual([]);
        expect(presenter.retained).toBe(0)
    });

    test('past the cap the oldest is let go, and a quit lets every one go', () => {
        const presenter = createNoticePresenter({Notification: FakeNotification, navigate: () => {}, openCockpit: () => true});

        for (let index = 0; index <= OPERATOR_NOTICE_RETAINED; index++) {
            presenter.show({title: 'Ready to merge', body: `neomjs/neo #${index}`})
        }

        expect(presenter.retained).toBe(OPERATOR_NOTICE_RETAINED);

        presenter.clear();

        expect(presenter.retained).toBe(0)
    })
});
