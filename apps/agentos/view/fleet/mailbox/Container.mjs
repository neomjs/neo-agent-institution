import AgentMailboxStore from '../../../store/AgentMailbox.mjs';
import Container         from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import MailboxGrid       from './Grid.mjs';
import AgentFreshness    from '../../../util/AgentFreshness.mjs';

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
 * The mailbox mirror pane — the S1 view half: a read-only, viewer-admitted mirror of ONE subject's
 * ACTIVE A2A inbox, rendered from one Fleet mailbox-mirror adapter snapshot. Subject-generic by
 * construction: today its one host is the south pane's {@link AgentOS.view.fleet.mailbox.OperatorContainer}
 * (the operator's own inbox); a selection-scoped per-agent subject mode re-enters through the same
 * host when the S5 Fleet grants/admission layer lands (viewer ingress is already live; the policy
 * ledger holds the mirror read at awaiting-s5).
 *
 * **Read-only is structural.** The pane renders zero mutation affordances — no mark-read, no
 * archive, no reply (the graduated record's MUST-NOT: operator-side mark-read would mutate the
 * agent's own turn-start signal and swallow peer handoffs). The single interaction is
 * thread-collapse toggling — pure display-state navigation on the view-owned `threadCollapsed`
 * record field, never a data write. The pane's host label stays COUNTLESS by design: an
 * unread-count badge would imply operator-side read tracking that deliberately does not exist
 * (the no-markRead MUST-NOT's quiet sibling); per-row `status` is the honest fact instead.
 *
 * **Four mutually exclusive honest states** (never a fake success):
 *  - `unobserved` — no snapshot injected yet: the feed is not wired; says so.
 *  - `denied` — the adapter's admission block reports the viewer holds no `CAN_READ_INBOX_OF`
 *    grant for the subject: a NAMED denial (viewer + subject), never an empty-success.
 *  - `degraded` — the source failed for a non-admission reason: the honest reason line.
 *  - `empty` — wired, admitted, zero active rows: an explicit empty state.
 *
 * **Rows** render through {@link AgentOS.view.fleet.mailbox.Grid} — the #24 law-0 buffered
 * `grid.Container` with one pooled {@link AgentOS.view.fleet.mailbox.RowComponent} per rendered
 * row (the merged #36/#38 sketch is the scored row spec). The grid owns thread collapse and its
 * delegated toggle; this pane keeps the states, the admission gate and the snapshot projection.
 * No paging chrome exists anywhere on the surface (operator direction 2026-08-28): the window
 * scrolls, and its honest end is the only end. Pane-grain freshness reuses the S1 `agentFreshness`
 * closed vocabulary (fresh / stale / lost / `unobserved` as the fail-closed degrade tier) against
 * the snapshot's `capability.capturedAt`, so the cockpit speaks ONE freshness language.
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
            ntype : 'container',
            cls   : ['fm-mailbox-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},

            items: [{
                ntype    : 'component',
                cls      : ['fm-mailbox-title'],
                flex     : 1,
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
            // the rows body IS the buffered grid (#24 law 0): one pooled RowComponent per rendered
            // row, thread collapse delegated inside the grid itself — this pane keeps the honest
            // states, the admission gate and the snapshot projection, and hands the grid its store
            module   : MailboxGrid,
            flex     : 1,
            hidden   : true,
            reference: 'mailbox-rows'
        }]
    }

    /**
     * The pane-owned row store — created with the pane, destroyed with it (see class summary).
     * @member {AgentOS.store.AgentMailbox|null} store=null
     */
    store = null
    /**
     * Armed by {@link #afterSetSnapshot} and consumed by ONE {@link #applySnapshot} run: the drain
     * request (the next window beyond `page.hasMore`) fires only for a freshly landed snapshot —
     * a freshness re-render (`now`) or a record swap re-projects without re-requesting.
     * @member {Boolean} drainArmed=false
     * @protected
     */
    drainArmed = false
    /**
     * The last projected window's identity (`[offset, rows]` fingerprint) — the explicit
     * identical-poll gate: a refresh carrying the same rows skips the projection, so view-owned
     * display state (an expanded thread) survives it.
     * @member {String|null} projectedFingerprint=null
     * @protected
     */
    projectedFingerprint = null

    /**
     * @summary Create the pane-owned store, then render the initial (honest) state.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        this.store = Neo.create(AgentMailboxStore);

        // the grid renders what this pane projects: injected store (autoDestroyStore: false on the
        // grid — this pane stays the owner), refresh driven by applySnapshot() per projection
        this.getReference('mailbox-rows').store = this.store;

        this.applySnapshot()
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
     * replaces wholesale; a follow-up window appends), and arms exactly one drain request.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetSnapshot(value, oldValue) {
        this.drainArmed = true;
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
            snapshot     = me.snapshot,
            state        = me.getPaneState(),
            rows         = state === 'rows',
            stateCmp     = me.getReference('mailbox-state'),
            rowsGrid     = me.getReference('mailbox-rows'),
            now          = me.now ?? Date.now(),
            ledger       = snapshot ? {freshnessTtl: me.freshnessTtl, observedAt: snapshot.capability?.capturedAt} : null,
            {cls, label} = AgentFreshness.describePaneFreshness(AgentFreshness.classifyPaneFreshness(ledger, now));

        me.getReference('mailbox-freshness').set({cls, text: label});

        stateCmp.set({
            cls   : ['fm-mailbox-state', `is-${state}`],
            hidden: rows,
            text  : rows ? '' : me.getStateText(state)
        });

        rowsGrid.hidden = !rows;

        // Projection: the FIRST window replaces wholesale; a follow-up window (offset > 0) extends
        // the held corpus — the accumulation half of the no-paging contract (the buffered surface
        // owns the whole corpus; the old offset chrome moved windows, the drain below fetches
        // them). An identical-rows poll (only capture time advanced) skips the projection
        // entirely, so the operator's expansion state survives a refresh with nothing new — the
        // gate is explicit and pane-owned. Both branches ride the grid's ONE data path
        // (`applyBags`): fresh windows arrive collapsed, an extension re-projects the held rows
        // (their live `threadCollapsed` state included) plus the new window in one set.
        const fingerprint = rows ? JSON.stringify([snapshot.page?.offset ?? 0, snapshot.rows]) : null;

        if (fingerprint !== me.projectedFingerprint) {
            const
                extend    = rows && snapshot.page?.offset > 0,
                projected = rows ? snapshot.rows.map(row => ({...row, threadCollapsed: true})) : [];

            rowsGrid.applyBags(extend ? rowsGrid.extractBags().concat(projected) : projected);
            me.projectedFingerprint = fingerprint
        }

        // The drain: while the producer says more exists beyond this window, request the next one —
        // exactly ONE request per received snapshot (sequential by construction, no in-flight
        // stacking), fired only when a NEW snapshot landed (afterSetSnapshot arms it) so freshness
        // re-renders and record swaps never re-request. Row 51+ stays reachable without any chrome:
        // the corpus assembles itself at the pane's own pace, and the honest end (hasMore: false)
        // is the only stop.
        if (rows && me.drainArmed && snapshot.page?.hasMore) {
            me.fire('pageRequest', {offset: snapshot.page.offset + snapshot.page.limit, source: me})
        }

        me.drainArmed = false
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
     * @param {String} state From {@link #getPaneState} (never 'rows' here).
     * @returns {String}
     * @protected
     */
    getStateText(state) {
        const
            snapshot = this.snapshot,
            subject  = snapshot?.admission?.subjectAgentId || this.record?.agentId || 'this agent';

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
