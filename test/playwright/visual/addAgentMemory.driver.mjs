/**
 * @summary The tests' Add agent memory driver: loaded into the App worker through `Neo.worker.App.loadModule`,
 * it hands the mounted Add agent form a fixture Fleet whose `fleetMemoryCandidates` answers with the queried
 * state, then lets the form read it through its own `readMemory`, so the frame renders the way an answer
 * renders it. The fixture instants sit on the visual suite's pinned 2026-07-05 day. Every distinct URL
 * executes once (module cache), so a spec varies the `t` parameter per call.
 *
 * `?state=candidates|eleven|unavailable&t=<n>`
 */
const
    state = new URL(import.meta.url).searchParams.get('state'),
    form  = Neo.manager.Component.find('ntype', 'fm-add-agent-form').find(component => component.mounted);

if (!form) {
    throw new Error('addAgentMemory driver: no fm-add-agent-form is mounted')
}

const answers = {
    candidates() {
        return {capability: {state: 'wired'}, count: 2, candidates: [
            {family: 'claude', source: '/home/operator/.claude/projects/-work/memory', name: 'Mnemosyne', notes: 12, lastChanged: '2026-07-05T08:00:00.000Z'},
            {family: 'codex',  source: '/home/operator/.codex/memories',               name: 'Hypatia',   notes: 3,  lastChanged: '2026-07-04T17:30:00.000Z'}
        ]}
    },
    eleven() {
        return {capability: {state: 'wired'}, count: 11, candidates: [
            {family: 'claude', source: '/home/operator/.claude/projects/-ada/memory',       name: 'Ada',       notes: 18, lastChanged: '2026-07-05T09:00:00.000Z'},
            {family: 'claude', source: '/home/operator/.claude/projects/-clio/memory',      name: 'Clio',      notes: 14, lastChanged: '2026-07-05T08:30:00.000Z'},
            {family: 'claude', source: '/home/operator/.claude/projects/-mnemosyne/memory', name: 'Mnemosyne', notes: 12, lastChanged: '2026-07-05T08:00:00.000Z'},
            {family: 'claude', source: '/home/operator/.claude/projects/-grace/memory',     name: 'Grace',     notes: 22, lastChanged: '2026-07-05T07:30:00.000Z'},
            {family: 'claude', source: '/home/operator/.claude/projects/-vega/memory',      name: 'Vega',      notes: 19, lastChanged: '2026-07-05T07:00:00.000Z'},
            {family: 'codex',  source: '/home/operator/.codex/memories/emmy',               name: 'Emmy',      notes: 11, lastChanged: '2026-07-05T06:30:00.000Z'},
            {family: 'codex',  source: '/home/operator/.codex/memories/euclid',             name: 'Euclid',    notes: 9,  lastChanged: '2026-07-05T06:00:00.000Z'},
            {family: 'codex',  source: '/home/operator/.codex/memories/hypatia',            name: 'Hypatia',   notes: 3,  lastChanged: '2026-07-04T17:30:00.000Z'},
            {family: 'gemini', source: '/home/operator/.gemini/memories/julia',             name: 'Julia',     notes: 16, lastChanged: '2026-07-04T15:00:00.000Z'},
            {family: 'kimi',   source: '/home/operator/.kimi/memories/iris',                name: 'Iris',      notes: 7,  lastChanged: '2026-07-04T12:00:00.000Z'},
            {family: 'kimi',   source: '/home/operator/.kimi/memories/eos',                 name: 'Eos',       notes: 5,  lastChanged: '2026-07-04T09:00:00.000Z'}
        ]}
    },
    // the installed bridge's shape for a failed read: the wire's words, and its state
    unavailable() {
        throw Object.assign(new Error("fleet: 'fleetMemoryCandidates' failed"), {fleetWireState: 'operation-failed'})
    }
};

if (!answers[state]) {
    throw new Error(`addAgentMemory driver: unknown state '${state}'`)
}

form.bridgeResolver = () => ({defineAgent: async () => null, fleetMemoryCandidates: async () => answers[state]()});

await form.readMemory();
