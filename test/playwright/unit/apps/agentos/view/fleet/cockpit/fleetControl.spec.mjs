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
 * Covers the cockpit's whole-fleet control (B4, #14611): `onStartFleet` fans a start intent out to
 * every resident card through the C2 adapter (the collapsed-idle fold skipped; no bridge → an honest
 * `unauthorized` reason onto each record, never an optimistic fleet-wide success),
 * `getRosterRecords` treats a present Store as authoritative over the rendered cards, overlapping
 * activations join one active batch (one bridge call per member, one authoritative summary), the
 * next activation excludes a timeout-bearing member instead of retrying an unknown operation, the
 * wire's partition keeps excluded members off `pending` and renders their reasons (#14612), and a
 * card's own lifecycle intent resolves the firing card before it drives the adapter. Prototype-call
 * harness on the REAL controller; the adapter and the bridge are the collaborators the arms fake.
 */
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
