/**
 * @summary The honestly-labelled cockpit sample seeds — the zero-setup first paint the roster and
 * activity surfaces render before (or without) a wired fleet bridge. Data, not view code: the
 * cockpit's provider seeds its stores from here, and the surfaces label the sample state
 * themselves (`adapterState: 'sample'`).
 */

/**
 * Recent fleet activity for the fixture-fed stream — the live A2A / PR / lane adapters are the
 * sibling leaves; this seeds the §01 activity zone with representative events (newest last;
 * the stream reverses to newest-first). Payload texts carry the WHAT only: the row anatomy
 * renders WHO in the actor cell and TO in the recipient cell, so an actor name inside the text
 * would read twice on every row.
 * @type {Object[]}
 */
export const sampleActivity = [
    {eventId: 'fixture:lane-activity:1',   type: 'lane-activity',   agentId: 'neo-fable-clio',occurredAt: '2026-07-05T07:15:00.000Z', payload: {text: 'CrossWindowDragTarget docking, awaiting cross-family'}},
    {eventId: 'fixture:a2a-activity:1',    type: 'a2a-activity',    agentId: 'neo-opus-ada',  occurredAt: '2026-07-05T08:30:00.000Z', payload: {recipientClass: 'broadcast', text: 'control-plane restart actuator merged'}},
    {eventId: 'fixture:pr-activity:1',     type: 'pr-activity',     agentId: 'neo-opus-vega', occurredAt: '2026-07-05T09:40:00.000Z', payload: {text: 'merged — FM fleet grid + health bar'}},
    {eventId: 'fixture:pr-activity:2',     type: 'pr-activity',     agentId: 'neo-gpt',       occurredAt: '2026-07-05T10:11:00.000Z', payload: {text: 'opened a PR — roadmap cornerstone-4 hygiene'}},
    {eventId: 'fixture:review-activity:1', type: 'review-activity', agentId: 'neo-opus-vega', occurredAt: '2026-07-05T10:26:00.000Z', payload: {text: 'APPROVED — transaction archive Architectural Pillar'}},
    {eventId: 'fixture:a2a-activity:2',    type: 'a2a-activity',    agentId: 'neo-opus-vega', occurredAt: '2026-07-05T10:52:00.000Z', payload: {recipientClass: 'broadcast', text: '[lane-claim] harness-UI shell + nav'}}
];
