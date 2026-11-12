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
 * @summary One read of the operator's waiting work, judged against what the notifier has seen.
 *
 * Each kind keeps the keys of its current rows, so a pull request that leaves the queue and comes back (a new
 * head that turned green again) raises again. A kind whose read failed (`null`) keeps its last keys and raises
 * nothing: a failed read is no evidence that work arrived or left. A question raises only at priority `high`; every
 * question's key is kept, so a later read of the same question stays quiet.
 * @param {Object} state The previous state ({@link blankNoticeState} first).
 * @param {Object} read
 * @param {?String} read.mode The operator's presence mode: `away` holds notices; `present` or unknown (`null`) raises them.
 * @param {?Object[]} read.merges `awaitingMerge` rows `{repo, number, title}`, or `null` when the read failed.
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
        const keys = new Set(merges.map(row => `${row.repo}#${row.number}`));

        state.merges && merges.forEach(row => {
            state.merges.has(`${row.repo}#${row.number}`) || arrived.push({
                kind : 'merge',
                title: 'Ready to merge',
                body : `${row.repo} #${row.number}${row.title ? ` · ${row.title}` : ''}`
            })
        });

        next.merges = keys
    }

    if (Array.isArray(questions)) {
        const keys = new Set(questions.map(row => row.messageId).filter(Boolean));

        state.questions && questions.forEach(row => {
            row.messageId && !state.questions.has(row.messageId) && row.priority === 'high' && arrived.push({
                kind : 'question',
                title: 'A question waits for you',
                body : `${row.from ?? 'A peer'}: ${row.subject ?? ''}`.trim()
            })
        });

        next.questions = keys
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
 * @summary The rows of one Fleet answer, or `null` when it did not answer `ok`.
 * @param {Object|null} envelope A Fleet wire envelope `{state, result}`.
 * @param {Function} pick Reads the rows from the result.
 * @returns {?Object[]}
 * @private
 */
function rowsOf(envelope, pick) {
    if (envelope?.state !== 'ok') return null;

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
                merges   : rowsOf(openWork, result => result?.awaitingMerge),
                mode     : roster?.state === 'ok' ? roster.result?.operatorPresence?.mode ?? null : null,
                questions: rowsOf(questions, result => result?.rows)
            });

            state = plan.state;
            plan.notices.forEach(notice => show(notice));

            const answered = [roster, openWork, questions].map(envelope => envelope?.state ?? 'none').join(' ');

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
