import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'ObservatorySceneLayoutTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import GoldenPathEnvelope                 from '../../../../../../apps/agentos/util/GoldenPathEnvelope.mjs';
import ObservatorySceneLayout, {GEOMETRY} from '../../../../../../apps/agentos/util/ObservatorySceneLayout.mjs';

/**
 * @summary The observatory scene's contract: the producer's route becomes a helix by rank with a
 * citation ring per item, a citation several items share is one node between them with an edge to
 * each, positions are the only derived facts, and what is drawn follows the cockpit's one currency
 * reading.
 *
 * Fixtures are wire envelopes as the Brain's Golden Path read answers them, landed through
 * `GoldenPathEnvelope.fromWire` the way the cockpit's read lands them.
 */

const THREE_ITEMS = [
    {id: 'issue:19220', title: 'The film\'s capture mode births 146 px wide vessels',       score: 8.06, rank: 1, citations: [{id: 'pull:19224'}, {id: 'issue:19225'}]},
    {id: 'issue:19186', title: 'A vessel parked over another popup shows the stand-in mask', score: 4.3,  rank: 2, citations: [{id: 'issue:19225'}]},
    {id: 'issue:14800', title: 'The 13.2 release notes',                                     score: 2.1,  rank: 3, citations: []}
];

const ROUTE = {
    schemaVersion: 'computed-route.v1',
    status       : 'fresh',
    capturedAt   : '2026-09-25T14:30:00.000Z',
    expiresAt    : '2026-09-25T16:30:00.000Z',
    expired      : false,
    routeVersion : 'r-17',
    kind         : 'computed-ranked',
    freshness    : {status: 'fresh', checkedAt: '2026-09-25T14:30:00.000Z', expiresAt: '2026-09-25T16:30:00.000Z'},
    provenance   : {producer: 'golden-path-synthesizer', runId: 'run-9', algorithmVersion: 'v1'}
};

/**
 * A wired source with a fresh, admitted route — the only shape drawn as current.
 * @param {Object[]} items
 * @returns {Object} the wire envelope
 */
function wired(items) {
    return {
        capability: {state: 'wired', capturedAt: ROUTE.capturedAt},
        admission : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: ['issues'], staleFacets: []},
        rem       : {undigested: 990, digested: 1010, recentCycles: 3},
        route     : {...ROUTE, items},
        sources   : {route: {state: 'wired', reason: null}, admission: {state: 'current', reason: 'current'}, rem: {state: 'wired', reason: null}}
    }
}

/**
 * A wired source whose admission withholds the route — the last known good route, drawn dim.
 * @param {Object[]} items
 * @returns {Object} the wire envelope
 */
function withheld(items) {
    return {
        ...wired(items),
        admission: {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: ['issues', 'discussions'], staleFacets: ['discussions']},
        route    : {...ROUTE, items, status: 'stale', expired: true}
    }
}

const
    land     = wire => GoldenPathEnvelope.fromWire(wire),
    radiusOf = node => Math.hypot(node.x, node.z);

test.describe('AgentOS.util.ObservatorySceneLayout — the route as a helix, its citations as rings, the shared ones as the graph', () => {
    test('a fresh three-item route: items on the helix in rank order, rank 1 highest, weighted by score, the route in that order', () => {
        const {currency, empty, nodes, route} = ObservatorySceneLayout.fromGoldenPath(land(wired(THREE_ITEMS)));

        expect(currency).toBe('current');
        expect(empty).toBe(false);

        const items = nodes.filter(node => node.kind === 'item');

        expect(items.map(node => node.id)).toEqual(['issue:19220', 'issue:19186', 'issue:14800']);
        expect(items.map(node => node.rank)).toEqual([1, 2, 3]);
        expect(items[0].y).toBeCloseTo(GEOMETRY.helixHeight / 2, 6);
        expect(items[2].y).toBeCloseTo(-GEOMETRY.helixHeight / 2, 6);
        expect(items[0].y).toBeGreaterThan(items[1].y);
        expect(items[1].y).toBeGreaterThan(items[2].y);
        items.forEach(node => expect(radiusOf(node)).toBeCloseTo(GEOMETRY.helixRadius, 6));
        expect(items.map(node => node.weight)).toEqual([1, 4.3 / 8.06, 2.1 / 8.06]);
        expect(route).toEqual([0, 1, 2])
    });

    test('an item\'s own citation sits on its ring; a citation two items share is one node between them with an edge to each', () => {
        const
            {nodes, edges} = ObservatorySceneLayout.fromGoldenPath(land(wired(THREE_ITEMS))),
            citations      = nodes.filter(node => node.kind === 'citation'),
            shared         = nodes.findIndex(node => node.id === 'issue:19225'),
            own            = nodes.findIndex(node => node.id === 'pull:19224');

        expect(citations.map(node => node.id), 'one node per distinct citation, in label order').toEqual(['issue:19225', 'pull:19224']);

        // the own citation of the rank-1 item: one ring radius out and one ring drop down from it
        expect(Math.hypot(nodes[own].x - nodes[0].x, nodes[own].z - nodes[0].z)).toBeCloseTo(GEOMETRY.ringRadius, 6);
        expect(nodes[0].y - nodes[own].y).toBeCloseTo(GEOMETRY.ringDrop, 6);

        // the shared citation: at the citing items' mean height, lifted outward past the helix
        expect(nodes[shared].y).toBeCloseTo((nodes[0].y + nodes[1].y) / 2, 6);
        expect(radiusOf(nodes[shared])).toBeGreaterThan(Math.hypot((nodes[0].x + nodes[1].x) / 2, (nodes[0].z + nodes[1].z) / 2));

        expect(edges).toEqual([[0, shared], [1, shared], [0, own]])
    });

    test('withheld draws the last known good route; degraded, unavailable and unobserved yield an empty scene', () => {
        const dim = ObservatorySceneLayout.fromGoldenPath(land(withheld(THREE_ITEMS)));

        expect(dim.currency).toBe('withheld');
        expect(dim.empty).toBe(false);
        expect(dim.nodes.filter(node => node.kind === 'item')).toHaveLength(3);

        const
            degraded    = ObservatorySceneLayout.fromGoldenPath(land({...wired(THREE_ITEMS), capability: {state: 'degraded', reason: 'route-sidecar-missing'}, route: null})),
            unavailable = ObservatorySceneLayout.fromGoldenPath(land({capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}, admission: null, rem: null, route: null})),
            unobserved  = ObservatorySceneLayout.fromGoldenPath(null);

        expect([degraded, unavailable, unobserved].map(scene => [scene.currency, scene.empty, scene.nodes.length, scene.edges.length, scene.route.length]))
            .toEqual([['degraded', true, 0, 0, 0], ['unavailable', true, 0, 0, 0], ['unobserved', true, 0, 0, 0]])
    });

    test('the same envelope yields the same scene, and the producer\'s order is not the rank order', () => {
        const
            once  = ObservatorySceneLayout.fromGoldenPath(land(wired(THREE_ITEMS))),
            again = ObservatorySceneLayout.fromGoldenPath(land(wired([...THREE_ITEMS].reverse())));

        expect(again).toEqual(once)
    });
});

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
