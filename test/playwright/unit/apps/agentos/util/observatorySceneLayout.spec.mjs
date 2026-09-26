import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'ObservatorySceneLayoutTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import ObservatorySceneLayout, {GEOMETRY} from '../../../../../../apps/agentos/util/ObservatorySceneLayout.mjs';

/**
 * @summary The observatory scene's contract: a bounded graph read becomes seeds on a helix in route order
 * with their neighbours ringed around them, only the feed's edges become lines, positions are the only
 * derived facts, and one read or its shuffle lays out identically, so a selected id keeps its node.
 */

const radiusOf = node => Math.hypot(node.x, node.z);

/**
 * A `fleetGraphScene` envelope as the Brain's bounded read answers it: origin-qualified ids, the route's
 * items as seeds, adjacency edges that carry `type` only when the graph named one.
 * @param {Object} [scene] Fields replacing the fixture scene's
 * @param {Object} [envelope] Fields replacing the fixture envelope's
 * @returns {Object}
 */
function graphRead(scene = {}, envelope = {}) {
    const q = id => `neomjs/neo#${id}`;

    return {
        capability: {state: 'current', reason: null},
        scene     : {
            route: [q('pr-101'), q('issue-202'), q('issue-303')],
            nodes: [
                {id: q('agent-grace'),  label: 'Grace',             kind: 'agent'},
                {id: q('concept-dock'), label: 'Dock',              kind: 'concept'},
                {id: q('issue-202'),    label: 'second route item', kind: 'issue'},
                {id: q('issue-303'),    label: 'third route item',  kind: 'issue'},
                {id: q('issue-404'),    label: 'two hops out',      kind: 'issue'},
                {id: q('issue-505'),    label: 'no seed reaches',   kind: 'issue'},
                {id: q('pr-101'),       label: 'first route item',  kind: 'pull'}
            ],
            edges: [
                {from: q('agent-grace'),  to: q('issue-202'), type: 'authored'},
                {from: q('agent-grace'),  to: q('pr-101'),    type: 'authored'},
                {from: q('concept-dock'), to: q('issue-404')},
                {from: q('pr-101'),       to: q('concept-dock'), type: 'mentions'}
            ],
            counts      : {nodes: 7, edges: 4, seeds: 3},
            budget      : {maxNodes: 150, maxEdges: 300, maxBytes: 32768},
            completeness: 'complete',
            ...scene
        },
        snapshotId: 'snap-7f3a',
        capturedAt: '2026-09-26T20:00:00.000Z',
        ...envelope
    }
}

const
    GRAPH_ORDER = ['pr-101', 'issue-202', 'issue-303', 'agent-grace', 'concept-dock', 'issue-404', 'issue-505'].map(id => `neomjs/neo#${id}`),
    shortId     = id => id.replace('neomjs/neo#', '');

test.describe('AgentOS.util.ObservatorySceneLayout — the bounded graph read: seeds on the helix, neighbours around them, only the feed\'s edges', () => {
    test('seeds lead in route order with their rank, the rest follow by id; hop and cluster come from the feed\'s relations', () => {
        const {currency, empty, nodes, seeds, index, completeness, snapshotId} = ObservatorySceneLayout.fromGraphScene(graphRead());

        expect([currency, empty, completeness, snapshotId]).toEqual(['current', false, 'complete', 'snap-7f3a']);
        expect(nodes.map(node => node.id)).toEqual(GRAPH_ORDER);
        expect(GRAPH_ORDER.map(id => index[id])).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(seeds).toEqual([0, 1, 2]);

        expect(nodes.map(node => [shortId(node.id), node.rank, node.hop, node.cluster && shortId(node.cluster)])).toEqual([
            ['pr-101',       1,    0,    'pr-101'],
            ['issue-202',    2,    0,    'issue-202'],
            ['issue-303',    3,    0,    'issue-303'],
            ['agent-grace',  null, 1,    null],        // one hop from two seeds: shared, no single cluster
            ['concept-dock', null, 1,    'pr-101'],
            ['issue-404',    null, 2,    'pr-101'],
            ['issue-505',    null, null, null]         // no seed reaches it
        ]);
        expect(nodes[3]).toMatchObject({kind: 'agent', label: 'Grace'})
    });

    test('only the feed\'s edges become lines: direction and type pass through, a missing type stays null, no seed joins the next by rank', () => {
        const {edges, edgeTypes} = ObservatorySceneLayout.fromGraphScene(graphRead());

        expect(edges).toEqual([[0, 4], [3, 0], [3, 1], [4, 5]]);
        expect(edgeTypes).toEqual(['mentions', 'authored', 'authored', null]);
        expect(edges.some(([a, b]) => a < 3 && b < 3), 'the route order is a cue, never an edge').toBe(false)
    });

    test('the rings: own ring and outer ring around the one nearest seed, a shared node lifted clear between its seeds, the unreached below the helix', () => {
        const
            {nodes} = ObservatorySceneLayout.fromGraphScene(graphRead()),
            [pr, issue, , shared, own, outer, loose] = nodes,
            flat    = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

        [pr, issue, nodes[2]].forEach(seed => expect(radiusOf(seed)).toBeCloseTo(GEOMETRY.helixRadius, 6));
        expect(pr.y).toBeCloseTo(GEOMETRY.helixHeight / 2, 6);
        expect(nodes[2].y).toBeCloseTo(-GEOMETRY.helixHeight / 2, 6);

        expect(flat(own, pr)).toBeCloseTo(GEOMETRY.ringRadius, 6);
        expect(pr.y - own.y).toBeCloseTo(GEOMETRY.ringDrop, 6);
        expect(flat(outer, pr)).toBeCloseTo(GEOMETRY.outerRadius, 6);
        expect(pr.y - outer.y).toBeCloseTo(GEOMETRY.ringDrop * 2, 6);

        expect(radiusOf(shared)).toBeGreaterThan(Math.hypot((pr.x + issue.x) / 2, (pr.z + issue.z) / 2) + GEOMETRY.sharedLift);
        expect(shared.y).toBeCloseTo((pr.y + issue.y) / 2 - GEOMETRY.ringDrop, 6);

        expect(loose.y).toBeCloseTo(-GEOMETRY.helixHeight / 2 - GEOMETRY.looseDrop, 6);
        expect(radiusOf(loose)).toBeCloseTo(GEOMETRY.looseRadius, 6)
    });

    test('shuffled rows, a duplicated row and a second read of the same snapshot lay out identically; a selected id keeps its node', () => {
        const
            read     = graphRead(),
            once     = ObservatorySceneLayout.fromGraphScene(read),
            shuffled = ObservatorySceneLayout.fromGraphScene(graphRead({
                nodes: [...read.scene.nodes].reverse().concat(read.scene.nodes[0]),
                edges: [...read.scene.edges].reverse().concat(read.scene.edges[2])
            })),
            again    = ObservatorySceneLayout.fromGraphScene(structuredClone(read));

        expect(shuffled).toEqual(once);
        expect(again).toEqual(once);

        const selected = 'neomjs/neo#concept-dock';

        expect(shuffled.nodes[shuffled.index[selected]]).toEqual(once.nodes[once.index[selected]])
    });

    test('a budget cut: an edge to an absent node is dropped, a cut seed leaves its slot empty, and the read says truncated', () => {
        const
            full = ObservatorySceneLayout.fromGraphScene(graphRead()),
            read = graphRead(),
            cut  = ObservatorySceneLayout.fromGraphScene(graphRead({
                nodes       : read.scene.nodes.filter(node => node.id !== 'neomjs/neo#issue-202'),
                edges       : [...read.scene.edges, {from: 'neomjs/neo#pr-101', to: 'neomjs/neo#issue-999', type: 'mentions'}],
                completeness: 'truncated'
            }));

        expect(cut.completeness).toBe('truncated');
        expect(cut.nodes.map(node => shortId(node.id))).toEqual(['pr-101', 'issue-303', 'agent-grace', 'concept-dock', 'issue-404', 'issue-505']);
        expect(cut.seeds).toEqual([0, 1]);

        // the third seed keeps rank 3 and the position it had beside its cut neighbour
        expect(cut.nodes[1]).toMatchObject({rank: 3, x: full.nodes[2].x, y: full.nodes[2].y, z: full.nodes[2].z});

        // Grace now reaches one seed only, so she joins its cluster; no line runs to the absent ids
        expect(cut.nodes[2]).toMatchObject({hop: 1, cluster: 'neomjs/neo#pr-101'});
        expect(cut.edges).toEqual([[0, 3], [2, 0], [3, 4]]);
        expect(cut.edgeTypes).toEqual(['mentions', 'authored', null])
    });

    test('unavailable, a read without a scene and no read draw nothing; degraded draws what it holds', () => {
        const
            unavailable = ObservatorySceneLayout.fromGraphScene({capability: {state: 'unavailable', reason: 'route-read-failed'}, scene: null, snapshotId: null}),
            sceneless   = ObservatorySceneLayout.fromGraphScene({capability: {state: 'degraded', reason: 'route-not-fresh'}, scene: null, snapshotId: null}),
            unobserved  = ObservatorySceneLayout.fromGraphScene(null),
            partial     = ObservatorySceneLayout.fromGraphScene(graphRead({}, {capability: {state: 'degraded', reason: 'graph-seam-refused'}}));

        expect([unavailable, sceneless, unobserved].map(scene => [scene.currency, scene.empty, scene.nodes.length, scene.edges.length, scene.seeds.length]))
            .toEqual([['unavailable', true, 0, 0, 0], ['degraded', true, 0, 0, 0], ['unobserved', true, 0, 0, 0]]);
        expect([partial.currency, partial.empty, partial.nodes.length]).toEqual(['degraded', false, 7])
    });

    test('a read at the default budget (150 nodes, 300 edges) lays out finite, one node per id, and identically under shuffle', () => {
        let seed = 7;
        const
            random = () => (seed = (seed * 48271) % 2147483647) / 2147483647,
            ids    = Array.from({length: 150}, (_, i) => `neomjs/neo#issue-${1000 + i}`),
            edges  = Array.from({length: 300}, () => ({from: ids[Math.floor(random() * 150)], to: ids[Math.floor(random() * 150)], type: random() < 0.5 ? 'relates' : undefined})),
            read   = graphRead({route: ids.slice(0, 10), nodes: ids.map(id => ({id, label: id, kind: 'issue'})), edges}),
            once   = ObservatorySceneLayout.fromGraphScene(read),
            again  = ObservatorySceneLayout.fromGraphScene(graphRead({...read.scene, nodes: [...read.scene.nodes].reverse(), edges: [...edges].reverse()}));

        expect(once.nodes).toHaveLength(150);
        expect(new Set(Object.values(once.index)).size).toBe(150);
        once.nodes.forEach(node => ['x', 'y', 'z'].forEach(axis => expect(Number.isFinite(node[axis])).toBe(true)));
        expect(once.edges.every(pair => pair.every(position => position >= 0 && position < 150))).toBe(true);
        expect(again).toEqual(once)
    });
});
