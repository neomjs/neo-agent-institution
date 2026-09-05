import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitSpineBannerPipelineTest'
    }
});

import {test, expect}                                                   from '@playwright/test';
import {EventEmitter}                                                   from 'node:events';
import {createAppLifecycle}                                             from '../../../../../../../../harness/appLifecycle.mjs';
import path                                                             from 'path';
import Neo                                                              from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                                                        from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                                                                       '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import {makeActivityStoreHarness, makeControllerFake, makeProviderFake} from './cockpitFakes.mjs';
import {installFleetBridge}                                             from '../../../../../../../../apps/agentos/fleet/installFleetBridge.mjs';
import {createFleetWireResponse}                                        from 'neo-agent-brain/fleet-contract';

/**
 * The slot-sync consumer witness: `syncSpineBanner` against a REAL recording banner slot — the
 * derivation lands on the component (cls hook + hidden + text) and a missing slot stays a guarded
 * no-op. This suite also carries the liveness owner's transition matrix, because the transition is
 * only real if it reaches the slot: a state that moves without the banner moving is the same silent
 * failure as never moving at all.
 */
test.describe('Fleet cockpit — the spine-banner pipeline (formula → component)', () => {
    let CockpitStateProvider, FleetCockpitController, SpineBannerComponent;

    test.beforeAll(async () => {
        CockpitStateProvider   = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/StateProvider.mjs')).default;
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        SpineBannerComponent   = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/SpineBannerComponent.mjs')).default
    });

    const clearBridge = () => { delete globalThis.AgentOS?.fleet };

    test.afterEach(() => clearBridge());

    // The full provider data surface with honest defaults — the formulas run against exactly the
    // shape the provider declares, so a formula reading a key the provider never declared fails
    // here instead of silently reading undefined in production.
    const provData = (over = {}) => ({
        activityCounts: [], boundProfileId: null, daemonDegradedReason: null, daemonState: null,
        gridAdapterState: 'sample', gridDegradedReason: null, presenceCapability: null,
        selectedAgentId: null, selectedAgentIdentity: null, shellTransport: null,
        streamAdapterState: 'sample', streamDegradedReason: null, ...over
    });

    // the REAL formulas over the full declared data surface — pull-based: each formula reads
    // its source keys directly, so driving them with plain data is exactly the production path
    const deriveTruths = data => {
        const
            full       = provData(data),
            {formulas} = CockpitStateProvider.config;

        return {
            daemonFault  : formulas.daemonFault(full),
            instanceState: formulas.instanceState(full),
            spineBanner  : formulas.spineBanner(full)
        }
    };

    const verdictOf = data => deriveTruths(data).spineBanner;

    // …and the render half that remains component-local: the title mirror. The banner is
    // presentation-thin — the slot binds text/cls/hidden from the derived data, and afterSetText
    // carries the full sentence onto the vdom `title` (the drill-free detail).
    // #23: text and title are independent channels now — the component's title write happens on
    // the bannerTitle beat, never as a text mirror. This drives the REAL afterSet path.
    const titleAfterBannerTitle = title => {
        const fake = Object.create(SpineBannerComponent.prototype);

        Object.defineProperty(fake, 'vdom',    {configurable: true, enumerable: true, value: {}, writable: true});
        Object.defineProperty(fake, 'mounted', {configurable: true, enumerable: true, value: false, writable: true});

        fake.afterSetBannerTitle(title, null);

        return fake.vdom.title
    };

    // ⭐ The daemon surface reaching the REAL render. The derivation being correct is a separate
    // suite (spineBanner.spec); this asserts the pipeline actually FEEDS it — formula in, component
    // write out — because a derivation nothing feeds is indistinguishable from an absent feature.
    test('⭐ a dead daemon reaches the derived truth with the diagnosis, outranking a stale feed', () => {
        const verdict = verdictOf({
            daemonDegradedReason: 'orchestrator exited',
            daemonState         : 'stopped',
            gridAdapterState    : 'live',
            streamAdapterState  : 'stale'
        });

        expect(SpineBannerComponent.config.baseCls).toEqual(['fm-spine-banner']);
        expect(verdict.kind).toBe('degraded');
        expect(verdict.hidden).toBe(false);
        expect(verdict.text).toContain('stopped');
        expect(verdict.title).toContain('orchestrator exited');
        // The stale feed is the symptom; it must not be the sentence.
        expect(verdict.title).not.toContain('last-known data');
        // the full sentence rides the title as the drill-free detail — the component's own
        // afterSet writes the ATTRIBUTE from the title channel
        expect(titleAfterBannerTitle(verdict.title)).toBe(verdict.title)
    });

    test('the chrome dot mirrors the banner verdict — one truth, two renderers', () => {
        // The instance NAME lives on the switcher beside this banner (the one name authority in
        // the chrome); the banner speaks the verdict scope-free, and the dot derives from the
        // SAME verdict in the SAME pass — no sync path that could let them disagree.
        const data = {
            daemonDegradedReason: 'orchestrator exited',
            daemonState         : 'stopped',
            gridAdapterState    : 'live',
            streamAdapterState  : 'stale'
        };

        const truths = deriveTruths(data);

        expect(truths.spineBanner.title).toContain('orchestrator exited');
        expect(truths.instanceState).toBe('limited');
        expect(truths.daemonFault).toBe(true)
    });

    test('a LIVE spine hides the line and mirrors ok on the dot', () => {
        const data   = {gridAdapterState: 'live', streamAdapterState: 'live'},
              truths = deriveTruths(data);

        expect(truths.spineBanner.hidden).toBe(true);
        expect(truths.spineBanner.text).toBe('');
        expect(truths.instanceState).toBe('ok')
    });

    test('⭐ an unfed daemon surface stays SILENT on a live owner — absence claims nothing', () => {
        // `daemonState` is null until the runtime pull lands. This asserts the default is honest
        // silence rather than an implicit "the organism is fine", which is what defaulting to
        // `'running'` would have asserted on the strength of never having asked.
        const verdict = verdictOf({gridAdapterState: 'live', streamAdapterState: 'live'});

        expect(verdict.hidden).toBe(true);
        expect(verdict.text).toBe('')
    });

    test('the daemonFault fold derives from the SAME fault set the banner ranks', () => {
        expect(deriveTruths({daemonState: 'stopped'}).daemonFault).toBe(true);
        expect(deriveTruths({daemonState: 'degraded'}).daemonFault).toBe(true);
        expect(deriveTruths({daemonState: 'running'}).daemonFault).toBe(false);
        // silence is not a fault — the header must not dim on the strength of never having asked
        expect(deriveTruths({daemonState: null}).daemonFault).toBe(false)
    });

    // the apply-side witness: a controller fake with the REAL applyBrainHealth writing the provider
    const makeDaemonHost = () => {
        const provider = makeProviderFake({gridAdapterState: 'live', streamAdapterState: 'live'}),
              host     = makeControllerFake(FleetCockpitController, {
                  component: {getStateProvider: () => provider}
              });

        return {host, provider}
    };

    // ⭐ The producer→controller→provider witness the predecessor lacked: the SHELL transition
    // drives the surface. A test that hand-assigns `daemonState` witnesses only a pass-through.
    test('⭐ a SHELL transition drives the surface: lifecycle owner → wire payload → provider truth', () => {
        const
            child     = new EventEmitter(),
            lifecycle = createAppLifecycle({
                app          : Object.assign(new EventEmitter(), {exit() {}, quit() {}}),
                teardownBrain: async () => ({})
            }),
            {host, provider} = makeDaemonHost();

        lifecycle.setBrainState('running');
        lifecycle.watchBrainChild(child, 'orchestrator');
        child.emit('error', new Error('spawn ENOENT'));

        // The payload is the producer's own wire truth, never test-fabricated consumer state.
        host.applyBrainHealth(lifecycle.brainHealth);

        expect(provider.data.daemonState).toBe('degraded');

        let verdict = verdictOf(provider.data);
        expect(verdict.hidden).toBe(false);
        expect(verdict.text).toContain('degraded');
        expect(verdict.title).toContain('orchestrator: error spawn ENOENT');

        // Recovery is ALSO the shell's transition — the owner's `running` write.
        lifecycle.setBrainState('running');
        host.applyBrainHealth(lifecycle.brainHealth);

        expect(provider.data.daemonState).toBe('running');
        expect(provider.data.daemonDegradedReason).toBeNull();
        expect(verdictOf(provider.data).hidden).toBe(true)
    });

    test('⭐ transport failure never impersonates recovery: fault → dead transport → retained; only running clears', () => {
        const {host, provider} = makeDaemonHost();

        // a real fault from the lifecycle owner
        host.applyBrainHealth({cause: {detail: 'orchestrator: exit code 1', observedAt: 1, source: 'owned-child-termination'}, state: 'degraded'});

        expect(provider.data.daemonState).toBe('degraded');
        expect(verdictOf(provider.data).title).toContain('orchestrator: exit code 1');

        // the transport dies: an unavailable envelope AND a rejection-mapped null. A dead transport
        // is not a recovered organism — the KNOWN fault must stay visible, not be erased.
        host.applyBrainHealth({error: 'brain: shell health capability unavailable', ok: false});
        host.applyBrainHealth(null);

        expect(provider.data.daemonState).toBe('degraded');
        expect(provider.data.daemonDegradedReason).toBe('orchestrator: exit code 1');

        // ONLY the owner's own running answer clears the fault
        host.applyBrainHealth({cause: null, state: 'running'});

        expect(provider.data.daemonState).toBe('running');
        expect(provider.data.daemonDegradedReason).toBeNull();
        expect(verdictOf(provider.data).hidden).toBe(true)
    });

    test('dev-server mode stays silent: transport-only answers on a never-fed surface write nothing', () => {
        const {host, provider} = makeDaemonHost();

        host.applyBrainHealth({error: 'brain: shell health capability unavailable', ok: false});
        host.applyBrainHealth(null);

        // never fed → still null/null: silence claims nothing (the formula renders the honest
        // cold copy from the surface states alone)
        expect(provider.data.daemonState).toBeNull();
        expect(provider.data.daemonDegradedReason).toBeNull()
    });

    test('a cold owner derives the cold hook, visible, cause + shipped remedy', () => {
        const verdict = verdictOf({});

        expect(verdict.kind).toBe('cold');
        expect(verdict.hidden).toBe(false);
        expect(verdict.text).toBe('fleet offline');
        expect(verdict.title).toContain('Fleet server offline');
        expect(verdict.title).toContain('neo-agent-brain checkout')
    });

    test('a degraded owner derives the degraded hook + last-known copy', () => {
        const verdict = verdictOf({gridAdapterState: 'live', streamAdapterState: 'stale'});

        expect(verdict.kind).toBe('degraded');
        expect(verdict.hidden).toBe(false);
        expect(verdict.title).toContain('last-known')
    });

    test('a fully live owner hides the banner with empty copy — zero nominal pixels', () => {
        expect(verdictOf({gridAdapterState: 'live', streamAdapterState: 'live'}))
            .toEqual({ariaLabel: '', hidden: true, kind: 'live', text: '', title: ''})
    });

    test('the Reconnect affordance shares the banner verdict: visible on any spoken line, hidden on live', () => {
        // the affordance binds `data => data.spineBanner.hidden` — the SAME formula output the
        // banner renders, so the two cannot disagree; this pins the verdict both ways
        expect(verdictOf({}).hidden).toBe(false);
        expect(verdictOf({gridAdapterState: 'live', streamAdapterState: 'live'}).hidden).toBe(true)
    });

    test('reconnectFleet re-drives every liveness seam immediately — the one-click recovery', () => {
        const
            driven = [],
            panes  = {
                'catch-up'  : {onRefreshClick: () => driven.push('catchUpHistory')},
                'memories'  : {onRefreshClick: () => driven.push('memoriesHistory')},
                'wakeRoutes': {onRefreshClick: () => driven.push('wakeRoutesHistory')}
            },
            host = makeControllerFake(FleetCockpitController, {
                loadActivity          : () => driven.push('activity'),
                loadBrainHealth       : () => driven.push('brainHealth'),
                loadRoster            : () => driven.push('roster'),
                // fleet-wide and owner-held: re-driven directly, not through a pane accessor, so a
                // not-yet-materialized Tasks tab still reopens on post-reconnect truth
                loadTasks             : () => driven.push('tasks'),
                ensureViewerWakeStream: () => driven.push('viewerWake'),
                // the resident-pane re-drives route through the view's phase-blind accessors: a
                // vesseled pane must receive the reconnect re-drive too
                component: {
                    getCatchUpPane   : () => panes['catch-up'],
                    getMemoriesPane  : () => panes.memories,
                    getWakeRoutesPane: () => panes.wakeRoutes ?? null
                }
            });

        host.reconnectFleet();

        expect(driven.sort()).toEqual([
            'activity', 'brainHealth', 'catchUpHistory', 'memoriesHistory', 'roster', 'tasks', 'viewerWake', 'wakeRoutesHistory'
        ])
    });

    test('reconnectFleet tolerates unmounted panes — a missing reference is silence, never a throw', () => {
        const driven = [],
              host   = makeControllerFake(FleetCockpitController, {
                  loadActivity          : () => driven.push('activity'),
                  loadBrainHealth       : () => driven.push('brainHealth'),
                  loadRoster            : () => driven.push('roster'),
                  loadTasks             : () => driven.push('tasks'),
                  ensureViewerWakeStream: () => driven.push('viewerWake'),
                  component             : {
                      getCatchUpPane   : () => null,
                      getMemoriesPane  : () => null,
                      getWakeRoutesPane: () => null
                  }
              });

        host.reconnectFleet();

        expect(driven.sort()).toEqual(['activity', 'brainHealth', 'roster', 'tasks', 'viewerWake'])
    });

    test('⭐ the shell transport fact reaches the cold copy through the health pull — daemon truth untouched', () => {
        const {host, provider} = makeDaemonHost();

        // the roster surface sits on its cold seed — the transport fact speaks through the COLD copy
        provider.data.gridAdapterState = 'sample';

        // a state-less payload carrying only the fact: the daemon surface stays unfed (absence
        // claims nothing), while the cold copy moves to the shell's honest line
        host.applyBrainHealth({state: null, transport: {phase: 'starting'}});

        expect(provider.data.daemonState).toBeNull();
        expect(provider.data.shellTransport).toEqual({phase: 'starting'});
        expect(verdictOf(provider.data).title).toContain('Fleet transport starting');

        // the boot settles foreign — the SAME wire moves the copy to the named case
        const fact = {fleetPort: 8083, mode: 'foreign-listener', phase: 'settled', reason: 'viewer mismatch', up: false};
        host.applyBrainHealth({state: null, transport: fact});

        expect(verdictOf(provider.data).title).toContain('another fleet server holds port 8083');

        // an UNCHANGED fact keeps the provider truth deep-equal — the engine provider\'s equality
        // gate is what turns "no data change" into "no repaint"; the input-side invariant is ours
        host.applyBrainHealth({state: null, transport: {...fact}});
        expect(provider.data.shellTransport).toEqual(fact)
    });

    /**
     * @summary Builds a controller host driving the REAL loadActivity through the REAL loss edge,
     * with both surfaces starting live on the provider.
     */
    const makeLivenessHost = () => {
        const
            harness = makeActivityStoreHarness(),
            stream  = {adapterState: 'live', set() {}},
            host    = makeControllerFake(FleetCockpitController, {
                ...harness,
                component   : {getStateProvider: () => harness.activityProvider, livenessReadTimeout: 4000},
                getReference: reference => reference === 'activity-stream' ? stream : null
            });

        harness.activityProvider.data.gridAdapterState   = 'live';
        harness.activityProvider.data.streamAdapterState = 'live';

        return {host, provider: harness.activityProvider}
    };

    const withBridge = async (fleetActivity, host) => {
        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity}};

        try {
            await host.loadActivity()
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    };

    test('connection publication is owner-keyed for a third surface and cannot rewrite either sibling', () => {
        const {host, provider} = makeLivenessHost(),
              grid = {state: 'refused', reason: 'roster refused'},
              stream = {state: 'timeout', reason: 'activity timed out'};
        provider.setData({gridConnection: grid, streamConnection: stream});

        host.publishConnection('system', {pending: true});
        expect(provider.data.systemConnection).toEqual({state: 'connecting', reason: null});
        host.publishConnection('system', {error: Object.assign(new Error('denied token=private'), {
            fleetConnectionState: 'refused'
        })});
        expect(provider.data.systemConnection).toEqual({state: 'refused', reason: 'denied token=[redacted]'});
        host.publishConnection('system');
        expect(provider.data.systemConnection).toEqual({state: null, reason: null});
        expect(provider.data.gridConnection).toBe(grid);
        expect(provider.data.streamConnection).toBe(stream)
    });

    test('a real refused activity response reaches its own cold feed banner with a sanitized reason', async () => {
        const {host, provider} = makeLivenessHost();
        provider.data.streamAdapterState = 'sample';

        let answer;
        installFleetBridge({send: () => new Promise(resolve => { answer = resolve })});
        const pending = host.loadActivity();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(verdictOf(provider.data).text).toBe('feed connecting');
        answer(createFleetWireResponse('refused', {error: 'activity denied; Authorization: Bearer secret-value'}));
        await pending;

        expect(provider.data.streamConnection.state).toBe('refused');
        expect(provider.data.streamConnection.reason).not.toContain('secret-value');
        const verdict = verdictOf(provider.data);
        expect(verdict.text).toBe('feed refused');
        expect(verdict.title).toContain('activity denied');
        expect(verdict.title).toContain('roster is live');
        expect(verdict.title).not.toContain('server offline');
        expect(titleAfterBannerTitle(verdict.title)).toBe(verdict.title);
        expect(deriveTruths(provider.data).instanceState).toBe('limited')
    });

    test('owner-truth MOBILITY: once live, a thrown load advances to stale and the verdict NAMES the loss', async () => {
        // `live` must stop meaning "was live once": a transport death the operator can\'t see is
        // the dishonest state.
        const {host, provider} = makeLivenessHost();

        await withBridge(async () => { throw new Error('transport lost') }, host);

        expect(provider.data.streamAdapterState).toBe('stale');
        expect(provider.data.streamDegradedReason).toBe('transport lost');

        const verdict = verdictOf(provider.data);
        expect(verdict.hidden).toBe(false);
        expect(verdict.kind).toBe('degraded');
        // the retained reason is NAMED, not generic copy
        expect(verdict.title).toContain('transport lost');
        expect(verdict.title).toContain('last-known')
    });

    test('recovery: a later successful poll returns live, clears the reason, and re-hides the banner', async () => {
        const {host, provider} = makeLivenessHost();

        await withBridge(async () => { throw new Error('transport lost') }, host);
        expect(provider.data.streamAdapterState).toBe('stale');

        await withBridge(async () => ({capability: {state: 'wired'}, events: []}), host);

        expect(provider.data.streamAdapterState).toBe('live');
        expect(provider.data.streamDegradedReason, 'a stale cause must never outlive the degrade it explained').toBe(null);
        expect(verdictOf(provider.data).hidden).toBe(true)
    });

    test('the retained reason survives while the OTHER surface is still degraded', async () => {
        // clearing on the first recovery would strand the banner on generic copy while a real,
        // named degrade is still live on the sibling surface
        const {host, provider} = makeLivenessHost();

        provider.data.gridAdapterState   = 'stale';
        provider.data.gridDegradedReason = 'roster bridge unreachable';

        await withBridge(async () => ({capability: {state: 'wired'}, events: []}), host);

        expect(provider.data.streamAdapterState).toBe('live');
        expect(provider.data.gridDegradedReason).toBe('roster bridge unreachable');

        const verdict = verdictOf(provider.data);
        expect(verdict.hidden).toBe(false);
        expect(verdict.title).toContain('roster bridge unreachable')
    });

    test('a never-wired surface stays cold-honest: a pre-live throw never claims last-known data', async () => {
        const {host, provider} = makeLivenessHost();

        provider.data.streamAdapterState = 'sample';

        await withBridge(async () => { throw new Error('transport lost') }, host);

        // 'stale' would tell the operator we are showing last-known data that never existed
        expect(provider.data.streamAdapterState).toBe('sample');
        expect(provider.data.streamDegradedReason).toBe(null)
    });

    test('not-wired → bridge ABSENT retracts the activity cause — the answer must not outlive its producer', async () => {
        // the activity half of the reviewer falsifier: the producer ANSWERED not-wired (reason
        // retained, honest sample), then the bridge vanished — the retained cause must go with it.
        const {host, provider} = makeLivenessHost();

        provider.data.streamAdapterState = 'sample';

        await withBridge(async () => ({capability: {state: 'not-wired', reason: 'activity source not wired'}, events: []}), host);
        expect(provider.data.streamDegradedReason).toBe('activity source not wired');
        expect(provider.data.streamAdapterState).toBe('sample');

        // withBridge already removed the bridge in its finally — this drive hits the absence exit
        await host.loadActivity();

        expect(provider.data.streamAdapterState).toBe('sample');
        expect(provider.data.streamDegradedReason).toBe(null)
    });

    test('CONTROL — a wired surface keeps its stale reason through bridge absence (last-known truth survives)', async () => {
        // the retraction is scoped to never-wired ANSWERED causes; a surface that reached live and
        // degraded holds last-known data, and its cause explains exactly that — absence must not
        // erase it (the per-surface-reason doctrine\'s other half).
        const {host, provider} = makeLivenessHost();

        await withBridge(async () => { throw new Error('transport lost') }, host);
        expect(provider.data.streamAdapterState).toBe('stale');
        expect(provider.data.streamDegradedReason).toBe('transport lost');

        await host.loadActivity();

        expect(provider.data.streamAdapterState).toBe('stale');
        expect(provider.data.streamDegradedReason).toBe('transport lost')
    });

    test('the degraded reason is redacted + bounded before it reaches operator-visible chrome', async () => {
        const {host, provider} = makeLivenessHost();

        await withBridge(async () => { throw new Error('502 from bridge (Authorization: Bearer super-secret)') }, host);

        expect(provider.data.streamDegradedReason).not.toContain('super-secret');
        expect(provider.data.streamDegradedReason).toContain('502 from bridge');
        expect(verdictOf(provider.data).text).not.toContain('super-secret');

        const long = makeLivenessHost();
        await withBridge(async () => { throw new Error('x'.repeat(400)) }, long.host);
        expect(long.provider.data.streamDegradedReason.length).toBeLessThanOrEqual(120)
    });

    test('a healthy SIBLING never erases this surface\'s retained reason — @neo-gpt\'s red proof', async () => {
        // One shared `degradedReason` for two independently-answering surfaces cannot know whose
        // cause it holds. Per-surface provider fields make the race unrepresentable rather than
        // guarded — this pins the field split at the provider seat.
        const {host, provider} = makeLivenessHost();

        // the stream sits on its SEED, which is the real state when a not-wired answer arrives
        provider.data.streamAdapterState = 'sample';

        // 1. the activity surface answers not-wired and retains its own cause
        await withBridge(async () => ({capability: {state: 'not-wired', reason: 'fleet activity source not wired'}, events: []}), host);

        expect(provider.data.streamDegradedReason).toBe('fleet activity source not wired');

        // 2. the roster surface recovers cleanly — its recovery clears ITS OWN reason only (the
        //    exact write loadRoster\'s success path performs)
        provider.setData({gridAdapterState: 'live', gridDegradedReason: null});

        expect(provider.data.streamDegradedReason, 'a sibling has no standing to retract this cause').toBe('fleet activity source not wired');

        const {text, title} = verdictOf(provider.data);

        expect(text).toBe('feed pending');
        expect(title).toContain('fleet activity source not wired');
        expect(title, 'the lie the retained reason exists to prevent').not.toContain('Fleet server offline')
    });

    test('an OLDER failed completion never overwrites a NEWER success — @neo-gpt\'s second probe', async () => {
        // Two reads of the SAME surface in flight at once, completing in any order: without a fence
        // the LOSER writes last. The catch is not exempt from ordering just because it is the sad
        // path — that is the branch this pins.
        const {host, provider} = makeLivenessHost();

        let releaseSlow;
        const slow = new Promise((resolve, reject) => { releaseSlow = () => reject(new Error('stale transport lost')) });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity: () => slow}};
        const slowRead = host.loadActivity();       // read 1 — in flight, will FAIL
        await new Promise(resolve => setTimeout(resolve, 0));   // read 1 must reach the old method first

        // read 2 starts and wins outright while read 1 is still hanging
        globalThis.AgentOS.fleet.registryBridge.fleetActivity = async () => ({capability: {state: 'wired'}, events: []});
        await host.loadActivity();

        expect(provider.data.streamAdapterState).toBe('live');

        releaseSlow();                              // read 1 finally fails, LATE
        await slowRead;

        expect(provider.data.streamAdapterState, 'older news must not unseat newer truth').toBe('live');
        expect(provider.data.streamDegradedReason ?? null, 'a superseded read may not name a degrade').toBe(null);
        expect(verdictOf(provider.data).hidden, 'nor move the verdict it was not allowed to write').toBe(true);

        delete globalThis.AgentOS.fleet
    });

    test('an OLDER SUCCESS never unseats a NEWER loss — the inverse he also named', async () => {
        // The fence is symmetric and the ordering rule has no favourite outcome — a stale SUCCESS
        // overwriting a fresh loss is the same defect wearing good news, and arguably worse: it
        // paints the spine live while the transport is down.
        const {host, provider} = makeLivenessHost();

        let releaseSlow;
        const slow = new Promise(resolve => { releaseSlow = () => resolve({capability: {state: 'wired'}, events: []}) });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity: () => slow}};
        const slowRead = host.loadActivity();       // read 1 — in flight, will SUCCEED
        // the bridge is invoked a microtask in, so read 1 must actually REACH it before the swap
        await new Promise(resolve => setTimeout(resolve, 0));

        // read 2 starts and loses the transport while read 1 still hangs
        globalThis.AgentOS.fleet.registryBridge.fleetActivity = async () => { throw new Error('transport lost') };
        await host.loadActivity();

        expect(provider.data.streamAdapterState).toBe('stale');

        releaseSlow();                              // read 1 finally succeeds, LATE
        await slowRead;

        expect(provider.data.streamAdapterState, 'stale good news must not claim the spine is live').toBe('stale');
        expect(provider.data.streamDegradedReason).toBe('transport lost');

        delete globalThis.AgentOS.fleet
    });

    test('a newer ABSENCE invalidates an older pending success — @neo-gpt\'s early-return clause', async () => {
        // Absence is newer knowledge; an early return is still a read attempt and must invalidate
        // its predecessor — the generation bump sits BEFORE the no-bridge guard.
        const {host, provider} = makeLivenessHost();

        // seeded to the SEED so the dropped write is observable
        provider.data.streamAdapterState = 'sample';

        let releaseSlow;
        const slow = new Promise(resolve => { releaseSlow = () => resolve({capability: {state: 'wired'}, events: []}) });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity: () => slow}};
        const slowRead = host.loadActivity();       // read 1 — in flight while the bridge exists
        await new Promise(resolve => setTimeout(resolve, 0));   // read 1 must reach the bridge first

        delete globalThis.AgentOS.fleet;            // the bridge disappears
        await host.loadActivity();                  // read 2 — early-returns on absence, but CLAIMS a generation

        releaseSlow();                              // read 1 lands, LATE, with news from a vanished bridge
        await slowRead;

        expect(provider.data.streamAdapterState, 'a read from a bridge that no longer exists must not claim live').toBe('sample')
    });

    test('a read completing after destroy mutates NOTHING — no post-destroy writes', async () => {
        const {host, provider} = makeLivenessHost();

        let releaseSlow;
        const slow = new Promise(resolve => { releaseSlow = () => resolve({capability: {state: 'degraded', reason: 'late'}, events: []}) });

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity: () => slow}};
        const inFlight = host.loadActivity();

        host.isDestroyed = true;                    // the owner goes away mid-read
        releaseSlow();
        await inFlight;

        // a timer that outlives its owner is a liar with no one left to correct it — and so is a read
        expect(provider.data.streamAdapterState).toBe('live');
        expect(provider.data.streamDegradedReason ?? null).toBe(null);

        delete globalThis.AgentOS.fleet
    });

    test('hostile markup in a reason renders INERT — the sink is text, never html', async () => {
        // The reason is a RETAINED TRANSPORT STRING: attacker-adjacent input, not our copy.
        // `toSafeDegradedReason` redacts SECRETS; it is a redactor, not a markup escaper. The fix
        // is the sink: the component writes `text` (→ textContent) — data, never code.
        const {host, provider} = makeLivenessHost(),
              markup           = '<img src=x onerror="alert(1)">';

        await withBridge(async () => { throw new Error(`transport lost ${markup}`) }, host);

        const verdict = verdictOf(provider.data);

        // the derived line carries the markup VERBATIM as data — not stripped. Escaping is the
        // sink's job, and stripping would quietly corrupt a legitimate reason with a bracket.
        expect(verdict.title).toContain('transport lost');
        expect(verdict.title).toContain(markup);
        // the sink itself is the assertion: the slot binds the TEXT config (textContent), and the
        // component's vdom writes are ATTRIBUTES (title/aria-label) — no html path exists
        expect(titleAfterBannerTitle(verdict.title)).toBe(verdict.title)
    });
});
