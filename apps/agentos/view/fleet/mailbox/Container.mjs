import AgentMailboxStore from '../../../store/AgentMailbox.mjs';
import Button            from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container         from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import MailboxGrid       from './Grid.mjs';
import DetailContainer   from './DetailContainer.mjs';
import AgentFreshness    from '../../../util/AgentFreshness.mjs';
import Splitter          from '../../../../../node_modules/neo.mjs/src/component/Splitter.mjs';

/**
 * @summary Is this payload the mirror adapter's own envelope?
 *
 * The producer emits `{capability, admission, rows, page}` — always all four, on EVERY state
 * including its degrades, because the not-wired snapshot is built by the same pure half as a live
 * one. So a payload missing any of them did not come from that producer, and reading a mail claim
 * out of it is fabrication: `{rows: []}` would render "No active messages for @x" and
 * `{rows: [message]}` would render a stranger's message list, both from a shape the pane never
 * recognized. Structural recognition only — the STATES inside it are the producer's to declare.
 * @param {Object} snapshot Candidate payload.
 * @returns {Boolean}
 * @private
 */
function isRecognizedMirrorEnvelope(snapshot) {
    return Boolean(snapshot)
        && typeof snapshot.capability === 'object' && snapshot.capability !== null
        && typeof snapshot.admission  === 'object' && snapshot.admission  !== null
        && typeof snapshot.page       === 'object' && snapshot.page       !== null
        && Array.isArray(snapshot.rows)
}

/**
 * @summary Is this the open-questions read's own answer?
 *
 * The Fleet's `fleetOwnQuestions` answers `{state, reason, count, rows, page}`: `ok` with the complete count, or
 * `unavailable` with its reason. Anything else is not that read, and the open view renders nothing from it.
 * @param {Object} answer Candidate payload.
 * @returns {Boolean}
 * @private
 */
function isRecognizedQuestionsAnswer(answer) {
    return Boolean(answer)
        && (answer.state === 'ok' || answer.state === 'unavailable')
        && Array.isArray(answer.rows)
        && typeof answer.page === 'object' && answer.page !== null
        && (answer.count === null || Number.isSafeInteger(answer.count))
}

/**
 * @summary Is this a real page window?
 *
 * The bounds render as fact beside the rows ("51–60"), and the steps derive their offsets from them.
 * A `page` that is merely PRESENT — `{}` — yields `NaN–NaN` and offsets of `NaN`: a window invented
 * out of absent numbers. Structural recognition of the producer's own shape, not a range opinion.
 * @param {Object} page Candidate page bounds.
 * @returns {Boolean}
 * @private
 */
function isRecognizedPage(page) {
    return Number.isSafeInteger(page.limit)
        && Number.isSafeInteger(page.offset)
        && Number.isSafeInteger(page.count)
        && page.limit  > 0
        && page.offset >= 0
        && page.count  >= 0
}

/**
 * How many windows in a row the open questions ask for themselves when a landed window showed no row: enough to
 * pass a run of rows the graph cannot project, never a walk through the inbox.
 * @type {Number}
 */
const EMPTY_WINDOWS = 3;

/**
 * The mailbox mirror pane — the S1 view half: a read-only, viewer-admitted mirror of ONE subject's
 * ACTIVE A2A inbox, rendered from one Fleet mailbox-mirror adapter snapshot. Subject-generic by
 * construction: today its one host is the south pane's {@link AgentOS.view.fleet.mailbox.OperatorContainer}
 * (the operator's own inbox); a selection-scoped per-agent subject mode re-enters through the same
 * host when the S5 Fleet grants/admission layer lands (viewer ingress is already live; the policy
 * ledger holds the mirror read at awaiting-s5).
 *
 * **Read-only unless the host owns the inbox.** By default the pane renders zero mutation
 * affordances — no mark-read, no archive, no reply (the graduated record's MUST-NOT: operator-side
 * mark-read would mutate the agent's own turn-start signal and swallow peer handoffs). Selecting a
 * row opens its {@link AgentOS.view.fleet.mailbox.DetailContainer} beside the list, the way the
 * Memories pane reads a record beside its own (a narrow pane stacks the two); the detail reads and
 * never writes. The one host that owns its inbox declares `detailEntry: 'own'` (the operator's own
 * inbox), and only there the detail renders `Mark read` · `Reply` · `Resolve`. Thread-collapse
 * toggling stays pure display state on the view-owned `threadCollapsed` field. The pane's host label
 * stays COUNTLESS by design: an unread-count badge would imply operator-side read tracking that
 * deliberately does not exist; per-row `status` is the honest fact instead.
 *
 * **Four mutually exclusive honest states** (never a fake success):
 *  - `unobserved` — no snapshot injected yet: the feed is not wired; says so.
 *  - `denied` — the adapter's admission block reports the viewer holds no `CAN_READ_INBOX_OF`
 *    grant for the subject: a NAMED denial (viewer + subject), never an empty-success.
 *  - `degraded` — the source failed for a non-admission reason: the honest reason line.
 *  - `empty` — wired, admitted, zero active rows: an explicit empty state.
 *
 * **The open view.** The host that owns its inbox can switch the list to `view: 'open'`: the viewer's open
 * questions from the owner-written `questions` read, in the read's own order (highest priority, then oldest), each
 * on its own row: no sorter re-sorts them and no thread collapses one away. Its states are its own: not read yet,
 * `your questions could not be read · <reason>`, or `nothing waits for your word`. Reading a message never removes
 * a row; only the Task's transition or expiry does.
 *
 * **Rows** render through {@link AgentOS.view.fleet.mailbox.Grid} — the buffered
 * `grid.Container` with one pooled {@link AgentOS.view.fleet.mailbox.RowComponent} per rendered
 * row (the row spec is the mailbox sketch, `design/institution-mailbox-pane.html`). The grid
 * owns thread collapse and its delegated toggle; this pane keeps the states, the admission gate
 * and the snapshot projection.
 * No paging chrome exists anywhere on the surface (operator direction 2026-08-28): the window
 * scrolls, and its honest end is the only end. Pane-grain freshness reuses the S1 `agentFreshness`
 * closed vocabulary (fresh / stale / lost / `unobserved` as the fail-closed degrade tier) against
 * the snapshot's `capability.capturedAt` (in the open view, its read's `capturedAt`), so the cockpit speaks
 * ONE freshness language.
 *
 * The pane owns its {@link AgentOS.store.AgentMailbox} instance (created with the pane, destroyed
 * with it) — a leaf list owns a local store; no per-view `state.Provider`. The hosting wiring
 * injects adapter snapshots via the reactive `snapshot_` config; the pane renders, never fetches.
 *
 * @class AgentOS.view.fleet.mailbox.Container
 * @extends Neo.container.Base
 */
class MailboxPane extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.Container',
        /**
         * @member {String} ntype='fm-mailbox-pane'
         * @protected
         */
        ntype: 'fm-mailbox-pane',
        /**
         * @member {String[]} baseCls=['fm-mailbox-pane']
         */
        baseCls: ['fm-mailbox-pane'],
        /**
         * The drilled-in resident record (or plain field bag) — only `agentId` is read, to label
         * the denial / empty states with the subject. `null` = no agent drilled in.
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * One Fleet mailbox-mirror adapter snapshot (`readFleetMailboxMirror` output):
         * `{capability, admission, rows, page}`. `null` = the honest `unobserved` state — the
         * pane NEVER fabricates rows while unwired.
         * @member {Object|null} snapshot_=null
         * @reactive
         */
        snapshot_: null,
        /**
         * Injected wall-clock (ms) for freshness classification; `null` → live `Date.now()`.
         * @member {Number|null} now_=null
         * @reactive
         */
        now_: null,
        /**
         * Which entry the open message's detail renders ({@link AgentOS.view.fleet.mailbox.DetailContainer#entry}):
         * `observer` is read-only; the host that owns its inbox sets `own`.
         * @member {'own'|'observer'} detailEntry_='observer'
         * @reactive
         */
        detailEntry_: 'observer',
        /**
         * The owner's body read of the open message, passed to the detail. Owner-written, never fetched here.
         * @member {Object|null} messageRead_=null
         * @reactive
         */
        messageRead_: null,
        /**
         * The owner's settled action on the open message, passed to the detail. Owner-written.
         * @member {Object|null} actionOutcome_=null
         * @reactive
         */
        actionOutcome_: null,
        /**
         * Which list the pane shows: `all` mail from the mirror `snapshot`, or the viewer's `open` questions from
         * the owner-written `questions` read. Only a host that owns its inbox switches it.
         * @member {'all'|'open'} view_='all'
         * @reactive
         */
        view_: 'all',
        /**
         * The owner's open-questions read (`fleetOwnQuestions`): `{state, reason, count, rows, page, capturedAt}`.
         * `null` = not read yet. Owner-written, never fetched here.
         * @member {Object|null} questions_=null
         * @reactive
         */
        questions_: null,
        /**
         * The mailbox mirror's honest live cadence (ms) — the freshness window the snapshot's
         * `capturedAt` is judged against. Tunable, not contractual.
         * @member {Number} freshnessTtl=60000
         */
        freshnessTtl: 60_000,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The pane head (title + freshness chip) over the state line and the buffered rows grid.
         * @member {Object[]} items
         */
        items: [{
            // the head is also the host's slot: a host adds its own affordance here by reference
            // (the operator host adds compose), after the title and the freshness chip
            ntype    : 'container',
            cls      : ['fm-pane-head'],
            flex     : 'none',
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'mailbox-head',

            items: [{
                ntype    : 'component',
                cls      : ['fm-pane-title'],
                text     : 'A2A Mailbox',
                reference: 'mailbox-title'
            }, {
                ntype    : 'component',
                flex     : 'none',
                reference: 'mailbox-freshness'
            }]
        }, {
            // the honest-state line (unobserved / denied / degraded / empty); hidden in rows mode
            ntype    : 'component',
            cls      : ['fm-mailbox-state'],
            reference: 'mailbox-state'
        }, {
            // the open questions' continuation once the pane's own asks stopped short of the read's end
            module   : Button,
            cls      : ['fm-mailbox-read-on'],
            flex     : 'none',
            hidden   : true,
            reference: 'mailbox-read-on',
            text     : 'read on',
            ui       : 'ghost'
        }, {
            // the list beside the open message: two shares and one, the engine's Splitter between
            ntype    : 'container',
            cls      : ['fm-mailbox-body'],
            flex     : 1,
            hidden   : true,
            layout   : {ntype: 'hbox', align: 'stretch'},
            reference: 'mailbox-body',
            items    : [{
                // the rows body IS the buffered grid: one pooled RowComponent per rendered
                // row, thread collapse delegated inside the grid itself — this pane keeps the honest
                // states, the admission gate and the snapshot projection, and hands the grid its store
                module   : MailboxGrid,
                flex     : 2,
                hidden   : true,
                reference: 'mailbox-rows'
            }, {
                module      : Splitter,
                cls         : ['fm-mailbox-splitter'],
                hidden      : true,
                reference   : 'mailbox-splitter',
                resizeTarget: 'previous'
            }, {
                module   : DetailContainer,
                flex     : 1,
                hidden   : true,
                reference: 'mailbox-detail'
            }]
        }]
    }

    /**
     * The pane-owned row store — created with the pane, destroyed with it (see class summary).
     * @member {AgentOS.store.AgentMailbox|null} store=null
     */
    store = null
    /**
     * The open questions' windows landed in a row without a row to show: the bound of the pane's own asks
     * ({@link EMPTY_WINDOWS}). A window that brings a row starts it over, and so does a switch of list.
     * @member {Number} emptyWindows=0
     * @protected
     */
    emptyWindows = 0
    /**
     * The offset of the window this pane has requested and not yet received, `null` otherwise —
     * the one-request-in-flight gate of {@link #onScrollEdge} and of the open questions' own ask. Cleared by every
     * landed snapshot ({@link #afterSetSnapshot}), whatever its offset.
     * @member {Number|null} pendingOffset=null
     * @protected
     */
    pendingOffset = null
    /**
     * The last projected window's identity (`[offset, rows]` fingerprint) — the explicit
     * identical-poll gate: a refresh carrying the same rows skips the projection, so view-owned
     * display state (an expanded thread) survives it.
     * @member {String|null} projectedFingerprint=null
     * @protected
     */
    projectedFingerprint = null
    /**
     * The list whose rows the grid holds (`all` | `open`), `null` while it holds none.
     * @member {String|null} projectedView=null
     * @protected
     */
    projectedView = null
    /**
     * The open message's id: the grid's selection, kept here so the detail follows the message
     * across re-projections and closes when a refresh no longer lists it.
     * @member {String|null} selectedMessageId=null
     * @protected
     */
    selectedMessageId = null

    /**
     * @summary Create the pane-owned store, then render the initial (honest) state.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        let me       = this,
            rowsGrid = me.getReference('mailbox-rows');

        me.store = Neo.create(AgentMailboxStore, {sorters: AgentMailboxStore.sortersOf(me.view)});

        // the grid renders what this pane projects: injected store (autoDestroyStore: false on the
        // grid — this pane stays the owner), refresh driven by applySnapshot() per projection
        rowsGrid.store = me.store;

        // the next window is asked for when the operator reaches the loaded end, never before
        rowsGrid.on('scrollEdge', me.onScrollEdge, me);
        me.getReference('mailbox-read-on').set({handler: 'onReadOnClick', handlerScope: me});
        rowsGrid.on({deselect: me.onRowDeselect, select: me.onRowSelect, scope: me});

        // the detail's intents leave through this pane (fire stamps the pane as their source); its host
        // relays them to the owner
        me.getReference('mailbox-detail').on({
            markReadRequest: data => me.fire('markReadRequest', {...data}),
            replyRequest   : data => me.fire('replyRequest',    {...data}),
            resolveRequest : data => me.fire('resolveRequest',  {...data})
        });

        me.applySnapshot()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetActionOutcome(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetDetailEntry(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetMessageRead(value, oldValue) {
        this.isConstructed && this.applyDetail()
    }

    /**
     * Triggered after the owner's open-questions read landed: it answers the window request in flight.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetQuestions(value, oldValue) {
        this.pendingOffset = null;
        this.isConstructed && this.applySnapshot()
    }

    /**
     * Triggered after the list switched: the other list's window request no longer applies.
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetView(value, oldValue) {
        this.emptyWindows  = 0;
        this.pendingOffset = null;
        // the open questions keep their read's order (priority, then age); all mail reads newest first
        this.store && (this.store.sorters = AgentMailboxStore.sortersOf(value));
        this.isConstructed && this.applySnapshot()
    }

    /**
     * @summary The answer the list in view renders: the open-questions read, or the mirror snapshot.
     * @returns {Object|null}
     */
    get listSource() {
        return this.view === 'open' ? this.questions : this.snapshot
    }

    /**
     * @summary A row was selected: its detail opens, and the host is asked for the body. A retracted
     * message has none to ask for.
     * @param {Object} data `{record}`
     * @protected
     */
    onRowSelect({record}) {
        const me = this;

        me.selectedMessageId = record.messageId;
        me.applyDetail();

        record.status === 'retracted' || me.fire('messageOpen', {messageId: record.messageId})
    }

    /**
     * @summary The selected row was deselected (clicked again): the detail closes.
     * @param {Object} data `{record}`
     * @protected
     */
    onRowDeselect({record}) {
        if (record?.messageId === this.selectedMessageId) {
            this.selectedMessageId = null;
            this.applyDetail()
        }
    }

    /**
     * @summary Hand the detail the open message as the store holds it now, or close it when nothing is
     * open or the pane shows no rows.
     * @protected
     */
    applyDetail() {
        const
            me     = this,
            detail = me.getReference('mailbox-detail'),
            record = me.getPaneState() === 'rows' && me.selectedMessageId ? me.store.get(me.selectedMessageId) : null;

        me.getReference('mailbox-splitter').hidden = !record;

        detail.set({
            entry         : me.detailEntry,
            hidden        : !record,
            outcome       : me.actionOutcome,
            read          : me.messageRead,
            row           : record ? me.rowOf(record) : null,
            // the open view's read carries no admission block; its viewer is the owner's bound identity
            viewerIdentity: me.snapshot?.admission?.viewerIdentity ?? me.record?.githubUsername ?? null
        })
    }

    /**
     * @summary The plain row the detail renders, from a store record.
     * @param {Object} record
     * @returns {Object}
     * @protected
     */
    rowOf(record) {
        const {from, messageId, priority, relatedTickets, sentAt, status, subject, taskState} = record;

        return {from, messageId, priority, relatedTickets, sentAt, status, subject, taskState}
    }

    /**
     * @summary Destroy the pane-owned store with the pane.
     * @param {...*} args
     */
    destroy(...args) {
        this.store?.destroy();
        this.store = null;

        super.destroy(...args)
    }

    /**
     * Triggered after the snapshot config changed — a new adapter read projects (the first window
     * replaces wholesale; a follow-up window appends), and clears the window request in flight.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetSnapshot(value, oldValue) {
        // whatever landed answers the request in flight; the edge decides whether to ask again
        this.pendingOffset = null;
        this.isConstructed && this.applySnapshot()
    }

    /**
     * Triggered after the record config changed — the subject label on the honest states follows
     * the drilled-in resident.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        this.isConstructed && this.applySnapshot()
    }

    /**
     * Triggered after the injected clock changed — freshness is time-relative.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     * @protected
     */
    afterSetNow(value, oldValue) {
        this.isConstructed && this.applySnapshot()
    }

    /**
     * @summary Classify the snapshot into the pane's honest state.
     *
     * The unrecognized-envelope guard fails CLOSED to `unobserved`. A snapshot the pane cannot
     * recognize — `{}`, a torn payload, a future producer shape — has no `rows`, so a bare
     * length check would render "No active messages for @x": a confident, honest-LOOKING empty
     * inbox fabricated out of a payload we never understood. `empty` is a claim about the
     * subject's mail and may only be made when the producer actually said so.
     * @returns {String} 'unobserved' | 'denied' | 'degraded' | 'empty' | 'rows'
     * @protected
     */
    getPaneState() {
        const snapshot = this.snapshot;

        if (this.view === 'open') return this.getQuestionsState();

        if (!snapshot) return 'unobserved';

        // The producer's envelope is `{capability, admission, rows, page}`. A payload missing ANY of
        // them is not a mailbox — it is something else that happens to have a rows array, and
        // reading rows/empty/page out of it fabricates a claim about this agent's mail from a
        // shape we never understood. Checked BEFORE denied/degraded so a torn payload cannot
        // borrow their authority either.
        if (!isRecognizedMirrorEnvelope(snapshot)) return 'unobserved';

        const named = typeof snapshot.admission.subjectAgentId === 'string'
            && snapshot.admission.subjectAgentId.trim().length > 0;

        // A snapshot that NAMES a subject must name THIS one. Anything else is about someone else,
        // and no state inside it may borrow this resident's pane to say it.
        if (named && !this.isSnapshotForThisSubject()) return 'unobserved';

        // A denial names the subject in its own sentence ("X holds no grant for Y's inbox"), so an
        // unattributed denial cannot be rendered — it would put a name in that sentence that the
        // producer never admitted.
        if (snapshot.admission.state === 'denied') return named ? 'denied' : 'unobserved';

        // A degrade claims nothing about anyone's MAIL — it reports on the READ. The adapter's own
        // refusals (unbound identity, viewer mismatch, inadmissible subject) legitimately resolve NO
        // subject, so gating them on one would swallow the honest reason and leave the operator with
        // a silent pane. This is the one state that may speak without an admitted subject.
        if (snapshot.capability.state === 'degraded') return 'degraded';

        // `rows` and `empty` are claims about THIS resident's mail, and BOTH require the producer to
        // have actually said so. Presence of the four members is not permission to read them: a
        // `wired` capability beside an `unavailable` admission is a read that never happened, and its
        // zero rows are "we could not look" — rendering that as "No active messages for @x" states
        // the outcome of a read nobody performed. Only `granted` over `wired` is a mail claim; the
        // subject must be verified; and the page window must be real numbers, since the bounds are
        // rendered as fact beside those rows.
        if (!named)                                   return 'unobserved';
        if (snapshot.capability.state !== 'wired')    return 'unobserved';
        if (snapshot.admission.state  !== 'granted')  return 'unobserved';
        if (!isRecognizedPage(snapshot.page))         return 'unobserved';

        if (snapshot.rows.length === 0) return 'empty';

        return 'rows'
    }

    /**
     * @summary Classify the open-questions read: not read yet or unrecognized → `unobserved`, `unavailable` →
     * `degraded` (its reason, never an empty list), and a complete `ok` read by its count → `empty` for a complete
     * zero, otherwise `rows`: a page can show none of the questions the count holds.
     * @returns {String} 'unobserved' | 'degraded' | 'empty' | 'rows'
     * @protected
     */
    getQuestionsState() {
        const answer = this.questions;

        if (!isRecognizedQuestionsAnswer(answer)) return 'unobserved';
        if (answer.state === 'unavailable')       return 'degraded';
        if (!isRecognizedPage(answer.page) || !Number.isSafeInteger(answer.count)) return 'unobserved';

        return answer.count === 0 ? 'empty' : 'rows'
    }

    /**
     * @summary Does the snapshot's admitted subject match the resident this pane is showing?
     *
     * The possession guard clears the snapshot on re-seat and the read is generation-latched, but
     * both protect the SEQUENCE. Neither reads the envelope: a `granted` snapshot for Vega assigned
     * onto Ada's pane renders Vega's mail under Ada's name with every guard satisfied, because the
     * record was already correct when it landed. The envelope has to be asked who it is about.
     *
     * The comparison is against `githubUsername` — the resident's mailbox identity authority — never
     * `agentId`, which is the Fleet registry key (`vega` vs the subject `@neo-opus-vega`) and for
     * custom / multi-instance residents need not correspond at all. Canonicalization is a single
     * `@` prefix, matching the graph's node-id form the adapter already returns.
     *
     * Fails CLOSED on every unknown: no record, no identity authority, or no admitted subject means
     * the pane cannot prove the mail is this resident's — and unprovable ownership renders nothing.
     * @returns {Boolean}
     * @protected
     */
    isSnapshotForThisSubject() {
        const
            username = this.record?.githubUsername,
            subject  = this.snapshot?.admission?.subjectAgentId;

        if (typeof username !== 'string' || !username.trim()) return false;
        if (typeof subject  !== 'string' || !subject.trim())  return false;

        const canonical = username.trim().startsWith('@') ? username.trim() : `@${username.trim()}`;

        return subject.trim() === canonical
    }

    /**
     * @summary Render the snapshot honestly: the freshness chip, the page bounds, and either the
     * named state line or the rows body — never both, never a fabricated success.
     * @protected
     */
    applySnapshot() {
        let me           = this,
            source       = me.listSource,
            state        = me.getPaneState(),
            rows         = state === 'rows',
            stateCmp     = me.getReference('mailbox-state'),
            rowsGrid     = me.getReference('mailbox-rows'),
            now          = me.now ?? Date.now(),
            // one chip for both lists: each read's own capture time is its age
            observedAt   = me.view === 'open' ? source?.capturedAt : source?.capability?.capturedAt,
            ledger       = source ? {freshnessTtl: me.freshnessTtl, observedAt} : null,
            {cls, label} = AgentFreshness.describePaneFreshness(AgentFreshness.classifyPaneFreshness(ledger, now));

        me.getReference('mailbox-freshness').set({cls, text: label});

        // Projection: the FIRST window replaces wholesale; a follow-up window (offset > 0) extends
        // the held corpus — the accumulation half of the no-paging contract (the buffered surface
        // owns the whole corpus; the old offset chrome moved windows, the scroll edge fetches
        // them, see onScrollEdge). An identical-rows poll (only capture time advanced) skips the projection
        // entirely, so the operator's expansion state survives a refresh with nothing new — the
        // gate is explicit and pane-owned. Both branches ride the grid's ONE data path
        // (`applyBags`): fresh windows arrive collapsed, an extension re-projects the held rows
        // (their live `threadCollapsed` state included) plus the new window in one set.
        // A window extends only the list it belongs to: after a switch, a held follow-up window replaces the
        // other list's rows until the first window of its own lands.
        const fingerprint = rows ? JSON.stringify([me.view, source.page?.offset ?? 0, source.rows]) : null;

        if (fingerprint !== me.projectedFingerprint) {
            const
                extend    = rows && source.page?.offset > 0 && me.projectedView === me.view,
                // a thread never hides an open question: the open view lists each one on its own row
                projected = rows ? source.rows.map(row => me.view === 'open' ? {...row, partOfThread: null, threadCollapsed: false} : {...row, threadCollapsed: true}) : [];

            rowsGrid.applyBags(extend ? rowsGrid.extractBags().concat(projected) : projected, {continuation: extend});
            me.projectedFingerprint = fingerprint;
            me.projectedView        = rows ? me.view : null;
            me.emptyWindows         = rows && !projected.length ? me.emptyWindows + 1 : 0
        }

        // The next window is the operator's to reach ({@link #onScrollEdge}); this pass once asked for it while
        // `page.hasMore` held, and a boot walked the whole inbox, 173 pages in three minutes. One window is the
        // exception: open questions that showed no row answered no gesture, and the edge cannot ask again while the
        // visible rows stay the same, so the pane asks itself, {@link EMPTY_WINDOWS} in a row at most, past a run of
        // rows the graph cannot project.
        if (me.view === 'open' && rows && !source.rows.length && source.page.hasMore && me.pendingOffset === null && me.emptyWindows <= EMPTY_WINDOWS) {
            me.pendingOffset = source.page.offset + source.page.limit;
            me.fire('pageRequest', {offset: me.pendingOffset, source: me})
        }

        // a count the grid shows none of says so, never "nothing waits"; where the pane's own asks stopped short of the
        // read's end, the line says what the read showed and `read on` continues from the served cursor
        const
            shown   = rows && me.store.getCount() > 0,
            stopped = me.view === 'open' && rows && !source.rows.length && source.page.hasMore && me.pendingOffset === null,
            line    = stopped ? (shown ? 'more' : 'stopped') : shown ? null : !rows ? state : me.pendingOffset === null ? 'unshown' : 'unobserved';

        stateCmp.set({cls: ['fm-mailbox-state', `is-${line ?? state}`], hidden: !line, text: line ? me.getStateText(line) : ''});
        me.getReference('mailbox-read-on').hidden = !stopped;

        // the body leaves the layout with its rows, so a state line keeps the room it had alone
        me.getReference('mailbox-body').hidden = !shown;
        rowsGrid.hidden = !shown;

        // The pane owns the message key; the grid selects the fresh record each projection creates.
        if (me.selectedMessageId) {
            const record = me.store.get(me.selectedMessageId),
                  model  = rowsGrid.view.rowSelectionModel;

            if (record) {
                const id = rowsGrid.view.getRecordId(record);

                model.isSelectedRow(id) || model.selectRow(id)
            } else {
                model.deselectAllRows();
                me.selectedMessageId = null
            }
        }

        me.applyDetail()
    }

    /**
     * @summary The operator reads on past the windows the pane's own asks could not show: the next window from the
     * served cursor, and a new run of {@link EMPTY_WINDOWS} asks behind it.
     * @protected
     */
    onReadOnClick() {
        const me = this, page = me.listSource?.page;

        if (page?.hasMore && me.pendingOffset === null) {
            me.emptyWindows  = 0;
            me.pendingOffset = page.offset + page.limit;
            me.fire('pageRequest', {offset: me.pendingOffset, source: me});
            me.applySnapshot()
        }
    }

    /**
     * @summary The grid reached the loaded end: ask for the next window, once. The gate is the last
     * landed snapshot's `page.hasMore` (the honest end asks for nothing) and {@link #pendingOffset}
     * (one request in flight; a second edge announcement while it is out fires nothing). The body
     * re-announces only when the VISIBLE count changes, so a landed window that still leaves the
     * viewport at the edge asks again, and a viewport parked at the edge does not.
     *
     * Continuation is deliberate. A landed window the collapse filter hides entirely (replies under
     * a collapsed head) reveals no row, so it ends that gesture's reach: the head's "+N earlier"
     * count carries the mail that arrived, and expanding the thread — the pane's own toggle — is how
     * the operator continues into it; the rows then scroll, and the edge asks for the next window
     * as usual. Asking again on the hidden total instead would walk a collapsed inbox window by
     * window with no gesture, the boot drain this pane no longer performs.
     * @param {Object} data The grid's `scrollEdge` payload (`{startIndex, endIndex, count}`).
     * @protected
     */
    onScrollEdge(data) {
        let me   = this,
            page = me.listSource?.page;

        if (me.getPaneState() !== 'rows' || !page?.hasMore || me.pendingOffset !== null) {
            return
        }

        me.pendingOffset = page.offset + page.limit;
        me.fire('pageRequest', {offset: me.pendingOffset, source: me})
    }

    /**
     * @summary The honest-state line, named per state — the denial carries viewer + subject (an
     * auditable sentence, never a bare "no messages"), the degrade carries the adapter's reason.
     *
     * The degrade line deliberately does NOT name a cause. `capability.state: 'degraded'` covers
     * both a genuine source outage AND the adapter's own fail-closed refusals (an unbound request
     * identity, an asserted viewer that does not match the binding, an inadmissible namespace
     * subject) — all of which arrive as `admission.state: 'unavailable'`. Saying "source degraded"
     * would blame Memory Core for a refusal the adapter made, so the line states only what this
     * view actually knows — no rows, and the reason verbatim from the owner.
     * @param {String} state From {@link #getPaneState} (never 'rows' here), `unshown` (open questions counted that no
     *     window could show), or `stopped` / `more` (the pane's own asks stopped short of the read's end, with no row
     *     or with rows in view).
     * @returns {String}
     * @protected
     */
    getStateText(state) {
        const
            snapshot = this.snapshot,
            subject  = snapshot?.admission?.subjectAgentId || this.record?.agentId || 'this agent';

        if (this.view === 'open') {
            switch (state) {
                case 'degraded':
                    return `your questions could not be read · ${this.questions.reason || 'source unavailable'}`;
                case 'empty':
                    return 'nothing waits for your word';
                case 'unshown':
                    return `${this.questions.count.toLocaleString('en-US')} open · none can be shown here`;
                case 'stopped':
                    return `${this.questions.count.toLocaleString('en-US')} open · the ones read so far cannot be shown`;
                case 'more':
                    return `${this.questions.count.toLocaleString('en-US')} open · more follow`;
                default:
                    return 'your open questions have not been read'
            }
        }

        switch (state) {
            case 'denied':
                return `Access denied: ${snapshot.admission.viewerIdentity || 'the viewer'} holds no read grant for ${subject}'s inbox`;
            case 'degraded':
                return `Mailbox unavailable: ${snapshot.capability?.reason || 'source unavailable'}`;
            case 'empty':
                return `No active messages for ${subject}`;
            default:
                return 'Mailbox feed not wired'
        }
    }

}

export default Neo.setupClass(MailboxPane);
