import LivenessController          from './LivenessController.mjs';
import CockpitPresets              from '../../../util/CockpitPresets.mjs';
import FleetLifecycleIntentAdapter from '../../../util/FleetLifecycleIntentAdapter.mjs';
import FleetStartPlan              from '../../../util/FleetStartPlan.mjs';
import SourceHealth                from '../../../util/SourceHealth.mjs';

/**
 * @summary The cockpit's intent + command layer — the surface-fired intent relays, the per-pane
 * snapshot reads and the fleet-start batch, per the #50 architecture ruling: view logic lives on
 * the controller (lifecycle-bound, first-class `this.component` access), never on a util a view
 * object gets passed into. The wire-liveness half (roster/activity/Brain-health loads, cadence,
 * reconnect, viewer-wake custody) is the inherited
 * {@link AgentOS.view.fleet.cockpit.LivenessController} layer.
 *
 * State split (the operator's partial-provider ruling): truths MORE THAN ONE surface reads live
 * on {@link AgentOS.view.fleet.cockpit.StateProvider} and the surfaces bind. Per-pane snapshots
 * (operator inbox, memories + drill, wake routes, tasks, catch-up) are CONTROLLER state below,
 * written to their one pane directly at WRITE time through the view's phase-blind accessors (a
 * pane torn into a vessel or parked in a returning window still receives the truth; a destroyed
 * one never swallows it).
 *
 * Every read follows the inherited one discipline: fence bump FIRST, verb-presence check, typed
 * unavailable fallback (never a fabricated success), and only the newest generation writes.
 *
 * @class AgentOS.view.fleet.cockpit.Controller
 * @extends AgentOS.view.fleet.cockpit.LivenessController
 */
class Controller extends LivenessController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.Controller'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.Controller',
        /**
         * @member {String} ntype='fm-fleet-cockpit-controller'
         * @protected
         */
        ntype: 'fm-fleet-cockpit-controller'
    }

    /**
     * Read-fence + owner-held snapshot for the catch-up history surface.
     * @member {Number} catchUpReadGeneration=0
     * @protected
     */
    catchUpReadGeneration = 0
    /**
     * @member {Object|null} catchUpSnapshot=null
     * @protected
     */
    catchUpSnapshot = null
    /**
     * The last explicit mark-caught-up outcome, owner-held for pane rematerialization.
     * @member {Object|null} catchUpMarkOutcome=null
     * @protected
     */
    catchUpMarkOutcome = null
    /**
     * The read-fence + owner-held drill state for the memories surfaces.
     * @member {Number} memoriesReadGeneration=0
     * @protected
     */
    memoriesReadGeneration = 0
    /**
     * @member {Number} memoriesDrillReadGeneration=0
     * @protected
     */
    memoriesDrillReadGeneration = 0
    /**
     * The open memories drill — `{sessionId, title}` — owner-held BEFORE any await, so a pane
     * rematerialized mid-read reopens on the PENDING drill.
     * @member {Object|null} memoriesDrillSession=null
     * @protected
     */
    memoriesDrillSession = null
    /**
     * @member {Object|null} memoriesDrillSnapshot=null
     * @protected
     */
    memoriesDrillSnapshot = null
    /**
     * @member {Object|null} memoriesSnapshot=null
     * @protected
     */
    memoriesSnapshot = null
    /**
     * The memories pane's pending target, owner-held BEFORE the await (honest switch-pending on
     * rematerialization, never the last accepted target).
     * @member {String|null} memoriesTarget=null
     * @protected
     */
    memoriesTarget = null
    /**
     * Read-fence + owner-held snapshot for the operator's own mailbox mirror.
     * @member {Number} operatorInboxReadGeneration=0
     * @protected
     */
    operatorInboxReadGeneration = 0
    /**
     * @member {Object|null} operatorSnapshot=null
     * @protected
     */
    operatorSnapshot = null
    /**
     * The resolved operator identity record (`{agentIdentityNodeId, githubUsername}`) — the
     * bootstrap leg of "the client SAYS self, the admission stamp proves it".
     * @member {Object|null} operatorRecord=null
     * @protected
     */
    operatorRecord = null
    /**
     * The seat-conflation posture derived from the roster for the resolved viewer identity.
     * @member {Object|null} operatorIdentityPosture=null
     * @protected
     */
    operatorIdentityPosture = null
    /**
     * The active fleet-start batch — repeated activations join it until its summary and one
     * roster reconciliation settled.
     * @member {Promise<Object>|null} startFleetPromise=null
     * @protected
     */
    startFleetPromise = null
    /**
     * Read-fence + in-flight accounting + owner-held snapshot for the tasks surface.
     * @member {Number} tasksReadGeneration=0
     * @protected
     */
    tasksReadGeneration = 0
    /**
     * @member {Number} tasksReadInFlight=0
     * @protected
     */
    tasksReadInFlight = 0
    /**
     * @member {Object|null} tasksSnapshot=null
     * @protected
     */
    tasksSnapshot = null
    /**
     * Read-fence + owner-held snapshot for the wake-routes surface.
     * @member {Number} wakeRoutesReadGeneration=0
     * @protected
     */
    wakeRoutesReadGeneration = 0
    /**
     * @member {Object|null} wakeRoutesSnapshot=null
     * @protected
     */
    wakeRoutesSnapshot = null
    /**
     * @summary The cockpit-owned authenticated bridge — resolved fresh per call, never captured.
     * @returns {Object|undefined}
     * @protected
     */
    get bridge() {
        return globalThis.AgentOS?.fleet?.registryBridge
    }

    /* ── intent relays (the B4÷C2 seam: surfaces fire intents, this composition root owns the wire) ── */

    /**
     * @summary Consume a card's `lifecycleIntent` and drive the honest round-trip: the intent +
     * that card's roster record go to the C2 adapter, which writes pending/settled/rejected state
     * onto the record — never an optimistic success.
     * @param {Object} data `{action, agentId, source}` — Neo stamps `source`.
     */
    onAgentLifecycleIntent(data) {
        const card = Neo.getComponent(data.source);

        return card && this.refreshRosterOnSettle(
            FleetLifecycleIntentAdapter.handleFleetLifecycleIntent(data, card.record).then(result => Boolean(result?.ok))
        )
    }

    /**
     * @summary Drill into a resident: resolve the record from the provider-owned store, seat it
     * through the view's ONE selection-write site, and reveal the auto-hidden detail pane.
     * @param {Object} data The `agentSelect` payload `{agentId}`.
     */
    onAgentSelect(data) {
        const
            cockpit = this.component,
            record  = this.resolveFleetRosterStore()?.get(data.agentId);

        if (!record) {
            return
        }

        this.applySelection(record);

        if (cockpit.dockModel?.items?.detail?.autoHidden) {
            const result = cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'detail', autoHidden: false});

            result && !result.errors?.length && cockpit.onDockZoneDocumentChange(result.document)
        }
    }

    /**
     * @summary The grid's bootstrap CTA (empty fleet) opens the S5 define-agent zone.
     * @param {Object} data The `addAgentRequest` payload.
     */
    onAddAgentRequest(data) {
        const cockpit = this.component;

        if (cockpit.dockModel?.items?.defineAgent?.autoHidden) {
            const result = cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'defineAgent', autoHidden: false});

            result && !result.errors?.length && cockpit.onDockZoneDocumentChange(result.document)
        }
    }

    /**
     * @summary Relay the operator-mailbox compose intent to the fleet write verb and close the
     * outcome loop: `Observable.fire` discards handler returns, so the settled per-recipient
     * outcome is written back onto the mailbox surface for the form to render — a refusal is
     * never invisible.
     * @param {Object} data The `compose` payload `{message, source}`.
     */
    async onOperatorCompose(data) {
        const
            outcome = await this.composeOperatorMessage(data.message),
            mailbox = this.getReference('operator-mailbox');

        mailbox && (mailbox.composeOutcome = outcome);

        return outcome
    }

    /**
     * @summary Relay the operator-mailbox paged re-read.
     * @param {Object} data `{offset, source}`
     */
    onOperatorInboxPageRequest(data) {
        return this.loadOperatorInbox({offset: data.offset})
    }

    /**
     * @summary Relay a CatchUpPane read intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpHistoryRequest(data) {
        const {source, ...params} = data;

        return this.loadCatchUp(params)
    }

    /**
     * @summary Relay the explicit runtime-only mark intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpMarkRequest(data) {
        return this.markCatchUp({windowEnd: data.windowEnd})
    }

    /**
     * @summary Route to the existing live adjacency without turning it into history authority.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpLiveSurfaceRequest(data) {
        return this.openCatchUpLiveSurface({target: data.target})
    }

    /**
     * @summary Relay a MemoriesPane read intent.
     * @param {Object} data `{agentIdentity, offset?}`
     * @returns {Promise<Object>}
     */
    onMemoriesRequest(data) {
        const {source, ...params} = data;

        return this.loadMemories(params)
    }

    /**
     * @summary Relay a MemoriesPane drill-in read intent.
     * @param {Object} data `{sessionId, title?, offset?}`
     * @returns {Promise<Object>}
     */
    onSessionDetailRequest(data) {
        const {source, ...params} = data;

        return this.loadSessionMemories(params)
    }

    /**
     * @summary Clear the owner-held drill when the pane closes it — a drill the operator left
     * must not reopen on rematerialization.
     * @param {Object} data
     */
    onSessionDetailClosed(data) {
        this.clearSessionMemoriesDrill()
    }

    /**
     * @summary Relay a WakeRoutePane read intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onWakeRoutesRequest(data) {
        const {source, ...params} = data;

        return this.loadWakeRoutes(params)
    }

    /**
     * @summary Relay a PerspectivesPane intent: `apply` switches the cockpit to the named
     * perspective through the same path the preset switcher uses; `capture` wraps the live dock
     * document under the given name. Both re-project the list the drawer binds to.
     * @param {Object} data
     * @param {String} data.action `apply` or `capture`
     * @param {String} data.name The perspective's name
     * @returns {Object} the cockpit's verdict
     */
    onPerspectiveRequest(data) {
        const {action, name} = data;

        return action === 'capture'
            ? this.capturePerspective(name)
            : this.component.activatePerspective(name)
    }

    /**
     * @summary Capture the live dock document as a named perspective — the drawer's capture verb.
     * The wrapped record saves WITHOUT replacing: a name a shipped preset (or an earlier capture)
     * holds is refused with the library's collision verdict, never silently overwritten. A saved
     * capture is FILED, not activated: it joins the preset switcher through the view's ordinary
     * control-bar sync and reaches the drawer through the projected list, verdict included, while
     * the live layout stays what it is — the card's Apply is the switch.
     * @param {String} name The operator's name for the layout.
     * @returns {{saved: Boolean, layoutId: String|null, name: String|null, errors: String[]}}
     */
    capturePerspective(name) {
        let view    = this.component,
            verdict;

        // A capture that throws is still a verdict the drawer must show — a silent failure would
        // read as "nothing happened", the one outcome a capture verb may never produce.
        try {
            let {layout, errors} = CockpitPresets.captureSavedLayout(view.getDockZoneDocument(), name);

            verdict = {saved: false, layoutId: null, name: layout?.perspectiveName ?? null, errors};

            if (!errors.length) {
                // Never activate here: activating restores the capture as a new document, and a
                // perspective restore releases every open reveal — the drawer the operator is
                // looking at would close on its own verdict (measured: the pane left the DOM 50ms
                // after the click). The live layout already IS this document; Apply switches to it.
                const outcome = view.perspectiveStore.savePerspective(layout, {activate: false});

                verdict = {
                    saved   : outcome.saved,
                    layoutId: outcome.layoutId,
                    name    : layout.perspectiveName,
                    // the library's collision verdict names the HOLDER (`holderTitle` / `holderLayoutId`)
                    errors  : outcome.collision
                        ? [`"${layout.perspectiveName}" is already held by ${outcome.collision.holderTitle ?? outcome.collision.holderLayoutId}`]
                        : outcome.errors
                };

                outcome.saved && view.syncControlBar()
            }
        } catch (error) {
            console.error('FleetCockpit: capturing the live layout failed', error);
            verdict = {saved: false, layoutId: null, name: (name ?? '').trim() || null, errors: [`capture failed: ${error.message}`]}
        }

        view.publishPerspectives(verdict);
        return verdict
    }

    /**
     * @summary Relay a TasksPane read intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onTasksRequest(data) {
        const {source, ...params} = data;

        return this.loadTasks(params)
    }

    /**
     * @summary A preset button's click — activate the named perspective on the view (the dock
     * document + projection are view state; the button carries its `presetName`).
     * @param {Object} data
     */
    onPresetSelect(data) {
        this.component.activatePerspective(data.component.presetName)
    }

    /**
     * @summary The memories pop-out/return toggle — routed to the view's vessel state machine.
     * @param {Object} data
     */
    onMemoriesWindowToggle(data) {
        this.component.onMemoriesWindowToggle(data)
    }

    /**
     * @summary The detail pop-out/reattach toggle — routed to the view's vessel state machine.
     * @param {Object} data
     */
    onDetailWindowToggle(data) {
        this.component.onDetailWindowToggle(data)
    }

    /**
     * @summary The ONE selection-write site: seat a resident record (or null) as the cockpit's
     * selection truth everywhere it lives — the view-owned {@link AgentOS.view.fleet.cockpit.Container#detailRecord}
     * reactive config (its afterSet hook pushes the live pane; dock rematerialization reads it),
     * the provider pair (`selectedAgentId` / `selectedAgentIdentity`), and the memories
     * write-through (the one-picker contract: a selected resident with a verifiable mailbox
     * identity re-targets the pane through the view's phase-blind accessor, so a vesseled pane
     * re-targets exactly like a docked one).
     *
     * A null identity keeps the pane's LAST target: the summary corpus outlives the seat, so a
     * resident without identity authority (or a cleared selection) never blanks a valid read —
     * the provider pair still reports the honest null.
     * @param {Object|null} record The selected {@link AgentOS.model.FleetAgent} record, or null.
     */
    applySelection(record) {
        const
            me       = this,
            cockpit  = me.component,
            identity = record?.githubUsername ? `@${record.githubUsername}` : null;

        cockpit.detailRecord = record ?? null;   // afterSetDetailRecord pushes the live pane

        cockpit.setState({
            selectedAgentId      : record?.agentId ?? null,
            selectedAgentIdentity: identity
        });

        if (identity && identity !== me.memoriesTarget) {
            me.memoriesTarget = identity;
            cockpit.getMemoriesPane()?.set({activeAgent: identity})
        }
    }

    /**
     * @summary Focus the existing bounded live Activity surface as adjacency. No history citation
     * is injected into it and no alternate historical authority is implied.
     *
     * The stream is a resident south tab, so adjacency ACTIVATES its tab first: the jump usually
     * originates from a sibling reading surface (catch-up) whose tab is active, and focusing the
     * inactive card's unmounted DOM would be a silent no-op.
     * @param {Object} request `{target}`
     * @returns {Promise<{opened: Boolean, target: String}>}
     */
    async openCatchUpLiveSurface({target} = {}) {
        const
            me      = this,
            cockpit = me.component,
            stream  = target === 'activity-stream' ? me.getReference('activity-stream') : null;

        if (!stream) {
            return {opened: false, target: target || 'unknown'}
        }

        const strip = cockpit.down({dockNodeId: 'stream-tabs'}),
              index = cockpit.dockModel?.nodes?.['stream-tabs']?.items?.indexOf('stream') ?? -1;

        if (strip && index > -1 && strip.activeIndex !== index) {
            strip.activeIndex = index;
            // the card layout mounts the newly active item asynchronously; focus needs the DOM
            await cockpit.timeout(50)
        }

        stream.focus(stream.id, false, true);

        return {opened: true, target}
    }

    /* ── the fleet-start batch ── */

    /**
     * @summary Join the active one-click fleet-start batch, or create exactly one new batch.
     * @returns {Promise<Object>} The one authoritative batch outcome summary.
     */
    onStartFleet() {
        const me = this;

        if (!me.startFleetPromise) {
            me.startFleetPromise = me.executeStartFleetBatch().finally(() => {
                me.startFleetPromise = null
            })
        }

        return me.startFleetPromise
    }

    /**
     * @summary Execute the STAGED fleet bring-up: partition the full roster truth through the
     * pure eligibility rules (every fact from the wire, every exclusion named), drive each
     * eligible record's own honest round-trip, render the outcome summary, then re-poll the
     * roster once when anything genuinely started.
     * @returns {Promise<Object>} The outcome summary.
     * @protected
     */
    async executeStartFleetBatch() {
        const
            me      = this,
            records = me.getRosterRecords(),
            plan    = FleetStartPlan.partitionFleetStart(records);

        me.renderStartSummary(null);

        const results = await Promise.all(plan.eligible.map(record =>
            FleetLifecycleIntentAdapter.handleFleetLifecycleIntent({action: 'start', agentId: record.agentId}, record)
        ));

        const summary = FleetStartPlan.summarizeFleetStart(plan, results);

        me.renderStartSummary(summary);

        await me.refreshRosterOnSettle(Promise.resolve(results.some(result => result?.ok)));

        return summary
    }

    /**
     * @summary The full roster truth for fleet-level actions: the grid store's records (a folded
     * idle card is still a member); the rendered-cards fallback covers compositions without the
     * grid store reference.
     * @returns {Object[]}
     */
    getRosterRecords() {
        const store = this.getReference('fleet-grid')?.store;

        return store ? [...(store.items ?? [])] : this.getAgentCards().map(card => card.record).filter(Boolean)
    }

    /**
     * @summary Write the fleet-start outcome into the chrome summary slot — counts as text,
     * per-member reasons on the title; hidden again when cleared.
     * @param {Object|null} summary
     */
    renderStartSummary(summary) {
        const slot = this.getReference('fleet-start-summary');

        if (!slot) return;

        if (!summary) {
            slot.set({hidden: true, text: ''});
            return
        }

        const {detail, text} = FleetStartPlan.renderFleetStartSummary(summary);

        slot.vdom.title = detail;
        slot.set({hidden: false, text})
    }

    /**
     * @summary The rendered resident cards (the collapsed-idle fold and header excluded by ntype).
     * @returns {Neo.component.Base[]}
     */
    getAgentCards() {
        return (this.getReference('fleet-cards')?.items ?? []).filter(card => card.ntype === 'fm-agent-card')
    }

    /* ── provider store resolution (tolerant: an overridden provider chain degrades honestly) ── */

    /* ── the fenced pane-snapshot reads ── */

    /**
     * @summary READ-OBSERVE: one pane history intent → the fleet history verb; a typed
     * unavailable envelope on absence/throw, the accepted snapshot owner-held and written to the
     * pane at WRITE time.
     * @param {Object} [params]
     * @returns {Promise<Object>}
     */
    async loadCatchUp(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.catchUpReadGeneration,
            fallback   = reason => ({
                capability         : {state: 'unavailable', reason},
                needsFirstUseWindow: false,
                partition          : params.partition || 'unified',
                viewerState        : {lastSeen: null, lastVisitAt: null},
                window             : null,
                sources            : null
            });

        let snapshot;

        if (typeof bridge?.fleetHistory !== 'function') {
            snapshot = fallback('fleet history verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetHistory(params)
            } catch (error) {
                snapshot = fallback('fleet history read failed')
            }
        }

        if (generation === me.catchUpReadGeneration && !me.isDestroyed) {
            me.catchUpSnapshot = snapshot;

            const pane = me.component.getCatchUpPane();

            pane && (pane.snapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary RUNTIME-WRITE: advance the authenticated viewer's lastSeen through the pane's
     * rendered window end, then write the honest outcome back.
     * @param {Object} params `{windowEnd}`
     * @returns {Promise<Object>}
     */
    async markCatchUp(params) {
        const
            me       = this,
            {bridge} = me;

        let outcome;

        try {
            outcome = typeof bridge?.markFleetCaughtUp === 'function'
                ? await bridge.markFleetCaughtUp(params)
                : {status: 'not-wired', reason: 'fleet catch-up mark verb not wired'}
        } catch (error) {
            outcome = {status: 'error', reason: 'fleet catch-up mark failed'}
        }

        if (!me.isDestroyed) {
            me.catchUpMarkOutcome = outcome;

            const pane = me.component.getCatchUpPane();

            pane && (pane.markOutcome = outcome)
        }

        return outcome
    }

    /**
     * @summary READ-OBSERVE: one pane memories intent. The requested selection is owner-held
     * BEFORE any await — a pane rematerialized mid-read reopens on the PENDING target, never the
     * last accepted one.
     * @param {Object} [params] `{agentIdentity, offset?, limit?}`
     * @returns {Promise<Object>}
     */
    async loadMemories(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.memoriesReadGeneration;

        if (params.agentIdentity) {
            me.memoriesTarget = params.agentIdentity
        }

        const fallback = reason => ({
            capability: {state: 'unavailable', reason},
            viewer    : null,
            target    : params.agentIdentity || null,
            page      : {offset: params.offset ?? 0, limit: null},
            sessions  : [],
            count     : 0,
            total     : null
        });

        let snapshot;

        if (typeof bridge?.fleetMemories !== 'function') {
            snapshot = fallback('fleet memories verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetMemories(params)
            } catch (error) {
                snapshot = fallback('fleet memories read failed')
            }
        }

        if (generation === me.memoriesReadGeneration && !me.isDestroyed) {
            me.memoriesSnapshot = snapshot;

            const livePane = me.component.getMemoriesPane();

            livePane && (livePane.snapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary The memories drill-in — the summary read's discipline one level down: the open
     * drill is owner-held before the await, and display-only `title` never rides the wire.
     * @param {Object} params `{sessionId, title?, offset?, limit?}`
     * @returns {Promise<Object>}
     */
    async loadSessionMemories(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.memoriesDrillReadGeneration;

        if (params.sessionId) {
            me.memoriesDrillSession = {sessionId: params.sessionId, title: params.title ?? null}
        }

        const
            {title, ...wireParams} = params,
            fallback               = reason => ({
                capability: {state: 'unavailable', reason},
                viewer    : null,
                sessionId : params.sessionId || null,
                page      : {offset: params.offset ?? 0, limit: null},
                turns     : [],
                count     : 0,
                total     : null
            });

        let snapshot;

        if (typeof bridge?.fleetSessionMemories !== 'function') {
            snapshot = fallback('fleet session-memories verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetSessionMemories(wireParams)
            } catch (error) {
                snapshot = fallback('fleet session-memories read failed')
            }
        }

        if (generation === me.memoriesDrillReadGeneration && !me.isDestroyed) {
            me.memoriesDrillSnapshot = snapshot;

            const livePane = me.component.getMemoriesPane();

            livePane && (livePane.drillSnapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary Clear the owner-held drill — TERMINAL for in-flight reads: the fence bump makes a
     * read landing after close unwanted, so it can never repopulate the drill the operator left.
     */
    clearSessionMemoriesDrill() {
        this.memoriesDrillReadGeneration++;
        this.memoriesDrillSession  = null;
        this.memoriesDrillSnapshot = null
    }

    /**
     * @summary READ-OBSERVE: the decomposed per-seat wake-route envelope — the memories sibling,
     * no variance.
     * @param {Object} [params]
     * @returns {Promise<Object>}
     */
    async loadWakeRoutes(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.wakeRoutesReadGeneration,
            fallback   = reason => ({
                capability: {state: 'unavailable', reason},
                viewer    : null,
                count     : 0,
                seats     : []
            });

        let snapshot;

        if (typeof bridge?.fleetWakeRoutes !== 'function') {
            snapshot = fallback('fleet wake-routes verb not wired')
        } else {
            try {
                snapshot = await bridge.fleetWakeRoutes(params)
            } catch (error) {
                snapshot = fallback('fleet wake-routes read failed')
            }
        }

        if (generation === me.wakeRoutesReadGeneration && !me.isDestroyed) {
            me.wakeRoutesSnapshot = snapshot;

            const livePane = me.component.getWakeRoutesPane();

            livePane && (livePane.snapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary READ-OBSERVE: the deployment's task picture — plus the liveness tick's in-flight
     * accounting: incremented before the verb check, released in `finally` on this read's OWN
     * settle, never a newer read's.
     * @param {Object} [params] Reserved; the verb takes no caller input today.
     * @returns {Promise<Object>}
     */
    async loadTasks(params = {}) {
        const
            me         = this,
            {bridge}   = me,
            generation = ++me.tasksReadGeneration,
            fallback   = reason => ({
                capability: {state: 'unavailable', reason},
                viewer    : null,
                sources   : {},
                running   : [],
                queued    : [],
                recent    : [],
                counts    : {running: 0, queued: 0, recent: 0}
            });

        let snapshot;

        me.tasksReadInFlight++;

        try {
            if (typeof bridge?.fleetTasks !== 'function') {
                snapshot = fallback('fleet tasks verb not wired')
            } else {
                try {
                    snapshot = await bridge.fleetTasks(params)
                } catch (error) {
                    snapshot = fallback('fleet tasks read failed')
                }
            }
        } finally {
            me.tasksReadInFlight--
        }

        if (generation === me.tasksReadGeneration && !me.isDestroyed) {
            me.tasksSnapshot = snapshot;

            const livePane = me.component.getTasksPane();

            livePane && (livePane.snapshot = snapshot)
        }

        return snapshot
    }

    /**
     * @summary WRITE: route one operator-composed message — one target, several (fan-out, one
     * authenticated call and one honest outcome per recipient), or the `AGENT:*` broadcast (a
     * single call; the server expands the sentinel). The sender is server-stamped at the
     * authenticated ingress, never carried here. The inbox re-polls exactly ONCE for the batch,
     * and only when a real send landed.
     * @param {Object} message `{to, subject, body, priority?, wakeSuppressed?, relatedTickets?}`
     * @returns {Promise<Object>} `{results: [{to, outcome}]}` in order.
     */
    async composeOperatorMessage(message) {
        const
            me       = this,
            {bridge} = me,
            targets  = Array.isArray(message.to) ? message.to : (message.to == null ? [] : [message.to]),
            wired    = typeof bridge?.composeOperatorMessage === 'function',
            results  = [];

        for (const to of targets) {
            if (!wired) {
                results.push({to, outcome: {status: 'not-wired', reason: 'fleet: operator compose verb not wired'}});
                continue
            }

            let outcome;

            try {
                // one target per call; the spread never mutates the caller's payload
                outcome = await bridge.composeOperatorMessage({...message, to})
            } catch (error) {
                outcome = {status: 'error', reason: error?.message || 'compose failed'}
            }

            results.push({to, outcome})
        }

        if (results.some(result => result.outcome?.messageId)) {
            await me.loadOperatorInbox({offset: 0})
        }

        return {results}
    }

    /**
     * @summary BOOT: resolve the operator's OWN identity (whoami) and hold it owner-side — the
     * mirror read requires an EXPLICIT subject (a self-default at a trust boundary is
     * spoof-adjacent). Fail-closed: an unwired source / unbound context leaves the record null
     * and the pane honestly unobserved. A bridge throw propagates — absence IS the state, no
     * fallback envelope exists to fabricate.
     * @protected
     */
    async loadOperatorIdentity() {
        const
            me       = this,
            {bridge} = me;

        if (typeof bridge?.resolveViewerIdentity !== 'function') {
            return
        }

        const outcome = await bridge.resolveViewerIdentity();

        if (outcome?.ok && outcome.agentIdentityNodeId && !me.isDestroyed) {
            const nodeId = outcome.agentIdentityNodeId;

            // the reused MailboxPane proves possession from `record.githubUsername` (canonicalized
            // against the mirror admission's subject); the node id IS that @-form authority — carry
            // both: the username for the possession match, the node id as the explicit read subject
            me.operatorRecord = {agentIdentityNodeId: nodeId, githubUsername: nodeId.replace(/^@/, '')};

            me.operatorIdentityPosture = me.deriveOperatorIdentityPosture(nodeId);

            // both orderings (identity-first or pane-first) land exactly one first read
            me.component.getOperatorMailboxPane()?.set({record: me.operatorRecord, identityPosture: me.operatorIdentityPosture})
        }
    }

    /**
     * @summary The seat-conflation honesty check: a viewer claim matching a registered agent
     * identity means sends attribute to that seat — a truth the pane renders, never swallows. An
     * empty roster answers `null` (cannot judge), not a clean bill.
     * @param {String} viewerIdentity The resolved `@`-form viewer identity.
     * @returns {{conflated: Boolean, seatIdentity: String}|null}
     */
    deriveOperatorIdentityPosture(viewerIdentity) {
        const rows = this.resolveFleetRosterStore()?.items ?? [];

        if (typeof viewerIdentity !== 'string' || !viewerIdentity.trim() || rows.length < 1) {
            return null
        }

        const
            bare      = id => String(id).trim().replace(/^@/, ''),
            viewer    = bare(viewerIdentity),
            conflated = rows.some(row => bare(row.agentId ?? '') === viewer);

        return {conflated, seatIdentity: `@${viewer}`}
    }

    /**
     * @summary READ-OBSERVE: the operator's own mailbox mirror. The gate IS the honest outcome
     * (no pane / no bound subject / no verb → the pane's `unobserved` state stands); a throwing
     * bridge KEEPS the last-known snapshot — the pane never renders "no mail" for a read that did
     * not happen. Fence bumped before the gate: a refused intent still invalidates older
     * in-flight reads.
     * @param {Object} [params]
     * @param {Number} [params.offset=0]
     * @protected
     */
    async loadOperatorInbox({offset = 0} = {}) {
        const
            me         = this,
            {bridge}   = me,
            pane       = me.component.getOperatorMailboxPane(),
            subject    = me.operatorRecord?.agentIdentityNodeId,
            generation = ++me.operatorInboxReadGeneration;

        if (!pane || !subject || typeof bridge?.fleetMailboxMirror !== 'function') {
            return
        }

        try {
            const snapshot = await bridge.fleetMailboxMirror({subjectAgentId: subject, offset});

            if (generation === me.operatorInboxReadGeneration && !me.isDestroyed) {
                me.operatorSnapshot = snapshot;

                const livePane = me.component.getOperatorMailboxPane();

                livePane && (livePane.snapshot = snapshot)
            }
        } catch (error) {
            // fail-closed: the last-known snapshot stays
        }
    }

    /* ── the liveness reads (provider-written surfaces; the banner + chrome bind) ── */

    /* ── the shared loss edges + helpers ── */

    /* ── roster mapping + reconciliation ── */

    /* ── the liveness owner + reconnect + viewer-wake stream ── */

}

export default Neo.setupClass(Controller);
