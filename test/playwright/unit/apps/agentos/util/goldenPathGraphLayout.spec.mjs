import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'GoldenPathGraphLayoutTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import GoldenPathEnvelope                 from '../../../../../../apps/agentos/util/GoldenPathEnvelope.mjs';
import GoldenPathGraphLayout, {GEOMETRY} from '../../../../../../apps/agentos/util/GoldenPathGraphLayout.mjs';

/**
 * @summary The Golden Path graph's layout contract: the producer's route becomes a ranked spine
 * with citation satellites, shared citations are the edges, positions are the only derived facts,
 * and what is drawn follows the cockpit's one currency reading.
 *
 * Fixtures are wire envelopes as the Brain's Golden Path read answers them, landed through
 * `GoldenPathEnvelope.fromWire` the way the cockpit's read lands them.
 */

const SURFACE = {width: 600, height: 300};

const TWO_ITEMS = [
    {id: 'issue:19220', title: 'The film\'s capture mode births 146 px wide vessels',       score: 8.06, rank: 1, citations: [{id: 'pull:19224'}]},
    {id: 'issue:19186', title: 'A vessel parked over another popup shows the stand-in mask', score: 4.3,  rank: 2, citations: []}
];

/**
 * A wired source with a fresh, admitted route — the only shape drawn as current.
 * @param {Object[]} items
 * @returns {Object} the wire envelope
 */
function wired(items) {
    return {
        capability: {state: 'wired', capturedAt: '2026-09-25T14:30:00.000Z'},
        admission : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: ['issues'], staleFacets: []},
        rem       : {undigested: 990, digested: 1010, recentCycles: 3},
        route     : {
            schemaVersion: 'computed-route.v1',
            status       : 'fresh',
            capturedAt   : '2026-09-25T14:30:00.000Z',
            expiresAt    : '2026-09-25T16:30:00.000Z',
            expired      : false,
            routeVersion : 'r-17',
            kind         : 'computed-ranked',
            freshness    : {status: 'fresh', checkedAt: '2026-09-25T14:30:00.000Z', expiresAt: '2026-09-25T16:30:00.000Z'},
            provenance   : {producer: 'golden-path-synthesizer', runId: 'run-9', algorithmVersion: 'v1'},
            items
        },
        sources: {route: {state: 'wired', reason: null}, admission: {state: 'current', reason: 'current'}, rem: {state: 'wired', reason: null}}
    }
}

const land = wire => GoldenPathEnvelope.fromWire(wire);

test.describe('AgentOS.util.GoldenPathGraphLayout — the route as a spine, its citations as the graph', () => {
    test('a fresh two-item route: two item nodes in rank order along x, one citation below the item that cites it, one edge', () => {
        const {currency, empty, nodes, edges} = GoldenPathGraphLayout.layout(land(wired(TWO_ITEMS)), SURFACE);

        expect(currency).toBe('current');
        expect(empty).toBe(false);

        const items = nodes.filter(node => node.kind === 'item');

        expect(items.map(node => node.id)).toEqual(['issue:19220', 'issue:19186']);
        expect(items[0].x).toBe(GEOMETRY.padding);
        expect(items[1].x).toBe(SURFACE.width - GEOMETRY.padding);
        expect(items.every(node => node.y === SURFACE.height * GEOMETRY.spineY)).toBe(true);
        // the producer's score weighs the node: the best score takes the full radius, the other a share of it
        expect(items[0].r).toBe(GEOMETRY.itemRadiusMax);
        expect(items[1].r).toBeGreaterThan(GEOMETRY.itemRadiusMin);
        expect(items[1].r).toBeLessThan(GEOMETRY.itemRadiusMax);

        const citations = nodes.filter(node => node.kind === 'citation');

        expect(citations).toEqual([{id: 'pull:19224', kind: 'citation', x: GEOMETRY.padding, y: SURFACE.height * GEOMETRY.citationY, r: GEOMETRY.citationRadius, label: 'pull:19224', rank: null, score: null}]);
        expect(edges).toEqual([{from: 'issue:19220', to: 'pull:19224'}])
    });

    test('a citation shared by two items appears ONCE, between them, with an edge to each — the shared evidence is the graph', () => {
        const
            items  = [
                {id: 'a', title: 'A', score: 5, rank: 1, citations: [{id: 'shared'}, {id: 'only-a'}]},
                {id: 'b', title: 'B', score: 4, rank: 2, citations: ['shared']}
            ],
            {nodes, edges} = GoldenPathGraphLayout.layout(land(wired(items)), SURFACE),
            shared = nodes.find(node => node.id === 'shared');

        expect(nodes.filter(node => node.kind === 'citation')).toHaveLength(2);
        expect(shared.x).toBe(SURFACE.width / 2);
        expect(edges).toEqual([{from: 'a', to: 'only-a'}, {from: 'a', to: 'shared'}, {from: 'b', to: 'shared'}])
    });

    test('several citations of ONE item fan out around it in label order, so none hides another', () => {
        const
            items   = [{id: 'a', title: 'A', score: 5, rank: 1, citations: [{id: 'c2'}, {id: 'c1'}, {ref: 'c3'}]}],
            {nodes} = GoldenPathGraphLayout.layout(land(wired(items)), SURFACE),
            xs      = nodes.filter(node => node.kind === 'citation').map(node => [node.id, node.x]);

        expect(xs).toEqual([['c1', SURFACE.width / 2 - GEOMETRY.citationSpread], ['c2', SURFACE.width / 2], ['c3', SURFACE.width / 2 + GEOMETRY.citationSpread]])
    });

    test('the same envelope yields the same picture on every run, and rank order beats array order', () => {
        const
            reversed = [TWO_ITEMS[1], TWO_ITEMS[0]],
            first    = GoldenPathGraphLayout.layout(land(wired(reversed)), SURFACE),
            second   = GoldenPathGraphLayout.layout(land(wired(reversed)), SURFACE);

        expect(second).toEqual(first);
        expect(first.nodes.filter(node => node.kind === 'item').map(node => node.rank)).toEqual([1, 2])
    });

    test('a missing score takes the floor radius and a missing rank stays null — neither is synthesized', () => {
        const
            items   = [{id: 'a', title: 'A', citations: []}, {id: 'b', title: 'B', score: 2, rank: 2, citations: []}],
            {nodes} = GoldenPathGraphLayout.layout(land(wired(items)), SURFACE);

        // an unranked item sorts after the ranked ones and keeps no rank of its own
        expect(nodes.filter(node => node.kind === 'item').map(node => [node.id, node.rank])).toEqual([['b', 2], ['a', null]]);
        expect(nodes.find(node => node.id === 'a').r).toBe(GEOMETRY.itemRadiusMin);
        expect(nodes.find(node => node.id === 'a').score).toBeNull();
        expect(nodes.find(node => node.id === 'b').r).toBe(GEOMETRY.itemRadiusMax)
    });

    test.describe('what is drawn follows the currency — the cockpit\'s one reading of the envelope', () => {
        test('a withheld admission still draws its items — the last known good route, the admission contract\'s fallback', () => {
            const wire = wired(TWO_ITEMS);

            wire.admission = {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: ['issues'], staleFacets: ['issues']};

            const {currency, empty, nodes} = GoldenPathGraphLayout.layout(land(wire), SURFACE);

            expect(currency).toBe('withheld');
            expect(empty).toBe(false);
            expect(nodes.filter(node => node.kind === 'item')).toHaveLength(2)
        });

        test('an expired or stale route is withheld too, and still drawn', () => {
            const expired = wired(TWO_ITEMS), stale = wired(TWO_ITEMS);

            expired.route.expired = true;
            stale.route.status    = 'stale';

            expect(GoldenPathGraphLayout.layout(land(expired), SURFACE)).toMatchObject({currency: 'withheld', empty: false});
            expect(GoldenPathGraphLayout.layout(land(stale), SURFACE)).toMatchObject({currency: 'withheld', empty: false})
        });

        test('a degraded source, an unavailable one and an unobserved leaf draw nothing', () => {
            const degraded = wired(TWO_ITEMS), noRoute = wired(TWO_ITEMS);

            degraded.capability = {state: 'degraded', capturedAt: '2026-09-25T14:30:00.000Z', reason: 'route-sidecar-missing'};
            noRoute.route       = null;

            expect(GoldenPathGraphLayout.layout(land(degraded), SURFACE)).toEqual({currency: 'degraded', empty: true, nodes: [], edges: [], ...SURFACE});
            expect(GoldenPathGraphLayout.layout(land(noRoute), SURFACE)).toMatchObject({currency: 'degraded', empty: true});
            expect(GoldenPathGraphLayout.layout(land({capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}}), SURFACE))
                .toMatchObject({currency: 'unavailable', empty: true});
            expect(GoldenPathGraphLayout.layout(GoldenPathEnvelope.blank(), SURFACE)).toMatchObject({currency: 'unobserved', empty: true});
            expect(GoldenPathGraphLayout.layout(null, SURFACE)).toMatchObject({currency: 'unobserved', empty: true})
        });

        test('a route of kind none is empty under a current admission — an honest empty state, not a picture', () => {
            const wire = wired([]);

            wire.route.kind = 'none';

            const result = GoldenPathGraphLayout.layout(land(wire), SURFACE);

            expect(result.currency).toBe('current');
            expect(result.empty).toBe(true);
            expect(result.nodes).toEqual([])
        })
    });

    test.describe('the currency line — the cockpit\'s word, then the producer\'s reason or the capture instant and the count', () => {
        test('a current route: the word, captured <instant>, the count — the instant through the given formatter, UTC minute by default', () => {
            expect(GoldenPathGraphLayout.describeCurrency(land(wired(TWO_ITEMS)))).toEqual({
                currency: 'current',
                text    : 'Current · captured 2026-09-25 14:30Z · 2 items'
            });
            expect(GoldenPathGraphLayout.describeCurrency(land(wired(TWO_ITEMS)), at => `viewer:${at.slice(11, 16)}`).text)
                .toBe('Current · captured viewer:14:30 · 2 items')
        });

        test('a withheld route names the admission\'s reason code, says it is the last known good route, and counts one item as one', () => {
            const wire = wired([TWO_ITEMS[0]]);

            wire.admission        = {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: [], staleFacets: []};
            wire.route.capturedAt = '2026-09-24T18:40:00.000Z';

            expect(GoldenPathGraphLayout.describeCurrency(land(wire))).toEqual({
                currency: 'withheld',
                text    : 'Withheld · freshness-sla-breached · last known good route · captured 2026-09-24 18:40Z · 1 item'
            })
        });

        test('degraded and unavailable carry the capability\'s reason and no instant; the unobserved blank is the bare word', () => {
            const degraded = wired(TWO_ITEMS);

            degraded.capability = {state: 'degraded', capturedAt: '2026-09-25T14:30:00.000Z', reason: 'route-sidecar-missing'};

            expect(GoldenPathGraphLayout.describeCurrency(land(degraded))).toEqual({currency: 'degraded', text: 'Degraded · route-sidecar-missing'});
            expect(GoldenPathGraphLayout.describeCurrency(land({capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}})))
                .toEqual({currency: 'unavailable', text: 'Unavailable · fleet golden path source not wired'});
            expect(GoldenPathGraphLayout.describeCurrency(GoldenPathEnvelope.blank())).toEqual({currency: 'unobserved', text: 'Unobserved'});
            expect(GoldenPathGraphLayout.describeCurrency(null)).toEqual({currency: 'unobserved', text: 'Unobserved'})
        });

        test('an unparseable instant, or a formatter with nothing to say, leaves the instant out rather than rendering a wrong one', () => {
            const wire = wired(TWO_ITEMS);

            wire.route.capturedAt = 'not-a-date';

            expect(GoldenPathGraphLayout.describeCurrency(land(wire)).text).toBe('Current · 2 items');
            expect(GoldenPathGraphLayout.describeCurrency(land(wired(TWO_ITEMS)), () => null).text).toBe('Current · 2 items')
        })
    })
});
