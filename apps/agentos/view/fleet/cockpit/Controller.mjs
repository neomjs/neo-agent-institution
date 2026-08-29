import Controller                  from '../../../../../node_modules/neo.mjs/src/controller/Component.mjs';
import FleetLifecycleIntentAdapter from '../../../util/FleetLifecycleIntentAdapter.mjs';

import FleetStartPlan from '../../../util/FleetStartPlan.mjs';

/**
 * The cockpit's source-read + liveness disciplines, homed in the VIEW CONTROLLER (#50; the
 * operator's architecture ruling: logic triggered on a passed-around owner object is a functional
 * mixin, not a responsibility move — the controller is the named, lifecycle-bound home for view
 * logic, with first-class component access). The state these routines write (owner-held snapshots,
 * fences, in-flight counters) remains view-held for now — the controller reads/writes it through
 * `this.component`; migrating projected state onto a state.Provider is the #42 follow-up.
 *
 * Two shapes inside:
 * - the FENCED SNAPSHOT template (`readFencedSource` + `SOURCE_READS`) for the six uniform pane
 *   feeds, with measured variance as descriptor hooks;
 * - the NAMED liveness reads (`loadActivity` / `loadRoster` / `loadBrainHealth`) whose variance is
 *   structural (sample-seed authority ladder, four-way capability routing) — deliberately not
 *   descriptor-forced.
 * `boundedRead` + `toSafeDegradedReason` are stateless file-local helpers.
 */

/**
 * @summary The cockpit-owned authenticated bridge — resolved fresh per call, never captured:
 * custody heals swap the bridge identity, and a captured reference would outlive its authority.
 * @returns {Object|undefined}
 */
function resolveFleetBridge() {
    return globalThis.AgentOS?.fleet?.registryBridge
}

/**
 * @summary Run one fenced source read per the discipline above.
 *
 * Order of laws (verbatim from the shipped verbs): fence bump first (an in-flight older read
 * becomes unwanted the moment a newer intent exists — gate-refused intents included), then the
 * gate, then the pre-await view hold, then the verb/await with typed fallbacks, then — only when
 * this read is still the newest and the view still lives — the view write + pane resolve.
 * @param {Neo.container.Base} view The cockpit instance (fence/snapshot fields + pane accessors).
 * @param {Object} descriptor One {@link #SOURCE_READS} entry.
 * @param {Object} [params] The caller's intent payload.
 * @returns {Promise<Object|undefined>} The accepted-or-fallback snapshot; `undefined` on a gate
 *     refusal or a kept error (the honest no-write outcomes).
 */
async function readFencedSource(view, descriptor, params = {}) {
    const
        bridge     = resolveFleetBridge(),
        generation = descriptor.fenceField ? ++view[descriptor.fenceField] : null;

    if (descriptor.gate && !descriptor.gate(view, params, bridge)) {
        return
    }

    descriptor.preAwait?.(view, params);

    const
        verb       = bridge?.[descriptor.verb],
        wireParams = descriptor.wireParams ? descriptor.wireParams(params, view) : params,
        fallback   = reason => descriptor.fallback(params, reason);

    let snapshot;

    descriptor.inFlightField && view[descriptor.inFlightField]++;

    try {
        if (typeof verb !== 'function') {
            snapshot = fallback(descriptor.notWiredReason)
        } else {
            try {
                snapshot = await verb.call(bridge, wireParams)
            } catch (error) {
                if (descriptor.errorMode === 'keep') {
                    // fail-closed: the last-known snapshot stays; the pane never renders "empty"
                    // for a read that did not happen
                    return
                }
                snapshot = fallback(descriptor.failedReason)
            }
        }
    } finally {
        descriptor.inFlightField && view[descriptor.inFlightField]--
    }

    if ((generation === null || generation === view[descriptor.fenceField]) && !view.isDestroyed) {
        descriptor.apply(view, snapshot)
    }

    return snapshot
}

/**
 * @summary The descriptor table: each source's full read contract in one named place.
 * Pane accessors are called through the view so the phase-blind resolution (projected, vesseled,
 * parked, rebuilt) stays exactly the cockpit's.
 */
const SOURCE_READS = {
    /**
     * S3 invoked history. Typed unavailable envelope carries the requested partition so the pane's
     * honest chrome stays addressable.
     */
    catchUp: {
        verb          : 'fleetHistory',
        fenceField    : 'catchUpReadGeneration',
        notWiredReason: 'fleet history verb not wired',
        failedReason  : 'fleet history read failed',
        fallback      : (params, reason) => ({
            capability         : {state: 'unavailable', reason},
            needsFirstUseWindow: false,
            partition          : params.partition || 'unified',
            viewerState        : {lastSeen: null, lastVisitAt: null},
            window             : null,
            sources            : null
        }),
        apply(view, snapshot) {
            view.catchUpSnapshot = snapshot;

            const pane = view.getCatchUpPane();

            pane && (pane.snapshot = snapshot)
        }
    },

    /**
     * Resident per-agent session-summary recall. The requested selection is view-held BEFORE any
     * await: a pane removed and rematerialized while this read is in flight must reopen on the
     * PENDING target (honest switch-pending state), not on the last accepted snapshot's target.
     */
    memories: {
        verb          : 'fleetMemories',
        fenceField    : 'memoriesReadGeneration',
        notWiredReason: 'fleet memories verb not wired',
        failedReason  : 'fleet memories read failed',
        preAwait(view, params) {
            if (params.agentIdentity) {
                view.memoriesTarget = params.agentIdentity
            }
        },
        fallback: (params, reason) => ({
            capability: {state: 'unavailable', reason},
            viewer    : null,
            target    : params.agentIdentity || null,
            page      : {offset: params.offset ?? 0, limit: null},
            sessions  : [],
            count     : 0,
            total     : null
        }),
        apply(view, snapshot) {
            view.memoriesSnapshot = snapshot;

            const livePane = view.getMemoriesPane();

            livePane && (livePane.snapshot = snapshot)
        }
    },

    /**
     * The memories drill-in — the summary read's discipline one level down: the open drill is
     * view-held before the await, and display-only `title` never rides the wire call.
     */
    sessionMemories: {
        verb          : 'fleetSessionMemories',
        fenceField    : 'memoriesDrillReadGeneration',
        notWiredReason: 'fleet session-memories verb not wired',
        failedReason  : 'fleet session-memories read failed',
        preAwait(view, params) {
            if (params.sessionId) {
                view.memoriesDrillSession = {sessionId: params.sessionId, title: params.title ?? null}
            }
        },
        wireParams(params) {
            const {title, ...wireParams} = params;

            return wireParams
        },
        fallback: (params, reason) => ({
            capability: {state: 'unavailable', reason},
            viewer    : null,
            sessionId : params.sessionId || null,
            page      : {offset: params.offset ?? 0, limit: null},
            turns     : [],
            count     : 0,
            total     : null
        }),
        apply(view, snapshot) {
            view.memoriesDrillSnapshot = snapshot;

            const livePane = view.getMemoriesPane();

            livePane && (livePane.drillSnapshot = snapshot)
        }
    },

    /** The decomposed per-seat wake-route envelope — the memories sibling, no variance. */
    wakeRoutes: {
        verb          : 'fleetWakeRoutes',
        fenceField    : 'wakeRoutesReadGeneration',
        notWiredReason: 'fleet wake-routes verb not wired',
        failedReason  : 'fleet wake-routes read failed',
        fallback      : (params, reason) => ({
            capability: {state: 'unavailable', reason},
            viewer    : null,
            count     : 0,
            seats     : []
        }),
        apply(view, snapshot) {
            view.wakeRoutesSnapshot = snapshot;

            const livePane = view.getWakeRoutesPane();

            livePane && (livePane.snapshot = snapshot)
        }
    },

    /**
     * The deployment's task picture — plus the liveness tick's in-flight accounting: incremented
     * before the verb check, released in `finally` on this read's OWN settle, never a newer one's.
     */
    tasks: {
        verb          : 'fleetTasks',
        fenceField    : 'tasksReadGeneration',
        inFlightField : 'tasksReadInFlight',
        notWiredReason: 'fleet tasks verb not wired',
        failedReason  : 'fleet tasks read failed',
        fallback      : (params, reason) => ({
            capability: {state: 'unavailable', reason},
            viewer    : null,
            sources   : {},
            running   : [],
            queued    : [],
            recent    : [],
            counts    : {running: 0, queued: 0, recent: 0}
        }),
        apply(view, snapshot) {
            view.tasksSnapshot = snapshot;

            const livePane = view.getTasksPane();

            livePane && (livePane.snapshot = snapshot)
        }
    },

    /**
     * The OPERATOR's own mailbox mirror. The gate is the honest outcome, not an error: no pane /
     * no bound subject / no verb → the pane's `unobserved` state stands (nothing is fabricated);
     * a throwing bridge KEEPS the last-known snapshot (`errorMode: 'keep'`). The viewer is
     * server-resolved at the ingress; the subject is the operator's own identity, held view-side.
     */
    operatorInbox: {
        verb      : 'fleetMailboxMirror',
        fenceField: 'operatorInboxReadGeneration',
        errorMode : 'keep',
        gate(view, params, bridge) {
            return Boolean(
                view.getOperatorMailboxPane() &&
                view.operatorRecord?.agentIdentityNodeId &&
                typeof bridge?.fleetMailboxMirror === 'function'
            )
        },
        wireParams(params, view) {
            return {subjectAgentId: view.operatorRecord?.agentIdentityNodeId, offset: params.offset ?? 0}
        },
        apply(view, snapshot) {
            view.operatorSnapshot = snapshot;

            // resolve at WRITE time (phase-blind): the admission read still gates the request,
            // but a pane torn out or returning during the await gets the fresh truth
            const livePane = view.getOperatorMailboxPane();

            livePane && (livePane.snapshot = snapshot)
        }
    }
};

/**
 * @summary Clear the view-held memories drill-in — the pane's close intent. The generation bump
 * makes the close TERMINAL for in-flight reads: the counter is the change-proxy for "is this read
 * still wanted", and close is a second way to make a read unwanted — without the bump, a read
 * landing after close would repopulate the view state (and the pane) for exactly the drill the
 * operator left.
 * @param {Neo.container.Base} view
 */
function clearSessionMemoriesDrillImpl(view) {
    view.memoriesDrillReadGeneration++;
    view.memoriesDrillSession  = null;
    view.memoriesDrillSnapshot = null
}

/**
 * @summary BOOT: resolve the operator's OWN identity from the authenticated bridge (whoami) and
 * hold it view-side — the bootstrap leg of "the client SAYS self, the admission stamp proves it".
 * The mirror read requires an EXPLICIT subject (a self-default at a trust boundary is
 * spoof-adjacent), so the cockpit first learns its own @-id, then the pane passes it and the
 * mirror's admission re-stamps + proves it. Fail-closed: an unwired source / unbound context /
 * absent bridge leaves `operatorRecord` null and the pane honestly unobserved — never a fabricated
 * identity. Deliberately OUTSIDE {@link #readFencedSource}: no fence (identity is not racing
 * pagination), no fallback envelope (absence IS the state), and a bridge throw propagates.
 * @param {Neo.container.Base} view
 * @returns {Promise<void>}
 */
async function loadOperatorIdentityImpl(view) {
    const bridge = resolveFleetBridge();

    if (typeof bridge?.resolveViewerIdentity !== 'function') {
        return
    }

    const outcome = await bridge.resolveViewerIdentity();

    // {ok:true, agentIdentityNodeId} | {ok:false, error}. Only a proven identity seeds the
    // subject; a refusal never reads a wrong inbox.
    if (outcome?.ok && outcome.agentIdentityNodeId && !view.isDestroyed) {
        const nodeId = outcome.agentIdentityNodeId;

        // the reused MailboxPane proves possession from `record.githubUsername` (canonicalized to
        // `@<username>` against the mirror admission's subject); the node id IS that @-form
        // authority, so carry both: the username for the possession match, the node id as the
        // explicit read subject
        view.operatorRecord = {agentIdentityNodeId: nodeId, githubUsername: nodeId.replace(/^@/, '')};

        // the seat-conflation honesty check rides the same resolution: a viewer claim matching a
        // registered agent identity means sends are attributed to that seat — a truth the pane
        // must render, not swallow. Dispatched THROUGH THE OWNER, never the private function:
        // the shipped seam is the cockpit's virtual method, and an view-side override must keep
        // receiving the call (the delegate routes the default back here).
        view.operatorIdentityPosture = view.deriveOperatorIdentityPosture(nodeId);

        // a materialized pane picks up the identity live and reads; a pane that projected first
        // takes the identity through this same live set — both orderings land exactly one first read
        view.getOperatorMailboxPane()?.set({record: view.operatorRecord, identityPosture: view.operatorIdentityPosture})
    }
}

/**
 * @summary Compare the resolved viewer identity against the provider-owned roster's agent
 * identities — the cockpit half of the seat-conflation honesty contract (the fleet server runs
 * the same decision server-side; the check is trivial enough that duplicating it beats an
 * app→Brain import across the parity boundary).
 *
 * An empty roster answers `null` (cannot judge) rather than `{conflated: false}` — absence of
 * roster truth is not a clean bill, and the pane renders unknown as unknown.
 * @param {Neo.container.Base} view
 * @param {String} viewerIdentity The resolved `@`-form viewer identity.
 * @returns {{conflated: Boolean, seatIdentity: String}|null}
 */
function deriveOperatorIdentityPostureImpl(view, viewerIdentity) {
    const rows = view.resolveFleetRosterStore()?.items ?? [];

    if (typeof viewerIdentity !== 'string' || !viewerIdentity.trim() || rows.length < 1) {
        return null
    }

    const
        bare      = id => String(id).trim().replace(/^@/, ''),
        viewer    = bare(viewerIdentity),
        conflated = rows.some(row => bare(row.agentId ?? '') === viewer);

    return {conflated, seatIdentity: `@${viewer}`}
}



/* ── the liveness read class (#50, cut 2 of Epic #22) — relocated verbatim from the cockpit;
      every former `me.*` collaborator call dispatches through `view.*`, preserving the virtual
      seams (reconcileRoster, degradeWiredSurface, syncSpineBanner, applyBrainHealth, …) per the
      #49 RA-1 law. `boundedRead` + `toSafeDegradedReason` are lexical helpers and moved whole. ── */

/**
 * Longest safe reason rendered on the spine banner — a transport error can carry an entire response
 * body, and this line is one row of shell chrome, not a log viewer.
 * @type {Number}
 */
const MAX_DEGRADED_REASON_LENGTH = 120;

/**
 * @summary Reduces an untrusted transport failure to one safe, operator-readable clause.
 *
 * A transport error is peer/network-authored text this shell republishes into operator-visible
 * chrome, so it is redacted and bounded before it can ever render: credential-bearing forms are the
 * realistic payload of a failing authenticated request (a bearer header or PAT echoed back in an
 * error body), and the scheme rule must precede the `key: value` rule or `Authorization: Bearer x`
 * matches `authorization`, stops at the space, and republishes the secret intact.
 * @param {*} error Untrusted failure — an Error, a string reason, or anything else.
 * @returns {String|null} A safe single-line clause, or `null` when the cause is unknowable (the
 *     banner then renders its generic copy rather than inventing a cause).
 * @private
 */
function toSafeDegradedReason(error) {
    const raw = typeof error === 'string' ? error : error?.message;

    if (typeof raw !== 'string' || !raw.trim()) return null;

    const safe = raw
        .replace(/\b(?:authorization\s*[:=]\s*)?bearer\s+[^\s,;)]+/gi, 'authorization=[redacted]')
        .replace(/\b(authorization|token|secret|password|pat|credential)\s*[:=]\s*[^\s,;)]+/gi, '$1=[redacted]')
        .replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, '[redacted-token]')
        .replace(/\bglpat-[A-Za-z0-9_-]+/g, '[redacted-token]')
        .replace(/\s+/g, ' ')
        .trim();

    return safe ? safe.slice(0, MAX_DEGRADED_REASON_LENGTH) : null
}

/**
 * @summary Bounds one liveness read: it may fail, it may never hang.
 *
 * A hung read is not a slow read — it is a read that never answers, and an unbounded one poisons
 * every mechanism built on top of it. The in-flight latch releases in a `.finally()`, so a promise
 * that never settles holds its surface's slot **forever**: every later tick is suppressed, the
 * surface stays last-known-live, and the liveness view silently stops being live — the original
 * defect, rebuilt from the other side. Bounding the read is what makes the latch safe to hold.
 *
 * The loser of the race is not aborted (the wire has no abort seam yet). It does not need to be:
 * the generation fence already makes a late arrival unable to write. This only guarantees the
 * SLOT comes back.
 * @param {Promise} read
 * @param {Number} timeout ms
 * @returns {Promise} settles with the read, or rejects with a timeout error inside `timeout` ms
 * @private
 */
function boundedRead(read, timeout, onWireSettled) {
    let timerId;

    // the WIRE's own settle — independent of who wins the race. The accumulation bound counts this,
    // because a timed-out wrapper does not free the socket the read is still holding.
    read.then(onWireSettled, onWireSettled);

    return Promise.race([
        read.finally(() => clearTimeout(timerId)),
        new Promise((resolve, reject) => {
            timerId = setTimeout(() => reject(new Error(`fleet read exceeded ${timeout}ms`)), timeout)
        })
    ])
}


    /**
     * @summary Bind the activity stream to the live fleet feed: poll the read-observe `fleetActivity`
     * verb on the injected registry bridge and route its honest capability state to the stream:
     * - `wired` → **live** (the feed is newest-first; the stream renders chronological, so reverse). A
     *   wired source is live even when momentarily empty — it is streaming, just quiet — so an empty
     *   wired feed stays `live` (empty), never the sample: falling back to the sample would falsely
     *   imply the source is not wired.
     * - `degraded` → the **stale** banner.
     * - not-wired / absent bridge / a thrown source → leave the representative **sample** in place
     *   (honestly labelled by the stream header); fail closed rather than blanking the surface.
     * The routed state also lands on the OWNER and its provider Store, so a pane returning from
     * true absence materializes at current truth.
     * @protected
     */
    async function loadActivityImpl(view) {
        const
            store  = view.resolveFleetActivityEventsStore(),
            stream = view.getReference('activity-stream'),
            bridge = globalThis.AgentOS?.fleet?.registryBridge;

        // BEFORE the early return, not after. Absence is newer knowledge, and an older pending read
        // must not outlive it: without the bump, a tick that finds the bridge gone returns silently
        // and an in-flight read from when it was present still lands and writes.
        const generation = ++view.streamReadGeneration;

        if (!store || typeof bridge?.fleetActivity !== 'function') {
            // no bridge/verb IS the cold truth — the spine banner must say so. Same retraction
            // duty as the roster twin's absence exit: a never-wired surface's retained
            // producer-answered cause ("activity source not wired") must not outlive the bridge
            // that answered it; wired surfaces keep their stale/live semantics.
            if (view.streamAdapterState === 'sample') {
                view.streamDegradedReason = null
            }

            view.syncSpineBanner();
            return
        }

        try {
            view.streamReadInFlight++;

            // `Promise.resolve().then(() => …)` — NOT `Promise.resolve(bridge.fleetActivity())`.
            // The argument form evaluates the CALL first, so a SYNCHRONOUS throw lands in this
            // method's catch before `boundedRead` ever attaches its settle hook, and the counter
            // never comes back. Two sync throws consume the cap and suppress this surface forever —
            // the leak, rebuilt inside the fix for the leak. Invoking INSIDE the chain turns a sync
            // throw into a rejection of the tracked promise, so the reject path owns the release.
            const {capability, counts, events} = await boundedRead(
                Promise.resolve().then(() => bridge.fleetActivity()),
                view.livenessReadTimeout,
                () => { view.streamReadInFlight-- }
            ) ?? {};

            // The fence. Older news must never overwrite newer: an interval re-poll means two reads
            // of THIS surface can be in flight at once, and without this the LOSER writes last —
            // a slow failed poll landing after a fast successful one regresses live → stale on
            // strictly staler information. `isDestroyed` is the same question at the other end: a
            // read that outlives its view has no surface left to speak for.
            if (generation !== view.streamReadGeneration || view.isDestroyed) {
                return
            }

            if (capability?.state === 'wired') {
                view.streamAdapterState = 'live';
                store.ingestSnapshot(Array.isArray(events) ? events : [], {replace: !view.activityWired});
                view.activityWired = true;
                view.getStateProvider()?.setData('activityCounts', Array.isArray(counts) ? counts : []);
                stream && (stream.adapterState = view.streamAdapterState);
                view.clearDegradedReason('stream')
            } else if (capability?.state === 'degraded') {
                view.streamAdapterState = 'stale';
                stream && (stream.adapterState = 'stale');
                // the adapter's OWN reason outranks a guess — it saw the failure, we only saw the answer
                view.streamDegradedReason = toSafeDegradedReason(capability.reason)
            } else if (capability) {
                // The producer ANSWERED and said it is not wired (`not-wired`). The seed stays — the
                // stream really is showing sample events, so its own state is honestly 'sample' — but
                // an answer is not silence, and the difference is the whole point: a reachable server
                // whose activity source is unconfigured is NOT an unreachable server. Retaining the
                // reason is what lets the banner say which one it is instead of guessing the loudest.
                view.streamDegradedReason = toSafeDegradedReason(capability.reason)
            }
            // NO capability at all (a torn/absent answer) → keep the 'sample' seed AND no reason:
            // we learned nothing, so the banner falls back to its generic copy rather than inventing
            // a cause. That is the genuine cold case.
        } catch (error) {
            // fenced too, and this is the branch that actually bit: a slow FAILURE landing after a
            // fast success would regress live → stale on older news. The catch is not exempt from
            // ordering just because it is the sad path.
            if (generation === view.streamReadGeneration && !view.isDestroyed) {
                // fail-closed: the last-known feed STAYS rather than blanking it — only the state advances
                view.degradeWiredSurface('stream', error, stream)
            }
        } finally {
            // a superseded or post-destroy read renders nothing: syncing here would let a dropped
            // read still repaint the banner from state it was not allowed to write
            if (generation === view.streamReadGeneration && !view.isDestroyed) {
                view.syncSpineBanner()
            }
        }
    }

    /**
     * @summary Bind the fleet roster to the running fleet: poll the read-observe `fleetRoster` verb
     * on the injected registry bridge — the Brain-side assembler DTO (`{sources, capabilities, rows,
     * events}`, identity-enriched per the `resolveIdentityDisplay` join) — map its rows onto the
     * FleetAgent record contract, and route honestly into the Store the grid renders from:
     * - a populated resolved snapshot is **authoritative**: the first one replaces the sample seed
     *   and promotes {@link #rosterSourceMode} to `selected`; every later one **reconciles** the
     *   Store — `record.set(row)` per known `agentId`, `store.add` for a joiner, `store.remove` for
     *   a resident absent from the snapshot (a `removeAgent` must never leave a ghost card).
     * - an EMPTY first snapshot preserves the bundled sample while the source mode is `sample` — a
     *   fresh private registry must not blank the zero-setup first paint. It becomes authoritative
     *   when the source was explicitly `selected`, or after any live snapshot established
     *   {@link #rosterWired}; a genuinely selected/drained fleet therefore still renders its TRUE
     *   zero state rather than resurrecting sample residents.
     *   Every admitted snapshot makes the grid `live` (instance + view-held fallback state).
     * - absent bridge / no verb / a MALFORMED answer (`rows` not an Array) / a thrown source →
     *   keep the last-known roster; fail closed rather than blanking the fleet. A resolved call is
     *   mechanically distinguishable from a failed one — only failures preserve last-known state.
     *   Absence and thrown calls are DISTINCT transitions with one shared retraction duty: a
     *   never-wired surface's retained answered cause is withdrawn on either (the claim must not
     *   outlive its producer), while a wired surface keeps its stale/live semantics. (The grid's
     *   `stale` render remains reserved for a real degraded signal once a producer emits one.)
     * @protected
     */
    async function loadRosterImpl(view) {
        const
            // the WRITE authority is the provider-owned Store — a torn/absent grid must not stop
            // live ingest (round-2 RA-1: the projected child renders, it never owns the roster)
            store  = view.resolveFleetRosterStore(),
            grid   = view.getReference('fleet-grid'),
            bridge = globalThis.AgentOS?.fleet?.registryBridge;

        // BEFORE the early return — absence is newer knowledge and must invalidate an older pending
        // read. See {@link #gridReadGeneration}.
        const generation = ++view.gridReadGeneration;

        if (!store || typeof bridge?.fleetRoster !== 'function') {
            // no bridge/verb IS the cold truth — the spine banner must say so. Absence is a
            // DISTINCT transition from a thrown call, and it owns the same retraction duty: a
            // never-wired surface's retained ANSWERED cause ("server connected · registry
            // empty") must not outlive the bridge that said it. A wired surface keeps its
            // stale/live semantics — this exit only speaks for cold truth.
            if (view.gridAdapterState === 'sample') {
                view.gridDegradedReason = null
            }

            view.syncSpineBanner();
            return
        }

        try {
            view.gridReadInFlight++;

            // invoked INSIDE the chain so a synchronous throw rejects the tracked promise rather
            // than escaping before the settle hook attaches — see the activity twin
            const {capabilities, rows} = await boundedRead(
                Promise.resolve().then(() => bridge.fleetRoster()),
                view.livenessReadTimeout,
                () => { view.gridReadInFlight-- }
            ) ?? {};

            // the fence: a newer read started while this one was in flight, or the view is gone.
            // Either way this answer is no longer this surface's truth to write.
            if (generation !== view.gridReadGeneration || view.isDestroyed) {
                return
            }

            if (!Array.isArray(rows)) {
                return // malformed answer → keep the last-known roster
            }

            const mapped = rows.filter(row => row?.id).map(row => view.mapRosterRow(row));

            // The shipped sample is the cold-first-run authority. A reachable but fresh/empty
            // private registry has answered, but it has not supplied a working fleet and no source
            // was selected — replacing the sample here would turn successful boot into an empty
            // flagship. An explicitly wired bridge (the injector marks it `selected`) IS a source
            // selection, so its empty registry renders the true zero state; once any populated
            // snapshot made the surface live, empty regains its ordinary authoritative meaning
            // (the real fleet may genuinely drain).
            if (!view.rosterWired && mapped.length === 0 && !bridge?.selected && view.rosterSourceMode !== 'selected') {
                // The server ANSWERED — but an answer is not silence (the activity twin's not-wired
                // discipline): retain the cause so the spine banner names "connected · registry
                // empty" instead of falling back to "server offline · start it" — advice to restart
                // a process that just replied, and the exact reachable-server case the spineBanner
                // module documents as needing a retained reason. Cleared by the ordinary paths: a
                // populated snapshot clears it below; a transport failure retracts it in
                // {@link #degradeWiredSurface} (the claim must not outlive the connection).
                view.gridDegradedReason = 'server connected · fleet registry empty — define agents to go live';
                return
            }

            view.lastLiveRows = mapped;
            view.rosterSourceMode = 'selected';

            if (view.rosterWired) {
                view.reconcileRoster(store, mapped)
            } else {
                store.clear();
                mapped.length > 0 && store.add(mapped);
                view.rosterWired = true;
                // the first live snapshot replaces the sample seed wholesale — re-seat or clear a
                // selection made against a now-removed sample record (reconcileRoster owns the later reconciles)
                view.reconcileSelection()
            }

            view.gridAdapterState = 'live';
            // rendering-only writes: the grid is a PROJECTION of the store's truth — torn/absent,
            // it simply has nothing to paint, and the ingest above happened regardless
            grid && (grid.adapterState = 'live');
            // the presence-CAPABILITY envelope rides every admitted snapshot onto the grid's chip:
            // a degraded producer gets NAMED at roster level (every band correctly vanished — the
            // "no one is online" operator falsifier), and a recovered producer clears it on the
            // next poll. Absent/malformed envelopes plumb null — the chip claims nothing.
            grid && (grid.presenceCapability = capabilities?.presence ?? null);
            view.getCatchUpPane()?.set({partitionOptions: view.buildCatchUpPartitionOptions()});
            // the activity rows' actor chips join the same roster truth (avatar + display name)
            view.getReference('activity-stream')?.set({actorDirectory: view.buildActivityActorDirectory()});
            // resident panes snapshot their roster-derived options at projection time, which can
            // precede this first live answer — every consumer refreshes here, the mailbox included
            // (recipients grow beyond the boot-time AGENT:* sentinel), and the seat-conflation
            // posture re-derives against the roster that can now actually judge it.
            view.getOperatorMailboxPane()?.set({recipientOptions: view.buildOperatorRecipientOptions()});
            if (view.operatorRecord) {
                view.operatorIdentityPosture = view.deriveOperatorIdentityPosture(view.operatorRecord.agentIdentityNodeId);
                view.getOperatorMailboxPane()?.set({identityPosture: view.operatorIdentityPosture})
            }
            // a resident CatchUp can emit its construction-time history request BEFORE the bridge
            // wires (the cold-before-bridge ordering); that one-shot miss recovers the moment the
            // bridge answers, through the pane's own guarded refresh path — the Reconnect
            // affordance's documented re-drive, fired automatically at bridge arrival.
            view.catchUpSnapshot?.capability?.state === 'unavailable' && view.getCatchUpPane()?.onRefreshClick();
            view.clearDegradedReason('grid')
        } catch (error) {
            // fenced: a slow failure must not overwrite a newer success (see the stream twin)
            if (generation === view.gridReadGeneration && !view.isDestroyed) {
                // fail-closed: the last-known roster STAYS rather than blanking the fleet — only the
                // state advances. A wired surface that stops answering is degraded, not cold: it is
                // showing last-known LIVE rows, so claiming 'sample' would tell the operator they are
                // looking at fixture data. Pre-wired failures keep the honest 'sample' seed.
                view.degradeWiredSurface('grid', error, grid)
            }
        } finally {
            if (generation === view.gridReadGeneration && !view.isDestroyed) {
                view.syncSpineBanner()
            }
        }
    }

    /**
     * @summary Pulls whole-Brain health from the shell's lifecycle view — the re-read obligation.
     *
     * Pull, never push: rides the liveness cadence for as long as the cockpit renders, so a fault
     * arriving after mount still surfaces and a recovery still clears. The read follows the same
     * bounded discipline as the wire reads — `boundedRead` frees the surface on a hung pull
     * while the wire-settle release plus the {@link #maxReadsInFlight} cap bound accumulation, and
     * the generation fence discards any late answer. Transport failure (absent shell, rejection,
     * timeout) reaches {@link #applyBrainHealth} as `null` and moves nothing.
     * @protected
     */
    async function loadBrainHealthImpl(view) {
        

        // BEFORE any early exit: absence is newer knowledge, and an older pending read must not
        // outlive it (the same rule the wire reads follow).
        const generation = ++view.brainHealthReadGeneration;

        try {
            view.brainHealthReadInFlight++;

            // Invoke INSIDE the chain: a synchronous throw becomes a rejection of the tracked
            // promise, so the reject path owns the slot release (the sync-throw falsifier class).
            const response = await boundedRead(
                Promise.resolve().then(() => Neo.Main.brainHealth()),
                view.livenessReadTimeout,
                () => { view.brainHealthReadInFlight-- }
            );

            if (generation !== view.brainHealthReadGeneration || view.isDestroyed) return;

            view.applyBrainHealth(response)
        } catch (error) {
            if (generation !== view.brainHealthReadGeneration || view.isDestroyed) return;

            view.applyBrainHealth(null)
        }
    }

/**
 * Controller for {@link AgentOS.view.fleet.cockpit.Container} — the cockpit is the **composition root** of
 * the B4÷C2 seam: the one place that knows both the resident cards and the fleet bridge, so the wire
 * lives here (the cards themselves stay intent-only and never touch transport).
 *
 * Two entry points, both driving the C2 adapter (`FleetLifecycleIntentAdapter.handleFleetLifecycleIntent`) → the registry bridge →
 * honest per-record round-trip state, never an optimistic success:
 * - `onAgentLifecycleIntent` — catches a single card's `lifecycleIntent` (resolved up the controller
 *   chain via the card's listener) and dispatches it for that card's record.
 * - `onStartFleet` — the design SSOT §01 "▶ Start fleet" one-click: fans `start` out to every
 *   rendered card, so each resident drives its own honest round-trip.
 *
 * @class AgentOS.view.fleet.cockpit.Controller
 * @extends Neo.controller.Component
 */
class FleetCockpitController extends Controller {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.Controller'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.Controller'
    }

    /**
     * The active fleet-start batch. Repeated activations join this Promise until its summary and
     * one roster reconciliation have settled, so a partially completed batch can never re-fan-out
     * already-settled members or race a second summary.
     * @member {Promise<Object>|null} startFleetPromise=null
     * @protected
     */
    startFleetPromise = null

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
     * @summary Execute the STAGED fleet bring-up: partition, per-card cascade, honest summary.
     *
     * The cockpit owns the wire (the cards stay intent-only). The action reads the roster STORE
     * (the full fleet truth — a folded idle card is still a member) and partitions it through the
     * pure {@link module:apps/agentos/view/fleet/fleetStartPlan} rules — every eligibility fact
     * comes from the wire (guest without a definition, launch-seam `launchable`, an in-flight
     * verb, a live session state), and every excluded member carries its reason: never silently
     * skipped, never a hardcoded roster. Each ELIGIBLE record then drives its own honest
     * round-trip through the C2 adapter — the per-card pending CASCADE (excluded cards never flip
     * pending; there is no fleet-wide spinner to lie N ways at once).
     *
     * After the cascade settles, the outcome summary renders into the chrome
     * (`fleet-start-summary`): started / UNKNOWN / rejected / excluded counts with per-member reasons
     * reachable from it — and the roster is re-polled ONCE so every resident that actually
     * started advances to live runtime truth ({@link #refreshRosterOnSettle}).
     * @returns {Promise<Object>} The outcome summary (see `FleetStartPlan.summarizeFleetStart`) — for tests and
     *     callers; the chrome render is the operator-facing half.
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
     * @summary The full roster truth for fleet-level actions: the grid store's records — a folded
     * idle card is still a fleet member. A present Store is authoritative even when empty; the
     * rendered-cards fallback is only for compositions that mount the controller without the grid
     * Store reference.
     * @returns {Object[]}
     */
    getRosterRecords() {
        const store = this.getReference('fleet-grid')?.store;

        return store ? [...(store.items ?? [])] : this.getAgentCards().map(card => card.record).filter(Boolean)
    }

    /**
     * @summary Write the fleet-start outcome into the chrome summary slot: the compact counts
     * line as the element text, the per-member reasons as its title (hover-reachable), hidden
     * again when cleared (`null` — a new run starts with no stale outcome showing).
     * @param {Object|null} summary From `FleetStartPlan.summarizeFleetStart`, or null to clear.
     */
    renderStartSummary(summary) {
        const slot = this.getReference('fleet-start-summary');

        if (!slot) return;

        if (!summary) {
            slot.set({hidden: true, html: ''});
            return
        }

        const {detail, text} = FleetStartPlan.renderFleetStartSummary(summary);

        slot.set({hidden: false, html: text});
        slot.vdom.title = detail;
        slot.update()
    }

    /**
     * @summary The rendered resident cards — the fleet grid's card region (a no-controller container, so
     * its `fleet-cards` reference resolves up to this controller); the collapsed-idle fold and the header
     * sub-tree are excluded by ntype.
     * @returns {Neo.component.Base[]}
     */
    getAgentCards() {
        return (this.getReference('fleet-cards')?.items ?? []).filter(card => card.ntype === 'fm-agent-card')
    }

    /**
     * @summary Consume a card's `lifecycleIntent` and drive the honest round-trip — the B4÷C2 seam.
     *
     * A card's control cluster fires an intent-only `lifecycleIntent {action, agentId}` and never
     * touches transport. The cockpit is the composition root that knows both the cards and the fleet
     * bridge: it resolves the firing card from the event `source`, then hands the intent + that card's
     * roster record to the C2 adapter (`FleetLifecycleIntentAdapter.handleFleetLifecycleIntent`). The adapter calls the registry
     * bridge and writes honest pending / settled / rejected state onto the record via `record.set()`;
     * the store's `recordChange` re-renders the card — never an optimistic success.
     * @param {Object} data The `lifecycleIntent` payload `{action, agentId, source}` — Neo stamps `source`.
     */
    onAgentLifecycleIntent(data) {
        const card = Neo.getComponent(data.source);

        return card && this.refreshRosterOnSettle(
            FleetLifecycleIntentAdapter.handleFleetLifecycleIntent(data, card.record).then(result => Boolean(result?.ok))
        )
    }

    /**
     * @summary Drill into a resident — the roster-selection→detail seam.
     *
     * The roster fires `agentSelect {agentId}` after its selection seam wrote the provider truth
     * pair; the cockpit is the composition root that knows both the roster store and the detail
     * pane. It resolves the record from the provider-owned store and seats it through
     * {@link AgentOS.view.fleet.cockpit.Container#applySelection} — the ONE selection-write site
     * (owner-held `detailRecord` for re-projection, the provider pair, the live detail pane, the
     * memories write-through). The detail pane is auto-hidden on the rail by default, so the FIRST
     * select reveals it through the standard commit loop (which re-projects and builds the pane
     * from `detailRecord`); a later select updates the already-shown pane in place, with no full
     * re-projection. An unknown agentId is a no-op (fail-closed).
     * @param {Object} data The `agentSelect` payload `{agentId}`.
     */
    onAgentSelect(data) {
        const
            me      = this,
            cockpit = me.component,
            record  = cockpit.resolveFleetRosterStore()?.get(data.agentId);

        if (!record) {
            return
        }

        cockpit.applySelection(record);

        if (cockpit.dockModel?.items?.detail?.autoHidden) {
            const result = cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'detail', autoHidden: false});

            result && !result.errors?.length && cockpit.onDockZoneDocumentChange(result.document)
        }
    }

    /**
     * @summary The grid's bootstrap CTA (empty fleet) opens the S5 define-agent zone — the same
     * reveal verb the card-drill uses for the detail pane, aimed at the rail's add-agent tool.
     * @param {Object} data The `addAgentRequest` payload — Neo stamps `source`.
     */
    onAddAgentRequest(data) {
        const cockpit = this.component;

        if (cockpit.dockModel?.items?.defineAgent?.autoHidden) {
            const result = cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'defineAgent', autoHidden: false});

            result && !result.errors?.length && cockpit.onDockZoneDocumentChange(result.document)
        }
    }

    /**
     * @summary Relay the operator-mailbox compose intent to the fleet write verb — the operator-steering
     * seam, symmetric with {@link #onAgentLifecycleIntent}.
     *
     * The operator-mailbox surface fires `compose {message}` intent-only (it holds no transport, like the
     * cards); the cockpit is the composition root that knows the bridge. It hands the message to the
     * cockpit's {@link AgentOS.view.fleet.cockpit.Container#composeOperatorMessage} write, which routes it to
     * the authenticated `composeOperatorMessage` verb — the sender is server-stamped from the bound viewer,
     * never wire-carried — and re-polls the operator inbox so a sent message lands at canonical truth,
     * never an optimistic insert.
     * **Closing the outcome loop.** The surface fires `compose` intent-only and `Observable.fire` discards
     * handler returns, so the fan-out's per-recipient result cannot flow back off the event. Instead the
     * settled outcome is written back as owner-state onto the operator-mailbox surface, which relays it to
     * the compose form to render — so a refusal / failure is never invisible (the review's P1).
     * @param {Object} data The `compose` payload `{message, source}` — Neo stamps `source`.
     */
    async onOperatorCompose(data) {
        const
            me      = this,
            outcome = await me.component.composeOperatorMessage(data.message),
            mailbox = me.component.getReference('operator-mailbox');

        mailbox && (mailbox.composeOutcome = outcome);

        return outcome
    }

    /**
     * @summary Relay the operator-mailbox paged re-read to the cockpit's own-inbox mirror read — the
     * read-seam split mirroring {@link #onAgentSelect}'s detail drill: the surface fires the intent, the
     * composition root holds the bridge and re-reads the operator mirror at the requested offset.
     * @param {Object} data The `inboxPageRequest` payload `{offset, source}`.
     */
    onOperatorInboxPageRequest(data) {
        return this.component.loadOperatorInbox({offset: data.offset})
    }

    /**
     * @summary Relay a CatchUpPane read intent to the cockpit-owned authenticated bridge.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpHistoryRequest(data) {
        const {source, ...params} = data;

        return this.component.loadCatchUp(params)
    }

    /**
     * @summary Relay the explicit runtime-only mark intent.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onCatchUpMarkRequest(data) {
        return this.component.markCatchUp({windowEnd: data.windowEnd})
    }

    /**
     * @summary Route to the existing live adjacency without turning it into history authority.
     * @param {Object} data
     * @returns {Object}
     */
    onCatchUpLiveSurfaceRequest(data) {
        return this.component.openCatchUpLiveSurface({target: data.target})
    }

    /**
     * @summary Relay a MemoriesPane read intent to the cockpit-owned authenticated bridge.
     * @param {Object} data `{agentIdentity, offset?}`
     * @returns {Promise<Object>}
     */
    onMemoriesRequest(data) {
        const {source, ...params} = data;

        return this.component.loadMemories(params)
    }

    /**
     * @summary Relay a MemoriesPane drill-in read intent (one session's turn-level memories) to
     * the cockpit-owned authenticated bridge.
     * @param {Object} data `{sessionId, title?, offset?}`
     * @returns {Promise<Object>}
     */
    onSessionDetailRequest(data) {
        const {source, ...params} = data;

        return this.component.loadSessionMemories(params)
    }

    /**
     * @summary Clear the owner-held drill-in when the pane closes it — rematerialization truth:
     * a drill the operator left must not reopen.
     * @param {Object} data
     */
    onSessionDetailClosed(data) {
        this.component.clearSessionMemoriesDrill()
    }

    /**
     * @summary Relay a WakeRoutePane read intent to the cockpit-owned authenticated bridge.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onWakeRoutesRequest(data) {
        const {source, ...params} = data;

        return this.component.loadWakeRoutes(params)
    }

    /**
     * @summary Relay a TasksPane read intent to the cockpit-owned authenticated bridge.
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    onTasksRequest(data) {
        const {source, ...params} = data;

        return this.component.loadTasks(params)
    }

    /**
     * @summary Re-poll the roster once a lifecycle intent has genuinely changed runtime state.
     *
     * `loadRoster` is the ONLY path that maps live runtime truth onto the roster records, and the
     * cockpit calls it once at construct — so without this, a started resident's card stays at its
     * stale pre-start state until a page reload (the observe half of define→start→observe). Here the
     * cockpit re-polls exactly when a settle reports a real change (`ok`), and never on a rejected /
     * timeout / unauthorized outcome (its honest reason render must stand — a refresh could clobber it
     * with a stale snapshot). `loadRoster` is idempotent + fail-closed, so a redundant call is safe.
     * @param {Promise<Boolean>} settledOk Resolves true when at least one intent changed runtime state.
     * @returns {Promise<*>} The `loadRoster` re-poll (awaited), so the handler's settle point includes the
     *     refresh and a `loadRoster` failure propagates to the caller instead of becoming a detached rejection.
     * @protected
     */
    async refreshRosterOnSettle(settledOk) {
        if (await settledOk) {
            return this.component.loadRoster()
        }
    }
    /* ── the source-read + liveness verbs (#48/#50): the controller is the logic home; the view
          keeps its owner-held fields and thin public delegates for its existing callers. ── */

    /** @summary READ-OBSERVE: one pane history intent through the fenced discipline. @param {Object} [params] @returns {Promise<Object>} */
    async loadCatchUp(params = {}) {
        return readFencedSource(this.component, SOURCE_READS.catchUp, params)
    }

    /** @summary READ-OBSERVE: one pane memories intent (pre-await owner-held target). @param {Object} [params] @returns {Promise<Object>} */
    async loadMemories(params = {}) {
        return readFencedSource(this.component, SOURCE_READS.memories, params)
    }

    /** @summary The memories drill-in (pre-await drill hold; `title` never rides the wire). @param {Object} params @returns {Promise<Object>} */
    async loadSessionMemories(params = {}) {
        return readFencedSource(this.component, SOURCE_READS.sessionMemories, params)
    }

    /** @summary Clear the owner-held drill — TERMINAL for in-flight reads. */
    clearSessionMemoriesDrill() {
        clearSessionMemoriesDrillImpl(this.component)
    }

    /** @summary The per-seat wake-route envelope through the fenced discipline. @param {Object} [params] @returns {Promise<Object>} */
    async loadWakeRoutes(params = {}) {
        return readFencedSource(this.component, SOURCE_READS.wakeRoutes, params)
    }

    /** @summary The task picture through the fenced discipline (+ in-flight accounting). @param {Object} [params] @returns {Promise<Object>} */
    async loadTasks(params = {}) {
        return readFencedSource(this.component, SOURCE_READS.tasks, params)
    }

    /** @summary The operator's own mailbox mirror (gate = honest unobserved; throw keeps last truth). @param {Object} [params] @protected @returns {Promise<Object|undefined>} */
    async loadOperatorInbox(params = {}) {
        return readFencedSource(this.component, SOURCE_READS.operatorInbox, params)
    }

    /** @summary BOOT: resolve + owner-hold the operator identity and seat posture. @protected @returns {Promise<void>} */
    async loadOperatorIdentity() {
        return loadOperatorIdentityImpl(this.component)
    }

    /** @summary The seat-conflation honesty check against the roster. @param {String} viewerIdentity @returns {{conflated: Boolean, seatIdentity: String}|null} */
    deriveOperatorIdentityPosture(viewerIdentity) {
        return deriveOperatorIdentityPostureImpl(this.component, viewerIdentity)
    }

    /** @summary The activity feed — capability routing preserved verbatim. @protected @returns {Promise<void>} */
    async loadActivity() {
        return loadActivityImpl(this.component)
    }

    /** @summary The fleet roster — sample-seed authority ladder + reconcile fan-out verbatim. @protected @returns {Promise<void>} */
    async loadRoster() {
        return loadRosterImpl(this.component)
    }

    /** @summary Whole-Brain health — bounded pull, fence, applyBrainHealth. @protected @returns {Promise<void>} */
    async loadBrainHealth() {
        return loadBrainHealthImpl(this.component)
    }

    /**
     * @summary Advances ONE wired surface to the degraded truth and retains the safe reason.
     *
     * The state-writing seams stay {@link #loadRoster} / {@link #loadActivity}; this is their shared
     * loss edge, not a second writer. A surface that never reached `live` is left on its honest
     * `sample` seed — advancing it to `stale` would claim last-known data that never existed.
     * @param {String} surface `'grid'|'stream'`.
     * @param {*} error The transport failure (untrusted — never rendered raw).
     * @param {Neo.component.Base|null} [consumer] The held child whose badge mirrors the owner state.
     * @protected
     */
    degradeWiredSurface(surface, error, consumer = null) {
        let me     = this.component,
            field  = surface === 'grid' ? 'gridAdapterState' : 'streamAdapterState',
            reason = surface === 'grid' ? 'gridDegradedReason' : 'streamDegradedReason';

        // never-wired stays cold-honest: 'sample' already says "this is fixture data" — and a
        // transport failure RETRACTS any answered-state cause this surface retained (the
        // "connected · registry empty" claim must not outlive the connection it describes; back
        // on silence, the banner's generic cold copy is the honest line again).
        if (me[field] === 'sample') {
            me[reason] = null;
            return
        }

        me[field]  = 'stale';
        // this surface's cause, on this surface's field — never a shared slot a sibling can clear
        me[reason] = toSafeDegradedReason(error);

        if (consumer) consumer.adapterState = 'stale'
    }

    /**
     * @summary Clears ONE surface's retained degrade reason, once THAT surface answers cleanly.
     *
     * Scoped to the caller's own surface, because a reason is a fact about the surface that produced
     * it and no other surface has standing to retract it. The shared-field version read both states
     * and cleared when neither was `stale` — which meant a healthy roster erased a not-wired
     * ACTIVITY's cause (the activity is `sample`, not `stale`, so the guard never saw it) and the
     * banner regressed to "Fleet server offline" while the server was answering. The guard was not
     * too weak; the field was shared, and no guard on a shared field can tell whose cause it holds.
     * @param {String} surface `'grid'` | `'stream'` — the caller's own surface.
     * @protected
     */
    clearDegradedReason(surface) {
        this.component[surface === 'grid' ? 'gridDegradedReason' : 'streamDegradedReason'] = null
    }

    /** @summary Safe single-line degrade clause from an untrusted failure (file-local redactor). @param {*} error @returns {String|null} */
    toSafeDegradedReason(error) {
        return toSafeDegradedReason(error)
    }

}

export default Neo.setupClass(FleetCockpitController);
