/**
 * @summary The tests' Home driver: loaded into the App worker through `Neo.worker.App.loadModule`, it lands
 * `shellPlaneConfigured` the way the ViewportController publishes it at boot (`setData`, whose closest-owner
 * walk reaches the Viewport provider's key), so a browser run can put Home in front of a packaged shell
 * without a plane. `instanceState` is not landed: the cockpit's formula owns it and rewrites it on its next
 * tick, so specs reach its states through the cockpit (a cold boot, a landed fleet).
 *
 * With `merges=N` it also lands an answered open-work read and N rows in the merge queue, the way the
 * cockpit's open-work read projects one (`OpenWorkRead`); `staleMinutes=M` lands that answer stale and M
 * minutes old. That read runs at mount and then once a minute, so a capture taken right after landing
 * shows the landed answer. `questions=N` lands a known questions axis of N on Home; without it the axis
 * keeps whatever it holds (unreadable by default).
 * Query: `shellPlaneConfigured=false` (anything else lands `null`), `merges=N`, `staleMinutes=M`, `questions=N`.
 */
const
    home   = Neo.manager.Component.findFirst('ntype', 'fm-home-view'),
    params = new URL(import.meta.url).searchParams;

if (!home) {
    throw new Error('homeState driver: no fm-home-view is mounted')
}

const provider = home.getStateProvider();

provider.setData({
    shellPlaneConfigured: params.get('shellPlaneConfigured') === 'false' ? false : null
});

if (params.has('merges')) {
    const
        staleMinutes = Number(params.get('staleMinutes') ?? 0),
        observedAt   = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

    provider.setData({openWork: {coverage: 'complete', observedAt, reason: null, state: staleMinutes > 0 ? 'stale' : 'ok'}});
    provider.getStore('fleetAwaitingMerge').data = Array.from({length: Number(params.get('merges'))}, (_, i) => ({
        ci: 'success', draft: false, id: `neomjs/neo#${100 + i}`, mergeable: true, number: 100 + i, observedAt, repo: 'neomjs/neo', stale: false
    }))
}

if (params.has('questions')) {
    home.questions = {state: 'known', count: Number(params.get('questions'))}
}
