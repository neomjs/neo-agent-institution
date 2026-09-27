/**
 * @module test/playwright/fixture/wholeGraphScene
 * @summary A `fleetGraphScene` envelope at whole-graph scale for the observatory's scale witness: `communities`
 * even groups of `nodes`, `edgesPerNode` edges from each node, a share `inside` of them within its group, and a
 * route through `routeLength` groups. A seeded draw makes it the same envelope on every run. Synthetic by
 * construction: it certifies the FM path, never the Brain's data.
 */

/**
 * @param {Object} [options]
 * @param {Number} [options.communities=64]
 * @param {Number} [options.edgesPerNode=3]
 * @param {Number} [options.inside=0.9]
 * @param {Number} [options.nodes=100000]
 * @param {Number} [options.routeLength=10]
 * @param {Number} [options.seed=1]
 * @returns {Object} The wire envelope
 */
export function wholeGraphEnvelope({communities = 64, edgesPerNode = 3, inside = 0.9, nodes = 100000, routeLength = 10, seed = 1} = {}) {
    let state = seed >>> 0;

    const
        random    = () => {
            state = state + 0x6D2B79F5 | 0;

            let t = Math.imul(state ^ state >>> 15, 1 | state);

            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;

            return ((t ^ t >>> 14) >>> 0) / 4294967296
        },
        perGroup  = Math.ceil(nodes / communities),
        idOf      = node => `fixture:concept-${String(node).padStart(6, '0')}`,
        edges     = [];

    for (let node = 0; node < nodes; node++) {
        const first = Math.floor(node / perGroup) * perGroup, span = Math.min(perGroup, nodes - first);

        for (let k = 0; k < edgesPerNode; k++) {
            const other = random() < inside ? first + Math.floor(random() * span) : Math.floor(random() * nodes);

            other !== node && edges.push({from: idOf(node), to: idOf(other), type: 'relates'})
        }
    }

    const route = Array.from({length: Math.min(routeLength, communities)}, (item, k) => idOf(k * 7 % communities * perGroup));

    return {
        capability: {state: 'current', reason: null},
        scene     : {
            route,
            nodes       : Array.from({length: nodes}, (item, node) => ({id: idOf(node), kind: 'concept', label: `Concept ${node}`})),
            edges,
            counts      : {nodes, edges: edges.length, seeds: route.length},
            budget      : {maxNodes: null, maxEdges: null, maxBytes: null},
            completeness: 'complete'
        },
        snapshotId: `fixture-${nodes}-${communities}-${seed}`,
        capturedAt: '2026-09-27T12:00:00.000Z'
    }
}
