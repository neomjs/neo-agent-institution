import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/ObservatorySceneLayout
 * @summary Pure scene builder for the observatory pane: derives the scene a canvas-worker renderer
 * draws — nodes with unit-space positions, edges as node index pairs — from the landed
 * `fleetGraphScene` envelope ({@link AgentOS.util.GraphSceneEnvelope}), the bounded graph
 * neighbourhood of the Golden Path route. The feed carries no coordinates, so positions are the only
 * derived facts: nothing here ranks, merges or caches, and the same read yields the same scene on
 * every run.
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
     * with an absent endpoint is dropped, and a missing relation type stays `null`. `unavailable` or a
     * read without a scene draws nothing; `degraded` draws what the read holds; `completeness` says
     * whether a budget cut it.
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
