import GraphSceneEnvelope from '../../../apps/agentos/util/GraphSceneEnvelope.mjs';

/**
 * @summary A test-only writer driver for the Observatory: loaded INTO the App worker through
 * `Neo.worker.App.loadModule`, it lands one fixture `fleetGraphScene` envelope in the cockpit StateProvider's
 * `graphSceneEnvelope` leaf the way the graph read does (`GraphSceneEnvelope.fromWire`, then `setData`), which
 * no remote of the App worker exposes, and optionally selects a node the way a click on it does. The fixture
 * instant sits on the visual suite's pinned 2026-07-05 day. Every distinct URL executes once (module cache),
 * so a spec varies the `t` parameter per call.
 *
 * `?state=current|truncated|degraded|routeless|unavailable[&select=<qualified id>]&t=<n>`
 */
const
    params   = new URL(import.meta.url).searchParams,
    state    = params.get('state'),
    select   = params.get('select'),
    cockpit  = Neo.manager.Component.findFirst('ntype', 'fm-fleet-cockpit'),
    provider = cockpit?.getStateProvider();

if (!provider) {
    throw new Error('graphSceneEnvelope.driver: no fm-fleet-cockpit with a state provider is mounted')
}

const
    q          = id => `neomjs/neo#${id}`,
    capturedAt = '2026-07-05T09:30:00.000Z',
    link       = (from, to, type) => type ? {from: q(from), to: q(to), type} : {from: q(from), to: q(to)},
    // four seeds; authors, fixes and concepts around them; a discussion two hops out, a concept three, one
    // node no seed reaches; two relations the graph left untyped
    scene      = {
        route: ['issue-12', 'issue-8', 'issue-64', 'issue-14800'].map(q),
        nodes: [
            ['issue-12',         'The shell shows the live roster through the plane',      'issue'],
            ['issue-8',          'Golden Path currency on the cockpit',                    'issue'],
            ['issue-64',         'REM digests the backlog before the next cut',            'issue'],
            ['issue-14800',      'The release notes sweep the merges since the last cut', 'issue'],
            ['agent-grace',      'Grace',                                                  'agent'],
            ['agent-vega',       'Vega',                                                   'agent'],
            ['pr-212',           'Live roster attach',                                     'pull'],
            ['pr-499',           'Currency line reads the admission',                      'pull'],
            ['pr-19227',         'Release notes corpus',                                   'pull'],
            ['issue-211',        'Roster rows lose their profile on reconnect',            'issue'],
            ['issue-498',        'Heavy-maintenance lease starves the dream lane',         'issue'],
            ['concept-golden-path', 'Golden Path',                                         'concept'],
            ['concept-rem',      'REM pipeline',                                           'concept'],
            ['concept-dock',     'Dock layouts',                                           'concept'],
            ['discussion-19151', 'The Fleet Manager graph',                                'discussion'],
            ['issue-9999',       'An island in this read',                                 'issue']
        ].map(([id, label, kind]) => ({id: q(id), label, kind})),
        edges: [
            link('agent-grace',         'issue-12',         'authored'),
            link('agent-grace',         'issue-8',          'authored'),
            link('agent-vega',          'issue-64',         'authored'),
            link('pr-212',              'issue-12',         'resolves'),
            link('pr-499',              'issue-8',          'resolves'),
            link('pr-499',              'issue-64',         'mentions'),
            link('issue-211',           'issue-12'),
            link('issue-211',           'issue-8',          'relates'),
            link('concept-golden-path', 'issue-8',          'tagged'),
            link('concept-golden-path', 'issue-12',         'tagged'),
            link('concept-rem',         'issue-64',         'tagged'),
            link('concept-rem',         'issue-498',        'tagged'),
            link('pr-19227',            'issue-14800',      'resolves'),
            link('discussion-19151',    'concept-golden-path', 'mentions'),
            link('concept-dock',        'discussion-19151')
        ],
        counts      : {nodes: 16, edges: 15, seeds: 4},
        budget      : {maxNodes: 150, maxEdges: 300, maxBytes: 32768},
        completeness: 'complete'
    },
    wires      = {
        current    : {capability: {state: 'current', reason: null}, scene, snapshotId: 'snap-7f3a', capturedAt},
        truncated  : {capability: {state: 'current', reason: null}, scene: {...scene, completeness: 'truncated'}, snapshotId: 'snap-8b21', capturedAt},
        degraded   : {capability: {state: 'degraded', reason: 'graph-seam-refused'}, scene, snapshotId: 'snap-7f3a', capturedAt},
        routeless  : {capability: {state: 'degraded', reason: 'route-not-found'}, scene: null, snapshotId: null, capturedAt},
        unavailable: {capability: {state: 'unavailable', reason: 'fleet graph scene verb not wired'}}
    };

if (!wires[state]) {
    throw new Error(`graphSceneEnvelope.driver: unknown state "${state}"`)
}

provider.setData({graphSceneEnvelope: GraphSceneEnvelope.fromWire(wires[state])});

if (select) {
    Neo.manager.Component.findFirst('ntype', 'fm-observatory-pane').onNodeSelect({node: {id: select}})
}

export default {state, select};
