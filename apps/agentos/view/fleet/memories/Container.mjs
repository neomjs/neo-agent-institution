import AgentSessionSummaries from '../../../store/AgentSessionSummaries.mjs';
import AgentSessionTurns     from '../../../store/AgentSessionTurns.mjs';
import Button                from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container             from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
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
 * **No paging chrome** (operator direction 2026-08-28, the #40/#41 mailbox precedent): the
 * buffered grids scroll, and the pane DRAINS the remote corpus itself — after each accepted
 * coherent envelope it fires exactly ONE follow-up read intent while the producer's `total` says
 * more corpus exists (armed per envelope arrival, floored per rendered depth so a repeated or
 * echo-less answer can never loop), and the honest end is the only stop. Refresh stays: an
 * explicit re-read intent is not paging.
 *
 * Honest states are first-class: no-selection, switch-pending, unavailable (with the source's
 * reason), a genuinely-empty corpus (`total: 0`), per-card guarded non-string titles/summaries,
 * multi-agent session attribution — and the drill twin of each. The coherence contract survives
 * the grid conversion unchanged: the selected target is part of the rendered snapshot KEY (a
 * foreign-target envelope is never adopted), the open session is part of the rendered drill KEY,
 * and `page.offset > 0` continuations extend only an already-accepted page zero of the same key.
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
         * @member {String[]} baseCls=['fm-memories-pane']
         */
        baseCls: ['fm-memories-pane'],
        /**
         * Optional SHELL-supplied tool configs appended to the actions row. The pane stays
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
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-memories-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype: 'component',
                cls  : ['fm-memories-title'],
                flex : 1,
                text : 'What they remember'
            }, {
                ntype: 'component',
                cls  : ['fm-memories-authority'],
                text : 'session summaries · query-time · not authority'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-memories-meta'],
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
        }, {
            ntype    : 'container',
            cls      : ['fm-memories-actions'],
            flex     : 'none',
            layout   : {ntype: 'hbox', align: 'center'},
            reference: 'memories-actions',
            items    : [{
                ntype: 'component',
                flex : 1
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
     * Armed by {@link #afterSetSnapshot} and consumed by ONE {@link #applySnapshot} run: the
     * summary drain fires only when a NEW envelope landed — a drill open/close re-render never
     * re-requests.
     * @member {Boolean} drainArmed=false
     */
    drainArmed = false
    /**
     * The rendered depth the summary drain last requested from — a follow-up fires only ABOVE
     * it, so an echo-less or repeated answer can never loop the chain. Reset to -1 whenever the
     * corpus replaces (a fresh page zero re-opens the whole chain).
     * @member {Number} drainFloor=-1
     */
    drainFloor = -1
    /**
     * The drill twin of {@link #drainArmed}.
     * @member {Boolean} drillDrainArmed=false
     */
    drillDrainArmed = false
    /**
     * The drill twin of {@link #drainFloor}.
     * @member {Number} drillDrainFloor=-1
     */
    drillDrainFloor = -1

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
        // this pane stays the owner); the drill-open intent flows back out of the summary grid
        const summaryGrid = me.getReference('memories-summary-grid');

        summaryGrid.store = me.summaryStore;
        summaryGrid.on('cardOpen', me.onGridCardOpen, me);
        me.getReference('memories-turn-grid').store = me.turnStore;

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

        me.getReference('memories-summary-grid').applyBags([]);
        me.renderedTarget = null;
        me.drainFloor     = -1;
        me.applySnapshot();
        value && me.fire('memoriesRequest', {agentIdentity: value})
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetSnapshot(value, oldValue) {
        this.drainArmed = true;
        this.isConstructed && this.applySnapshot()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetDrillSession(value, oldValue) {
        this.isConstructed && this.applySnapshot()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetDrillSnapshot(value, oldValue) {
        this.drillDrainArmed = true;
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
     * @summary Open one summary card's session detail: the drill-in switches the rows zone to the
     * session's turn-level records. The drill target is part of the rendered drill KEY — the old
     * session's rows and drain chain are invalidated IMMEDIATELY, so no stale depth can anchor an
     * offset request into the new session.
     * @param {Neo.data.Model} record The summary card's record — its `sessionId` is the pointer.
     */
    onCardOpen(record) {
        const
            me        = this,
            sessionId = typeof record?.sessionId === 'string' ? record.sessionId : null;

        if (!sessionId || me.drillSession?.sessionId === sessionId) return;

        me.getReference('memories-turn-grid').applyBags([]);
        me.renderedDrillSession = null;
        me.drillDrainFloor      = -1;
        me.drillSession         = {sessionId, title: record.title ?? null};
        me.fire('sessionDetailRequest', {sessionId, title: record.title ?? null})
    }

    /**
     * @summary Leave the drill-in and return to the summary list. The close is an INTENT like the
     * open: the owner clears its held drill state, so a later rematerialization reopens the list,
     * never a drill the operator already left.
     */
    onDrillBackClick() {
        const me = this;

        me.drillSession = null;
        me.getReference('memories-turn-grid').applyBags([]);
        me.renderedDrillSession = null;
        me.drillDrainFloor      = -1;
        me.fire('sessionDetailClosed', {});
        me.applySnapshot()
    }

    /**
     * @summary Project the latest envelope into the summary register under the coherence
     * contract: the selected target is part of the rendered snapshot KEY. An envelope whose
     * target mismatches a non-null selection is NOT adopted — the pane renders the
     * switch-pending state instead, so a stale or late foreign-target page can never resurrect
     * old cards or re-open the drain. Replace is the default; a same-target `page.offset > 0`
     * continuation on an already-accepted page zero EXTENDS the held corpus through the grid's
     * one data path. Then: sync the zones and run the drain.
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

            const incoming = adopted.sessions.filter(session => session?.id).map(session => ({...session}));

            if (append) {
                const
                    held    = summaryGrid.extractBags(),
                    heldIds = new Set(held.map(bag => bag.id));

                summaryGrid.applyBags(held.concat(incoming.filter(bag => !heldIds.has(bag.id))))
            } else {
                me.drainFloor = -1;
                summaryGrid.applyBags(incoming)
            }

            me.renderedTarget = adopted.target
        } else {
            me.drainFloor     = -1;
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

        me.syncZones();

        // The summary drain — the paging chrome's replacement: exactly one follow-up intent per
        // NEWLY-arrived accepted envelope (armed per afterSetSnapshot) while the producer's total
        // says more corpus exists, floored by rendered depth so a repeated answer cannot loop.
        // Suspended while the drill owns the zone; the corpus resumes assembling on return.
        if (me.drainArmed && wired && !pending && !me.drillSession &&
            Number.isFinite(adopted.total) && me.summaryStore.count < adopted.total &&
            me.summaryStore.count > me.drainFloor) {
            me.drainFloor = me.summaryStore.count;
            me.fire('memoriesRequest', {agentIdentity: me.activeAgent, offset: me.summaryStore.count})
        }

        me.drainArmed = false
    }

    /**
     * @summary Project the latest drill envelope into the turn register under the summary twin's
     * coherence contract, one level down: the open session is part of the rendered drill KEY. An
     * envelope whose `sessionId` mismatches the open drill is NOT adopted — a stale or late
     * foreign-session page can never resurrect old rows or re-open the drill drain. Replace is
     * the default; a same-session continuation extends through the one data path. Then: sync the
     * zones and run the drill drain.
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
            const incoming = adopted.turns.filter(turn => turn?.id).map(turn => ({...turn}));

            if (append) {
                const
                    held    = turnGrid.extractBags(),
                    heldIds = new Set(held.map(bag => bag.id));

                turnGrid.applyBags(held.concat(incoming.filter(bag => !heldIds.has(bag.id))))
            } else {
                me.drillDrainFloor = -1;
                turnGrid.applyBags(incoming)
            }

            me.renderedDrillSession = adopted.sessionId
        } else {
            me.drillDrainFloor      = -1;
            me.renderedDrillSession = null;
            me.turnStore.count > 0 && turnGrid.applyBags([])
        }

        me.syncZones();

        // the drill drain — the "older turns" button's replacement, same contract one level down
        if (me.drillDrainArmed && wired && Number.isFinite(adopted.total) &&
            me.turnStore.count < adopted.total && me.turnStore.count > me.drillDrainFloor) {
            me.drillDrainFloor = me.turnStore.count;
            me.fire('sessionDetailRequest', {sessionId: open.sessionId, title: open.title, offset: me.turnStore.count})
        }

        me.drillDrainArmed = false
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
        }
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
