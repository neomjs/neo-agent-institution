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
