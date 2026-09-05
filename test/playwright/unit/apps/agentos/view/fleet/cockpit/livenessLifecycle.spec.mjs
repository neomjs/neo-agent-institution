import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitLivenessLifecycleTest'
    }
});

import {test, expect}             from '@playwright/test';
import Neo                        from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                  from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                                 '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import {makeActivityStoreHarness, makeProviderFake} from './cockpitFakes.mjs';
import {installFleetBridge} from '../../../../../../../../apps/agentos/fleet/installFleetBridge.mjs';
import {
    createFleetWireResponse,
    FLEET_WIRE_RESPONSE_STATES
} from 'neo-agent-brain/fleet-contract';

/**
 * The liveness owner's LIFECYCLE witness. A transition matrix proves the owner tells the truth while
 * it runs; this proves it stops running. A leaked interval would keep re-polling the bridge on behalf
 * of a destroyed cockpit and write states onto detached children — a timer that outlives its owner is
 * a liar with no one left to correct it.
 *
 * The destroy that matters is the ordinary one, the shell tearing this view down. NOT pop-out: that
 * path reparents the AgentDetail into a vessel and leaves the cockpit alive as its holder
 * (reparent-never-recreate), so the timer must SURVIVE it — stopping there would strand the surface
 * it still speaks for. Start-idempotence is the guard for that direction: a reattach that re-ran
 * start on a live cockpit would silently double the poll rate against the bridge.
 */
test.describe('Fleet cockpit — the liveness owner lifecycle (start/stop, #15293)', () => {
    let FleetCockpitController, FleetRoster;

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default;
        FleetRoster = (await import('../../../../../../../../apps/agentos/store/FleetRoster.mjs')).default
    });

    /**
     * @summary A host wired to the REAL start/stop with counting timer primitives — the leak is
     * observable as a set/clear imbalance, not inferred from reading the source.
     */
    const makeTimerHost = () => {
        const cleared = [];
        let   nextId  = 0;

        // `loadActivity` / `loadRoster` return PROMISES because the real ones are `async` and
        // `startLiveness` chains `.finally()` to release the overlap latch — a void fake would throw
        // on the first tick. The `*ReadInFlight` pair mirrors the class defaults the latch reads.
        return Object.assign(Object.create(FleetCockpitController.prototype), {
            cleared,
            polls                  : 0,
            brainReads             : 0,
            brainHealthReadGeneration: 0,
            brainHealthReadInFlight: 0,
            // the view-owned cadence configs live on the component seat now
            component              : {livenessPollInterval: 50, maxReadsInFlight: 2, getStateProvider: () => null},
            gridReadGeneration     : 0,
            gridReadInFlight       : 0,
            isDestroyed            : false,
            livenessTimerId        : null,
            streamReadGeneration   : 0,
            streamReadInFlight     : 0,
            tasksReadGeneration    : 0,
            tasksReadInFlight      : 0,
            loadActivity() { this.polls++; return Promise.resolve() },
            // the third seam counts separately: the wire-read expectations stay untouched by it
            loadBrainHealth() { this.brainReads++; return Promise.resolve() },
            loadRoster()   { this.polls++; return Promise.resolve() },
            // the tasks seam launches no counted wire read in these balance fixtures
            loadTasks()    { return Promise.resolve() },
            // the wake rebind seam launches no wire read — modeled as a plain no-op so the
            // wire-read balance assertions stay exact
            ensureViewerWakeStream() {},
            // counting stand-ins: the real ones are globals, and the assertion is about balance
            _setInterval  : () => ++nextId,
            _clearInterval: id => cleared.push(id)
        })
    };

    test.describe('roster connection observations through the real bridge and loader', () => {
        let previousFleet, stores;

        test.beforeEach(() => {
            previousFleet = globalThis.AgentOS?.fleet;
            stores = []
        });

        test.afterEach(() => {
            stores.forEach(store => store.destroy());
            if (previousFleet === undefined) {
                delete globalThis.AgentOS.fleet
            } else {
                globalThis.AgentOS.fleet = previousFleet
            }
        });

        /**
         * @summary Keeps the real roster loader, mapping and Store; only unrelated view seams
         * are absent. Every capacity change comes from a real wire settlement, never a counter edit.
         */
        const makeRosterHost = ({state = 'sample', timeout = 2000} = {}) => {
            const provider = makeProviderFake({
                gridAdapterState: state,
                gridConnection: {state: null, reason: null},
                streamConnection: {state: 'failed-upstream', reason: 'activity source unavailable'}
            });
            const store = Neo.create(FleetRoster, {
                autoLoad: false,
                data: [{agentId: 'resident', displayName: 'Retained resident'}]
            });
            const grid = {adapterState: state};
            const host = Object.assign(makeTimerHost(), {
                getReference: reference => reference === 'fleet-grid' ? grid : null,
                resolveFleetRosterStore: () => store,
                rosterWired: state === 'live'
            });

            Object.assign(host.component, {
                getCatchUpPane: () => null,
                getMemoriesPane: () => null,
                getOperatorMailboxPane: () => null,
                getStateProvider: () => provider,
                getWakeRoutesPane: () => null,
                livenessReadTimeout: timeout,
                rosterSourceMode: 'selected'
            });
            delete host.loadRoster;
            stores.push(store);

            return {grid, host, provider, store}
        };

        /** @summary Install the production proxy against a controllable envelope-producing wire. */
        const installWire = send => installFleetBridge({credentialIngress: 'shell', send, target: globalThis});
        const rosterReply = id => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {
            result: {rows: [{id, displayName: id}]}
        });
        const refusedReply = error => createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.refused, {error});

        test('a cold roster read publishes connecting, retains a safe refusal, and clears on real recovery', async () => {
            const {host, provider, store} = makeRosterHost();
            const wire = Promise.withResolvers();
            let calls = 0;

            installWire(() => ++calls === 1 ? wire.promise : rosterReply('recovered'));
            const read = host.loadRoster();

            expect(provider.data.gridConnection).toEqual({state: 'connecting', reason: null});
            await expect.poll(() => calls).toBe(1);
            wire.resolve(refusedReply('Authorization: Bearer secret-value; request refused'));
            await read;

            expect(provider.data.gridConnection.state).toBe('refused');
            expect(provider.data.gridConnection.reason).toContain('[redacted]');
            expect(provider.data.gridConnection.reason).not.toContain('secret-value');
            expect(provider.data.gridAdapterState).toBe('sample');
            expect(store.get('resident')).toBeTruthy();
            expect(host.gridReadInFlight).toBe(0);

            await host.loadRoster();

            expect(provider.data.gridConnection).toEqual({state: null, reason: null});
            expect(provider.data.gridAdapterState).toBe('live');
            expect(store.get('recovered')).toBeTruthy();
            expect(store.get('resident')).toBeFalsy();
            expect(provider.data.streamConnection).toEqual({state: 'failed-upstream', reason: 'activity source unavailable'})
        });

        test('a roster timeout preserves last-known data and wire capacity until its late reply settles', async () => {
            const {host, provider, store} = makeRosterHost({state: 'live', timeout: 20});
            const wire = Promise.withResolvers();

            installWire(() => wire.promise);
            const read = host.loadRoster();

            expect(provider.data.gridConnection.state).toBe('connecting');
            await read;

            expect(provider.data.gridConnection).toEqual({state: 'timeout', reason: 'fleet read exceeded 20ms'});
            expect(provider.data.gridAdapterState).toBe('stale');
            expect(host.gridReadInFlight, 'the deadline did not settle the wire').toBe(1);
            expect(store.get('resident')).toBeTruthy();

            wire.resolve(rosterReply('late'));
            await expect.poll(() => host.gridReadInFlight).toBe(0);

            expect(provider.data.gridConnection.state).toBe('timeout');
            expect(store.get('resident')).toBeTruthy();
            expect(store.get('late')).toBeFalsy()
        });

        for (const newerState of ['connecting', 'refused']) {
            test(`an older roster success cannot clear the newer ${newerState} observation`, async () => {
                const {host, provider, store} = makeRosterHost();
                const wires = [Promise.withResolvers(), Promise.withResolvers()];
                let calls = 0;

                installWire(() => wires[calls++].promise);
                const older = host.loadRoster(), newer = host.loadRoster();

                await expect.poll(() => calls).toBe(2);

                if (newerState === 'refused') {
                    wires[1].resolve(refusedReply('newer request refused'));
                    await newer
                }

                wires[0].resolve(rosterReply('obsolete'));
                await older;

                expect(provider.data.gridConnection.state).toBe(newerState);
                expect(store.get('resident')).toBeTruthy();
                expect(store.get('obsolete')).toBeFalsy();

                if (newerState === 'connecting') {
                    expect(host.gridReadInFlight).toBe(1);
                    wires[1].resolve(rosterReply('current'));
                    await newer;
                    expect(provider.data.gridConnection).toEqual({state: null, reason: null});
                    expect(store.get('current')).toBeTruthy()
                }

                expect(host.gridReadInFlight).toBe(0)
            })
        }

        test('bridge absence clears a pending roster observation without releasing or admitting its old wire', async () => {
            const {host, provider, store} = makeRosterHost();
            const wire = Promise.withResolvers();

            installWire(() => wire.promise);
            const pending = host.loadRoster();

            expect(provider.data.gridConnection.state).toBe('connecting');
            delete globalThis.AgentOS.fleet.registryBridge;
            await host.loadRoster();

            expect(provider.data.gridConnection).toEqual({state: null, reason: null});
            expect(host.gridReadInFlight).toBe(1);

            wire.resolve(rosterReply('obsolete'));
            await pending;

            expect(host.gridReadInFlight).toBe(0);
            expect(provider.data.gridConnection).toEqual({state: null, reason: null});
            expect(store.get('resident')).toBeTruthy();
            expect(store.get('obsolete')).toBeFalsy()
        });

        test('Reconnect admits the new bridge while an old refusal can only release its own capacity', async () => {
            const {host, provider, store} = makeRosterHost();
            const oldWire = Promise.withResolvers();

            installWire(() => oldWire.promise);
            const older = host.loadRoster();

            expect(provider.data.gridConnection.state).toBe('connecting');
            installWire(() => rosterReply('reconnected'));
            host.reconnectFleet();

            await expect.poll(() => provider.data.gridAdapterState).toBe('live');
            expect(provider.data.gridConnection).toEqual({state: null, reason: null});
            expect(store.get('reconnected')).toBeTruthy();
            expect(host.gridReadInFlight, 'the prior bridge still owns an unsettled request').toBe(1);

            oldWire.resolve(refusedReply('obsolete bridge refused'));
            await older;

            expect(host.gridReadInFlight).toBe(0);
            expect(provider.data.gridConnection).toEqual({state: null, reason: null});
            expect(provider.data.gridAdapterState).toBe('live');
            expect(store.get('reconnected')).toBeTruthy()
        })
    });

    test('start is idempotent: a second call never stacks a second timer', () => {
        const host     = makeTimerHost(),
              original = globalThis.setInterval;

        globalThis.setInterval = host._setInterval;

        try {
            host.startLiveness();
            const first = host.livenessTimerId;

            host.startLiveness();
            host.startLiveness();

            // a stacked timer would double the poll rate against the bridge for the same cockpit
            expect(host.livenessTimerId).toBe(first)
        } finally {
            globalThis.setInterval = original
        }
    });

    test('a SYNCHRONOUS bridge throw releases the wire slot — @neo-gpt\'s sync-throw falsifier', async () => {
        // The leak I built inside the fix for the leak. `Promise.resolve(bridge.fleetActivity())`
        // evaluates the CALL first, so a synchronous throw reaches loadActivity's catch before
        // `boundedRead` attaches its settle hook — the counter goes up and never comes down. Two
        // throws consume the cap and this surface never probes again.
        //
        // His numbers at 2313675141: wireReads 2 (expected 3), streamReadInFlight 2 (expected 0).
        // The repair invokes INSIDE the chain, so a sync throw rejects the tracked promise and the
        // reject path owns the release.
        const stream  = {adapterState: 'live', set() {}},
              harness = makeActivityStoreHarness(),
              host    = Object.assign(makeTimerHost(), harness, {
                  getReference: reference => reference === 'activity-stream' ? stream : null
              });

        // the provider seat carries this surface's live starting truth; the REAL loss edge and
        // redaction run inherited from the prototype
        host.component.getStateProvider = () => harness.activityProvider;
        harness.activityProvider.data.streamAdapterState = 'live';

        let tick, wireReads = 0;

        host.component.livenessReadTimeout = 5;
        delete host.loadActivity;                    // the REAL inherited read drives the wire
        host.loadRoster = () => Promise.resolve();

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity() {
            wireReads++;
            throw new Error('sync boom')            // SYNCHRONOUS, never a rejected promise
        }}};

        const originalSetInterval = globalThis.setInterval;
        globalThis.setInterval = fn => { tick = fn; return 1 };

        try {
            host.startLiveness();

            for (let i = 0; i < 3; i++) {
                tick();
                await new Promise(resolve => setTimeout(resolve, 10))
            }

            expect(host.streamReadInFlight, 'a sync throw must not strand its slot').toBe(0);
            expect(wireReads, 'and the surface must keep probing, not seize after two throws').toBe(3);
            expect(harness.activityProvider.data.streamAdapterState, 'the throw still degrades honestly').toBe('stale')
        } finally {
            globalThis.setInterval = originalSetInterval;
            delete globalThis.AgentOS.fleet
        }
    });

    test('five ticks against a hung WIRE launch a BOUNDED number of reads — @neo-gpt\'s 5-tick falsifier', async () => {
        // His probe, and it falsified a claim I had made to him in writing: I said max-in-flight was
        // "1 per surface by construction". It was 1 per WRAPPER. `boundedRead`'s race settles its own
        // promise on timeout, so the slot freed while the underlying read kept hanging — 5 ticks, 5
        // hung reads, 0 settled. I closed the freeze and re-opened the accumulation, then asserted
        // the opposite.
        //
        // The count now tracks the WIRE (`onWireSettled`), so a timed-out wrapper does not pretend
        // the socket came back. Capped above 1 because with no abort seam a single slot cannot both
        // bound accumulation AND survive a permanent hang: one hang would hold the only slot forever.
        const stream  = {adapterState: 'live', set() {}},
              harness = makeActivityStoreHarness(),
              host    = Object.assign(makeTimerHost(), harness, {
                  getReference: reference => reference === 'activity-stream' ? stream : null
              });

        // the provider seat carries this surface's live starting truth; the REAL loss edge and
        // redaction run inherited from the prototype
        host.component.getStateProvider = () => harness.activityProvider;
        harness.activityProvider.data.streamAdapterState = 'live';

        let tick, wireReads = 0;   // 5-tick

        host.component.livenessReadTimeout = 5;
        delete host.loadActivity;                    // the REAL inherited read drives the wire
        host.loadRoster = () => Promise.resolve();

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity: () => {
            wireReads++;
            return new Promise(() => {})            // EVERY read hangs forever — nothing settles
        }}};

        const originalSetInterval = globalThis.setInterval;
        globalThis.setInterval = fn => { tick = fn; return 1 };

        try {
            host.startLiveness();

            for (let i = 0; i < 5; i++) {
                tick();
                await new Promise(resolve => setTimeout(resolve, 15))   // outlive the bounded window
            }

            // the wrapper timing out must NOT be mistaken for the wire returning
            expect(wireReads, 'five ticks against a hung wire must not launch five reads').toBeLessThanOrEqual(host.component.maxReadsInFlight);
            expect(host.streamReadInFlight, 'the cap must never grow').toBeLessThanOrEqual(host.component.maxReadsInFlight);
            // and the surface still told the truth while the wire hung
            expect(harness.activityProvider.data.streamAdapterState).toBe('stale')
        } finally {
            globalThis.setInterval = originalSetInterval;
            delete globalThis.AgentOS.fleet
        }
    });

    test('a read that NEVER settles must not freeze the surface — @neo-gpt\'s latch falsifier', async () => {
        // I fixed unbounded accumulation and introduced permanent freeze. His words, and they're
        // exact: "the surface can stay last-known live forever, which recreates the original defect."
        //
        // The latch releases in a `.finally()`. A promise that never settles never runs it, so the
        // slot is held FOREVER and every later tick is suppressed — including the one that would
        // have noticed the transport recovering. A liveness owner that stops polling is the precise
        // thing this ticket exists to prevent, rebuilt from the other side by its own guard.
        //
        // The bound is what makes the latch safe to hold: a read may fail, it may never hang — the
        // same contract `detailVesselConnectWindowMs` already states for the vessel admission.
        // drives the REAL loadActivity against a REAL hanging bridge — the fake read of an earlier
        // draft would have replaced the very `boundedRead` under test with a stub of my own optimism
        const stream  = {adapterState: 'live', set() {}},
              harness = makeActivityStoreHarness(),
              host    = Object.assign(makeTimerHost(), harness, {
                  getReference: reference => reference === 'activity-stream' ? stream : null
              });

        // the provider seat carries this surface's live starting truth; the REAL loss edge and
        // redaction run inherited from the prototype
        host.component.getStateProvider = () => harness.activityProvider;
        harness.activityProvider.data.streamAdapterState = 'live';

        let tick, calls = 0;

        host.component.livenessReadTimeout = 5;       // short window; the spec pins it, never sleeps on prod
        delete host.loadActivity;                     // the REAL inherited read drives the wire
        host.loadRoster = () => Promise.resolve();

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetActivity: () => {
            calls++;
            // read 1 hangs FOREVER; later reads answer at once — the recovery this must find
            return calls === 1 ? new Promise(() => {}) : Promise.resolve({capability: {state: 'wired'}, events: []})
        }}};

        const originalSetInterval = globalThis.setInterval;
        globalThis.setInterval = fn => { tick = fn; return 1 };

        try {
            host.startLiveness();

            tick();                                            // read 1 — hangs forever
            // the bridge is now invoked INSIDE the promise chain (so a sync throw rejects rather
            // than escaping), which means the call lands a microtask after the tick. Asserting
            // synchronously here read 0 and blamed the code for my own timing assumption.
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(calls).toBe(1);

            await new Promise(resolve => setTimeout(resolve, 40));   // outlive the bounded window

            tick();                                            // the transport recovered; this MUST probe
            await new Promise(resolve => setTimeout(resolve, 0));   // the bridge call is a microtask in
            expect(calls, 'a hung read must not suppress the probe that would notice recovery').toBe(2);

            await new Promise(resolve => setTimeout(resolve, 40));

            tick();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(calls, 'and liveness must keep running, not limp once').toBe(3)
        } finally {
            globalThis.setInterval = originalSetInterval;
            delete globalThis.AgentOS.fleet
        }
    });

    test('a tick never launches past the cap for that surface (pinned at 1 here)', async () => {
        // @neo-gpt's fourth finding, and the one the generation fence does NOT reach: the fence makes
        // a late read HARMLESS, not ABSENT. A transport slower than the 15s cadence would have every
        // tick launch another pair regardless of the unresolved prior one — unbounded in-flight reads
        // against a bridge already failing to answer, which is exactly when piling on is worst.
        // Skipping a tick costs nothing: the next reads the same live truth, only later.
        const host     = makeTimerHost(),
              original = globalThis.setInterval;

        let tick, releaseActivity;

        // pinned at 1 so the cap's edge is the assertion. Production runs 2 — a single slot cannot
        // both bound accumulation and survive a permanent hang, which is the whole reason the cap
        // exists rather than a boolean. The RULE is the cap; this pins its boundary at its tightest.
        host.component.maxReadsInFlight = 1;
        host.loadActivity     = function() {
            this.polls++;
            this.streamReadInFlight++;                                     // the launcher counts the WIRE
            return new Promise(resolve => { releaseActivity = () => { this.streamReadInFlight--; resolve() } })
        };
        globalThis.setInterval = fn => { tick = fn; return 1 };

        try {
            // the latch releases in a `.finally()`, i.e. on a MICROTASK — so a tick must be given a
            // drain before the next, exactly as the real 15s cadence does. My first version fired
            // both ticks synchronously and saw the ROSTER suppressed too: correct behaviour (its
            // latch had not released yet) against a specimen that modelled no time passing at all.
            const drain = async () => { await Promise.resolve(); await Promise.resolve() };

            host.startLiveness();

            tick();                                   // tick 1 launches both; activity hangs
            expect(host.polls).toBe(2);
            await drain();                            // roster resolved; its latch releases

            tick();                                   // tick 2 — activity is STILL unresolved
            expect(host.polls, 'a second activity read must not stack on an unresolved one').toBe(3); // roster only
            await drain();

            releaseActivity();
            await drain();                            // activity finally settles; its latch releases

            tick();                                   // tick 3 — the surface is free again
            expect(host.polls, 'suppression must not be permanent — it is a skip, not a stop').toBe(5)
        } finally {
            globalThis.setInterval = original
        }
    });

    test('stop clears the timer exactly once and is safe on a never-started cockpit', () => {
        const host          = makeTimerHost(),
              originalSet   = globalThis.setInterval,
              originalClear = globalThis.clearInterval;

        globalThis.setInterval   = host._setInterval;
        globalThis.clearInterval = host._clearInterval;

        try {
            // never started → nothing to clear, and no throw
            expect(() => host.stopLiveness()).not.toThrow();
            expect(host.cleared).toHaveLength(0);

            host.startLiveness();
            const id = host.livenessTimerId;

            host.stopLiveness();
            expect(host.cleared).toEqual([id]);
            expect(host.livenessTimerId, 'a stale id would make a later stop clear a stranger timer').toBe(null);

            // exact-once: a second stop is a no-op, never a double-clear
            host.stopLiveness();
            expect(host.cleared).toEqual([id]);

            // and the cockpit can start again cleanly after a stop (the reattach path)
            host.startLiveness();
            expect(host.livenessTimerId).not.toBe(null)
        } finally {
            globalThis.setInterval   = originalSet;
            globalThis.clearInterval = originalClear
        }
    });

    test('the owner actually re-drives the real seams on the cadence', async () => {
        const host = makeTimerHost();

        host.component.livenessPollInterval = 10;
        host.startLiveness();

        try {
            // the daemon surface has no other first load — arming the owner IS its first read
            expect(host.brainReads, 'the immediate first Brain read must not wait a full cadence').toBe(1);

            await new Promise(resolve => setTimeout(resolve, 45));

            // both wire seams, every tick: re-driving the real verbs IS the mechanism
            expect(host.polls, 'the owner must poll, not just hold a timer id').toBeGreaterThanOrEqual(4);

            // the third seam rides the same cadence: immediate read plus tick re-reads. Overlap and
            // hang behavior are witnessed by the never-settle tests below against REAL promises —
            // never by assigning the in-flight field here.
            expect(host.brainReads, 'the Brain read must re-drive on the cadence, not just once').toBeGreaterThanOrEqual(2)
        } finally {
            host.stopLiveness()
        }
    });

    /**
     * @summary Builds a host wired to the REAL loadBrainHealth with a controllable Neo.Main mock.
     * Returns the host, the recorded apply calls, and the hung wires' resolvers — so the tests can
     * settle a wire deliberately instead of ever assigning the in-flight field.
     */
    const makeBrainReadHost = ({timeout}) => {
        const
            applied = [],
            wires   = [],
            host    = Object.assign(Object.create(FleetCockpitController.prototype), {
                applied,
                wires,
                brainHealthReadGeneration: 0,
                brainHealthReadInFlight  : 0,
                component                : {livenessReadTimeout: timeout, maxReadsInFlight: 2},
                isDestroyed              : false,
                applyBrainHealth(response) { applied.push(response) }
            });

        return host
    };

    const withMainMock = async (host, run) => {
        const hadNeo   = Boolean(globalThis.Neo),
              original = globalThis.Neo?.Main;

        (globalThis.Neo ??= {}).Main = {brainHealth: () => new Promise(resolve => host.wires.push(resolve))};

        try {
            await run()
        } finally {
            if (original === undefined) { delete globalThis.Neo.Main } else { globalThis.Neo.Main = original }
            if (!hadNeo) { delete globalThis.Neo }
        }
    };

    test('a Brain read that NEVER settles must not freeze the surface — bounded slot, capped wires', async () => {
        const host = makeBrainReadHost({timeout: 20});

        await withMainMock(host, async () => {
            // the first read hangs: the bounded race frees the CALLER on the timeout…
            const first = host.loadBrainHealth();

            expect(host.brainHealthReadInFlight).toBe(1);
            await first;

            expect(host.applied, 'the timed-out read lands as transport truth').toEqual([null]);
            // …while the WIRE never settled, so its slot stays counted — the accumulation bound
            expect(host.brainHealthReadInFlight).toBe(1);

            // the surface is NOT frozen: a second read launches under the cap and hangs too
            await host.loadBrainHealth();
            expect(host.brainHealthReadInFlight).toBe(2);

            // two hung wires reach the cap: the tick guard now suppresses — bounded, never a stop
            expect(host.brainHealthReadInFlight < host.maxReadsInFlight).toBe(false);

            // a hung wire finally answering releases its slot but its answer goes nowhere
            host.applied.length = 0;
            host.wires[0]({cause: null, state: 'running'});
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(host.applied, 'a wire the race already dropped never writes').toEqual([]);
            expect(host.brainHealthReadInFlight, 'its settle still frees the slot').toBe(1)
        })
    });

    test('a slow Brain answer landing after a newer read never writes — the generation fence', async () => {
        const host = makeBrainReadHost({timeout: 500});

        await withMainMock(host, async () => {
            const slow = host.loadBrainHealth(),
                  fast = host.loadBrainHealth();

            // the mock's invoke sits one microtask deep (the sync-throw guard wraps it in a
            // resolved-promise chain), so the wires materialize only after a flush
            await expect.poll(() => host.wires.length).toBe(2);

            // the NEWER read answers first with current truth
            host.wires[1]({cause: null, state: 'running'});
            await fast;
            expect(host.applied).toEqual([{cause: null, state: 'running'}]);

            // the STALE wire answers late — inside its timeout window, but past its generation
            host.wires[0]({cause: {detail: 'stale news', observedAt: 1, source: 'owned-child-termination'}, state: 'degraded'});
            await slow;

            expect(host.applied, 'older news never overwrites newer truth').toEqual([{cause: null, state: 'running'}]);
            expect(host.brainHealthReadInFlight, 'both wires settled, both slots free').toBe(0)
        })
    })
});
