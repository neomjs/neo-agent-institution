import GoldenPathEnvelope from '../../../apps/agentos/util/GoldenPathEnvelope.mjs';

/**
 * @summary A test-only writer driver for the Golden Path panes: loaded INTO the App worker through
 * `Neo.worker.App.loadModule`, it lands one fixture wire envelope in the cockpit StateProvider's
 * `goldenPathEnvelope` leaf the way the Golden Path read does (`GoldenPathEnvelope.fromWire`, then
 * `setData`), which no remote of the App worker exposes. The fixture instants sit on the visual
 * suite's pinned 2026-07-05 day. Every distinct URL executes once (module cache), so a spec varies
 * the `t` parameter per call.
 *
 * `?state=current|withheld|degraded|unavailable&t=<n>`
 */
const
    params   = new URL(import.meta.url).searchParams,
    state    = params.get('state'),
    cockpit  = Neo.manager.Component.findFirst('ntype', 'fm-fleet-cockpit'),
    provider = cockpit?.getStateProvider();

if (!provider) {
    throw new Error('goldenPathEnvelope.driver: no fm-fleet-cockpit with a state provider is mounted')
}

const
    capturedAt = '2026-07-05T09:30:00.000Z',
    // four ranked items; a citation shared by two neighbours is drawn once between them — the edges
    items      = [
        {id: 'issue:12',    title: 'The shell shows the live roster through the plane',      score: 9.1, rank: 1, citations: [{id: 'pull:212'}, {id: 'issue:211'}]},
        {id: 'issue:8',     title: 'Golden Path currency on the cockpit',                   score: 7.4, rank: 2, citations: [{id: 'issue:211'}, {id: 'pull:499'}]},
        {id: 'issue:64',    title: 'REM digests the backlog before the next cut',           score: 5.2, rank: 3, citations: [{id: 'pull:499'}, {id: 'issue:498'}]},
        {id: 'issue:14800', title: 'The release notes sweep the merges since the last cut', score: 3.3, rank: 4, citations: [{id: 'pull:19227'}]}
    ],
    route      = {
        schemaVersion: 'computed-route.v1',
        status       : 'fresh',
        capturedAt,
        expiresAt    : '2026-07-05T11:30:00.000Z',
        expired      : false,
        routeVersion : 'r-17',
        kind         : 'computed-ranked',
        freshness    : {status: 'fresh', checkedAt: capturedAt, expiresAt: '2026-07-05T11:30:00.000Z'},
        provenance   : {producer: 'golden-path-synthesizer', runId: 'run-9', algorithmVersion: 'v1'},
        items
    },
    rem        = {undigested: 0, digested: 1010, recentCycles: 3},
    wires      = {
        'current': {
            capability: {state: 'wired', capturedAt},
            admission : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: ['issues', 'discussions'], staleFacets: []},
            rem,
            route,
            sources   : {route: {state: 'wired', reason: null}, admission: {state: 'current', reason: 'current'}, rem: {state: 'wired', reason: null}}
        },
        'withheld': {
            capability: {state: 'wired', capturedAt},
            admission : {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: ['issues', 'discussions'], staleFacets: ['discussions']},
            rem       : {undigested: 990, digested: 1010, recentCycles: 0},
            route     : {...route, status: 'stale', capturedAt: '2026-07-04T18:40:00.000Z', expiresAt: '2026-07-04T20:40:00.000Z', expired: true},
            sources   : {route: {state: 'wired', reason: null}, admission: {state: 'withheld', reason: 'freshness-sla-breached'}, rem: {state: 'wired', reason: null}}
        },
        'degraded': {
            capability: {state: 'degraded', capturedAt, reason: 'route-sidecar-missing'},
            admission : {admitted: true, fallback: 'current', reasonCode: 'current', requiredFacets: ['issues'], staleFacets: []},
            rem       : {undigested: 990, digested: 1010, recentCycles: 0},
            route     : null,
            sources   : {route: {state: 'degraded', reason: 'route-sidecar-missing'}, admission: {state: 'current', reason: 'current'}, rem: {state: 'wired', reason: null}}
        },
        'unavailable': {
            capability: {state: 'unavailable', reason: 'fleet golden path source not wired'},
            admission : null,
            rem       : null,
            route     : null
        }
    };

if (!wires[state]) {
    throw new Error(`goldenPathEnvelope.driver: unknown state "${state}"`)
}

provider.setData({goldenPathEnvelope: GoldenPathEnvelope.fromWire(wires[state])});

export default {state};
