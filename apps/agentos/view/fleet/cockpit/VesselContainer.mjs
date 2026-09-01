import Button    from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Document  from '../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Document.mjs';
import Workspace from '../../../../../node_modules/neo.mjs/src/dashboard/dock/Workspace.mjs';

/**
 * @summary The cockpit's vessel + window-chrome layer — every pop-out / tear-out / reattach
 * behavior between the engine's {@link Neo.dashboard.dock.Workspace} tear-out substrate and the
 * declared Fleet cockpit, factored per the #50 ruling (the container declares; the vessel
 * choreography is its own class).
 *
 * Three responsibilities live here, nothing else:
 * - **The engine template hooks** (`openTearOutVessel`, `closeTearOutVessel`,
 *   `onUnhandledWindowConnect/Disconnect`, `resolveTearOutPane`, `captureWindowConnectContext`,
 *   the `afterTearOut*` sync hooks, `getPreservedItemIds`) — the engine Workspace calls them on `this`,
 *   so they are REAL overrides on the inheritance chain, never delegation stubs.
 * - **The vessel state machines**: the click-detail admission
 *   (`docked → opening → connected → windowed → reattaching → docked` with the `failed-blocked` /
 *   `failed-timeout` edges) and the memories click pop-out riding the generic tear-out substrate.
 * - **The phase-blind pane accessors + vessel chrome** (`getMemoriesPane` and friends,
 *   {@link #syncVesselChrome}, the window-toggle builders): one resolution order — gesture
 *   vessel handle → returning-parked pane → docked projection — so every owner push lands in
 *   the live pane whatever phase it is in.
 *
 * Host slots this layer expects from its subclass (the template-method grammar the engine
 * already uses with us): `resolveDockComponentRef` (pane materialization),
 * `syncControlBar` (the full chrome pass; {@link #syncVesselChrome} is the half owned here).
 *
 * @class AgentOS.view.fleet.cockpit.VesselContainer
 * @extends Neo.dashboard.dock.Workspace
 */
class VesselContainer extends Workspace {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.VesselContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.VesselContainer',
        /**
         * The bounded connect window (ms) an opened detail vessel gets before the
         * `failed-timeout` edge fires and the admission rolls back to docked. Boundedness is the
         * contract — an admission may fail, it may never hang. Non-reactive class-config default:
         * `Neo.overwrites`-eligible and instance-configurable (witnesses pass a short window at
         * creation).
         *
         * Calibration: a healthy heap-join measures ~1.3s born→windowed, but a loaded/cold seat
         * legitimately exceeds 10s — twice-observed live: a 10s window flapped the same pop-out
         * a 20s window let survive, minutes apart on one seat. 20s ≈ 15x healthy headroom — the
         * cold-provider-beats-default class, the same widening shape as the Memory Core
         * embed-write canary. A genuinely dead connect still rolls back at the bound.
         * @member {Number} detailVesselConnectWindowMs=20000
         */
        detailVesselConnectWindowMs: 20000
    }

    /**
     * Detached-detail bookkeeping — `null` while the inspector is docked. While detached it holds
     * `{homeTabsNodeId, homeTabIndex, windowId, windowName, connectTimer}`: the tabs node + EXACT
     * index the reattach restores (`addTab` APPENDS by default — the stored index is the only
     * placement truth), the vessel's `windowId` once it connects (`null` until then), the window
     * name for the close call, and the bounded connect-window timer id. Cleared BEFORE the
     * reattach's async vessel close — the cleared entry is the {@link #onWindowDisconnect}
     * re-entrancy guard.
     * @member {Object|null} detachedDetail=null
     * @protected
     */
    detachedDetail = null
    /**
     * The live {@link AgentOS.view.fleet.detail.Container} instance handle while it is OUT of this
     * cockpit's projected tree (parked mid-flight or mounted in its vessel window). A
     * popup-mounted pane lives in the vessel's view tree — out of this cockpit's `down()` /
     * `getReference` reach — so every detail consumer routes through {@link #getAgentDetailPane}.
     * `null` while docked (the projection owns the pane); survives one projection cycle past
     * reattach so {@link #resolveDockComponentRef} re-adopts the SAME instance, never a recreation.
     * @member {Neo.container.Base|null} detachedDetailPane=null
     * @protected
     */
    detachedDetailPane = null
    /**
     * The vessel admission state machine's observable state — one word of truth for witnesses,
     * Neural Link reads and the shell affordance:
     * `docked → opening → connected → windowed → reattaching → docked`, with the two terminal
     * failure edges `failed-blocked` (`Neo.Main.windowOpen` returned `false` — the blocked-popup
     * PRIMARY failure path; it never throws) and `failed-timeout` (the bounded connect window
     * expired before the vessel joined the heap). Both failure states roll back through the
     * standard reattach and settle at `docked`; {@link #lastDetailVesselFailure} keeps the
     * post-rollback trace.
     * @member {String} detailVesselState='docked'
     * @protected
     */
    detailVesselState = 'docked'
    /**
     * Generation counter for async-boundary revalidation: incremented at every pop-out start,
     * reattach start and destroy. Every awaited continuation (vessel open, connect URL read,
     * connect timer) re-checks its captured generation and goes inert on mismatch — a reattach or
     * teardown racing an in-flight admission can never act on stale state.
     * @member {Number} detailVesselGeneration=0
     * @protected
     */
    detailVesselGeneration = 0
    /**
     * The last vessel admission failure (`'blocked'` / `'timeout'`), kept after the rollback
     * settles so the failure stays observable once {@link #detailVesselState} returns to
     * `docked`. `null` after a clean detach/reattach cycle.
     * @member {String|null} lastDetailVesselFailure=null
     * @protected
     */
    lastDetailVesselFailure = null

    /**
     * Owner-held panes that survive while their dock items are absent from the projection.
     * @returns {String[]}
     * @protected
     */
    getPreservedItemIds() {
        return this.detachedDetailPane ? ['detail'] : []
    }

    /**
     * Resolves the live pane handle a connected tear-out vessel embodies.
     * @param {String} itemId
     * @returns {Neo.component.Base|null}
     * @protected
     */
    resolveTearOutPane(itemId) {
        return this.tearOutPaneHandles[itemId] || this.findProjectedDockPane(itemId)
    }

    /**
     * Keeps Fleet's vessel affordances truthful after the engine records post-commit ownership.
     * @param {Object} data
     * @protected
     */
    afterTearOutPaneAdopt(data) {
        this.syncControlBar()
    }

    /**
     * Projects the current instance title into a newly admitted Fleet tear-out window.
     * @param {Object} data
     * @protected
     */
    afterTearOutWindowConnect({connection}) {
        this.pushInstanceTitle(connection.windowId)
    }

    /**
     * Captures the click-detail generation before the engine's async URL read.
     * @returns {Number}
     * @protected
     */
    captureWindowConnectContext() {
        return this.detailVesselGeneration
    }

    /**
     * Re-syncs pane toggles after physical vessel retirement.
     * @param {Object} data
     * @protected
     */
    afterTearOutWindowDisconnect(data) {
        this.syncControlBar()
    }

    /**
     * @summary SHELL-owned pop-out affordance config for the Memories pane — the detail toggle's
     * grammar on the tear-out pathway. Lives in the PANE's chrome per the navigation model (pane
     * verbs are pane-scoped, the bar seats instance-wide tenants only); ownership, handler and
     * label sync stay here — the pane merely places it through its layout-blind `shellTools` slot,
     * so a vesseled pane carries its own return verb with it.
     * @returns {Object}
     */
    buildMemoriesWindowToggle() {
        return {
            module   : Button,
            cls      : ['fm-memories-window-toggle'],
            handler  : this.onMemoriesWindowToggle.bind(this),
            iconCls  : 'fa-solid fa-arrow-up-right-from-square',
            reference: 'memories-window-toggle',
            text     : 'Pop out memories'
        }
    }

    /**
     * @summary SHELL-owned pop-out affordance config for the inspector — routes by the vessel
     * state machine; {@link #syncVesselChrome} keeps title + aria naming the action it will take.
     *
     * Icon-only by design (#23, operator direction): the pane places this through its
     * layout-blind `shellTools` slot onto the tab header bar's ACTION seam — one icon at the
     * strip's trailing edge, outside the content flow (the old text button floated OVER the
     * identity block at rail widths). `contextual: false` keeps it persistent: windowing the
     * pane is a pane verb, not a per-tab one. The label lives on title + aria-label, byte-equal.
     * @returns {Object}
     */
    buildDetailWindowToggle() {
        return {
            module    : Button,
            cls       : ['fm-detail-window-toggle'],
            contextual: false,
            handler   : this.onDetailWindowToggle.bind(this),
            iconCls   : 'fa-solid fa-arrow-up-right-from-square',
            reference : 'detail-window-toggle',
            vdom      : {title: 'Pop out detail', 'aria-label': 'Pop out detail'}
        }
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.detail.Container} instance wherever it
     * currently renders — the projected tree while docked, the owner-held handle while detached
     * (click pop-out OR gesture tear-out). A vessel-mounted pane lives in the popup's view tree,
     * out of this cockpit's `down()` / `getReference` reach, so every detail consumer (record
     * mutation, selection reconciliation, the card→detail drill) routes through this accessor —
     * the windowed inspector stays as live as the docked one on either vessel pathway.
     * @returns {Neo.container.Base|null} The detail pane, or `null` before its first materialization.
     */
    getAgentDetailPane() {
        return this.detachedDetailPane || this.tearOutPaneHandles?.detail || this.getReference('agent-detail')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.mailbox.OperatorContainer} instance whether it is
     * docked, gesture-torn into a vessel, or parked in the vessel-death returning window. A torn
     * pane lives outside this cockpit's projected tree, so owner-side identity and inbox refreshes
     * must use the captured handle instead of stopping at `getReference()` — and a push landing in
     * the returning window must still reach the LIVE instance ({@link #getMemoriesPane} contract).
     * @returns {Neo.container.Base|null} The operator mailbox, or `null` before materialization.
     */
    getOperatorMailboxPane() {
        return this.tearOutPaneHandles?.operator || this.returningTearOutPanes?.operator || this.getReference('operator-mailbox')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.catchup.Container} instance whether it is
     * docked, gesture-torn into a vessel, or parked in the vessel-death returning window — the
     * {@link #getOperatorMailboxPane} contract for the catch-up reading surface, so roster-driven
     * option refreshes and the bridge-arrival history re-drive reach a torn or returning pane too.
     * @returns {Neo.container.Base|null} The catch-up pane, or `null` before materialization.
     */
    getCatchUpPane() {
        return this.tearOutPaneHandles?.catchUp || this.returningTearOutPanes?.catchUp || this.getReference('catch-up')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.memories.Container} instance whether it is
     * docked, revealed, or vesseled — the click pop-out ({@link #popOutMemories}) and the gesture
     * tear-out share one pathway, so one handle map answers both. Owner-side pushes (snapshot
     * writes, roster option refreshes, reconnect re-drives) must route through this accessor
     * instead of stopping at `getReference()`: a vesseled pane lives outside this cockpit's
     * projected tree.
     * @returns {Neo.container.Base|null} The memories pane, or `null` before materialization.
     */
    getMemoriesPane() {
        // returningTearOutPanes covers the vessel-death parking window: the next projection may
        // not adopt the returning pane for a while, and an owner push landing in that window must
        // still reach the LIVE instance — otherwise the eventual adoption renders a stale snapshot.
        return this.tearOutPaneHandles?.memories || this.returningTearOutPanes?.memories || this.getReference('memories')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.wake.Container} instance whether it is
     * docked, gesture-torn into a vessel, or parked in the vessel-death returning window — the
     * {@link #getMemoriesPane} contract for the wake-routes surface, so snapshot writes and the
     * reconnect re-drive reach the pane in every phase.
     * @returns {Neo.container.Base|null} The wake-routes pane, or `null` before materialization.
     */
    getWakeRoutesPane() {
        return this.tearOutPaneHandles?.wakeRoutes || this.returningTearOutPanes?.wakeRoutes || this.getReference('wakeRoutes')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.tasks.Container} instance whether it is docked,
     * gesture-torn into a vessel, or parked in the vessel-death returning window — the
     * {@link #getMemoriesPane} contract for the tasks surface, so the liveness tick's snapshot
     * writes reach the pane in every phase.
     * @returns {Neo.container.Base|null} The tasks pane, or `null` before materialization.
     */
    getTasksPane() {
        return this.tearOutPaneHandles?.tasks || this.returningTearOutPanes?.tasks || this.getReference('tasks')
    }

    /**
     * The tear-out admission seam: opens the vessel window for a mid-gesture boundary exit,
     * reusing the SAME widget-childapp shell the click pop-out proves (an empty pane host — the
     * cockpit reparents on connect). Fail-closed per the admission contract: `Neo.Main.windowOpen`
     * resolves **Boolean** (a blocked popup never throws), and any refused precondition — an
     * unresolvable live pane (placeholder items), an item already vessel-owned on EITHER pathway —
     * or falsy/throwing acquisition returns `null`, degrading the gesture to its in-window
     * fallback with zero vessel state.
     * @param {Object} request
     * @param {String} request.itemId
     * @param {Object} request.proxyRect
     * @param {Boolean} [request.requireProjectedPane=true] The gesture needs a LIVE projected pane
     *     (you tear what you can see); the click pop-out ({@link #popOutMemories}) can materialize
     *     a not-yet-projected pane from owner-held state itself (rail-lazy chrome, or a resident
     *     item a custom document dropped), so it opts out of this precondition only.
     * @returns {Promise<{popupHeight: Number, popupWidth: Number, windowName: String}|null>}
     * @protected
     */
    async openTearOutVessel({admissionToken, itemId, proxyRect, requireProjectedPane = true}) {
        let me         = this,
            windowName = `fm-tearout-${itemId}-${me.id}`,
            gesture    = Number.isFinite(admissionToken);

        // fail-closed preconditions: only a live, projected, singly-owned pane may embody
        if (
            me.tearOutPanes?.[itemId] || me.tearOutPaneHandles?.[itemId] ||
            (itemId === 'detail' && me.detachedDetail) ||
            (requireProjectedPane && !me.findProjectedDockPane(itemId))
        ) {
            return null
        }

        try {
            let {windowConfigs} = Neo,
                firstWindowId   = Object.keys(windowConfigs)[0],
                {basePath}      = windowConfigs[firstWindowId],
                winData         = await Neo.Main.getWindowData({windowId: me.windowId}),
                width           = Math.max(Math.round(proxyRect?.width  || 480), 320),
                height          = Math.max(Math.round(proxyRect?.height || 360), 240),
                left            = Math.round((proxyRect?.x ?? 120) + winData.screenLeft),
                top             = Math.round((proxyRect?.y ?? 120) + (winData.outerHeight - winData.innerHeight) + winData.screenTop),
                opened          = await Neo.Main.windowOpen({
                    url           : `${basePath}apps/agentos/childapps/widget/index.html?tearout=${itemId}&cockpitId=${me.id}` +
                        (gesture ? `&vesselFlow=tear-out&vesselAdmission=${admissionToken}` : ''),
                    windowFeatures: `height=${height},left=${left},top=${top},width=${width}`,
                    windowId      : me.windowId,
                    windowName
                });

            if (opened === false) return null;

            return {popupHeight: height, popupWidth: width, windowName}
        } catch (error) {
            return null
        }
    }

    /**
     * Platform retirement hook: closes a vessel the gesture no longer needs (re-entry, cancel,
     * timeout or refused model commit). The engine releases admission/connection records only
     * after this hook settles non-false; Fleet's void success preserves the existing best-effort
     * window-close contract.
     * @param {Object} vessel
     * @param {String} vessel.itemId
     * @param {String} vessel.windowName
     * @returns {Promise<void>}
     * @protected
     */
    async closeTearOutVessel({windowName}) {
        try {
            await Neo.Main.windowClose({names: [windowName], windowId: this.windowId})
        } catch (error) {
            // best-effort retirement
        }
    }

    /**
     * Resolves a dock item's LIVE pane instance from the projected tree by the stable reference
     * names {@link #resolveDockComponentRef} assigns. Items whose resolver yields an unreferenced
     * placeholder (sibling-leaf panes) resolve `null` — which is exactly the admission refusal:
     * a placeholder cannot embody into a vessel.
     * @param {String} itemId
     * @returns {Neo.component.Base|null}
     * @protected
     */
    findProjectedDockPane(itemId) {
        let componentRef = this.dockModel?.items?.[itemId]?.componentRef,
            reference    = componentRef === 'define-agent' ? 'add-agent-form' : componentRef;

        return reference ? (this.getReference(reference) || null) : null
    }

    /**
     * @summary Detach the agent-detail inspector into its own OS window on the shared heap —
     * the `docked → opening` edge of the vessel admission state machine.
     *
     * The dock document stays the layout SSOT: `detachItem` prunes the `detail` item from the
     * tree while preserving its catalog record, and the tabs node + EXACT index are stored FIRST
     * (`addTab` appends by default — the stored index is the only placement truth the reattach
     * has). The LIVE pane parks via the reconciler's `preserveItemIds` (awaited, so the vessel's
     * connect can never race a pane the old shell still holds), then the widget-childapp vessel
     * opens. `Neo.Main.windowOpen` resolves **Boolean** — `false` IS the blocked-popup failure
     * (it never throws), taking the `failed-blocked` edge and rolling back through the standard
     * reattach. A vessel that opens but never joins the heap inside the bounded connect window
     * takes the `failed-timeout` edge the same way. Every awaited continuation revalidates
     * {@link #detailVesselGeneration}.
     * @returns {Promise<{detached: Boolean, errors: String[]}>}
     */
    async popOutAgentDetail() {
        let me   = this,
            pane = me.getReference('agent-detail'),
            home = Document.findContainingTabsId(me.dockModel, 'detail');

        if (me.detachedDetail || !pane || !home) {
            return {detached: false, errors: ['agent-detail is not a docked, projected pane']}
        }

        let generation = ++me.detailVesselGeneration,
            homeIndex  = me.dockModel.nodes[home].items.indexOf('detail'),
            result     = me.applyDockZoneOperation({operation: 'detachItem', itemId: 'detail'});

        if (result.errors.length) {
            return {detached: false, errors: result.errors}
        }

        // the window name stays an IMMUTABLE local across every await below: a raced reattach
        // nulls the bookkeeping entry, but a stale-open cleanup still needs the name to close by
        let windowName = `fm-agent-detail-${me.id}`;

        me.detachedDetail = {
            connectTimer  : null,
            homeTabIndex  : homeIndex,
            homeTabsNodeId: home,
            windowId      : null,
            windowName
        };
        me.detachedDetailPane   = pane;
        me.detailVesselState    = 'opening';
        me.lastDetailVesselFailure = null;

        // the re-projection parks the preserved pane (alive on the shared heap, out of every
        // parent) and retires its tab button — awaited before the vessel opens
        me.onDockZoneDocumentChange(result.document);
        await me.refreshPromise;

        if (generation !== me.detailVesselGeneration) {
            return {detached: false, errors: ['superseded by a newer vessel operation']}
        }

        let {windowConfigs} = Neo,
            firstWindowId   = Object.keys(windowConfigs)[0],
            {basePath}      = windowConfigs[firstWindowId],
            winData         = await Neo.Main.getWindowData({windowId: me.windowId});

        if (generation !== me.detailVesselGeneration) {
            return {detached: false, errors: ['superseded by a newer vessel operation']}
        }

        let opened = await Neo.Main.windowOpen({
            url           : `${basePath}apps/agentos/childapps/widget/index.html?detail=agent-detail&cockpitId=${me.id}`,
            windowFeatures: `height=640,width=480,left=${winData.screenLeft + 160},top=${winData.screenTop + 120}`,
            windowId      : me.windowId,
            windowName
        });

        if (generation !== me.detailVesselGeneration) {
            // the generation died DURING the open (a raced reattach/teardown already restored the
            // dock state) — but a `true` completion means the vessel MATERIALIZED under the dead
            // generation: stale continuations own the cleanup of resources they acquired, so close
            // the orphan by its immutable name (fire-and-forget; nothing else may be touched)
            opened && Neo.Main.windowClose({names: [windowName], windowId: me.windowId}).catch(() => {});

            return {detached: false, errors: ['superseded by a newer vessel operation']}
        }

        if (!opened) {
            // the PRIMARY real-world failure: the browser blocked the popup. Boolean grammar —
            // no exception ever fires here. Restore the docked state commit-or-neither.
            me.detailVesselState       = 'failed-blocked';
            me.lastDetailVesselFailure = 'blocked';

            me.warnVesselAdmissionFailure('blocked', {windowName});

            await me.reattachAgentDetail({windowAlreadyClosed: true});

            return {detached: false, errors: ['popup blocked: the vessel window did not open']}
        }

        // bounded connect window: a vessel that opened but never joins the heap rolls back
        me.detachedDetail.connectTimer = setTimeout(() => {
            if (generation === me.detailVesselGeneration && me.detailVesselState === 'opening') {
                me.detailVesselState       = 'failed-timeout';
                me.lastDetailVesselFailure = 'timeout';
                me.warnVesselAdmissionFailure('timeout', {boundMs: me.detailVesselConnectWindowMs, windowName});
                me.reattachAgentDetail()
            }
        }, me.detailVesselConnectWindowMs);

        me.syncControlBar();

        return {detached: true, errors: []}
    }

    /**
     * @summary Bring the detached inspector home — the `* → reattaching → docked` edge.
     *
     * `addTab` returns the `detail` item into its remembered tabs node at its remembered EXACT
     * index (first-tabs fallback with honest append when a preset retired the node); the parked
     * instance is re-adopted by the projection ({@link #resolveDockComponentRef} hands back the
     * SAME instance), and the vessel closes unless it already closed itself. Bookkeeping clears
     * BEFORE the async close — the cleared entry is the {@link #onWindowDisconnect} re-entrancy
     * guard. Increments {@link #detailVesselGeneration} first, so every in-flight admission
     * continuation (open, URL read, connect timer) goes inert — and its OWN post-projection
     * continuation revalidates the same way: a destroy (or newer operation) landing during the
     * await limits this path to the vessel cleanup it still owns, never a cockpit-field write.
     * @param {Object} [options={}]
     * @param {Boolean} [options.windowAlreadyClosed=false] `true` when the disconnect path runs
     *     the reattach (the vessel is already gone — do not close it again).
     * @returns {Promise<{reattached: Boolean, errors: String[]}>}
     */
    async reattachAgentDetail({windowAlreadyClosed=false}={}) {
        let me    = this,
            entry = me.detachedDetail,
            pane  = me.detachedDetailPane;

        if (!entry || !pane) {
            return {errors: ['agent-detail is not detached'], reattached: false}
        }

        let generation = ++me.detailVesselGeneration;

        entry.connectTimer && clearTimeout(entry.connectTimer);

        let failure = me.lastDetailVesselFailure;

        me.detailVesselState = 'reattaching';

        let homeLive = me.dockModel.nodes[entry.homeTabsNodeId]?.type === 'tabs',
            home     = homeLive
                ? entry.homeTabsNodeId
                : Object.keys(me.dockModel.nodes).find(id => me.dockModel.nodes[id].type === 'tabs'),
            result   = me.applyDockZoneOperation({
                operation : 'addTab',
                itemId    : 'detail',
                tabsNodeId: home,
                index     : homeLive ? entry.homeTabIndex : undefined
            });

        if (result.errors.length) {
            return {errors: result.errors, reattached: false}
        }

        me.detachedDetail = null;

        // the re-projection re-adopts the instance: the resolver hands it back and the
        // container insert performs the atomic move out of the vessel viewport (core contract)
        me.onDockZoneDocumentChange(result.document);

        await me.refreshPromise;

        if (me.isDestroyed || generation !== me.detailVesselGeneration) {
            // a destroy (or a newer vessel operation) landed during the projection await: this
            // continuation may perform ONLY the vessel cleanup it still owns — teardown skipped
            // the close because this reattach had already cleared the bookkeeping entry — and
            // must never resurrect cockpit fields (the pane is the newer owner's, or destroyed)
            windowAlreadyClosed || Neo.Main.windowClose({names: [entry.windowName], windowId: me.windowId}).catch(() => {});

            return {errors: ['superseded by teardown or a newer vessel operation'], reattached: false}
        }

        // an external re-tree while detached left a stand-in occupying the slot, and the
        // reconciler keeps tree-live occupants — swap it for the live instance, same position
        let standin = me.getReference('agent-detail-standin');

        if (standin) {
            let parent = standin.parent,
                index  = parent.items.indexOf(standin);

            parent.remove(standin, true);
            parent.insert(index, pane)
        }

        me.detachedDetailPane      = null;
        me.detailVesselState       = 'docked';
        me.lastDetailVesselFailure = failure;

        me.syncControlBar();

        if (!windowAlreadyClosed) {
            try {
                await Neo.Main.windowClose({names: [entry.windowName], windowId: me.windowId})
            } catch (error) {
                return {errors: [`popup close failed: ${error?.message || error}`], reattached: true}
            }
        }

        return {errors: [], reattached: true}
    }

    /**
     * @summary One self-describing line per silent-rollback admission edge — the flap witness.
     *
     * Both failure edges (`failed-blocked`, `failed-timeout`) roll the dock back so cleanly that
     * a flap is visually identical to a user-initiated reattach. {@link #lastDetailVesselFailure}
     * carries the state half of the observability contract; this warn carries the log half — the
     * App-Worker console bridges into the Neural Link console stream, so harnesses and agents can
     * distinguish an admission failure from a deliberate return without polling cockpit state.
     * @param {String} kind The failure edge: 'blocked' or 'timeout'.
     * @param {Object} meta Window name + bound context, so the line stands alone in a log;
     *     `meta.itemId` names the vessel's item (absent → the click-detail pathway's 'detail').
     * @protected
     */
    warnVesselAdmissionFailure(kind, meta) {
        console.warn(`[FleetCockpit] ${meta?.itemId ?? 'detail'}-vessel admission failed (${kind}):`, meta)
    }

    /**
     * @summary The SHELL-owned window-toggle affordance routes by the state machine: docked →
     * {@link #popOutAgentDetail}; opening/connected/windowed → {@link #reattachAgentDetail};
     * a reattach already in flight is a guarded no-op. The pane itself carries no dock semantics —
     * panes stay layout-blind; the shell owns docking behavior.
     * @returns {Promise<Object>} The routed operation's result.
     */
    onDetailWindowToggle() {
        let me                         = this,
            {detailVesselState: state} = me;

        if (state === 'reattaching') {
            return Promise.resolve({errors: ['reattach in flight'], reattached: false})
        }

        // the memories twin's gesture grammar: an ADOPTED gesture vessel returns home through
        // this same verb (the main view's recall chrome routes here), while the mid-gesture
        // window (captured handle, no adopted vessel yet) refuses instead of racing the gesture
        if (me.tearOutPanes?.detail) {
            return me.returnDetail()
        }
        if (me.tearOutPaneHandles?.detail) {
            return Promise.resolve({errors: ['a gesture tear-out owns the pane'], detached: false})
        }

        return me.detachedDetail ? me.reattachAgentDetail() : me.popOutAgentDetail()
    }

    /**
     * @summary Bring the gesture-torn inspector home by closing its OS window: vessel death IS
     * the return path — {@link #onWindowDisconnect}'s tear-out branch correlates the close and
     * {@link #reintegrateTearOutItem} restores the same live instance at its stored home
     * position ({@link #returnMemories}' contract, mirrored for the detail pane).
     * @returns {Promise<{returned: Boolean, errors: String[]}>}
     */
    async returnDetail() {
        let me    = this,
            entry = me.tearOutPanes?.detail;

        if (!entry) {
            return {returned: false, errors: ['detail is not in a gesture vessel']}
        }

        try {
            await Neo.Main.windowClose({names: [entry.windowName], windowId: me.windowId})
        } catch (error) {
            // best-effort: an already-gone window still fires (or already fired) the disconnect
        }

        return {returned: true, errors: []}
    }

    /**
     * @summary Detach the Memories pane into its own OS window on the shared heap — the click
     * pop-out riding the GENERIC tear-out substrate, never a second vessel state machine.
     *
     * The vessel URL rides the established tear-out param shape —
     * `?tearout=memories&cockpitId=<id>` — the same widget childapp the click pop-out's
     * `?detail=agent-detail` shape loads; {@link #onWindowConnect}'s tear-out branch adopts it.
     * The dock document stays the layout SSOT: {@link #applyTearOutOperation} captures the exact
     * `{tabsNodeId, index}` placement before the `detachItem` commit, so the vessel-death return
     * ({@link #reintegrateTearOutItem}) restores the item at its stored home position.
     *
     * Selection travel is BY IDENTITY: the vessel hosts the LIVE pane instance (or one
     * materialized from the owner-held `memoriesTarget`/`memoriesSnapshot` when a custom
     * document dropped it from the tree — resident tabs otherwise always project), so the active
     * agent and cards move with the window — stronger
     * than a URL parameter, and exactly the rematerialization contract the memories source
     * documents. A blocked popup (`windowOpen` resolves `false`, it never throws) refuses before
     * any document mutation — commit-or-neither.
     * @returns {Promise<{detached: Boolean, errors: String[]}>}
     */
    async popOutMemories() {
        let me     = this,
            itemId = 'memories';

        if (me.tearOutPanes?.[itemId] || me.tearOutPaneHandles?.[itemId]) {
            return {detached: false, errors: ['memories is already in a vessel']}
        }

        if (!Document.findContainingTabsId(me.dockModel, itemId)) {
            return {detached: false, errors: ['memories is not a docked item']}
        }

        let vessel = await me.acquireTearOutVessel({itemId, proxyRect: null, requireProjectedPane: false});

        if (!vessel) {
            // the silent-refusal witness (the detail pathway's observability contract): the click
            // mutates nothing on this edge, so without this line a blocked popup is visually
            // indistinguishable from a dead button
            me.warnVesselAdmissionFailure('blocked', {itemId, windowName: `fm-tearout-${itemId}-${me.id}`});

            return {detached: false, errors: ['popup blocked: the vessel window did not open']}
        }

        if (me.isDestroyed) {
            await me.retireTearOutVessel(vessel);
            return {detached: false, errors: ['cockpit destroyed during vessel open']}
        }

        // the item record is read BEFORE the commit prunes the tree entry (the catalog record
        // survives a detach, so this is belt-and-braces ordering, not a correctness dependency)
        let item       = me.dockModel.items[itemId],
            descriptor = {operation: 'detachItem', itemId},
            result     = me.applyTearOutOperation(descriptor);

        if (result.errors.length) {
            await me.retireTearOutVessel(vessel);
            return {detached: false, errors: result.errors}
        }

        // capture the live pane synchronously before the commit's re-projection can destroy it
        // (the gesture order); a pane that was never projected (rail-lazy chrome — resident tabs
        // always project) materializes from owner-held state instead — same resolver,
        // vessel-bound rather than projection-bound
        if (!me.findProjectedDockPane(itemId)) {
            me.tearOutPaneHandles[itemId] = Neo.create(me.resolveDockComponentRef(item?.componentRef, item, itemId))
        }

        me.onTearOutDocumentChange(result.document, descriptor, vessel);

        return {detached: true, errors: []}
    }

    /**
     * @summary Bring the vesseled Memories pane home by closing its OS window: vessel death IS
     * the return path — {@link #onWindowDisconnect}'s tear-out branch correlates the close and
     * {@link #reintegrateTearOutItem} restores the same live instance at its stored home
     * position. Closing by the immutable window NAME covers the not-yet-connected window too.
     * @returns {Promise<{returned: Boolean, errors: String[]}>}
     */
    async returnMemories() {
        let me    = this,
            entry = me.tearOutPanes?.memories;

        if (!entry) {
            return {returned: false, errors: ['memories is not in a vessel']}
        }

        try {
            await Neo.Main.windowClose({names: [entry.windowName], windowId: me.windowId})
        } catch (error) {
            // best-effort: a already-gone window still fires (or already fired) the disconnect
        }

        return {returned: true, errors: []}
    }

    /**
     * @summary SHELL-owned toggle routing for the Memories pane vessel — the
     * {@link #onDetailWindowToggle} grammar on the tear-out pathway. Mid-gesture ownership
     * (captured handle without an adopted vessel) refuses instead of racing the gesture.
     * @returns {Promise<Object>} The routed operation's result.
     */
    onMemoriesWindowToggle() {
        let me = this;

        if (!me.tearOutPanes?.memories && me.tearOutPaneHandles?.memories) {
            return Promise.resolve({errors: ['a gesture tear-out owns the pane'], detached: false})
        }

        return me.tearOutPanes?.memories ? me.returnMemories() : me.popOutMemories()
    }

    /**
     * @summary Continues the product-owned click-detail connect after the engine has read and
     * admitted the owner URL as a non-tear-out route. The generation was captured synchronously
     * before that URL read, so a raced reattach still makes this continuation inert.
     * @param {Object} data `{appName, windowId}`
     * @param {Object} context Engine-owned route context.
     * @param {Object} context.app Connected popup application.
     * @param {Number} context.consumerContext Captured detail-vessel generation.
     * @param {URLSearchParams} context.params Admitted owner URL params.
     * @protected
     */
    onUnhandledWindowConnect(data, {app, consumerContext: generation, params}) {
        let me         = this,
            {windowId} = data;

        if (
            !me.detachedDetail || !me.detachedDetailPane ||
            generation !== me.detailVesselGeneration     ||
            me.detailVesselState !== 'opening'           ||
            params.get('detail') !== 'agent-detail'
        ) {
            return
        }

        let {connectTimer} = me.detachedDetail;

        connectTimer && clearTimeout(connectTimer);

        me.detachedDetail.connectTimer = null;
        me.detachedDetail.windowId     = windowId;
        me.detailVesselState           = 'connected';

        app.mainView.add(me.detachedDetailPane);

        me.detailVesselState = 'windowed';
        me.syncControlBar()
    }

    /**
     * @summary Continues a non-tear-out disconnect for the click-detail vessel. Engine-owned
     * gesture vessels are already reconciled before this hook can run.
     * @param {Object} data `{appName, windowId}`
     * @protected
     */
    onUnhandledWindowDisconnect(data) {
        if (this.detachedDetail?.windowId === data.windowId) {
            this.reattachAgentDetail({windowAlreadyClosed: true})
        }
    }

    /**
     * @summary Pushes the bound instance's label into one torn-out window's `document.title` —
     * the scope rule made mechanical: a torn-out window has no chrome switcher and no spine
     * banner, so its OS title is the one place its scope can live. Reads the SAME provider truth
     * the banner composes from (bound profileId → roster row → label-or-endpoint); a missing
     * roster row pushes nothing — absence stays absence, never an invented name. Rides the
     * DocumentHead addon per target window; deliberately NOT the torn-out pane's controller chain,
     * so the known torn-out handler-loss class (a vessel's controller resolving to a cached null)
     * cannot reach it.
     * @param {String} windowId The torn-out window to title.
     */
    pushInstanceTitle(windowId) {
        let provider = this.getStateProvider(),
            boundId  = provider?.getData('boundProfileId'),
            record   = boundId ? provider.getStore('fleetInstances')?.get(boundId) : null,
            label    = record ? (record.label || String(record.canonicalEndpoint).replace(/^https?:\/\//, '')) : null;

        label && windowId && Neo.main.addon.DocumentHead.setTitle({
            value: `${label} — Agent OS`,
            windowId
        })
    }

    /**
     * @summary Synchronize the vessel-owned chrome: the pane-side window toggles (label follows
     * the state machine) and the exception-only recall verbs (visible ONLY while a pane is away
     * — the main view must always hold a way home). The preset half of the bar belongs to the
     * subclass ({@link AgentOS.view.fleet.cockpit.Container#syncControlBar}).
     */
    syncVesselChrome() {
        // the window verbs live in their panes' chrome now — a windowed/torn pane sits OUTSIDE
        // this cockpit's getReference reach, so the sync routes through the phase-blind accessors
        let me     = this,
            toggle = me.getAgentDetailPane()?.getReference('detail-window-toggle'),
            state  = me.detailVesselState,
            out    = state === 'opening' || state === 'connected' || state === 'windowed',
            // convergence-by-guard: while a GESTURE tear-out owns the detail pane, the click
            // toggle is inert — one vessel pathway at a time (G4 owns richer convergence)
            torn   = Boolean(me.tearOutPanes?.detail || me.tearOutPaneHandles?.detail);

        if (toggle) {
            const label = torn ? 'Detail torn out' : (out ? 'Reattach detail' : 'Pop out detail');

            toggle.set({disabled: state === 'reattaching' || torn});
            // icon-only action (#23): the state-named label rides title + aria, byte-equal —
            // attribute strings, inert by construction
            toggle.vdom.title          = label;
            toggle.vdom['aria-label']  = label;
            toggle.mounted && toggle.update()
        }

        // the exception-only recall verb: visible ONLY while the pane is away — the main view
        // must always hold a way home, and the traveling pane-side toggle cannot provide it here.
        // An ADOPTED gesture vessel recalls (returnDetail); mid-gesture disables instead of racing.
        me.getReference('detail-recall-chrome')?.set({
            disabled: state === 'reattaching' || (torn && !me.tearOutPanes?.detail),
            hidden  : !(out || torn),
            text    : torn ? 'Recall detail' : 'Reattach detail'
        });

        let memoriesToggle = me.getMemoriesPane()?.getReference('memories-window-toggle'),
            // click pop-out and gesture tear-out are ONE pathway for this pane, so an adopted
            // vessel honestly offers the return action either way; only the mid-gesture window
            // (captured handle, no adopted vessel yet) disables instead of racing the gesture
            adopted    = Boolean(me.tearOutPanes?.memories),
            midGesture = !adopted && Boolean(me.tearOutPaneHandles?.memories);

        memoriesToggle?.set({
            disabled: midGesture,
            text    : adopted ? 'Return memories' : 'Pop out memories'
        });

        me.getReference('memories-recall-chrome')?.set({
            disabled: midGesture,
            hidden  : !(adopted || midGesture)
        })
    }

    /**
     * @summary Retire the vessel layer's owned state with the view: a still-detached inspector
     * is OWNED state outside any projection — bump the generation (in-flight admission
     * continuations go inert), clear the connect timer, close its vessel (fire-and-forget — the
     * disconnect guard keeps a late event inert) and destroy the instance. The inherited
     * workspace retires gesture vessels, captured panes and worker listeners exactly once.
     * @param {...*} args
     */
    destroy(...args) {
        let me = this;

        me.detailVesselGeneration++;

        if (me.detachedDetail) {
            me.detachedDetail.connectTimer && clearTimeout(me.detachedDetail.connectTimer);
            Neo.Main.windowClose({names: [me.detachedDetail.windowName], windowId: me.windowId}).catch(() => {});
            me.detachedDetail = null
        }

        me.detachedDetailPane?.destroy();
        me.detachedDetailPane = null;

        super.destroy(...args)
    }
}

export default Neo.setupClass(VesselContainer);
