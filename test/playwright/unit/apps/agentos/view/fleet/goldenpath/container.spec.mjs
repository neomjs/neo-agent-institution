import {setup} from '../../../../../../setup.mjs';

const appName = 'GoldenPathPaneTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: false,
        unitTestMode           : true,
        useDomApiRenderer      : false
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {expect, test}     from '@playwright/test';
import Neo                from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core          from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import InstanceManager    from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import GoldenPathEnvelope from '../../../../../../../../apps/agentos/util/GoldenPathEnvelope.mjs';
import GoldenPathPane     from '../../../../../../../../apps/agentos/view/fleet/goldenpath/Container.mjs';

const CAPTURED_AT = '2026-09-25T06:00:00.000Z',
      EXPIRES_AT  = '2026-09-25T18:00:00.000Z';

/**
 * @summary A `fleetGoldenPath` envelope, landed the way the cockpit leaf holds it. Every state starts
 * from a current route and changes only what that state needs. An explicit `null` block lands blank.
 * @param {Object} [overrides]
 * @returns {Object}
 */
function envelope({admission = {}, route = {}, ...overrides} = {}) {
    return GoldenPathEnvelope.fromWire({
        capability: {state: 'wired', capturedAt: '2026-09-25T16:00:00.000Z'},
        admission : admission === null ? null : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: ['issues', 'discussions'], staleFacets: [], ...admission},
        route     : route === null ? null : {
            schemaVersion: 'computed-route.v1',
            status       : 'fresh',
            freshness    : {status: 'fresh'},
            capturedAt   : CAPTURED_AT,
            expiresAt    : EXPIRES_AT,
            expired      : false,
            routeVersion : 'rv-7',
            provenance   : {producer: 'golden-path-synthesizer', runId: 'run-42', algorithmVersion: 'gp-v2'},
            kind         : 'computed-ranked',
            items        : [
                {id: 'neo#19226', title: 'Sweep the notes', score: 0.91, rank: 2, citations: ['pull:19227', {id: 'issue:14800'}]},
                {id: 'neo#210',   title: 'Golden Path pane', score: 0.87, rank: 1, citations: []}
            ],
            ...route
        },
        rem    : {undigested: 990, digested: 1010, recentCycles: 0},
        sources: {},
        ...overrides
    })
}

function createPane(config = {}) {
    return Neo.create(GoldenPathPane, {appName, ...config})
}

const currencyOf = pane => pane.getReference('golden-path-currency'),
      itemsOf    = pane => pane.getReference('golden-path-items').items;

test.describe('AgentOS.view.fleet.goldenpath.Container — the computed route as text', () => {
    test('an unobserved pane says so and renders no route, before any binding and on the blank leaf', () => {
        for (const config of [{}, {envelope: GoldenPathEnvelope.blank()}]) {
            const pane = createPane(config);

            expect(currencyOf(pane).text).toBe('Golden Path not observed yet');
            expect(currencyOf(pane).cls).toContain('is-unobserved');
            expect(pane.getReference('golden-path-rem').text).toBe('');
            expect(pane.itemStore.getCount()).toBe(0);
            expect(itemsOf(pane)).toHaveLength(0);

            pane.destroy()
        }
    });

    test('an envelope bound while the pane is still constructing is applied, not dropped', () => {
        // the construction-time request answered synchronously, the way a bound provider write lands
        const pane = createPane({
            id       : 'golden-path-constructing',
            listeners: {goldenPathRequest: () => { Neo.get('golden-path-constructing').envelope = envelope() }}
        });

        expect(currencyOf(pane).cls).toContain('is-current');
        expect(pane.itemStore.getCount()).toBe(2);

        pane.destroy()
    });

    test('a current route leads with its currency and keeps the producer order, not the rank order', () => {
        const pane = createPane({envelope: envelope()});

        expect(currencyOf(pane).cls).toContain('is-current');
        expect(currencyOf(pane).text).toMatch(/^Current · captured /);
        expect(pane.getReference('golden-path-rem').text).toBe('REM · 990 undigested · 1010 digested · 0 recent cycles');

        const [first, second] = itemsOf(pane);

        expect(first.items[0].items.map(item => item.text)).toEqual(['#2', 'Sweep the notes', 'score 0.91']);
        expect(second.items[0].items.map(item => item.text)).toEqual(['#1', 'Golden Path pane', 'score 0.87']);
        expect(pane.getReference('golden-path-provenance').text).toMatch(/^golden-path-synthesizer · run run-42 · gp-v2 · expires /);

        pane.destroy()
    });

    test('a route the admission refuses is withheld: last known good, with the reason code and its capture time', () => {
        const pane = createPane({envelope: envelope({admission: {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached'}})});

        expect(currencyOf(pane).cls).toContain('is-withheld');
        expect(currencyOf(pane).text).toMatch(/^Withheld · freshness-sla-breached · last known good route, captured /);
        expect(pane.getReference('golden-path-items').cls).toContain('is-withheld');
        expect(pane.itemStore.getCount()).toBe(2);

        pane.destroy()
    });

    test('an admitted route that expired, or that its producer calls stale, is withheld too', () => {
        const expired = createPane({envelope: envelope({route: {expired: true}})}),
              stale   = createPane({envelope: envelope({route: {status: 'stale'}})});

        expect(currencyOf(expired).text).toMatch(/^Withheld · route-expired · /);
        expect(currencyOf(stale).text).toMatch(/^Withheld · route-stale · /);

        expired.destroy();
        stale.destroy()
    });

    test('a degraded source names the route reason and shows no items or provenance', () => {
        const pane = createPane({envelope: envelope({
            capability: {state: 'degraded', capturedAt: '2026-09-25T16:00:00.000Z', reason: 'route-sidecar-missing'},
            route     : null
        })});

        expect(currencyOf(pane).cls).toContain('is-degraded');
        expect(currencyOf(pane).text).toBe('Degraded · route-sidecar-missing');
        expect(itemsOf(pane)).toHaveLength(0);
        expect(pane.getReference('golden-path-provenance').text).toBe('');

        pane.destroy()
    });

    test('an unwired source is unavailable with the bridge reason, never an empty route', () => {
        const pane = createPane({envelope: GoldenPathEnvelope.fromWire({
            capability: {state: 'unavailable', reason: 'fleet golden path source not wired'}
        })});

        expect(currencyOf(pane).cls).toContain('is-unavailable');
        expect(currencyOf(pane).text).toBe('Unavailable · fleet golden path source not wired');
        expect(pane.getReference('golden-path-rem').text).toBe('');
        expect(itemsOf(pane)).toHaveLength(0);

        pane.destroy()
    });

    test('items render as written: repeated ids survive, citations are labelled and bounded, an empty route says so', () => {
        const repeated = createPane({citationLimit: 1, envelope: envelope({route: {items: [
                  {id: 'neo#1', title: 'first', score: null, rank: null, citations: ['a', {ref: 'b'}, 42, {id: 'c'}]},
                  {id: 'neo#1', title: 'again', score: 0.5, rank: 3, citations: []}
              ]}})}),
              empty    = createPane({envelope: envelope({route: {items: [], kind: 'none'}})}),
              [first, again] = itemsOf(repeated);

        expect(repeated.itemStore.getCount()).toBe(2);
        expect(first.items[0].items.map(item => item.text)).toEqual(['—', 'first', '']);
        expect(first.items[1].text).toBe('neo#1 · a · 2 more');
        expect(again.items[0].items[1].text).toBe('again');
        expect(itemsOf(empty)[0].text).toBe('No items in this route · kind none');

        repeated.destroy();
        empty.destroy()
    });

    test('reads are intent-only: construction and Refresh each fire one request', () => {
        const pane   = createPane(),
              events = [];

        pane.fire = (name, data) => events.push([name, data]);
        pane.onRefreshClick();

        expect(events).toEqual([['goldenPathRequest', {}]]);

        pane.destroy()
    });
});
