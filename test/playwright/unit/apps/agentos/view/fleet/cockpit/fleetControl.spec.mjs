import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitFleetControlTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import {wiredSources} from './cockpitFakes.mjs';

/**
 * Covers the cockpit's whole-fleet control: `onStartFleet` fans a start intent out to
 * every resident card through the C2 adapter (the collapsed-idle fold skipped; no bridge → an honest
 * `unauthorized` reason onto each record, never an optimistic fleet-wide success),
 * `getRosterRecords` treats a present Store as authoritative over the rendered cards, overlapping
 * activations join one active batch (one bridge call per member, one authoritative summary), the
 * next activation excludes a timeout-bearing member instead of retrying an unknown operation, the
 * wire's partition keeps excluded members off `pending` and renders their reasons, and a
 * card's own lifecycle intent resolves the firing card before it drives the adapter. Prototype-call
 * harness on the REAL controller; the adapter and the bridge are the collaborators the arms fake.
 */
/**
 * @summary The toolbar's fleet button as the controller writes it: configs land on the fake, the
 * title on its `vdom` like the real Button's root node.
 * @returns {Object}
 */
const fakeButton = () => ({disabled: false, vdom: {}, set(values) { Object.assign(this, values) }, update() {}});

test.describe('Fleet cockpit — whole-fleet control (B4, #14611)', () => {
    let FleetCockpit, FleetCockpitController;

    test.beforeAll(async () => {
        [FleetCockpit, FleetCockpitController] = await Promise.all([
            import('../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs').then(module => module.default),
            import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs').then(module => module.default)
        ])
    });

    test('onStartFleet fans out start to every resident card via the C2 adapter (fold skipped; no bridge → fail-closed per card, never optimistic)', () => {
        // The fleet-start button drives the round-trip directly (the cockpit owns the wire): it
        // enumerates the rendered cards — the collapsed-idle fold is filtered by ntype — and dispatches a
        // start intent + each card's roster record to the adapter. No bridge → each card takes an honest
        // `unauthorized` controlReason onto its record, never an optimistic fleet-wide success.
        delete globalThis.AgentOS?.fleet;

        const mkCard = agentId => {
            const writes = [],
                  record = {agentId, sources: wiredSources(), state: 'off', writes, set(values) { writes.push(values) }};
            return {ntype: 'fm-agent-card', record, writes}
        };

        const vega = mkCard('neo-opus-vega'),
              ada  = mkCard('neo-opus-ada'),
              fold = {ntype: 'component'}; // the collapsed-idle fold — no record, must be skipped

        const controller = Object.create(FleetCockpitController.prototype);

        controller.getReference = name => name === 'fleet-cards' ? {items: [vega, fold, ada]} : null;

        controller.onStartFleet();

        expect(vega.writes.some(write => write.controlReason?.kind === 'unauthorized')).toBe(true);
        expect(ada.writes.some(write => write.controlReason?.kind === 'unauthorized')).toBe(true)
    });

    test('onStopFleet is a two-press: the first press renders the plan and sends nothing; the second sends one stop intent per planned seat and the summary reads N stopped; a fleet start takes the first press back (#618 AC-3)', async () => {
        const
            calls      = [],
            records    = ['ada', 'euclid', 'vega'].map((agentId, index) => ({
                agentId,
                controlReason: null,
                pendingAction: null,
                sources      : wiredSources(),
                state        : index < 2 ? 'ok' : 'off',
                set(values) { Object.assign(this, values) }
            })),
            summaries  = [],
            controller = Object.create(FleetCockpitController.prototype);

        (globalThis.AgentOS ??= {}).fleet = {
            registryBridge: {
                stopAgent(agentId) {
                    calls.push(agentId);
                    return Promise.resolve({state: 'off'})
                }
            }
        };

        controller.getReference          = name => name === 'fleet-grid' ? {store: {items: records}} : null;
        controller.refreshRosterOnSettle = settledOk => settledOk;
        controller.renderStartSummary    = (summary, verb) => summaries.push({summary, verb});
        controller.renderSummarySlot     = line => lines.push(line);

        const lines = [];

        try {
            // the first press: the plan where the summaries live, nothing sent
            const plan = controller.onStopFleet();

            expect(plan.eligible.map(record => record.agentId)).toEqual(['ada', 'euclid']);
            expect(calls).toEqual([]);
            expect(lines.at(-1)).toEqual({text: 'Stop fleet · 2 seats: ada, euclid · 1 excluded', detail: expect.stringContaining('vega: already down')});
            expect(controller.stopFleetArmed.plan).toBe(plan);

            // the second press: one stop intent per planned seat, the summary in the stop direction
            const summary = await controller.onStopFleet();

            expect(calls).toEqual(['ada', 'euclid']);
            expect(summary.started).toBe(2);
            expect(summaries.some(({summary, verb}) => verb === 'stopped' && summary?.started === 2)).toBe(true);
            expect(controller.stopFleetPromise).toBeNull();
            expect(controller.stopFleetArmed).toBeNull();

            // a fleet start takes the first press back
            controller.executeStartFleetBatch = async () => ({});
            controller.onStopFleet();
            expect(controller.stopFleetArmed).not.toBeNull();
            await controller.onStartFleet();
            expect(controller.stopFleetArmed).toBeNull()
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('the fleet button reads its plan on settled rosters only: the last words and a disabled button during a batch, the settled plan after it; a plain label carries its reason on the title (#618 AC-1, AC-2)', async () => {
        const
            releases   = [],
            records    = ['ada', 'euclid'].map(agentId => ({agentId, controlReason: null, pendingAction: null, sources: wiredSources(), state: 'off', set(values) { Object.assign(this, values) }})),
            button     = fakeButton(),
            controller = Object.create(FleetCockpitController.prototype);

        (globalThis.AgentOS ??= {}).fleet = {
            registryBridge: {
                startAgent: () => new Promise(resolve => releases.push(() => resolve({state: 'ok'})))
            }
        };

        controller.getReference          = name => ({'fleet-grid': {store: {items: records}}, 'fleet-button': button})[name] ?? null;
        controller.renderStartSummary    = () => {};
        // the settle re-poll: registry truth replaces the round-trip residue and the roster settles
        // while the batch is still in flight — the button keeps its words and stays disabled
        controller.refreshRosterOnSettle = async () => {
            records.forEach(record => record.set({controlReason: null, pendingAction: null, state: 'ok'}));
            controller.onRosterSettled();
            expect(button).toMatchObject({disabled: true, text: 'Start fleet · 2'})
        };

        try {
            controller.onRosterSettled();
            expect(button).toMatchObject({disabled: false, iconCls: 'fa-solid fa-play', text: 'Start fleet · 2'});
            expect(button.vdom.title).toBeUndefined();

            // in flight: the last settled words stay and the button is disabled (the adapter reaches
            // the bridge after its own awaits — a tick lets both round-trips open before they are released)
            const batch = controller.onFleetButton();

            expect(button).toMatchObject({disabled: true, text: 'Start fleet · 2'});
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(releases).toHaveLength(2);
            expect(button).toMatchObject({disabled: true, text: 'Start fleet · 2'});

            releases.forEach(release => release());
            await batch;

            expect(button).toMatchObject({disabled: false, iconCls: 'fa-solid fa-stop', text: 'Stop fleet · 2'});

            // the plain label: every row unwired — the reason rides the title, no count
            records.forEach(record => record.set({sources: {}}));
            controller.onRosterSettled();
            expect(button).toMatchObject({disabled: false, iconCls: 'fa-solid fa-play', text: 'Start fleet'});
            expect(button.vdom.title).toContain('wired')
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('the first press arms for a bounded window: a settled roster whose plan differs takes it back, a matching one keeps it, the window\'s end takes it back — nothing sent until the second press (#618 AC-3, AC-4)', async () => {
        const
            calls      = [],
            lines      = [],
            records    = ['ada', 'euclid'].map(agentId => ({agentId, displayName: agentId[0].toUpperCase() + agentId.slice(1), controlReason: null, pendingAction: null, sources: wiredSources(), state: 'ok', set(values) { Object.assign(this, values) }})),
            button     = fakeButton(),
            controller = Object.create(FleetCockpitController.prototype);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {stopAgent: agentId => (calls.push(agentId), Promise.resolve({state: 'off'}))}};

        controller.getReference          = name => ({'fleet-grid': {store: {items: records}}, 'fleet-button': button})[name] ?? null;
        controller.refreshRosterOnSettle = settledOk => settledOk;
        controller.renderStartSummary    = () => {};
        controller.renderSummarySlot     = line => lines.push(line);
        controller.stopFleetArmMs        = 20;

        try {
            controller.onRosterSettled();
            expect(button.text).toBe('Stop fleet · 2');

            // the first press: the plan where the summaries live, the chip the second press, nothing sent
            controller.onFleetButton();
            expect(calls).toEqual([]);
            expect(button).toMatchObject({disabled: false, iconCls: 'fa-solid fa-stop', text: 'Stop fleet · press again'});
            expect(lines.at(-1)).toEqual({detail: '', text: 'Stop fleet · 2 seats: Ada, Euclid'});

            // a settled roster whose plan matches keeps the arm; one whose plan differs takes it back
            controller.onRosterSettled();
            expect(controller.stopFleetArmed).not.toBeNull();
            records[1].set({state: 'off'});
            controller.onRosterSettled();
            expect(controller.stopFleetArmed).toBeNull();
            expect(lines.at(-1)).toBeNull();
            expect(button.text).toBe('Start fleet · 1');

            // armed again with both up: the window's end takes it back, the button reads its plan
            records[1].set({state: 'ok'});
            controller.onRosterSettled();
            controller.onFleetButton();
            expect(controller.stopFleetArmed).not.toBeNull();
            await new Promise(resolve => setTimeout(resolve, 60));
            expect(controller.stopFleetArmed).toBeNull();
            expect(button.text).toBe('Stop fleet · 2');
            expect(calls).toEqual([]);

            // the second press inside the window sends one stop intent per planned seat
            controller.onFleetButton();
            await controller.onFleetButton();
            expect(calls).toEqual(['ada', 'euclid'])
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('the second press is bound to the Fleet it confirmed: a replaced profile or a retired roster withdraws the arm before any Stop is sent, and nothing of the old plan reaches the new bridge', async () => {
        const
            calls      = [],
            records    = ['ada', 'euclid'].map(agentId => ({agentId, controlReason: null, pendingAction: null, sources: wiredSources(), state: 'ok', set(values) { Object.assign(this, values) }})),
            store      = {items: records, get: id => store.items.find(record => record.agentId === id)},
            button     = fakeButton(),
            controller = Object.create(FleetCockpitController.prototype);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {stopAgent: agentId => (calls.push(agentId), Promise.resolve({state: 'off'}))}};

        Object.defineProperty(controller, 'bridgeProfileId', {value: 'profile-a', writable: true});
        controller.resolveFleetRosterStore = () => store;
        controller.getReference            = name => ({'fleet-grid': {store}, 'fleet-button': button})[name] ?? null;
        controller.refreshRosterOnSettle   = settledOk => settledOk;
        controller.renderStartSummary      = () => {};
        controller.renderSummarySlot       = () => {};
        controller.stopFleetArmMs          = 10000;

        try {
            controller.onRosterSettled();
            controller.onFleetButton();
            expect(controller.stopFleetArmed).toMatchObject({profileId: 'profile-a', store});

            // the real switch retires the roster before the new bridge is read: the arm goes with it
            controller.bridgeProfileId = 'profile-b';
            store.items = [];
            controller.onRosterRetired();
            expect(controller.stopFleetArmed).toBeNull();
            expect(calls).toEqual([]);

            // the same switch without the retirement hook: the second press re-reads the target and sends nothing
            store.items = records;
            controller.bridgeProfileId = 'profile-a';
            controller.onRosterSettled();
            controller.onFleetButton();
            controller.bridgeProfileId = 'profile-b';
            expect(controller.onFleetButton()).toBeNull();
            expect(calls).toEqual([]);
            expect(controller.stopFleetArmed).toBeNull();

            // the unchanged target and plan still send one Stop per planned seat
            controller.bridgeProfileId = 'profile-a';
            controller.onRosterSettled();
            controller.onFleetButton();
            await controller.onFleetButton();
            expect(calls).toEqual(['ada', 'euclid'])
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('the second press re-reads eligibility: a seat whose own Stop is pending has left the plan, so the stale confirmation is withdrawn and no duplicate Stop is sent', async () => {
        const
            calls      = [],
            held       = [],
            records    = ['ada', 'euclid'].map(agentId => ({agentId, controlReason: null, pendingAction: null, sources: wiredSources(), state: 'ok', set(values) { Object.assign(this, values) }})),
            store      = {items: records, get: id => store.items.find(record => record.agentId === id)},
            button     = fakeButton(),
            controller = Object.create(FleetCockpitController.prototype);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {stopAgent: agentId => { calls.push(agentId); return new Promise(resolve => held.push(() => resolve({state: 'off'}))) }}};

        Object.defineProperty(controller, 'bridgeProfileId', {value: 'profile-a', writable: true});
        controller.resolveFleetRosterStore = () => store;
        controller.getReference            = name => ({'fleet-grid': {store}, 'fleet-button': button})[name] ?? null;
        controller.refreshRosterOnSettle   = settledOk => settledOk;
        controller.renderStartSummary      = () => {};
        controller.renderSummarySlot       = () => {};
        // the prototype harness runs no field initializers: the arm's window is the production one
        controller.stopFleetArmMs          = 10000;

        try {
            controller.onRosterSettled();
            controller.onFleetButton();
            expect(controller.stopFleetArmed).not.toBeNull();

            // the card's own Stop: the adapter writes `pending` before the bridge answers
            const card = controller.requestFleetLifecycle({action: 'stop', agentId: 'ada'}, records[0]);

            await new Promise(resolve => setTimeout(resolve, 0));
            expect(records[0].pendingAction).toBe('stop');
            expect(calls).toEqual(['ada']);

            // the second press before any roster settles: withdrawn, nothing more sent, the plan re-read
            expect(controller.onFleetButton()).toBeNull();
            expect(calls).toEqual(['ada']);
            expect(controller.stopFleetArmed).toBeNull();
            expect(button.text).toBe('Stop fleet · 1');

            held.forEach(release => release());
            await card
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('getRosterRecords treats a present empty Store as authoritative and falls back to cards only when the Store composition is absent', () => {
        const
            staleCard  = {ntype: 'fm-agent-card', record: {agentId: 'stale'}},
            controller = Object.create(FleetCockpitController.prototype);

        controller.getReference = name => ({
            'fleet-cards': {items: [staleCard]},
            'fleet-grid' : {store: {items: []}}
        })[name] ?? null;

        expect(controller.getRosterRecords()).toEqual([]);

        controller.getReference = name => ({
            'fleet-cards': {items: [staleCard]},
            'fleet-grid' : {store: {}}
        })[name] ?? null;

        expect(controller.getRosterRecords()).toEqual([]);

        controller.getReference = name => name === 'fleet-cards' ? {items: [staleCard]} : null;

        expect(controller.getRosterRecords()).toEqual([staleCard.record])
    });

    test('overlapping fleet activations join one active batch: one bridge call per member and one authoritative summary', async () => {
        const
            calls    = [],
            releases = new Map(),
            records  = ['ada', 'euclid'].map(agentId => ({
                agentId,
                controlReason: null,
                pendingAction: null,
                sources      : wiredSources(),
                state        : 'off',
                set(values) { Object.assign(this, values) }
            })),
            summaries  = [],
            controller = Object.create(FleetCockpitController.prototype);

        (globalThis.AgentOS ??= {}).fleet = {
            registryBridge: {
                startAgent(agentId) {
                    calls.push(agentId);
                    return new Promise(resolve => releases.set(agentId, resolve))
                }
            }
        };

        controller.getReference          = name => name === 'fleet-grid' ? {store: {items: records}} : null;
        controller.refreshRosterOnSettle = settledOk => settledOk;
        controller.renderStartSummary    = summary => summaries.push(summary);

        try {
            const
                first  = controller.onStartFleet(),
                second = controller.onStartFleet();

            expect(second).toBe(first);

            await Promise.resolve();
            await Promise.resolve();

            expect(calls).toEqual(['ada', 'euclid']);

            releases.get('ada')({state: 'running'});
            await Promise.resolve();
            await Promise.resolve();

            const third = controller.onStartFleet();

            expect(third).toBe(first);
            expect(calls).toEqual(['ada', 'euclid']);

            releases.get('euclid')({state: 'running'});
            await first;

            expect(summaries.filter(Boolean)).toHaveLength(1);
            expect(summaries.filter(Boolean)[0].started).toBe(2);
            expect(controller.startFleetPromise).toBeNull()
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('a fleet start sends its seats in waves: the next wave leaves once the previous one answered, the running line counts the rest as pending, and a retired batch sends no further wave (#654 AC-3)', async () => {
        const
            calls    = [],
            releases = new Map(),
            records  = ['ada', 'grace', 'vega', 'mnemo', 'euclid'].map(agentId => ({
                agentId,
                controlReason: null,
                pendingAction: null,
                sources      : wiredSources(),
                state        : 'off',
                set(values) { Object.assign(this, values) }
            })),
            summaries  = [],
            controller = Object.create(FleetCockpitController.prototype),
            settle     = async (ticks = 12) => { for (let tick = 0; tick < ticks; tick++) await Promise.resolve() };

        (globalThis.AgentOS ??= {}).fleet = {
            registryBridge: {
                startAgent(agentId) {
                    calls.push(agentId);
                    return new Promise(resolve => releases.set(agentId, resolve))
                }
            }
        };

        controller.startFleetWaveSize    = 2;
        controller.getReference          = name => name === 'fleet-grid' ? {store: {items: records}} : null;
        controller.refreshRosterOnSettle = settledOk => settledOk;
        controller.renderStartSummary    = summary => summaries.push(summary);

        try {
            const batch = controller.onStartFleet();

            await settle();

            expect(calls, 'the first wave leaves alone').toEqual(['ada', 'grace']);

            releases.get('ada')({state: 'running'});
            releases.get('grace')({state: 'running'});
            await settle();

            expect(calls, 'the second wave leaves once the first answered').toEqual(['ada', 'grace', 'vega', 'mnemo']);

            const running = summaries.filter(Boolean).at(-1);

            expect(running.started).toBe(2);
            expect(running.pending.map(({agentId}) => agentId), 'the unsent seats read pending, not rejected').toEqual(['vega', 'mnemo', 'euclid']);
            expect(running.rejected).toEqual([]);

            // a newer batch owns the slot: the third wave never leaves, and this batch writes no further line
            controller.startFleetBatch = {};
            releases.get('vega')({state: 'running'});
            releases.get('mnemo')({state: 'running'});

            const summary = await batch;

            expect(calls).toEqual(['ada', 'grace', 'vega', 'mnemo']);
            expect(summary.started).toBe(4);
            expect(summary.pending.map(({agentId}) => agentId)).toEqual(['euclid']);
            expect(summaries.filter(Boolean)).toHaveLength(1)
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('the next fleet activation excludes a timeout-bearing member instead of silently retrying an unknown operation', async () => {
        const
            calls  = [],
            record = {
                agentId      : 'euclid',
                controlReason: {action: 'start', kind: 'timeout', reason: 'start timed out after 30000ms'},
                sources      : wiredSources(),
                state        : 'off'
            },
            controller = Object.create(FleetCockpitController.prototype);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {startAgent: agentId => calls.push(agentId)}};
        controller.getReference          = name => name === 'fleet-grid' ? {store: {items: [record]}} : null;
        controller.refreshRosterOnSettle = settledOk => settledOk;
        controller.renderStartSummary    = () => {};

        try {
            const summary = await controller.onStartFleet();

            expect(calls).toEqual([]);
            expect(summary.attempted).toBe(0);
            expect(summary.excluded).toHaveLength(1);
            expect(summary.excluded[0].reason).toContain('outcome unknown')
        } finally {
            delete globalThis.AgentOS?.fleet
        }
    });

    test('onStartFleet partitions from the wire: excluded members never flip pending, and the summary renders their reasons (#14612)', async () => {
        // The staged bring-up targets the WIRED DOWN fleet: an already-up member, an unlaunchable
        // family, a guest row, KNOWN non-active participation statuses (benched AND temporarily
        // unreachable — the authoritative fact), and a runtime-unwired row are EXCLUDED-with-reason
        // — no intent fires at them
        // (their records take zero writes; excluded cards never join the pending cascade) — while
        // the eligible member drives its round-trip (no bridge → honest unauthorized). The chrome
        // summary slot receives the counts line + hover-reachable reasons.
        delete globalThis.AgentOS?.fleet;

        const mkRecord = fields => {
            const writes = [];
            return {...fields, writes, set(values) { writes.push(values) }}
        };

        const
            down        = mkRecord({agentId: 'vega',   state: 'off', sources: wiredSources()}),
            up          = mkRecord({agentId: 'ada',    state: 'ok',  sources: wiredSources()}),
            noLaunch    = mkRecord({agentId: 'native', state: 'off', launchable: false, family: 'native-neo'}),
            guest       = mkRecord({state: 'off'}),
            benched     = mkRecord({agentId: 'gemini', state: 'off', sources: wiredSources(), participationStatus: 'operator_benched'}),
            unreachable = mkRecord({agentId: 'flaky',  state: 'off', sources: wiredSources(), participationStatus: 'temporarily_unreachable'}),
            unwired     = mkRecord({agentId: 'silent', state: 'off'}),   // no sources → runtime normalizes not-wired
            slot        = {
                sets: [],
                vdom: {},
                set(values) { this.sets.push(values) },
                update() {}
            };

        const controller = Object.create(FleetCockpitController.prototype);

        controller.getReference = name => ({
            'fleet-grid'         : {store: {items: [down, up, noLaunch, guest, benched, unreachable, unwired]}},
            'fleet-start-summary': slot
        })[name] ?? null;
        controller.refreshRosterOnSettle = async () => {};

        const summary = await controller.onStartFleet();

        // eligible: only the wired down member — it took the honest unauthorized round-trip
        expect(down.writes.some(write => write.controlReason?.kind === 'unauthorized')).toBe(true);
        // excluded members took ZERO writes — never silently skipped, never falsely pending;
        // the benched + unreachable + unwired rows are the authority witnesses: zero bridge
        // writes for EVERY known non-active participation status and unusable runtime source
        expect(up.writes).toHaveLength(0);
        expect(noLaunch.writes).toHaveLength(0);
        expect(guest.writes).toHaveLength(0);
        expect(benched.writes).toHaveLength(0);
        expect(unreachable.writes).toHaveLength(0);
        expect(unwired.writes).toHaveLength(0);

        expect(summary.started).toBe(0);
        expect(summary.rejected).toHaveLength(1);
        expect(summary.excluded.map(entry => entry.agentId)).toEqual(['ada', 'native', null, 'gemini', 'flaky', 'silent']);

        // the chrome slot rendered: cleared at action start, then the outcome line + reasons title.
        // `text`, never `html`: the line interpolates wire-carried reasons — an innerHTML sink here
        // would execute markup a reason carried (the rebuild moved the sink; this pins it).
        expect(slot.sets[0]).toEqual({hidden: true, text: ''});
        expect(slot.sets[1].hidden).toBe(false);
        expect(slot.sets[1].text).toContain('rejected');
        expect(slot.sets[1].text).toContain('6 excluded');
        expect(slot.vdom.title).toContain('native: not launchable');
        expect(slot.vdom.title).toContain("ada: already up — session state 'ok'");
        expect(slot.vdom.title).toContain("gemini: not active — authoritative participation status 'operator_benched'");
        expect(slot.vdom.title).toContain("flaky: not active — authoritative participation status 'temporarily_unreachable'");
        expect(slot.vdom.title).toContain("silent: runtime source 'not-wired'")
    });

    test('onAgentLifecycleIntent resolves the firing card + drives the C2 adapter — no bridge → fail-closed onto the card record, never optimistic', () => {
        // A card fires intent-only; the cockpit resolves the firing card from the event `source` and
        // hands it + the card's roster record to the adapter. With no registry bridge the adapter fails
        // closed — an `unauthorized` controlReason lands on the record, never an optimistic success.
        delete globalThis.AgentOS?.fleet;

        const writes  = [],
              record  = {agentId: 'vega', set(values) { writes.push(values) }},
              card    = {record},
              origGet = Neo.getComponent;

        Neo.getComponent = id => id === 'fm-card-x' ? card : null;

        try {
            const controller = Object.create(FleetCockpitController.prototype);
            controller.onAgentLifecycleIntent({action: 'start', agentId: 'vega', source: 'fm-card-x'})
        } finally {
            Neo.getComponent = origGet
        }

        expect(writes.some(write => write.controlReason?.kind === 'unauthorized')).toBe(true)
    });
});
