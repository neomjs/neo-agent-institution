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
import {wholeGraphEnvelope}               from '../../../../fixture/wholeGraphScene.mjs';

/**
 * @summary The observatory scene's contract: every node sits in the community its edges put it in, only the
 * feed's edges become lines, communities and positions are the only derived facts, one read or its shuffle
 * lays out identically, and the route never moves a node, so the pane can draw it as an overlay.
 */

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

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

test.describe('AgentOS.util.ObservatorySceneLayout — every node in its community, only the feed\'s edges, the route an overlay', () => {
    test('seeds lead in route order with their rank, the rest follow by id; hop comes from the relations, cluster is the community', () => {
        const {currency, empty, nodes, seeds, index, communities, completeness, snapshotId} = ObservatorySceneLayout.fromGraphScene(graphRead());

        expect([currency, empty, completeness, snapshotId]).toEqual(['current', false, 'complete', 'snap-7f3a']);
        expect(nodes.map(node => node.id)).toEqual(GRAPH_ORDER);
        expect(GRAPH_ORDER.map(id => index[id])).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(seeds).toEqual([0, 1, 2]);

        // modularity splits the chain 202 — Grace — pr-101 — Dock — 404 at its middle link; the two nodes
        // without an edge share the unlinked community
        expect(communities).toBe(3);
        expect(nodes.map(node => [shortId(node.id), node.rank, node.hop, node.cluster])).toEqual([
            ['pr-101',       1,    0,    0],
            ['issue-202',    2,    0,    0],
            ['issue-303',    3,    0,    2],
            ['agent-grace',  null, 1,    0],
            ['concept-dock', null, 1,    1],
            ['issue-404',    null, 2,    1],
            ['issue-505',    null, null, 2]     // no seed reaches it
        ]);
        expect(nodes[3]).toMatchObject({kind: 'agent', label: 'Grace'})
    });

    test('only the feed\'s edges become lines: direction and type pass through, a missing type stays null, no seed joins the next by rank', () => {
        const {edges, edgeTypes} = ObservatorySceneLayout.fromGraphScene(graphRead());

        expect(edges).toEqual([[0, 4], [3, 0], [3, 1], [4, 5]]);
        expect(edgeTypes).toEqual(['mentions', 'authored', 'authored', null]);
        expect(edges.some(([a, b]) => a < 3 && b < 3), 'the route order is a cue, never an edge').toBe(false)
    });

    test('a clustered graph: each generated group becomes one community, and communities lie apart while their members lie together', () => {
        const
            read   = wholeGraphEnvelope({communities: 4, edgesPerNode: 4, inside: 0.95, nodes: 400, routeLength: 4}),
            scene  = ObservatorySceneLayout.fromGraphScene(read),
            groups = [0, 1, 2, 3].map(group => scene.nodes.filter(node => Math.floor(Number(node.id.slice(-6)) / 100) === group)),
            // each group's majority community, and its share
            major  = groups.map(members => {
                const tally = new Map();

                members.forEach(node => tally.set(node.cluster, (tally.get(node.cluster) ?? 0) + 1));

                return [...tally].sort((a, b) => b[1] - a[1])[0]
            }),
            centre = members => ['x', 'y', 'z'].reduce((point, axis) => ({...point, [axis]: members.reduce((sum, node) => sum + node[axis], 0) / members.length}), {});

        expect(scene.communities).toBe(4);
        expect(new Set(major.map(([community]) => community)).size, 'four groups, four communities').toBe(4);
        major.forEach(([, share]) => expect(share / 100).toBeGreaterThanOrEqual(0.95));

        const
            centres = groups.map(centre),
            reach   = Math.max(...groups.map((members, group) => Math.max(...members.map(node => distance(node, centres[group]))))),
            apart   = Math.min(...centres.flatMap((a, i) => centres.slice(i + 1).map(b => distance(a, b))));

        // a member lies within its community's ball; the group's mean sits near the ball's centre
        expect(reach).toBeLessThan(GEOMETRY.spread * 1.25);
        expect(apart, 'the nearest two communities lie further apart than any member from its centre').toBeGreaterThan(reach)
    });

    test('the route never moves a node: another route, or none, keeps every position and community', () => {
        const
            read    = graphRead(),
            once    = ObservatorySceneLayout.fromGraphScene(read),
            rerouted = ObservatorySceneLayout.fromGraphScene(graphRead({route: ['neomjs/neo#issue-505', 'neomjs/neo#agent-grace']})),
            routeless = ObservatorySceneLayout.fromGraphScene(graphRead({route: []})),
            placeOf = (scene, id) => {
                const {cluster, x, y, z} = scene.nodes[scene.index[id]];

                return {cluster, x, y, z}
            };

        GRAPH_ORDER.forEach(id => {
            expect(placeOf(rerouted, id), id).toEqual(placeOf(once, id));
            expect(placeOf(routeless, id), id).toEqual(placeOf(once, id))
        });
        expect(routeless.seeds).toEqual([])
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

    test('a budget cut: an edge to an absent node is dropped, a cut seed leaves its rank behind, and the read says truncated', () => {
        const
            read = graphRead(),
            cut  = ObservatorySceneLayout.fromGraphScene(graphRead({
                nodes       : read.scene.nodes.filter(node => node.id !== 'neomjs/neo#issue-202'),
                edges       : [...read.scene.edges, {from: 'neomjs/neo#pr-101', to: 'neomjs/neo#issue-999', type: 'mentions'}],
                completeness: 'truncated'
            }));

        expect(cut.completeness).toBe('truncated');
        expect(cut.nodes.map(node => shortId(node.id))).toEqual(['pr-101', 'issue-303', 'agent-grace', 'concept-dock', 'issue-404', 'issue-505']);
        expect(cut.seeds).toEqual([0, 1]);

        // the third seed keeps rank 3; no line runs to the absent ids
        expect(cut.nodes[1]).toMatchObject({rank: 3});
        expect(cut.nodes[2]).toMatchObject({hop: 1, cluster: 0});
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
