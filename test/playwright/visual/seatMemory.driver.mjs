/**
 * @summary The tests' Memory row driver: loaded into the App worker through `Neo.worker.App.loadModule`, it opens the
 * mounted Seat group's Memory row on a fixture answer, the way its owner sets one, so the choice renders as an answer
 * renders it. The candidates are the Add agent memory driver's, on the visual suite's pinned 2026-07-05 day. Every
 * distinct URL executes once (module cache), so a spec varies the `t` parameter per call.
 *
 * `?state=candidates&t=<n>`
 */
const
    state = new URL(import.meta.url).searchParams.get('state'),
    row   = Neo.manager.Component.find('ntype', 'fm-seat-memory').find(component => component.mounted);

if (!row) {
    throw new Error('seatMemory driver: no fm-seat-memory is mounted')
}

const answers = {
    candidates: {state: 'candidates', candidates: [
        {family: 'claude', source: '/home/operator/.claude/projects/-work/memory', name: 'Mnemosyne', notes: 12, lastChanged: '2026-07-05T08:00:00.000Z'},
        {family: 'codex',  source: '/home/operator/.codex/memories',               name: 'Hypatia',   notes: 3,  lastChanged: '2026-07-04T17:30:00.000Z'}
    ]}
};

if (!answers[state]) {
    throw new Error(`seatMemory driver: unknown state '${state}'`)
}

row.set({editing: true, discovery: answers[state]});
