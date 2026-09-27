import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/ObservatorySceneLayout
 * @summary Pure scene builder for the observatory pane: derives the scene a canvas-worker renderer
 * draws — nodes with a community and unit-space positions, edges as node index pairs — from the landed
 * `fleetGraphScene` envelope ({@link AgentOS.util.GraphSceneEnvelope}). The feed carries neither communities
 * nor coordinates, so those are the only derived facts: nothing here ranks, merges or caches, and the same
 * read yields the same scene on every run.
 */

/**
 * Geometry of the scene in unit space; the camera orbits the origin a few units out. Community centres lie on
 * a sphere of `radius`. The largest community fills a ball of at most `spread`, less when many communities
 * share the sphere, and a smaller one shrinks with the cube root of its share, down to `minSpread`.
 * @type {Object}
 */
const GEOMETRY = {minSpread: 0.05, radius: 1, spread: 0.32};

/**
 * Bounds of the community search: the levels it aggregates and the passes a level makes. A clustered graph
 * settles in a few of each, so the caps only bound a pathological read.
 * @type {Object}
 */
const SEARCH = {levels: 12, passes: 24};

/**
 * @summary One level of modularity local moving: each node, in order, joins the neighbouring community that
 * gains the most modularity, staying on a tie with its own and preferring the smaller index on any other tie,
 * until a pass moves nothing. Weights are integer sums, so the arithmetic is exact and the result depends on
 * the nodes' order and the graph alone.
 * @param {Object} graph `{count, offsets, targets, weights, selfWeights}`, weighted compressed rows
 * @returns {{moved: Boolean, community: Uint32Array, communities: Number}}
 */
function moveLocally({count, offsets, targets, weights, selfWeights}) {
    const
        degree    = new Float64Array(count),
        total     = new Float64Array(count),
        community = Uint32Array.from({length: count}, (item, node) => node),
        linkTo    = new Float64Array(count),
        touched   = [];
    let moved = false, twiceM = 0;

    for (let node = 0; node < count; node++) {
        let sum = 2 * selfWeights[node];

        for (let k = offsets[node]; k < offsets[node + 1]; k++) {
            sum += weights[k]
        }

        degree[node] = total[node] = sum;
        twiceM += sum
    }

    for (let pass = 0; twiceM && pass < SEARCH.passes; pass++) {
        let changes = 0;

        for (let node = 0; node < count; node++) {
            const own = community[node], share = degree[node] / twiceM;

            for (let k = offsets[node]; k < offsets[node + 1]; k++) {
                const target = community[targets[k]];

                linkTo[target] === 0 && touched.push(target);
                linkTo[target] += weights[k]
            }

            total[own] -= degree[node];

            let best = own, bestGain = linkTo[own] - total[own] * share;

            for (const candidate of touched) {
                const gain = linkTo[candidate] - total[candidate] * share;

                if (gain > bestGain || gain === bestGain && best !== own && candidate < best) {
                    best     = candidate;
                    bestGain = gain
                }
            }

            total[best] += degree[node];

            if (best !== own) {
                community[node] = best;
                changes++
            }

            for (const candidate of touched) {
                linkTo[candidate] = 0
            }

            touched.length = 0
        }

        if (!changes) {
            break
        }

        moved = true
    }

    const numbering = new Map();

    community.forEach((label, node) => {
        numbering.has(label) || numbering.set(label, numbering.size);
        community[node] = numbering.get(label)
    });

    return {moved, community, communities: numbering.size}
}

/**
 * @summary The graph of the communities: one node each, the weights between two summed, a community's
 * internal weight kept as its self weight.
 * @param {Object}      graph       See {@link moveLocally}
 * @param {Uint32Array} community   The level's community per node
 * @param {Number}      communities
 * @returns {Object} The next level's graph
 */
function aggregate({count, offsets, targets, weights, selfWeights}, community, communities) {
    const inner = new Float64Array(communities), links = Array.from({length: communities}, () => new Map());

    for (let node = 0; node < count; node++) {
        const own = community[node];

        inner[own] += selfWeights[node];

        for (let k = offsets[node]; k < offsets[node + 1]; k++) {
            const other = community[targets[k]];

            // an inner edge is visited from both ends
            other === own ? inner[own] += weights[k] / 2 : links[own].set(other, (links[own].get(other) ?? 0) + weights[k])
        }
    }

    const next = new Uint32Array(communities + 1);

    links.forEach((map, own) => next[own + 1] = next[own] + map.size);

    const nextTargets = new Uint32Array(next[communities]), nextWeights = new Float64Array(next[communities]);

    links.forEach((map, own) => {
        let k = next[own];

        for (const [other, weight] of map) {
            nextTargets[k]   = other;
            nextWeights[k++] = weight
        }
    });

    return {count: communities, offsets: next, targets: nextTargets, weights: nextWeights, selfWeights: inner}
}

/**
 * @summary Three unit floats drawn from an id, the same on every run: an FNV-1a hash seeds a mulberry32 draw.
 * @param {String} id
 * @returns {Number[]} `[u, v, w]`, each in `[0, 1)`
 */
function unitsOf(id) {
    let hash = 2166136261;

    for (let i = 0; i < id.length; i++) {
        hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
    }

    const draw = () => {
        hash = hash + 0x6D2B79F5 | 0;

        let t = Math.imul(hash ^ hash >>> 15, 1 | hash);

        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;

        return ((t ^ t >>> 14) >>> 0) / 4294967296
    };

    return [draw(), draw(), draw()]
}

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
     * @summary The communities of a graph in compressed rows, by modularity (Louvain): local moving on each
     * level ({@link moveLocally}), then the communities aggregate into the next level's nodes, until a level
     * moves nothing. A node without an edge joins the one community of unlinked nodes. Communities are numbered
     * by their first member, so the result depends on the nodes' order and the edges alone.
     * @param {Number}      count   The nodes
     * @param {Uint32Array} offsets `count + 1` row starts into `targets`
     * @param {Uint32Array} targets Neighbour positions
     * @returns {{communities: Number, of: Uint32Array}}
     */
    static communitiesOf(count, offsets, targets) {
        const member = Uint32Array.from({length: count}, (item, node) => node);
        let graph = {count, offsets, targets, weights: new Float64Array(targets.length).fill(1), selfWeights: new Float64Array(count)};

        for (let level = 0; level < SEARCH.levels; level++) {
            const {moved, community, communities} = moveLocally(graph);

            if (!moved) {
                break
            }

            member.forEach((node, original) => member[original] = community[node]);
            graph = aggregate(graph, community, communities)
        }

        const of = new Uint32Array(count), numbering = new Map();

        for (let node = 0; node < count; node++) {
            // `count` names no community, so it is free for the unlinked one
            const label = offsets[node] === offsets[node + 1] ? count : member[node];

            numbering.has(label) || numbering.set(label, numbering.size);
            of[node] = numbering.get(label)
        }

        return {communities: numbering.size, of}
    }

    /**
     * @summary The scene of a `fleetGraphScene` read: every node in its community, and the feed's own edges.
     * Communities come from the edges ({@link #communitiesOf}, visiting the nodes by id); their centres lie on
     * a golden-angle sphere and each node sits at a point its id draws inside its community's ball. Positions
     * and communities therefore depend only on the ids and the edges: two reads of one snapshot, or the same
     * rows in any order, lay out identically, and the route never moves a node, so the pane can draw it as an
     * overlay or leave it out.
     *
     * The route's seeds come first in route order and carry their position as `rank`; a node's `hop` is its
     * distance to the nearest seed, `null` for a node no seed reaches. An edge with an absent endpoint is
     * dropped, a repeated one kept once, and a missing relation type stays `null`. `unavailable` or a read
     * without a scene draws nothing; `degraded` draws what the read holds; `completeness` says whether a budget
     * cut it.
     * @param {Object|null} envelope The landed `fleetGraphScene` envelope, as plain data.
     * @returns {Object} `{currency, empty, nodes, edges, edgeTypes, seeds, index, communities, completeness,
     *     snapshotId}`: `nodes[]` = `{id, kind, label, rank, hop, cluster, x, y, z}` with `cluster` the
     *     community, the seeds first in route order, then by id; `edges[]` pairs index into `nodes`,
     *     `edgeTypes[]` aligned; `seeds[]` indexes the seeds in route order.
     */
    static fromGraphScene(envelope) {
        const
            currency   = envelope?.capability?.state ?? 'unobserved',
            scene      = envelope?.scene ?? null,
            snapshotId = envelope?.snapshotId ?? null,
            byId       = new Map();

        if (currency === 'unavailable' || !Array.isArray(scene?.nodes)) {
            return {currency, empty: true, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}, communities: 0, completeness: scene?.completeness ?? null, snapshotId}
        }

        for (const node of scene.nodes) {
            typeof node?.id === 'string' && !byId.has(node.id) && byId.set(node.id, node)
        }

        const
            compare = (a, b) => a < b ? -1 : a > b ? 1 : 0,
            ids     = [...byId.keys()].sort(compare),
            count   = ids.length,
            at      = new Map(ids.map((id, position) => [id, position])),
            routeAt = new Map(),
            seen    = new Set(),
            links   = [],
            pairs   = new Set();

        for (const id of Array.isArray(scene.route) ? scene.route : []) {
            routeAt.has(id) || routeAt.set(id, routeAt.size)
        }

        for (const edge of Array.isArray(scene.edges) ? scene.edges : []) {
            const {from, to} = edge ?? {}, type = edge?.type ?? null;

            if (at.has(from) && at.has(to) && !seen.has(`${from}\u0000${to}\u0000${type}`)) {
                const a = at.get(from), b = at.get(to);

                seen.add(`${from}\u0000${to}\u0000${type}`);
                links.push({from, to, type});
                // an undirected neighbour pair, once, whatever its types; a self-loop joins no one
                a !== b && pairs.add(a < b ? a * count + b : b * count + a)
            }
        }

        // the neighbours in compressed rows, by id position
        const offsets = new Uint32Array(count + 1), targets = new Uint32Array(pairs.size * 2), fill = new Uint32Array(count);

        for (const pair of pairs) {
            offsets[Math.floor(pair / count) + 1]++;
            offsets[pair % count + 1]++
        }

        for (let node = 0; node < count; node++) {
            offsets[node + 1] += offsets[node]
        }

        for (const pair of pairs) {
            const a = Math.floor(pair / count), b = pair % count;

            targets[offsets[a] + fill[a]++] = b;
            targets[offsets[b] + fill[b]++] = a
        }

        const
            {communities, of}           = ObservatorySceneLayout.communitiesOf(count, offsets, targets),
            {minSpread, radius, spread} = GEOMETRY,
            golden                      = Math.PI * (3 - Math.sqrt(5)),
            sizes                       = new Uint32Array(communities),
            hops                        = new Int32Array(count).fill(-1),
            seeds                       = [...routeAt.keys()].filter(id => at.has(id));

        let largest = 1;

        of.forEach(community => {
            sizes[community]++;
            largest = Math.max(largest, sizes[community])
        });

        // breadth-first from every seed at once
        let frontier = seeds.map(id => at.get(id));

        frontier.forEach(node => hops[node] = 0);

        for (let hop = 1; frontier.length; hop++) {
            const next = [];

            for (const node of frontier) {
                for (let k = offsets[node]; k < offsets[node + 1]; k++) {
                    if (hops[targets[k]] < 0) {
                        hops[targets[k]] = hop;
                        next.push(targets[k])
                    }
                }
            }

            frontier = next
        }

        const
            ballOf   = Math.min(spread, 0.45 * Math.sqrt(4 * Math.PI / Math.max(1, communities))),
            centreOf = community => {
                if (communities === 1) {
                    return [0, 0, 0]
                }

                const y = 1 - (community + 0.5) / communities * 2, ring = Math.sqrt(1 - y * y), theta = golden * community;

                return [Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius]
            },
            others   = ids.filter(id => !routeAt.has(id)),
            order    = [...seeds, ...others],
            index    = Object.fromEntries(order.map((id, position) => [id, position])),
            nodes    = order.map(id => {
                const
                    position        = at.get(id),
                    community       = of[position],
                    [cx, cy, cz]    = centreOf(community),
                    [u, v, w]       = unitsOf(id),
                    reach           = Math.max(minSpread, ballOf * Math.cbrt(sizes[community] / largest)) * Math.cbrt(w),
                    lift            = 2 * u - 1,
                    around          = Math.sqrt(1 - lift * lift),
                    phi             = 2 * Math.PI * v,
                    node            = byId.get(id);

                return {
                    id,
                    kind   : node.kind  ?? null,
                    label  : node.label ?? null,
                    rank   : routeAt.has(id) ? routeAt.get(id) + 1 : null,
                    hop    : hops[position] < 0 ? null : hops[position],
                    cluster: community,
                    x      : cx + reach * around * Math.cos(phi),
                    y      : cy + reach * lift,
                    z      : cz + reach * around * Math.sin(phi)
                }
            }),
            edges    = links
                .map(link => ({pair: [index[link.from], index[link.to]], type: link.type}))
                .sort((a, b) => a.pair[0] - b.pair[0] || a.pair[1] - b.pair[1] || compare(String(a.type), String(b.type)));

        return {
            currency,
            empty       : nodes.length === 0,
            nodes,
            edges       : edges.map(edge => edge.pair),
            edgeTypes   : edges.map(edge => edge.type),
            seeds       : seeds.map((id, position) => position),
            index,
            communities,
            completeness: scene.completeness ?? null,
            snapshotId
        }
    }
}

export default Neo.setupClass(ObservatorySceneLayout);
export {GEOMETRY};
