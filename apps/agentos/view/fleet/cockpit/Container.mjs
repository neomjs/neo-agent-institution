import ActivityStream         from '../activity/Container.mjs';
import AgentDetail            from '../detail/Container.mjs';
import Button                 from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
// NAMED registration import: the engine's dock LayoutAdapter emits `ntype: 'tab-container'` for tab
// zones without importing the class itself (engine gap) — until it does, the dock consumer owns
// the registration, and the named binding keeps the dependency visible.
import TabContainer           from '../../../../../node_modules/neo.mjs/src/tab/Container.mjs';
import CatchUpPane            from '../catchup/Container.mjs';
import WorkspaceDocument      from '../../../../../node_modules/neo.mjs/src/dashboard/dock/model/WorkspaceDocument.mjs';
import DockService            from '../../../../../node_modules/neo.mjs/src/ai/client/DockService.mjs';
import VesselContainer        from './VesselContainer.mjs';
import PerspectiveLibrary     from '../../../../../node_modules/neo.mjs/src/dashboard/dock/persistence/PerspectiveLibrary.mjs';
import FleetCockpitController from './Controller.mjs';
import FleetGrid              from '../roster/Container.mjs';
import MemoriesPane           from '../memories/Container.mjs';
import OperatorMailbox        from '../mailbox/OperatorContainer.mjs';
import TasksPane              from '../tasks/Container.mjs';
import CockpitStateProvider   from './StateProvider.mjs';
import CockpitPerspectives    from '../../../util/CockpitPerspectives.mjs';
import SpineBannerComponent   from './SpineBannerComponent.mjs';
import ViewerWakeTelltaleComponent from './ViewerWakeTelltaleComponent.mjs';

/**
 * The liveness re-poll cadence (ms). Slow enough that the cockpit is not a load generator against
 * the fleet bridge, fast enough that a transport death is named while the operator is still looking
 * at the surface that died.
 * @type {Number}
 */

const livenessPollDefault = 15000;

/**
 * The bounded window (ms) a single liveness read gets before it is treated as a degrade.
 *
 * Deliberately shorter than {@link livenessPollDefault}: the window must close before the next
 * tick, or a hung read would still be holding its surface's slot when the cadence comes round.
 * @type {Number}
 */
const livenessReadTimeoutDefault = 10000;



/**
 * @summary The Fleet keeper-view — the FM cockpit's default mission-control surface (design SSOT §01),
 * composed as a LIVE DOCK PROJECTION: the fleet zone (a density-ranked card roster + the
 * scale-to-a-glance health bar) over the live activity stream in the SSOT's ~1.55fr / 1fr split,
 * with the secondary chrome panes (agent detail, perspectives) auto-hidden onto the right edge rail.
 *
 * The layout SSOT is the committed `neo.dock.zone.v1` document ({@link #dockModel}, seeded
 * from {@link module:cockpitDockDocument}); the visible tree is
 * {@link Neo.dashboard.dock.projection.LayoutAdapter}'s projection of it. The commit loop follows the proven
 * dashboard-dock pattern — a clean reducer / view-sync split:
 * - {@link #applyDockZoneOperation} is the **reducer**: a pure `Neo.dashboard.dock.model.Operations.applyOperation` over
 *   the current document — splitter drags, cross-zone tab drops and NL-driven operations all
 *   funnel through it;
 * - {@link #onDockZoneDocumentChange} is the **view-sync**: it stores the committed document and
 *   reconciles one tick deferred (the committing splitter must finish its own `onDragEnd` before
 *   its retired shell destroys it — use-after-destroy otherwise; `isDestroyed` guards teardown).
 *
 * {@link Neo.dashboard.dock.Workspace} also owns Fleet's gesture tear-out admission, exact token
 * routing, pre-terminal/committed window state, placement capture and semantic return. Fleet keeps
 * only product policy: platform window open/close, live-pane resolution, click-detail continuation,
 * control-bar observers and the click-Memories verb that enters the same engine admission path.
 *
 * Reconciliation retains existing pane and tab-chrome identities; the panes are DECLARED
 * ({@link #panes} / {@link #zones}) and the engine parks a pane that leaves the tree. Runtime pane
 * state still lives on THIS owner, never only on instances: {@link #seedPane} hands a pane created
 * now the held state it reopens on, the provider bindings carry the rest, and the panes stay
 * layout-blind per the docking design's pane contract — ordinary configs only, no dock wiring.
 *
 * The roster data layer is ONE {@link AgentOS.store.FleetRoster} Store of
 * {@link AgentOS.model.FleetAgent} records, hosted by THIS view's `state.Provider` (`stores`
 * block — the provider is the sharing scope and survives every re-projection; store classes are
 * never singletons). The provider `autoLoad`s the honestly-labelled JSON sample seed, the
 * projected {@link FleetGrid} binds the instance via `bind: {store: 'stores.fleetRoster'}`, and
 * {@link #loadRoster} re-points it at the running fleet when the registry bridge wires up. The
 * activity zone composes {@link ActivityStream} → EventChip the same way ({@link #loadActivity}).
 *
 * @class AgentOS.view.fleet.cockpit.Container
 * @extends AgentOS.view.fleet.cockpit.VesselContainer
 */
class FleetCockpit extends VesselContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.Container',
        /**
         * @member {String} ntype='fm-fleet-cockpit'
         * @protected
         */
        ntype: 'fm-fleet-cockpit',
        /**
         * Consumer identity supplements the inherited `neo-dock-workspace` override anchor.
         * @member {String[]} cls=['fm-fleet-cockpit']
         */
        cls: ['fm-fleet-cockpit'],
        /**
         * The roster-source admission mode. `sample` is the zero-call cold-first-run authority: an
         * empty first bridge answer cannot erase the honestly labelled bundled fleet. `selected`
         * means the operator/product composition explicitly chose the wired source, so even an
         * empty first snapshot is authoritative. A populated snapshot promotes this mode while
         * {@link #rosterWired} keeps every later snapshot (including empty) authoritative.
         *
         * Non-reactive on purpose: this is an ingress policy, not render state. Instance config and
         * `Neo.overwrites` may select it without introducing a hidden hardware/product constant.
         * @member {'sample'|'selected'} rosterSourceMode='sample'
         */
        rosterSourceMode: 'sample',
        /**
         * The drill-in inspector's selected resident — OWN reactive state the view genuinely
         * holds: a genuinely absent {@link AgentOS.view.fleet.detail.Container} pane
         * rematerializes at this value (`null` = the honest "select an agent" empty state), and
         * {@link #afterSetDetailRecord} pushes a LIVE pane in place. Written only through
         * {@link #applySelection} (the one selection-write site).
         * @member {Object|null} detailRecord_=null
         * @reactive
         */
        detailRecord_: null,
        /**
         * The preset switcher's refusal line (fail-closed VISIBLY: a refused restore must never
         * look like a no-op) — OWN reactive state: {@link #afterSetPresetError} renders it in
         * place, and the next successful switch clears it.
         * @member {String|null} presetError_=null
         * @reactive
         */
        presetError_: null,
        /**
         * The cockpit's pane catalog, DECLARED: one component config per stable dock item id. The
         * engine lowers the catalog fields (`reference`, `header.text` → `title`, `autoHidden`)
         * into the dock document, instantiates a pane the first time the projection needs it, and
         * parks one that leaves the tree (a released reveal, a perspective switch) — returned,
         * never re-created. `reference` is the record's own name, lowered onto the pane.
         *
         * Static by construction: modules, provider bindings and string handlers. What a pane
         * needs only at its FIRST creation is instance-bound and joins through {@link #seedPane}.
         * @member {Object} panes
         */
        panes: {
            fleet: {
                module   : FleetGrid,
                header   : {text: 'Fleet'},
                reference: 'fleet-grid',
                bind     : {
                    adapterState      : data => data.gridAdapterState,
                    daemonFault       : data => data.daemonFault,
                    presenceCapability: data => data.presenceCapability,
                    store             : 'stores.fleetRoster'
                },
                // the bootstrap CTA (an empty fleet's path to its first agent) and the selection
                // seam's drill (the roster controller wrote the provider truth pair; this listener
                // drives the detail reveal)
                listeners: {addAgentRequest: 'onAddAgentRequest', agentSelect: 'onAgentSelect'}
            },
            stream: {
                module   : ActivityStream,
                header   : {text: 'Activity'},
                reference: 'activity-stream',
                bind     : {
                    adapterState: data => data.streamAdapterState,
                    counts      : data => data.activityCounts,
                    store       : 'stores.fleetActivityEvents'
                }
            },
            // south reading surfaces: per-agent session-summary recall, the WHAT axis of mission
            // control, the operator's own mailbox + compose surface, and the historical Bird-View
            // complement to the bounded Activity stream — resident tabs beside it, never rail-squeezed
            memories: {
                module   : MemoriesPane,
                header   : {text: 'Memories'},
                reference: 'memories',
                listeners: {
                    memoriesRequest     : 'onMemoriesRequest',
                    sessionDetailRequest: 'onSessionDetailRequest',
                    sessionDetailClosed : 'onSessionDetailClosed'
                }
            },
            tasks: {
                module   : TasksPane,
                header   : {text: 'Tasks'},
                reference: 'tasks',
                listeners: {tasksRequest: 'onTasksRequest'}
            },
            operator: {
                module   : OperatorMailbox,
                header   : {text: 'Mailbox'},
                reference: 'operator-mailbox',
                listeners: {compose: 'onOperatorCompose', inboxPageRequest: 'onOperatorInboxPageRequest'}
            },
            catchUp: {
                module   : CatchUpPane,
                header   : {text: 'Catch up'},
                reference: 'catch-up',
                listeners: {
                    historyRequest     : 'onCatchUpHistoryRequest',
                    markCaughtUpRequest: 'onCatchUpMarkRequest',
                    liveSurfaceRequest : 'onCatchUpLiveSurfaceRequest'
                }
            },
            // the inspector and the invoked tools: auto-hidden onto the right edge's rail
            detail: {
                // EAGER by contract: the vessel layer adopts and re-adopts THIS live instance
                // synchronously (park → window → reattach); a lazy module resolves through an async
                // placeholder the vessel flow cannot carry
                module    : AgentDetail,
                header    : {text: 'Agent detail'},
                reference : 'agent-detail',
                autoHidden: true
            },
            perspectives: {
                module    : () => import('../perspectives/Container.mjs'),
                header    : {text: 'Perspectives'},
                reference : 'perspectives',
                autoHidden: true,
                bind      : {
                    activePerspective: data => data.dock.perspective.active,
                    perspectives     : data => data.perspectives
                },
                listeners : {perspectiveRequest: 'onPerspectiveRequest'}
            },
            // S5 define-agent (design ruling on record: rail placement, invoked-not-ambient) — the
            // add-agent flow rides the same autoHidden tool chrome as perspectives; the pane answers
            // to the record's own name, the former `add-agent-form` alias is gone with the resolver
            defineAgent: {
                module    : () => import('../instances/AddAgentForm.mjs'),
                header    : {text: 'Add agent'},
                reference : 'define-agent',
                autoHidden: true,
                listeners : {agentDefinitionAccepted: 'up.onAgentDefinitionAccepted'}
            },
            wakeRoutes: {
                module    : () => import('../wake/Container.mjs'),
                header    : {text: 'Wake routes'},
                reference : 'wakeRoutes',
                autoHidden: true,
                listeners : {wakeRoutesRequest: 'onWakeRoutesRequest'}
            }
        },
        /**
         * The cockpit's arrangements, DECLARED — the SSOT §01 duties (Overview · Focus · Review) as
         * named `zones` over the one pane catalog, selected through the engine's
         * {@link #activePerspective}. The trees and their rationale live with
         * {@link AgentOS.util.CockpitPerspectives#declare}.
         * @member {Object} perspectives=CockpitPerspectives.declare()
         */
        perspectives: CockpitPerspectives.declare(),
        /**
         * The boot duty. The engine restores a declared name through the ordinary commit path and
         * publishes the committed one as `dock.perspective.active`, which the preset bar and the
         * perspectives drawer bind — a switch from any writer presses the right button.
         * @member {String} activePerspective='Overview'
         * @reactive
         */
        activePerspective: 'Overview',
        /**
         * The B4÷C2 composition root: catches each card's `lifecycleIntent` and the whole-fleet
         * "▶ Start fleet" click, driving both through the C2 adapter to honest per-card
         * round-trip state. See {@link AgentOS.view.fleet.cockpit.Controller}.
         * @member {Neo.controller.Component} controller=FleetCockpitController
         */
        controller: FleetCockpitController,
        /**
         * The cockpit's state scope — shared render truths + formulas + the provider-owned
         * stores; see {@link AgentOS.view.fleet.cockpit.StateProvider}.
         * @member {Neo.state.Provider} stateProvider=CockpitStateProvider
         * @reactive
         */
        stateProvider: CockpitStateProvider,
        /**
         * Vertical stack: the control bar over the dock projection (which owns the fleet-over-
         * activity split per the committed document).
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The persistent chrome, DECLARED: every slot the cockpit always owns — the banner and
         * telltale are real component classes whose slots bind provider truth (each channel a
         * first-class config); handlers are controller-resolved strings. Static child items bind
         * under the child provider (reviewer positive control + live re-measurement, 2026-08-29
         * — the earlier add()-path workaround rested on a misattributed root cause). The preset
         * buttons are declared too, pressed by the engine's published `dock.perspective.active`
         * ({@link AgentOS.util.CockpitPerspectives#buttons}); runtime injection stays limited to
         * the one genuinely dynamic member, the dock projection shell (document-derived,
         * instance-bound callbacks).
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'toolbar',
            cls      : ['fm-cockpit-bar'],
            flex     : 'none',
            reference: 'fleet-control-bar',
            items    : [...CockpitPerspectives.buttons(), {
                // exception chrome for the VIEW class: the perspective-restore refusal line
                // renders beside its source, the declared preset buttons
                ntype    : 'component',
                cls      : ['fm-preset-error'],
                hidden   : true,
                reference: 'fleet-preset-error'
            },
            '->',
            {
                // THE STATE BLOCK — the bar's structural law: state never sits between action
                // buttons; the two spine axes (fleet · wake) render as one right-aligned block
                // before the action group. Wide bars stack the pills vertically (the band's
                // vertical space is there), mid widths run them in a row, narrow widths drop to
                // dots-with-titles — the collapse order is a container query in the cockpit
                // SCSS, never measured here.
                ntype: 'container',
                cls  : ['fm-bar-state'],
                // Both pills size to their words: the block's flexbox layout would otherwise
                // write `flex: 1 1 0%` onto each child, which splits the row form's width equally
                // and clipped the longer pill mid-word while the shorter one held slack.
                items: [{
                    // the per-SPINE honesty pill — the derived spineBanner leaves bind here at
                    // the consumption site; status word visible, full sentence on title/aria
                    module   : SpineBannerComponent,
                    bind     : {
                        bannerAriaLabel: data => data.spineBanner.ariaLabel,
                        bannerTitle    : data => data.spineBanner.title,
                        cls            : data => [`fm-spine-banner-${data.spineBanner.kind}`],
                        hidden         : data => data.spineBanner.hidden,
                        text           : data => data.spineBanner.text
                    },
                    flex     : '0 1 auto',
                    reference: 'fleet-spine-banner'
                }, {
                    // the per-viewer wake-push telltale — every channel of the derived chip binds
                    // here as its own first-class config (text, cls, title, aria — independently
                    // reactive; see the component class)
                    module   : ViewerWakeTelltaleComponent,
                    bind     : {
                        chipAriaLabel: data => data.viewerWakeTelltale.ariaLabel,
                        chipTitle    : data => data.viewerWakeTelltale.title,
                        cls          : data => data.viewerWakeTelltale.cls.slice(1),
                        text         : data => data.viewerWakeTelltale.text
                    },
                    flex     : '0 1 auto',
                    reference: 'viewer-wake-telltale'
                }]
            }, {
                // the banner's manual recovery affordance: one click re-drives every liveness
                // seam through the existing authenticated bridge — no reload, no new transport.
                // Visibility IS the banner verdict, bound from the same formula. First of the
                // ACTION group — contextual: it exists only while the fleet pill shows.
                module   : Button,
                bind     : {hidden: data => data.spineBanner.hidden},
                cls      : ['fm-reconnect-button'],
                handler  : 'reconnectFleet',
                iconCls  : 'fa-solid fa-rotate',
                reference: 'fleet-reconnect-button',
                text     : 'Reconnect'
            }, {
                // The fleet-start outcome summary — written by the controller after the staged
                // bring-up settles ("N started · U UNKNOWN · M rejected · K excluded"; per-member
                // reasons ride the title). Empty + hidden until a start ran; renders beside the
                // start verb whose outcome it reports.
                ntype    : 'component',
                cls      : ['fm-fleet-start-summary'],
                hidden   : true,
                reference: 'fleet-start-summary'
            }, {
                // exception-only chrome (the banner's class): each recall verb renders ONLY
                // while its pane is away in a vessel — the pane carries its own toggle, but a
                // windowed pane leaves the main view with no way home without this. Nominal
                // state costs zero pixels; `removeDom` keeps the class-based selectors honest.
                module   : Button,
                cls      : ['fm-memories-window-toggle'],
                handler  : 'onMemoriesWindowToggle',
                hidden   : true,
                hideMode : 'removeDom',
                iconCls  : 'fa-solid fa-arrow-down-left',
                reference: 'memories-recall-chrome',
                text     : 'Return memories'
            }, {
                module   : Button,
                cls      : ['fm-detail-window-toggle'],
                handler  : 'onDetailWindowToggle',
                hidden   : true,
                hideMode : 'removeDom',
                iconCls  : 'fa-solid fa-arrow-down-left',
                reference: 'detail-recall-chrome',
                text     : 'Reattach detail'
            }, {
                module : Button,
                cls    : ['fm-fleet-start'],
                handler: 'onStartFleet',
                iconCls: 'fa-solid fa-play',
                text   : 'Start fleet'
            }]
        }],
        /**
         * The persistent control bar sits at index 0; the inherited projected shell follows it.
         * @member {Number} dockShellIndex=1
         */
        dockShellIndex: 1,
        /**
         * The inherited shell shares the root vbox with the persistent control bar.
         * @member {Object} dockProjectionConfig={flex:1}
         */
        dockProjectionConfig: {flex: 1},
        /**
         * Fleet is the first zero-grant consumer of the engine-owned tear-out lifecycle.
         * @member {Boolean} enableDockTearOutLifecycle=true
         */
        enableDockTearOutLifecycle: true,
        /**
         * Preserve the shipped widget-vessel URL contract while the engine remains product-neutral.
         * @member {String} tearOutHostParam='cockpitId'
         */
        tearOutHostParam: 'cockpitId',
        /**
         * The projected dock shell sits after the control bar (`items[0]`); every committed
         * document re-projects it in place there.
         * @member {Number} dockShellIndex=1
         */
        dockShellIndex: 1,
        /**
         * The shell fills the column under the control bar.
         * @member {Object} dockProjectionConfig={flex:1}
         */
        dockProjectionConfig: {flex: 1}
    }

    /**
     * The capture library — a {@link Neo.dashboard.dock.persistence.PerspectiveLibrary} over a
     * workspace-scope collection that seeds EMPTY and holds what the operator captures from the live
     * layout. The duties are declared perspectives the engine selects, never records here;
     * {@link #dockModel} stays the LIVE layout SSOT — a capture is a snapshot the switch restores from.
     * @member {Neo.dashboard.dock.persistence.PerspectiveLibrary|null} perspectiveStore=null
     * @protected
     */
    perspectiveStore = null
    /**
     * The cap on concurrent UNDERLYING reads per surface. Above one so a permanently hung read cannot
     * consume the last slot and stop liveness; small so a hung wire cannot accumulate. Injectable so
     * witnesses pin it instead of inferring it.
     * @member {Number} maxReadsInFlight=2
     * @protected
     */
    maxReadsInFlight = 2
    /**
     * The liveness re-poll cadence (ms). Injectable so specs pin a deterministic cadence instead of
     * sleeping on the production one.
     * @member {Number} livenessPollInterval=livenessPollDefault
     * @protected
     */
    livenessPollInterval = livenessPollDefault
    /**
     * The bounded window (ms) ONE liveness read gets before it is treated as a degrade. Boundedness
     * is the contract — a read may fail, it may never hang — the same shape and the same reason as
     * the engine's bounded vessel admission. Injectable so specs pin a short window instead of
     * sleeping on the production one.
     * @member {Number} livenessReadTimeout=livenessReadTimeoutDefault
     * @protected
     */
    livenessReadTimeout = livenessReadTimeoutDefault
    /**
     * Injectable connection catch-up seam, passed through to the stream consumer's `pollDigest`
     * option when supplied. The browser page holds no plane credential BY DESIGN (mints live in
     * transport closures), so no default exists here: compositions that own a plane-side
     * poll-digest authority (tests, tooling hosts) inject it; every other topology renders the
     * consumer's honest catch-up absence instead of a fabricated drain.
     * @member {Function|null} wakePollDigest=null
     */
    wakePollDigest = null
    /**
     * The cockpit-owned dock seam instance — the SAME `execute_dock_operation` path a live
     * agent drives, injected into the tour runner so scripted ops and agent ops are one code
     * path (this holder already implements the full contract: `getDockZoneDocument` /
     * `applyDockZoneOperation` / `onDockZoneDocumentChange`).
     * @member {Neo.ai.client.DockService|null} dockService=null
     * @protected
     */
    dockService = null
    /**
     * The share beat's v1 artifact: the exported perspective record as a JSON string. The v1
     * transfer boundary is the Neural Link property read (an agent on the shared heap reads
     * this member and imports it on another cockpit) — deliberately NOT a UI copy affordance
     * yet, and no backend by design. The import cue consumes it; the e2e leg asserts round-trip
     * fingerprint equality through it.
     * @member {String|null} sharedPerspectiveArtifact=null
     */
    sharedPerspectiveArtifact = null

    /**
     * The identity of the last perspective list written into provider data — the guard that keeps
     * {@link #publishPerspectives} idempotent across dock refreshes.
     * @member {String|null} publishedPerspectives=null
     */
    publishedPerspectives = null

    /**
     * @summary The one service member the cockpit composes at construct. The layout SSOT is the
     * engine's: `panes` + `zones` lower into {@link #dockModel} in `onAfterConstructed`; nothing
     * is seeded here.
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        this.dockService = Neo.create(DockService, {})
    }

    /**
     * @summary The first projection over the ACTIVE document and the empty capture library. The
     * engine has seeded {@link #dockModel} by now — the active declared perspective lowered over
     * `panes`, or a supplied document, which wins over the declaration and stays active. The
     * cockpit is the app's main view, so its shell projects eagerly (the resident panes exist at
     * boot, before the bridge answers) into the slot `dockShellIndex` names after the control bar;
     * the engine's mount-time pass finds it there and leaves it. The duties are declared
     * perspectives the engine selects, never records; the drawer's binding source (the projected
     * list) is written once the library exists.
     * @protected
     */
    onAfterConstructed() {
        super.onAfterConstructed();

        let me = this;

        me.add(me.projectDockModel());
        me.perspectiveStore = Neo.create(PerspectiveLibrary, {collection: CockpitPerspectives.emptyCollection()});
        me.publishPerspectives()
    }

    /**
     * Triggered after the detailRecord config got changed — push the LIVE detail pane in place
     * (docked or vesseled, through the phase-blind accessor). Dock rematerialization reads the
     * config directly at projection time.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetDetailRecord(value, oldValue) {
        oldValue !== undefined && this.getAgentDetailPane()?.set({record: value ?? null})
    }

    /**
     * Triggered after the presetError config got changed — render the refusal line in place.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetPresetError(value, oldValue) {
        this.getReference('fleet-preset-error')?.set({
            hidden: !value,
            text  : value || ''
        })
    }

    /**
     * Triggered after the activePerspective config got changed — the accepted intent's hook,
     * reached by every writer (a preset click, the Neural Link, a peer's code), so the app's
     * preparation runs here, BEFORE the engine restores: a declared arrangement that reveals the
     * inspector seats a cold selection ({@link #seatInspector}).
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetActivePerspective(value, oldValue) {
        this.seatInspector(this.perspectiveSelection?.document(value));
        super.afterSetActivePerspective(value, oldValue)
    }

    /**
     * @summary Switches the cockpit to a named perspective. A DECLARED name is an
     * {@link #activePerspective} write: the engine restores it through the ordinary commit path
     * (the switch re-projects FLIP-animated like any committed operation, reduced motion
     * collapsing through the token layer) and treats the active name as a reset of its
     * arrangement. A stored SNAPSHOT (a capture) restores through the library's fail-closed path
     * instead: validate everything before mutating anything, so a refused restore leaves the live
     * layout byte-untouched. An unknown name is a refusal too, and so is a projection that
     * rejects: on both paths the verdict settles with the commit's projection and never claims a
     * switch the shell did not make.
     *
     * Pane continuity across a switch preserves component identity — a declared pane the switch
     * un-trees is parked, one it re-trees returns as the same instance; a surface created now
     * reopens on OWNER-held state ({@link #seedPane}) — while the provider-owned roster store
     * never restarts. A perspective that reveals the inspector seats a cold selection first
     * ({@link #seatInspector}); a live pane updates in place through the select seam's owner
     * accessor.
     * @param {String} name A declared perspective's name, or a capture's `perspectiveName` / `layoutId`.
     * @returns {Promise<{switched: Boolean, errors: String[]}>} settled with the commit's projection
     */
    async activatePerspective(name) {
        let me       = this,
            declared = me.perspectiveSelection?.document(name) ?? null,
            document = declared,
            errors   = [];

        if (!declared) {
            ({document, errors} = me.perspectiveStore.loadPerspective(name));

            if (errors.length) {
                return me.refusePerspective(name, errors)
            }
        }

        me.presetError = null;

        if (declared) {
            if (name === me.activePerspective) {
                // a reset never writes the config, so the setter hook does not seat for it
                me.seatInspector(document);
                ({errors} = await me.resetPerspective())
            } else {
                // the write reaches afterSetActivePerspective, which seats before the engine restores
                me.activePerspective = name;
                ({errors} = await me.perspectiveSelection.pending)
            }
        } else {
            me.seatInspector(document);

            try {
                await me.onDockZoneDocumentChange(document)
            } catch (error) {
                errors = [error.message]
            }
        }

        if (errors.length) {
            return me.refusePerspective(name, errors)
        }

        return {errors: [], switched: true}
    }

    /**
     * @summary A refused switch, rendered: the live layout stays what it is and the reason lands
     * in the bar beside the presets.
     * @param {String} name
     * @param {String[]} errors
     * @returns {{switched: Boolean, errors: String[]}}
     * @protected
     */
    refusePerspective(name, errors) {
        this.presetError = `${name}: ${errors[0]}`;
        this.syncControlBar();
        return {errors, switched: false}
    }

    /**
     * @summary A perspective that reveals the inspector must not land on the empty state: a cold
     * entry (nothing inspected yet) seats the roster's first resident through the ONE
     * selection-write site, so the provider pair and the memories write-through follow exactly
     * like an operator click would; a prior selection stays the owner-held truth. Runs before the
     * commit re-projects, so the materializing pane reads the seat — a parked one takes it through
     * the {@link #detailRecord} hook. The placement decides what reveals, not the shared
     * `autoHidden` flag ({@link AgentOS.util.CockpitPerspectives#revealsInspector}).
     * @param {Object|null} document The document about to commit; nothing declared seats nothing.
     * @protected
     */
    seatInspector(document) {
        let me = this, controller;

        if (document && CockpitPerspectives.revealsInspector(document) && !me.detailRecord) {
            controller = me.getController();
            controller.applySelection(controller.resolveFleetRosterStore()?.first() ?? null)
        }
    }

    /**
     * @summary The share beat's EXPORT half: serializes the named stored perspective to the v1
     * artifact — one copyable JSON string held on the instance (no backend by design; the e2e
     * leg asserts round-trip fingerprint equality through it).
     * @param {String} name The stored perspective's name.
     * @returns {{exported: Boolean, errors: String[]}}
     */
    exportPerspectiveArtifact(name) {
        let me     = this,
            stored = me.perspectiveStore.getPerspective(name);

        if (!stored) {
            return {errors: [`perspective "${name}" is not stored`], exported: false}
        }

        me.sharedPerspectiveArtifact = JSON.stringify(stored.layout);
        return {errors: [], exported: true}
    }

    /**
     * @summary The share beat's IMPORT half: admits the held JSON artifact back through the
     * store's full validation path (`savePerspective` re-validates via the landed restore
     * gate — a malformed artifact is refused, the live layout untouched).
     * @returns {{imported: Boolean, errors: String[]}}
     */
    importPerspectiveArtifact() {
        let me = this,
            record;

        if (!me.sharedPerspectiveArtifact) {
            return {errors: ['no exported artifact is held'], imported: false}
        }

        try {
            record = JSON.parse(me.sharedPerspectiveArtifact)
        } catch (e) {
            return {errors: [`artifact is not valid JSON: ${e.message}`], imported: false}
        }

        let {saved, errors} = me.perspectiveStore.savePerspective(record, {replace: true});

        saved && me.syncControlBar();
        return {errors, imported: saved}
    }

    /**
     * @summary On construct, bind the fleet surfaces to their live feeds, and guard the roster
     * store's async seed load against clobbering a faster live source.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        let me = this;

        // the listener authority is the provider-owned Store, same as every roster read/write —
        // it exists (and keeps reconciling) whether or not the grid projection currently does
        const controller0 = me.getController();

        controller0.resolveFleetRosterStore()?.on({load: controller0.onRosterStoreLoad, recordChange: controller0.onDetailRecordChange, scope: controller0});

        const controller = me.getController();

        controller.loadActivity();
        controller.loadRoster();
        controller.loadTasks();
        controller.loadOperatorIdentity();
        controller.startLiveness();
        controller.ensureViewerWakeStream()
    }

    /**
     * Maps the engine's pre-projection chrome hook onto Fleet's persistent control bar.
     * @param {Object} document
     * @param {Object} refreshOptions
     * @protected
     */
    beforeRefreshDockWorkspace(document, refreshOptions) {
        this.syncControlBar()
    }

    /**
     * @summary Publishes the perspective list once a refresh has SETTLED — never from the
     * pre-projection hook. The perspectives drawer is a reveal pane inside the dock host and
     * re-renders its cards when the projected list moves; doing that while the host's own update
     * is still in flight stalled the refresh chain (every later dock operation waits on the
     * previous refresh), measured with the drawer open: no preset switch, no rail switch, until
     * the publish moved here.
     * @param {Object} data The engine's settled-refresh envelope.
     */
    afterRefreshDockWorkspace(data) {
        this.publishPerspectives()
    }

    /**
     * @summary Synchronizes the persistent control bar's refusal line and vessel chrome onto a
     * fresh projection — the preset buttons need nothing here: they are bound.
     */
    syncControlBar() {
        let me = this;

        // re-assert the refusal line onto a freshly projected error slot (the afterSet hook owns
        // CHANGES; a re-projection needs the standing value re-rendered)
        me.afterSetPresetError(me.presetError, null);
        me.syncVesselChrome()
    }

    /**
     * @summary Project the perspective list into provider data (`perspectives`): the declared
     * duties first, as rows the drawer can apply, then the captures beside them — the drawer and
     * any other reader bind to it, so nothing outside this cockpit reaches into the library. Which
     * row is live is not in this list: the engine publishes `dock.perspective.active`, and the
     * drawer binds that leaf directly. Runs with every settled refresh and once more with the
     * capture verdict, which rides the projection rather than a side channel.
     * @param {Object|null} [captureResult=null] The latest capture verdict, or `null`.
     */
    publishPerspectives(captureResult = null) {
        let me       = this,
            provider = me.getStateProvider(),
            next     = {
                // one string leaf, never a nested verdict object: provider data drills plain objects
                // into leaf paths, and a verdict under a `null` leaf never reads back
                captureNote: !captureResult
                    ? null
                    : captureResult.saved
                        ? `captured "${captureResult.name ?? captureResult.layoutId}" — apply it from its card`
                        : `capture refused: ${captureResult.errors?.[0] ?? 'unnamed reason'}`,
                items      : [...CockpitPerspectives.rows(), ...(me.perspectiveStore?.list?.() || [])]
            },
            identity = JSON.stringify(next);

        // Idempotent on purpose: the chrome hook republishes on EVERY dock refresh, and a fresh
        // object per refresh would re-render the drawer (and re-enter the projection it binds
        // into) for a list that did not move. Only a changed list or verdict writes.
        if (provider && identity !== me.publishedPerspectives) {
            me.publishedPerspectives = identity;
            provider.setData({perspectives: next})
        }
    }

    /**
     * @summary Resolve one provider-hosted Store by name for the inspector's configuration tab
     * (`agentDefinitions`, the Viewport's exact public `fleetTenants`) — the sanctioned
     * `getStateProvider().getStore()` access, degraded to `null` when no chain or no hosting
     * provider exists (bare unit mounts): the tab renders its honest empty state rather than
     * demanding a provider, and no cockpit-local copy is invented.
     * @param {String} name
     * @returns {Neo.data.Store|null}
     */
    resolveProviderStore(name) {
        try {
            return this.getStateProvider()?.getStore(name) ?? null
        } catch {
            return null
        }
    }

    /**
     * @summary Resolves one dock item to its pane — the engine's declared instance while it is
     * alive (parked or projected), a fresh config from the declaration when it is not — with the
     * two responsibilities that stay the cockpit's:
     *
     * 1. a vesseled item's live pane is owner-held (mid-gesture, mid-admission or adopted into
     *    its window): a preset restore (or NL addTab) re-treeing the item while away must not
     *    steal or duplicate the instance — an honest stand-in holds the slot, and the engine's
     *    return hands the SAME live pane back to the projection when the vessel dies;
     * 2. a pane created NOW carries its instance-bound seeds ({@link #seedPane}).
     *
     * Panes stay layout-blind per the docking design's pane contract; the FLIP marker is the
     * engine's decoration around this hook. Optional-chained like every sibling field read: the
     * projection specs drive these prototype methods over controlled state.
     * @param {String} itemId The stable workspace identity from the item catalog.
     * @param {Object} item The persisted item record.
     * @returns {Object|Neo.component.Base}
     */
    resolvePane(itemId, item) {
        let me = this;

        if (me.isVesselOwned?.(itemId) || me.isVesselPending?.(itemId)) {
            return {
                ntype: 'component',
                cls  : ['fm-pane-placeholder'],
                html : `${item?.title ?? item?.reference ?? itemId} is open in its own window`
            }
        }

        return me.seedPane(itemId, super.resolvePane(itemId, item))
    }

    /**
     * @summary The recreate path (a failed projection's fresh candidate) seeds like a first
     * creation — a rebuilt pane reopens on the owner's held state, never a blank claim.
     * @param {String} itemId
     * @param {Object} item
     * @returns {Object|Neo.component.Base}
     */
    resolveFreshPane(itemId, item) {
        return this.seedPane(itemId, super.resolveFreshPane(itemId, item))
    }

    /**
     * @summary Which declared panes the projection PARKS when they leave the tree — kept, returned
     * as the same instance — rather than retires: the rail's inspector and invoked tools, so a
     * perspective switch or a reveal/hide cycle never rebuilds the inspector. The south reading
     * surfaces rematerialize from their seeds instead: their engine grids repaint the row pool
     * they last painted when a parked pane remounts after its store emptied (grid remount,
     * defect-noted), so until that lands a closed reading surface is rebuilt on reopen — the
     * pre-declaration behavior, seeded by {@link #seedPane}. The engine merges the tear-out
     * owner's held panes separately, so a vesseled pane stays preserved whatever this answers.
     * @returns {String[]}
     * @protected
     */
    getPreservedItemIds() {
        return ['detail', 'perspectives', 'defineAgent', 'wakeRoutes'].filter(itemId => this.dockModel?.items?.[itemId])
    }

    /**
     * @summary The instance-bound half of a declared pane's config, applied to a fresh CONFIG only
     * (a live instance, parked or projected, keeps its own state): the owner-held snapshots a
     * pane reopens on — never a blank claim —, the selected resident, the inspector's stores, the
     * shell-owned window toggles, and the listener scope. The scope is load-bearing: a vesseled
     * pane (click pop-out / gesture tear-out) has no controller above it, so an unscoped string
     * handler resolves dead there (a TypeError per fire). The roster's intents resolve through
     * the roster's own controller chain and `define-agent` walks the component chain (`up.`), so
     * those two stay unscoped.
     * @param {String} itemId
     * @param {Object|Neo.component.Base} candidate The engine's answer.
     * @returns {Object|Neo.component.Base} The candidate, seeded when it is a fresh config.
     * @protected
     */
    seedPane(itemId, candidate) {
        if (!candidate || candidate.constructor !== Object) {
            return candidate
        }

        let me         = this,
            controller = me.getController(),
            seeds      = null;

        switch (itemId) {
            case 'stream':
                seeds = {actorDirectory: controller.buildActivityActorDirectory()};
                break;
            case 'detail':
                // the stores resolved imperatively keep the view provider-agnostic; the selected
                // resident is OWNER-held so a pane created from true absence never drops the
                // selection; the pop-out verb is SHELL-owned config through the `shellTools` slot
                seeds = {
                    agentDefinitions: me.resolveProviderStore('agentDefinitions'),
                    fleetTenants    : me.resolveProviderStore('fleetTenants'),
                    record          : me.detailRecord,
                    shellTools      : [me.buildDetailWindowToggle()]
                };
                break;
            case 'operator':
                seeds = {
                    record          : controller.operatorRecord,
                    snapshot        : controller.operatorSnapshot,
                    recipientOptions: controller.buildOperatorRecipientOptions(),
                    identityPosture : controller.operatorIdentityPosture
                };
                break;
            case 'catchUp':
                seeds = {
                    snapshot        : controller.catchUpSnapshot,
                    markOutcome     : controller.catchUpMarkOutcome,
                    partitionOptions: controller.buildCatchUpPartitionOptions()
                };
                break;
            case 'memories':
                // the selected target travels WITH the snapshot (one coherent state key), so a
                // rematerialized pane never shows cards no selection points at; the target is the
                // roster SELECTION's write-through ({@link #applySelection}), the cockpit's one picker
                seeds = {
                    activeAgent  : controller.memoriesTarget ?? controller.memoriesSnapshot?.target ?? null,
                    snapshot     : controller.memoriesSnapshot,
                    drillSession : controller.memoriesDrillSession,
                    drillSnapshot: controller.memoriesDrillSnapshot,
                    shellTools   : [me.buildMemoriesWindowToggle()]
                };
                break;
            case 'wakeRoutes':
                seeds = {snapshot: controller.wakeRoutesSnapshot};
                break;
            case 'tasks':
                seeds = {snapshot: controller.tasksSnapshot};
                break;
        }

        seeds && Object.assign(candidate, seeds);

        if (candidate.listeners && itemId !== 'fleet' && itemId !== 'defineAgent') {
            candidate.listeners = {...candidate.listeners, scope: controller}
        }

        return candidate
    }

    /**
     * @summary Detach Fleet-owned feeds and layout services; the inherited vessel layer retires
     * detached/torn panes and their windows, and the engine workspace retires its worker
     * listeners, gesture vessels, captured panes and drop producer exactly once.
     * @param {...*} args
     */
    destroy(...args) {
        let me = this;

        const controller = me.getController();

        controller.resolveFleetRosterStore()?.un({load: controller.onRosterStoreLoad, recordChange: controller.onDetailRecordChange, scope: controller});

        me.dockService?.destroy();
        me.dockService = null;
        me.perspectiveStore?.destroy();
        me.perspectiveStore = null;
        super.destroy(...args)
    }
}

export default Neo.setupClass(FleetCockpit);
