import {setup}              from '../../../../../../setup.mjs';
import {test, expect}       from '@playwright/test';
import Neo                  from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core            from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Store                from '../../../../../../../../node_modules/neo.mjs/src/data/Store.mjs';
import FleetAgent           from '../../../../../../../../apps/agentos/model/FleetAgent.mjs';
import SeatRuntimeContainer from '../../../../../../../../apps/agentos/view/fleet/detail/SeatRuntimeContainer.mjs';
import Detail               from '../../../../../../../../apps/agentos/view/fleet/detail/Container.mjs';
import Cockpit              from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import RosterRow            from '../../../../../../../../apps/agentos/util/RosterRow.mjs';
import Adapter              from '../../../../../../../../apps/agentos/util/FleetLifecycleIntentAdapter.mjs';

const appName = 'FleetSeatRuntimeTest';
setup({neoConfig: {unitTestMode: true}, appConfig: {name: appName, isMounted: () => true, vnodeInitialising: false}});

const oldId   = 'a'.repeat(64), nextId = 'b'.repeat(64), otherId = 'c'.repeat(64);
const sources = {runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}};
let store, group, detail;

/** @summary Uses the production model and a real Store record, including its same-record mutation path. */
function createRecord(values = {}) {
    store = Neo.create(Store, {keyProperty: 'agentId', model: FleetAgent, data: [{agentId: 'seat', state: 'ok', sources,
        runtimeGeneration  : {id: oldId, pin: 'held'}, nextRuntimeGeneration: {id: nextId},
        installedGeneration: {state: 'observed', id: nextId}, ...values}]});
    return store.get('seat');
}

test.afterEach(() => { detail?.destroy(); group?.destroy(); store?.destroy(); detail = group = store = null });

test('native setup uses the shown running seat and stays busy until its answer', async () => {
    const startedAt = '2026-11-15T09:00:00.000Z', calls = [];
    const record = createRecord({harnessType: 'antigravity', nativeWakeSetup: {expectedStartedAt: startedAt}});
    let resolve, request;
    const bridge = {startAgent: params => { calls.push(params); return new Promise(r => { resolve = r }) }};
    const controller = {id: 'native-owner', rosterObservedAt: null,
        onAgentLifecycleIntent(data) { request = Adapter.handleFleetLifecycleIntent(data, record, {bridge, timeoutMs: -1}) }};
    const host = {getController: () => controller, resolveProviderStore: () => null, detailRecord: record, buildDetailWindowToggle: () => ({})};
    const config = Cockpit.prototype.seedPane.call(host, 'detail', {...Cockpit.prototype.panes.detail, appName});
    delete config.reference;
    detail = Neo.create(Detail, config);
    detail.parentId = null;
    const runtime = detail.getReference('seat-runtime');
    expect(runtime.getReference('native-wake-description').text).toContain('shared Antigravity sidecar');
    runtime.onNativeWakeClick();
    runtime.onNativeWakeClick();
    await Promise.resolve();
    expect(calls).toEqual([{agentId: 'seat', activateNativeWake: true, expectedStartedAt: startedAt}]);
    resolve({state: 'running', nativeWakePreparation: {state: 'prepared'}, wakeRoute: {state: 'ready', adapter: 'primary-session'}});
    await request;
    expect(record.nativeWakeOutcome).toBe('ready');
    runtime.updateRecord(record);
    expect(runtime.getReference('native-wake-feedback').text).toContain('not yet confirmed');
    expect(runtime.getReference('native-wake-description').hidden).toBe(false);
    record.set({sources: null}); runtime.updateRecord(record);
    expect(runtime.getReference('native-wake-feedback').hidden).toBe(true);
    record.set({sources}); runtime.updateRecord(record);
    record.set({nativeWakeSetup: {expectedStartedAt: '2026-11-15T10:00:00.000Z'}}); runtime.updateRecord(record);
    expect(runtime.getReference('native-wake-feedback').hidden).toBe(true);
    record.set({nativeWakeSetup: null}); runtime.updateRecord(record);
    expect(runtime.getReference('native-wake-setup').hidden).toBe(true);
    runtime.onNativeWakeClick();
    expect(calls).toHaveLength(1);
    detail.getController().onRuntimeLifecycleIntent({action: 'setupNativeWake', agentId: 'previous-seat', expectedStartedAt: startedAt});
    expect(calls).toHaveLength(1);
});

test('native setup refuses a stale selection or launch and reports backend refusal', async () => {
    const startedAt = '2026-11-15T09:00:00.000Z', calls = [];
    const record = createRecord({harnessType: 'codex-desktop', nativeWakeSetup: {expectedStartedAt: startedAt}});
    const bridge = {startAgent: async params => { calls.push(params); return {state: 'running',
        nativeWakePreparation: {state: 'refused', reason: 'running-seat-changed'}} }};
    const stale = await Adapter.handleFleetLifecycleIntent({action: 'setupNativeWake', agentId: 'seat',
        expectedStartedAt: 'old'}, record, {bridge});
    expect(stale.accepted).toBe(false);
    const wrongSeat = await Adapter.handleFleetLifecycleIntent({action: 'setupNativeWake', agentId: 'other',
        expectedStartedAt: startedAt}, record, {bridge});
    expect(wrongSeat.accepted).toBe(false);
    expect(calls).toEqual([]);
    await Adapter.handleFleetLifecycleIntent({action: 'setupNativeWake', agentId: 'seat', expectedStartedAt: startedAt}, record, {bridge});
    expect(record.nativeWakeOutcome).toBe('seat-changed');
    expect(calls).toHaveLength(1);
});

test('native outcomes have family-specific, actionable view guidance without config or delivery claims', async () => {
    const startedAt = '2026-11-15T09:00:00.000Z';
    const record = createRecord({harnessType: 'codex-desktop', nativeWakeSetup: {expectedStartedAt: startedAt}});
    const intent = {action: 'setupNativeWake', agentId: 'seat', expectedStartedAt: startedAt};
    group = Neo.create(SeatRuntimeContainer, {appName, record});
    for (const family of ['codex-desktop', 'antigravity']) {
        record.set({harnessType: family});
        for (const [result, expected] of [
            [{nativeWakePreparation: {state: 'prepared'}, wakeRoute: {state: 'ready', adapter: 'primary-session'}}, 'ready'],
            [{nativeWakePreparation: {state: 'prepared'}, wakeRoute: {state: 'unarmed'}}, 'not-ready'],
            [{nativeWakePreparation: {state: 'refused', reason: 'running-seat-changed'}}, 'seat-changed'],
            [{nativeWakePreparation: {state: 'refused', reason: 'receiver-mismatch'}}, 'unconfirmed'],
            [{status: 'rejected', reason: '/private/secret/path'}, 'unconfirmed'],
            [{}, 'unconfirmed']
        ]) {
            await Adapter.handleFleetLifecycleIntent(intent, record, {bridge: {startAgent: async () => result}});
            expect(record.nativeWakeOutcome).toBe(expected);
            group.updateRecord(record);
            const text = group.getReference('native-wake-feedback').text;
            expect(text).not.toMatch(/\/private|configuration|CLI/);
            if (expected === 'ready') {
                expect(text).toContain('not yet confirmed');
                expect(text).toContain(family === 'codex-desktop' ? 'Hooks settings' : 'new main Antigravity session');
                expect(group.getReference('native-wake-description').hidden).toBe(family === 'codex-desktop');
            } else if (expected === 'seat-changed') expect(text).toContain('Refresh');
            else expect(text).toContain('Retry setup');
        }
        await Adapter.handleFleetLifecycleIntent(intent, record, {bridge: {startAgent: async () => { throw new Error('/private/secret/path') }}});
        expect(record.nativeWakeOutcome).toBe('unconfirmed');
        group.updateRecord(record);
        expect(group.getReference('native-wake-feedback').text).toContain('Retry setup');
        expect(group.getReference('runtime-control-feedback').text).not.toContain('/private');
        await Adapter.handleFleetLifecycleIntent(intent, record, {bridge: null});
        expect(record.nativeWakeOutcome).toBe('bridge-unavailable');
        group.updateRecord(record);
        expect(group.getReference('native-wake-feedback').text).toContain('reconnect Fleet');
        expect(group.getReference('native-wake-setup').disabled).toBe(true);
        await Adapter.handleFleetLifecycleIntent(intent, record, {bridge: {startAgent: async () => ({})}});
        expect(record.nativeWakeOutcome).toBe('unconfirmed');
        group.updateRecord(record);
        expect(group.getReference('native-wake-feedback').text).toContain('Retry setup');
        expect(group.getReference('native-wake-setup').disabled).toBe(false);
    }
});

test('native setup times out without admitting a second in-flight request', async () => {
    const startedAt = '2026-11-15T09:00:00.000Z', calls = [];
    const record = createRecord({harnessType: 'codex-desktop', nativeWakeSetup: {expectedStartedAt: startedAt}});
    let resolve;
    const bridge = {startAgent: params => { calls.push(params); return new Promise(r => { resolve = r }) }};
    const intent = {action: 'setupNativeWake', agentId: 'seat', expectedStartedAt: startedAt};
    const first = await Adapter.handleFleetLifecycleIntent(intent, record, {bridge, timeoutMs: 0});
    expect(first.status).toBe('timeout');
    expect(record.pendingAction).toBe('setupNativeWake');
    expect((await Adapter.handleFleetLifecycleIntent(intent, record, {bridge})).accepted).toBe(false);
    expect(calls).toHaveLength(1);
    resolve({state: 'running', nativeWakePreparation: {state: 'refused'}});
    await first.settlement;
    expect(record.pendingAction).toBeNull();
});

test('current, next Start and installed identity remain separate; expansion reads the complete IDs', () => {
    const record = createRecord();
    group = Neo.create(SeatRuntimeContainer, {appName, record});
    expect(group.getReference('current-runtime').text).toContain('differs from Next Start');
    expect(group.getReference('next-runtime').text).toContain('(installed)');
    expect(group.getReference('restart-runtime').hidden).toBe(false);
    expect(group.getReference('restart-runtime').disabled).toBe(false);
    expect(group.getReference('runtime-identities').hidden).toBe(true);
    group.onToggleIds();
    expect(group.getReference('runtime-identities').hidden).toBe(false);
    expect(group.getReference('current-runtime-id').text).toContain(oldId);
    expect(group.getReference('next-runtime-id').text).toContain(nextId);
});

test('only an explicit click emits a bound restart; pending and unmatched targets emit nothing', () => {
    const record = createRecord(), intents = [];
    group = Neo.create(SeatRuntimeContainer, {appName, record});
    group.on({lifecycleIntent: data => intents.push({action: data.action, agentId: data.agentId, expectedRuntimeGeneration: data.expectedRuntimeGeneration})});
    group.updateRecord(record);
    expect(intents).toEqual([]);
    group.onRestartClick();
    expect(intents).toEqual([{action: 'restart', agentId: 'seat', expectedRuntimeGeneration: nextId}]);
    record.set({pendingAction: 'restart'}); group.updateRecord(record);
    group.onRestartClick();
    expect(intents).toHaveLength(1);
    expect(group.getReference('runtime-control-feedback').text).toContain('in progress');
    record.set({pendingAction: null, installedGeneration: {state: 'observed', id: otherId}}); group.updateRecord(record);
    group.onRestartClick();
    expect(intents).toHaveLength(1);
    expect(group.getReference('installed-runtime').text).toContain('differs');
    expect(group.getReference('restart-runtime').hidden).toBe(true);
});

test('a released pin is last runtime; unknown or unavailable evidence never says running', () => {
    const record = createRecord({state: 'off', runtimeGeneration: {id: oldId, pin: 'released'}});
    group = Neo.create(SeatRuntimeContainer, {appName, record});
    expect(group.getReference('current-runtime').text).toContain('Last runtime');
    expect(group.getReference('restart-runtime').hidden).toBe(true);
    record.set({state: 'ok', runtimeGeneration: {id: oldId, pin: 'unknown'}}); group.updateRecord(record);
    expect(group.getReference('current-runtime').text).toContain('not verified');
    record.set({runtimeGeneration: {id: oldId, pin: 'held'}, sources: null}); group.updateRecord(record);
    expect(group.getReference('current-runtime').text).toContain('Last reported');
    expect(group.getReference('restart-runtime').disabled).toBe(true);
});

test('confirmed new pin closes the migration action; explicit null clears all prior profile facts', () => {
    const record = createRecord();
    group = Neo.create(SeatRuntimeContainer, {appName, record});
    record.set({runtimeGeneration: {id: nextId, pin: 'held'}}); group.updateRecord(record);
    expect(group.getReference('current-runtime').text).toBe('Running on the installed generation.');
    expect(group.getReference('restart-runtime').hidden).toBe(true);
    group.onToggleIds();
    record.set({runtimeGeneration: null, nextRuntimeGeneration: null, installedGeneration: null}); group.updateRecord(record);
    for (const key of ['current', 'next', 'installed']) expect(group.getReference(`${key}-runtime-id`).text).not.toContain(nextId);
    expect(group.getReference('current-runtime').text).toBe('Seat generation not reported.');
    expect(group.getReference('show-runtime-ids').hidden).toBe(true);
    expect(group.getReference('runtime-identities').hidden).toBe(true);
});

test('a copied observed target survives DTO normalization without replacing the current pin', () => {
    const row = RosterRow.mapRosterRow({id: 'seat', runtimeGeneration: {id: oldId, pin: 'unknown'},
        nextRuntimeGeneration: {id: otherId}, installedGeneration: {state: 'observed', id: nextId}});
    expect(row).toMatchObject({runtimeGeneration: {id: oldId, pin: 'unknown'}, nextRuntimeGeneration: {id: otherId},
        installedGeneration: {state: 'observed', id: nextId}});
    expect(RosterRow.mapRosterRow({id: 'seat'})).toMatchObject({runtimeGeneration: null, nextRuntimeGeneration: null, installedGeneration: null});
});

test('Detail relays the exact target through its retained cockpit owner without a parent controller', () => {
    const record     = createRecord(), intents = [];
    const controller = {id: 'runtime-owner', rosterObservedAt: null,
        onAgentLifecycleIntent(data) { intents.push({action: data.action, agentId: data.agentId, expectedRuntimeGeneration: data.expectedRuntimeGeneration}) }};
    const host        = {getController: () => controller, resolveProviderStore: () => null, detailRecord: record, buildDetailWindowToggle: () => ({})};
    const declaration = Cockpit.prototype.panes.detail;
    const config      = Cockpit.prototype.seedPane.call(host, 'detail', {...declaration, appName});
    expect(config.listeners.scope).toBe(controller);
    // Standalone ownership has no parent reference registry; the explicit listener scope is the witness.
    delete config.reference;
    detail = Neo.create(Detail, config);
    detail.parentId = null;
    detail.getReference('seat-runtime').onRestartClick();
    expect(intents).toEqual([{action: 'restart', agentId: 'seat', expectedRuntimeGeneration: nextId}]);
    detail.getController().onRuntimeLifecycleIntent({agentId: 'previous-seat', expectedRuntimeGeneration: nextId});
    expect(intents).toHaveLength(1);
});

test('a stopped seat with exitReason shows the full Detail wording + matched log line in SeatRuntimeContainer and the session ledger row (#683)', () => {
    const
        exitedAt      = '2026-10-16T08:00:00.000Z',
        harnessUpdate = {
            state      : 'harness-update',
            exitedAt,
            logPath    : '/Users/ada/Library/Logs/Claude/main.log',
            matchedLine: '2026-10-16 07:59:58 [info] AutoUpdater: quitAndInstall'
        },
        unknownReason = {
            state   : 'unknown',
            exitedAt,
            logPath : '/Users/ada/Library/Logs/Claude/main.log',
            reason  : 'EACCES: permission denied'
        },
        unknownNoLog = {
            state: 'unknown',
            exitedAt
        },
        record   = createRecord({state: 'off', exitReason: harnessUpdate}),
        feedback = () => group.getReference('runtime-control-feedback');

    group = Neo.create(SeatRuntimeContainer, {appName, record});
    expect(feedback().hidden).toBe(false);
    expect(feedback().text).toContain('stopped · harness update — Claude Desktop quit this seat to install its own update (');
    expect(feedback().text).toContain('2026-10-16 07:59:58 [info] AutoUpdater: quitAndInstall (/Users/ada/Library/Logs/Claude/main.log)');

    // Detail session ledger row shows "stopped · harness update" instead of "stopped" / "Fleet stopped its process"
    detail = Neo.create(Detail, {appName, record});
    const sessionRow = () => {
        const cn = detail.getReference('detail-ledger').vdom.cn;
        const idx = cn.findIndex(node => node.text === 'session');
        return cn[idx + 1]
    };
    expect(sessionRow().text).toBe('stopped · harness update');
    expect(sessionRow().title).toContain('2026-10-16 07:59:58 [info] AutoUpdater: quitAndInstall (/Users/ada/Library/Logs/Claude/main.log)');

    // unknown exitReason with unreadable log
    record.set({exitReason: unknownReason});
    group.updateRecord(record);
    detail.applyRecord();
    expect(feedback().text).toContain('stopped · reason unknown — The seat\'s process exited at ');
    expect(feedback().text).toContain('its harness log could not be read: EACCES: permission denied.');
    expect(feedback().text).toContain('/Users/ada/Library/Logs/Claude/main.log');
    expect(sessionRow().text).toBe('stopped · reason unknown');

    // unknown exitReason with no logPath (non-Claude-Desktop harnesses)
    record.set({exitReason: unknownNoLog});
    group.updateRecord(record);
    detail.applyRecord();
    expect(feedback().text).toContain('08:00:00Z without a Stop from FM; Fleet Manager reads no harness log for this seat\'s harness yet. Start the seat. If it exits again, read its harness log before a third Start.');
    expect(feedback().text).not.toContain('its harness log names no reason');
    expect(feedback().text).not.toContain('/Users/');
    expect(sessionRow().text).toBe('stopped · reason unknown');

    // intentional Stop (exitReason: null) clears the feedback and restores "offline · stopped" / "Fleet stopped its process"
    record.set({exitReason: null});
    group.updateRecord(record);
    detail.applyRecord();
    expect(feedback().hidden).toBe(true);
    expect(sessionRow().text).toBe('offline · stopped');
    expect(sessionRow().title).toBe('Fleet stopped its process');

    // subsequent Start (state: 'ok', exitReason: null) shows nothing in runtime-control-feedback
    record.set({state: 'ok', exitReason: null});
    group.updateRecord(record);
    expect(feedback().hidden).toBe(true)
});

