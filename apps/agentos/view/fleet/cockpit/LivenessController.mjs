import ComponentController from '../../../../../node_modules/neo.mjs/src/controller/Component.mjs';
import SourceHealth        from '../../../util/SourceHealth.mjs';

const
    /**
     * Longest safe reason rendered on the spine banner — a transport error can carry an entire
     * response body, and that line is one row of shell chrome, not a log viewer.
     * @type {Number}
     */
    maxDegradedReasonLength = 120,
    /**
     * The recognized Brain daemon states — anything else (a transport envelope, a rejection
     * mapped to null, a malformed payload) renders NOTHING rather than a fabricated verdict.
     * @type {String[]}
     */
    brainHealthStates = ['running', 'degraded', 'stopped'],
    /**
     * Credential-redaction patterns for wire-borne failure text, scheme rule FIRST — or
     * `Authorization: Bearer x` matches the pair rule, stops at the space, and republishes the
     * secret intact.
     * @type {RegExp}
     */
    bearerSchemeRegex   = /\b(?:authorization\s*[:=]\s*)?bearer\s+[^\s,;)]+/gi,
    credentialPairRegex = /\b(authorization|token|secret|password|pat|credential)\s*[:=]\s*[^\s,;)]+/gi,
    githubTokenRegex    = /\bgh[pousr]_[A-Za-z0-9_]+/g,
    gitlabTokenRegex    = /\bglpat-[A-Za-z0-9_-]+/g;

/**
 * @summary The cockpit's liveness layer — the fenced wire reads that make `live` mean live, and
 * everything derived from them: the roster/activity/Brain-health loads with their loss edges,
 * the cadence owner, the one-click reconnect, the viewer-wake stream custody and the
 * roster-derived option builders. The intent layer
 * ({@link AgentOS.view.fleet.cockpit.Controller}) extends this class; splitting the read layer
 * from the command layer keeps each below the app-file bound with one honest seam.
 *
 * Every read follows one discipline: fence bump FIRST (absence is newer knowledge — an older
 * in-flight read must not outlive it), verb-presence check, typed unavailable fallback (never a
 * fabricated success), and only the newest generation writes. All shared render truths land on
 * {@link AgentOS.view.fleet.cockpit.StateProvider}; the banner and telltale derive themselves.
 *
 * @class AgentOS.view.fleet.cockpit.LivenessController
 * @extends Neo.controller.Component
 */
class LivenessController extends ComponentController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.LivenessController'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.LivenessController'
    }

    /**
     * Monotonic read-fence for the Brain-health pulls — only the newest generation may write.
     * @member {Number} brainHealthReadGeneration=0
     * @protected
     */
    brainHealthReadGeneration = 0
    /**
     * Unsettled Brain-health reads on the wire, released on the read's OWN settle.
     * @member {Number} brainHealthReadInFlight=0
     * @protected
     */
    brainHealthReadInFlight = 0
    /**
     * Read-fence for the ROSTER surface — see the class summary's one discipline.
     * @member {Number} gridReadGeneration=0
     * @protected
     */
    gridReadGeneration = 0
    /**
     * Count of UNDERLYING roster reads still unresolved on the wire — the accumulation bound.
     * Counts the WIRE, not the wrapper: {@link #boundedRead} settles its own race on timeout, so
     * releasing there would bound nothing while the underlying read keeps hanging.
     * @member {Number} gridReadInFlight=0
     * @protected
     */
    gridReadInFlight = 0
    /**
     * The last mapped LIVE roster rows — the vessel-return reconcile source.
     * @member {Object[]|null} lastLiveRows=null
     * @protected
     */
    lastLiveRows = null
    /**
     * Re-entrancy latch for {@link #onRosterStoreLoad}: the store fires `load` for its own
     * mutations, so the guard's reconciliation adds/removals re-trigger the very listener that
     * issued them — unlatched, that recursion is a real stack overflow (~524 frames on a 5k-row
     * snapshot).
     * @member {Boolean} reconcilingRoster=false
     * @protected
     */
    reconcilingRoster = false
    /**
     * The liveness re-poll interval id; `null` = not started.
     * @member {Number|null} livenessTimerId=null
     * @protected
     */
    livenessTimerId = null
    /**
     * Counts liveness starts. A callback attached by an earlier start (the custody heal's) checks
     * it before acting, so a stop/restart before the heal settles cannot deliver twice.
     * @member {Number} livenessGeneration=0
     * @protected
     */
    livenessGeneration = 0
    /**
     * Whether any populated LIVE roster snapshot has been admitted — flips empty snapshots to
     * their ordinary authoritative meaning (a real fleet may genuinely drain).
     * @member {Boolean} rosterWired=false
     * @protected
     */
    rosterWired = false
    /**
     * Read-fence for the ACTIVITY surface.
     * @member {Number} streamReadGeneration=0
     * @protected
     */
    streamReadGeneration = 0
    /**
     * @member {Number} streamReadInFlight=0
     * @protected
     */
    streamReadInFlight = 0
    /**
     * Whether the activity feed ever went live — the first live snapshot replaces the sample
     * seed wholesale; later ones merge.
     * @member {Boolean} activityWired=false
     * @protected
     */
    activityWired = false
    /**
     * The live wake-stream consumer + the bridge identity it was opened against (custody heals
     * swap the bridge; a kept consumer would outlive its authority).
     * @member {Object|null} viewerWakeConsumer=null
     * @protected
     */
    viewerWakeConsumer = null
    /**
     * @member {Object|null} viewerWakeBridge=null
     * @protected
     */
    viewerWakeBridge = null

    /**
     * @summary Re-poll the roster once a lifecycle intent genuinely changed runtime state — and
     * never on a rejected/timeout outcome, whose honest reason render must stand.
     * @param {Promise<Boolean>} settledOk
     * @returns {Promise<*>}
     * @protected
     */
    async refreshRosterOnSettle(settledOk) {
        if (await settledOk) {
            return this.loadRoster()
        }
    }

    /**
     * @summary The provider-owned roster store — the WRITE authority (a torn/absent grid never
     * stops live ingest). Bare mounts degrade to `null`.
     * @returns {Neo.data.Store|null}
     */
    resolveFleetRosterStore() {
        try {
            return this.component.getStateProvider()?.getStore('fleetRoster') ?? null
        } catch {
            return null
        }
    }

    /**
     * @summary The provider-owned activity store, same tolerance.
     * @returns {Neo.data.Store|null}
     */
    resolveFleetActivityEventsStore() {
        try {
            return this.component.getStateProvider()?.getStore('fleetActivityEvents') ?? null
        } catch {
            return null
        }
    }

    /**
     * @summary The provider-owned bounded viewer-wake feed, same tolerance.
     * @returns {Neo.data.Store|null}
     * @protected
     */
    getViewerWakeFeed() {
        try {
            return this.component.getStateProvider()?.getStore('viewerWakeFeed') ?? null
        } catch {
            return null
        }
    }

    /**
     * @summary Bind the activity stream to the live feed and route its honest capability state:
     * `wired` → live (a wired-but-quiet feed stays live, never the sample), `degraded` → stale
     * with the adapter's OWN reason, an ANSWERED `not-wired` retains its cause (a reachable
     * server with an unconfigured source is not an unreachable server), a torn answer keeps the
     * cold seed silent. All state writes land on the provider; the banner renders itself.
     * @protected
     */
    async loadActivity() {
        const
            me         = this,
            store      = me.resolveFleetActivityEventsStore(),
            stream     = me.getReference('activity-stream'),
            {bridge}   = me,
            provider   = me.component.getStateProvider(),
            generation = ++me.streamReadGeneration;

        if (!store || typeof bridge?.fleetActivity !== 'function') {
            // no bridge/verb IS the cold truth; a never-wired surface's retained answered cause
            // must not outlive the bridge that answered it
            me.publishConnection('stream', {data: provider?.getData('streamAdapterState') === 'sample'
                ? {streamDegradedReason: null} : {}});
            return
        }

        try {
            me.publishConnection('stream', {pending: true});
            me.streamReadInFlight++;

            // invoked INSIDE the chain: a synchronous throw becomes a rejection of the tracked
            // promise, so the reject path owns the slot release (two sync throws would otherwise
            // consume the cap and suppress this surface forever)
            const {capability, counts, events} = await me.boundedRead(
                Promise.resolve().then(() => bridge.fleetActivity()),
                () => { me.streamReadInFlight-- }
            ) ?? {};

            // the fence: older news never overwrites newer — a slow failed poll landing after a
            // fast success would regress live → stale on strictly older information
            if (generation !== me.streamReadGeneration || me.isDestroyed) {
                return
            }

            if (capability?.state === 'wired') {
                store.ingestSnapshot(Array.isArray(events) ? events : [], {replace: !me.activityWired});
                me.activityWired = true;
                me.publishConnection('stream', {data: {
                    activityCounts      : Array.isArray(counts) ? counts : [],
                    streamAdapterState  : 'live',
                    streamDegradedReason: null
                }});
                stream && (stream.adapterState = 'live')
            } else if (capability?.state === 'degraded') {
                me.publishConnection('stream', {data: {
                    streamAdapterState  : 'stale',
                    streamDegradedReason: me.toSafeDegradedReason(capability.reason)
                }});
                stream && (stream.adapterState = 'stale')
            } else if (capability) {
                // the producer ANSWERED not-wired: the sample seed stays (the stream really is
                // showing sample events) but an answer is not silence — retain the cause
                me.publishConnection('stream', {data: {
                    streamDegradedReason: me.toSafeDegradedReason(capability.reason)
                }})
            } else {
                me.publishConnection('stream')
            }
            // NO capability (torn/absent answer): keep the sample seed AND no reason — we learned
            // nothing, the banner falls back to generic copy rather than inventing a cause
        } catch (error) {
            // fenced too — the sad path is not exempt from ordering
            if (generation === me.streamReadGeneration && !me.isDestroyed) {
                me.degradeWiredSurface('stream', error, stream)
            }
        }
    }

    /**
     * @summary Bind the fleet roster to the running fleet: map the assembler DTO onto the record
     * contract and route honestly into the provider-owned store — a populated snapshot is
     * authoritative (first replaces the sample seed, later ones reconcile), an EMPTY first
     * unselected snapshot preserves the sample (a fresh private registry must not blank the
     * zero-setup first paint) while retaining its answered cause, and absence/throw/malformed
     * keeps the last-known roster (fail closed, never a blanked fleet).
     * @protected
     */
    async loadRoster() {
        const
            me         = this,
            store      = me.resolveFleetRosterStore(),
            grid       = me.getReference('fleet-grid'),
            {bridge}   = me,
            cockpit    = me.component,
            provider   = cockpit.getStateProvider(),
            generation = ++me.gridReadGeneration;

        if (!store || typeof bridge?.fleetRoster !== 'function') {
            me.publishConnection('grid', {data: provider?.getData('gridAdapterState') === 'sample'
                ? {gridDegradedReason: null} : {}});
            return
        }

        try {
            me.publishConnection('grid', {pending: true});
            me.gridReadInFlight++;

            const {capabilities, rows} = await me.boundedRead(
                Promise.resolve().then(() => bridge.fleetRoster()),
                () => { me.gridReadInFlight-- }
            ) ?? {};

            if (generation !== me.gridReadGeneration || me.isDestroyed) {
                return
            }

            if (!Array.isArray(rows)) {
                me.publishConnection('grid');
                return // malformed answer → keep the last-known roster
            }

            const mapped = rows.filter(row => row?.id).map(row => me.mapRosterRow(row));

            // the shipped sample is the cold-first-run authority: an explicitly wired bridge
            // (`selected`) or any prior live snapshot flips empty to its ordinary authoritative
            // meaning (a real fleet may genuinely drain)
            if (!me.rosterWired && mapped.length === 0 && !bridge?.selected && cockpit.rosterSourceMode !== 'selected') {
                // the server ANSWERED — retain the cause so the banner names "connected · registry
                // empty" instead of advising a restart of a process that just replied
                me.publishConnection('grid', {data: {
                    gridDegradedReason: 'server connected · fleet registry empty — define agents to go live'
                }});
                return
            }

            me.lastLiveRows = mapped;

            if (me.rosterWired) {
                me.reconcileRoster(store, mapped)
            } else {
                store.clear();
                mapped.length > 0 && store.add(mapped);
                me.rosterWired = true;
                // the first live snapshot replaces the sample seed wholesale — re-seat or clear a
                // selection made against a now-removed sample record
                me.reconcileSelection()
            }

            me.publishConnection('grid', {data: {
                gridAdapterState  : 'live',
                gridDegradedReason: null,
                // the presence-capability envelope rides every admitted snapshot; absent or
                // malformed envelopes plumb null — the chip claims nothing
                presenceCapability: capabilities?.presence ?? null
            }});
            grid && (grid.adapterState = 'live');

            // roster-derived consumer refreshes: resident panes snapshot their options at
            // projection time, which can precede this first live answer (pane-first, so a
            // non-materialized pane costs no option rebuild)
            const
                catchUpPane = cockpit.getCatchUpPane(),
                stream      = me.getReference('activity-stream'),
                mailboxPane = cockpit.getOperatorMailboxPane();

            catchUpPane && catchUpPane.set({partitionOptions: me.buildCatchUpPartitionOptions()});
            stream      && stream.set({actorDirectory: me.buildActivityActorDirectory()});
            mailboxPane && mailboxPane.set({recipientOptions: me.buildOperatorRecipientOptions()});

            if (me.operatorRecord) {
                me.operatorIdentityPosture = me.deriveOperatorIdentityPosture(me.operatorRecord.agentIdentityNodeId);
                cockpit.getOperatorMailboxPane()?.set({identityPosture: me.operatorIdentityPosture})
            }

            // a resident CatchUp can emit its construction-time request BEFORE the bridge wires;
            // that one-shot miss recovers the moment the bridge answers, through the pane's own
            // guarded refresh path
            me.catchUpSnapshot?.capability?.state === 'unavailable' && cockpit.getCatchUpPane()?.onRefreshClick()
        } catch (error) {
            if (generation === me.gridReadGeneration && !me.isDestroyed) {
                me.degradeWiredSurface('grid', error, grid)
            }
        }
    }

    /**
     * @summary Pull whole-Brain health from the shell's lifecycle owner on the liveness cadence —
     * pull, never push, so a fault arriving after mount still surfaces and a recovery still
     * clears. Transport failure reaches {@link #applyBrainHealth} as `null` and moves nothing.
     * @protected
     */
    async loadBrainHealth() {
        const
            me         = this,
            generation = ++me.brainHealthReadGeneration;

        try {
            me.brainHealthReadInFlight++;

            const response = await me.boundedRead(
                Promise.resolve().then(() => Neo.Main.brainHealth()),
                () => { me.brainHealthReadInFlight-- }
            );

            if (generation !== me.brainHealthReadGeneration || me.isDestroyed) return;

            me.applyBrainHealth(response)
        } catch (error) {
            if (generation !== me.brainHealthReadGeneration || me.isDestroyed) return;

            me.applyBrainHealth(null)
        }
    }

    /**
     * @summary Apply one Brain-health wire answer onto the provider-held daemon surface. An
     * unrecognized state renders NOTHING (transport trouble is the transport surface's story) —
     * and never ERASES a last-known fault: only the lifecycle owner's own answer moves this
     * surface. The shell transport fact is its own truth, valid on payloads whose daemon state
     * never validates and dropped when the pull failed.
     * @param {Object|null} response The lifecycle owner's `{state, cause, transport?}` payload.
     * @protected
     */
    applyBrainHealth(response) {
        const
            me       = this,
            provider = me.component.getStateProvider(),
            state    = brainHealthStates.includes(response?.state) ? response.state : null;

        if (me.isDestroyed || !provider) return;

        provider.setData('shellTransport', Neo.isObject(response?.transport) ? response.transport : null);

        if (!state) {
            return
        }

        provider.setData({
            daemonState         : state,
            daemonDegradedReason: state !== 'running' && response.cause
                ? (response.cause.detail || response.cause.source || null)
                : null
        })
    }

    /**
     * @summary Advance ONE wired surface to the degraded truth and retain the safe reason. A
     * surface that never reached `live` stays on its honest `sample` seed — advancing it to
     * `stale` would claim last-known data that never existed — and a transport failure RETRACTS
     * any answered-state cause it retained (the claim must not outlive the connection). The
     * current read's typed connection observation keeps its own sanitized reason on either path.
     * @param {String} surface `'grid'|'stream'`
     * @param {*} error The transport failure (untrusted — never rendered raw).
     * @param {Neo.component.Base|null} [consumer] The held child whose badge mirrors the state.
     * @protected
     */
    degradeWiredSurface(surface, error, consumer = null) {
        const
            provider = this.component.getStateProvider(),
            stateKey = surface === 'grid' ? 'gridAdapterState' : 'streamAdapterState',
            causeKey = surface === 'grid' ? 'gridDegradedReason' : 'streamDegradedReason';

        if (!provider) return;

        const state = provider.getData(stateKey) === 'sample' ? 'sample' : 'stale';
        this.publishConnection(surface, {error, data: {
            [stateKey]: state,
            // this surface's cause on this surface's field — never a shared slot a sibling clears
            [causeKey]: state === 'sample' ? null : this.toSafeDegradedReason(error)
        }});

        consumer && state === 'stale' && (consumer.adapterState = 'stale')
    }

    /**
     * @summary Retain only a finite producer classification and its safe reason for this read.
     * Message text never determines the class; unknown errors preserve ordinary fallback copy.
     * @param {*} error The bridge failure or locally produced read-bound error.
     * @returns {{state: String|null, reason: String|null}}
     * @protected
     */
    connectionObservation(error) {
        const state = ['refused', 'unreachable', 'timeout', 'failed-upstream'].includes(error?.fleetConnectionState)
            ? error.fleetConnectionState : null;

        return {state, reason: state ? this.toSafeDegradedReason(error) : null}
    }

    /**
     * @summary Publish one read owner's observation with its other state in one Provider batch.
     * The caller must pass its generation fence first; a new surface declares its own Provider
     * leaves and reuses this path without sharing another surface's connection or reason.
     * @param {String} surface The owner key, e.g. grid or stream.
     * @param {Object} [options={}]
     * @param {Boolean} [options.pending=false] The admitted read is still in flight.
     * @param {*} [options.error=null] Its terminal failure, or null to clear the observation.
     * @param {Object} [options.data={}] Additional validated state from this same read owner.
     * @protected
     */
    publishConnection(surface, {pending=false, error=null, data={}}={}) {
        this.component.getStateProvider()?.setData({
            ...data,
            [`${surface}Connection`]: pending ? {state: 'connecting', reason: null} : this.connectionObservation(error)
        })
    }

    /**
     * @summary Reduce an untrusted transport failure to one safe, operator-readable clause —
     * redacted (credential-bearing forms are the realistic payload of a failing authenticated
     * request) and bounded before it can ever render.
     * @param {*} error An Error, a string reason, or anything else.
     * @returns {String|null} `null` when the cause is unknowable (generic copy renders instead).
     * @protected
     */
    toSafeDegradedReason(error) {
        const raw = typeof error === 'string' ? error : error?.message;

        if (typeof raw !== 'string' || !raw.trim()) return null;

        const safe = raw
            .replace(bearerSchemeRegex, 'authorization=[redacted]')
            .replace(credentialPairRegex, '$1=[redacted]')
            .replace(githubTokenRegex, '[redacted-token]')
            .replace(gitlabTokenRegex, '[redacted-token]')
            .replace(/\s+/g, ' ')
            .trim();

        return safe ? safe.slice(0, maxDegradedReasonLength) : null
    }

    /**
     * @summary Bound one liveness read: it may fail, it may never hang — an unbounded read holds
     * its in-flight slot forever and the liveness owner silently stops being live. The wire's OWN
     * settle releases the slot (a timed-out wrapper does not free the socket the read still
     * holds); the race's loser is not aborted — the generation fence already makes a late arrival
     * unable to write.
     * @param {Promise} read
     * @param {Function} onWireSettled Releases the surface's in-flight slot.
     * @returns {Promise} Settles with the read, or rejects with a timeout error.
     * @protected
     */
    boundedRead(read, onWireSettled) {
        const timeout = this.component.livenessReadTimeout;

        let timerId;

        read.then(onWireSettled, onWireSettled);

        return Promise.race([
            read.finally(() => clearTimeout(timerId)),
            new Promise((resolve, reject) => {
                timerId = setTimeout(() => reject(Object.assign(new Error(`fleet read exceeded ${timeout}ms`), {
                    fleetConnectionState: 'timeout'
                })), timeout)
            })
        ])
    }

    /**
     * @summary Map one assembler DTO row onto the FleetAgent record contract — identity facts and
     * launch-derived truths flow through tri-state (null = unclassified, never guessed), the
     * runtime lifecycle maps onto the session-state vocabulary only when the runtime source is
     * usable, and fields the roster producer does not own (`laneLine`) are OMITTED so a merge
     * never wipes what another producer wrote.
     * @param {Object} row One cockpit DTO row.
     * @returns {Object} FleetAgent record field values.
     */
    mapRosterRow(row) {
        const sessionHealth = SourceHealth.mapFleetSessionHealth(row.lifecycle, row.sources);

        return {
            agentId    : row.id,
            authMode   : row.authMode ?? null,
            avatarUrl  : row.avatarUrl ?? null,
            displayName: row.displayName ?? null,
            // the resident's MAILBOX identity authority, preserved from the DTO — the registry id
            // is a Fleet key (`vega`), a mailbox subject is an AgentIdentity node id
            // (`@neo-opus-vega`); comparing the wrong kind would never match, or match the wrong
            // resident. `null` = no identity authority: an honest "cannot verify"
            githubUsername     : row.githubUsername ?? null,
            engineTag          : row.engineTag ?? null,
            family             : row.family ?? null,
            launchable         : row.launchable ?? null,
            openLaneCount      : row.openLaneCount ?? null,
            lastActivityAt     : row.lastActivityAt ?? null,
            participationStatus: row.participationStatus ?? null,
            sources            : sessionHealth.sources,
            state              : sessionHealth.state,
            presence           : row.presence ?? null,
            throttle           : row.throttle ?? null,
            wake               : row.wake ?? null
        }
    }

    /**
     * @summary Reconcile an authoritative roster snapshot onto the store: known ids update in
     * place (`record.set` — one card re-render, producer-foreign fields survive), joiners batch
     * in, and residents absent from the snapshot are removed (no ghost cards). Membership may
     * have removed the inspected resident, so the owner-held selection reconciles here too.
     * @param {Neo.data.Store} store
     * @param {Object[]} rows Mapped snapshot rows keyed by `agentId`.
     * @protected
     */
    reconcileRoster(store, rows) {
        const
            snapshotIds = new Set(rows.map(row => row.agentId)),
            joiners     = [];

        rows.forEach(row => {
            const record = store.get(row.agentId);

            record ? record.set(row) : joiners.push(row)
        });

        // one batched add — every store mutation fires `load`, per-row adds would fan out
        joiners.length > 0 && store.add(joiners);

        store.items
            .filter(record => !snapshotIds.has(record.agentId))
            .map(record => record.agentId)
            .forEach(agentId => store.remove(agentId));

        this.reconcileSelection()
    }

    /**
     * @summary Source-precedence guard: the provider-hosted roster store `autoLoad`s the JSON
     * sample seed while {@link #loadRoster} races the bridge. When the bridge wins, the sample's
     * later `load` would silently replace live rows (the grid still claiming `live`). Any store
     * load landing AFTER live truth re-applies the last authoritative snapshot — idempotent,
     * fail-closed toward live. A load before live truth is the normal seed path and passes through.
     * Latched via {@link #reconcilingRoster}: the reconciliation's own mutations fire `load` back
     * into this listener.
     * @protected
     */
    onRosterStoreLoad() {
        const me = this;

        if (!me.reconcilingRoster && me.rosterWired && me.lastLiveRows) {
            me.reconcilingRoster = true;

            try {
                me.reconcileRoster(me.resolveFleetRosterStore(), me.lastLiveRows)
            } finally {
                me.reconcilingRoster = false
            }
        }
    }

    /**
     * @summary Keep the open detail inspector truthful over time — route the roster store's
     * `recordChange` to the live {@link AgentOS.view.fleet.detail.Container} when the changed
     * record is the one being inspected (mirrors how the grid routes `recordChange` to its
     * cards). A roster re-poll mutating the selected resident (state, lane, sources) thus
     * re-renders the detail in place — reactive to record MUTATION, not only to a re-seat.
     * Routed through the view's phase-blind accessor so a popped-out inspector updates exactly
     * like a docked one.
     * @param {Object} data The store `recordChange` event `{record, ...}`.
     * @protected
     */
    onDetailRecordChange({record}) {
        const cockpit = this.component;

        if (record === cockpit.detailRecord) {
            cockpit.getAgentDetailPane()?.applyRecord()
        }
    }

    /**
     * @summary Re-seat (or clear) the owner-held selection after a membership change — the
     * removal fires no recordChange, so the selection must reconcile explicitly.
     * @protected
     */
    reconcileSelection() {
        const cockpit = this.component;

        if (!cockpit.detailRecord) {
            return
        }

        const current = this.resolveFleetRosterStore()?.get(cockpit.detailRecord.agentId) ?? null;

        if (current !== cockpit.detailRecord) {
            this.applySelection(current)
        }
    }

    /**
     * @summary Start the ongoing liveness owner — the mechanism that makes `live` mean live: an
     * interval re-drive of the EXISTING read verbs (never a separate ping — a second writer could
     * disagree with the first), with per-surface overlap suppression: the fence makes a late read
     * harmless, not absent, and a transport slower than the cadence must not pile unbounded reads
     * onto a bridge already failing to answer. Idempotent.
     * @protected
     */
    startLiveness() {
        const
            me      = this,
            cockpit = me.component;

        if (me.livenessTimerId !== null) return;

        // every start is a new generation: a callback attached by an earlier start — the custody
        // heal's, pending across a stop/restart — must not act on behalf of this one
        me.livenessGeneration++;

        me.livenessTimerId = setInterval(() => {
            const cap = cockpit.maxReadsInFlight;

            if (me.streamReadInFlight      < cap) me.loadActivity();
            if (me.gridReadInFlight        < cap) me.loadRoster();
            if (me.brainHealthReadInFlight < cap) me.loadBrainHealth();
            if (me.tasksReadInFlight       < cap) me.loadTasks();

            // no in-flight cap: this launches no wire read — it compares bridge identity (the
            // custody-heal rebuild trigger) and copies the consumer's local observations
            me.ensureViewerWakeStream()
        }, cockpit.livenessPollInterval);

        // the daemon surface has no other first read; waiting a full cadence would leave a
        // boot-time fault invisible
        me.loadBrainHealth();

        me.followCustodyHeal()
    }

    /**
     * @summary A boot-time custody heal promotes AFTER the construct-time reads answered on the
     * fail-closed bridge — measured on a fresh boot against an armed server: promotion at 0.3s,
     * the first wire read at the 15s cadence tick. The boot module publishes the in-flight heal as
     * `AgentOS.fleet.custodyHeal`; its `true` resolution re-drives every seam now, the way the
     * Reconnect click does. No slot, a heal that ends without promotion, or liveness stopped in
     * the meantime: nothing happens. A promise callback cannot be detached, so the re-drive is
     * fenced to the liveness generation that attached it: a stop/restart before the heal settles
     * leaves the earlier callback inert, and the heal re-drives exactly once.
     * @protected
     */
    followCustodyHeal() {
        const
            me         = this,
            generation = me.livenessGeneration;

        globalThis.AgentOS?.fleet?.custodyHeal?.then(promoted => {
            promoted && !me.isDestroyed && me.livenessTimerId !== null && me.livenessGeneration === generation && me.reconnectFleet()
        })
    }

    /**
     * @summary Stop the liveness owner — exact-once, safe on a never-started cockpit. A timer
     * outliving its owner would keep re-polling on behalf of a destroyed surface.
     * @protected
     */
    stopLiveness() {
        const me = this;

        if (me.livenessTimerId !== null) {
            clearInterval(me.livenessTimerId);
            me.livenessTimerId = null
        }
    }

    /**
     * @summary The Reconnect affordance's one-click re-drive: every liveness seam immediately —
     * deliberately NOT capped (a direct call is operator-meant, never suppressed). The pane
     * histories ride it through each pane's own guarded refresh handler: they have no cadence at
     * all, so a failed first read would otherwise pin its unavailable envelope forever.
     */
    reconnectFleet() {
        const
            me      = this,
            cockpit = me.component;

        me.loadActivity();
        me.loadRoster();
        me.loadBrainHealth();
        me.ensureViewerWakeStream();

        cockpit.getMemoriesPane()?.onRefreshClick();
        cockpit.getCatchUpPane()?.onRefreshClick();
        cockpit.getWakeRoutesPane()?.onRefreshClick();

        me.loadTasks()
    }

    /**
     * @summary Keep exactly one wake-stream consumer bound to the CURRENT bridge identity: a
     * custody heal swaps the bridge, and a consumer kept across that swap would hold a
     * credentialed connection on dead authority. An unwired bridge stamps the honest not-wired
     * truth instead.
     * @protected
     */
    ensureViewerWakeStream() {
        const
            me       = this,
            {bridge} = me;

        if (!bridge?.openWakeStream) {
            if (me.viewerWakeConsumer) {
                me.viewerWakeConsumer.stop();
                me.viewerWakeConsumer = null;
                me.viewerWakeBridge   = null
            }

            me.stampViewerWake({
                stream: {
                    alive     : 'unknown',
                    reason    : 'wake push not wired — this composition carries no direct-browser wake capability',
                    capturedAt: Date.now()
                }
            });
            return
        }

        if (me.viewerWakeConsumer && me.viewerWakeBridge === bridge) {
            me.stampViewerWake();
            return
        }

        me.viewerWakeConsumer?.stop();

        me.viewerWakeConsumer = bridge.openWakeStream({
            onWake: signal => me.onViewerWakeSignal(signal),
            ...(me.component.wakePollDigest ? {pollDigest: me.component.wakePollDigest} : {})
        });
        me.viewerWakeBridge = bridge;

        me.viewerWakeConsumer.start();
        me.stampViewerWake()
    }

    /**
     * @summary One observed wake frame → the bounded feed + an immediate stamp. A frame carrying
     * no envelope is still a receipt (the stream moved) but yields no feed row to fabricate.
     * @param {Object} signal `{subscriptionId, envelope, receivedAt}` from the consumer's onWake.
     * @protected
     */
    onViewerWakeSignal({subscriptionId, envelope, receivedAt}) {
        const me = this;

        if (me.isDestroyed) return;

        if (envelope?.eventId) {
            me.getViewerWakeFeed()?.addSignal({
                eventId  : envelope.eventId,
                kind     : envelope.eventType ?? 'wake',
                logId    : envelope.logId ?? null,
                emittedAt: envelope.emittedAt ?? null,
                receivedAt,
                subscriptionId
            })
        }

        me.stampViewerWake()
    }

    /**
     * @summary Write the consumer's OWN observations into the provider (`viewerWake`) — the
     * telltale binds and renders itself: one writer, zero re-judging, liveness vocabulary and
     * catch-up states pass through verbatim.
     * @param {Object} [override] `{stream}` for the not-wired stamp, when no consumer exists.
     * @protected
     */
    stampViewerWake(override = null) {
        const
            me       = this,
            provider = me.component.getStateProvider(),
            consumer = me.viewerWakeConsumer;

        if (!provider) return;

        provider.setData('viewerWake', {
            stream: override?.stream ?? (consumer
                ? {...consumer.resolveDeliveryLiveness(), capturedAt: Date.now()}
                : {alive: 'unknown', reason: 'wake stream not started', capturedAt: Date.now()}),
            catchUp: consumer?.describe().lastCatchUp ?? {state: null, at: null, pending: null},
            // the bounded signal window rides the stamp so the telltale FORMULA derives the chip
            // from data alone (formulas receive data, never the provider)
            signals: (me.getViewerWakeFeed()?.items ?? []).slice(0, 5).map(record => ({
                kind      : record.kind,
                emittedAt : record.emittedAt,
                receivedAt: record.receivedAt
            }))
        })
    }

    /**
     * @summary Detach the controller-owned liveness machinery with the view: the timer and the
     * credentialed wake consumer must not outlive the surface they speak for.
     * @param {...*} args
     */
    destroy(...args) {
        const me = this;

        me.stopLiveness();

        me.viewerWakeConsumer?.stop();
        me.viewerWakeConsumer = null;
        me.viewerWakeBridge   = null;

        super.destroy(...args)
    }

    /**
     * @summary Roster-joined actor facts for the activity stream's chips — `agentId →
     * {avatarUrl, displayName}` from the SAME provider-owned roster every other surface reads
     * (no second resident list). Rows without the facts contribute nothing: the stream renders a
     * missing entry handle-only, per its honest-absence contract.
     * @returns {Object}
     */
    buildActivityActorDirectory() {
        const rows = this.resolveFleetRosterStore()?.items ?? [];

        return Object.fromEntries(rows
            .filter(row => row.agentId)
            .map(row => [row.agentId, {
                ...(row.avatarUrl   ? {avatarUrl: row.avatarUrl}     : {}),
                ...(row.displayName ? {displayName: row.displayName} : {})
            }])
        )
    }

    /**
     * @summary Build the operator-compose recipient options from the LIVE roster — `{id, name}` records
     * the picker's ChipField store renders. The `id` is the mailbox IDENTITY (`@githubUsername`), NOT the
     * roster `agentId` (a Fleet key like `vega`), plus the `AGENT:*` broadcast sentinel. Empty until the
     * roster resolves — the pane picks recipients from a real current fleet, never a hand-mapped list.
     * @returns {Object[]}
     */
    buildOperatorRecipientOptions() {
        const rows = this.resolveFleetRosterStore()?.items ?? [];

        return [
            {id: 'AGENT:*', name: 'All agents (broadcast)'},
            ...rows
                .filter(row => row.githubUsername)
                .map(row => ({id: `@${row.githubUsername}`, name: row.githubUsername}))
        ]
    }

    /**
     * @summary Build canonical Fleet/agent Memory partitions from the live roster Store. PR history
     * remains Fleet-wide; these choices alter only the Memory operation in the Brain adapter.
     * @returns {Object[]}
     */
    buildCatchUpPartitionOptions() {
        const rows = this.resolveFleetRosterStore()?.items ?? [];

        return rows
            .filter(row => row.githubUsername)
            .map(row => ({
                id       : `catch-up-${row.agentId}`,
                label    : row.displayName || row.githubUsername,
                partition: `@${row.githubUsername}`
            }))
    }
}

export default Neo.setupClass(LivenessController);
