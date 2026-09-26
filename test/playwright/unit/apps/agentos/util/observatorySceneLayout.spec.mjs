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
