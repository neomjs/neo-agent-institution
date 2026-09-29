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
    // the Golden Path route's admission, as the producer wrote it; the capability is the graph read's own
    admission : {admitted: null, fallback: null, reasonCode: null, requiredFacets: [], staleFacets: []},
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
     * @summary The landed leaf as plain data. The provider hands its tracking proxy, and a projection through
     * the closed shape reads it without copying the scene's lists.
     * @param {Object|null} envelope
     * @returns {Object|null}
     */
    static plain(envelope) {
        return envelope ? ClosedShape.project(envelope, SHAPE) : null
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
     *
     * The counts are what the pane drew, when it passes them: a node without an id, an edge whose ends are not
     * both nodes of the read, or a repeated edge is not drawn, and the line says how many of the read's own
     * were not. What the pane chose to hide is named as such (mail nodes hidden, halo nodes hidden) and a
     * drawn halo says how many it holds, so "not drawn" is left to what the read carried and the pane could
     * not draw. Without `drawn` it counts the read.
     * @param {Object|null} envelope A landed envelope.
     * @param {Function} [formatStamp] `(isoString) → String|null`
     * @param {Object|null} [drawn=null] `{nodes, edges, halo, hidden}`: what the pane drew from this read, the
     *     nodes of it in the halo, and `hidden` as {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene}
     *     counts it (`{mail: {nodes, edges}, halo: {nodes, edges}}`)
     * @returns {{currency: String, text: String}}
     */
    static describe(envelope, formatStamp = at => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')}Z`, drawn = null) {
        const
            currency = envelope?.capability?.state ?? 'unobserved',
            reason   = envelope?.capability?.reason ?? null,
            scene    = envelope?.scene,
            at       = envelope?.capturedAt,
            stamp    = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? formatStamp(at) : null,
            plural   = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`,
            read     = {nodes: scene?.nodes?.length ?? 0, edges: scene?.edges?.length ?? 0},
            {edges, halo = 0, hidden = null, nodes} = drawn ?? read,
            mail     = hidden?.mail ?? {nodes: 0, edges: 0},
            haloed   = hidden?.halo ?? {nodes: 0, edges: 0},
            chosen   = [
                mail.nodes   > 0 && `${plural(mail.nodes, 'mail node')} hidden`,
                halo         > 0 && `${halo} in the halo`,
                haloed.nodes > 0 && `${plural(haloed.nodes, 'halo node')} hidden`
            ].filter(Boolean),
            unseen   = [[read.nodes - nodes - mail.nodes - haloed.nodes, 'node'], [read.edges - edges - mail.edges - haloed.edges, 'edge']].filter(([count]) => count > 0).map(([count, word]) => `${plural(count, word)} not drawn`),
            holds    = read.nodes ? [`${plural(nodes, 'node')} · ${plural(edges, 'edge')}`, ...chosen, ...unseen].join(' · ') : null,
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
     * @summary The scene's id for a Golden Path route item, or `null` when the read holds no node for it. The
     * route names an item by the graph's own id (`issue-9853`) and the scene qualifies it with its origin
     * (`neomjs/neo#issue-9853`); only the read's seeds — ids in its route list whose node it holds — are
     * candidates, since a budget cut can keep a seed in the route and drop its node. An id that is already
     * qualified matches itself; a bare id resolves only when one origin holds it, because the route item
     * carries no origin to choose between two.
     * @param {Object|null} envelope A landed envelope.
     * @param {String} routeItemId
     * @returns {String|null}
     */
    static resolveRouteId(envelope, routeItemId) {
        const {nodes, route} = envelope?.scene ?? {};

        if (typeof routeItemId !== 'string' || !routeItemId || !Array.isArray(route) || !Array.isArray(nodes)) {
            return null
        }

        const
            held  = new Set(nodes.map(node => node?.id)),
            seeds = route.filter(id => held.has(id)),
            bare  = seeds.filter(id => id.endsWith(`#${routeItemId}`));

        return seeds.includes(routeItemId) ? routeItemId : bare.length === 1 ? bare[0] : null
    }
}

export default Neo.setupClass(GraphSceneEnvelope);
