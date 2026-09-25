import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/GoldenPathEnvelope
 * @summary The cockpit's one reading of the `fleetGoldenPath` envelope, shared by every Golden Path
 * pane: the closed shape of the provider's `goldenPathEnvelope` leaf, the landing every read passes
 * through, and the currency derived from the producer's words.
 *
 * The shape is closed because `setData` drills object values into leaf paths. A block written as
 * `null` stops the ancestor rebuild for every later write beneath it, and a key that an envelope omits
 * keeps the previous envelope's value. So a landed envelope carries every declared key: an absent
 * block lands as its blank, an absent leaf as `null`, and an absent list as `[]`.
 */

/**
 * The declared shape of the Brain's `fleetGoldenPath` wire: `null` marks a leaf, `[]` an atomic list, and
 * an object a block.
 * @type {Object}
 */
const SHAPE = {
    capability: {state: null, capturedAt: null, reason: null},
    admission : {admitted: null, fallback: null, reasonCode: null, requiredFacets: [], staleFacets: []},
    route     : {
        schemaVersion: null,
        status       : null,
        capturedAt   : null,
        expiresAt    : null,
        expired      : null,
        routeVersion : null,
        kind         : null,
        freshness    : {status: null, checkedAt: null, expiresAt: null},
        provenance   : {producer: null, runId: null, algorithmVersion: null},
        items        : []
    },
    rem    : {undigested: null, digested: null, recentCycles: null},
    sources: {
        admission: {state: null, reason: null},
        rem      : {state: null, reason: null, detail: null},
        route    : {state: null, reason: null, detail: null}
    }
};

/**
 * Projects one wire block onto its declared shape. A leaf keeps a string, a finite number or a
 * boolean, a list keeps an array (items stay exactly as written), and anything else lands as the blank.
 * @param {*} block
 * @param {Object} shape
 * @returns {Object}
 */
const project = (block, shape) => Object.fromEntries(Object.entries(shape).map(([key, blank]) => {
    const value = block?.[key];

    if (Array.isArray(blank)) return [key, Array.isArray(value) ? value : []];
    if (blank)                return [key, project(value && typeof value === 'object' ? value : null, blank)];

    return [key, typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value) ? value : null]
}));

/**
 * Static landing and derivation for the Golden Path envelope.
 * @class AgentOS.util.GoldenPathEnvelope
 * @extends Neo.core.Base
 */
class GoldenPathEnvelope extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.GoldenPathEnvelope'
         * @protected
         */
        className: 'AgentOS.util.GoldenPathEnvelope'
    }

    /**
     * @summary The leaf's declaration: every key present, nothing observed.
     * @returns {Object}
     */
    static blank() {
        return project(null, SHAPE)
    }

    /**
     * @summary Lands one wire envelope in the closed shape. An answer without a capability state is
     * malformed, and it lands as unavailable, not as unobserved.
     * @param {Object|null} wire
     * @returns {Object}
     */
    static fromWire(wire) {
        const envelope = project(wire, SHAPE);

        if (envelope.capability.state === null) {
            envelope.capability.state = 'unavailable';
            envelope.capability.reason ??= 'fleet golden path answer carried no capability'
        }

        return envelope
    }

    /**
     * @summary The route block when the producer wrote one. A validated route always names its status,
     * so a blank route is no route.
     * @param {Object|null} envelope
     * @returns {Object|null}
     */
    static routeOf(envelope) {
        const route = envelope?.route;

        return typeof route?.status === 'string' ? route : null
    }

    /**
     * @summary The REM counts when at least one of them arrived.
     * @param {Object|null} envelope
     * @returns {Object|null}
     */
    static remOf(envelope) {
        const rem = envelope?.rem;

        return rem && [rem.undigested, rem.digested, rem.recentCycles].some(Number.isInteger) ? rem : null
    }

    /**
     * @summary Resolves the currency from the producer's own words, read in a fixed order: the source's
     * capability, the corpus-projection admission, then the route's own status and expiry. A route is
     * `current` only when all of them say so.
     * - `unobserved`: nothing has landed yet.
     * - `unavailable`: the source is not wired, or its read failed.
     * - `degraded`: the source answered, but its route file is missing, unreadable or invalid.
     * - `withheld`: a route exists but is not current. It is shown as the last known good route, which
     *   is the admission contract's fallback.
     * - `current`: the admission admits the route, the route is `fresh`, and it has not expired.
     * @param {Object|null} envelope
     * @returns {'unobserved'|'unavailable'|'degraded'|'withheld'|'current'}
     */
    static currency(envelope) {
        const state = envelope?.capability?.state ?? null;

        if (state === null)       return 'unobserved';
        if (state === 'degraded') return 'degraded';
        if (state !== 'wired')    return 'unavailable';

        const route = GoldenPathEnvelope.routeOf(envelope);

        if (!route) return 'degraded';

        return envelope.admission?.admitted === true && route.status === 'fresh' && route.expired !== true ? 'current' : 'withheld'
    }

    /**
     * @summary The producer's reason a route is withheld: the admission's reason code first, then the
     * route's own expiry or status.
     * @param {Object} envelope
     * @returns {String}
     */
    static withheldReason({admission, route} = {}) {
        if (admission?.admitted !== true) return admission?.reasonCode || 'admission-unavailable';
        if (route?.expired === true)      return 'route-expired';

        return `route-${route?.status || 'unknown'}`
    }

    /**
     * @summary Labels one opaque route citation as the producer wrote it: a string as-is, an object by
     * its `id` or `ref`. Anything else has no label and is left out rather than dumped.
     * @param {*} citation
     * @returns {String|null}
     */
    static citationLabel(citation) {
        if (typeof citation === 'string') return citation || null;

        const label = citation?.id ?? citation?.ref;

        return typeof label === 'string' && label ? label : null
    }
}

export default Neo.setupClass(GoldenPathEnvelope);
