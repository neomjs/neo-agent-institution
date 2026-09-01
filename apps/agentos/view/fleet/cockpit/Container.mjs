import ActivityStream         from '../activity/Container.mjs';
import AgentDetail            from '../detail/Container.mjs';
import Button                 from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
// NAMED registration import: the engine's dock LayoutAdapter emits `ntype: 'tab-container'` for tab
// zones without importing the class itself (engine gap) — until it does, the dock consumer owns
// the registration, and the named binding keeps the dependency visible.
import TabContainer           from '../../../../../node_modules/neo.mjs/src/tab/Container.mjs';
import CatchUpPane            from '../catchup/Container.mjs';
import Document               from '../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Document.mjs';
import DockService            from '../../../../../node_modules/neo.mjs/src/ai/client/DockService.mjs';
import VesselContainer        from './VesselContainer.mjs';
import PerspectiveLibrary     from '../../../../../node_modules/neo.mjs/src/dashboard/dock/persistence/PerspectiveLibrary.mjs';
import FleetCockpitController from './Controller.mjs';
import FleetGrid              from '../roster/Container.mjs';
import MemoriesPane           from '../memories/Container.mjs';
import OperatorMailbox        from '../mailbox/OperatorContainer.mjs';
import TasksPane              from '../tasks/Container.mjs';
import CockpitStateProvider   from './StateProvider.mjs';
import CockpitDockDocument    from '../../../util/CockpitDockDocument.mjs';
import CockpitPresets         from '../../../util/CockpitPresets.mjs';
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
 * Reconciliation retains existing pane and tab-chrome identities. Runtime pane state still lives
 * on THIS owner, never only on instances: {@link #resolveDockComponentRef} materializes genuinely
 * absent panes from held state ({@link #gridAdapterState} / {@link #streamAdapterState}) and the
 * provider-owned activity Store, and the panes stay layout-blind per the docking design's pane contract —
 * ordinary configs only, no dock wiring reaches them.
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
         * — the earlier add()-path workaround rested on a misattributed root cause). Runtime
         * injection stays limited to the two genuinely dynamic members: the preset switcher
         * (store-derived, {@link #syncPresetButtons}) and the dock projection shell
         * (document-derived, instance-bound callbacks).
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'toolbar',
            cls      : ['fm-cockpit-bar'],
            flex     : 'none',
            reference: 'fleet-control-bar',
            items    : [{
                // exception chrome for the VIEW class: the preset-restore refusal line renders
                // beside its source (the preset buttons the controller inserts ahead of it)
                ntype    : 'component',
                cls      : ['fm-preset-error'],
                hidden   : true,
                reference: 'fleet-preset-error'
            },
            '->',
            {
                // THE STATE BLOCK — the #23 structural law: state never sits between action
                // buttons; the two spine axes (fleet · wake) render as one right-aligned block
                // before the action group. Wide bars stack the pills vertically (the band's
                // vertical space is there), mid widths run them in a row, narrow widths drop to
                // dots-with-titles — the collapse order is a container query in the cockpit
                // SCSS, never measured here.
                ntype: 'container',
                cls  : ['fm-bar-state'],
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
        tearOutHostParam: 'cockpitId'
        // the persistent chrome is DECLARED in `items` above; only the dock projection joins at
        // construct() — it carries the instance-bound applyDockZoneOperation +
        // onDockZoneDocumentChange callbacks the resize commit loop needs.
    }

    /**
     * The named preset library — a {@link Neo.dashboard.dock.persistence.PerspectiveLibrary} over the seeded
     * workspace-scope collection ({@link module:cockpitPresets}). The library is the preset SSOT;
     * {@link #dockModel} stays the LIVE layout SSOT — presets are snapshots the switch restores
     * from, never live-bound mirrors.
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
     * {@link #detailVesselConnectWindowMs}. Injectable so specs pin a short window instead of
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
     * @summary Seed the layout SSOT and add the ONE instance-bound member — the dock projection
     * (its commit-loop callbacks bind this instance, so it cannot live in the static config; the
     * persistent chrome is declared there).
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        let me = this;

        me.dockService         = Neo.create(DockService, {});
        me.perspectiveStore    = Neo.create(PerspectiveLibrary, {collection: CockpitPresets.create()});
        me.dockModel           = me.dockModel || CockpitDockDocument.create();

        me.add(Object.assign(me.projectDockModel(), {flex: 1}));
        me.syncPresetButtons()
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
     * @summary Reconcile the preset switcher — the one store-derived chrome member — into the
     * DECLARED control bar: existing buttons update `pressed` in place, missing ones are inserted
     * ahead of the static slots. `presetName` rides each button so the controller relay activates
     * the right perspective without a per-button closure.
     * @protected
     */
    syncPresetButtons() {
        let me             = this,
            bar            = me.items[0],
            activeLayoutId = me.perspectiveStore?.collection?.activeLayoutId;

        (me.perspectiveStore?.list?.() || []).forEach((preset, index) => {
            const
                reference = `fleet-preset-${preset.layoutId}`,
                // resolved against the BAR's items, not getReference: the reconcile must find a
                // button whose projection has not registered yet (and never a same-named button
                // in a foreign tree)
                existing  = bar.items?.find?.(item => item.reference === reference);

            if (existing?.set) {
                existing.set({pressed: preset.layoutId === activeLayoutId})
            } else if (!existing) {
                const config = {
                    module    : Button,
                    cls       : ['fm-preset-button'],
                    handler   : 'onPresetSelect',
                    presetName: preset.perspectiveName ?? preset.layoutId,
                    pressed   : preset.layoutId === activeLayoutId,
                    reference,
                    text      : preset.perspectiveName ?? preset.layoutId
                };

                bar.insert ? bar.insert(index, config) : bar.items.splice(index, 0, config)
            }
        })
    }

    /**
     * @summary Switches the cockpit to a named preset: the stored record restores through the
     * landed fail-closed path (validate everything before mutating anything — a refused restore
     * leaves the live layout byte-untouched), and a valid document enters the standard commit
     * loop — the switch re-projects FLIP-animated exactly like any committed operation, with
     * reduced-motion collapsing through the token layer by construction.
     *
     * Pane continuity across a switch preserves component identity when the item already exists;
     * genuinely absent surfaces materialize from OWNER-held state ({@link #resolveDockComponentRef}),
     * while the provider-owned roster store never restarts.
     *
     * A perspective that reveals the inspector must not land on the empty state: a cold
     * entry (nothing inspected yet) defaults {@link #detailRecord} to the roster's first resident
     * BEFORE the commit re-projects, so the pane materializes loaded; a prior selection stays the
     * owner-held truth. A live pane updates in place through the select seam's owner accessor.
     * @param {String} name The preset's `perspectiveName` (or technical `layoutId`).
     * @returns {{switched: Boolean, errors: String[]}}
     */
    activatePerspective(name) {
        let me                 = this,
            {document, errors} = me.perspectiveStore.loadPerspective(name);

        if (errors.length) {
            me.presetError = `${name}: ${errors[0]}`;
            me.syncControlBar();
            return {errors, switched: false}
        }

        const revealsInspector = me.isInspectorRevealed(document);

        if (revealsInspector && !me.detailRecord) {
            // seat through the ONE selection-write site so the provider pair + memories
            // write-through follow the cold default exactly like an operator click would
            me.getController().applySelection(me.getController().resolveFleetRosterStore()?.first() ?? null)
        }

        me.presetError = null;
        me.onDockZoneDocumentChange(document);

        if (revealsInspector && me.detailRecord) {
            const pane = me.getAgentDetailPane();

            // A cold default already reached an existing pane through applySelection(). A pane
            // materialized by the projection still needs the write; an already-current one does not.
            pane && pane.record !== me.detailRecord && pane.set({record: me.detailRecord})
        }

        return {errors: [], switched: true}
    }

    /**
     * @summary TRUE only when a document actually REVEALS the inspector: the detail item sits in a
     * tabs node of the tree (absence fails — a valid no-detail document must never read as
     * revealed), is not auto-hidden to the rail, and is its node's active tab or the node's only
     * member. `!items.detail?.autoHidden` alone is TRUE for an absent item, so an unrelated valid
     * perspective would mutate the owner-held selection — the round-1 falsifier.
     * @param {Object} document A committed `neo.dock.zone.v1` document.
     * @returns {Boolean}
     */
    isInspectorRevealed(document) {
        const tabsId = Document.findContainingTabsId(document, 'detail'),
              node   = tabsId ? document.nodes[tabsId] : null;

        return !!node && !document.items.detail?.autoHidden
            && (node.activeItemId === 'detail' || node.items.length === 1)
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
     * Resolves one Fleet catalog item through the engine workspace hook.
     * @param {String} itemId
     * @param {Object} item
     * @returns {Object|Neo.component.Base}
     */
    resolvePane(itemId, item) {
        return this.resolveDockComponentRef(item?.componentRef, item, itemId)
    }

    /**
     * Fleet reveal panes use the same owner-held resolver as ordinary projected tabs.
     * @param {String} itemId
     * @param {Object} item
     * @returns {Object|Neo.component.Base}
     */
    resolveRevealPane(itemId, item) {
        return this.resolvePane(itemId, item)
    }

    /**
     * @summary Synchronizes the persistent control bar from the perspective store and refusal state.
     */
    syncControlBar() {
        let me = this;

        me.syncPresetButtons();
        // re-assert the refusal line onto a freshly projected error slot (the afterSet hook owns
        // CHANGES; a re-projection needs the standing value re-rendered)
        me.afterSetPresetError(me.presetError, null);
        me.syncVesselChrome()
    }

    /**
     * @summary Resolve the provider-hosted `AgentDefinitions` store for the detail pane's
     * configuration tab — the sanctioned `getStateProvider().getStore()` access (the store's own
     * JSDoc names it), degraded to `null` when no chain or no hosting provider exists (bare unit
     * mounts): the tab renders its honest no-definition state rather than demanding a provider.
     * @returns {Neo.data.Store|null}
     */
    resolveAgentDefinitionsStore() {
        try {
            return this.getStateProvider()?.getStore('agentDefinitions') ?? null
        } catch {
            return null
        }
    }

    /**
     * @summary Resolve the Viewport provider's exact public FleetTenants Store for every composed
     * configuration card. Bare mounts degrade to `null`; no cockpit-local tenant copy is invented.
     * @returns {Neo.data.Store|null}
     */
    resolveFleetTenantsStore() {
        try {
            return this.getStateProvider()?.getStore('fleetTenants') ?? null
        } catch {
            return null
        }
    }



    /**
     * @summary Resolves a dock item's `componentRef` to its pane config — the cockpit's keeper
     * surfaces for the live refs, honest placeholders for panes whose views are sibling leaves.
     *
     * A genuinely absent pane materializes from the OWNER's held runtime state (`adapterState`,
     * events); ordinary reconciliations discover the existing pane before consulting this resolver.
     * The flip marker class carries the stable item identity across both retained and new panes.
     * Panes stay layout-blind per the docking design's pane contract: nothing dock-specific is
     * threaded here beyond the marker class.
     * @param {String} componentRef
     * @param {Object} item The persisted item record.
     * @param {String} itemId The stable workspace identity from the item catalog.
     * @returns {Object}
     */
    resolveDockComponentRef(componentRef, item, itemId) {
        let me     = this,
            marker = `dock-flip-item-${encodeURIComponent(itemId)}`;

        // a GESTURE-torn item's live pane is vessel-owned: a preset restore (or NL addTab)
        // re-treeing the item while torn must not steal or duplicate the instance — an honest
        // stand-in holds the slot (the same discipline as the click-detached inspector below);
        // the vessel-death return path above swaps it for the live pane when the vessel dies.
        // Optional-chained like every sibling
        // field read: the projection specs drive these prototype methods over controlled state.
        if (me.tearOutPaneHandles?.[itemId] && !me.tearOutPaneHandles[itemId].isDestroyed) {
            return {
                ntype: 'component',
                cls  : [marker, 'fm-pane-placeholder'],
                html : `${item?.title ?? componentRef ?? itemId} is open in its own window`
            }
        }

        switch (componentRef) {
            case 'fleet-grid':
                return {
                    module      : FleetGrid,
                    bind: {
                        adapterState      : data => data.gridAdapterState,
                        daemonFault       : data => data.daemonFault,
                        presenceCapability: data => data.presenceCapability,
                        store             : 'stores.fleetRoster'
                    },
                    cls         : [marker],
                    // two roster intents: the bootstrap CTA (an empty fleet's one path to its
                    // first agent — the controller opens the S5 define-agent zone) and the
                    // selection seam's drill (`agentSelect` — the roster controller already wrote
                    // the provider truth pair; this listener drives the detail reveal)
                    listeners: {addAgentRequest: 'onAddAgentRequest', agentSelect: 'onAgentSelect'},
                    reference: 'fleet-grid'
                };
            case 'activity-stream':
                return {
                    module        : ActivityStream,
                    actorDirectory: me.getController().buildActivityActorDirectory(),
                    bind          : {
                        adapterState: data => data.streamAdapterState,
                        counts      : data => data.activityCounts,
                        store       : 'stores.fleetActivityEvents'
                    },
                    cls      : [marker],
                    reference: 'activity-stream'
                };
            case 'agent-detail':
                // the pane lives in its vessel window — a preset restore (or an NL-driven addTab)
                // can re-tree the `detail` item while detached, and materializing here would STEAL
                // the live instance out of its window: an honest stand-in instead. The reattach
                // swaps it for the live pane post-projection (the reconciler prefers tree-live
                // occupants over this resolver, so the swap cannot ride the normal adoption).
                if (me.detachedDetail) {
                    return {
                        ntype    : 'component',
                        cls      : [marker, 'fm-pane-placeholder'],
                        html     : 'Agent detail is open in its own window',
                        reference: 'agent-detail-standin'
                    }
                }

                // reattach re-adoption: the parked LIVE instance returns to the projection —
                // same instance id, same runtime state, never a recreation
                if (me.detachedDetailPane) {
                    return me.detachedDetailPane
                }

                // the drill-in inspector; its selected resident is OWNER-held so a pane returning
                // from true absence never drops the selection — null renders the view's honest
                // "select an agent" empty state. The pane stays layout-blind: the pop-out verb is
                // SHELL-owned config placed through the pane's `shellTools` slot (pane verbs are
                // pane-scoped per the navigation model; a windowed pane carries its return verb).
                return {
                    // EAGER by contract, not by accident: the vessel state machine adopts and
                    // re-adopts THIS live instance synchronously (park → window → reattach), and
                    // a lazy module resolves through an async placeholder the vessel flow cannot
                    // hold — the define-agent zone below is the lazy reference case
                    module   : AgentDetail,
                    // the configuration tab's data surface, resolved imperatively at composition
                    // time (the store instance is app-stable) so the view stays provider-agnostic:
                    // a bare mount or a chain without the store degrades to null — the tab's honest
                    // empty state — instead of a bind demanding a provider chain that may not exist
                    agentDefinitions: me.resolveAgentDefinitionsStore(),
                    fleetTenants    : me.resolveFleetTenantsStore(),
                    cls             : [marker],
                    record          : me.detailRecord,
                    reference       : 'agent-detail',
                    shellTools      : [me.buildDetailWindowToggle()]
                };
            case 'define-agent':
                // the S5 add-agent flow (rail tool, invoked-not-ambient per the design ruling).
                // `agentDefinitionAccepted` walks up the component chain to the Viewport's roster
                // seam — the same consumer Accounts feeds, so both entry points write one truth.
                return {
                    // LAZY: the define-agent zone opens on explicit intent only
                    module   : () => import('../instances/AddAgentForm.mjs'),
                    cls      : [marker],
                    listeners: {agentDefinitionAccepted: 'up.onAgentDefinitionAccepted'},
                    reference: 'add-agent-form'
                };
            case 'operator-mailbox':
                // the operator's own inbox + compose surface. record / snapshot / recipientOptions are
                // OWNER-held (materialized from state the cockpit already polls), so a pane returning from
                // true absence re-materializes at current truth — the {@link #detailRecord} precedent. The
                // surface is transport-blind: it fires intent-only `compose` / `inboxPageRequest`, routed up
                // to the controller which holds the bridge (the authenticated ingress + Brain write seam).
                return {
                    module          : OperatorMailbox,
                    cls             : [marker],
                    record          : me.getController().operatorRecord,
                    snapshot        : me.getController().operatorSnapshot,
                    recipientOptions: me.getController().buildOperatorRecipientOptions(),
                    identityPosture : me.getController().operatorIdentityPosture,
                    listeners       : {
                        compose         : 'onOperatorCompose',
                        inboxPageRequest: 'onOperatorInboxPageRequest',
                        scope           : me.getController()
                    },
                    reference       : 'operator-mailbox'
                };
            case 'catch-up':
                // S3 invoked history: the pane renders owner-held source envelopes and fires intent;
                // this cockpit owns the authenticated bridge. Partition choices derive from the same
                // provider-owned roster as the cards — no second resident list.
                return {
                    module          : CatchUpPane,
                    cls             : [marker],
                    snapshot        : me.getController().catchUpSnapshot,
                    markOutcome     : me.getController().catchUpMarkOutcome,
                    partitionOptions: me.getController().buildCatchUpPartitionOptions(),
                    listeners       : {
                        historyRequest     : 'onCatchUpHistoryRequest',
                        markCaughtUpRequest: 'onCatchUpMarkRequest',
                        liveSurfaceRequest : 'onCatchUpLiveSurfaceRequest',
                        scope              : me.getController()
                    },
                    reference: 'catch-up'
                };
            case 'memories':
                // resident per-agent session-summary recall (a south reading-surface tab): the pane renders the owner-held
                // source envelope and fires intent; this cockpit owns the authenticated bridge.
                // The selected target travels WITH the snapshot (one coherent state key), so a
                // rematerialized pane never shows cards no selection points at. The target is the
                // roster SELECTION's write-through ({@link #applySelection}) — the cockpit's one
                // picker; the pane renders no chooser of its own.
                // The listener scope is bound EXPLICITLY to the owning controller: string handlers
                // resolve through the component's controller chain at fire time, and a vesseled
                // pane (click pop-out / gesture tear-out) has no controller above it — an
                // unscoped string resolves dead in the vessel (a TypeError per fire; the miss is
                // NOT cached: getController's fast path is truthy-only, so it re-walks once docked).
                return {
                    module       : MemoriesPane,
                    cls          : [marker],
                    activeAgent  : me.getController().memoriesTarget ?? me.getController().memoriesSnapshot?.target ?? null,
                    snapshot     : me.getController().memoriesSnapshot,
                    drillSession : me.getController().memoriesDrillSession,
                    drillSnapshot: me.getController().memoriesDrillSnapshot,
                    shellTools   : [me.buildMemoriesWindowToggle()],
                    listeners    : {
                        memoriesRequest     : 'onMemoriesRequest',
                        sessionDetailRequest: 'onSessionDetailRequest',
                        sessionDetailClosed : 'onSessionDetailClosed',
                        scope               : me.getController()
                    },
                    reference: 'memories'
                };
            case 'wakeRoutes':
                // The snapshot travels with rematerialization like the memories sibling: a torn or
                // re-projected pane reopens on the last ACCEPTED envelope, never a blank claim.
                return {
                    // LAZY: the wake-routes pane is auto-hidden and unresolved at boot — its
                    // module loads at first reveal (define-agent is the sibling case; the detail
                    // pane is the stated eager exception for vessel identity)
                    module   : () => import('../wake/Container.mjs'),
                    cls      : [marker],
                    snapshot : me.getController().wakeRoutesSnapshot,
                    listeners: {
                        wakeRoutesRequest: 'onWakeRoutesRequest',
                        scope            : me.getController()
                    },
                    reference: 'wakeRoutes'
                };
            case 'tasks':
                // the resident WHAT surface beside the WHO grid: the pane renders the owner-held
                // envelope (running / queued / recent) and fires intent; this cockpit owns the
                // authenticated bridge and drives the read at boot and on every liveness tick.
                return {
                    module   : TasksPane,
                    cls      : [marker],
                    snapshot : me.getController().tasksSnapshot,
                    listeners: {
                        tasksRequest: 'onTasksRequest',
                        scope       : me.getController()
                    },
                    reference: 'tasks'
                };
            default:
                // perspectives arrives with its own leaf — an honest labelled placeholder, never a
                // blank pane masquerading as a finished surface
                return {
                    ntype: 'component',
                    cls  : [marker, 'fm-pane-placeholder'],
                    html : `${item?.title ?? componentRef} — this pane's view lands with its own leaf`
                }
        }
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
