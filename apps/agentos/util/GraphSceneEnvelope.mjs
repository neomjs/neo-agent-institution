import Base        from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import ClosedShape from './ClosedShape.mjs';

/**
 * @module apps/agentos/util/GraphSceneEnvelope
 * @summary The cockpit's reading of the `fleetGraphScene` envelope, the Brain's bounded neighbourhood
 * around the Golden Path's route: the closed shape of the provider's `graphSceneEnvelope` leaf
 * ({@link AgentOS.util.ClosedShape} says why it is closed), the landing every read passes through, and
 * the line the Observatory shows above the scene.
 *
 * The line says what the read can stand behind and nothing more: the capability word, the capture
 * instant, what the scene holds, and whether a budget cut it. The feed carries no total and no
 * continuation, so the line implies neither.
 */

/**
 * The declared shape of the Brain's `fleetGraphScene` wire: `null` marks a leaf, `[]` an atomic list,
 * and an object a block.
 * @type {Object}
 */
const SHAPE = {
    capability: {state: null, reason: null},
    scene     : {
        route       : [],
        nodes       : [],
        edges       : [],
        counts      : {nodes: null, edges: null, seeds: null},
        budget      : {maxNodes: null, maxEdges: null, maxBytes: null},
        completeness: null
    },
    snapshotId: null,
    capturedAt: null
};

/**
 * Static landing and description for the graph scene envelope.
 * @class AgentOS.util.GraphSceneEnvelope
 * @extends Neo.core.Base
 */
class GraphSceneEnvelope extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.GraphSceneEnvelope'
         * @protected
         */
        className: 'AgentOS.util.GraphSceneEnvelope'
    }

    /**
     * @summary The leaf's declaration: every key present, nothing observed.
     * @returns {Object}
     */
    static blank() {
        return ClosedShape.project(null, SHAPE)
    }

    /**
     * @summary Lands one wire envelope in the closed shape. An answer without a capability state is
     * malformed, and it lands as unavailable, not as unobserved.
     * @param {Object|null} wire
     * @returns {Object}
     */
    static fromWire(wire) {
        const envelope = ClosedShape.project(wire, SHAPE);

        if (envelope.capability.state === null) {
            envelope.capability.state = 'unavailable';
            envelope.capability.reason ??= 'fleet graph scene answer carried no capability'
        }

        return envelope
    }

    /**
     * @summary The line above the scene: the capability word, then the producer's reason, or the
     * capture instant, what the scene holds and its completeness. A budget cut reads as partial and names
     * the budget; a complete read says complete. The instant goes through `formatStamp` (the pane passes
     * the viewer's clock; the default is the UTC minute) and is left out when unparseable.
     * @param {Object|null} envelope A landed envelope.
     * @param {Function} [formatStamp] `(isoString) → String|null`
     * @returns {{currency: String, text: String}}
     */
    static describe(envelope, formatStamp = at => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')}Z`) {
        const
            currency = envelope?.capability?.state ?? 'unobserved',
            reason   = envelope?.capability?.reason ?? null,
            scene    = envelope?.scene,
            at       = envelope?.capturedAt,
            stamp    = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? formatStamp(at) : null,
            plural   = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`,
            holds    = scene?.nodes?.length ? `${plural(scene.nodes.length, 'node')} · ${plural(scene.edges?.length ?? 0, 'edge')}` : null,
            budget   = scene?.budget,
            cut      = scene?.completeness === 'truncated'
                ? `partial, budget ${budget?.maxNodes ?? '?'} nodes / ${budget?.maxEdges ?? '?'} edges / ${budget?.maxBytes ? `${Math.round(budget.maxBytes / 1024)} KiB` : '?'}`
                : scene?.completeness === 'complete' ? 'complete' : null,
            parts    = {
                unobserved : () => ['Unobserved'],
                unavailable: () => ['Unavailable', reason],
                degraded   : () => ['Degraded', reason, holds, holds && cut],
                current    : () => ['Current', stamp && `captured ${stamp}`, holds ?? 'no nodes', cut]
            }[currency]?.() ?? [currency, reason];

        return {currency, text: parts.filter(Boolean).join(' · ')}
    }

    /**
     * @summary The scene's id for a Golden Path route item, or `null` when the read's route does not list it.
     * The route names an item by the graph's own id (`issue-9853`) and the scene qualifies it with its origin
     * (`neomjs/neo#issue-9853`); the scene's own route list carries the qualified form, so the match needs no
     * origin of its own. An id that is already qualified matches itself; of two origins sharing one bare id,
     * the first in route order wins.
     * @param {Object|null} envelope A landed envelope.
     * @param {String} routeItemId
     * @returns {String|null}
     */
    static resolveRouteId(envelope, routeItemId) {
        const route = envelope?.scene?.route;

        if (typeof routeItemId !== 'string' || !routeItemId || !Array.isArray(route)) {
            return null
        }

        return route.find(id => id === routeItemId || id.endsWith(`#${routeItemId}`)) ?? null
    }
}

export default Neo.setupClass(GraphSceneEnvelope);
