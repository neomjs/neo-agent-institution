import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'GraphSceneEnvelopeTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import GraphSceneEnvelope from '../../../../../../../../apps/agentos/util/GraphSceneEnvelope.mjs';

const current = (scene = {}) => ({
    capability: {state: 'current', reason: null},
    // the route's admission as the live plane writes it: five fields, carried whole
    admission : {admitted: true, fallback: 'current', reasonCode: 'projection-current', requiredFacets: ['issues', 'discussions'], staleFacets: []},
    scene     : {
        route       : ['neomjs/neo#issue-1'],
        nodes       : [{id: 'neomjs/neo#issue-1', label: 'one', kind: 'issue'}, {id: 'neomjs/neo#issue-2', label: 'two', kind: 'issue'}],
        edges       : [{from: 'neomjs/neo#issue-1', to: 'neomjs/neo#issue-2'}],
        counts      : {nodes: 2, edges: 1, seeds: 1},
        budget      : {maxNodes: 150, maxEdges: 300, maxBytes: 32768},
        completeness: 'complete',
        ...scene
    },
    snapshotId: 'snap-7',
    capturedAt: '2026-09-26T22:05:00.000Z'
});

/**
 * Contract specs for the graph scene leaf: its closed shape, the landing every read passes through,
 * and the line the Observatory shows above the scene.
 */
test.describe('graphSceneEnvelope — one closed shape, one honest line', () => {
    test('the blank declares every key and reads unobserved', () => {
        const blank = GraphSceneEnvelope.blank();

        expect(Object.keys(blank)).toEqual(['capability', 'admission', 'scene', 'snapshotId', 'capturedAt']);
        expect(blank.admission, 'no read, so no admission is claimed').toEqual({admitted: null, fallback: null, reasonCode: null, requiredFacets: [], staleFacets: []});
        expect(blank.scene).toEqual({route: [], nodes: [], edges: [], counts: {nodes: null, edges: null, seeds: null},
            budget: {maxNodes: null, maxEdges: null, maxBytes: null}, completeness: null});
        expect(GraphSceneEnvelope.describe(blank)).toEqual({currency: 'unobserved', text: 'Unobserved'})
    });

    test('a landing keeps the producer words and closes what the wire omits', () => {
        const landed = GraphSceneEnvelope.fromWire({capability: {state: 'degraded', reason: 'route-not-fresh'}, scene: null});

        expect(landed.capability).toEqual({state: 'degraded', reason: 'route-not-fresh'});
        expect(landed.scene.nodes).toEqual([]);
        expect(landed.snapshotId).toBeNull();
        expect(GraphSceneEnvelope.fromWire(current())).toEqual(current())
    });

    test('the route\'s admission lands whole, a withheld one with its stale facets; an unserved route keeps its reason and its graph', () => {
        const
            withheld = {admitted: false, fallback: 'last-known-good', reasonCode: 'projection-stale', requiredFacets: ['issues', 'discussions'], staleFacets: ['discussions']},
            landed   = GraphSceneEnvelope.fromWire({...current(), admission: withheld}),
            unserved = GraphSceneEnvelope.fromWire({...current({route: []}), capability: {state: 'degraded', reason: 'route-sidecar-missing'}, admission: null});

        expect(landed.admission).toEqual(withheld);
        expect(unserved.admission.admitted, 'no route answered, so nothing is admitted or refused').toBeNull();
        expect(unserved.scene.nodes, 'the graph is served either way').toHaveLength(2);
        expect(GraphSceneEnvelope.describe(unserved).text).toMatch(/^Degraded · route-sidecar-missing · 2 nodes/);
        expect(GraphSceneEnvelope.describe(current({route: []})).currency, 'a served route with no items is a current read').toBe('current')
    });

    test('an answer without a capability state lands unavailable, never unobserved', () => {
        expect(GraphSceneEnvelope.fromWire({scene: null}).capability)
            .toEqual({state: 'unavailable', reason: 'fleet graph scene answer carried no capability'})
    });

    test('the line names capture, holdings and completeness; a budget cut reads partial with the budget, never a total', () => {
        expect(GraphSceneEnvelope.describe(GraphSceneEnvelope.fromWire(current())).text)
            .toBe('Current · captured 2026-09-26 22:05Z · 2 nodes · 1 edge · complete');
        expect(GraphSceneEnvelope.describe(GraphSceneEnvelope.fromWire(current({completeness: 'truncated'}))).text)
            .toBe('Current · captured 2026-09-26 22:05Z · 2 nodes · 1 edge · partial, budget 150 nodes / 300 edges / 32 KiB');
        expect(GraphSceneEnvelope.describe(GraphSceneEnvelope.fromWire(current()), at => `viewer ${at.slice(11, 16)}`).text)
            .toBe('Current · captured viewer 22:05 · 2 nodes · 1 edge · complete')
    });

    test('the line counts what the pane drew and names what the read carried beyond it; a read drawn whole reads as the read', () => {
        const landed = GraphSceneEnvelope.fromWire(current()), stamp = at => `viewer ${at.slice(11, 16)}`;

        expect(GraphSceneEnvelope.describe(landed, stamp, {nodes: 2, edges: 1}).text, 'drawn whole').toBe('Current · captured viewer 22:05 · 2 nodes · 1 edge · complete');
        expect(GraphSceneEnvelope.describe(landed, stamp, {nodes: 2, edges: 0}).text).toBe('Current · captured viewer 22:05 · 2 nodes · 0 edges · 1 edge not drawn · complete');
        expect(GraphSceneEnvelope.describe(landed, stamp, {nodes: 0, edges: 0}).text, 'a read none of whose nodes is drawn still says what it carried')
            .toBe('Current · captured viewer 22:05 · 0 nodes · 0 edges · 2 nodes not drawn · 1 edge not drawn · complete')
    });

    test('the line names what the view hid and what its halo holds, and leaves "not drawn" to what the pane could not draw', () => {
        const
            read   = current({
                nodes: [...current().scene.nodes, {id: 'neomjs/neo#message-1', kind: 'MESSAGE'}, {id: 'neomjs/neo#issue-3', kind: 'issue'}, {id: 'neomjs/neo#issue-4', kind: 'issue'}],
                edges: [...current().scene.edges, {from: 'neomjs/neo#message-1', to: 'neomjs/neo#issue-1', type: 'TAGGED_CONCEPT'}]
            }),
            landed = GraphSceneEnvelope.fromWire(read),
            stamp  = at => `viewer ${at.slice(11, 16)}`,
            none   = {nodes: 0, edges: 0};

        expect(GraphSceneEnvelope.describe(landed, stamp, {nodes: 4, edges: 1, halo: 2, hidden: {mail: {nodes: 1, edges: 1}, halo: none}}).text, 'mail hidden, the halo drawn')
            .toBe('Current · captured viewer 22:05 · 4 nodes · 1 edge · 1 mail node hidden · 2 in the halo · complete');
        expect(GraphSceneEnvelope.describe(landed, stamp, {nodes: 2, edges: 1, halo: 0, hidden: {mail: {nodes: 1, edges: 1}, halo: {nodes: 2, edges: 0}}}).text, 'the halo hidden too')
            .toBe('Current · captured viewer 22:05 · 2 nodes · 1 edge · 1 mail node hidden · 2 halo nodes hidden · complete');
        expect(GraphSceneEnvelope.describe(landed, stamp, {nodes: 3, edges: 1, halo: 2, hidden: {mail: {nodes: 1, edges: 1}, halo: none}}).text, 'a node the pane could not draw is still named')
            .toBe('Current · captured viewer 22:05 · 3 nodes · 1 edge · 1 mail node hidden · 2 in the halo · 1 node not drawn · complete')
    });

    test('a route item resolves only to a seed the read holds: a qualified id as itself, a bare id when one origin holds it', () => {
        const
            read = (route, ids) => GraphSceneEnvelope.fromWire(current({route, nodes: ids.map(id => ({id, label: id, kind: 'issue'}))})),
            one  = read(['neomjs/neo#issue-1', 'neo#210'], ['neomjs/neo#issue-1', 'neo#210']),
            ab   = read(['org/a#issue-1', 'org/b#issue-1'], ['org/a#issue-1', 'org/b#issue-1']),
            ba   = read(['org/b#issue-1', 'org/a#issue-1'], ['org/a#issue-1', 'org/b#issue-1']);

        expect(GraphSceneEnvelope.resolveRouteId(one, 'issue-1'), 'a bare id one origin holds').toBe('neomjs/neo#issue-1');
        expect(GraphSceneEnvelope.resolveRouteId(one, 'neo#210'), 'a qualified id as itself').toBe('neo#210');
        expect(GraphSceneEnvelope.resolveRouteId(one, 'issue-2')).toBeNull();
        expect(GraphSceneEnvelope.resolveRouteId(one, '')).toBeNull();
        expect(GraphSceneEnvelope.resolveRouteId(GraphSceneEnvelope.blank(), 'issue-1')).toBeNull();

        expect(GraphSceneEnvelope.resolveRouteId(read(['neomjs/neo#issue-1'], []), 'issue-1'), 'a seed the budget cut').toBeNull();
        expect(GraphSceneEnvelope.resolveRouteId(read(['neomjs/neo#issue-1'], []), 'neomjs/neo#issue-1')).toBeNull();

        expect(GraphSceneEnvelope.resolveRouteId(ab, 'issue-1'), 'two origins and nothing to choose by').toBeNull();
        expect(GraphSceneEnvelope.resolveRouteId(ba, 'issue-1'), 'in either route order').toBeNull();
        expect(GraphSceneEnvelope.resolveRouteId(ab, 'org/b#issue-1'), 'the qualified id still resolves').toBe('org/b#issue-1');

        expect(GraphSceneEnvelope.resolveRouteId(read(['org/a#issue-1'], ['org/a#issue-1', 'org/b#issue-1']), 'issue-1'), 'a neighbour sharing the bare id is no seed')
            .toBe('org/a#issue-1')
    });

    test('degraded and unavailable carry the producer reason; a degraded partial scene still says what it holds', () => {
        const partial = {...current(), capability: {state: 'degraded', reason: 'graph-seam-refused'}};

        expect(GraphSceneEnvelope.describe(GraphSceneEnvelope.fromWire(partial)).text).toBe('Degraded · graph-seam-refused · 2 nodes · 1 edge · complete');
        expect(GraphSceneEnvelope.describe(GraphSceneEnvelope.fromWire({capability: {state: 'unavailable', reason: 'route-read-failed'}})).text)
            .toBe('Unavailable · route-read-failed')
    })
});
