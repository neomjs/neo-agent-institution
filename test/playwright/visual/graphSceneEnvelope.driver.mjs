import GraphSceneEnvelope from '../../../apps/agentos/util/GraphSceneEnvelope.mjs';

/**
 * @summary A test-only writer driver for the Observatory: loaded INTO the App worker through
 * `Neo.worker.App.loadModule`, it lands one fixture `fleetGraphScene` envelope in the cockpit StateProvider's
 * `graphSceneEnvelope` leaf the way the graph read does (`GraphSceneEnvelope.fromWire`, then `setData`), which
 * no remote of the App worker exposes, and optionally selects a node the way a click on it does. The fixture
 * instant sits on the visual suite's pinned 2026-07-05 day. Every distinct URL executes once (module cache),
 * so a spec varies the `t` parameter per call.
 *
 * `?state=current|team|crowded|truncated|degraded|routeless|unavailable[&select=<qualified id>]&t=<n>`
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
    // the Brain's attribution, state and recency on the same read, timed against this worker's clock, the one
    // the heat reads: Grace's and Vega's work around the route, the operator's closed issue and cold PR, Eos's
    // issue, and two of Euclid's the read cannot time or place
    hour       = 3600000,
    now        = Date.now(),
    team       = {
        'issue-12'        : {kind: 'ISSUE',        authoredBy: '@neo-opus-grace', assignedTo: ['@neo-opus-vega'], state: 'OPEN',   lastActivityAt: now - 2 * hour},
        'issue-8'         : {kind: 'ISSUE',        authoredBy: '@neo-opus-grace', assignedTo: [],                 state: 'OPEN',   lastActivityAt: now - 20 * hour},
        'issue-64'        : {kind: 'ISSUE',        authoredBy: '@neo-opus-vega',  assignedTo: [],                 state: 'OPEN',   lastActivityAt: now - 40 * hour},
        'issue-14800'     : {kind: 'ISSUE',        authoredBy: '@tobiu',          assignedTo: [],                 state: 'CLOSED', lastActivityAt: now - hour},
        'pr-212'          : {kind: 'PULL_REQUEST', authoredBy: '@neo-opus-vega',  assignedTo: [],                 state: 'MERGED', lastActivityAt: now - 3 * hour},
        'pr-499'          : {kind: 'PULL_REQUEST', authoredBy: '@neo-opus-grace', assignedTo: [],                 state: 'OPEN',   lastActivityAt: now - hour / 2},
        'pr-19227'        : {kind: 'PULL_REQUEST', authoredBy: '@tobiu',          assignedTo: [],                 state: 'OPEN',   lastActivityAt: now - 120 * hour},
        'issue-211'       : {kind: 'ISSUE',        authoredBy: '@neo-preview',    assignedTo: [],                 state: 'OPEN',   lastActivityAt: now - 10 * hour},
        'issue-498'       : {kind: 'ISSUE',        authoredBy: '@neo-gpt',        assignedTo: [],                 state: 'OPEN'},
        'discussion-19151': {kind: 'DISCUSSION',                                                                  state: 'OPEN',   lastActivityAt: now - 60 * hour},
        'issue-9999'      : {kind: 'ISSUE',        authoredBy: '@neo-gpt',        assignedTo: [],                                  lastActivityAt: now}
    },
    // the Brain's identity nodes name the team; beside them, an outside contributor's issue, whose author has none
    named      = [
        ...[['@neo-opus-grace', 'Grace'], ['@neo-opus-vega', 'Vega'], ['@neo-gpt', 'Euclid'], ['@neo-preview', 'Eos'], ['@tobiu', 'Operator']]
            .map(([login, label]) => ({id: q(login), label, kind: 'AgentIdentity'})),
        {id: q('issue-19400'), label: 'A first contribution', kind: 'ISSUE', authoredBy: '@a-contributor', assignedTo: [], state: 'OPEN', lastActivityAt: now - 5 * hour}
    ],
    // the side panel at full scale: 161 peers author 487 issues, 13 of them named, so the read lists 500 nodes;
    // the first issue's title runs to ninety characters
    logins     = Array.from({length: 161}, (_, i) => `@peer-${String(i).padStart(3, '0')}`),
    crowd      = {
        route : [],
        nodes : [
            ...Array.from({length: 487}, (_, i) => ({
                id        : q(`issue-${20000 + i}`),
                label     : i ? `crowded issue ${i}` : 'A ninety-character node title reads whole in this list, however many lines it has to take.',
                kind      : 'ISSUE',
                authoredBy: logins[i % logins.length]
            })),
            ...logins.slice(0, 13).map(login => ({id: q(login), label: login, kind: 'AgentIdentity'}))
        ],
        edges       : [],
        counts      : {nodes: 500, edges: 0, seeds: 0},
        budget      : {maxNodes: 500, maxEdges: 300, maxBytes: 65536},
        completeness: 'complete'
    },
    wires      = {
        crowded    : {capability: {state: 'current', reason: null}, scene: crowd, snapshotId: 'snap-c161', capturedAt},
        team       : {capability: {state: 'current', reason: null}, scene: {...scene, nodes: [...scene.nodes.map(node => ({...node, ...team[node.id.replace('neomjs/neo#', '')]})), ...named]}, snapshotId: 'snap-9c32', capturedAt},
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
