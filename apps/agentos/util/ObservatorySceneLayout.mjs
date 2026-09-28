import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary Pure scene builder for the observatory pane: derives the scene a canvas-worker renderer
 * draws — nodes with a cluster and unit-space positions, edges as node index pairs — from the landed
 * `fleetGraphScene` envelope ({@link AgentOS.util.GraphSceneEnvelope}). The feed carries neither clusters
 * nor coordinates, so those are the only derived facts: nothing here merges or caches, and the same read
 * yields the same scene on every run.
 *
 * Two geographies place the nodes. Topology communities (Louvain) answer no question by design; density
 * wells, where the best-connected nodes attract, show what is central. Mail can leave the scene, and the
 * nodes in no well can sit in an outer halo or leave it too; the scene counts what it hid.
 *
 * Every tunable value is a config and every step a method, so `Neo.overwrites` or a subclass changes either.
 * @class AgentOS.util.ObservatorySceneLayout
 * @extends Neo.core.Base
 * @singleton
 */
class ObservatorySceneLayout extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.ObservatorySceneLayout'
         * @protected
         */
        className: 'AgentOS.util.ObservatorySceneLayout',
        /**
         * Geometry of the communities geography in unit space; the camera orbits the origin a few units out.
         * Community centres lie on a sphere of `radius`. The largest community fills a ball of at most `spread`,
         * less when many communities share the sphere, and a smaller one shrinks with the cube root of its
         * share, down to `minSpread`.
         * @member {Object} geometry={minSpread: 0.05, radius: 1, spread: 0.32}
         */
        geometry: {minSpread: 0.05, radius: 1, spread: 0.32},
        /**
         * The outer halo of the nodes in no well: a shell from `radius` to `radius + depth`, cut into
         * `bands` × `around` sectors. Each sector is a cluster of its own, so a drawn-back camera shows the
         * halo's centroids on the shell, never one centroid at the centre of the sky.
         * @member {Object} haloGeometry={around: 8, bands: 3, depth: 0.4, radius: 1.9}
         */
        haloGeometry: {around: 8, bands: 3, depth: 0.4, radius: 1.9},
        /**
         * The node kinds that are mail: agent messages and their broadcast sentinels. Dropping the mail
         * relations alone does not free the geography, because a message stays attached to the concepts it
         * names through `TAGGED_CONCEPT`.
         * @member {String[]} mailKinds=['BroadcastSentinel', 'MESSAGE']
         */
        mailKinds: ['BroadcastSentinel', 'MESSAGE'],
        /**
         * The relation types that route mail, dropped with it even between two nodes that are not mail.
         * @member {String[]} mailTypes=['DELIVERED_TO', 'SENT_BY', 'SENT_TO']
         */
        mailTypes: ['DELIVERED_TO', 'SENT_BY', 'SENT_TO'],
        /**
         * Bounds of the community search: the levels it aggregates and the passes a level makes. A clustered
         * graph settles in a few of each, so the caps only bound a pathological read.
         * @member {Object} search={levels: 12, passes: 24}
         */
        search: {levels: 12, passes: 24},
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true,
        /**
         * Density wells: at most `hubs` of the best-connected nodes attract. Well centres lie on a sphere of
         * `radius`; a hub sits at its centre and a member steps outward with its hop distance, up to `maxHop`
         * steps.
         * @member {Object} wellGeometry={hubs: 48, maxHop: 4, radius: 1.25}
         */
        wellGeometry: {hubs: 48, maxHop: 4, radius: 1.25}
    }

    /**
     * @summary The graph of the communities: one node each, the weights between two summed, a community's
     * internal weight kept as its self weight.
     * @param {Object}      graph       See {@link #moveLocally}
     * @param {Uint32Array} community   The level's community per node
     * @param {Number}      communities
     * @returns {Object} The next level's graph
     */
    aggregate({count, offsets, targets, weights, selfWeights}, community, communities) {
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
     * @summary The communities of a graph in compressed rows, by modularity (Louvain): local moving on each
     * level ({@link #moveLocally}), then the communities aggregate into the next level's nodes
     * ({@link #aggregate}), until a level moves nothing. A node without an edge joins the one community of
     * unlinked nodes. Communities are numbered by their first member, so the result depends on the nodes'
     * order and the edges alone.
     * @param {Number}      count   The nodes
     * @param {Uint32Array} offsets `count + 1` row starts into `targets`
     * @param {Uint32Array} targets Neighbour positions
     * @returns {{communities: Number, of: Uint32Array, unlinked: Number|null}} `unlinked` is the community of
     *     the nodes without an edge, `null` when every node has one
     */
    communitiesOf(count, offsets, targets) {
        const me = this, member = Uint32Array.from({length: count}, (item, node) => node);
        let graph = {count, offsets, targets, weights: new Float64Array(targets.length).fill(1), selfWeights: new Float64Array(count)};

        for (let level = 0; level < me.search.levels; level++) {
            const {moved, community, communities} = me.moveLocally(graph);

            if (!moved) {
                break
            }

            member.forEach((node, original) => member[original] = community[node]);
            graph = me.aggregate(graph, community, communities)
        }

        const of = new Uint32Array(count), numbering = new Map();

        for (let node = 0; node < count; node++) {
            // `count` names no community, so it is free for the unlinked one
            const label = offsets[node] === offsets[node + 1] ? count : member[node];

            numbering.has(label) || numbering.set(label, numbering.size);
            of[node] = numbering.get(label)
        }

        return {communities: numbering.size, of, unlinked: numbering.has(count) ? numbering.get(count) : null}
    }

    /**
     * @summary The scene of a `fleetGraphScene` read: every node in its cluster, and the feed's own edges.
     * The `geography` places the nodes. `communities` finds them from the edges ({@link #communitiesOf},
     * visiting the nodes by id), their centres on a golden-angle sphere and each node at a point its id draws
     * inside its community's ball. `density` gathers them into wells ({@link #wellsOf}): the hub at a well's
     * centre, a member stepping outward with its hop distance. Positions and clusters depend only on the ids
     * and the edges: two reads of one snapshot, or the same rows in any order, lay out identically, and the
     * route never moves a node, so the pane can draw it as an overlay or leave it out.
     *
     * With `mail` off, the {@link #mailKinds} nodes and the {@link #mailTypes} relations leave the scene
     * before it is laid out. `halo` places the nodes in no well (no edge, or no path to a hub): `true` on an
     * outer shell cut into sector clusters, `false` out of the scene, `null` as the communities geography always
     * has, in one community of their own (the density geography treats `null` as `true`). Neither filter hides a
     * route seed: a seed in no well keeps its place on the shell, so the route never skips an item. `hidden`
     * counts what left the scene, so the line above it can say so.
     *
     * The route's seeds come first in route order and carry their position as `rank`; a node's `hop` is its
     * distance to the nearest seed, `null` for a node no seed reaches. An edge with an absent endpoint is
     * dropped, a repeated one kept once, and a missing relation type stays `null`. `unavailable` or a read
     * without a scene draws nothing; `degraded` draws what the read holds; `completeness` says whether a budget
     * cut it.
     * @param {Object|null} envelope The landed `fleetGraphScene` envelope, as plain data.
     * @param {Object} [options]
     * @param {String} [options.geography='communities'] `communities` or `density`
     * @param {Boolean|null} [options.halo=null] Where the nodes in no well go (see above)
     * @param {Boolean} [options.mail=true] Whether mail stays in the scene
     * @returns {Object} `{currency, empty, geography, nodes, edges, edgeTypes, seeds, index, communities,
     *     haloFrom, halo, hidden, wells, completeness, snapshotId}`: `nodes[]` = `{id, kind, label, rank, hop,
     *     cluster, x, y, z}`, the seeds first in route order, then by id; `edges[]` pairs index into `nodes`,
     *     `edgeTypes[]` aligned; `seeds[]` indexes the seeds in route order. `communities` counts the
     *     geography's clusters; halo sectors are the clusters from `haloFrom` on (`null` without a halo), and
     *     `halo` counts their nodes. `hidden` is `{mail: {nodes, edges}, halo: {nodes, edges}}`; `wells[]` is
     *     `{id, label, size}` per density well, largest first.
     */
    fromGraphScene(envelope, {geography = 'communities', halo = null, mail = true} = {}) {
        const
            me         = this,
            currency   = envelope?.capability?.state ?? 'unobserved',
            scene      = envelope?.scene ?? null,
            snapshotId = envelope?.snapshotId ?? null,
            byId       = new Map(),
            hidden     = {mail: {nodes: 0, edges: 0}, halo: {nodes: 0, edges: 0}},
            mailIds    = new Set(),
            mailKinds  = new Set(me.mailKinds),
            mailTypes  = new Set(me.mailTypes),
            routeAt    = new Map();

        if (currency === 'unavailable' || !Array.isArray(scene?.nodes)) {
            return {currency, empty: true, geography, nodes: [], edges: [], edgeTypes: [], seeds: [], index: {}, communities: 0, haloFrom: null, halo: 0, hidden, wells: [], completeness: scene?.completeness ?? null, snapshotId}
        }

        // the seeds are known before either filter runs: a view filter hides dust, never the route
        for (const id of Array.isArray(scene.route) ? scene.route : []) {
            routeAt.has(id) || routeAt.set(id, routeAt.size)
        }

        for (const node of scene.nodes) {
            if (typeof node?.id === 'string' && !byId.has(node.id) && !mailIds.has(node.id)) {
                !mail && mailKinds.has(node.kind) && !routeAt.has(node.id) ? mailIds.add(node.id) : byId.set(node.id, node)
            }
        }

        hidden.mail.nodes = mailIds.size;

        const
            compare = (a, b) => a < b ? -1 : a > b ? 1 : 0,
            ids     = [...byId.keys()].sort(compare),
            count   = ids.length,
            at      = new Map(ids.map((id, position) => [id, position])),
            seen    = new Set(),
            links   = [],
            pairs   = new Set();

        for (const edge of Array.isArray(scene.edges) ? scene.edges : []) {
            const {from, to} = edge ?? {}, type = edge?.type ?? null;

            if (!mail && (mailTypes.has(type) || mailIds.has(from) || mailIds.has(to))) {
                hidden.mail.edges++;
                continue
            }

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
            golden   = Math.PI * (3 - Math.sqrt(5)),
            density  = geography === 'density',
            // the density geography has no community of the unlinked to fall back on
            haloMode = density && halo === null ? true : halo,
            units    = ids.map(id => me.unitsOf(id)),
            cluster  = new Int32Array(count),
            spot     = new Float64Array(count * 3),
            shown    = new Uint8Array(count).fill(1),
            hops     = new Int32Array(count).fill(-1),
            seeds    = [...routeAt.keys()].filter(id => at.has(id)),
            sphereAt = (slot, slots, radius) => {
                if (slots === 1) {
                    return [0, 0, 0]
                }

                const y = 1 - (slot + 0.5) / slots * 2, ring = Math.sqrt(1 - y * y), theta = golden * slot;

                return [Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius]
            },
            // a point its id draws at `reach` from a centre
            place    = (position, [cx, cy, cz], reach) => {
                const [u, v] = units[position], lift = 2 * u - 1, around = Math.sqrt(1 - lift * lift), phi = 2 * Math.PI * v;

                spot[position * 3]     = cx + reach * around * Math.cos(phi);
                spot[position * 3 + 1] = cy + reach * lift;
                spot[position * 3 + 2] = cz + reach * around * Math.sin(phi)
            };

        let communities, wells = [], outside = [];

        if (density) {
            const
                {maxHop, radius}                     = me.wellGeometry,
                {hop, hubs, of, sizes, wells: found} = me.wellsOf(count, offsets, targets),
                largest                              = Math.max(1, sizes[0] ?? 1);

            communities = found;
            wells       = hubs.map((position, well) => ({id: ids[position], label: byId.get(ids[position]).label ?? null, size: sizes[well]}));

            of.forEach((well, position) => {
                if (well < 0) {
                    outside.push(position);
                    return
                }

                // spread the ranks over the sphere, so the largest wells do not stack at one pole
                const
                    slot  = (well * 7919 + 13) % communities,
                    steps = Math.min(hop[position], maxHop),
                    reach = steps === 0 ? 0 : (0.07 + 0.3 * Math.cbrt(sizes[well] / largest)) * (0.16 + 0.21 * steps) * (0.7 + 0.6 * units[position][2]);

                cluster[position] = well;
                place(position, sphereAt(slot, communities, radius), reach)
            })
        } else {
            const
                {communities: found, of, unlinked} = me.communitiesOf(count, offsets, targets),
                {minSpread, radius, spread}        = me.geometry,
                // with a halo, the community of the unlinked leaves the geography
                apart                              = haloMode !== null && unlinked !== null,
                sizes                              = new Uint32Array(found);

            communities = apart ? found - 1 : found;

            of.forEach((community, position) => {
                if (apart && community === unlinked) {
                    outside.push(position)
                } else {
                    cluster[position] = apart && community > unlinked ? community - 1 : community;
                    sizes[cluster[position]]++
                }
            });

            const largest = sizes.reduce((most, size) => Math.max(most, size), 1), ballOf = Math.min(spread, 0.45 * Math.sqrt(4 * Math.PI / Math.max(1, communities)));

            for (let position = 0; position < count; position++) {
                if (!apart || of[position] !== unlinked) {
                    const community = cluster[position];

                    place(position, sphereAt(community, communities, radius), Math.max(minSpread, ballOf * Math.cbrt(sizes[community] / largest)) * Math.cbrt(units[position][2]))
                }
            }
        }

        const {around, bands, depth, radius: shell} = me.haloGeometry;

        for (const position of outside) {
            if (haloMode === false && !routeAt.has(ids[position])) {
                shown[position] = 0
            } else {
                const [u, v, w] = units[position];

                cluster[position] = communities + Math.min(bands - 1, Math.floor(u * bands)) * around + Math.min(around - 1, Math.floor(v * around));
                place(position, [0, 0, 0], shell + depth * w)
            }
        }

        const haloed = outside.filter(position => shown[position] === 1).length;

        hidden.halo.nodes = outside.length - haloed;

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
            visible = id => shown[at.get(id)] === 1,
            drawn   = seeds.filter(visible),
            order   = [...drawn, ...ids.filter(id => !routeAt.has(id) && visible(id))],
            index   = Object.fromEntries(order.map((id, position) => [id, position])),
            nodes   = order.map(id => {
                const position = at.get(id), node = byId.get(id);

                return {
                    id,
                    kind   : node.kind  ?? null,
                    label  : node.label ?? null,
                    rank   : routeAt.has(id) ? routeAt.get(id) + 1 : null,
                    hop    : hops[position] < 0 ? null : hops[position],
                    cluster: cluster[position],
                    x      : spot[position * 3],
                    y      : spot[position * 3 + 1],
                    z      : spot[position * 3 + 2]
                }
            }),
            // a hidden node takes its relations with it
            edges   = links
                .filter(link => Object.hasOwn(index, link.from) && Object.hasOwn(index, link.to))
                .map(link => ({pair: [index[link.from], index[link.to]], type: link.type}))
                .sort((a, b) => a.pair[0] - b.pair[0] || a.pair[1] - b.pair[1] || compare(String(a.type), String(b.type)));

        hidden.halo.edges = links.length - edges.length;

        return {
            currency,
            empty       : nodes.length === 0,
            geography,
            nodes,
            edges       : edges.map(edge => edge.pair),
            edgeTypes   : edges.map(edge => edge.type),
            seeds       : drawn.map((id, position) => position),
            index,
            communities,
            haloFrom    : haloMode === true || haloed > 0 ? communities : null,
            halo        : haloed,
            hidden,
            wells,
            completeness: scene.completeness ?? null,
            snapshotId
        }
    }

    /**
     * @summary One level of modularity local moving: each node, in order, joins the neighbouring community that
     * gains the most modularity, staying on a tie with its own and preferring the smaller index on any other tie,
     * until a pass moves nothing. Weights are integer sums, so the arithmetic is exact and the result depends on
     * the nodes' order and the graph alone.
     * @param {Object} graph `{count, offsets, targets, weights, selfWeights}`, weighted compressed rows
     * @returns {{moved: Boolean, community: Uint32Array, communities: Number}}
     */
    moveLocally({count, offsets, targets, weights, selfWeights}) {
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

        for (let pass = 0; twiceM && pass < this.search.passes; pass++) {
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
     * @summary Three unit floats drawn from an id, the same on every run: an FNV-1a hash seeds a mulberry32 draw.
     * @param {String} id
     * @returns {Number[]} `[u, v, w]`, each in `[0, 1)`
     */
    unitsOf(id) {
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
     * @summary The density wells of a graph in compressed rows: the `hubs` best-connected nodes (degree, then
     * position) attract, never a leaf, since a node with one relation is no centre, so a small graph gets no
     * wells of one. A breadth-first walk from all hubs at once gives every node the hub it reaches first, with
     * its hop distance. A node that two wells reach in the same step joins the one that ranks first, so the
     * result depends on the graph alone, never on the order of its rows. A node no hub reaches, and a node
     * without an edge, is in no well. Wells are numbered by size, the largest first.
     * @param {Number}      count   The nodes
     * @param {Uint32Array} offsets `count + 1` row starts into `targets`
     * @param {Uint32Array} targets Neighbour positions
     * @param {Number}      [hubs=this.wellGeometry.hubs] The most wells
     * @returns {{wells: Number, of: Int32Array, hop: Int32Array, hubs: Number[], sizes: Number[]}} `of` is a
     *     well per node, `-1` for none; `hubs` and `sizes` are by well
     */
    wellsOf(count, offsets, targets, hubs = this.wellGeometry.hubs) {
        const
            degreeOf = node => offsets[node + 1] - offsets[node],
            anchors  = Array.from({length: count}, (item, node) => node)
                .filter(node => degreeOf(node) > 1)
                .sort((a, b) => degreeOf(b) - degreeOf(a) || a - b)
                .slice(0, hubs),
            well     = new Int32Array(count).fill(-1),
            hop      = new Int32Array(count).fill(-1);

        anchors.forEach((node, rank) => {
            well[node] = rank;
            hop[node]  = 0
        });

        // every level of the walk holds its nodes in well rank order (the hubs start it in rank order, and each
        // level is discovered from the one before in that order), so the first well to reach a node is the best
        // ranked of those reaching it in that step, whatever the order of a node's rows
        for (let frontier = anchors, step = 1; frontier.length; step++) {
            const next = [];

            for (const node of frontier) {
                for (let k = offsets[node]; k < offsets[node + 1]; k++) {
                    const other = targets[k];

                    if (hop[other] < 0) {
                        hop[other]  = step;
                        well[other] = well[node];
                        next.push(other)
                    }
                }
            }

            frontier = next
        }

        const sizes = new Uint32Array(anchors.length);

        well.forEach(rank => rank >= 0 && sizes[rank]++);

        const
            bySize   = anchors.map((node, rank) => rank).sort((a, b) => sizes[b] - sizes[a] || a - b),
            renumber = new Int32Array(anchors.length);

        bySize.forEach((rank, position) => renumber[rank] = position);

        return {
            wells: anchors.length,
            of   : well.map(rank => rank < 0 ? -1 : renumber[rank]),
            hop,
            hubs : bySize.map(rank => anchors[rank]),
            sizes: bySize.map(rank => sizes[rank])
        }
    }

    /**
     * @summary A scene as the canvas worker takes it: typed arrays by node index, and no node objects or ids.
     * A read of any size crosses the worker boundary as a few buffers, where 100k node objects cost a quarter
     * of a second to clone on every read. The renderer answers indices, and the App Worker resolves them
     * against the scene it holds.
     * @param {Object|null} scene A {@link #fromGraphScene} scene
     * @returns {Object|null} `{communities, completeness, count, currency, empty, haloFrom, snapshotId}` with
     * `positions` (`x, y, z` per node), `clusters` (a cluster per node), `edges` (index pairs), `seeds`
     * (node indices in route order) and `ranks` (one per seed)
     */
    wire(scene) {
        if (!scene) {
            return null
        }

        const
            {edges, nodes, seeds} = scene,
            count     = nodes.length,
            positions = new Float32Array(count * 3),
            clusters  = new Uint32Array(count),
            pairs     = new Uint32Array(edges.length * 2);

        nodes.forEach(({cluster, x, y, z}, index) => {
            positions.set([x, y, z], index * 3);
            clusters[index] = cluster
        });

        edges.forEach((pair, index) => pairs.set(pair, index * 2));

        return {
            clusters,
            communities : scene.communities,
            completeness: scene.completeness,
            count,
            currency    : scene.currency,
            edges       : pairs,
            empty       : scene.empty,
            haloFrom    : scene.haloFrom ?? null,
            positions,
            ranks       : Uint32Array.from(seeds, index => nodes[index].rank),
            seeds       : Uint32Array.from(seeds),
            snapshotId  : scene.snapshotId
        }
    }
}

export default Neo.setupClass(ObservatorySceneLayout);
