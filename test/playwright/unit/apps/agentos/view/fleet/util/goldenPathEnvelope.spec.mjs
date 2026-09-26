import {setup} from '../../../../../../setup.mjs';

setup({neoConfig: {unitTestMode: true}, appConfig: {name: 'FleetGoldenPathEnvelopeTest'}});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Provider       from '../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';

import GoldenPathEnvelope from '../../../../../../../../apps/agentos/util/GoldenPathEnvelope.mjs';

const
    items    = [{id: 'neo#210', title: 'Golden Path pane', score: 0.87, rank: 1, citations: ['pull:215']}],
    wired    = {
        capability: {state: 'wired', capturedAt: '2026-09-25T16:00:00.000Z'},
        admission : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: ['issues'], staleFacets: []},
        route     : {schemaVersion: 'computed-route.v1', status: 'fresh', expired: false, kind: 'computed-ranked', provenance: {producer: 'golden-path-synthesizer'}, items},
        rem       : {undigested: 990, digested: 1010, recentCycles: 0},
        sources   : {route: {state: 'wired', reason: null}}
    },
    degraded = {
        capability: {state: 'degraded', capturedAt: '2026-09-25T16:05:00.000Z', reason: 'route-sidecar-missing'},
        admission : wired.admission,
        route     : null,
        rem       : null,
        sources   : {route: {state: 'degraded', reason: 'route-sidecar-missing'}}
    };

/**
 * Contract specs for the GoldenPathEnvelope class: the closed shape of the cockpit's
 * `goldenPathEnvelope` leaf, the landing every read passes through, and the currency both Golden
 * Path panes derive. The provider arm writes into a real `Neo.state.Provider`, because the closed
 * shape exists for the engine's leaf drilling.
 */
test.describe('goldenPathEnvelope — one closed shape, one currency', () => {
    test('the blank declares every key and reads unobserved', () => {
        const blank = GoldenPathEnvelope.blank();

        expect(Object.keys(blank)).toEqual(['capability', 'admission', 'route', 'rem', 'sources']);
        expect(blank.route.items).toEqual([]);
        expect(blank.route.provenance).toEqual({producer: null, runId: null, algorithmVersion: null});
        expect(GoldenPathEnvelope.currency(blank)).toBe('unobserved');
        expect(GoldenPathEnvelope.routeOf(blank)).toBeNull();
        expect(GoldenPathEnvelope.remOf(blank)).toBeNull()
    });

    test('a landing keeps the producer words and closes what the wire omits', () => {
        const landed = GoldenPathEnvelope.fromWire({...wired, route: {...wired.route, provenance: {producer: 'p', extra: 'x'}, expired: {at: 'soon'}}});

        expect(landed.capability).toEqual({state: 'wired', capturedAt: '2026-09-25T16:00:00.000Z', reason: null});
        expect(landed.route.items, 'items stay exactly as written').toBe(items);
        expect(landed.route.provenance, 'a block keeps its declared keys only').toEqual({producer: 'p', runId: null, algorithmVersion: null});
        expect(landed.route.expired, 'an object where a leaf is declared lands blank, so it cannot drill').toBeNull();
        expect(landed.sources.rem).toEqual({state: null, reason: null, detail: null});
        expect(GoldenPathEnvelope.currency(landed)).toBe('current')
    });

    test('an answer without a capability state lands unavailable, never unobserved', () => {
        for (const wire of [null, 'garbage', {}, {capability: {state: 7}}]) {
            expect(GoldenPathEnvelope.currency(GoldenPathEnvelope.fromWire(wire)), JSON.stringify(wire)).toBe('unavailable')
        }

        expect(GoldenPathEnvelope.fromWire({capability: {reason: 'kept'}}).capability.reason).toBe('kept')
    });

    test('the currency reads the producer words in their fixed order', () => {
        const land = wire => GoldenPathEnvelope.fromWire(wire);

        expect(GoldenPathEnvelope.currency(null)).toBe('unobserved');
        expect(GoldenPathEnvelope.currency(land({capability: {state: 'unavailable'}}))).toBe('unavailable');
        expect(GoldenPathEnvelope.currency(land({...wired, capability: {state: 'degraded'}}))).toBe('degraded');
        expect(GoldenPathEnvelope.currency(land({...wired, route: null})), 'wired without a route').toBe('degraded');
        expect(GoldenPathEnvelope.currency(land({...wired, admission: null}))).toBe('withheld');
        expect(GoldenPathEnvelope.currency(land({...wired, route: {...wired.route, expired: true}}))).toBe('withheld');
        expect(GoldenPathEnvelope.currency(land({...wired, route: {...wired.route, status: 'stale'}}))).toBe('withheld');
        expect(GoldenPathEnvelope.currency(land(wired))).toBe('current');

        expect(GoldenPathEnvelope.withheldReason(land({...wired, admission: null}))).toBe('admission-unavailable');
        expect(GoldenPathEnvelope.withheldReason(land({...wired, admission: {admitted: false, reasonCode: 'freshness-sla-breached'}}))).toBe('freshness-sla-breached');
        expect(GoldenPathEnvelope.withheldReason(land({...wired, route: {...wired.route, expired: true}}))).toBe('route-expired');
        expect(GoldenPathEnvelope.withheldReason(land({...wired, route: {...wired.route, status: 'stale'}}))).toBe('route-stale')
    });

    test('a citation is labelled as written, or left out', () => {
        expect(GoldenPathEnvelope.citationLabel('pull:1')).toBe('pull:1');
        expect(GoldenPathEnvelope.citationLabel({id: 'x', ref: 'y'})).toBe('x');
        expect(GoldenPathEnvelope.citationLabel({ref: 'y'})).toBe('y');
        expect(['', 7, {}, null].map(GoldenPathEnvelope.citationLabel)).toEqual([null, null, null, null])
    });

    test('landed envelopes read back whole through a real provider; raw wire envelopes do not', () => {
        const
            landedIn = Neo.create(Provider, {data: {goldenPathEnvelope: GoldenPathEnvelope.blank()}}),
            rawIn    = Neo.create(Provider, {data: {goldenPathEnvelope: GoldenPathEnvelope.blank()}});

        for (const wire of [degraded, wired]) {
            landedIn.setData({goldenPathEnvelope: GoldenPathEnvelope.fromWire(wire)});
            rawIn.setData({goldenPathEnvelope: wire})
        }

        const landed = landedIn.data.goldenPathEnvelope;

        expect(landed.route.status, 'the route after a degraded read').toBe('fresh');
        expect(landed.route.items, 'one atomic list').toEqual(items);
        expect(landed.capability.reason, 'the degraded reason does not outlive its read').toBeNull();
        expect(GoldenPathEnvelope.currency(landed)).toBe('current');

        // the control, and the sunset trigger: once the engine rebuilds an ancestor through a `null`
        // block, this arm fails and the landing no longer needs to close absent blocks
        expect(rawIn.data.goldenPathEnvelope.route, 'the null route stops the ancestor rebuild').toBeNull();
        expect(rawIn.data.goldenPathEnvelope.capability.reason, 'and an omitted key keeps its old value').toBe('route-sidecar-missing');

        landedIn.destroy();
        rawIn.destroy()
    });
});

test.describe('goldenPathEnvelope — the currency line: the word, then the producer\'s reason or the capture instant and the count', () => {
    const
        land  = wire => GoldenPathEnvelope.fromWire(wire),
        two   = [{id: 'issue:19220', title: 'Film capture', score: 8.06, rank: 1, citations: []}, {id: 'issue:19186', title: 'Parked vessel', score: 4.3, rank: 2, citations: []}],
        fresh = (routeItems, capturedAt = '2026-09-25T14:30:00.000Z') => ({...wired, route: {...wired.route, capturedAt, items: routeItems}});

    test('a current route: the word, captured <instant>, the count — the instant through the given formatter, UTC minute by default', () => {
        expect(GoldenPathEnvelope.describeCurrency(land(fresh(two)))).toEqual({currency: 'current', text: 'Current · captured 2026-09-25 14:30Z · 2 items'});
        expect(GoldenPathEnvelope.describeCurrency(land(fresh(two)), at => `viewer:${at.slice(11, 16)}`).text).toBe('Current · captured viewer:14:30 · 2 items')
    });

    test('a withheld route names the admission\'s reason code, says it is the last known good route, and counts one item as one', () => {
        const wire = {...fresh([two[0]], '2026-09-24T18:40:00.000Z'), admission: {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: [], staleFacets: []}};

        expect(GoldenPathEnvelope.describeCurrency(land(wire))).toEqual({
            currency: 'withheld',
            text    : 'Withheld · freshness-sla-breached · last known good route · captured 2026-09-24 18:40Z · 1 item'
        })
    });

    test('degraded and unavailable carry the capability\'s reason and no instant; the unobserved blank is the bare word', () => {
        expect(GoldenPathEnvelope.describeCurrency(land(degraded))).toEqual({currency: 'degraded', text: 'Degraded · route-sidecar-missing'});
        expect(GoldenPathEnvelope.describeCurrency(land({capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}})))
            .toEqual({currency: 'unavailable', text: 'Unavailable · fleet golden path source not wired'});
        expect(GoldenPathEnvelope.describeCurrency(GoldenPathEnvelope.blank())).toEqual({currency: 'unobserved', text: 'Unobserved'});
        expect(GoldenPathEnvelope.describeCurrency(null)).toEqual({currency: 'unobserved', text: 'Unobserved'})
    });

    test('an unparseable instant, or a formatter with nothing to say, leaves the instant out rather than rendering a wrong one', () => {
        expect(GoldenPathEnvelope.describeCurrency(land(fresh(two, 'not-a-date'))).text).toBe('Current · 2 items');
        expect(GoldenPathEnvelope.describeCurrency(land(fresh(two)), () => null).text).toBe('Current · 2 items')
    })
});
