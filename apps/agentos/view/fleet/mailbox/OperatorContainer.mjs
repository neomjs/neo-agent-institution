import Button              from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container           from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import MailboxPane         from './Container.mjs';
import OperatorComposeForm from './ComposeForm.mjs';

/**
 * The FM cockpit's **operator mailbox** — the operator's own inbox over the compose surface: the
 * read half the operator asked to steer THROUGH, plus the write half that replaces prompt-only
 * steering.
 *
 * @summary Composes the shipped {@link AgentOS.view.fleet.mailbox.Container} (pointed at the operator's
 * own identity) above {@link AgentOS.view.fleet.mailbox.ComposeForm}, and RELAYS both surfaces'
 * intents up to the cockpit — it performs no transport itself.
 *
 * **Why a relay, not a doer.** The intents the OWNER services live against the authenticated seam:
 * this surface fires `inboxPageRequest` itself (construction / identity bind — the cockpit reads
 * the operator mirror; the paging chrome retired with the buffered grid, so the offset is always
 * 0), and the compose form fires `compose` (the cockpit maps it onto the compose verb). This
 * surface holds neither the read seam nor the verb — identity stays a transport fact end-to-end,
 * never authored here.
 *
 * **The own-inbox entry.** The pane is read-only by its own MUST-NOT (operator mark-read would
 * mutate an agent's turn-start signal). The operator's OWN inbox is the one place a write is
 * legitimate, keyed by the server-stamped viewer, so this host declares `detailEntry: 'own'`: a
 * selected message opens to its full body with `Mark read` · `Reply` · `Resolve`. Mark read
 * and Resolve relay to the owner as `markReadRequest` / `resolveRequest`; Reply opens the compose
 * reveal for the sender, the subject and `inReplyTo`. A reply never resolves.
 *
 * The container owns no `state.Provider` (the cockpit scopes it) — `record` / `snapshot` /
 * `recipientOptions` are injected by the cockpit from state it already holds, and passed straight
 * through to the children, so this surface never reaches for a service.
 *
 * **Compose is a reveal.** The inbox pane's head carries the `✎ compose` affordance (the mailbox
 * design page's "Compose placement": an affordance-class chip, right-pinned, reachable without
 * scroll); the form is out of the layout until the chip opens it, so the operator's own rows get
 * the strip. Open, the inbox keeps one designed row of context and the form scrolls internally in
 * what is left (the floor lives in the skin). A send keeps the form open with its outcome rows; the
 * chip, or Escape inside the form, closes it. The page's open slot — inline reveal or an own south
 * tab — stays open: if compose becomes a tab, the chip routes there and the rows do not move.
 *
 * **What waits for your word.** Beside compose, two chips switch the list: `all mail`, or `for you · 3 open`,
 * the operator's open questions. The count is Home's own (the provider's `questions` block), so a number shows
 * only when that read produced one; unavailable, the chip reads `for you · open` with the reason on its title.
 * The switch is session view state, never persisted, and every switch reads the first window of its list.
 *
 * @class AgentOS.view.fleet.mailbox.OperatorContainer
 * @extends Neo.container.Base
 */
class OperatorMailbox extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.OperatorContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.OperatorContainer',
        /**
         * @member {String} ntype='fm-operator-mailbox'
         * @protected
         */
        ntype: 'fm-operator-mailbox',
        /**
         * @member {String[]} baseCls=['fm-operator-mailbox','fm-pane']
         */
        baseCls: ['fm-operator-mailbox', 'fm-pane'],
        /**
         * The operator identity record (only `githubUsername` is read — the pane's subject-match
         * authority); injected by the cockpit. `null` = the inbox's honest unwired state.
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * One Fleet mailbox-mirror snapshot for the OPERATOR's own inbox (server-read via the
         * authenticated viewer identity); `null` = `unobserved`. Passed straight to the inbox pane.
         * @member {Object|null} snapshot_=null
         * @reactive
         */
        snapshot_: null,
        /**
         * Recipient picker options (`{id, name}`), injected by the cockpit from its live roster and
         * passed straight to the compose form.
         * @member {Object[]} recipientOptions_=[]
         * @reactive
         */
        recipientOptions_: [],
        /**
         * The compose send outcome, set by the cockpit once the compose verb settles and passed straight
         * to the compose form to render (per-recipient sent / not-wired / rejected / error). `null` = idle.
         * This surface holds no transport — the outcome is owner-written state, never read here.
         * @member {Object|null} composeOutcome_=null
         * @reactive
         */
        composeOutcome_: null,
        /**
         * The owner's body read of the open message (`{messageId, state, message?, code?, reason?}`),
         * passed straight to the inbox pane's detail.
         * @member {Object|null} messageRead_=null
         * @reactive
         */
        messageRead_: null,
        /**
         * The owner's settled Mark read / Resolve on the open message (`{messageId, action, state,
         * code?, reason?}`), passed straight to the inbox pane's detail.
         * @member {Object|null} actionOutcome_=null
         * @reactive
         */
        actionOutcome_: null,
        /**
         * Whether the compose form is revealed. `false` keeps it out of the layout; the head's
         * `✎ compose` chip toggles it, Escape inside the form closes it, a send never does.
         * @member {Boolean} composeOpen_=false
         * @reactive
         */
        composeOpen_: false,
        /**
         * The operator-seat identity posture (`{conflated, seatIdentity}` | `null`), injected by the
         * cockpit from its resolved viewer identity vs the roster. A conflated posture renders the
         * truth marker directly above the compose surface: sends through this transport are
         * attributed to an AGENT seat, and the operator must see that BEFORE writing — the marker
         * changes honesty, never authority (the form stays senderless either way). `null` and
         * `{conflated: false}` both render nothing: unknown is not a warning, and a clean posture
         * needs no chrome.
         * @member {Object|null} identityPosture_=null
         * @reactive
         */
        identityPosture_: null,
        /**
         * Which list the inbox shows, passed straight to the pane: `all` mail, or the operator's `open`
         * questions. Set by the head's chips, and by a navigation that opens the questions (Home's count).
         * @member {'all'|'open'} view_='all'
         * @reactive
         */
        view_: 'all',
        /**
         * The owner's open-questions read (`fleetOwnQuestions`), passed straight to the pane.
         * @member {Object|null} questions_=null
         * @reactive
         */
        questions_: null,
        /**
         * The open-question count the chip shows, bound to the provider's `questions` block
         * `{count, reason, state}`, the one Home's line counts.
         * @member {Object|null} questionCount_=null
         * @reactive
         */
        questionCount_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            module     : MailboxPane,
            detailEntry: 'own',
            flex       : 1,
            header     : {text: 'Your inbox'},
            reference  : 'operator-inbox-pane'
        }, {
            // the seat-conflation truth marker — hidden until a conflated posture is injected;
            // placed directly above the compose surface so the fact sits where the writing starts
            ntype    : 'component',
            cls      : ['fm-operator-identity-warning'],
            flex     : 'none',
            hidden   : true,
            reference: 'operator-identity-warning',
            role     : 'alert'
        }, {
            // shrinkable, never 'none': in the height-bounded drawer slot the form's natural
            // height exceeds the well, and a rigid form starves the inbox above it to 0px —
            // the read half must survive the write half. The skin adds the internal scroll +
            // the inbox floor.
            module   : OperatorComposeForm,
            flex     : '0 1 auto',
            hidden   : true,
            reference: 'operator-compose-form'
        }]
    }

    /**
     * @summary Wire the two child intents up to the owner AND flush any projection-injected state to the
     * children. Wired explicitly (not via a string handler) — like AgentDetail, this surface carries no
     * controller for one to resolve against.
     *
     * The flush is load-bearing: `afterSetRecord`/`afterSetSnapshot`/`afterSetRecipientOptions` all return
     * early while `!isConstructed`, so `record`/`snapshot`/`recipientOptions` supplied as construction
     * configs (the identity-before-pane ordering, when the cockpit already holds the resolved operator
     * identity as the resident pane projects) never reached the children — the pane materialized empty
     * and could not pass possession. Flush them here, then a construction-time identity kicks its first
     * read exactly as a live set does; the opposite ordering (pane projects first) lands its single
     * first read through the cockpit's later live identity set instead.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const
            me    = this,
            inbox = me.getReference('operator-inbox-pane'),
            form  = me.getReference('operator-compose-form');

        // the pane's scroll-edge requests (the next window while `page.hasMore`) relay through the same
        // read intent the construction fire uses — one event, one cockpit handler, no chrome
        inbox?.on('pageRequest', me.onInboxPageRequest, me);
        // the open message's intents: the owner reads and writes, reply stays a compose reveal here
        inbox?.on({
            markReadRequest: data => me.fire('markReadRequest', {messageId: data.messageId}),
            messageOpen    : data => me.fire('messageOpen',     {messageId: data.messageId}),
            replyRequest   : me.onReplyRequest,
            resolveRequest : data => me.fire('resolveRequest',  {expectedCurrentState: data.expectedCurrentState, messageId: data.messageId}),
            scope          : me
        });
        form?.on('compose', me.onCompose, me);

        if (inbox) {
            me.record   && (inbox.record   = me.record);
            me.snapshot && (inbox.snapshot = me.snapshot);
            inbox.set({questions: me.questions, view: me.view})
        }
        form && me.recipientOptions?.length && (form.recipientOptions = me.recipientOptions);
        me.applyIdentityPosture();

        // the compose affordance lives in the inbox pane's head (the pane exposes the slot by
        // reference), inside the head's actions group so it speaks at the pane-head law's chip
        // scale; the form is a reveal behind it, and Escape inside the form closes it
        inbox?.getReference('mailbox-head')?.add({
            ntype : 'container',
            cls   : ['fm-pane-actions'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                module         : Button,
                cls            : ['fm-mailbox-view-chip'],
                handler        : 'onAllMailClick',
                handlerScope   : me,
                reference      : 'view-all',
                text           : 'all mail',
                useRippleEffect: false
            }, {
                module         : Button,
                cls            : ['fm-mailbox-view-chip'],
                handler        : 'onOpenQuestionsClick',
                handlerScope   : me,
                reference      : 'view-open',
                useRippleEffect: false
            }, {
                module         : Button,
                cls            : ['fm-compose-affordance'],
                handler        : 'onComposeToggle', // a string: the button resolves it against handlerScope
                handlerScope   : me,
                pressed        : me.composeOpen,
                reference      : 'compose-toggle',
                text           : '✎ compose',
                useRippleEffect: false // an affordance chip, not a filled button
            }]
        });
        form?.addDomListeners({keydown: me.onComposeKeyDown, scope: me});
        me.applyComposeOpen();
        me.applyViewChips();

        // a construction-time identity lands its first inbox read without a page gesture (afterSetRecord
        // was skipped pre-construct, so this is the single fire for the identity-before-pane ordering)
        me.record && me.onInboxPageRequest({offset: 0})
    }

    /**
     * Triggered after the compose reveal changed.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetComposeOpen(value, oldValue) {
        this.isConstructed && this.applyComposeOpen()
    }

    /**
     * @summary Render the reveal: the form's presence, the root's composing class (the skin's inbox
     * floor keys on it) and the chip's pressed state.
     * @protected
     */
    applyComposeOpen() {
        const
            me   = this,
            open = me.composeOpen === true,
            form = me.getReference('operator-compose-form'),
            chip = me.getReference('compose-toggle');

        form && (form.hidden = !open);
        // a folded form answers nothing: the next reveal starts as a new message
        form && !open && (form.inReplyTo = null);
        chip && (chip.pressed = open);
        me.toggleCls('is-composing', open)
    }

    /**
     * @summary The chip's handler: reveal or fold the compose form.
     * @protected
     */
    onComposeToggle() {
        this.composeOpen = !this.composeOpen
    }

    /**
     * @summary Escape inside the form folds it; every other key stays the form's.
     * @param {Object} data The keydown event data.
     * @protected
     */
    onComposeKeyDown(data) {
        data.key === 'Escape' && (this.composeOpen = false)
    }

    /**
     * Triggered after the identity posture changed — rendered by the marker, never held anywhere else.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetIdentityPosture(value, oldValue) {
        this.isConstructed && this.applyIdentityPosture()
    }

    /**
     * @summary Render the seat-conflation truth marker from the injected posture. Only a POSITIVE
     * conflation shows chrome; `null` (cannot judge) and a clean posture both stay silent — the
     * marker asserts a verified fact, never a suspicion.
     * @protected
     */
    applyIdentityPosture() {
        const
            marker    = this.getReference('operator-identity-warning'),
            conflated = this.identityPosture?.conflated === true;

        marker?.set({
            hidden: !conflated,
            text  : conflated
                ? `Sending as agent seat ${this.identityPosture.seatIdentity} — operator principal not established. Messages will carry that seat's identity.`
                : null
        })
    }

    /**
     * Triggered after the operator record changed — the inbox pane's subject follows it, and a newly-bound
     * identity kicks the first own-inbox read. The owner (cockpit) holds the read seam, so this fires the
     * `inboxPageRequest` relay rather than reading here: a pane materialized after boot — when the operator
     * identity is already resolved owner-side — lands its inbox without a page gesture, exactly as
     * {@link AgentOS.view.fleet.detail.Container} reads on its record.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        if (!this.isConstructed) return;

        this.getReference('operator-inbox-pane').record = value;
        // a real identity (null → record) triggers the first read; the owner services it against the mirror
        value && this.onInboxPageRequest({offset: 0})
    }

    /**
     * Triggered after the operator inbox snapshot changed — passed straight to the pane.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetSnapshot(value, oldValue) {
        this.isConstructed && (this.getReference('operator-inbox-pane').snapshot = value)
    }

    /**
     * Triggered after the recipient options changed — passed straight to the compose form.
     * @param {Object[]} value
     * @param {Object[]} oldValue
     * @protected
     */
    afterSetRecipientOptions(value, oldValue) {
        this.isConstructed && (this.getReference('operator-compose-form').recipientOptions = value)
    }

    /**
     * Triggered after the compose outcome changed — passed straight to the compose form, which renders the
     * per-recipient verdicts. Set by the cockpit once the compose verb settles (this surface holds no
     * transport; the outcome is owner-written state).
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetComposeOutcome(value, oldValue) {
        this.isConstructed && (this.getReference('operator-compose-form').composeOutcome = value)
    }

    /**
     * Triggered after the owner's settled action changed — passed straight to the pane's detail.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetActionOutcome(value, oldValue) {
        this.isConstructed && (this.getReference('operator-inbox-pane').actionOutcome = value)
    }

    /**
     * Triggered after the owner's body read changed — passed straight to the pane's detail.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetMessageRead(value, oldValue) {
        this.isConstructed && (this.getReference('operator-inbox-pane').messageRead = value)
    }

    /**
     * Triggered after the owner's open-questions read changed — passed straight to the pane.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetQuestions(value, oldValue) {
        this.isConstructed && (this.getReference('operator-inbox-pane').questions = value)
    }

    /**
     * Triggered after the provider's open-question count changed — the chip recounts.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetQuestionCount(value, oldValue) {
        this.isConstructed && this.applyViewChips()
    }

    /**
     * Triggered after the list switched: the pane shows it, and the owner reads its first window.
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetView(value, oldValue) {
        if (!this.isConstructed) return;

        this.getReference('operator-inbox-pane').view = value;
        this.applyViewChips();
        this.record && this.onInboxPageRequest({offset: 0})
    }

    /**
     * @summary Render the view chips: the pressed one is the list in view, and the questions chip counts only
     * what its read produced (`for you · 3 open`), plain `for you · open` with the reason on its title otherwise.
     * @protected
     */
    applyViewChips() {
        const
            me                     = this,
            {count, reason, state} = me.questionCount ?? {},
            counted                = state === 'ok' && Number.isInteger(count),
            open                   = me.getReference('view-open');

        me.getReference('view-all')?.set({pressed: me.view === 'all'});

        if (open) {
            open.set({pressed: me.view === 'open', text: counted ? `for you · ${count} open` : 'for you · open'});
            // the reason rides the native title, as on Home's line
            open.vdom.title = counted ? null : reason || null;
            open.update()
        }
    }

    /**
     * @summary Show the operator's open questions, read anew: the entry for a navigation (Home's question count).
     */
    showOpenQuestions() {
        if (this.view !== 'open') {
            this.view = 'open'
        } else if (this.record) {
            this.onInboxPageRequest({offset: 0})
        }
    }

    /**
     * @summary The `all mail` chip's handler.
     * @protected
     */
    onAllMailClick() {
        this.view = 'all'
    }

    /**
     * @summary The `for you · open` chip's handler.
     * @protected
     */
    onOpenQuestionsClick() {
        this.view = 'open'
    }

    /**
     * @summary Reply from the open message: the compose reveal opens for its sender, with its subject
     * and `inReplyTo`. The send is the operator's; replying never moves the message's Task.
     * @param {Object} data `{messageId, subject, to}`
     * @protected
     */
    onReplyRequest(data) {
        this.composeOpen = true;
        this.getReference('operator-compose-form').replyTo({inReplyTo: data.messageId, subject: data.subject, to: data.to})
    }

    /**
     * @summary Fire the inbox read intent to the owner — the cockpit holds the read seam and reads
     * the operator mirror at the requested offset. Two callers, one event: the construction /
     * identity-bind fire (offset 0) and the pane's scroll-edge request (the next window while
     * `page.hasMore` — one request per received snapshot, so row 51+ assembles without chrome).
     * The event name and payload shape stay stable for the cockpit's existing wiring.
     * @param {Object} data The read payload (`{offset}`).
     * @protected
     */
    onInboxPageRequest(data) {
        this.fire('inboxPageRequest', {...data, source: this})
    }

    /**
     * @summary Relay the compose intent to the owner — the cockpit maps it onto the compose verb.
     * @param {Object} data The form's `compose` payload (`{message, source}`).
     * @protected
     */
    onCompose(data) {
        this.fire('compose', {message: data.message, source: this})
    }
}

export default Neo.setupClass(OperatorMailbox);
