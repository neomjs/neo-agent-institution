import Base                         from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import FleetAdmission               from './FleetAdmission.mjs';
import SpineBanner                  from './SpineBanner.mjs';
import {FLEET_WIRE_RESPONSE_STATES} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * @module apps/agentos/util/DeploymentStateRead
 * @summary The System view's read owner over the `fleetDeploymentState` verb, lifted beside the
 * cockpit's liveness owner (which holds the size bar). It runs on the owner's fences and capacity
 * bound like the roster, activity and Brain-health reads, publishes its observation on
 * `systemConnection`, and lands the plane picture on `deploymentState` only when the wire answered
 * with one. An older server's `unsupported-method` is an ANSWER, not a transport failure: the
 * observation clears and the picture carries the reason, so the view names the build gap instead
 * of an unreachable plane. A transport failure keeps the last-known picture (its `generatedAt`
 * still dates it) and publishes the typed observation. The owner's `publishConnection` is the only
 * write path. Every landed picture carries its provenance: `profileId`, the bridge that answered it,
 * and `observedAt`, the reader's clock at landing — so a consumer can refuse a picture another
 * instance answered and age a retained one instead of showing a stopped clock as current.
 */

/**
 * The closed set of picture states the wire may answer with — anything else is a torn answer.
 * @type {String[]}
 */
const pictureStates = Object.freeze(['ok', 'stale', 'unavailable']);

/**
 * One declared leaf as the wire sent it — a string or a finite number — or its blank.
 * @param {Object|null|undefined} block
 * @param {String} key
 * @returns {String|Number|null}
 */
const leafOf = (block, key) => {
    const value = block?.[key];

    return typeof value === 'string' || Number.isFinite(value) ? value : null
};

/**
 * Parse a timestamp leaf (epoch ms or ISO string) to finite epoch ms, or `null`.
 * @param {*} value
 * @returns {Number|null}
 */
const parseTimestamp = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);

        return Number.isFinite(parsed) ? parsed : null
    }
    return null
};

class DeploymentStateRead extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.DeploymentStateRead'
         * @protected
         */
        className: 'AgentOS.util.DeploymentStateRead'
    }

    /**
     * @summary The picture's leaf-complete blank — the shape authority the Viewport provider declares
     * and every landing pads to: `state` `null` = never answered, no rows, every maintenance leaf
     * `null`, no provenance. Leaf-complete on purpose: `setData` bubbles a new leaf only through
     * object-valued parents, so a block declared `null` would read `null` forever after its first
     * real answer.
     * @returns {Object}
     */
    static blank() {
        return {
            state      : null,
            reason     : null,
            generatedAt: null,
            ageMs      : null,
            profileId  : null,
            observedAt : null,
            services   : [],
            maintenance: DeploymentStateRead.toMaintenance(null)
        }
    }

    /**
     * @summary Normalize the maintenance blocks onto their declared leaf shape. An absent block
     * (`null` on the wire: the plane has no such lane) becomes all-blank leaves — a `null` parent
     * would stop the provider's leaf bubble, and the block could never read back.
     * @param {Object|null|undefined} maintenance The projection's `maintenance` block.
     * @returns {Object}
     */
    static toMaintenance(maintenance) {
        const
            backup      = maintenance?.backup,
            health      = backup?.health,
            lastBackup  = backup?.lastBackup,
            starvation  = maintenance?.starvation,
            reasonCodes = Array.isArray(health?.reasonCodes) ? health.reasonCodes.filter(code => typeof code === 'string') : [];

        return {
            backup: {
                phase           : leafOf(backup, 'phase'),
                lastSuccessAt   : leafOf(backup, 'lastSuccessAt'),
                lastSuccessAgeMs: leafOf(backup, 'lastSuccessAgeMs'),
                health          : {
                    status: leafOf(health, 'status'),
                    // one atomic array: the lane's reason codes as the plane named them
                    reasonCodes
                },
                lastBackup      : {
                    finishedAt : leafOf(lastBackup, 'finishedAt'),
                    status     : leafOf(lastBackup, 'status'),
                    offHostSync: leafOf(lastBackup, 'offHostSync')
                }
            },
            starvation: {
                posture    : leafOf(starvation, 'posture'),
                breachCount: leafOf(starvation, 'breachCount')
            }
        }
    }

    /**
     * @summary Normalize one validated projection onto the leaf shape — every field taken as the
     * wire sent it, or its blank; nothing invented. The rows stay one atomic array. The stamp is
     * the reader's, never the wire's: which bridge answered, and when this reader received it.
     * @param {Object} projection A projection whose `state` is one of the closed set.
     * @param {Object} [stamp]
     * @param {String|null} [stamp.profileId=null] The answering bridge's connection profile.
     * @param {Number|null} [stamp.observedAt=null] The reader's clock (epoch ms) at landing.
     * @returns {Object}
     */
    static toPicture(projection, {profileId = null, observedAt = null} = {}) {
        return {
            state      : projection.state,
            reason     : typeof projection.reason === 'string' ? projection.reason : null,
            generatedAt: Number.isFinite(projection.generatedAt) ? projection.generatedAt : null,
            ageMs      : Number.isFinite(projection.ageMs) ? projection.ageMs : null,
            profileId  : typeof profileId === 'string' ? profileId : null,
            observedAt : Number.isFinite(observedAt) ? observedAt : null,
            services   : Array.isArray(projection.services) ? projection.services : [],
            maintenance: DeploymentStateRead.toMaintenance(projection.maintenance)
        }
    }

    /**
     * @summary Detect a short plane cut or service restart (`<= 60 s`) between two answered
     * deployment-state projections on the same profile. Inspects explicit service restart/start
     * timestamps (`restartedAt`, `startedAt`, `inspect.currentRun.startedAt`) and sample-window
     * resets (`classification.sampleCount` drop or `restartChurn.detecting` reset after a plane cut).
     * @param {Object|null} previous Prior provider-held picture.
     * @param {Object} projection Incoming validated projection.
     * @param {Object} [stamp={}] `{profileId, observedAt}`
     * @param {Number|null} [lastLongOutageAt=null] Epoch ms of a recently ended long (`> 60 s`) outage.
     * @returns {{reason:String,recoveredAt:Number,startedAt:Number}|null}
     */
    static detectServiceRestartOutage(previous, projection, stamp = {}, lastLongOutageAt = null) {
        if (
            !previous ||
            !['ok', 'stale'].includes(previous.state) ||
            !['ok', 'stale'].includes(projection?.state) ||
            previous.profileId !== (stamp.profileId ?? null)
        ) {
            return null
        }

        const
            prevServices = Array.isArray(previous.services) ? previous.services : [],
            nextServices = Array.isArray(projection.services) ? projection.services : [];

        if (prevServices.length === 0 || nextServices.length === 0) return null;

        const
            prevByKey  = new Map(prevServices.filter(s => typeof s?.serviceKey === 'string').map(s => [s.serviceKey, s])),
            prevAnchor = parseTimestamp(previous.generatedAt) ?? parseTimestamp(previous.observedAt),
            nextAnchor = parseTimestamp(projection.generatedAt) ?? parseTimestamp(stamp.observedAt),
            restarted  = [],
            stamps     = [];

        for (const service of nextServices) {
            const
                key  = service?.serviceKey,
                prev = typeof key === 'string' ? prevByKey.get(key) : null;

            if (!prev) continue;

            const
                explicitAt  = parseTimestamp(service.restartedAt ?? service.startedAt ?? service.inspect?.currentRun?.startedAt),
                prevExplicit = parseTimestamp(prev.restartedAt ?? prev.startedAt ?? prev.inspect?.currentRun?.startedAt),
                prevSamples = prev.classification?.sampleCount,
                nextSamples = service.classification?.sampleCount,
                sampleReset = Number.isFinite(prevSamples) && Number.isFinite(nextSamples) && nextSamples < prevSamples,
                churnReset  = prev.restartChurn?.detecting === true && service.restartChurn?.detecting === false;

            if (explicitAt !== null && ((prevExplicit !== null && explicitAt > prevExplicit) || (prevAnchor !== null && explicitAt > prevAnchor))) {
                restarted.push(key);
                stamps.push(explicitAt)
            } else if (sampleReset || churnReset) {
                restarted.push(key)
            }
        }

        if (restarted.length === 0) return null;

        const
            recoveredAt = stamps.length > 0 ? Math.max(...stamps, nextAnchor ?? 0) : (nextAnchor ?? Date.now()),
            startedAt   = stamps.length > 0
                ? Math.min(...stamps)
                : (Number.isFinite(prevAnchor) && recoveredAt >= prevAnchor
                    ? Math.max(prevAnchor, recoveredAt - SpineBanner.MAX_SHORT_OUTAGE_MS)
                    : recoveredAt),
            durationMs  = recoveredAt - startedAt;

        if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > SpineBanner.MAX_SHORT_OUTAGE_MS) {
            return null
        }

        if (Number.isFinite(lastLongOutageAt) && Math.abs(recoveredAt - lastLongOutageAt) <= SpineBanner.MAX_SHORT_OUTAGE_MS) {
            return null
        }

        return {
            reason     : `${restarted.join(', ')} restarted`,
            recoveredAt,
            startedAt
        }
    }

    /**
     * @summary Apply one deployment-state answer onto the provider-held picture: a validated
     * projection replaces the last-known one and clears this surface's connection observation —
     * the wire answered. Anything else is a torn answer: the last-known picture stays, the
     * observation clears, nothing is invented.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner; its `publishConnection` is the write path.
     * @param {Object|null} projection The `fleetDeploymentState` result.
     * @param {Object} [stamp] The reader's provenance for a landed picture — see {@link toPicture}.
     */
    static apply(owner, projection, stamp = {}) {
        const state = projection && typeof projection === 'object' ? projection.state : null;

        if (!pictureStates.includes(state)) {
            owner.publishConnection('system');
            return
        }

        const
            provider    = owner.component?.getStateProvider?.(),
            previous    = provider?.getData?.('deploymentState') ?? null,
            profileId   = stamp.profileId ?? null,
            observedAt  = Number.isFinite(stamp.observedAt) ? stamp.observedAt : Date.now(),
            picture     = DeploymentStateRead.toPicture(projection, stamp);

        let outageNote = null;

        if (state === 'unavailable' && projection.reason !== FLEET_WIRE_RESPONSE_STATES.unsupportedMethod) {
            if (previous && ['ok', 'stale'].includes(previous.state) && previous.profileId === profileId) {
                FleetAdmission.recordOutageStart(owner, 'system', {
                    now   : observedAt,
                    profileId,
                    reason: owner.toSafeDegradedReason?.(projection.reason) || 'plane deployment state unavailable'
                })
            }
        } else if (state === 'ok' || state === 'stale') {
            outageNote = FleetAdmission.recordOutageRecovery(owner, 'system', {now: observedAt, profileId})
                ?? DeploymentStateRead.detectServiceRestartOutage(previous, projection, {observedAt, profileId}, owner.lastLongPlaneOutageAt ?? null)
        }

        owner.publishConnection('system', {data: {
            deploymentState: picture,
            ...(outageNote ? {planeOutageNote: outageNote} : {})
        }})
    }

    /**
     * @summary Pull the deployment-state projection once on the owner's fences: the generation
     * fence drops a stale settlement, the in-flight slot is released on the wire's OWN settle,
     * and the observation is published pending before the read and cleared or classified after it.
     * The bridge in hand at the start of the read is the picture's provenance: an instance switch
     * installs a new bridge and bumps the generation, so a picture can only land stamped with the
     * profile that answered it, and a late settlement from the previous bridge never lands at all.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner (bridge, fences, bound, publication).
     * @returns {Promise<void>}
     */
    static async load(owner) {
        const
            {bridge}   = owner,
            generation = ++owner.deploymentStateReadGeneration,
            profileId  = bridge?.profileId ?? null;

        if (typeof bridge?.fleetDeploymentState !== 'function') {
            owner.publishConnection('system');
            return
        }

        try {
            owner.publishConnection('system', {pending: true});
            owner.deploymentStateReadInFlight++;

            const projection = await owner.boundedRead(
                Promise.resolve().then(() => bridge.fleetDeploymentState()),
                () => { owner.deploymentStateReadInFlight-- }
            );

            if (generation !== owner.deploymentStateReadGeneration || owner.isDestroyed) return;

            DeploymentStateRead.apply(owner, projection, {profileId, observedAt: Date.now()})
        } catch (error) {
            if (generation !== owner.deploymentStateReadGeneration || owner.isDestroyed) return;

            if (error?.fleetWireState === FLEET_WIRE_RESPONSE_STATES.unsupportedMethod) {
                // answered by an older build: the picture's own reason, not a connection observation
                DeploymentStateRead.apply(owner, {state: 'unavailable', reason: FLEET_WIRE_RESPONSE_STATES.unsupportedMethod}, {profileId, observedAt: Date.now()});
                return
            }

            const previous = owner.component?.getStateProvider?.()?.getData?.('deploymentState');

            if (previous && ['ok', 'stale'].includes(previous.state) && previous.profileId === profileId) {
                FleetAdmission.recordOutageStart(owner, 'system', {
                    now   : Date.now(),
                    profileId,
                    reason: owner.toSafeDegradedReason?.(error) || 'plane deployment state unavailable'
                })
            }

            owner.publishConnection('system', {error})
        }
    }
}

export default Neo.setupClass(DeploymentStateRead);
