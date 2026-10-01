/**
 * @summary The tests' sample fleet — eleven roster rows and six activity events, the data the cockpit
 * used to seed itself with. Tests own it: a spec that needs cards or events lands it through
 * `FleetLanding.mjs` (e2e, visual) or imports it (unit, component). The app ships none of it.
 */

/**
 * The roster source block every sample row carries: an unobserved, not-wired static snapshot.
 * @returns {Object}
 */
const staticSources = () => ({
    roster: {
        source    : 'fleet:listAgents',
        state     : 'not-wired',
        confidence: 'none',
        reason    : 'static roster (identityRoots snapshot) · unobserved'
    }
});

/**
 * @param {String} agentId The registry id, also the GitHub login.
 * @param {String} displayName
 * @param {String|null} engineTag
 * @param {String} family
 * @param {Object} [facts]
 * @param {String} [facts.state='ok']
 * @param {String} [facts.participationStatus='active']
 * @param {String|null} [facts.laneLine=null]
 * @returns {Object} One `AgentOS.model.FleetAgent` row.
 */
const agent = (agentId, displayName, engineTag, family, {state = 'ok', participationStatus = 'active', laneLine = null} = {}) => ({
    agentId,
    githubUsername: agentId,
    displayName,
    engineTag,
    family,
    state,
    avatarUrl     : `https://github.com/${agentId}.png?size=80`,
    laneLine,
    participationStatus,
    openLaneCount : null,
    sources       : staticSources()
});

const benchedKimi = 'Operator-benched 2026-08-17: flatrate cancelled after the provider reduced the effective weekly allowance ~3-5x without announcement; no fault attaches to the seat';

/**
 * The eleven sample agents, in the registry's order.
 * @type {Object[]}
 */
export const sampleRoster = [
    agent('neo-opus-ada',    'Ada',            'opus-5',      'claude'),
    agent('neo-opus-grace',  'Grace',          'opus-5',      'claude'),
    agent('neo-opus-vega',   'Vega',           null,          'claude'),
    agent('neo-fable',       'Mnemosyne',      'fable-5',     'claude'),
    agent('neo-fable-clio',  'Clio',           'fable-5',     'claude'),
    agent('neo-gemini-pro',  'Neo Gemini Pro', '3.1-pro',     'gemini', {state: 'off', participationStatus: 'operator_benched', laneLine: 'Operator-benched pending a stable Gemini Pro-class harness'}),
    agent('neo-gpt',         'Euclid',         'gpt-5.6-sol', 'gpt'),
    agent('neo-gpt-emmy',    'Emmy',           'gpt-5.6-sol', 'gpt'),
    agent('neo-kimi-phoebe', 'Phoebe',         'kimi-k3',     'kimi',   {state: 'off', participationStatus: 'operator_benched', laneLine: benchedKimi}),
    agent('neo-kimi-iris',   'Iris',           'kimi-k3',     'kimi',   {state: 'off', participationStatus: 'operator_benched', laneLine: benchedKimi}),
    agent('neo-preview',     'Eos',            null,          'unknown')
];

/**
 * Three sample agent definitions, shaped like the registry's public readback: one per harness kind
 * the Accounts view must name — a Claude app, a Codex app, a single-type product (Kimi Code) — and
 * one per repository shape: a working repository with two others, a working repository alone, and
 * none. No credential field exists on the public shape.
 * @type {Object[]}
 */
export const sampleDefinitions = [
    {id: 'neo-opus-ada',    githubUsername: 'neo-opus-ada',    displayName: 'Ada',    harnessType: 'claude-desktop', launchOwner: 'fleet',    mcpServers: null, mcpTarget: null, metadata: {
        repo : {repoSlug: 'neomjs/neo', cloneUrl: 'https://github.com/neomjs/neo.git'},
        repos: [
            {repoSlug: 'neomjs/neo-agent-brain',       cloneUrl: 'https://github.com/neomjs/neo-agent-brain.git'},
            {repoSlug: 'neomjs/neo-agent-institution', cloneUrl: 'https://github.com/neomjs/neo-agent-institution.git'}
        ]
    }},
    {id: 'neo-gpt-sophie',  githubUsername: 'neo-gpt-sophie',  displayName: 'Sophie', harnessType: 'codex-desktop',  launchOwner: 'fleet',    mcpServers: null, mcpTarget: null, metadata: {
        repo: {repoSlug: 'neomjs/neo', cloneUrl: 'https://github.com/neomjs/neo.git'}
    }},
    {id: 'neo-kimi-phoebe', githubUsername: 'neo-kimi-phoebe', displayName: 'Phoebe', harnessType: 'kimi-code',      launchOwner: 'external', mcpServers: null, mcpTarget: null}
];

/**
 * Six sample activity events, oldest first (the stream renders newest first). Payload texts carry
 * the WHAT only: the row renders WHO in the actor cell and TO in the recipient cell.
 * @type {Object[]}
 */
export const sampleActivity = [
    {eventId: 'fixture:lane-activity:1',   type: 'lane-activity',   agentId: 'neo-fable-clio', occurredAt: '2026-07-05T07:15:00.000Z', payload: {text: 'CrossWindowDragTarget docking, awaiting cross-family'}},
    {eventId: 'fixture:a2a-activity:1',    type: 'a2a-activity',    agentId: 'neo-opus-ada',   occurredAt: '2026-07-05T08:30:00.000Z', payload: {recipientClass: 'broadcast', text: 'control-plane restart actuator merged'}},
    {eventId: 'fixture:pr-activity:1',     type: 'pr-activity',     agentId: 'neo-opus-vega',  occurredAt: '2026-07-05T09:40:00.000Z', payload: {text: 'merged — FM fleet grid + health bar'}},
    {eventId: 'fixture:pr-activity:2',     type: 'pr-activity',     agentId: 'neo-gpt',        occurredAt: '2026-07-05T10:11:00.000Z', payload: {text: 'opened a PR — roadmap cornerstone-4 hygiene'}},
    {eventId: 'fixture:review-activity:1', type: 'review-activity', agentId: 'neo-opus-vega',  occurredAt: '2026-07-05T10:26:00.000Z', payload: {text: 'APPROVED — transaction archive Architectural Pillar'}},
    {eventId: 'fixture:a2a-activity:2',    type: 'a2a-activity',    agentId: 'neo-opus-vega',  occurredAt: '2026-07-05T10:52:00.000Z', payload: {recipientClass: 'broadcast', text: '[lane-claim] harness-UI shell + nav'}}
];

/**
 * @summary A dense, test-owned task answer for the visual width bands: a determinate run, a
 * starved waiter with its own cause and flags, a mixed-source queue, a completion, and the
 * scheduler lease line. The app never imports this envelope.
 * @type {Object}
 */
export const sampleTasks = {
    capability: {state: 'wired', capturedAt: '2026-09-05T12:50:00.000Z'},
    viewer    : '@fixture-operator',
    sources   : {
        deployment: {state: 'wired', reason: null, observedAt: '2026-09-05T12:47:55.668Z'},
        rem       : {state: 'wired', reason: null},
        ingestion : {state: 'unwired', reason: 'ingestion-verb-unreachable-from-this-process', scope: null}
    },
    scheduler: {leaseHolder: 'summary', leaseStatus: 'active', posture: 'degraded', checkedAt: '2026-09-05T12:49:36.362Z', degradeAfterMs: 3_600_000, starvedTotal: 1, unreadableCount: 0},
    running  : [
        {id: 'fixture:running', section: 'running', name: 'Tenant repo sync', source: 'orchestrator', state: 'in progress', at: null, progress: {kind: 'determinate', done: 42, total: 100}, detail: null}
    ],
    queued: [
        {id: 'fixture:queued', section: 'queued', name: 'Repo sync · 1a2b3c4d', source: 'orchestrator', state: 'scheduled', at: null, progress: null, detail: null},
        {id: 'fixture:starved', section: 'queued', name: 'core-corpus-projection', source: 'orchestrator', state: 'starved', at: '2026-07-05T06:13:43.059Z', progress: null, detail: null, waitMs: 42_300_000, thresholdMs: 3_600_000, reasonCode: 'heavy-maintenance-yield-to-waiter', blockingTaskName: 'dream', leaseOwner: null, priorityZero: true, bootstrapCritical: true},
        {id: 'fixture:digest', section: 'queued', name: 'REM digest', source: 'mc', state: 'backlog', at: null, progress: {kind: 'backlog', done: 1040, total: 2000}, detail: '960 undigested · 1040 digested'}
    ],
    recent: [
        {id: 'fixture:recent', section: 'recent', name: 'KB ingestion', source: 'kb', state: 'completed', at: null, progress: null, detail: null}
    ],
    counts: {running: 1, queued: 3, recent: 1, queuedKnown: 3}
};
