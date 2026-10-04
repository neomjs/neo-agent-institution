import AgentSessionSummaries from '../../../store/AgentSessionSummaries.mjs';
import AgentSessionTurns     from '../../../store/AgentSessionTurns.mjs';
import Button                from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container             from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import ReaderComponent       from './ReaderComponent.mjs';
import ReadingController     from './ReadingController.mjs';
import Splitter              from '../../../../../node_modules/neo.mjs/src/component/Splitter.mjs';
import SummaryGrid           from './SummaryGrid.mjs';
import TurnGrid              from './TurnGrid.mjs';
import ViewerTime            from '../../../util/ViewerTime.mjs';

/**
 * The invoked Fleet memories surface: what one agent has been doing, session by session.
 *
 * @summary Renders one viewer-bound `fleetMemories` source envelope of session summaries without
 * synthesizing, ranking, merging, or caching it. The pane owns two local projection Stores (the
 * summary corpus and the open drill session's turns) and hands each to its buffered grid register
 * ({@link AgentOS.view.fleet.memories.SummaryGrid} · {@link AgentOS.view.fleet.memories.TurnGrid});
 * it fires intent events for reads and the owning FleetCockpit holds the authenticated bridge.
 * Choosing whose memories to read is an explicit act — the pane never auto-defaults to a roster
 * agent.
 *
 * **No paging chrome** (operator direction 2026-08-28, as in the mailbox): the buffered grids
 * scroll, and continuation is deliberate — each register's grid relays the engine's `scrollEdge`
 * when the operator's window reaches the loaded end, and the pane then fires exactly ONE follow-up
 * read intent at the rendered depth while the producer's `total` says more corpus exists and no
 * window is in flight. A corpus shorter than one window is at its edge on first layout, so a short
 * corpus still assembles; the honest end is the only stop. Refresh stays: an explicit re-read
 * intent is not paging.
 *
 * Honest states are first-class: no-selection, switch-pending, unavailable (with the source's
 * reason), a genuinely-empty corpus (`total: 0`), per-card guarded non-string titles/summaries,
 * multi-agent session attribution — and the drill twin of each. The coherence contract survives
 * the grid conversion unchanged: the selected target is part of the rendered snapshot KEY (a
 * foreign-target envelope is never adopted), the open session is part of the rendered drill KEY,
 * and `page.offset > 0` continuations extend only an already-accepted page zero of the same key.
 *
 * **Reading is a selection**: the registers keep their clamped previews for scanning, and
 * the {@link AgentOS.view.fleet.memories.ReaderComponent} beside them renders the selected record
 * whole — a summary's full text, a turn's prompt, thought and response. Selecting collapses the
 * open register to its rail so the text gets the width; ↑/↓ move the selection, Escape closes the
 * reading, and *show all* reads every loaded record of the register in list order. Records arrive
 * whole on the wire, so reading fetches nothing. The pane renders the zones; its
 * {@link AgentOS.view.fleet.memories.ReadingController} decides what is read.
 *
 * @class AgentOS.view.fleet.memories.Container
 * @extends Neo.container.Base
 */
class MemoriesPane extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.Container',
        /**
         * @member {String} ntype='fm-memories-pane'
         * @protected
         */
        ntype: 'fm-memories-pane',
        /**
         * @member {String[]} baseCls=['fm-memories-pane','fm-pane']
         */
        baseCls: ['fm-memories-pane', 'fm-pane'],
        /**
         * Optional SHELL-supplied tool configs appended to the head's actions. The pane stays
         * layout-blind: it places these controls beside its own verbs and never inspects what
         * they do — ownership, handlers and state sync remain with the supplying shell.
         * @member {Object[]|null} shellTools=null
         */
        shellTools: null,
        /**
         * Selected target agent as canonical `@identity`, or null for the explicit
         * "pick an agent" state. Written through by the cockpit's ONE picker — the roster
         * selection (a card click / Enter) — so this pane renders no target chooser of its own;
         * the null state's sentence names the card click as the path.
         * @member {String|null} activeAgent_=null
         * @reactive
         */
        activeAgent_: null,
        /**
         * Latest memories envelope. `null` is unobserved, never empty.
         * @member {Object|null} snapshot_=null
         * @reactive
         */
        snapshot_: null,
        /**
         * The open drill-in target — `{sessionId, title}` while a summary card's session detail
         * is open, `null` for the summary-list view. Owner-passable, so a rematerialized pane
         * reopens exactly the depth the operator was reading.
         * @member {Object|null} drillSession_=null
         * @reactive
         */
        drillSession_: null,
        /**
         * Latest session-memories (drill-in) envelope. `null` is unobserved, never empty.
         * @member {Object|null} drillSnapshot_=null
         * @reactive
         */
        drillSnapshot_: null,
        /**
         * The reading orchestration: which record the reader shows and how the register makes room.
         * @member {AgentOS.view.fleet.memories.ReadingController} controller=ReadingController
         */
        controller: ReadingController,
        /**
         * Escape closes the reading (or leaves *show all*).
         * @member {Object} keys={Escape: 'onEscape'}
         */
        keys: {Escape: 'onEscape'},
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * *Show all*: the reading surface renders every loaded record of the open register, in
         * list order, instead of the one selected.
         * @member {Boolean} showAll_=false
         * @reactive
         */
        showAll_: false,
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-pane-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            items : [{
                ntype: 'component',
                cls  : ['fm-pane-title'],
                text : 'What they remember'
            }, {
                ntype: 'component',
                cls  : ['fm-pane-meta'],
                text : 'session summaries · query-time · not authority'
            }, {
                ntype    : 'container',
                cls      : ['fm-pane-actions'],
                layout   : {ntype: 'hbox', align: 'center'},
                reference: 'memories-actions',
                items    : [{
                    module   : Button,
                    reference: 'memories-show-all',
                    text     : 'Show all',
                    iconCls  : 'fa fa-align-left',
                    ui       : 'ghost',
                    hidden   : true,
                    handler  : 'onShowAllClick'
                }, {
                    module   : Button,
                    reference: 'memories-refresh',
                    text     : 'Refresh',
                    iconCls  : 'fa fa-rotate',
                    ui       : 'ghost',
                    hidden   : true,
                    handler  : 'up.onRefreshClick'
                }]
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-pane-meta', 'fm-memories-meta'],
            flex     : 'none',
            reference: 'memories-meta',
            text     : 'Memories not observed yet'
        }, {
            // the drill chrome: back (an INTENT, like the open) · session identity · the AUTHORED
            // provenance chip — these rows are the agent's own prompt/response trail, visually
            // distinct from the DERIVED summaries one register up
            ntype    : 'container',
            cls      : ['fm-memories-drill-head'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'hbox', align: 'center'},
            reference: 'memories-drill-head',
            items    : [{
                module : Button,
                cls    : ['fm-memories-drill-back'],
                iconCls: 'fa fa-arrow-left',
                text   : 'Summaries',
                ui     : 'ghost',
                handler: 'up.onDrillBackClick'
            }, {
                ntype    : 'component',
                cls      : ['fm-memories-drill-title'],
                flex     : 1,
                reference: 'memories-drill-title'
            }, {
                ntype: 'component',
                cls  : ['fm-memories-provenance', 'is-authored'],
                text : 'authored records'
            }]
        }, {
            // the list beside its reading surface: the rail/reading split is the engine's Splitter
            ntype    : 'container',
            cls      : ['fm-memories-body'],
            flex     : 1,
            layout   : {ntype: 'hbox', align: 'stretch'},
            reference: 'memories-body',
            items    : [{
                ntype    : 'container',
                cls      : ['fm-memories-list'],
                flex     : 2,
                layout   : {ntype: 'vbox', align: 'stretch'},
                reference: 'memories-list',
                items    : [{
                    // the ONE honest-state line for both registers — never rendered beside rows
                    ntype    : 'component',
                    cls      : ['fm-memories-empty'],
                    flex     : 'none',
                    reference: 'memories-state',
                    text     : 'Session summaries render here once an agent is chosen.'
                }, {
                    module   : SummaryGrid,
                    flex     : 1,
                    hidden   : true,
                    reference: 'memories-summary-grid'
                }, {
                    module   : TurnGrid,
                    flex     : 1,
                    hidden   : true,
                    reference: 'memories-turn-grid'
                }]
            }, {
                module      : Splitter,
                cls         : ['fm-memories-splitter'],
                hidden      : true,
                reference   : 'memories-splitter',
                resizeTarget: 'previous'
            }, {
                module   : ReaderComponent,
                flex     : 1,
                hidden   : true,
                reference: 'memories-reader'
            }]
        }]
    }

    /** @member {AgentOS.store.AgentSessionSummaries|null} summaryStore=null */
    summaryStore = null
    /**
     * The target whose cards the Store currently holds — the append guard: a `page.offset > 0`
     * continuation extends only when the envelope's target matches this.
     * @member {String|null} renderedTarget=null
     */
    renderedTarget = null
    /** @member {AgentOS.store.AgentSessionTurns|null} turnStore=null */
    turnStore = null
    /**
     * The session whose turn rows the drill Store currently holds — the drill append guard,
     * the {@link #renderedTarget} twin one level down.
     * @member {String|null} renderedDrillSession=null
     */
    renderedDrillSession = null
    /**
     * The offset of the summary window in flight — set when the register's edge requests it,
     * cleared when the next envelope lands or the target switches; `null` while nothing is pending.
     * @member {Number|null} pendingOffset=null
     */
    pendingOffset = null
    /**
     * The drill twin of {@link #pendingOffset}.
     * @member {Number|null} drillPendingOffset=null
     */
    drillPendingOffset = null

    /**
     * @summary Create the pane-local Stores, hand each to its grid register, and render held
     * owner state. No read fires here: choosing an agent is the explicit first act, so pane
     * construction never queries the plane on its own — a resident tab constructs at projection
     * time, before any operator intent.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        // shell-supplied window verbs land beside the pane's own actions (layout-blind slot)
        this.shellTools?.length && this.getReference('memories-actions')?.add(this.shellTools);

        const me = this;

        me.summaryStore = Neo.create(AgentSessionSummaries);
        me.turnStore    = Neo.create(AgentSessionTurns);

        // pane-owned stores flow INTO the injected grids (autoDestroyStore: false on the grid —
        // this pane stays the owner); the drill-open intent and each register's scroll edge flow
        // back out of the grids
        const
            summaryGrid = me.getReference('memories-summary-grid'),
            turnGrid    = me.getReference('memories-turn-grid');

        summaryGrid.store = me.summaryStore;
        summaryGrid.on('cardOpen',   me.onGridCardOpen,      me);
        summaryGrid.on('scrollEdge', me.onSummaryScrollEdge, me);
        turnGrid.store = me.turnStore;
        turnGrid.on('scrollEdge', me.onTurnScrollEdge, me);

        // Rematerialization coherence: a pane rebuilt from an owner-held snapshot must not render
        // cards for a target no selection points at — the selection is derived from the rendered
        // truth when the owner did not pass one explicitly.
        if (me.activeAgent === null && me.snapshot?.target) {
            me.activeAgent = me.snapshot.target
        }

        me.applySnapshot();

        // Drill rematerialization: an owner-passed open drill reopens at the depth the operator
        // was reading; its snapshot re-projects through the same coherence gate as a live push.
        me.drillSession && me.applyDrillSnapshot();

        // A cold projection carrying a target but no snapshot (the roster selection landed before
        // this pane materialized): request the corpus now — the create-time config write cannot
        // fire the reactive hook, and a pane that renders "Reading X…" forever is a hung claim.
        me.activeAgent && !me.snapshot && me.fire('memoriesRequest', {agentIdentity: me.activeAgent})
    }

    /** @param {...*} args */
    destroy(...args) {
        this.summaryStore?.destroy();
        this.summaryStore = null;
        this.turnStore?.destroy();
        this.turnStore = null;
        super.destroy(...args)
    }

    /** @param {String|null} value @param {String|null} oldValue @returns {String|null} */
    beforeSetActiveAgent(value, oldValue) {
        return value === null || /^@[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : oldValue ?? null
    }

    /**
     * @summary The target switched (the roster selection's write-through, or any other writer):
     * the selected target is part of the rendered snapshot KEY, so the old target's cards and
     * drain chain are invalidated IMMEDIATELY (switch-pending state) and the new corpus is
     * requested — no stale store depth can anchor an offset request, no old-target action
     * survives into the new selection. The pane owns this consequence regardless of who wrote
     * the config; the reactive hook's own equality gate keeps a same-target re-write inert.
     * @param {String|null} value
     * @param {String|null} oldValue
     */
    afterSetActiveAgent(value, oldValue) {
        const me = this;

        if (!me.isConstructed) {
            return
        }

        me.controller.clearReading('summary');
        me.getReference('memories-summary-grid').applyBags([]);
        me.renderedTarget = null;
        me.pendingOffset  = null;
        me.applySnapshot();
        value && me.fire('memoriesRequest', {agentIdentity: value})
    }

    /** @param {Boolean} value @param {Boolean} oldValue */
    afterSetShowAll(value, oldValue) {
        this.isConstructed && this.syncZones()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetSnapshot(value, oldValue) {
        this.pendingOffset = null;
        this.isConstructed && this.applySnapshot()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetDrillSession(value, oldValue) {
        this.isConstructed && this.applySnapshot()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetDrillSnapshot(value, oldValue) {
        this.drillPendingOffset = null;
        this.isConstructed && this.applyDrillSnapshot()
    }

    /** @summary Re-read the newest page for the selected agent. */
    onRefreshClick() {
        this.activeAgent && this.fire('memoriesRequest', {agentIdentity: this.activeAgent})
    }

    /**
     * @summary The summary grid's delegated drill-open intent (`cardOpen`) — unwrap the resolved
     * record and open its session.
     * @param {Object} data
     * @param {Neo.data.Model} data.record
     */
    onGridCardOpen(data) {
        this.onCardOpen(data.record)
    }

    /**
     * @summary Open one summary card's session detail ({@link #openSession}).
     * @param {Neo.data.Model} record The summary card's record — its `sessionId` is the pointer.
     */
    onCardOpen(record) {
        this.openSession(record)
    }

    /**
     * @summary Open one session's detail — a summary card's, or one the cockpit opens for another view (the
     * Observatory's selected session): the drill-in switches the rows zone to the session's turn-level
     * records. The drill target is part of the rendered drill KEY — the old session's rows and drain chain
     * are invalidated IMMEDIATELY, so no stale depth can anchor an offset request into the new session.
     * @param {Object}      target
     * @param {String}      target.sessionId
     * @param {String|null} [target.title] Display only
     */
    openSession(target) {
        const
            me        = this,
            sessionId = typeof target?.sessionId === 'string' ? target.sessionId : null;

        if (!sessionId || me.drillSession?.sessionId === sessionId) return;

        me.controller.clearReading('turn');
        me.getReference('memories-turn-grid').applyBags([]);
        me.renderedDrillSession = null;
        me.drillPendingOffset   = null;
        me.drillSession         = {sessionId, title: target.title ?? null};
        me.fire('sessionDetailRequest', {sessionId, title: target.title ?? null})
    }

    /**
     * @summary Leave the drill-in and return to the summary list. The close is an INTENT like the
     * open: the owner clears its held drill state, so a later rematerialization reopens the list,
     * never a drill the operator already left.
     */
    onDrillBackClick() {
        const me = this;

        me.drillSession = null;
        me.controller.clearReading('turn');
        me.getReference('memories-turn-grid').applyBags([]);
        me.renderedDrillSession = null;
        me.drillPendingOffset   = null;
        me.fire('sessionDetailClosed', {});
        me.applySnapshot()
    }

    /**
     * @summary The summary register reached its loaded end: request the next window at the
     * rendered depth, while the adopted envelope says more corpus exists and none is in flight.
     * Never off a corpus the selection does not point at, never from {@link #applySnapshot}
     * (continuation starts at the operator's edge), and never behind an open drill. An edge a
     * continuation announces into the hidden list is not lost: the engine's body clears its edge
     * latch when the register mounts again, so the first layout after the drill closes announces
     * it to a list the operator can see.
     */
    onSummaryScrollEdge() {
        const
            me       = this,
            target   = me.activeAgent,
            snapshot = me.snapshot,
            adopted  = target && me.renderedTarget === target && snapshot?.target === target &&
                       snapshot.capability?.state === 'wired' ? snapshot : null,
            count    = me.summaryStore?.count ?? 0;

        if (!adopted || me.drillSession || me.pendingOffset !== null || !Number.isFinite(adopted.total) || count >= adopted.total) {
            return
        }

        me.pendingOffset = count;
        me.fire('memoriesRequest', {agentIdentity: target, offset: count})
    }

    /**
     * @summary The drill twin of {@link #onSummaryScrollEdge}: the turn register reached the
     * loaded end of the open session.
     */
    onTurnScrollEdge() {
        const
            me       = this,
            open     = me.drillSession,
            snapshot = me.drillSnapshot,
            adopted  = open && me.renderedDrillSession === open.sessionId &&
                       snapshot?.sessionId === open.sessionId &&
                       snapshot.capability?.state === 'wired' ? snapshot : null,
            count    = me.turnStore?.count ?? 0;

        if (adopted && me.drillPendingOffset === null && Number.isFinite(adopted.total) && count < adopted.total) {
            me.drillPendingOffset = count;
            me.fire('sessionDetailRequest', {sessionId: open.sessionId, title: open.title, offset: count})
        }
    }

    /**
     * @summary Project the latest envelope into the summary register under the coherence
     * contract: the selected target is part of the rendered snapshot KEY. An envelope whose
     * target mismatches a non-null selection is NOT adopted — the pane renders the
     * switch-pending state instead, so a stale or late foreign-target page can never resurrect
     * old cards or re-open the drain. Replace is the default; a same-target `page.offset > 0`
     * continuation on an already-accepted page zero EXTENDS the held corpus through the grid's
     * one data path. Then: sync the zones. No read starts here — the register's scroll edge asks
     * ({@link #onSummaryScrollEdge}); the rendered key is written BEFORE the bags seat, because a
     * corpus shorter than one window announces its edge inside that very set.
     */
    applySnapshot() {
        const
            me          = this,
            snapshot    = me.snapshot,
            metaEl      = me.getReference('memories-meta'),
            refreshEl   = me.getReference('memories-refresh'),
            summaryGrid = me.getReference('memories-summary-grid'),
            coherent    = !snapshot || !me.activeAgent || snapshot.target === me.activeAgent,
            adopted     = coherent ? snapshot : null,
            wired       = adopted?.capability?.state === 'wired',
            pending     = me.activeAgent && (!adopted || adopted.target !== me.activeAgent);

        if (!me.summaryStore) return;

        const append = wired && adopted.page?.offset > 0 && adopted.target === me.renderedTarget;

        if (wired) {
            // the cells read the target for co-author attribution — set BEFORE the bags seat
            summaryGrid.target = adopted.target;
            me.renderedTarget  = adopted.target;

            const incoming = adopted.sessions.filter(session => session?.id).map(session => ({...session}));

            if (append) {
                const
                    held    = summaryGrid.extractBags(),
                    heldIds = new Set(held.map(bag => bag.id));

                summaryGrid.applyBags(held.concat(incoming.filter(bag => !heldIds.has(bag.id))))
            } else {
                summaryGrid.applyBags(incoming)
            }
        } else {
            me.renderedTarget = null;
            me.summaryStore.count > 0 && summaryGrid.applyBags([])
        }

        if (metaEl) {
            metaEl.text = pending
                ? `Reading ${me.activeAgent}…`
                : !adopted
                    ? 'Select an agent card in the roster to read their recent sessions.'
                    : wired
                        ? `${adopted.target} · ${me.summaryStore.count} of ${adopted.total ?? '?'} sessions · captured ${me.formatStamp(adopted.capability.capturedAt)}`
                        : `Memories unavailable · ${adopted.capability?.reason || 'unknown reason'}`;

            // T5 receipt; falsy removes, so the pending and unavailable branches — which render no
            // stamp — cannot leave a previous read's instant hovering behind their copy.
            metaEl.changeVdomRootKey('title', !pending && adopted && wired ? ViewerTime.viewerTimeTitle(adopted.capability.capturedAt) : null)
        }

        refreshEl && (refreshEl.hidden = !me.activeAgent || Boolean(me.drillSession));

        me.syncZones()
    }

    /**
     * @summary Project the latest drill envelope into the turn register under the summary twin's
     * coherence contract, one level down: the open session is part of the rendered drill KEY. An
     * envelope whose `sessionId` mismatches the open drill is NOT adopted — a stale or late
     * foreign-session page can never resurrect old rows or re-open the drill drain. Replace is
     * the default; a same-session continuation extends through the one data path. Then: sync the
     * zones. No read starts here — the turn register's scroll edge asks ({@link #onTurnScrollEdge}).
     */
    applyDrillSnapshot() {
        const
            me       = this,
            open     = me.drillSession,
            snapshot = me.drillSnapshot,
            turnGrid = me.getReference('memories-turn-grid');

        if (!me.turnStore || !open) return;

        const
            coherent = !snapshot || snapshot.sessionId === open.sessionId,
            adopted  = coherent ? snapshot : null,
            wired    = adopted?.capability?.state === 'wired',
            append   = wired && adopted.page?.offset > 0 && adopted.sessionId === me.renderedDrillSession;

        if (wired) {
            me.renderedDrillSession = adopted.sessionId;

            const incoming = adopted.turns.filter(turn => turn?.id).map(turn => ({...turn}));

            if (append) {
                const
                    held    = turnGrid.extractBags(),
                    heldIds = new Set(held.map(bag => bag.id));

                turnGrid.applyBags(held.concat(incoming.filter(bag => !heldIds.has(bag.id))))
            } else {
                turnGrid.applyBags(incoming)
            }
        } else {
            me.renderedDrillSession = null;
            me.turnStore.count > 0 && turnGrid.applyBags([])
        }

        me.syncZones()
    }

    /**
     * @summary One owner for the zone visibility + the honest-state line, both registers: while a
     * drill is open the turn register owns the rows zone (the summary states resume untouched on
     * return — their Store never left); otherwise the summary register does. Exactly one of
     * {state line, summary grid, turn grid} is visible at any time — never a fabricated success
     * beside rows.
     */
    syncZones() {
        const
            me          = this,
            stateEl     = me.getReference('memories-state'),
            drillHead   = me.getReference('memories-drill-head'),
            summaryGrid = me.getReference('memories-summary-grid'),
            turnGrid    = me.getReference('memories-turn-grid');

        if (me.drillSession) {
            const
                snapshot = me.drillSnapshot,
                adopted  = snapshot && snapshot.sessionId === me.drillSession.sessionId ? snapshot : null,
                wired    = adopted?.capability?.state === 'wired',
                rows     = wired && me.turnStore.count > 0;

            drillHead.hidden = false;
            me.getReference('memories-drill-title').text =
                me.drillSession.title ?? `session ${me.drillSession.sessionId.slice(0, 8)}`;

            summaryGrid.hidden = true;
            turnGrid.hidden    = !rows;
            stateEl.hidden     = rows;

            if (!rows) {
                const detail = adopted?.capability?.detail;

                stateEl.text = !adopted
                    ? 'Reading this session’s turns. Nothing here claims to be its history yet.'
                    : !wired
                        ? `The session-memories source did not answer${detail ? ` · ${detail}` : ''}. Nothing here claims to be history.`
                        : 'No turn records in this session.'
            }

            me.controller.syncReader(rows)
        } else {
            const
                snapshot = me.snapshot,
                coherent = !snapshot || !me.activeAgent || snapshot.target === me.activeAgent,
                adopted  = coherent ? snapshot : null,
                wired    = adopted?.capability?.state === 'wired',
                pending  = me.activeAgent && (!adopted || adopted.target !== me.activeAgent),
                rows     = wired && !pending && me.summaryStore.count > 0;

            drillHead.hidden   = true;
            turnGrid.hidden    = true;
            summaryGrid.hidden = !rows;
            stateEl.hidden     = rows;

            if (!rows) {
                stateEl.text = pending
                    ? 'Waiting for this agent’s first page. Nothing here claims to be their history yet.'
                    : !adopted
                        ? 'Session summaries render here once an agent is chosen.'
                        : !wired
                            ? 'The memories source did not answer. Nothing here claims to be history.'
                            : 'No sessions in this corpus.'
            }

            me.controller.syncReader(rows)
        }
    }

    /**
     * @summary Escape belongs to the reading: the pane's keys resolve on the pane, so it hands the
     * key to {@link AgentOS.view.fleet.memories.ReadingController#onEscape}.
     */
    onEscape() {
        this.controller.onEscape()
    }

    /**
     * @summary Viewer-local stamp via the shared cockpit formatter — see `ViewerTime.mjs` for why
     * format is single-sourced while this pane keeps its own "unknown time" miss-copy.
     * @param {Date|String|Number|null} value
     * @returns {String}
     */
    formatStamp(value) {
        return ViewerTime.formatViewerTime(value)?.text ?? 'unknown time'
    }
}

export default Neo.setupClass(MemoriesPane);
