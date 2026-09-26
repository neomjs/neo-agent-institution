import Base               from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import GoldenPathEnvelope from './GoldenPathEnvelope.mjs';

/**
 * @module apps/agentos/util/ObservatorySceneLayout
 * @summary Pure scene builder for the observatory pane: declares the scene a canvas-worker renderer
 * draws — nodes with unit-space positions, edges and the route as node indices — and derives the first
 * slice's only scene from the landed `fleetGoldenPath` envelope ({@link AgentOS.util.GoldenPathEnvelope}).
 * The route's items sit on a helix by rank (rank 1 at the top), each item's citations on a ring around
 * it, and a citation several items share is placed once between them with an edge to each. Nothing
 * here ranks, merges or caches: positions are the only derived facts, and the same envelope yields the
 * same scene on every run. A Brain scene feed lands in the same shape and replaces this derivation,
 * never the renderer.
 *
 * The currency is the cockpit's one reading: a `current` route is drawn in the signal, a `withheld`
 * one — the last known good route — dim; `degraded`, `unavailable` and `unobserved` yield an empty
 * scene, and the currency line above the canvas says why.
 */

/**
 * Geometry of the scene in unit space; the camera orbits the origin a few units out.
 * @type {Object}
 */
const GEOMETRY = {
    helixHeight: 1.6,
    helixRadius: 1,
    helixTurn  : 0.36,
    ringDrop   : 0.14,
    ringRadius : 0.3,
    sharedLift : 0.22
};

/**
 * Static observatory scene utilities.
 * @class AgentOS.util.ObservatorySceneLayout
 * @extends Neo.core.Base
 */
class ObservatorySceneLayout extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.ObservatorySceneLayout'
         * @protected
         */
        className: 'AgentOS.util.ObservatorySceneLayout'
    }

    /**
     * @summary An empty scene for a currency that draws nothing.
     * @param {String} currency
     * @returns {{currency: String, empty: Boolean, nodes: Object[], edges: Number[][], route: Number[]}}
     */
    static empty(currency) {
        return {currency, empty: true, nodes: [], edges: [], route: []}
    }

    /**
     * @summary The scene of the landed Golden Path envelope.
     *
     * Items sit on a helix in rank order — rank 1 at the top, each next item a fixed fraction of a
     * turn further round and a step lower — weighted between nothing and one by the producer's score
     * against the route's best; a missing score weighs nothing. Citations sit on a ring around the
     * item citing them (label order, the ring starting at the item's own angle), and a citation
     * several items share is placed once at their mean, lifted outward so it clears the helix. Edges
     * run from each item to each of its citations; the route lists the items in rank order. Node and
     * edge order is deterministic (rank, then id). Only a current or withheld route is drawn.
     *
     * @param {Object|null} envelope The landed envelope.
     * @returns {{currency: String, empty: Boolean, nodes: Object[], edges: Number[][], route: Number[]}}
     *     `nodes[]` = `{id, kind: 'item'|'citation', label, rank, score, weight, x, y, z}`; `edges[]` pairs
     *     and `route[]` index into `nodes`.
     */
    static fromGoldenPath(envelope) {
        const
            currency = GoldenPathEnvelope.currency(envelope),
            route    = GoldenPathEnvelope.routeOf(envelope),
            drawn    = currency === 'current' || currency === 'withheld',
            items    = !drawn || route.kind === 'none'
                ? []
                : [...(Array.isArray(route.items) ? route.items : [])]
                    .filter(item => item && typeof item.id === 'string')
                    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || String(a.id).localeCompare(String(b.id)));

        if (!items.length) {
            return ObservatorySceneLayout.empty(currency)
        }

        const
            {helixHeight, helixRadius, helixTurn, ringDrop, ringRadius, sharedLift} = GEOMETRY,
            scores    = items.map(item => typeof item.score === 'number' ? item.score : null).filter(score => score !== null),
            bestScore = scores.length ? Math.max(...scores) : null,
            angleOf   = index => index * helixTurn * Math.PI * 2,
            nodes     = items.map((item, index) => {
                const
                    score = typeof item.score === 'number' ? item.score : null,
                    step  = items.length > 1 ? index / (items.length - 1) : 0.5,
                    angle = angleOf(index);

                return {
                    id    : item.id,
                    kind  : 'item',
                    label : item.title,
                    // the producer's rank or nothing — a position is not a rank
                    rank  : Number.isInteger(item.rank) ? item.rank : null,
                    score,
                    weight: score === null || !bestScore || bestScore <= 0 ? 0 : Math.max(0, Math.min(1, score / bestScore)),
                    x     : helixRadius * Math.cos(angle),
                    y     : helixHeight / 2 - step * helixHeight,
                    z     : helixRadius * Math.sin(angle)
                }
            }),
            citedBy   = new Map();

        // one citation node per distinct label; remember which items cite it, in rank order
        items.forEach((item, index) => {
            (Array.isArray(item.citations) ? item.citations : []).forEach(citation => {
                const id = GoldenPathEnvelope.citationLabel(citation);

                if (id) {
                    citedBy.has(id) || citedBy.set(id, []);
                    citedBy.get(id).includes(index) || citedBy.get(id).push(index)
                }
            })
        });

        const
            citationIds = [...citedBy.keys()].sort(),
            edges       = [],
            ownOf       = index => citationIds.filter(id => citedBy.get(id).length === 1 && citedBy.get(id)[0] === index);

        citationIds.forEach(id => {
            const indices = citedBy.get(id);
            let position;

            if (indices.length === 1) {
                const
                    index = indices[0],
                    own   = ownOf(index),
                    phi   = angleOf(index) + own.indexOf(id) / own.length * Math.PI * 2,
                    item  = nodes[index];

                position = {x: item.x + ringRadius * Math.cos(phi), y: item.y - ringDrop, z: item.z + ringRadius * Math.sin(phi)}
            } else {
                const
                    mean = ['x', 'y', 'z'].map(axis => indices.reduce((sum, index) => sum + nodes[index][axis], 0) / indices.length),
                    lift = 1 + sharedLift / (Math.hypot(mean[0], mean[2]) || 1);

                position = {x: mean[0] * lift, y: mean[1], z: mean[2] * lift}
            }

            indices.forEach(index => edges.push([index, nodes.length]));
            nodes.push({id, kind: 'citation', label: id, rank: null, score: null, weight: 0, ...position})
        });

        return {currency, empty: false, nodes, edges, route: items.map((item, index) => index)}
    }
}

export default Neo.setupClass(ObservatorySceneLayout);
export {GEOMETRY};
