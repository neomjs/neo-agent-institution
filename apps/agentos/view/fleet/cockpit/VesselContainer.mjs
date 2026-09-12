import Button            from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import WorkspaceDocument from '../../../../../node_modules/neo.mjs/src/dashboard/dock/model/WorkspaceDocument.mjs';
import Workspace         from '../../../../../node_modules/neo.mjs/src/dashboard/dock/Workspace.mjs';

/**
 * @summary The cockpit's vessel + window-chrome layer — every pop-out / tear-out / return
 * affordance between the engine's {@link Neo.dashboard.dock.Workspace} tear-out owner and the
 * declared Fleet cockpit, factored per the container-declares ruling (the container declares;
 * the vessel chrome is its own class).
 *
 * The engine owns the vessel lifecycle: admission, the one detach commit, adoption into the
 * connected window, the return on vessel death, and the pane handles in between
 * ({@link Neo.dashboard.dock.window.TearOut} composed by the Workspace, ownership recorded by the
 * Group's native lifecycle). Three responsibilities remain here, nothing else:
 * - **The platform seams** the engine asks the host for: {@link #openTearOutVessel} (the
 *   widget-childapp vessel window), {@link #closeTearOutVessel}, and the generic pane
 *   capability {@link #resolveLivePane} (the projected pane for an item).
 * - **The click pop-out** — one pathway for every pane: {@link #popOutPane} enters the engine's
 *   header-action admission ({@link Neo.dashboard.dock.Workspace#handleDockPopOutAction}) and
 *   {@link #returnPane} closes the vessel, because vessel death IS the return path.
 * - **The phase-blind pane accessors + vessel chrome** (`getMemoriesPane` and friends,
 *   {@link #syncVesselChrome}, the window-toggle builders): one resolution order — the owner's
 *   held handle → a pane in flight home → the docked projection — so every owner push lands in
 *   the live pane whatever phase it is in.
 *
 * Host slots this layer expects from its subclass (the template-method grammar the engine
 * already uses with us): `resolveDockReference` (pane materialization), `syncControlBar` (the
 * full chrome pass; {@link #syncVesselChrome} is the half owned here).
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
        className: 'AgentOS.view.fleet.cockpit.VesselContainer'
    }

    /**
     * The designed vessel composition per pane, where a pane has one — the inspector's own layout
     * grammar (its four SSOT panes with the title + provenance row) is composed for 480px, so its
     * vessel opens at that composition instead of the rail-revealed rect the click was measured on.
     * Panes without a row open at their measured size, the engine's default.
     * @member {Object} vesselCompositions
     * @protected
     */
    static vesselCompositions = Object.freeze({
        detail: {x: 160, y: 120, width: 480, height: 640}
    })

    /**
     * The geometry the engine hands the vessel for a click pop-out: the measured pane rect, or
     * the pane's designed composition when it has one ({@link #vesselCompositions}).
     * @param {Neo.tab.Container|null} tabContainer
     * @returns {Promise<Object|null>}
     * @protected
     */
    async measureDockPaneRect(tabContainer) {
        const composition = VesselContainer.vesselCompositions[this.getActiveDockItemId(tabContainer)];

        return composition ? {...composition} : super.measureDockPaneRect(tabContainer)
    }

    /**
     * The engine's generic pane capability: the live pane the projected tree renders for an
     * item. The tear-out owner asks this AFTER its own held handles, so a captured or returning
     * pane never reaches here.
     * @param {String} itemId
     * @returns {Neo.component.Base|null}
     * @protected
     */
    resolveLivePane(itemId) {
        return this.findProjectedDockPane(itemId)
    }

    /**
     * Keeps Fleet's vessel affordances truthful after the Group records or withdraws committed
     * vessel ownership.
     * @param {String} itemId
     * @param {Object|null} entry
     * @param {Object|null} connection
     * @param {Boolean} merge
     * @protected
     */
    afterNativeOwnerChange(itemId, entry, connection, merge) {
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
     * Re-syncs pane toggles after physical vessel retirement.
     * @param {Object} data
     * @protected
     */
    afterTearOutWindowDisconnect(data) {
        this.syncControlBar()
    }

    /**
     * Re-syncs the vessel chrome once a pane has come home — the engine's one return channel.
     * @param {Object} data `{error, errors, itemId, pane, phase, returned}`
     * @protected
     */
    onDockPaneReturn(data) {
        super.onDockPaneReturn(data);
        data.phase === 'after' && this.syncControlBar()
    }

    /**
     * @summary SHELL-owned pop-out affordance config for the Memories pane. Lives in the PANE's
     * chrome per the navigation model (pane verbs are pane-scoped, the bar seats instance-wide
     * tenants only); ownership, handler and label sync stay here — the pane merely places it
     * through its layout-blind `shellTools` slot, so a vesseled pane carries its own return verb
     * with it.
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
     * @summary SHELL-owned pop-out affordance config for the inspector; {@link #syncVesselChrome}
     * keeps title + aria naming the action it will take.
     *
     * Icon-only by design (operator direction): the pane places this through its
     * layout-blind `shellTools` slot onto the tab header bar's ACTION seam — one icon at the
     * strip's trailing edge, outside the content flow. `contextual: false` keeps it persistent:
     * windowing the pane is a pane verb, not a per-tab one. The label lives on title + aria-label,
     * byte-equal.
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
     * @summary The reference a dock item's live view carries — the record's own `reference`, with
     * the one deliberate remap: the define-agent item's view is the add-agent form.
     * @param {String} itemId
     * @returns {String|null}
     * @protected
     */
    paneReference(itemId) {
        const reference = this.dockModel?.items?.[itemId]?.reference ?? null;

        return reference === 'define-agent' ? 'add-agent-form' : reference
    }

    /**
     * Resolves a dock item's LIVE pane instance from the projected tree by the stable reference
     * names {@link #resolveDockReference} assigns. Items whose resolver yields an unreferenced
     * placeholder (sibling-leaf panes) resolve `null` — which is exactly the admission refusal:
     * a placeholder cannot embody into a vessel.
     * @param {String} itemId
     * @returns {Neo.component.Base|null}
     * @protected
     */
    findProjectedDockPane(itemId) {
        const reference = this.paneReference(itemId);

        return reference ? (this.getReference(reference) || null) : null
    }

    /**
     * @summary The live pane a vessel holds for one item — the owner's captured handle first
     * (mid-gesture or adopted), then a pane in flight home (the vessel-death parking window: an
     * owner push landing there must still reach the LIVE instance, or the eventual adoption
     * renders a stale snapshot), never the projected tree.
     * @param {String} itemId
     * @returns {Neo.component.Base|null}
     * @protected
     */
    vesselPane(itemId) {
        const handlers = this.tearOutHandlers;

        if (!handlers) return null;

        const held = handlers.heldPane(itemId);

        if (held && !held.isDestroyed) return held;

        const reference = this.paneReference(itemId);

        return reference
            ? handlers.heldPanes().find(pane => !pane.isDestroyed && pane.reference === reference) || null
            : null
    }

    /**
     * @summary Whether the Group records committed vessel ownership for an item — the pane lives
     * in its own window, and the return path is that window's death.
     * @param {String} itemId
     * @returns {Boolean}
     * @protected
     */
    isVesselOwned(itemId) {
        return !!this.nativeWindows?.getOwner(this.id, itemId)
    }

    /**
     * @summary Whether a vessel is in flight for an item without committed ownership yet — the
     * admission or the gesture window, where a second verb must refuse instead of racing.
     * @param {String} itemId
     * @returns {Boolean}
     * @protected
     */
    isVesselPending(itemId) {
        const handlers = this.tearOutHandlers;

        if (!handlers || this.isVesselOwned(itemId)) return false;

        return handlers.activeVessel?.itemId === itemId
            || !!handlers.heldPane(itemId)
            || !!this.nativeWindows?.getAdmission(this.id, itemId)
            || !!this.nativeWindows?.getConnection(this.id, itemId)
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.detail.Container} instance wherever it
     * currently renders — the projected tree while docked, the owner's handle while vesseled. A
     * vessel-mounted pane lives in the popup's view tree, out of this cockpit's `down()` /
     * `getReference` reach, so every detail consumer (record mutation, selection reconciliation,
     * the card→detail drill) routes through this accessor — the windowed inspector stays as live
     * as the docked one.
     * @returns {Neo.container.Base|null} The detail pane, or `null` before its first materialization.
     */
    getAgentDetailPane() {
        return this.vesselPane('detail') || this.getReference('agent-detail')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.mailbox.OperatorContainer} instance whether it is
     * docked, vesseled, or in flight home. A vesseled pane lives outside this cockpit's projected
     * tree, so owner-side identity and inbox refreshes must use the owner's handle instead of
     * stopping at `getReference()` — and a push landing in the returning window must still reach
     * the LIVE instance ({@link #getMemoriesPane} contract).
     * @returns {Neo.container.Base|null} The operator mailbox, or `null` before materialization.
     */
    getOperatorMailboxPane() {
        return this.vesselPane('operator') || this.getReference('operator-mailbox')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.catchup.Container} instance whether it is
     * docked, vesseled, or in flight home — the {@link #getOperatorMailboxPane} contract for the
     * catch-up reading surface, so roster-driven option refreshes and the bridge-arrival history
     * re-drive reach a vesseled or returning pane too.
     * @returns {Neo.container.Base|null} The catch-up pane, or `null` before materialization.
     */
    getCatchUpPane() {
        return this.vesselPane('catchUp') || this.getReference('catch-up')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.memories.Container} instance whether it is
     * docked, revealed, or vesseled — the click pop-out ({@link #popOutPane}) and the gesture
     * tear-out share one pathway, so one owner answers both. Owner-side pushes (snapshot writes,
     * roster option refreshes, reconnect re-drives) must route through this accessor instead of
     * stopping at `getReference()`: a vesseled pane lives outside this cockpit's projected tree.
     * @returns {Neo.container.Base|null} The memories pane, or `null` before materialization.
     */
    getMemoriesPane() {
        return this.vesselPane('memories') || this.getReference('memories')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.wake.Container} instance whether it is
     * docked, vesseled, or in flight home — the {@link #getMemoriesPane} contract for the
     * wake-routes surface, so snapshot writes and the reconnect re-drive reach the pane in every phase.
     * @returns {Neo.container.Base|null} The wake-routes pane, or `null` before materialization.
     */
    getWakeRoutesPane() {
        return this.vesselPane('wakeRoutes') || this.getReference('wakeRoutes')
    }

    /**
     * @summary Resolve the live {@link AgentOS.view.fleet.tasks.Container} instance whether it is
     * docked, vesseled, or in flight home — the {@link #getMemoriesPane} contract for the tasks
     * surface, so the liveness tick's snapshot writes reach the pane in every phase.
     * @returns {Neo.container.Base|null} The tasks pane, or `null` before materialization.
     */
    getTasksPane() {
        return this.vesselPane('tasks') || this.getReference('tasks')
    }

    /**
     * The platform half of the engine's admission: opens the vessel window for a gesture tear-out
     * or a click pop-out, reusing the SAME widget-childapp shell for both (an empty pane host —
     * the engine reparents the live pane on connect). The Group's reserved slot rides the window
     * as its `topologyIdentity`: that is how the connecting window binds to this admission, so the
     * engine adopts the pane into it and returns it on the window's death. Fail-closed per the
     * admission contract: `Neo.Main.windowOpen` resolves **Boolean** (a blocked popup never
     * throws), and any refused precondition — an item already vessel-owned or in flight, an
     * unresolvable live pane (placeholder items) — or falsy/throwing acquisition returns `null`,
     * degrading the gesture to its in-window fallback with zero vessel state.
     * @param {Object} request
     * @param {String} request.itemId
     * @param {Object} request.proxyRect
     * @param {Object} request.topologyIdentity The Group slot reserved for this admission.
     * @returns {Promise<{popupHeight: Number, popupWidth: Number, windowName: String}|null>}
     * @protected
     */
    async openTearOutVessel({itemId, proxyRect, topologyIdentity}) {
        let me         = this,
            windowName = `fm-tearout-${itemId}-${me.id}`;

        // fail-closed preconditions: only a live, projected, singly-owned pane may embody
        if (me.isVesselOwned(itemId) || !me.findProjectedDockPane(itemId)) {
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
                    nativeCapabilities: {close: true, position: true, resize: true},
                    topologyIdentity,
                    url               : `${basePath}apps/agentos/childapps/widget/index.html?tearout=${itemId}`,
                    windowFeatures    : `height=${height},left=${left},top=${top},width=${width}`,
                    windowId          : me.windowId,
                    windowName
                });

            if (opened === false) return null;

            return {popupHeight: height, popupWidth: width, windowName}
        } catch (error) {
            return null
        }
    }

    /**
     * Platform retirement hook: closes a vessel the engine no longer needs (re-entry, cancel,
     * timeout, a refused model commit, a return). The platform's answer IS the retirement signal:
     * `Neo.Main.windowClose` resolves `true` only when it closed that window; `false` (no such
     * window, already closed, not closable) and a rejection both reach the Group's lifecycle
     * unchanged, which keeps its retry authority for that exact vessel until a later close or the
     * window's own release settles it. Nothing here infers absence from a failure.
     * @param {Object} vessel
     * @param {String} vessel.itemId
     * @param {String} vessel.windowName
     * @returns {Promise<Boolean>}
     * @protected
     */
    closeTearOutVessel({windowName}) {
        return Neo.Main.windowClose({names: [windowName], windowId: this.windowId})
    }

    /**
     * @summary Detach one docked pane into its own OS window on the shared heap — the click
     * pop-out on the engine's own admission path, the same one the tab header's pop-out action
     * takes: admission first (a refused vessel leaves the pane untouched and uncommitted), then
     * the ONE detach commit at the terminal, adoption when the window binds, and the vessel's
     * death as the return. The pane must be the visible member of its zone — you pop out what you
     * see — and the dock document stays the layout SSOT throughout.
     *
     * Selection travels BY IDENTITY: the vessel hosts the LIVE pane instance, so the active agent
     * and cards move with the window. A blocked popup (`windowOpen` resolves `false`, it never
     * throws) refuses before any document mutation — commit-or-neither — and the silent-refusal
     * witness names it, because a click that mutates nothing is otherwise indistinguishable from a
     * dead button.
     * @param {String} itemId
     * @returns {Promise<{detached: Boolean, errors: String[]}>}
     */
    async popOutPane(itemId) {
        let me     = this,
            tabsId = WorkspaceDocument.findContainingTabsId(me.dockModel, itemId);

        if (me.isVesselOwned(itemId) || me.isVesselPending(itemId)) {
            return {detached: false, errors: [`${itemId} is already in a vessel`]}
        }

        if (!tabsId) {
            return {detached: false, errors: [`${itemId} is not a docked item`]}
        }

        let pane         = me.findProjectedDockPane(itemId),
            tabContainer = pane?.up({ntype: 'tab-container'}) || me.getDockHost()?.down({dockNodeId: tabsId}) || null;

        if (!tabContainer || me.getActiveDockItemId(tabContainer) !== itemId) {
            return {detached: false, errors: [`${itemId} is not the visible pane of its zone`]}
        }

        let result = await me.handleDockPopOutAction({dockNodeId: tabsId, tabContainer});

        if (result.errors.length) {
            me.warnVesselAdmissionFailure('refused', {itemId, errors: result.errors})
        }

        me.syncControlBar();

        return {detached: !result.errors.length, errors: result.errors}
    }

    /**
     * @summary Bring a vesseled pane home by retiring its exact vessel through the Group: the
     * engine closes the OS window through {@link #closeTearOutVessel}, and vessel death IS the
     * return path — the Group observes the release and the engine returns the SAME live instance
     * to its recorded home. The verdict is the Group's: `returned: true` only when the platform
     * confirmed the close on this call; a refused or failed close leaves the retirement pending in
     * the Group (its retry authority — the next return or the next admission for this item tries
     * again), keeps the owner, and is reported as not returned. An attempted close is never a
     * return, and no window is ever closed around the Group's back.
     * @param {String} itemId
     * @returns {Promise<{returned: Boolean, errors: String[]}>}
     */
    async returnPane(itemId) {
        let me    = this,
            owner = me.nativeWindows?.getOwner(me.id, itemId),
            retired;

        if (!owner) {
            return {returned: false, errors: [`${itemId} is not in a vessel`]}
        }

        try {
            retired = await me.nativeWindows.retire(me.id, {...owner, itemId})
        } catch (error) {
            return {returned: false, errors: [`the vessel window did not close: ${error?.message ?? error}`]}
        }

        return retired === true
            ? {returned: true, errors: []}
            : {returned: false, errors: ['the vessel window did not close']}
    }

    /**
     * @summary One self-describing line per silent admission refusal — the flap witness. A refused
     * pop-out rolls nothing back, so without this line a blocked popup is visually
     * indistinguishable from a dead button; the App-Worker console bridges into the Neural Link
     * console stream, so harnesses and agents can tell an admission failure from a deliberate return
     * without polling cockpit state.
     * @param {String} kind The refusal: 'blocked', 'timeout' or 'refused'.
     * @param {Object} meta Item + reason context, so the line stands alone in a log.
     * @protected
     */
    warnVesselAdmissionFailure(kind, meta) {
        console.warn(`[FleetCockpit] ${meta?.itemId ?? 'detail'}-vessel admission failed (${kind}):`, meta)
    }

    /**
     * @summary The SHELL-owned window-toggle affordance for the inspector: an owned vessel returns
     * home, an in-flight one refuses instead of racing, a docked pane pops out. Reachable from
     * the traveling pane-side toggle and the main view's recall verb alike.
     * @returns {Promise<Object>} The routed operation's result.
     */
    onDetailWindowToggle() {
        return this.toggleVessel('detail')
    }

    /**
     * @summary SHELL-owned toggle routing for the Memories pane vessel — the
     * {@link #onDetailWindowToggle} grammar on the same pathway.
     * @returns {Promise<Object>} The routed operation's result.
     */
    onMemoriesWindowToggle() {
        return this.toggleVessel('memories')
    }

    /**
     * @summary The one toggle grammar: owned → return, in flight → refuse, docked → pop out.
     * @param {String} itemId
     * @returns {Promise<Object>}
     * @protected
     */
    toggleVessel(itemId) {
        let me = this;

        if (me.isVesselOwned(itemId)) {
            return me.returnPane(itemId)
        }

        if (me.isVesselPending(itemId)) {
            return Promise.resolve({errors: ['a vessel is in flight for this pane'], detached: false})
        }

        return me.popOutPane(itemId)
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
     * the vessel's phase) and the exception-only recall verbs (visible ONLY while a pane is away
     * — the main view must always hold a way home). The preset half of the bar belongs to the
     * subclass ({@link AgentOS.view.fleet.cockpit.Container#syncControlBar}).
     */
    syncVesselChrome() {
        // the window verbs live in their panes' chrome now — a vesseled pane sits OUTSIDE this
        // cockpit's getReference reach, so the sync routes through the phase-blind accessors
        let me             = this,
            detailOwned    = me.isVesselOwned('detail'),
            detailPending  = me.isVesselPending('detail'),
            detailToggle   = me.getAgentDetailPane()?.getReference('detail-window-toggle'),
            detailLabel    = detailOwned ? 'Return detail' : detailPending ? 'Detail leaving' : 'Pop out detail';

        if (detailToggle) {
            detailToggle.set({disabled: detailPending});
            // icon-only action: the state-named label rides title + aria, byte-equal —
            // attribute strings, inert by construction
            detailToggle.vdom.title         = detailLabel;
            detailToggle.vdom['aria-label'] = detailLabel;
            detailToggle.mounted && detailToggle.update()
        }

        // the exception-only recall verb: visible ONLY while the pane is away — the main view
        // must always hold a way home, and the traveling pane-side toggle cannot provide it here.
        // An owned vessel recalls; an in-flight one disables instead of racing.
        me.getReference('detail-recall-chrome')?.set({
            disabled: detailPending,
            hidden  : !(detailOwned || detailPending),
            text    : 'Return detail'
        });

        let memoriesOwned   = me.isVesselOwned('memories'),
            memoriesPending = me.isVesselPending('memories'),
            memoriesToggle  = me.getMemoriesPane()?.getReference('memories-window-toggle');

        memoriesToggle?.set({
            disabled: memoriesPending,
            text    : memoriesOwned ? 'Return memories' : 'Pop out memories'
        });

        me.getReference('memories-recall-chrome')?.set({
            disabled: memoriesPending,
            hidden  : !(memoriesOwned || memoriesPending)
        })
    }
}

export default Neo.setupClass(VesselContainer);
