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
