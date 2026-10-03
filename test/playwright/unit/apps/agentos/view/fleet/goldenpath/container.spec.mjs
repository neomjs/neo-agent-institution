import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: false,
        unitTestMode           : true,
        useDomApiRenderer      : false
    },
    appConfig: {name: 'GoldenPathPaneTest', isMounted: () => true, vnodeInitialising: false}
});

import {expect, test}     from '@playwright/test';
import Neo                from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core          from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import InstanceManager    from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import GoldenPathEnvelope from '../../../../../../../../apps/agentos/util/GoldenPathEnvelope.mjs';
import GoldenPathPane     from '../../../../../../../../apps/agentos/view/fleet/goldenpath/Container.mjs';

const
    CAPTURED_AT = '2026-09-25T06:00:00.000Z',
    EXPIRES_AT  = '2026-09-25T18:00:00.000Z',
    MARKDOWN    = `## Computed Golden Path (Strategic Recommendation)\n\nCaptured at: 2026-09-25 06:00 UTC\n\n1. **neo#210**: Score 0.87 (Semantic: 0.61, Structural: 0.26)\n   - *Golden Path pane carries the complete producer brief*\n\n### Strategic Interpretation\n\nThe producer's explanation stays whole, including this long interpretation paragraph.`,
    handoff     = overrides => ({markdown: MARKDOWN, mtimeMs: Date.parse('2026-09-25T06:05:00.000Z'), ageMs: 60000, staleAfterMs: 129600000, stale: false, reason: null, ...overrides}),
    route       = overrides => ({
        schemaVersion: 'computed-route.v1', status: 'fresh', freshness: {status: 'fresh'},
        capturedAt: CAPTURED_AT, expiresAt: EXPIRES_AT, expired: false, routeVersion: 'rv-7',
        provenance: {producer: 'golden-path-synthesizer', runId: 'run-42', algorithmVersion: 'gp-v2'},
        kind: 'computed-ranked', items: [{id: 'neo#210', title: 'Golden Path pane', score: 0.87, rank: 1, citations: []}], ...overrides
    }),
    envelope = ({handoff: handoffValue = handoff(), admission = {}, route: routeValue = route(), ...overrides} = {}) => GoldenPathEnvelope.fromWire({
        capability: {state: 'wired', capturedAt: '2026-09-25T16:00:00.000Z'},
        handoff   : handoffValue,
        admission : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: [], staleFacets: [], ...admission},
        route     : routeValue,
        rem       : {undigested: 990, digested: 1010, recentCycles: 0},
        sources   : {},
        ...overrides
    }),
    createPane = config => Neo.create(GoldenPathPane, {appName: 'GoldenPathPaneTest', ...config}),
    currencyOf = pane => pane.getReference('golden-path-currency'),
    handoffOf  = pane => pane.getReference('golden-path-markdown'),
    stateOf    = pane => pane.getReference('golden-path-handoff-state');

test.describe('AgentOS.view.fleet.goldenpath.Container — complete producer handoff beside typed route state', () => {
    test('renders the complete producer Markdown as the primary reader without duplicating route cards', () => {
        const pane = createPane({envelope: envelope()});

        expect(currencyOf(pane).text).toMatch(/^Typed route · current · captured /);
        expect(pane.getReference('golden-path-rem').text).toBe('REM · 990 undigested · 1010 digested · 0 recent cycles');
        expect(pane.getReference('golden-path-provenance').text).toMatch(/^golden-path-synthesizer · run run-42 · gp-v2 · expires /);
        expect(handoffOf(pane).value).toBe(MARKDOWN);
        expect(handoffOf(pane).virtualize, 'a complete handoff is a normal top-to-bottom reader').toBe(false);
        expect(stateOf(pane).text).toMatch(/^Recommendation source · updated /);
        expect(pane.getReference('golden-path-items')).toBeFalsy();

        pane.destroy()
    });

    test('the typed route reads first as one facts row and the recommendation is the flex column', () => {
        const
            pane  = createPane({envelope: envelope()}),
            facts = pane.getReference('golden-path-facts'),
            order = pane.items.map(item => item.reference || item.cls?.[0]);

        expect(facts.items.map(item => item.reference), 'currency, REM, run, the recommendation\'s source — the order of trust').toEqual([
            'golden-path-currency', 'golden-path-rem', 'golden-path-provenance', 'golden-path-handoff-state'
        ]);
        expect(facts.flex, 'the facts never shrink or scroll').toBe('none');
        expect(order.indexOf('golden-path-facts'), 'the facts sit directly under the head').toBe(1);
        expect(order.indexOf('golden-path-markdown'), 'the recommendation is the last item').toBe(pane.items.length - 1);
        expect(handoffOf(pane).flex, 'the column takes the remaining height and scrolls on its own').toBe(1);

        pane.destroy()
    });

    test('a route without a run id says so in words, never "unknown"', () => {
        const pane = createPane({envelope: envelope({route: route({provenance: {producer: 'GoldenPathSynthesizer', runId: null, algorithmVersion: 'golden-path.tri-vector.v1'}})})});

        expect(pane.getReference('golden-path-provenance').text).toMatch(/^GoldenPathSynthesizer · run id not recorded by the synthesizer · golden-path\.tri-vector\.v1 · expires /);
        expect(pane.getReference('golden-path-provenance').text).not.toContain('unknown');

        pane.envelope = envelope();
        expect(pane.getReference('golden-path-provenance').text).toMatch(/^golden-path-synthesizer · run run-42 · gp-v2 · expires /);

        pane.destroy()
    });

    test('keeps handoff freshness and availability independent from typed-route currency', () => {
        const pane = createPane({envelope: envelope({
            handoff : handoff({stale: true}),
            admission: {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached'}
        })});

        expect(currencyOf(pane).text).toMatch(/^Typed route · withheld · freshness-sla-breached/);
        expect(stateOf(pane).text).toMatch(/^Recommendation source stale · updated /);
        expect(handoffOf(pane).value).toBe(MARKDOWN);

        pane.envelope = envelope({handoff: handoff({markdown: null, mtimeMs: null, reason: 'handoff-not-found'})});
        expect(currencyOf(pane).text).toMatch(/^Typed route · current · captured /);
        expect(stateOf(pane).text).toBe('Recommendation unavailable · handoff-not-found');
        expect(handoffOf(pane).value).toBeNull();

        pane.destroy()
    });

    test('names an old-server handoff omission unavailable while retaining the typed route', () => {
        const pane = createPane({envelope: envelope({handoff: null})});

        expect(currencyOf(pane).text).toMatch(/^Typed route · current · captured /);
        expect(stateOf(pane).hidden).toBe(false);
        expect(stateOf(pane).text).toBe('Recommendation unavailable');
        expect(handoffOf(pane).value).toBeNull();

        pane.destroy()
    });

    test('reads are intent-only: construction and Refresh each fire one request', () => {
        const pane = createPane(), events = [];

        pane.fire = (name, data) => events.push([name, data]);
        pane.onRefreshClick();
        expect(events).toEqual([['goldenPathRequest', {}]]);

        pane.destroy()
    });
});
