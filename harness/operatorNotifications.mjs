/**
 * @module harness/operatorNotifications
 * @summary Tells the operator, through the OS, when a merge or a question waits for them.
 *
 * Two kinds of work wait on the operator alone: a pull request whose next action is their merge (the open-work
 * producer's `awaitingMerge`) and a question a peer addressed to them (`fleetOwnQuestions`). The cockpit shows both,
 * but only while its window is visible: its reads stop when it hides. This reader lives in Electron main, beside the
 * Fleet child main already owns, and reads both on its own cadence.
 *
 * {@link planOperatorNotices} is the rule, pure; {@link createOperatorNotifier} runs it against main's Fleet
 * transport and Electron's notification surface, both injected. The first read of each kind baselines it, so a
 * launch raises nothing. While the operator is away (Nightshift), nothing is raised and the waiting work is counted;
 * the first read after their return raises one summary. A focused FM window raises nothing, since its view
 * already shows the work.
 */

/**
 * @summary Where a notification's click takes the cockpit: the Fleet view holds the merge queue and the Mailbox.
 * @type {String}
 */
export const OPERATOR_NOTICE_ROUTE = '/fleet';

/**
 * @summary The notifier's reading cadence: a merge or a question waits for minutes, not seconds.
 * @type {Number}
 */
export const OPERATOR_NOTICE_INTERVAL_MS = 60_000;

/**
 * @summary How many seen keys each kind keeps: the oldest unseen ones go first, so a long-running FM stays bounded.
 * @type {Number}
 */
export const OPERATOR_NOTICE_SEEN_CAP = 500;

/**
 * @summary How many shown notifications stay referenced while they wait in the OS's notification list.
 * @type {Number}
 */
export const OPERATOR_NOTICE_RETAINED = 20;

/**
 * @summary A notifier's state before its first read: nothing seen, nothing waited.
 * @returns {{merges: ?Set<String>, questions: ?Set<String>, away: Boolean, waited: {merges: Number, questions: Number}}}
 */
export function blankNoticeState() {
    return {away: false, merges: null, questions: null, waited: {merges: 0, questions: 0}}
}

/**
 * @summary The plural-aware count phrase of a summary: `1 merge`, `2 questions`.
 * @param {Number} count
 * @param {String} noun
 * @returns {String}
 * @private
 */
function counted(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * @summary The keys a kind has seen after one read: every earlier key kept, this read's moved to the newest end,
 * and the oldest dropped past {@link OPERATOR_NOTICE_SEEN_CAP}.
 * @param {?Set<String>} seen
 * @param {String[]} keys
 * @returns {Set<String>}
 * @private
 */
function remember(seen, keys) {
    const next = new Set(seen);

    keys.forEach(key => {
        next.delete(key);
        next.add(key)
    });

    while (next.size > OPERATOR_NOTICE_SEEN_CAP) next.delete(next.values().next().value);

    return next
}

/**
 * @summary A merge row's key: a new head is new work, the same head again is not.
 * @param {Object} row
 * @returns {String}
 * @private
 */
function mergeKey(row) {
    return `${row.repo}#${row.number}@${row.head ?? ''}`
}

/**
 * @summary One read of the operator's waiting work, judged against what the notifier has seen.
 *
 * Each kind keeps every key it has seen: a merge row by repository, number and head, a question by its message.
 * So a row that drops out of one read and returns at the same head stays quiet, while a pull request that turned
 * merge-ready again at a new head raises again. A kind whose read failed (`null`) keeps its keys and raises
 * nothing: a failed read is no evidence that work arrived or left. A question raises only at priority `high`.
 * @param {Object} state The previous state ({@link blankNoticeState} first).
 * @param {Object} read
 * @param {?String} read.mode The operator's presence mode: `away` holds notices; `present` or unknown (`null`) raises them.
 * @param {?Object[]} read.merges `awaitingMerge` rows `{repo, number, head, title}`, or `null` when the read failed.
 * @param {?Object[]} read.questions `fleetOwnQuestions` rows `{messageId, subject, from, priority}`, or `null`.
 * @param {Boolean} [read.focused=false] Whether an FM window has focus.
 * @returns {{state: Object, notices: Object[]}} `notices`: `{kind: 'merge'|'question'|'summary', title, body}`.
 */
export function planOperatorNotices(state, {mode, merges, questions, focused = false}) {
    const
        away    = mode === 'away',
        next    = {away, merges: state.merges, questions: state.questions, waited: {...state.waited}},
        arrived = [];

    if (Array.isArray(merges)) {
        state.merges && merges.forEach(row => {
            state.merges.has(mergeKey(row)) || arrived.push({
                kind : 'merge',
                title: 'Ready to merge',
                body : `${row.repo} #${row.number}${row.title ? ` · ${row.title}` : ''}`
            })
        });

        next.merges = remember(state.merges, merges.map(mergeKey))
    }

    if (Array.isArray(questions)) {
        state.questions && questions.forEach(row => {
            row.messageId && !state.questions.has(row.messageId) && row.priority === 'high' && arrived.push({
                kind : 'question',
                title: 'A question waits for you',
                body : `${row.from ?? 'A peer'}: ${row.subject ?? ''}`.trim()
            })
        });

        next.questions = remember(state.questions, questions.map(row => row.messageId).filter(Boolean))
    }

    if (away) {
        arrived.forEach(notice => next.waited[notice.kind === 'merge' ? 'merges' : 'questions']++);

        return {state: next, notices: []}
    }

    const notices = [];

    if (state.away) {
        const {merges: mergeCount, questions: questionCount} = next.waited;

        if (mergeCount || questionCount) {
            const parts = [mergeCount && counted(mergeCount, 'merge'), questionCount && counted(questionCount, 'question')].filter(Boolean);

            notices.push({kind: 'summary', title: 'While you were away', body: `${parts.join(' and ')} waited`})
        }

        next.waited = {merges: 0, questions: 0}
    }

    notices.push(...arrived);

    return {state: next, notices: focused ? [] : notices}
}

/**
 * @summary What one Fleet answer said: the wire's refusal, else its result's own state (an `ok` envelope may carry
 * an `unavailable` result, e.g. open work before the producer's first poll).
 * @param {Object|null} envelope A Fleet wire envelope `{state, result}`.
 * @returns {String}
 * @private
 */
function answerOf(envelope) {
    return envelope?.state === 'ok' ? envelope.result?.state ?? 'ok' : envelope?.state ?? 'none'
}

/**
 * @summary The rows of one Fleet answer, or `null` when it is no evidence: a refused wire, or a result whose own
 * state the cockpit would not show as rows either.
 * @param {Object|null} envelope A Fleet wire envelope `{state, result}`.
 * @param {String[]} states The result states that carry rows.
 * @param {Function} pick Reads the rows from the result.
 * @returns {?Object[]}
 * @private
 */
function rowsOf(envelope, states, pick) {
    if (envelope?.state !== 'ok' || !states.includes(envelope.result?.state)) return null;

    const rows = pick(envelope.result);

    return Array.isArray(rows) ? rows : null
}

/**
 * @summary Runs {@link planOperatorNotices} on a cadence against main's Fleet transport.
 * @param {Object} options
 * @param {Function} options.read `(method, params) => Promise<envelope>`: main's own Fleet read.
 * @param {Function} options.show `(notice) => void`: raises one OS notification; its click opens {@link OPERATOR_NOTICE_ROUTE}.
 * @param {Function} options.isFocused `() => Boolean`: whether an FM window has focus.
 * @param {Number} [options.intervalMs=OPERATOR_NOTICE_INTERVAL_MS]
 * @param {Function} [options.log] Receives one line whenever the set of reads that answer changes.
 * @returns {{start: Function, stop: Function, tick: Function, readonly state: Object}}
 */
export function createOperatorNotifier({read, show, isFocused, intervalMs = OPERATOR_NOTICE_INTERVAL_MS, log = () => {}}) {
    if (typeof read !== 'function' || typeof show !== 'function' || typeof isFocused !== 'function') {
        throw new TypeError('createOperatorNotifier requires read, show and isFocused')
    }

    let health  = 'ok ok ok',
        state   = blankNoticeState(),
        running = false,
        timer   = null;

    /**
     * @summary One round: three reads, one plan, the notices shown. Rounds never overlap.
     * @returns {Promise<Object[]>} The notices shown this round.
     */
    async function tick() {
        if (running) return [];

        running = true;

        try {
            const [roster, openWork, questions] = await Promise.all([
                read('fleetRoster').catch(() => null),
                read('fleetOpenWork').catch(() => null),
                read('fleetOwnQuestions', {offset: 0}).catch(() => null)
            ]);

            const plan = planOperatorNotices(state, {
                focused  : isFocused(),
                merges   : rowsOf(openWork, ['ok', 'stale'], result => result.awaitingMerge),
                mode     : roster?.state === 'ok' ? roster.result?.operatorPresence?.mode ?? null : null,
                questions: rowsOf(questions, ['ok'], result => result.rows)
            });

            state = plan.state;
            plan.notices.forEach(notice => show(notice));

            const answered = [roster, openWork, questions].map(answerOf).join(' ');

            answered !== health && log(`operator notices: roster, open work, questions answer ${answered}`);
            health = answered;

            return plan.notices
        } finally {
            running = false
        }
    }

    return {
        /** @summary Starts the cadence; the first round baselines what already waits. */
        start() {
            if (timer) return;

            tick();
            timer = setInterval(tick, intervalMs);
            timer.unref?.()
        },
        /** @summary Stops the cadence; a round in flight finishes. */
        stop() {
            timer && clearInterval(timer);
            timer = null
        },
        tick,
        get state() {
            return state
        }
    }
}

/**
 * @summary Shows notices as OS notifications and keeps each referenced until it is clicked or closed: one that
 * nothing references can be collected while it waits in the OS's list, its click handler with it.
 *
 * A click shows the cockpit and, when there is one to show, points it at {@link OPERATOR_NOTICE_ROUTE}. Past
 * {@link OPERATOR_NOTICE_RETAINED} the oldest is let go, for an OS that never reports a close.
 * @param {Object} options
 * @param {Function} options.Notification Electron's notification class.
 * @param {Function} options.openCockpit `() => Boolean`: shows the cockpit window; falsy when there is none.
 * @param {Function} options.navigate `(route) => void`: points the shown cockpit at a route.
 * @returns {{show: Function, clear: Function, readonly retained: Number}}
 */
export function createNoticePresenter({Notification, openCockpit, navigate}) {
    const live = new Set();

    return {
        /**
         * @summary Raises one notice.
         * @param {{title: String, body: String}} notice
         */
        show({title, body}) {
            const
                notification = new Notification({title, body}),
                release      = () => live.delete(notification);

            notification.on('click', () => {
                release();
                openCockpit() && navigate(OPERATOR_NOTICE_ROUTE)
            });
            notification.on('close', release);

            live.add(notification);

            while (live.size > OPERATOR_NOTICE_RETAINED) live.delete(live.values().next().value);

            notification.show()
        },
        /** @summary Lets every shown notification go, at quit. */
        clear() {
            live.clear()
        },
        get retained() {
            return live.size
        }
    }
}
