import AgentConfigCard       from './AgentConfigComponent.mjs';
import Container             from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import FamilyRail            from '../shared/FamilyRailComponent.mjs';
import Image                 from '../../../../../node_modules/neo.mjs/src/component/Image.mjs';
import StateDot              from '../shared/StateDotComponent.mjs';
import TabContainer          from '../../../../../node_modules/neo.mjs/src/tab/Container.mjs';
import AgentFreshness        from '../../../util/AgentFreshness.mjs';
import ConfigIntentRoundTrip from '../../../util/ConfigIntentRoundTrip.mjs';
import SourceHealth          from '../../../util/SourceHealth.mjs';
import Telltale              from '../../../util/Telltale.mjs';

/**
 * The SSOT drill-in panes (design §B3: "thought-stream, lane, repo, and PRs"), each with the honest
 * live cadence its freshness is judged against. `freshnessTtl` is the default window a pane's ledger
 * may override once its feed stamps one; the values are tunable, not contractual.
 * @type {Object[]}
 */
const PANES = [
    {key: 'thought-stream', title: 'Thought stream', freshnessTtl: 60_000},
    {key: 'lane',           title: 'Current lane',   freshnessTtl: 300_000},
    {key: 'repo',           title: 'Repository',     freshnessTtl: 300_000},
    {key: 'prs',            title: 'Pull requests',  freshnessTtl: 300_000}
];

/**
 * @summary One pane's config: a header (title + referenced freshness chip) over a referenced body.
 * Built from the {@link PANES} descriptor so the reference ids derive from the pane key.
 * @param {Object} pane A {@link PANES} entry.
 * @returns {Object}
 * @private
 */
const paneConfig = pane => ({
    ntype : 'container',
    cls   : ['fm-detail-pane', `fm-detail-pane-${pane.key}`],
    flex  : 'none',
    layout: {ntype: 'vbox', align: 'stretch'},

    items: [{
        ntype: 'container',
        cls  : ['fm-detail-pane-head'],
        // The vbox stretch default otherwise gives this head `flex: 1 1 0%`, pinning its height
        // below wrapped title/provenance content. The body owns the remaining vertical space.
        flex  : 'none',
        layout: {ntype: 'hbox', align: 'center'},

        items: [{
            ntype: 'component',
            cls  : ['fm-detail-pane-title'],
            flex : 1,
            html : pane.title
        }, {
            ntype    : 'component',
            flex     : 'none',
            reference: `pane-${pane.key}-freshness`
        }]
    }, {
        ntype    : 'component',
        cls      : ['fm-detail-pane-body'],
        reference: `pane-${pane.key}-body`
    }]
});

/**
 * The cockpit drill-in surface: one resident's detail — the identity header over the four SSOT
 * panes (thought-stream · current lane · repository · pull requests). Mounted as the dock
 * document's auto-hidden `agent-detail` inspector; the card→detail selection feeds its `record`.
 *
 * **Data-driven from its `record`** — one {@link AgentOS.model.FleetAgent} record (or a plain
 * field-bag of the same keys), exactly like {@link AgentOS.view.fleet.roster.card.Container}. There is no
 * per-view `state.Provider`; the owning cockpit's roster Store is the reactive layer, and a
 * re-seat onto a different record re-renders in place via {@link #applyRecord}.
 *
 * **Identity-header render rules:** the social **displayName** and **engineTag**
 * are mutable DISPLAY STATE / session-metadata over the durable `agentId` (§2.3.2/§2.3.3) — the id
 * is rendered too, subordinate, as the never-renamed anchor; a family swap rebinds the rail in
 * place and never reads as a different resident. **No role-typing anywhere** (§2.3.1) — the header
 * renders what the resident IS and is DOING (identity + availability + session state), never what
 * it must be. Every claim is witness, not authority (§2.4).
 *
 * **Freshness ledger (the panes):** every pane renders its observation freshness —
 * `fresh` / `stale` / `lost` from a wired feed's `observedAt` vs TTL, or the honest `unobserved`
 * until its Lane-C / memory-surface feed leaf lands. A pane NEVER renders a claim as silently
 * current: an unwired pane says so. The pure classification is
 * {@link module:apps/agentos/view/fleet/agentFreshness}; this view is its first consumer.
 *
 * **Shell-agnostic + layout-blind:** the view takes ordinary configs only — no
 * dock/layout/Electron coupling reaches it — so the pop-out leaf (T4.15) reparents it into its own
 * OS window without change.
 *
 * @class AgentOS.view.fleet.detail.Container
 * @extends Neo.container.Base
 */
class AgentDetail extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.Container',
        /**
         * @member {String} ntype='fm-agent-detail'
         * @protected
         */
        ntype: 'fm-agent-detail',
        /**
         * @member {String[]} baseCls=['fm-agent-detail']
         */
        baseCls: ['fm-agent-detail'],
        /**
         * Optional SHELL-supplied tool configs appended to the identity header. The pane stays
         * layout-blind: it places these controls at its header's trailing edge and never inspects
         * what they do — ownership, handlers and state sync remain with the supplying shell.
         * @member {Object[]|null} shellTools=null
         */
        shellTools: null,
        /**
         * The provider-hosted `AgentDefinitions` Store, resolved via the standard bind (the same
         * instance Accounts writes into) — the configuration tab's data surface. The JOIN is the
         * Fleet Registry key: `FleetAgent.agentId` IS the roster row's `id`, which IS
         * `AgentDefinition.id`. `null` (no store seated, e.g. a bare unit mount) renders the
         * tab's honest no-definition state — never a fabricated config. The bind lives in the
         * COMPOSITION (the cockpit's resolver), not here — this view stays provider-agnostic, so
         * bare mounts and vessel reparents never require a provider chain.
         * @member {Neo.data.Store|null} agentDefinitions_=null
         * @reactive
         */
        agentDefinitions_: null,
        /**
         * The provider-hosted public tenant Store, seated by FleetCockpit composition alongside the
         * definitions Store. The configuration card owns its Store listeners; this view only keeps
         * the exact shared instance stable across dock and vessel reparents.
         * @member {Neo.data.Store|null} fleetTenants_=null
         * @reactive
         */
        fleetTenants_: null,
        /**
         * The drilled-in resident: an {@link AgentOS.model.FleetAgent} record (store-backed, live)
         * or a plain field bag with the same keys. `null` renders the honest "no agent selected"
         * empty state — never a blank inspector masquerading as a loaded one.
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * Per-pane freshness ledgers keyed by pane `key` — `{observedAt, freshnessTtl, lost}` the
         * Lane-C / memory-surface feed leaves stamp as they land. `null` (today's reality) → every
         * pane degrades to the honest `unobserved`; the view sharpens to timestamped freshness with
         * no change the moment a feed wires a ledger.
         * @member {Object|null} paneLedgers_=null
         * @reactive
         */
        paneLedgers_: null,
        /**
         * Injected wall-clock (ms) for freshness classification; `null` → the live `Date.now()`.
         * Tests pin it so the freshness contract renders deterministically.
         * @member {Number|null} now_=null
         * @reactive
         */
        now_: null,
        /**
         * How often (ms) the freshness labels re-age off the wall clock while a record is shown —
         * a `fresh` pane must decay to `stale` / `lost` over time even with no new data. Tunable.
         * @member {Number} freshnessRefreshMs=30000
         */
        freshnessRefreshMs: 30000,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The empty state, the identity header, and the four SSOT panes (built from {@link PANES}).
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-detail-empty'],
            html     : 'Select an agent to inspect',
            reference: 'detail-empty'
        }, {
            ntype    : 'container',
            cls      : ['fm-detail-header'],
            flex     : 'none',
            hidden   : true,
            reference: 'detail-header',
            layout   : {ntype: 'hbox', align: 'stretch'},

            items: [{
                module   : FamilyRail,
                flex     : 'none',
                reference: 'family-rail'
            }, {
                module   : Image,
                cls      : ['fm-detail-avatar'],
                flex     : 'none',
                reference: 'detail-avatar'
            }, {
                ntype : 'container',
                cls   : ['fm-detail-identity'],
                flex  : 1,
                layout: {ntype: 'vbox', align: 'stretch'},

                items: [{
                    ntype : 'container',
                    cls   : ['fm-detail-name-row'],
                    layout: {ntype: 'hbox', align: 'center'},

                    items: [{
                        module   : StateDot,
                        flex     : 'none',
                        reference: 'state-dot'
                    }, {
                        ntype    : 'component',
                        cls      : ['fm-detail-name'],
                        flex     : 1,
                        reference: 'detail-name'
                    }, {
                        // engine is session-metadata, not identity — rendered
                        // subordinate to the name, never as a role
                        ntype    : 'component',
                        cls      : ['fm-detail-engine'],
                        flex     : 'none',
                        reference: 'detail-engine'
                    }]
                }, {
                    // the durable anchor, rendered small beneath the display name — name is display
                    // state OVER this id (§2.3.2), so the id is always reachable, never the label
                    ntype    : 'component',
                    cls      : ['fm-detail-id'],
                    reference: 'detail-id'
                }]
            }]
        }, {
            // ONE state ledger in the pane's own freshness-pill vocabulary (#23) — the identity
            // block above stays pure identity (name is the only display-tier line). Every
            // liveness/wiring axis renders exactly once as an `axis · pill` row: availability,
            // the wake telltale, capacity (SOURCE-GATED: the axis renders only when a producer
            // reported it — a permanently-unobservable row is furniture, not honesty), and the
            // three data sources. Nominal states render too — this is ONE resident, and an
            // operator who drilled in needs "wake on" confirmed, not omitted (the card stays
            // exception-based). Provenance (producer literal, consumer reason) rides each pill's
            // title attribute — inert by construction, like every text node here.
            ntype    : 'component',
            cls      : ['fm-detail-ledger'],
            flex     : 'none',
            hidden   : true,
            reference: 'detail-ledger'
        }, {
            // the drill-in's tabbed body: Status panes + the Configuration card — the a11y region
            // + identity header stay above. Mail is NOT a detail concern: the south pane is the
            // cockpit's one mailbox surface, and a per-agent subject scope re-enters THERE when
            // the S5 Fleet grants/admission layer lands (viewer ingress is already live; the
            // policy ledger holds the mirror read at awaiting-s5).
            module     : TabContainer,
            cls        : ['fm-detail-tabs'],
            flex       : 1,
            hidden     : true,
            reference  : 'detail-tabs',
            activeIndex: 0,

            items: [{
                ntype    : 'container',
                cls      : ['fm-detail-panes'],
                header   : {text: 'Status'},
                reference: 'detail-panes',
                layout   : {ntype: 'vbox', align: 'stretch'},
                items    : PANES.map(paneConfig)
            }, {
                // object permanence (the S5 fork-1 ruling): per-agent CONFIGURATION belongs to the
                // agent object, so it rides the detail as a tab. The card fires `configIntent`; THIS view owns the bridge
                // round-trip through the shared runner (which arbitrates supersession per shared
                // record, across every owner), with the card as this owner's status sink.
                module   : AgentConfigCard,
                emptyText: 'This agent has no stored definition yet — add it via the rail\'s Add agent zone.',
                header   : {text: 'Configuration'},
                reference: 'config-pane'
            }]
        }]
    }

    /**
     * @summary Populate the header + panes once the anatomy exists (content is record-derived).
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);
        // a11y: the agent-detail drill is a named landmark region so screen-reader users land in a
        // labeled region on drill-in, not an unnamed pane. Set on the root before applyRecord's first
        // render flush; a later re-seat (applyRecord) keeps the root, so the region survives.
        Object.assign(this.vdom, {role: 'region', 'aria-label': 'Agent detail'});

        // shell-supplied window verbs ride the tab header bar's ACTION seam (#23, operator
        // direction): one icon at the trailing edge of the tab strip, outside the content flow —
        // the old identity-header placement floated the verb OVER the identity block at rail
        // widths. The slot stays layout-blind for the shell; this pane only picks the seam.
        this.shellTools?.length && (this.getReference('detail-tabs').headerActions = this.shellTools);
        // the pane renders and never fetches: it fires the page intent, this view (which holds the
        // read seam and the subject) performs the bounded re-read. Wired explicitly rather than via
        // a string handler — this view carries no controller for one to resolve against.
        // same explicit-wiring rule for the config tab: the card fires, this view runs the shared
        // bridge round-trip (see onConfigIntent)
        const configPane = this.getReference('config-pane');

        configPane?.on('configIntent', this.onConfigIntent, this);

        if (configPane) {
            configPane.tenantStore = this.fleetTenants
        }
        this.applyRecord();
        this.startFreshnessAging()
    }

    /**
     * Triggered after the composition-seated public tenant Store changes.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetFleetTenants(value, oldValue) {
        const card = this.getReference?.('config-pane');

        if (card) card.tenantStore = value
    }

    /**
     * @summary Age the freshness labels over wall-clock time — freshness is time-relative, so a
     * pane that was `fresh` must mechanically decay to `stale` / `lost` even with no new data. A
     * self-rescheduling timer re-classifies every {@link #freshnessRefreshMs} while a record is
     * shown; the `isDestroyed` guard ends the loop on teardown (no explicit clear needed). Uses the
     * live clock (`applyPaneFreshness` reads `now ?? Date.now()`), so a pinned test `now` ages
     * deterministically via `afterSetNow` instead.
     * @protected
     */
    startFreshnessAging() {
        let me = this;

        me.timeout(me.freshnessRefreshMs).then(() => {
            if (!me.isDestroyed) {
                me.record && me.applyPaneFreshness();
                me.startFreshnessAging()
            }
        })
    }

    /**
     * Triggered after the record config changed — a re-seat onto a different resident (or a null
     * clear back to the empty state) re-renders in place.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        this.isConstructed && this.applyRecord()
    }

    /**
     * Triggered after the per-pane ledgers changed — re-render just the freshness chips (a feed
     * stamping a new `observedAt` must re-label the pane without a full record re-seat).
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetPaneLedgers(value, oldValue) {
        this.isConstructed && this.record && this.applyPaneFreshness()
    }

    /**
     * Triggered after the injected clock changed — freshness is time-relative, so a new `now`
     * re-classifies every pane.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     * @protected
     */
    afterSetNow(value, oldValue) {
        this.isConstructed && this.record && this.applyPaneFreshness()
    }

    /**
     * @summary Render the record onto the header, or fall back to the honest empty state.
     *
     * The identity header: displayName is mutable display state (falling back
     * through the durable id, never blank), engineTag is subordinate session-metadata, the id is
     * always shown as the anchor, participationStatus renders as availability (not a role), and the
     * family rail + state dot mirror {@link AgentOS.view.fleet.roster.card.Container} (state gated on a wired
     * runtime source so missing evidence never renders as live).
     * @protected
     */
    /**
     * The full store-lifecycle listener set for the definitions store — one map, attached and
     * detached symmetrically ({@link #afterSetAgentDefinitions} + {@link #destroy}). Three distinct
     * edges, three listeners: `recordChange` (a field mutated in place — record identity unchanged,
     * so the card's reactive `record` never re-fires), `mutate` (membership: a definition added,
     * replaced, or removed after this view mounted), `load` (a reload re-seated the rows wholesale).
     * @returns {Object}
     * @protected
     */
    getDefinitionsStoreListeners() {
        const me = this;

        return {
            load        : me.onDefinitionsStoreMutation,
            mutate      : me.onDefinitionsStoreMutation,
            recordChange: me.onDefinitionRecordChange,
            scope       : me
        }
    }

    /**
     * Triggered after the agentDefinitions config got changed — the composition seating the shared
     * store (or a test seating one directly). Moves the store-lifecycle listeners old → new, then
     * re-seats the card: a detail mounted BEFORE its definition existed must acquire the record the
     * moment membership delivers it.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetAgentDefinitions(value, oldValue) {
        const me = this;

        oldValue?.un?.(me.getDefinitionsStoreListeners());
        value?.on?.(me.getDefinitionsStoreListeners());

        me.isConstructed && me.applyConfigRecord()
    }

    /**
     * @summary Store membership or a wholesale reload changed the definition rows — re-seat the
     * card from the canonical store. Covers a definition ADDED after mount (null → record),
     * REPLACED (new instance for the same id), REMOVED (record → honest empty state), and reloads.
     * @protected
     */
    onDefinitionsStoreMutation() {
        this.applyConfigRecord()
    }

    /**
     * @summary Detach the provider-owned store's listeners — the store outlives this view, so an
     * attached listener would keep firing into a destroyed component.
     * @param {...*} args
     */
    destroy(...args) {
        this.agentDefinitions?.un?.(this.getDefinitionsStoreListeners());
        super.destroy(...args)
    }

    /**
     * @summary Seat the configuration tab from the definitions store — the Fleet-Registry-key join
     * (`record.agentId` === `AgentDefinition.id`). No resident or no store → `null` → the card's
     * honest empty line.
     */
    applyConfigRecord() {
        const
            me   = this,
            card = me.getReference('config-pane');

        if (card) {
            card.record = (me.record?.agentId && me.agentDefinitions?.get(me.record.agentId)) || null
        }
    }

    /**
     * @summary A definition record changed in place (e.g. an accepted configure readback from ANY
     * owner, incl. Accounts) — refresh the card when the change concerns the seated definition.
     * @param {Object} data The store's `recordChange` payload.
     * @protected
     */
    onDefinitionRecordChange(data) {
        const card = this.getReference('config-pane');

        card?.record && data?.record?.id === card.record.id && card.refresh()
    }

    /**
     * @summary The config tab's `configIntent` → the shared bridge round-trip. Ordering is NOT
     * owned here: the runner arbitrates supersession per shared record across every owner
     * (Accounts included), so a newer intent from either surface outranks an older in-flight
     * response. This owner contributes only its store resolution and its status sink (the card).
     * Fail-closed and readback-only by construction —
     * see {@link module:apps/agentos/view/fleet/configIntentRoundTrip}.
     * @param {Object} intent `{id, harnessType?, mcpServers?, mcpTarget?}` (+ event envelope,
     *     stripped by the runner).
     * @returns {Promise<void>}
     */
    onConfigIntent(intent={}) {
        const me = this;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent,
            owner        : me,
            setSaveStatus: (agentId, state, reason) => me.getReference('config-pane')?.setSaveStatus(agentId, state, reason),
            store        : me.agentDefinitions
        })
    }

    applyRecord() {
        let me     = this,
            record = me.record,
            empty  = me.getReference('detail-empty'),
            header = me.getReference('detail-header'),
            ledger = me.getReference('detail-ledger'),
            tabs   = me.getReference('detail-tabs');

        empty.hidden  = !!record;
        header.hidden = !record;
        ledger.hidden = !record;
        tabs.hidden   = !record;

        // the configuration tab joins on the Fleet Registry key; a roster resident with no stored
        // definition renders the card's honest no-definition line, never a fabricated config
        me.applyConfigRecord();

        if (!record) {
            return
        }

        const
            sources = SourceHealth.normalizeFleetSources(record.sources),
            runtime = sources.runtime,
            // the drill-in dot renders the SAME resolved truth as the card and the health tally —
            // one resolver, three surfaces: a roster-only active resident reads `unobserved` here
            // exactly as the grid displays it, never a contradictory `off`
            state        = SourceHealth.resolveFleetDisplayState({state: record.state, sources: record.sources}),
            agentId      = record.agentId ?? '';

        me.getReference('family-rail').family = record.family ?? null;

        me.getReference('state-dot').set({
            live : state === 'ok' && runtime.confidence === 'observed',
            state
        });

        me.getReference('detail-name').text   = record.displayName || agentId || '—';
        me.getReference('detail-engine').text = record.engineTag ?? '';
        me.getReference('detail-id').text     = agentId;

        me.renderStateLedger(record, sources);

        me.getReference('detail-avatar').set({
            alt: record.displayName ?? agentId,
            src: record.avatarUrl ?? null
        });

        me.applyPaneFreshness()
    }

    /**
     * @summary Render the ONE state ledger — every liveness/wiring axis once, as `axis · pill`
     * rows in the pane's own freshness-pill vocabulary (#23: three vocabularies became one).
     *
     * Rows, in order: availability (participationStatus — a known status word or no row),
     * the wake telltale (BOTH renderings the old readout carried: a nominal axis says so, an
     * observed `unknown` keeps the producer's reason — on the pill title now), capacity
     * (the throttle axis, SOURCE-GATED: it renders only when a producer actually reported it —
     * the adapter documents that no trustworthy capacity truth source exists yet, so an
     * unconditional row could only ever say "not reported": furniture, not honesty; the row
     * returns with its producer, wearing a word that means what the enum measures), and the
     * three data sources with their producer literals on the title.
     *
     * Tone classes reuse the freshness family deliberately (one pill language per pane):
     * `is-fresh` = nominal, `is-stale` = deviating, `is-unobserved` = absent/unknown/not wired.
     *
     * Built as `text` VDOM nodes with `title` ATTRIBUTES, never an `html` string — reasons and
     * producer literals cross a process boundary before they reach here, and Neo routes `html`
     * to innerHTML; text nodes and attribute strings are inert by construction.
     * @param {Object} record The drilled-in FleetAgent record (never null here).
     * @param {Object} sources `SourceHealth.normalizeFleetSources` output — the SAME resolved
     *     truth the card's strip reads, so detail and card can never disagree.
     * @protected
     */
    renderStateLedger(record, sources) {
        const
            me     = this,
            ledger = me.getReference('detail-ledger'),
            rows   = [],
            row    = (axis, word, tone, title) => rows.push(
                {tag: 'span', cls: ['fm-ledger-axis'], text: axis},
                {tag: 'span', cls: ['fm-freshness', tone], text: word, ...(title ? {title} : {})}
            );

        const participation = record.participationStatus ?? null;

        participation !== null && row('status', participation.replace(/_/g, ' '),
            participation === 'active' ? 'is-fresh' : 'is-stale');

        Telltale.describeTelltaleReadout({throttle: record.throttle, wake: record.wake})
            .forEach(({axis, reason, reported, state}) => {
                // capacity (the renamed throttle axis) is source-gated; wake states itself always
                if (axis === 'throttle' && !reported) {
                    return
                }

                const
                    label = axis === 'throttle' ? 'capacity' : axis,
                    word  = reported ? state : 'not reported',
                    tone  = !reported || state === 'unknown' ? 'is-unobserved'
                          : (state === 'on' || state === 'none') ? 'is-fresh' : 'is-stale';

                row(label, word, tone, reason || null)
            });

        const
            sourceLabels = {runtime: 'runtime', repoStatus: 'repository', roster: 'roster'},
            sourceOrder  = ['runtime', 'repoStatus', 'roster'];

        sourceOrder.forEach(key => {
            const
                fact  = sources[key],
                wired = fact.state === 'wired',
                word  = wired ? `wired · ${fact.confidence}` : fact.state.replace(/-/g, ' ');

            row(sourceLabels[key], word, wired ? 'is-fresh' : 'is-unobserved', fact.source || null)
        });

        ledger.vdom.cn = rows;
        ledger.update()
    }

    /**
     * @summary Render each pane's freshness chip + known body content, honestly.
     *
     * Every pane header shows its observation freshness — timestamped `fresh`/`stale`/`lost` from a
     * wired ledger, or `unobserved` until its feed lands (never a silently-current
     * claim). The `lane` pane additionally renders the record-known lane line + open-lane count; the
     * feed-gated panes (thought-stream / repo / prs) keep their body EMPTY until their Lane-C /
     * memory-surface leaf wires content — the head's freshness pill carries the awaiting truth on
     * its title (#23: the per-section boilerplate collapsed into the one provenance pill).
     * @protected
     */
    applyPaneFreshness() {
        let me      = this,
            record  = me.record,
            ledgers = me.paneLedgers ?? {},
            now     = me.now ?? Date.now();

        PANES.forEach(pane => {
            const
                ledger       = ledgers[pane.key] ?? null,
                merged       = ledger ? {freshnessTtl: pane.freshnessTtl, ...ledger} : null,
                {cls, label} = AgentFreshness.describePaneFreshness(AgentFreshness.classifyPaneFreshness(merged, now));

            // .text (never .html): the label is ours but the pane body is record-derived
            // (laneLine), so it must be escaped text, never interpreted markup — no injection surface
            const freshnessChip = me.getReference(`pane-${pane.key}-freshness`);

            freshnessChip.set({cls, text: label});
            // the awaiting truth rides the pill's title (one provenance pill per section — #23);
            // an attribute string is inert, like every text node here
            freshnessChip.vdom.title = ledger ? null : 'awaiting live feed — no source wired for this pane yet';
            freshnessChip.update();

            me.getReference(`pane-${pane.key}-body`).text = me.renderPaneBody(pane.key, record)
        })
    }

    /**
     * @summary The honest body content for one pane from the record's known facts. The `lane` pane
     * renders the real lane line + open-lane count; the feed-gated panes render NO body until
     * their source leaf lands — the head's freshness pill already states "not observed — source
     * not wired" and carries the awaiting detail on its title, so a body line repeating it was
     * the same fact told twice per section (#23).
     * @param {String} key Pane key.
     * @param {Object} record The drilled-in FleetAgent record (never null here).
     * @returns {String}
     * @protected
     */
    renderPaneBody(key, record) {
        if (key === 'lane') {
            const
                laneLine  = record.laneLine || 'no current lane reported',
                laneCount = Number.isInteger(record.openLaneCount) && record.openLaneCount > 0 ? record.openLaneCount : null,
                countText = laneCount === null ? '' : ` · ${laneCount} open ${laneCount === 1 ? 'lane' : 'lanes'}`;

            return `${laneLine}${countText}`
        }

        return ''
    }
}

export default Neo.setupClass(AgentDetail);
