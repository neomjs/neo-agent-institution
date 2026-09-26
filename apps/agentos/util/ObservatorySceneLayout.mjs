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
    looseDrop  : 0.4,
    looseRadius: 0.5,
    outerRadius: 0.55,
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

    /**
     * @summary The scene of a bounded `fleetGraphScene` read: the route's seeds on the helix in route
     * order, every other node around the seeds nearest to it, and only the feed's own edges.
     *
     * Positions depend only on the ids, the route order and the edges, so two reads of one snapshot, or
     * the same rows in any order, lay out identically and a selected id keeps its node (`index`). A node's
     * `hop` is its distance to the nearest seed and its anchors are every seed at that distance: one
     * anchor rings it around that seed (`cluster`), inner ring at one hop, outer ring beyond; several
     * ring it around their mean, lifted clear of the helix; a node no seed reaches rings below the helix.
     * A seed sits in its route slot and carries its route position as `rank`, a cue beside the graph: no
     * line joins seeds unless the feed has that edge. A seed the budget cut leaves its slot empty, an edge
     * with an absent endpoint is dropped, and a missing relation type stays `null`. `unavailable` or a read without a scene draws
     * nothing; `degraded` draws what the read holds; `completeness` says whether a budget cut it.
     * @param {Object|null} envelope The landed `fleetGraphScene` envelope.
     * @returns {Object} `{currency, empty, nodes, edges, edgeTypes, seeds, index, completeness, snapshotId}`:
     *     `nodes[]` = `{id, kind, label, rank, hop, cluster, x, y, z}`, the seeds first in route order, then
     *     by id; `edges[]` pairs index into `nodes`, `edgeTypes[]` aligned; `seeds[]` indexes the seeds.
     */
    static fromGraphScene(envelope) {
        const
            currency   = envelope?.capability?.state ?? 'unobserved',
            scene      = envelope?.scene ?? null,
            snapshotId = envelope?.snapshotId ?? null,
            byId       = new Map();

        if (currency === 'unavailable' || !Array.isArray(scene?.nodes)) {
            return {currency, empty: true, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}, completeness: scene?.completeness ?? null, snapshotId}
        }

        scene.nodes.forEach(node => {
            typeof node?.id === 'string' && !byId.has(node.id) && byId.set(node.id, node)
        });

        const
            {helixHeight, helixRadius, helixTurn, looseDrop, looseRadius, outerRadius, ringDrop, ringRadius, sharedLift} = GEOMETRY,
            compare   = (a, b) => a < b ? -1 : a > b ? 1 : 0,
            routeAt   = new Map();

        (Array.isArray(scene.route) ? scene.route : []).forEach(id => routeAt.has(id) || routeAt.set(id, routeAt.size));

        const
            seeds     = [...routeAt.keys()].filter(id => byId.has(id)),
            adjacency = new Map([...byId.keys()].map(id => [id, new Set()])),
            links     = new Map(),
            hops      = new Map(seeds.map(id => [id, 0])),
            anchors   = new Map(seeds.map(id => [id, [id]]));

        (Array.isArray(scene.edges) ? scene.edges : []).forEach(edge => {
            const {from, to} = edge ?? {}, type = edge?.type ?? null;

            if (byId.has(from) && byId.has(to)) {
                adjacency.get(from).add(to);
                adjacency.get(to).add(from);
                links.set(JSON.stringify([from, to, type]), {from, to, type})
            }
        });

        // Breadth-first from all seeds at once. A node's hop is its distance and its anchors the union of
        // its nearer neighbours' anchors, sorted into route order, so neither depends on row order.
        for (let frontier = seeds, hop = 1; frontier.length; hop++) {
            const next = new Set();

            frontier.forEach(id => adjacency.get(id).forEach(neighbour => {
                if (!hops.has(neighbour)) {
                    hops.set(neighbour, hop);
                    anchors.set(neighbour, []);
                    next.add(neighbour)
                }
                if (hops.get(neighbour) === hop) {
                    const own = anchors.get(neighbour);

                    anchors.get(id).forEach(seed => own.includes(seed) || own.push(seed))
                }
            }));

            next.forEach(id => anchors.get(id).sort((a, b) => routeAt.get(a) - routeAt.get(b)));
            frontier = [...next]
        }

        const
            others  = [...byId.keys()].filter(id => !routeAt.has(id)).sort(compare),
            order   = [...seeds, ...others],
            index   = Object.fromEntries(order.map((id, position) => [id, position])),
            angleOf = position => position * helixTurn * Math.PI * 2,
            // a seed keeps its route slot, so a seed the budget cut leaves a gap, not a shifted helix
            seedAt  = new Map(seeds.map(id => {
                const slot = routeAt.get(id), step = routeAt.size > 1 ? slot / (routeAt.size - 1) : 0.5;

                return [id, {x: helixRadius * Math.cos(angleOf(slot)), y: helixHeight / 2 - step * helixHeight, z: helixRadius * Math.sin(angleOf(slot))}]
            })),
            // one ring per anchor set and depth (inner, outer); the nodes no seed reaches share one
            ringOf  = id => hops.has(id) ? `${anchors.get(id).join('\u0000')}\u0000${Math.min(hops.get(id), 2)}` : '',
            rings   = new Map();

        others.forEach(id => {
            rings.has(ringOf(id)) || rings.set(ringOf(id), []);
            rings.get(ringOf(id)).push(id)
        });

        const nodes = order.map(id => {
            const
                node   = byId.get(id),
                hop    = hops.get(id) ?? null,
                own    = anchors.get(id) ?? [],
                ring   = rings.get(ringOf(id)),
                turn   = ring ? ring.indexOf(id) / ring.length * Math.PI * 2 : 0;
            let position;

            if (hop === 0) {
                position = seedAt.get(id)
            } else if (hop === null) {
                position = {x: looseRadius * Math.cos(turn), y: -helixHeight / 2 - looseDrop, z: looseRadius * Math.sin(turn)}
            } else {
                const
                    mean   = axis => own.reduce((sum, seed) => sum + seedAt.get(seed)[axis], 0) / own.length,
                    lift   = own.length > 1 ? 1 + sharedLift / (Math.hypot(mean('x'), mean('z')) || 1) : 1,
                    x      = mean('x') * lift,
                    z      = mean('z') * lift,
                    radius = hop === 1 ? ringRadius : outerRadius,
                    phi    = Math.atan2(z, x) + turn;

                position = {x: x + radius * Math.cos(phi), y: mean('y') - ringDrop * Math.min(hop, 2), z: z + radius * Math.sin(phi)}
            }

            return {
                id,
                kind   : node.kind ?? null,
                label  : node.label ?? null,
                rank   : hop === 0 ? routeAt.get(id) + 1 : null,
                hop,
                cluster: own.length === 1 ? own[0] : null,
                ...position
            }
        });

        const edges = [...links.values()]
            .map(link => ({pair: [index[link.from], index[link.to]], type: link.type}))
            .sort((a, b) => a.pair[0] - b.pair[0] || a.pair[1] - b.pair[1] || compare(JSON.stringify(a.type), JSON.stringify(b.type)));

        return {
            currency,
            empty       : nodes.length === 0,
            nodes,
            edges       : edges.map(edge => edge.pair),
            edgeTypes   : edges.map(edge => edge.type),
            seeds       : seeds.map((id, position) => position),
            index,
            completeness: scene.completeness ?? null,
            snapshotId
        }
    }
}

export default Neo.setupClass(ObservatorySceneLayout);
export {GEOMETRY};
