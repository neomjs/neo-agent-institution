import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * The cockpit's source-read discipline, stated once — the first extraction cut of Epic #22 (#48).
 *
 * Shaped as a static util class per the view/util topology laws (view tree = class modules only;
 * util tree = PascalCase core.Base statics, no named exports).
 *
 * Seven FleetCockpit bridge-read verbs repeated ONE contract per source, hand-rolled each time:
 * resolve the authenticated registry bridge → verb-presence check → try/await → typed unavailable
 * fallback envelope (never a fabricated success) → read-generation fence (a slow older read never
 * overwrites a newer one) → owner-held snapshot write → WRITE-time pane resolution through the
 * phase-blind accessor (a pane torn out or rebuilt during the await still receives the truth; a
 * destroyed instance never swallows it). This module carries that contract as
 * {@link #readFencedSource} + a descriptor table ({@link #SOURCE_READS}), with the measured
 * per-source variance as explicit hooks instead of seven drifting copies:
 *
 * - `preAwait(owner, params)` — owner-held selection/drill state BEFORE any await (memories target,
 *   session drill), so a pane rematerialized mid-read reopens on the PENDING truth.
 * - `wireParams(params, owner)` — the wire payload when it differs from the intent payload
 *   (the drill strips display-only `title`; the operator inbox derives its subject owner-side).
 * - `inFlightField` — the liveness tick's overlap accounting (tasks): incremented before the verb
 *   check, released in `finally` on the read's OWN settle, never on a newer read's.
 * - `gate(owner, params, bridge)` — pre-conditions whose absence IS the honest outcome (operator
 *   inbox: no pane / no bound subject / no verb → the pane's `unobserved` state stands).
 * - `errorMode: 'keep'` — fail-closed variant that PRESERVES the last-known snapshot on a throwing
 *   bridge (operator inbox) instead of writing a typed unavailable envelope.
 * - `apply(owner, snapshot)` — the owner write + write-time pane resolve, named per source.
 *
 * Behavior-frozen: every path in this module is a verbatim relocation of the cockpit's shipped
 * semantics; the cockpit keeps thin delegates with unchanged public signatures.
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
 * gate, then the pre-await owner hold, then the verb/await with typed fallbacks, then — only when
 * this read is still the newest and the owner still lives — the owner write + pane resolve.
 * @param {Neo.container.Base} owner The cockpit instance (fence/snapshot fields + pane accessors).
 * @param {Object} descriptor One {@link #SOURCE_READS} entry.
 * @param {Object} [params] The caller's intent payload.
 * @returns {Promise<Object|undefined>} The accepted-or-fallback snapshot; `undefined` on a gate
 *     refusal or a kept error (the honest no-write outcomes).
 */
async function readFencedSource(owner, descriptor, params = {}) {
    const
        bridge     = resolveFleetBridge(),
        generation = descriptor.fenceField ? ++owner[descriptor.fenceField] : null;

    if (descriptor.gate && !descriptor.gate(owner, params, bridge)) {
        return
    }

    descriptor.preAwait?.(owner, params);

    const
        verb       = bridge?.[descriptor.verb],
        wireParams = descriptor.wireParams ? descriptor.wireParams(params, owner) : params,
        fallback   = reason => descriptor.fallback(params, reason);

    let snapshot;

    descriptor.inFlightField && owner[descriptor.inFlightField]++;

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
        descriptor.inFlightField && owner[descriptor.inFlightField]--
    }

    if ((generation === null || generation === owner[descriptor.fenceField]) && !owner.isDestroyed) {
        descriptor.apply(owner, snapshot)
    }

    return snapshot
}

/**
 * @summary The descriptor table: each source's full read contract in one named place.
 * Pane accessors are called through the owner so the phase-blind resolution (projected, vesseled,
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
        apply(owner, snapshot) {
            owner.catchUpSnapshot = snapshot;

            const pane = owner.getCatchUpPane();

            pane && (pane.snapshot = snapshot)
        }
    },

    /**
     * Resident per-agent session-summary recall. The requested selection is owner-held BEFORE any
     * await: a pane removed and rematerialized while this read is in flight must reopen on the
     * PENDING target (honest switch-pending state), not on the last accepted snapshot's target.
     */
    memories: {
        verb          : 'fleetMemories',
        fenceField    : 'memoriesReadGeneration',
        notWiredReason: 'fleet memories verb not wired',
        failedReason  : 'fleet memories read failed',
        preAwait(owner, params) {
            if (params.agentIdentity) {
                owner.memoriesTarget = params.agentIdentity
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
        apply(owner, snapshot) {
            owner.memoriesSnapshot = snapshot;

            const livePane = owner.getMemoriesPane();

            livePane && (livePane.snapshot = snapshot)
        }
    },

    /**
     * The memories drill-in — the summary read's discipline one level down: the open drill is
     * owner-held before the await, and display-only `title` never rides the wire call.
     */
    sessionMemories: {
        verb          : 'fleetSessionMemories',
        fenceField    : 'memoriesDrillReadGeneration',
        notWiredReason: 'fleet session-memories verb not wired',
        failedReason  : 'fleet session-memories read failed',
        preAwait(owner, params) {
            if (params.sessionId) {
                owner.memoriesDrillSession = {sessionId: params.sessionId, title: params.title ?? null}
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
        apply(owner, snapshot) {
            owner.memoriesDrillSnapshot = snapshot;

            const livePane = owner.getMemoriesPane();

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
        apply(owner, snapshot) {
            owner.wakeRoutesSnapshot = snapshot;

            const livePane = owner.getWakeRoutesPane();

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
        apply(owner, snapshot) {
            owner.tasksSnapshot = snapshot;

            const livePane = owner.getTasksPane();

            livePane && (livePane.snapshot = snapshot)
        }
    },

    /**
     * The OPERATOR's own mailbox mirror. The gate is the honest outcome, not an error: no pane /
     * no bound subject / no verb → the pane's `unobserved` state stands (nothing is fabricated);
     * a throwing bridge KEEPS the last-known snapshot (`errorMode: 'keep'`). The viewer is
     * server-resolved at the ingress; the subject is the operator's own identity, held owner-side.
     */
    operatorInbox: {
        verb      : 'fleetMailboxMirror',
        fenceField: 'operatorInboxReadGeneration',
        errorMode : 'keep',
        gate(owner, params, bridge) {
            return Boolean(
                owner.getOperatorMailboxPane() &&
                owner.operatorRecord?.agentIdentityNodeId &&
                typeof bridge?.fleetMailboxMirror === 'function'
            )
        },
        wireParams(params, owner) {
            return {subjectAgentId: owner.operatorRecord?.agentIdentityNodeId, offset: params.offset ?? 0}
        },
        apply(owner, snapshot) {
            owner.operatorSnapshot = snapshot;

            // resolve at WRITE time (phase-blind): the admission read still gates the request,
            // but a pane torn out or returning during the await gets the fresh truth
            const livePane = owner.getOperatorMailboxPane();

            livePane && (livePane.snapshot = snapshot)
        }
    }
};

/**
 * @summary Clear the owner-held memories drill-in — the pane's close intent. The generation bump
 * makes the close TERMINAL for in-flight reads: the counter is the change-proxy for "is this read
 * still wanted", and close is a second way to make a read unwanted — without the bump, a read
 * landing after close would repopulate the owner state (and the pane) for exactly the drill the
 * operator left.
 * @param {Neo.container.Base} owner
 */
function clearSessionMemoriesDrill(owner) {
    owner.memoriesDrillReadGeneration++;
    owner.memoriesDrillSession  = null;
    owner.memoriesDrillSnapshot = null
}

/**
 * @summary BOOT: resolve the operator's OWN identity from the authenticated bridge (whoami) and
 * hold it owner-side — the bootstrap leg of "the client SAYS self, the admission stamp proves it".
 * The mirror read requires an EXPLICIT subject (a self-default at a trust boundary is
 * spoof-adjacent), so the cockpit first learns its own @-id, then the pane passes it and the
 * mirror's admission re-stamps + proves it. Fail-closed: an unwired source / unbound context /
 * absent bridge leaves `operatorRecord` null and the pane honestly unobserved — never a fabricated
 * identity. Deliberately OUTSIDE {@link #readFencedSource}: no fence (identity is not racing
 * pagination), no fallback envelope (absence IS the state), and a bridge throw propagates.
 * @param {Neo.container.Base} owner
 * @returns {Promise<void>}
 */
async function loadOperatorIdentity(owner) {
    const bridge = resolveFleetBridge();

    if (typeof bridge?.resolveViewerIdentity !== 'function') {
        return
    }

    const outcome = await bridge.resolveViewerIdentity();

    // {ok:true, agentIdentityNodeId} | {ok:false, error}. Only a proven identity seeds the
    // subject; a refusal never reads a wrong inbox.
    if (outcome?.ok && outcome.agentIdentityNodeId && !owner.isDestroyed) {
        const nodeId = outcome.agentIdentityNodeId;

        // the reused MailboxPane proves possession from `record.githubUsername` (canonicalized to
        // `@<username>` against the mirror admission's subject); the node id IS that @-form
        // authority, so carry both: the username for the possession match, the node id as the
        // explicit read subject
        owner.operatorRecord = {agentIdentityNodeId: nodeId, githubUsername: nodeId.replace(/^@/, '')};

        // the seat-conflation honesty check rides the same resolution: a viewer claim matching a
        // registered agent identity means sends are attributed to that seat — a truth the pane
        // must render, not swallow
        owner.operatorIdentityPosture = deriveOperatorIdentityPosture(owner, nodeId);

        // a materialized pane picks up the identity live and reads; a pane that projected first
        // takes the identity through this same live set — both orderings land exactly one first read
        owner.getOperatorMailboxPane()?.set({record: owner.operatorRecord, identityPosture: owner.operatorIdentityPosture})
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
 * @param {Neo.container.Base} owner
 * @param {String} viewerIdentity The resolved `@`-form viewer identity.
 * @returns {{conflated: Boolean, seatIdentity: String}|null}
 */
function deriveOperatorIdentityPosture(owner, viewerIdentity) {
    const rows = owner.resolveFleetRosterStore()?.items ?? [];

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
 * Static carrier for the fenced source-read discipline — see the module header above.
 * @class AgentOS.util.CockpitSourceReads
 * @extends Neo.core.Base
 */
class CockpitSourceReads extends Base {
    static SOURCE_READS = SOURCE_READS

    static config = {
        /**
         * @member {String} className='AgentOS.util.CockpitSourceReads'
         * @protected
         */
        className: 'AgentOS.util.CockpitSourceReads'
    }

    /** @see the module-scope docblock */
    static clearSessionMemoriesDrill = clearSessionMemoriesDrill
    /** @see the module-scope docblock */
    static deriveOperatorIdentityPosture = deriveOperatorIdentityPosture
    /** @see the module-scope docblock */
    static loadOperatorIdentity = loadOperatorIdentity
    /** @see the module-scope docblock */
    static readFencedSource = readFencedSource
    /** @see the module-scope docblock */
    static resolveFleetBridge = resolveFleetBridge
}

export default Neo.setupClass(CockpitSourceReads);
