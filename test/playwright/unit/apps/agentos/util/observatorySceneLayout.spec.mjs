import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'ObservatorySceneLayoutTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import GraphSceneEnvelope     from '../../../../../../apps/agentos/util/GraphSceneEnvelope.mjs';
import ObservatorySceneLayout from '../../../../../../apps/agentos/util/ObservatorySceneLayout.mjs';
import {wholeGraphEnvelope}   from '../../../../fixture/wholeGraphScene.mjs';

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
        expect(reach).toBeLessThan(ObservatorySceneLayout.geometry.spread * 1.25);
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

/**
 * A read of three stars (hubs with six, four and three leaves), two nodes without an edge, and a mail cloud:
 * five messages tagged to the second hub and sent to an agent, a broadcast sentinel delivering to that agent,
 * and one mail relation between two ordinary nodes.
 * @param {Object} [options]
 * @param {Boolean} [options.mail=true] Whether the read carries the mail cloud
 * @returns {Object} The envelope
 */
function starsRead({mail = true} = {}) {
    const q = id => `neomjs/neo#${id}`, nodes = [], edges = [];

    [6, 4, 3].forEach((leaves, star) => {
        nodes.push({id: q(`hub-${star}`), label: `hub ${star}`, kind: 'concept'});

        for (let leaf = 0; leaf < leaves; leaf++) {
            nodes.push({id: q(`leaf-${star}-${leaf}`), label: `leaf ${star}.${leaf}`, kind: 'issue'});
            edges.push({from: q(`hub-${star}`), to: q(`leaf-${star}-${leaf}`), type: 'relates'})
        }
    });

    nodes.push({id: q('loose-0'), label: 'loose 0', kind: 'issue'}, {id: q('loose-1'), label: 'loose 1', kind: 'issue'});

    if (mail) {
        for (let message = 0; message < 5; message++) {
            nodes.push({id: q(`message-${message}`), label: `message ${message}`, kind: 'MESSAGE'});
            edges.push({from: q(`message-${message}`), to: q('hub-1'), type: 'TAGGED_CONCEPT'}, {from: q(`message-${message}`), to: q('agent-ada'), type: 'SENT_TO'})
        }

        nodes.push({id: q('agent-ada'), label: 'Ada', kind: 'agent'}, {id: q('broadcast'), label: 'Broadcast', kind: 'BroadcastSentinel'});
        edges.push({from: q('broadcast'), to: q('agent-ada'), type: 'DELIVERED_TO'}, {from: q('hub-2'), to: q('agent-ada'), type: 'SENT_BY'})
    }

    return graphRead({route: [], nodes, edges, counts: {nodes: nodes.length, edges: edges.length, seeds: 0}})
}

/**
 * Compressed rows of an undirected edge list over `count` positions, in the list's order.
 * @param {Number} count
 * @param {Number[][]} pairs
 * @returns {{offsets: Uint32Array, targets: Uint32Array}}
 */
function rowsOf(count, pairs) {
    const offsets = new Uint32Array(count + 1), targets = new Uint32Array(pairs.length * 2), fill = new Uint32Array(count);

    pairs.forEach(([a, b]) => {
        offsets[a + 1]++;
        offsets[b + 1]++
    });

    for (let node = 0; node < count; node++) {
        offsets[node + 1] += offsets[node]
    }

    pairs.forEach(([a, b]) => {
        targets[offsets[a] + fill[a]++] = b;
        targets[offsets[b] + fill[b]++] = a
    });

    return {offsets, targets}
}

test.describe('AgentOS.util.ObservatorySceneLayout — density wells, mail off, and the halo of the nodes in no well', () => {
    test('mail off: messages, their broadcast sentinel and every relation routing mail leave the scene, and the scene counts them', () => {
        const
            kept    = ObservatorySceneLayout.fromGraphScene(starsRead()),
            dropped = ObservatorySceneLayout.fromGraphScene(starsRead(), {mail: false});

        expect(kept.nodes.some(node => node.kind === 'MESSAGE'), 'the layout keeps mail unless told').toBe(true);
        expect(dropped.nodes.some(node => node.kind === 'MESSAGE' || node.kind === 'BroadcastSentinel')).toBe(false);
        // five messages and the sentinel; five tags, five deliveries, the broadcast's and the one between ordinary nodes
        expect(dropped.hidden.mail).toEqual({nodes: 6, edges: 12});
        expect(Object.hasOwn(dropped.index, 'neomjs/neo#agent-ada'), 'the agent stays, only its mail goes').toBe(true);
        expect(dropped.edges, 'the three stars keep their relations').toHaveLength(13)
    });

    test('density: each star is one well, largest first; its hub sits at the centre and its leaves around it, a leaf never attracts', () => {
        const scene = ObservatorySceneLayout.fromGraphScene(starsRead(), {geography: 'density', mail: false});

        expect(scene.geography).toBe('density');
        expect(scene.communities).toBe(3);
        expect(scene.wells.map(well => [well.label, well.size])).toEqual([['hub 0', 7], ['hub 1', 5], ['hub 2', 4]]);

        const byId = Object.fromEntries(scene.nodes.map(node => [node.id, node]));

        [0, 1, 2].forEach(star => {
            const hub = byId[`neomjs/neo#hub-${star}`], leaves = scene.nodes.filter(node => node.id.includes(`#leaf-${star}-`));

            expect(hub.cluster, `hub ${star} anchors the well of its rank`).toBe(star);
            expect(leaves.every(leaf => leaf.cluster === hub.cluster), `star ${star} is one well`).toBe(true);
            expect(leaves.every(leaf => distance(leaf, hub) > 0 && distance(leaf, hub) < 0.5), `the leaves of ${star} lie around its hub`).toBe(true)
        });

        expect(distance(byId['neomjs/neo#hub-0'], byId['neomjs/neo#hub-1']), 'wells lie apart').toBeGreaterThan(1)
    });

    test('the halo: the nodes in no well sit on the outer shell in sector clusters; halo off takes them out and says how many', () => {
        const
            shown   = ObservatorySceneLayout.fromGraphScene(starsRead(), {geography: 'density', mail: false}),
            gone    = ObservatorySceneLayout.fromGraphScene(starsRead(), {geography: 'density', mail: false, halo: false}),
            outside = shown.nodes.filter(node => node.cluster >= shown.haloFrom);

        // the two loose nodes, and the agent whose only relations were mail
        expect(shown.halo).toBe(3);
        expect(shown.haloFrom).toBe(shown.communities);
        expect(outside.map(node => node.id).sort()).toEqual(['neomjs/neo#agent-ada', 'neomjs/neo#loose-0', 'neomjs/neo#loose-1']);
        // wells centre on a sphere of 1.25 and reach less than a quarter unit: the shell lies outside all of them
        outside.forEach(node => expect(Math.hypot(node.x, node.y, node.z), `${node.id} outside every well`).toBeGreaterThan(1.5));

        expect(gone.halo).toBe(0);
        expect(gone.haloFrom).toBeNull();
        expect(gone.hidden.halo).toEqual({nodes: 3, edges: 0});
        expect(gone.nodes).toHaveLength(shown.nodes.length - 3);
        expect(Object.hasOwn(gone.index, 'neomjs/neo#loose-0')).toBe(false);

        // the communities geography keeps its community of the unlinked unless a halo is asked for
        const legacy = ObservatorySceneLayout.fromGraphScene(starsRead({mail: false})), haloed = ObservatorySceneLayout.fromGraphScene(starsRead({mail: false}), {halo: true});

        expect(legacy.haloFrom).toBeNull();
        expect(haloed.communities, 'the unlinked community leaves the geography').toBe(legacy.communities - 1);
        expect(haloed.halo).toBe(2)
    });

    test('neither filter hides a route seed: with the halo off a seed in no well keeps its place on the shell, and a mail seed stays with mail off, so the route skips no rank', () => {
        const
            q     = id => `neomjs/neo#${id}`,
            read  = graphRead({
                route: [q('a'), q('b'), q('c')],
                nodes: ['a', 'b', 'c', 'd', 'h'].map(id => ({id: q(id), label: id, kind: 'issue'})),
                edges: [{from: q('a'), to: q('h')}, {from: q('c'), to: q('h')}]
            }),
            gone  = ObservatorySceneLayout.fromGraphScene(read, {geography: 'density', halo: false}),
            ranks = scene => scene.seeds.map(index => scene.nodes[index].rank);

        expect(ranks(ObservatorySceneLayout.fromGraphScene(read, {geography: 'density'})), 'the control, halo on').toEqual([1, 2, 3]);
        expect(ranks(gone), 'the isolated middle seed still draws, so no path joins a to c').toEqual([1, 2, 3]);
        expect(Object.hasOwn(gone.index, q('d')), 'an ordinary node in no well still leaves').toBe(false);
        expect(gone.hidden.halo.nodes).toBe(1);
        expect(gone.halo, 'the kept seed sits on the shell').toBe(1);
        expect(gone.nodes[gone.index[q('b')]].cluster).toBeGreaterThanOrEqual(gone.haloFrom);

        const mailRoute = starsRead();

        mailRoute.scene.route = [q('message-0')];

        const mailed = ObservatorySceneLayout.fromGraphScene(mailRoute, {mail: false});

        expect(Object.hasOwn(mailed.index, q('message-0')), 'a mail seed stays with mail off').toBe(true);
        expect(mailed.hidden.mail.nodes, 'the other four messages and the sentinel still leave').toBe(5)
    });

    test('the head names hidden mail by what the Mail toggle removes: a broadcast sentinel alone reads as one mail node, never a message', () => {
        const
            q      = id => `neomjs/neo#${id}`,
            read   = graphRead({route: [], nodes: [{id: q('issue-1'), label: 'one', kind: 'issue'}, {id: q('broadcast'), label: 'Broadcast', kind: 'BroadcastSentinel'}], edges: []}),
            scene  = ObservatorySceneLayout.fromGraphScene(read, {mail: false}),
            {text} = GraphSceneEnvelope.describe(read, undefined, {nodes: scene.nodes.length, edges: scene.edges.length, halo: scene.halo, hidden: scene.hidden});

        expect(scene.hidden.mail.nodes).toBe(1);
        expect(text).toContain('1 mail node hidden');
        expect(text).not.toMatch(/message/)
    });

    test('wells lay out identically under shuffle, and a geography switch keeps every node, so a selection survives it', () => {
        const
            read   = starsRead(),
            once   = ObservatorySceneLayout.fromGraphScene(read, {geography: 'density', mail: false}),
            again  = ObservatorySceneLayout.fromGraphScene(graphRead({...read.scene, nodes: [...read.scene.nodes].reverse(), edges: [...read.scene.edges].reverse()}), {geography: 'density', mail: false}),
            topo   = ObservatorySceneLayout.fromGraphScene(read, {geography: 'communities', halo: true, mail: false});

        expect(once.wells, 'the three wells, not a vacuous match of two communities layouts').toHaveLength(3);
        expect(again).toEqual(once);
        expect(Object.keys(topo.index).sort()).toEqual(Object.keys(once.index).sort())
    });

    test('wellsOf: the walk gives a node two wells reach in one step to the better-ranked hub, whatever the row order, and numbers wells by size', () => {
        // hub 0 (degree 4) and hub 1 (degree 3) each reach node 7 in two steps, through 4 and 6
        const
            pairs = [[0, 2], [0, 3], [0, 4], [0, 8], [1, 5], [1, 6], [1, 9], [4, 7], [6, 7]],
            ahead = rowsOf(10, pairs),
            back  = rowsOf(10, [...pairs].reverse()),
            one   = ObservatorySceneLayout.wellsOf(10, ahead.offsets, ahead.targets, 2),
            two   = ObservatorySceneLayout.wellsOf(10, back.offsets, back.targets, 2);

        expect(Array.from(one.of)).toEqual([0, 1, 0, 0, 0, 1, 1, 0, 0, 1]);
        expect(Array.from(two.of), 'the reversed rows give the same wells').toEqual(Array.from(one.of));
        expect(Array.from(one.hop)).toEqual([0, 0, 1, 1, 1, 1, 1, 2, 1, 1]);
        expect(one.hubs).toEqual([0, 1]);
        expect(one.sizes).toEqual([6, 4])
    });
});

/**
 * The stars read with the Brain's strategic columns on two of its hubs: `hub-1` and `hub-2` are anchors, and
 * `hub-0`, the best-connected, is not.
 * @param {Object} [weights] Strategic weight per anchored hub
 * @returns {Object}
 */
function anchoredStarsRead(weights = {'hub-1': 2, 'hub-2': 5}) {
    const read = starsRead();

    read.scene.nodes = read.scene.nodes.map(node => {
        const weight = weights[node.id.replace('neomjs/neo#', '')];

        return weight === undefined ? node : {...node, gravityWell: true, strategicWeight: weight}
    });

    return read
}

/**
 * A read carrying the Brain's attribution, state and recency columns, around one instant: an open issue changed
 * two hours ago (authored by Ada, assigned to Vega), a PR Vega authored that merged an hour ago, an assignment of
 * Vega's untouched for thirty days, a memory of Vega's from 36 hours ago, a message sent now, a concept without a
 * source next to the open issue and the memory, an issue whose state the read omits, and one whose stored state
 * the heat cannot interpret.
 * @param {Number} now Epoch ms
 * @returns {Object}
 */
function teamRead(now) {
    const q = id => `neomjs/neo#${id}`, hour = 3600000;

    return graphRead({
        route: [],
        nodes: [
            {id: q('issue-1'),   label: 'open',             kind: 'ISSUE',        authoredBy: '@ada',  assignedTo: ['@vega'], state: 'OPEN',   lastActivityAt: now - 2 * hour},
            {id: q('pr-2'),      label: 'merged',           kind: 'PULL_REQUEST', authoredBy: '@vega', assignedTo: [],        state: 'MERGED', lastActivityAt: now - hour},
            {id: q('issue-3'),   label: 'old assignment',   kind: 'ISSUE',        authoredBy: '@ada',  assignedTo: ['@vega'], state: 'OPEN',   lastActivityAt: now - 30 * 24 * hour},
            {id: q('memory-4'),  label: 'a memory',         kind: 'AGENT_MEMORY', memoryOf  : '@vega',                                         lastActivityAt: now - 36 * hour},
            {id: q('message-5'), label: 'a message',        kind: 'MESSAGE',                                                                   lastActivityAt: now},
            {id: q('concept-6'), label: 'a concept',        kind: 'CONCEPT'},
            {id: q('issue-7'),   label: 'state not in read', kind: 'ISSUE',       authoredBy: '@emmy',                                         lastActivityAt: now},
            {id: q('issue-8'),   label: 'state not known',  kind: 'ISSUE',                                                   state: 'ON_HOLD', lastActivityAt: now - hour}
        ],
        edges: [{from: q('concept-6'), to: q('issue-1')}, {from: q('concept-6'), to: q('memory-4')}]
    })
}

test.describe('AgentOS.util.ObservatorySceneLayout — the team lens and the heat, channels over any geography', () => {
    const
        NOW   = Date.parse('2026-09-29T12:00:00.000Z'),
        scene = () => ObservatorySceneLayout.fromGraphScene(teamRead(NOW), {geography: 'communities', mail: true}),
        at    = (built, id) => built.index[`neomjs/neo#${id}`];

    test('the peers are the read\'s own attribution, each counted once per node, busiest first and by identity on a tie', () => {
        expect(ObservatorySceneLayout.peersOf(scene())).toEqual([{id: '@vega', nodes: 4, team: false}, {id: '@ada', nodes: 2, team: false}, {id: '@emmy', nodes: 1, team: false}]);
        expect(ObservatorySceneLayout.peersOf(ObservatorySceneLayout.fromGraphScene(graphRead())), 'a read without attribution names no peer').toEqual([])
    });

    test('the team is who the read holds an identity node for, in any origin and whatever the view hides; a peer without one is outside it', () => {
        const
            read  = teamRead(NOW),
            // Ada's and Vega's identity nodes, Vega's in two origins; Emmy has none, as an outside contributor has none
            nodes = [...read.scene.nodes,
                {id: 'neomjs/neo#@ada',              label: 'Ada',  kind: 'AgentIdentity'},
                {id: 'neomjs/neo#@vega',             label: 'Vega', kind: 'AgentIdentity'},
                {id: 'neomjs/neo-agent-brain#@vega', label: 'Vega', kind: 'AgentIdentity'}
            ],
            named = options => ObservatorySceneLayout.fromGraphScene({...read, scene: {...read.scene, nodes}}, options);

        expect(ObservatorySceneLayout.peersOf(named({geography: 'communities', mail: true}))).toEqual([
            {id: '@vega', nodes: 4, team: true}, {id: '@ada', nodes: 2, team: true}, {id: '@emmy', nodes: 1, team: false}
        ]);

        // no identity node has an edge here, so a hidden halo takes them all out of the scene, and none out of the team
        const hidden = named({geography: 'density', halo: false, mail: false});

        expect(hidden.nodes.some(node => node.kind === 'AgentIdentity')).toBe(false);
        expect(hidden.identities).toEqual(['@ada', '@vega']);
        expect(ObservatorySceneLayout.fromGraphScene(null).identities, 'no read, no team').toEqual([])
    });

    test('the lens is the union of the checked peers, a shared node taking the first-checked one; nothing checked is no lens', () => {
        const built = scene(), vega = ObservatorySceneLayout.lensOf(built, ['@vega']), both = ObservatorySceneLayout.lensOf(built, ['@ada', '@vega']);

        expect(['issue-1', 'pr-2', 'issue-3', 'memory-4', 'issue-7', 'concept-6'].map(id => vega[at(built, id)])).toEqual([1, 1, 1, 1, 0, 0]);
        expect(['issue-1', 'pr-2', 'issue-3', 'memory-4', 'issue-7'].map(id => both[at(built, id)]), 'Ada authored the issues Vega is assigned').toEqual([1, 2, 1, 2, 0]);
        expect(ObservatorySceneLayout.lensOf(built, [])).toBeNull()
    });

    test('a role names what a node is to its peer, and an old assignment never reads as current work', () => {
        const built = scene(), node = id => built.nodes[at(built, id)];

        expect(ObservatorySceneLayout.roleOf(node('issue-1'), ['@vega'], NOW)).toEqual({peer: '@vega', role: 'assigned · changed recently'});
        expect(ObservatorySceneLayout.roleOf(node('issue-3'), ['@vega'], NOW), 'thirty days untouched: history, not work').toEqual({peer: '@vega', role: 'assigned'});
        expect(ObservatorySceneLayout.roleOf(node('pr-2'), ['@vega'], NOW)).toEqual({peer: '@vega', role: 'authored · changed recently'});
        expect(ObservatorySceneLayout.roleOf(node('memory-4'), ['@vega'], NOW)).toEqual({peer: '@vega', role: 'memory · changed recently'});
        expect(ObservatorySceneLayout.roleOf(node('issue-1'), ['@ada', '@vega'], NOW), 'the first-checked peer names it').toEqual({peer: '@ada', role: 'authored · changed recently'});
        expect(ObservatorySceneLayout.roleOf(node('concept-6'), ['@vega'], NOW)).toBeNull()
    });

    test('the heat follows the named events: open work by recency, a merged item retired, memories counted, messages not, a sourceless kind from its neighbours, an unread state unknown', () => {
        const built = scene(), heat = ObservatorySceneLayout.heatOf(built, NOW), of = id => heat[at(built, id)];

        expect(of('issue-1'), 'two hours into a three-day window').toBeCloseTo(1 - 2 / 72, 5);
        expect(of('pr-2'), 'merged: retired, however recent').toBe(0);
        expect(of('issue-3'), 'past the window').toBe(0);
        expect(of('memory-4')).toBeCloseTo(0.5, 5);
        expect(of('message-5'), 'volume, not attention').toBe(0);
        expect(of('concept-6'), 'half its hottest neighbour\'s').toBeCloseTo((1 - 2 / 72) * 0.5, 5);
        expect(of('issue-7'), 'the read omits its state, so it may have retired').toBeNaN();
        expect(of('issue-8'), 'a stored state outside the known ones is unknown, never cold').toBeNaN();
        expect(Array.from(ObservatorySceneLayout.heatOf(ObservatorySceneLayout.fromGraphScene(graphRead()), NOW)).every(Number.isNaN), 'a read without activity times is unknown throughout').toBe(true)
    });

    test('neither channel moves a node: the lens and the heat read the scene, and the scene is the same with or without them', () => {
        const once = scene();

        ObservatorySceneLayout.lensOf(once, ['@vega']);
        ObservatorySceneLayout.heatOf(once, NOW);

        expect(once).toEqual(scene())
    });
});

test.describe('AgentOS.util.ObservatorySceneLayout — strategic wells at the Brain\'s anchors, each held to its cap', () => {
    test('strategicWellsOf ranks by pull, not degree: with one well, the strongest pull attracts although another node is better connected', () => {
        // node 0 has degree 3 and pull 1, node 1 has degree 2 and pull 9; node 5 is no anchor
        const
            {offsets, targets} = rowsOf(6, [[0, 2], [0, 3], [0, 4], [1, 5], [1, 4]]),
            pull               = Float64Array.from([1, 9, -1, -1, -1, -1]),
            one                = ObservatorySceneLayout.strategicWellsOf(6, offsets, targets, pull, {anchors: 1, maxShare: 10});

        expect(one.hubs, 'the pull decides, not the degree').toEqual([1]);
        expect(Array.from(one.of)).toEqual([0, 0, 0, 0, 0, 0])
    });

    test('strategicWellsOf holds a well to its cap: a full well stops growing, and a well with room claims what it can reach', () => {
        // anchor 0 (pull 10) reaches 2–7, anchor 1 (pull 1) shares 6 and 7 and alone reaches 8. Uncapped, the walk
        // reaches 9 nodes over 2 wells, so maxShare 1 caps a well at 5
        const
            {offsets, targets} = rowsOf(9, [[0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [1, 6], [1, 7], [1, 8]]),
            pull               = Float64Array.from([10, 1, -1, -1, -1, -1, -1, -1, -1]),
            capped             = ObservatorySceneLayout.strategicWellsOf(9, offsets, targets, pull, {anchors: 2, maxShare: 1}),
            open               = ObservatorySceneLayout.strategicWellsOf(9, offsets, targets, pull, {anchors: 2, maxShare: 100});

        expect(capped.cap).toBe(5);
        expect(Array.from(capped.of), 'the strongest well stops at 5, and the other claims 6 and 7').toEqual([0, 1, 0, 0, 0, 0, 1, 1, 1]);
        expect(capped.sizes).toEqual([5, 4]);
        expect(open.sizes, 'the control: without a binding cap the strongest well takes the shared nodes').toEqual([7, 2])
    });

    test('a node only a full well could reach is in no well, and the scene puts it in the halo', () => {
        // anchor 0 reaches 2–5 alone; anchor 1 reaches only 6. Uncapped: 7 nodes over 2 wells, maxShare 1 caps at 4
        const
            {offsets, targets} = rowsOf(7, [[0, 2], [0, 3], [0, 4], [0, 5], [1, 6]]),
            walk               = ObservatorySceneLayout.strategicWellsOf(7, offsets, targets, Float64Array.from([3, 1, -1, -1, -1, -1, -1]), {anchors: 2, maxShare: 1});

        expect(walk.cap).toBe(4);
        expect(Array.from(walk.of).filter(well => well < 0), 'the one node beyond the cap').toHaveLength(1);
        expect(Array.from(walk.reached), 'the reach counts it, so the scene can tell it from a node no anchor reaches').toEqual([1, 1, 1, 1, 1, 1, 1])
    });

    test('the halo says why a node is there: over a full well\'s cap, or reached by no well', () => {
        const
            q     = id => `neomjs/neo#${id}`,
            weigh = {'anchor-a': 3, 'anchor-b': 1},
            ids   = ['anchor-a', 'anchor-b', 'leaf-a-1', 'leaf-a-2', 'leaf-a-3', 'leaf-a-4', 'leaf-b-1', 'lonely'],
            read  = graphRead({
                route: [],
                nodes: ids.map(id => ({id: q(id), label: id, kind: 'issue', ...(weigh[id] ? {gravityWell: true, strategicWeight: weigh[id]} : {})})),
                edges: [...['leaf-a-1', 'leaf-a-2', 'leaf-a-3', 'leaf-a-4'].map(leaf => ({from: q('anchor-a'), to: q(leaf)})), {from: q('anchor-b'), to: q('leaf-b-1')}]
            }),
            saved = ObservatorySceneLayout.strategicGeometry;

        // two anchors reach 7 nodes; at 1× the mean a well holds 4, so anchor-a keeps three of its four leaves
        ObservatorySceneLayout.strategicGeometry = {anchors: 2, maxShare: 1};

        try {
            const scene = ObservatorySceneLayout.fromGraphScene(read, {geography: 'strategic', mail: false});

            expect(scene.wellCap).toBe(4);
            expect(scene.halo, 'the leaf past the cap and the node no well reaches').toBe(2);
            expect(scene.overCap, 'the leaf past the cap only').toBe(1);
            expect(ObservatorySceneLayout.fromGraphScene(read, {geography: 'density', mail: false}).overCap, 'density wells hold no cap').toBe(0)
        } finally {
            ObservatorySceneLayout.strategicGeometry = saved
        }
    });

    test('the strategic geography anchors the wells on the Brain\'s anchors and reports its cap; a star without an anchor sits in the halo', () => {
        const scene = ObservatorySceneLayout.fromGraphScene(anchoredStarsRead(), {geography: 'strategic', mail: false});

        expect(scene.geography).toBe('strategic');
        expect(scene.wells.map(well => well.label).sort(), 'hub-0 is best connected but no anchor').toEqual(['hub 1', 'hub 2']);
        expect(Number.isInteger(scene.wellCap) && scene.wellCap > 0).toBe(true);

        const byId = Object.fromEntries(scene.nodes.map(node => [node.id, node]));

        expect(byId['neomjs/neo#hub-0'].cluster, 'the unanchored star is in the halo').toBeGreaterThanOrEqual(scene.haloFrom);
        expect(byId['neomjs/neo#leaf-1-0'].cluster).toBe(byId['neomjs/neo#hub-1'].cluster)
    });

    test('a read without an anchor lays out as density, and says so: an older Brain keeps W2', () => {
        const
            strategic = ObservatorySceneLayout.fromGraphScene(starsRead(), {geography: 'strategic', mail: false}),
            density   = ObservatorySceneLayout.fromGraphScene(starsRead(), {geography: 'density', mail: false});

        expect(strategic.geography).toBe('density');
        expect(strategic.wellCap).toBeNull();
        expect(strategic).toEqual(density)
    });

    test('strategic wells lay out identically under shuffle', () => {
        const
            read  = anchoredStarsRead(),
            once  = ObservatorySceneLayout.fromGraphScene(read, {geography: 'strategic', mail: false}),
            again = ObservatorySceneLayout.fromGraphScene(graphRead({...read.scene, nodes: [...read.scene.nodes].reverse(), edges: [...read.scene.edges].reverse()}), {geography: 'strategic', mail: false});

        expect(once.wells).toHaveLength(2);
        expect(again).toEqual(once)
    });
});
