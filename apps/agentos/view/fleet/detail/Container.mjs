import AgentConfigCard                      from './AgentConfigComponent.mjs';
import Button                               from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container                            from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import FamilyRail                           from '../shared/FamilyRailComponent.mjs';
import Image                                from '../../../../../node_modules/neo.mjs/src/component/Image.mjs';
import PullRequestList                      from './PullRequestList.mjs';
import StateDot, {stateLabel, stateMeaning} from '../shared/StateDotComponent.mjs';
import TabContainer                         from '../../../../../node_modules/neo.mjs/src/tab/Container.mjs';
import AgentFreshness                       from '../../../util/AgentFreshness.mjs';
import Controller                           from './Controller.mjs';
import HarnessChoice                        from '../../../util/HarnessChoice.mjs';
import HeldPullRequests                     from '../../../store/HeldPullRequests.mjs';
import OpenWorkSeat                         from '../../../util/OpenWorkSeat.mjs';
import SourceHealth                         from '../../../util/SourceHealth.mjs';
import Telltale                             from '../../../util/Telltale.mjs';

/**
 * The SSOT drill-in panes (design §B3: "thought-stream, lane, repo, and PRs"), each with the honest
 * live cadence its freshness is judged against. `freshnessTtl` is the default window a pane's ledger
 * may override once its feed stamps one; the values are tunable, not contractual. A pane whose body
 * is more than its text names its own `body` config: the pull requests pane holds the sentence an
 * answer holding nothing renders, and its Store-backed list joins on the first resident shown.
 * @type {Object[]}
 */
const PANES = [
    {key: 'thought-stream', title: 'Thought stream', freshnessTtl: 60_000},
    {key: 'lane',           title: 'Current lane',   freshnessTtl: 300_000},
    {key: 'repo',           title: 'Repository',     freshnessTtl: 300_000},
    {key: 'prs',            title: 'Pull requests',  freshnessTtl: 300_000, body: {
        ntype: 'container',
        items: [{
            ntype    : 'component',
            cls      : ['fm-detail-prs-none'],
            hidden   : true,
            reference: 'prs-none',
            text     : OpenWorkSeat.PANE_WORDS.none
        }]
    }}
];

/**
 * What each pane waits for while no source has answered for it, on the freshness pill's title —
 * each names the producer that owns the pane's fact, so an operator reads a gap, never a bug: the
 * thought stream waits for a read of a resident's turns that the plane's sharing policy admits (its
 * recency read answers the caller's own turns only), the lane waits for the roster row's lane
 * stamp (the latest lane claim per seat, one derivation for the card and this pane).
 * @type {Object<String, String>}
 */
const AWAITING = {
    'thought-stream': 'awaiting a policy-aware read of this resident\'s turns — the plane\'s recency read answers the caller\'s own turns only',
    lane            : 'awaiting the roster row\'s lane stamp — the latest lane claim per seat lands on the roster read',
    repo            : 'awaiting the roster read — the repository pane reads the roster row'
};

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
        cls  : ['fm-pane-head', 'fm-detail-pane-head'],
        // The vbox stretch default otherwise gives this head `flex: 1 1 0%`, pinning its height
        // below wrapped title/provenance content. The body owns the remaining vertical space.
        flex  : 'none',
        layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},

        items: [{
            ntype: 'component',
            cls  : ['fm-pane-title', 'fm-detail-pane-title'],
            html : pane.title
        }, {
            ntype    : 'component',
            flex     : 'none',
            reference: `pane-${pane.key}-freshness`
        }]
    }, {
        ntype    : 'component',
        ...pane.body,
        cls      : ['fm-detail-pane-body'],
        reference: `pane-${pane.key}-body`
    }, ...(pane.key === 'repo' ? repoPathAction() : [])]
});

/**
 * @summary The Repository pane's one action under its clone path: `Copy path`, and the unseen field
 * it copies from. The action stays hidden until the roster row reports a path.
 * @returns {Object[]}
 * @private
 */
const repoPathAction = () => [{
    module   : Button,
    cls      : ['fm-detail-repo-copy'],
    hidden   : true,
    reference: 'detail-repo-copy',
    text     : 'Copy path',
    tooltip  : 'Copy the clone path',
    ui       : 'ghost'
}, {
    // the copy source: an inert field the Copy action selects, unseen and unfocusable
    ntype    : 'component',
    cls      : ['fm-detail-repo-field'],
    reference: 'detail-repo-field',
    vdom     : {tag: 'input', 'aria-hidden': true, readonly: true, tabIndex: -1, type: 'text', value: ''}
}];

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
         * @member {Neo.controller.Component} controller
         */
        controller: Controller,
        /**
         * @member {String} ntype='fm-agent-detail'
         * @protected
         */
        ntype: 'fm-agent-detail',
        /**
         * @member {String[]} baseCls=['fm-agent-detail','fm-pane']
         */
        baseCls: ['fm-agent-detail', 'fm-pane'],
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
         * Per-pane freshness ledgers keyed by pane `key` — `{observedAt, freshnessTtl, lost, stale}` the
         * Lane-C / memory-surface feed leaves stamp as they land. `null` (today's reality) → every
         * pane degrades to the honest `unobserved`; the view sharpens to timestamped freshness with
         * no change the moment a feed wires a ledger.
         * @member {Object|null} paneLedgers_=null
         * @reactive
         */
        paneLedgers_: null,
        /**
         * The reader's clock (epoch ms) at the last roster admission — the repository pane's
         * observation instant, since that pane reads the roster row and nothing else. `null` = no
         * roster read has landed (a bare mount): the pane says so.
         * @member {Number|null} rosterObservedAt_=null
         * @reactive
         */
        rosterObservedAt_: null,
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
                }, {
                    // the seat, read deliberately here and never on the roster card: its harness
                    // family in words, and for a Claude Desktop seat the one step its first launch
                    // needs. The folder itself is the Repository pane's line, never repeated here
                    ntype    : 'container',
                    cls      : ['fm-detail-seat'],
                    hidden   : true,
                    layout   : {ntype: 'vbox', align: 'stretch'},
                    reference: 'detail-seat',

                    items: [{
                        ntype    : 'component',
                        cls      : ['fm-detail-seat-family'],
                        reference: 'detail-seat-family'
                    }, {
                        ntype    : 'component',
                        cls      : ['fm-detail-seat-launch'],
                        hidden   : true,
                        reference: 'detail-seat-launch',
                        text     : 'Open the repository folder below in Claude\'s Code tab, then Start on the card.'
                    }]
                }]
            }]
        }, {
            // ONE state ledger in the pane's own freshness-pill vocabulary — the identity
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

        // shell-supplied window verbs ride the tab header bar's ACTION seam: one icon at the
        // trailing edge of the tab strip, outside the content flow — the shell shows it only
        // while the pane is away in a vessel (docked, the dock header owns pop-out);
        // the old identity-header placement floated the verb OVER the identity block at rail
        // widths. The slot stays layout-blind for the shell; this pane only picks the seam.
        this.shellTools?.length && (this.getReference('detail-tabs').headerActions = this.shellTools);
        this.getReference('detail-repo-copy').set({handler: 'onCopyRepoPath', handlerScope: this});
        const configPane = this.getReference('config-pane');

        if (configPane) {
            configPane.tenantStore = this.fleetTenants
        }
        this.applyRecord()
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
     * @summary Triggered after the roster admission instant changed — the repository pane re-ages
     * from the new observation without a record re-seat.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     * @protected
     */
    afterSetRosterObservedAt(value, oldValue) {
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
     * @summary Relay a definitions-Store switch to the lifecycle owner. Initial config assignment
     * precedes the constructed hook; that hook attaches the current Store once references exist.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetAgentDefinitions(value, oldValue) {
        this.isConstructed && this.controller.onDefinitionsStoreChange(value, oldValue)
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
     * @summary Render the record onto the header, or fall back to the honest empty state.
     *
     * The identity header: displayName is mutable display state (falling back
     * through the durable id, never blank), engineTag is subordinate session-metadata, the id is
     * always shown as the anchor, participationStatus renders as availability (not a role), and the
     * family rail + state dot mirror {@link AgentOS.view.fleet.roster.card.Container} (state gated on a wired
     * runtime source so missing evidence never renders as live).
     * @protected
     */
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
            // one resolver, three surfaces, so a resident offline on its card is offline here too
            display = SourceHealth.resolveFleetDisplayState(record),
            agentId = record.agentId ?? '';

        me.getReference('family-rail').family = record.family ?? null;

        me.getReference('state-dot').set({
            live : display.state === 'ok' && runtime.confidence === 'observed',
            state: display.state
        });

        me.getReference('detail-name').text   = record.displayName || agentId || '—';
        me.getReference('detail-engine').text = record.engineTag ?? '';
        me.getReference('detail-id').text     = agentId;

        me.applySeatRow(record);
        me.renderStateLedger(record, sources, display);

        me.getReference('detail-avatar').set({
            alt: record.displayName ?? agentId,
            src: record.avatarUrl ?? null
        });

        me.applyPaneFreshness()
    }

    /**
     * @summary The Seat row: the harness family in words, only for a REPORTED family (none renders no
     * row and no placeholder). A Claude Desktop seat with a reported folder adds the one step its first
     * launch needs, pointing at the Repository pane's path, since that Desktop cannot be launched into
     * a folder. Every value is an inert `text` node.
     * @param {Object} record The drilled-in FleetAgent record.
     * @protected
     */
    applySeatRow(record) {
        const
            me          = this,
            harnessType = typeof record.harnessType === 'string' && record.harnessType ? record.harnessType : null;

        me.getReference('detail-seat').hidden = harnessType === null;

        if (harnessType === null) return;

        me.getReference('detail-seat-family').text   = HarnessChoice.describe(harnessType) ?? harnessType;
        me.getReference('detail-seat-launch').hidden = !(harnessType === 'claude-desktop' && typeof record.repoPath === 'string' && record.repoPath)
    }

    /**
     * @summary The Copy path action: the clone path goes to the clipboard through the main thread's
     * selection of the unseen field, and the focus returns to the action.
     * @param {Object} data The click; `detail` is 0 where the keyboard pressed the action
     */
    async onCopyRepoPath(data) {
        const me = this, copy = me.getReference('detail-repo-copy'), field = me.getReference('detail-repo-field'), {windowId} = me;

        if (field.vdom.value) {
            await Neo.main.DomAccess.selectNode({id: field.id, windowId});
            await Neo.main.DomAccess.execCommand({command: 'copy', windowId});
            copy.focus(copy.id, false, true, data?.detail ? 'pointer' : 'keyboard')
        }
    }

    /**
     * @summary Render the ONE state ledger — every liveness/wiring axis once, as `axis · pill`
     * rows in the pane's own freshness-pill vocabulary, the one pill language of the pane.
     *
     * Rows, in order: the session (the resolved display state; an offline one names its reason),
     * availability (participationStatus — a known status word or no row),
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
     * @param {Object} display `SourceHealth.resolveFleetDisplayState` output `{reason, state}`.
     * @protected
     */
    renderStateLedger(record, sources, display) {
        const
            me     = this,
            ledger = me.getReference('detail-ledger'),
            rows   = [],
            row    = (axis, word, tone, title) => rows.push(
                {tag: 'span', cls: ['fm-ledger-axis'], text: axis},
                {tag: 'span', cls: ['fm-freshness', tone], text: word, ...(title ? {title} : {})}
            );

        row('session', stateLabel(display.state, display.reason),
            display.state === 'ok' || display.state === 'idle' ? 'is-fresh'
                : display.reason === 'unobserved' ? 'is-unobserved' : 'is-stale',
            stateMeaning(display.state, display.reason));

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
     * @summary Resolve what one pane's pill speaks for: its observation ledger and the descriptor
     * of the source that answered, or did not.
     *
     * An explicit `paneLedgers` entry wins (a feed stamping the pane directly). Otherwise the pane's
     * owning producer decides. The lane and repository panes read their roster-row source facts;
     * wired facts observe at the roster admission instant, any other fact is the descriptor in the
     * roster's own words, and a mount no roster read has reached says so. The pull-request pane reads
     * the record's held open work: an answer observes at its own `observedAt` and stays stale while
     * the producer says so, however recent; no answer says so in the resolver's words. The
     * thought-stream pane has no producer on this plane yet ({@link AWAITING} names it), so it
     * resolves to nothing and the pill states the honest unobserved.
     * @param {String} key Pane key.
     * @param {Object|null} explicitLedger The `paneLedgers` entry, if any.
     * @param {Object} record The drilled-in FleetAgent record (never null here).
     * @returns {{descriptor: (Object|null), ledger: (Object|null)}}
     * @protected
     */
    resolvePaneSource(key, explicitLedger, record) {
        if (explicitLedger) {
            return {descriptor: null, ledger: explicitLedger}
        }

        if (key === 'prs') {
            const {openWorkHeld} = record;

            return openWorkHeld
                ? {descriptor: null, ledger: {observedAt: openWorkHeld.observedAt, stale: openWorkHeld.stale}}
                : {descriptor: {state: 'not observed', reason: OpenWorkSeat.PANE_WORDS.unanswered}, ledger: null}
        }

        if (key !== 'repo' && key !== 'lane') {
            return {descriptor: null, ledger: null}
        }

        const fact = SourceHealth.normalizeFleetSources(record.sources)[key === 'lane' ? 'lane' : 'repoStatus'];
        const axis = key === 'lane' ? 'lane claim' : 'repository';

        if (fact.state !== 'wired') {
            // the roster's own words when it carried any; a row with no fact is normalized to
            // not-wired without one, and that absence is the reason
            return {descriptor: {state: fact.state.replace(/-/g, ' '), reason: fact.reason || `the roster row carried no ${axis} fact`}, ledger: null}
        }

        return Number.isFinite(this.rosterObservedAt)
            ? {descriptor: fact, ledger: {observedAt: new Date(this.rosterObservedAt).toISOString()}}
            : {descriptor: {state: 'unobserved', reason: 'no roster read has landed in this mount'}, ledger: null}
    }

    /**
     * @summary Render each pane's freshness chip + body content, honestly.
     *
     * Every pane header shows its observation freshness — timestamped `fresh`/`stale`/`lost` from
     * its source's ledger — or the source's own answer when it did not observe: `<state> — <reason>`
     * in the producer's words (never a generic "source not wired" once a reason exists), or
     * `unobserved` with what the pane waits for on the pill's title while no source has answered
     * at all. Never a silently-current claim.
     * @protected
     */
    applyPaneFreshness() {
        let me      = this,
            record  = me.record,
            ledgers = me.paneLedgers ?? {},
            now     = me.now ?? Date.now();

        PANES.forEach(pane => {
            const
                {descriptor, ledger} = me.resolvePaneSource(pane.key, ledgers[pane.key] ?? null, record),
                merged               = ledger ? {freshnessTtl: pane.freshnessTtl, ...ledger} : null,
                answered             = !ledger && descriptor,
                {cls, label}         = answered
                    ? {
                        cls  : ['fm-freshness', descriptor.state === 'degraded' ? 'is-stale' : 'is-unobserved'],
                        label: `${descriptor.state} — ${descriptor.reason || 'no reason given'}`
                    }
                    : AgentFreshness.describePaneFreshness(AgentFreshness.classifyPaneFreshness(merged, now)),
                // .text (never .html): reasons cross a process boundary before they reach here, so
                // they must be escaped text, never interpreted markup — no injection surface
                freshnessChip        = me.getReference(`pane-${pane.key}-freshness`);

            freshnessChip.set({cls, text: label});
            // the pill's title carries what the pill cannot show in full: the awaiting truth while
            // no source answered, the whole answer when a producer's reason elides at rail width
            // (one provenance pill per section); an attribute string is inert, like every text node
            freshnessChip.vdom.title = ledger ? null : answered ? label : AWAITING[pane.key];
            freshnessChip.update();

            me.renderPaneBody(pane.key, record)
        })
    }

    /**
     * @summary The honest body content for one pane from the record's known facts.
     *
     * The lane pane renders the lane line with its claim age when its source is wired, plus the
     * independent open-lane count. The repository pane renders the roster row's slug and its whole
     * clone path, and shows the path's Copy action only while a path is reported.
     * The pull requests pane loads the seat's held pull requests, worst first, into its list's Store,
     * or says it holds none; without an answer it renders nothing, since its pill says so. The
     * list re-words its rows' ages at the pane's clock. The thought-stream pane renders
     * nothing until its producer lands: the pill names what it waits for, and a body line repeating
     * it would tell the same fact twice per section.
     * @param {String} key Pane key.
     * @param {Object} record The drilled-in FleetAgent record (never null here).
     * @protected
     */
    renderPaneBody(key, record) {
        const body = this.getReference(`pane-${key}-body`);

        if (key === 'repo') {
            const
                repoPath = typeof record.repoPath === 'string' && record.repoPath ? record.repoPath : null,
                field    = this.getReference('detail-repo-field');

            body.vdom.cn = [
                {tag: 'span', cls: ['fm-detail-repo-slug'], text: record.repoSlug || 'no repository declared'},
                ...(repoPath ? [{tag: 'span', cls: ['fm-detail-repo-path'], text: repoPath}] : [])
            ];
            body.update();

            this.getReference('detail-repo-copy').hidden = repoPath === null;

            if (field.vdom.value !== (repoPath ?? '')) {
                field.vdom.value = repoPath ?? '';
                field.update()
            }
            return
        }

        if (key === 'lane') {
            const
                laneSource = SourceHealth.normalizeFleetSources(record.sources).lane,
                wired     = laneSource.state === 'wired',
                claimedMs = typeof record.laneClaimedAt === 'string' ? Date.parse(record.laneClaimedAt) : NaN,
                claimAge  = Number.isFinite(claimedMs)
                    ? AgentFreshness.formatAge((this.now ?? Date.now()) - claimedMs)
                    : null,
                laneLine  = record.laneLine || 'no current lane reported',
                laneCount = Number.isInteger(record.openLaneCount) && record.openLaneCount > 0 ? record.openLaneCount : null,
                countText = laneCount === null ? '' : ` · ${laneCount} open ${laneCount === 1 ? 'lane' : 'lanes'}`,
                lineText  = wired
                    ? record.laneLine ? `${record.laneLine}${claimAge ? ` · claimed ${claimAge}` : ''}` : 'no lane claimed'
                    : laneLine;

            body.text = `${lineText}${countText}`;
            return
        }

        if (key === 'prs') {
            const
                {openWorkHeld} = record,
                holds          = openWorkHeld?.rows.length > 0,
                // built for the first resident shown, so an idle cockpit carries no list
                list           = this.getReference('pr-list') ?? body.insert(0, {
                    module   : PullRequestList,
                    hidden   : !holds,
                    reference: 'pr-list',
                    store    : {module: HeldPullRequests}
                });

            list.store.data = openWorkHeld?.rows ?? [];
            list.now        = this.now ?? Date.now();
            list.hidden     = !holds;

            this.getReference('prs-none').hidden = !openWorkHeld || holds;
            return
        }

        body.text = ''
    }
}

export default Neo.setupClass(AgentDetail);
