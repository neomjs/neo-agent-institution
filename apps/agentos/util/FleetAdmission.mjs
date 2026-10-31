import ActivityObserver from './ActivityObserver.mjs';
import Base             from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import SpineBanner      from './SpineBanner.mjs';
import TargetBinding    from './TargetBinding.mjs';
import {FLEET_COCKPIT_EVENT_TYPES, FLEET_COCKPIT_SOURCES} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

const
    ACTIVITY_SLOT_LABELS = Object.freeze({
        a2a      : 'mailbox',
        'pr-lane': 'PR lanes'
    }),
    DEFAULT_ACTIVITY_RECHECK_MS = 60000,
    GENERIC_PARTIAL_SUMMARY     = 'some sources unavailable',
    MAX_SLOT_LABEL_LENGTH       = 32,
    PR_LANE_EVENT_SOURCES       = Object.freeze([
        FLEET_COCKPIT_SOURCES.githubPr,
        FLEET_COCKPIT_SOURCES.githubIssue,
        FLEET_COCKPIT_SOURCES.commentLane,
        FLEET_COCKPIT_SOURCES.graphLane,
        FLEET_COCKPIT_SOURCES.graphStall,
        'pr-lane'
    ]),
    RESERVED_SLOT_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']),
    VALID_SLOT_STATES  = new Set(['wired', 'degraded', 'not-wired', 'unavailable']);

/**
 * @module apps/agentos/util/FleetAdmission
 * @summary The admission of an ANSWERED fleet surface — the one path a complete or partial answer and a test's
 * landing share, lifted beside the liveness owner (which holds the size bar) like the retirement in
 * {@link AgentOS.util.TargetBinding}. The owner's reads call it after their generation fence and
 * validation; the tests' landing (`test/playwright/fixture/FleetLanding.mjs`) calls it directly with
 * the rows or events it lands, as the answer of the bridge in hand. Both callers share the Store
 * admission and publish the same completeness state.
 */
class FleetAdmission extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.FleetAdmission'
         * @protected
         */
        className: 'AgentOS.util.FleetAdmission'
    }

    /**
     * @summary Leaf-complete blank short-outage note for initial state and profile retirement.
     * @returns {{reason:null,recoveredAt:null,startedAt:null}}
     */
    static blankOutageNote() {
        return {reason: null, recoveredAt: null, startedAt: null}
    }

    /**
     * @summary Opens a plane outage episode on `key` for an already-wired surface or capability slot,
     * preserving the first observed start timestamp while the episode remains open for `profileId`.
     * @param {Object} owner The liveness owner.
     * @param {String} key `'grid'|'stream'|'presence'|'a2a'|'system'`
     * @param {Object} [options={}]
     * @param {Number} [options.now=Date.now()]
     * @param {String|null} [options.profileId=null]
     * @param {String|null} [options.reason=null]
     */
    static recordOutageStart(owner, key, {now = Date.now(), profileId = null, reason = null} = {}) {
        if (!owner || !key || !Number.isFinite(now)) return;

        const
            episodes = owner.planeOutageEpisodes ??= Object.create(null),
            existing = episodes[key],
            safe     = (typeof reason === 'string' && reason.trim()) || 'plane restarted';

        if (existing && existing.profileId === profileId) {
            if (!existing.reason && safe) existing.reason = safe;
            return
        }

        episodes[key] = {profileId, reason: safe, startedAt: now}
    }

    /**
     * @summary Closes an open plane outage episode on `key` upon recovery and publishes `planeOutageNote`
     * when the outage lasted `<= 60 s` (`SpineBanner.MAX_SHORT_OUTAGE_MS`) on the same profile without
     * an active credential refusal (`planeCause`). Outages `> 60 s` are already named while down and
     * do not produce a short-outage note.
     * @param {Object} owner The liveness owner.
     * @param {String} key `'grid'|'stream'|'presence'|'a2a'|'system'`
     * @param {Object} [options={}]
     * @param {Number} [options.now=Date.now()]
     * @param {String|null} [options.profileId=null]
     * @returns {{reason:String,recoveredAt:Number,startedAt:Number}|null}
     */
    static recordOutageRecovery(owner, key, {now = Date.now(), profileId = null} = {}) {
        const
            episodes = owner?.planeOutageEpisodes,
            episode  = episodes?.[key];

        if (!episode) return null;

        delete episodes[key];

        const
            provider   = owner.component?.getStateProvider?.(),
            durationMs = now - episode.startedAt;

        if (episode.profileId !== profileId || !Number.isFinite(durationMs) || durationMs < 0) {
            return null
        }

        if (durationMs > SpineBanner.MAX_SHORT_OUTAGE_MS) {
            owner.lastLongPlaneOutageAt = now;
            return null
        }

        if (provider?.getData?.('planeCause')) {
            return null
        }

        const note = {
            reason     : episode.reason || 'plane restarted',
            recoveredAt: now,
            startedAt  : episode.startedAt
        };

        provider?.setData?.({planeOutageNote: note});

        return note
    }

    /**
     * @summary Opens an outage episode when an already-wired surface degrades to `'stale'`.
     * @param {Object} owner
     * @param {String} surface `'grid'|'stream'`
     * @param {String} state `'cold'|'stale'`
     * @param {String|null} reason
     */
    static recordSurfaceDegradation(owner, surface, state, reason) {
        if (state === 'stale' && (surface === 'grid' ? owner?.rosterWired : owner?.activityWired)) {
            FleetAdmission.recordOutageStart(owner, surface, {
                profileId: owner.bridge?.profileId ?? null,
                reason   : reason || `${surface === 'grid' ? 'Roster' : 'Activity'} connection unavailable`
            })
        }
    }

    /**
     * @summary Leaf-complete blank guidance for a non-partial or retired activity feed.
     * @returns {{head:null,headTitle:null,missing:null,reason:null,recheck:null,remaining:null,repair:null,summary:null}}
     */
    static blankActivityGuidance() {
        return {
            head     : null,
            headTitle: null,
            missing  : null,
            reason   : null,
            recheck  : null,
            remaining: null,
            repair   : null,
            summary  : null
        }
    }

    /**
     * @summary Maps known activity slot keys to their product words and bounds unknown keys without
     * accepting prototype names or control characters.
     * @param {*} key
     * @returns {String}
     */
    static formatActivitySlotLabel(key) {
        if (typeof key !== 'string') return '';

        const normalized = key.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim();

        if (!normalized || RESERVED_SLOT_KEYS.has(normalized)) return '';

        return Object.hasOwn(ACTIVITY_SLOT_LABELS, normalized)
            ? ACTIVITY_SLOT_LABELS[normalized]
            : normalized.slice(0, MAX_SLOT_LABEL_LENGTH)
    }

    /**
     * @summary True when a degraded slot still contributed admitted events or reported partial observation.
     * Prefers `slot.confidence === 'observed'` and `slot.producer.coverage === 'partial'`; inspecting
     * `events[].source` is the fallback for producers (such as the A2A mailbox adapter) that do not yet
     * stamp `producer.coverage`.
     * @param {String} slotKey
     * @param {Object} slot
     * @param {Object[]} events
     * @returns {Boolean}
     */
    static slotSuppliedEvents(slotKey, slot, events) {
        if (slot?.confidence === 'observed' || slot?.producer?.coverage === 'partial') {
            return true
        }

        const rows = Array.isArray(events) ? events : [];

        if (slotKey === 'a2a') {
            return rows.some(event => event?.source === FLEET_COCKPIT_SOURCES.a2a || event?.source === 'a2a')
        }

        if (slotKey === 'pr-lane') {
            return rows.some(event => PR_LANE_EVENT_SOURCES.includes(event?.source))
        }

        return rows.some(event => event?.source === slotKey)
    }

    /**
     * @summary Derives the one partial-activity guidance object consumed by the banner, instance switcher
     * and activity stream head from the composite capability's structured `slots` — never by parsing the
     * joined reason string. Wired slots read `available` (a bounded mailbox page is available, not complete
     * history); degraded slots that still supplied events read `partial`; not-wired or empty-degraded slots
     * read `unavailable`. Missing or malformed `slots` fall back to generic wording.
     * @param {Object} [options={}]
     * @param {Object|null} [options.capability=null] The composite activity capability.
     * @param {Object[]} [options.events=[]] Admitted events for the page.
     * @param {Number} [options.intervalMs=60000] The activity cadence interval in ms.
     * @param {Boolean} [options.partial=false] Whether the page was admitted as partial.
     * @param {String|null} [options.reason=null] Caller-supplied reason override.
     * @param {Function} [options.sanitizeReason] Sanitizer for untrusted producer reasons.
     * @returns {{head:String|null,headTitle:String|null,missing:String|null,reason:String|null,recheck:String|null,remaining:String|null,repair:String|null,summary:String|null}}
     */
    static deriveActivityGuidance({
        capability     = null,
        events         = [],
        intervalMs     = DEFAULT_ACTIVITY_RECHECK_MS,
        partial        = false,
        reason         = null,
        sanitizeReason = value => (typeof value === 'string' && value.trim()) ? value.trim() : null
    } = {}) {
        if (!partial) {
            return FleetAdmission.blankActivityGuidance()
        }

        const
            seconds        = Number.isFinite(intervalMs) && intervalMs > 0 ? Math.max(1, Math.round(intervalMs / 1000)) : 60,
            recheck        = `rechecks every ${seconds} s`,
            headTitle      = `${recheck} · Recheck now is in the banner · no direct producer repair here`,
            slots          = capability?.slots,
            hasPlainSlots  = Boolean(slots) && Object.prototype.toString.call(slots) === '[object Object]',
            rawKeys        = hasPlainSlots ? Object.getOwnPropertyNames(slots) : [],
            missingParts   = [],
            remainingParts = [],
            slotReasons    = [];

        let malformed = !hasPlainSlots || rawKeys.length === 0;

        if (!malformed) {
            for (const rawKey of rawKeys) {
                const
                    slot  = slots[rawKey],
                    label = FleetAdmission.formatActivitySlotLabel(rawKey);

                if (
                    RESERVED_SLOT_KEYS.has(rawKey) ||
                    !label ||
                    !slot ||
                    Object.prototype.toString.call(slot) !== '[object Object]' ||
                    !VALID_SLOT_STATES.has(slot.state)
                ) {
                    malformed = true;
                    break
                }

                if (slot.state === 'wired') {
                    remainingParts.push(`${label} available`)
                } else {
                    const
                        key        = rawKey.trim(),
                        word       = slot.state === 'degraded' && FleetAdmission.slotSuppliedEvents(key, slot, events) ? 'partial' : 'unavailable',
                        slotReason = sanitizeReason(slot.reason);

                    missingParts.push(`${label} ${word}`);
                    slotReason && slotReasons.push(`${key}: ${slotReason}`)
                }
            }
        }

        const
            missing    = !malformed && missingParts.length > 0 ? missingParts.join(' · ') : GENERIC_PARTIAL_SUMMARY,
            remaining  = !malformed && missingParts.length > 0 && remainingParts.length > 0 ? remainingParts.join(' · ') : null,
            summary    = [missing, remaining].filter(Boolean).join(' · '),
            safeReason = sanitizeReason(reason ?? capability?.reason) ?? (slotReasons.length > 0 ? sanitizeReason(slotReasons.join('; ')) : null);

        return {
            head     : `partial — ${missing}`,
            headTitle,
            missing,
            reason   : safeReason,
            recheck,
            remaining,
            repair   : 'none',
            summary
        }
    }

    /**
     * @summary Admits an answered activity feed: the events join the provider-owned store (the first
     * answer replaces, later ones merge), the feed is bound to the answering profile, and the surface
     * reads `live`, or `partial` with the structured-slot guidance and sanitized reason. Counts retain
     * their producer scope. An observer read's A2A admission comes first ({@link AgentOS.util.ActivityObserver#admitLive}):
     * it can empty the feed, so its page replaces, and can withhold the A2A facts it did not admit.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} answer
     * @param {Object[]} answer.events The producer's bounded page
     * @param {Object|null} [answer.a2a=null] The observer read's A2A metadata
     * @param {Object|null} [answer.capability=null] The composite activity capability with `slots`
     * @param {Object[]} [answer.counts=[]] The producer's fold counts
     * @param {String|null} [answer.profileId=null] The profile the answer belongs to
     * @param {Boolean} [answer.partial=false] A usable page from an incomplete composed read
     * @param {String|null} [answer.reason=null] Sanitized reason retained for a partial read
     * @param {Object|null} [answer.selector=null] The observer selector the read sent, `null` for the mailbox
     */
    static admitActivity(owner, {a2a = null, capability = null, counts = [], events, profileId = null, partial = false, reason = null, selector = null}) {
        const
            wasWired  = Boolean(owner.activityWired) && (owner.activityProfileId === profileId || owner.activityProfileId === null),
            a2aState  = capability?.slots?.a2a?.state ?? null,
            now       = Date.now(),
            sanitize  = value => owner.toSafeDegradedReason
                ? owner.toSafeDegradedReason(value)
                : (typeof value === 'string' && value.trim() ? value.trim() : null),
            store     = owner.resolveFleetActivityEventsStore(),
            stream    = owner.getReference('activity-stream'),
            state     = partial ? 'partial' : 'live',
            answered  = {counts: Array.isArray(counts) ? counts : [], events: Array.isArray(events) ? events : []},
            admitted  = selector ? ActivityObserver.admitLive(owner, {a2a, ...answered, reason}, selector) : answered,
            guidance  = FleetAdmission.deriveActivityGuidance({
                capability,
                events        : admitted.events,
                intervalMs    : owner.component?.livenessCadence?.activity,
                partial,
                reason,
                sanitizeReason: sanitize
            });

        store.ingestSnapshot(admitted.events, {replace: !owner.activityWired});
        owner.activityWired     = true;
        owner.activityProfileId = profileId;

        if (wasWired) {
            FleetAdmission.recordOutageRecovery(owner, 'stream', {now, profileId})
        }
        if (a2aState === 'wired') {
            if (owner.a2aWiredProfileId === profileId) {
                FleetAdmission.recordOutageRecovery(owner, 'a2a', {now, profileId})
            }
            owner.a2aWiredProfileId = profileId
        } else if (a2aState === 'degraded' && owner.a2aWiredProfileId === profileId) {
            FleetAdmission.recordOutageStart(owner, 'a2a', {
                now,
                profileId,
                reason: sanitize(capability?.slots?.a2a?.reason ?? reason) || 'plane mailbox degraded'
            })
        }

        owner.publishConnection('stream', {data: {
            activityCounts      : admitted.counts,
            activityGuidance    : guidance,
            streamAdapterState  : state,
            streamDegradedReason: partial ? guidance.reason : null
        }});
        stream && (typeof stream.set === 'function' ? stream.set({adapterState: state, guidance}) : (stream.adapterState = state, stream.guidance = guidance))
    }

    /**
     * @summary Admits an older page of the activity feed below the live window. The events merge into
     * the provider-owned store and never replace it, and the page must belong to the profile the store
     * holds: a late page from before a profile switch is dropped. The feed's state and counts are the
     * live read's, so a history page publishes neither. The stream learns the page's ids before they
     * land, so older rows never count as new events or reach the announcer.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} answer
     * @param {Object[]} answer.events The producer's older page
     * @param {String|null} [answer.profileId=null] The profile the page belongs to
     * @returns {Object|null} The store's ingest result, or `null` when the page was dropped
     */
    static admitActivityHistory(owner, {events, profileId = null}) {
        const
            store = owner.resolveFleetActivityEventsStore(),
            rows  = Array.isArray(events) ? events : [];

        if (!store || !owner.activityWired || owner.activityProfileId !== profileId) {
            return null
        }

        owner.getReference('activity-stream')?.acceptHistory(rows.map(event => event.eventId));

        return store.ingestSnapshot(rows)
    }

    /**
     * @summary Selects usable producer facts from a partial page. Failure diagnostics are not work;
     * an unrecognized or malformed remaining row refuses the page instead of manufacturing activity.
     * Store admission still validates identity uniqueness before changing retained records.
     * @param {*} events The composed producer page
     * @returns {Object[]} Valid activity rows, or an empty array when none can be admitted
     */
    static partialActivityEvents(events) {
        if (!Array.isArray(events)) return [];
        const rows = events.filter(event => event?.type !== 'source-degraded');
        return rows.every(event =>
            typeof event?.eventId === 'string' && event.eventId.trim() &&
            FLEET_COCKPIT_EVENT_TYPES.includes(event.type) &&
            Object.values(FLEET_COCKPIT_SOURCES).includes(event.source) &&
            ['observed', 'inferred'].includes(event.confidence) &&
            typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt))
        ) ? rows : []
    }

    /**
     * @summary Admits an answered roster over record-shaped rows (the DTO already mapped): the first
     * answer replaces the store's rows and re-seats the selection, later ones reconcile; the roster is
     * bound to the answering profile; the surface reads `live` with the presence envelope; the
     * roster-derived consumers re-snapshot; and the construction-time misses recover — the operator's
     * identity posture, a resident CatchUp's first read and the Golden Path read.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object} answer
     * @param {Object[]} answer.rows Record-shaped rows
     * @param {Object|null} [answer.capabilities=null] The assembler's capabilities envelope
     * @param {String|null} [answer.profileId=null] The profile the answer belongs to
     */
    static admitRoster(owner, {capabilities = null, profileId = null, rows}) {
        const
            wasWired      = Boolean(owner.rosterWired) && (owner.rosterProfileId === profileId || owner.rosterProfileId === null),
            presenceState = capabilities?.presence?.state ?? null,
            store         = owner.resolveFleetRosterStore(),
            grid          = owner.getReference('fleet-grid'),
            cockpit       = owner.component,
            provider      = cockpit.getStateProvider();

        owner.lastLiveRows    = rows;
        owner.rosterProfileId = profileId;
        // the detail panes that read the roster row (the repository pane) observe at this admission:
        // stamped BEFORE the reconcile, so a re-seat it causes carries the clock in the same write
        owner.rosterObservedAt = Date.now();

        if (owner.rosterWired) {
            owner.reconcileRoster(store, rows)
        } else {
            store.clear();
            rows.length > 0 && store.add(rows);
            owner.rosterWired = true;
            // the first live snapshot replaces what the store holds wholesale — re-seat or clear a
            // selection made against a now-removed record
            owner.reconcileSelection()
        }

        if (wasWired) {
            FleetAdmission.recordOutageRecovery(owner, 'grid', {now: owner.rosterObservedAt, profileId})
        }
        if (presenceState === 'wired') {
            if (owner.presenceWiredProfileId === profileId) {
                FleetAdmission.recordOutageRecovery(owner, 'presence', {now: owner.rosterObservedAt, profileId})
            }
            owner.presenceWiredProfileId = profileId
        } else if (presenceState === 'degraded' && owner.presenceWiredProfileId === profileId) {
            FleetAdmission.recordOutageStart(owner, 'presence', {
                now   : owner.rosterObservedAt,
                profileId,
                reason: owner.toSafeDegradedReason?.(capabilities?.presence?.reason) || 'plane presence degraded'
            })
        }

        owner.publishConnection('grid', {data: {
            gridAdapterState  : 'live',
            gridDegradedReason: null,
            // the presence-capability envelope rides every admitted snapshot; absent or
            // malformed envelopes plumb null — the chip claims nothing
            presenceCapability: capabilities?.presence ?? null
        }});
        grid && (grid.adapterState = 'live');

        // an admission that re-seated the selection already carried the clock with the record;
        // an unchanged record gets the clock alone, so its repository pane re-ages in place
        const pane = cockpit.getAgentDetailPane?.();

        pane && pane.rosterObservedAt !== owner.rosterObservedAt && pane.set({rosterObservedAt: owner.rosterObservedAt});

        TargetBinding.refreshRosterConsumers(owner);

        if (owner.operatorRecord) {
            owner.operatorIdentityPosture = owner.deriveOperatorIdentityPosture(owner.operatorRecord.agentIdentityNodeId);
            cockpit.getOperatorMailboxPane()?.set({identityPosture: owner.operatorIdentityPosture})
        }

        // a resident CatchUp can emit its construction-time request BEFORE the bridge wires;
        // that one-shot miss recovers the moment the bridge answers, through the pane's own
        // guarded refresh path
        owner.catchUpSnapshot?.capability?.state === 'unavailable' && cockpit.getCatchUpPane()?.onRefreshClick();
        // the Golden Path and graph scene reads have the same construction-time miss; each leaf is the
        // owner's own truth
        provider?.getData('goldenPathEnvelope.capability.state') === 'unavailable' && owner.loadGoldenPath();
        provider?.getData('graphSceneEnvelope.capability.state') === 'unavailable' && owner.loadGraphScene()
    }
}

export default Neo.setupClass(FleetAdmission);
