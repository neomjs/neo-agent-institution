/**
 * @summary The tests' Memories driver: loaded into the App worker through `Neo.worker.App.loadModule`, it gives the
 * cockpit's bridge a fixture `fleetMemories` answer, then writes the roster selection through to the mounted Memories
 * pane the way the owner's `applySelection` does, so the owner reads the answer through its own `loadMemories` and the
 * pane renders it the way an answer renders. Three summaries on the visual suite's pinned 2026-07-05 day, newest first;
 * the page holds the whole corpus, so the register asks for no second window. Every distinct URL executes once (module
 * cache), so a spec varies the `t` parameter per call.
 *
 * `?state=three&t=<n>`
 */
const
    state   = new URL(import.meta.url).searchParams.get('state'),
    cockpit = Neo.manager.Component.findFirst('ntype', 'fm-fleet-cockpit'),
    pane    = cockpit?.getMemoriesPane(),
    bridge  = globalThis.AgentOS?.fleet?.registryBridge;

if (!pane?.mounted || !bridge) {
    throw new Error('memoriesEnvelope driver: no mounted fm-memories-pane, or no cockpit bridge to answer through')
}

const
    target  = '@neo-opus-ada',
    summary = (id, sessionId, timestamp, title, text, category, memoryCount, sourceAgentIdentities = [target]) => ({
        id, sessionId, timestamp, title, summary: text, category, memoryCount, quality: 90, impact: 40, sourceAgentIdentities
    });

const corpora = {
    three: [
        summary('summary-3', '9286a9c0-91be', '2026-07-05T08:00:00.000Z', 'Wake transport and integrity contracts',
            'Established verifiable wake transport between plane and host: both probes returned signed receipts, and the host replayed them in order.',
            'feature', 61, [target, '@neo-gpt-emmy']),
        summary('summary-2', '36ea85e4-fcdc', '2026-07-04T17:30:00.000Z', 'Terminal audit for a grid PR',
            'Verified five required actions without repository mutation.', 'analysis', 12),
        summary('summary-1', '1b2c3d4e-5f60', '2026-07-03T11:00:00.000Z', 'Dock layouts survive a reload',
            'The committed document restored every zone and tab after the shell reloaded.', 'fix', 7)
    ]
};

const sessions = corpora[state];

if (!sessions) {
    throw new Error(`memoriesEnvelope driver: unknown state '${state}'`)
}

bridge.fleetMemories = async ({offset = 0} = {}) => ({
    capability: {state: 'wired', capturedAt: '2026-07-05T09:30:00.000Z'},
    viewer    : '@visual-operator',
    target,
    page      : {offset, limit: 20},
    sessions  : offset ? [] : sessions,
    count     : offset ? 0 : sessions.length,
    total     : sessions.length
});

cockpit.getController().memoriesTarget = target;
pane.set({activeAgent: target});
