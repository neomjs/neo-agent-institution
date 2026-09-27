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

        expect(Object.keys(blank)).toEqual(['capability', 'scene', 'snapshotId', 'capturedAt']);
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

    test('a route item resolves to the id the read qualified: bare ids by their origin, qualified ids as themselves, the rest to nothing', () => {
        const read = GraphSceneEnvelope.fromWire(current({route: ['neomjs/neo#issue-1', 'neo#210', 'other/repo#issue-1']}));

        expect(GraphSceneEnvelope.resolveRouteId(read, 'issue-1'), 'the first origin in route order wins').toBe('neomjs/neo#issue-1');
        expect(GraphSceneEnvelope.resolveRouteId(read, 'neo#210')).toBe('neo#210');
        expect(GraphSceneEnvelope.resolveRouteId(read, 'issue-2')).toBeNull();
        expect(GraphSceneEnvelope.resolveRouteId(GraphSceneEnvelope.blank(), 'issue-1')).toBeNull();
        expect(GraphSceneEnvelope.resolveRouteId(read, '')).toBeNull()
    });

    test('degraded and unavailable carry the producer reason; a degraded partial scene still says what it holds', () => {
        const partial = {...current(), capability: {state: 'degraded', reason: 'graph-seam-refused'}};

        expect(GraphSceneEnvelope.describe(GraphSceneEnvelope.fromWire(partial)).text).toBe('Degraded · graph-seam-refused · 2 nodes · 1 edge · complete');
        expect(GraphSceneEnvelope.describe(GraphSceneEnvelope.fromWire({capability: {state: 'unavailable', reason: 'route-read-failed'}})).text)
            .toBe('Unavailable · route-read-failed')
    })
});
