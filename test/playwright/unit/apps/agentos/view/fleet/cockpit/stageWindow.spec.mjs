import {setup} from '../../../../../../setup.mjs';

setup({appConfig: {name: 'FleetCockpitStageWindowTest'}});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import StateProvider  from '../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import StageWindow    from '../../../../../../../../apps/agentos/util/StageWindow.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail });
    return {promise, resolve, reject}
};

/**
 * @summary Exercises the real launch owner against independent-window boundary doubles.
 * State publication uses a real Provider. Channel messages model structured-clone delivery;
 * Main doubles record physical-window requests without opening or closing actual windows.
 */
test.describe('Fleet cockpit — optional Stage sibling lifetime', () => {
    let launcher, provider, owner, channels, opens, closes, focuses, closeReads,
        originalMain, originalConfigs, originalChannel, openResult, closedResult;

    const recordId = 'neomjs/neo-stage#59', windowId = 'fm-stage-test-owner', childId = 'stage-test-child';
    const config = extra => ({environment: 'development', url: {href: 'http://localhost:8080/apps/agentos/'},
        stageLaunchUrl: '/neo-stage/apps/stage/', ...extra});
    const row = (repo = 'neomjs/neo-stage', number = 59) => ({repo, number, title: 'Held record',
        observedAt: '2026-10-15T08:00:00Z', stale: true, holder: {role: 'operator', ids: []}});
    const snapshot = rows => ({state: 'stale', observedAt: '2026-10-15T08:01:00Z', coverage: null,
        awaitingMerge: rows || [row()]});
    const state = () => provider.getData('stageLaunch');
    const message = (channel, data) => channel.onmessage({data});
    const request = (channel = channels.at(-1), id = childId) => message(channel, {
        type: 'request', token: channel.name.slice('neo-stage:'.length), windowId: id,
        nativeRoute: {ownerWindowId: windowId, targetWindowId: id, nativeHandleKey: `handle-${id}`}
    });
    const paint = (channel = channels.at(-1), id = childId) => message(channel, {
        type: 'painted', token: channel.name.slice('neo-stage:'.length), windowId: id
    });

    test.beforeEach(() => {
        originalMain = Neo.Main;
        originalConfigs = Neo.windowConfigs;
        originalChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
        channels = []; opens = []; closes = []; focuses = []; closeReads = [];
        openResult = true; closedResult = false;
        Neo.windowConfigs = {[windowId]: config()};
        Neo.Main = {...Neo.Main,
            windowOpen: params => { opens.push(params); return Promise.resolve(openResult) },
            windowClose: async params => { closes.push(params); return true },
            windowFocus: async params => { focuses.push(params); return true },
            windowNativeIsClosed: async params => { closeReads.push(params); return closedResult }
        };
        globalThis.BroadcastChannel = class {
            constructor(name) { this.name = name; this.messages = []; this.closed = false; channels.push(this) }
            postMessage(value) { this.messages.push(structuredClone(value)) }
            close() { this.closed = true }
        };
        provider = Neo.create(StateProvider, {data: {stageLaunch: {recordId: null, state: null, message: null}}});
        owner = {component: {windowId, getStateProvider: () => provider}, bridgeProfileId: 'profile-a',
            openWorkProfileId: 'profile-a', openWorkSnapshot: snapshot(), isDestroyed: false};
        launcher = Neo.create(StageWindow, {owner, launchTimeout: 2500})
    });

    test.afterEach(async () => {
        launcher?.destroy();
        await Promise.resolve();
        provider?.destroy();
        Neo.Main = originalMain;
        if (originalConfigs === undefined) delete Neo.windowConfigs;
        else Neo.windowConfigs = originalConfigs;
        if (originalChannel) Object.defineProperty(globalThis, 'BroadcastChannel', originalChannel);
        else delete globalThis.BroadcastChannel
    });

    test('capability requires an explicit development URL on the owning window origin', () => {
        expect(StageWindow.entryUrl(config())).toBe('http://localhost:8080/neo-stage/apps/stage/');
        expect(StageWindow.entryUrl(config({stageLaunchUrl: './stage/'}))).toBe('http://localhost:8080/apps/agentos/stage/');
        for (const overrides of [{stageLaunchUrl: undefined}, {stageLaunchUrl: ''}, {environment: 'production'},
            {stageLaunchUrl: 'https://other.example/stage/'}, {stageLaunchUrl: 'javascript:alert(1)'}, {url: null}]) {
            expect(StageWindow.entryUrl(config(overrides))).toBeNull()
        }
    });

    test('resolves the repository-qualified raw row and envelope together without inventing replay or model defaults', async () => {
        const raw = row('neomjs/neo-agent-brain', 59);
        owner.openWorkSnapshot = snapshot([row(), raw]);
        owner.openWorkReadGeneration = 17;
        const pending = launcher.open('neomjs/neo-agent-brain#59'), channel = channels[0];
        owner.openWorkReadGeneration++;
        request(channel);
        expect(opens).toHaveLength(1);
        expect(opens[0]).toMatchObject({windowId, nativeCapabilities: {close: true, focus: true}});
        expect(new URL(opens[0].url).searchParams.get('stageHandoff')).toBe(channel.name.slice('neo-stage:'.length));
        expect(channel.messages).toEqual([{type: 'context', token: channel.name.slice('neo-stage:'.length), windowId: childId,
            context: {record: raw, provenance: {source: 'fleet-open-work', recordId: 'neomjs/neo-agent-brain#59',
                profileId: 'profile-a', observedAt: '2026-10-15T08:01:00Z', coverage: null}}}]);
        expect(channel.messages[0].context.record).not.toBe(raw);
        expect(channel.messages[0].context.record).not.toHaveProperty('id');
        expect(channel.messages[0].context.record).not.toHaveProperty('draft');
        expect(channel.messages[0].context).not.toHaveProperty('replay');
        expect(state().state).toBe('opening');
        paint(channel);
        expect(await pending).toEqual({state: 'painted', windowId: childId});
        expect(state()).toMatchObject({recordId: 'neomjs/neo-agent-brain#59', state: 'painted'})
    });

    test('an open receipt, context request, foreign token and unbound draw are not a painted receipt', async () => {
        const pending = launcher.open(recordId), channel = channels[0], token = channel.name.slice('neo-stage:'.length);
        let settled = false;
        pending.then(() => { settled = true });
        await Promise.resolve();
        message(channel, {type: 'painted', token});
        message(channel, {type: 'return', token});
        message(channel, {type: 'request', token, windowId: ''});
        message(channel, {type: 'request', token, windowId: '   '});
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(channel.messages).toEqual([]);
        expect(focuses).toEqual([]);
        expect(state().state).toBe('opening');
        request(channel);
        message(channel, {type: 'painted', token: 'another-launch', windowId: childId});
        message(channel, {type: 'unavailable', token, windowId: 'another-child'});
        paint(channel, 'another-child');
        expect(state().state).toBe('opening');
        paint(channel);
        expect(await pending).toEqual({state: 'painted', windowId: childId})
    });

    test('duplicate activation opens once and answers one bound child once', async () => {
        const first = launcher.open(recordId), second = launcher.open(recordId), channel = channels[0];
        request(channel);
        request(channel);
        request(channel, 'foreign-child');
        expect(opens).toHaveLength(1);
        expect(channels).toHaveLength(1);
        expect(channel.messages).toHaveLength(1);
        paint(channel);
        expect(await Promise.all([first, second])).toEqual([
            {state: 'painted', windowId: childId}, {state: 'painted', windowId: childId}
        ])
    });

    test('held context is copied before another read can mutate the caller-owned raw value', async () => {
        const raw = owner.openWorkSnapshot.awaitingMerge[0], pending = launcher.open(recordId), channel = channels[0];
        raw.title = 'Later external mutation';
        raw.holder.ids.push('@another-seat');
        request(channel);
        expect(channel.messages[0].context.record.title).toBe('Held record');
        expect(channel.messages[0].context.record.holder.ids).toEqual([]);
        paint(channel);
        await pending
    });

    for (const [name, configure] of [
        ['an absent destination', () => { delete Neo.windowConfigs[windowId].stageLaunchUrl }],
        ['a cross-origin destination', () => { Neo.windowConfigs[windowId].stageLaunchUrl = 'http://localhost:8081/stage/' }],
        ['no BroadcastChannel support', () => { globalThis.BroadcastChannel = undefined }],
        ['a removed row', () => { owner.openWorkSnapshot.awaitingMerge = [] }],
        ['an unavailable source', () => { owner.openWorkSnapshot.state = 'unavailable' }],
        ['a different current profile', () => { owner.bridgeProfileId = 'profile-b' }]
    ]) {
        test(`${name} refuses before opening any sibling`, async () => {
            configure();
            expect(await launcher.open(recordId)).toEqual({state: 'unavailable'});
            expect(state()).toMatchObject({recordId, state: 'unavailable'});
            expect(opens).toEqual([]);
            expect(channels).toEqual([])
        })
    }

    test('a blocked popup reports unavailable and releases its channel', async () => {
        openResult = false;
        expect(await launcher.open(recordId)).toEqual({state: 'unavailable'});
        expect(state().message).toContain('denied');
        expect(channels[0].closed).toBe(true);
        expect(launcher.active).toBeNull();
        expect(closes).toEqual([{names: opens[0].windowName, windowId}])
    });

    test('a native open rejection is unavailable, never a fabricated drawn record', async () => {
        Neo.Main.windowOpen = params => { opens.push(params); return Promise.reject(new Error('native refusal')) };
        expect(await launcher.open(recordId)).toEqual({state: 'unavailable'});
        expect(state().state).toBe('unavailable');
        expect(channels[0].closed).toBe(true);
        expect(launcher.active).toBeNull()
    });

    test('timeout settles even while native open is unresolved; its late result closes only that old sibling', async () => {
        const native = deferred();
        openResult = native.promise;
        launcher.launchTimeout = 30;
        const pending = launcher.open(recordId), result = await Promise.race([pending, pause(200).then(() => 'not-settled')]);
        expect(result).toEqual({state: 'unavailable'});
        expect(state().message).toContain('drawn record');
        expect(channels[0].closed).toBe(true);
        expect(launcher.active).toBeNull();
        native.resolve(true);
        await pause(0);
        expect(closes.length).toBeGreaterThanOrEqual(1);
        expect(closes.every(call => call.names === opens[0].windowName && call.windowId === windowId)).toBe(true);
        expect(state().state).toBe('unavailable')
    });

    for (const [name, replace] of [
        ['a replacement snapshot', () => { owner.openWorkSnapshot = snapshot() }],
        ['a new bridge profile', () => { owner.bridgeProfileId = 'profile-b' }],
        ['a retired source profile', () => { owner.openWorkProfileId = null }]
    ]) {
        test(`${name} retires the pending context and ignores its late draw`, async () => {
            const pending = launcher.open(recordId), channel = channels[0];
            request(channel);
            replace();
            paint(channel);
            expect(state().state).toBe('opening');
            expect(await Promise.race([pending, pause(1000).then(() => 'not-retired')])).toEqual({state: 'superseded'});
            expect(channel.closed).toBe(true);
            expect(launcher.active).toBeNull()
        })
    }

    test('destruction settles before a late native open and never publishes its late draw', async () => {
        const native = deferred();
        openResult = native.promise;
        const pending = launcher.open(recordId), channel = channels[0];
        request(channel);
        launcher.destroy();
        expect(await Promise.race([pending, pause(100).then(() => 'not-settled')])).toEqual({state: 'superseded'});
        expect(channel.closed).toBe(true);
        native.resolve(true);
        paint(channel);
        await pause(0);
        expect(state().state).toBe('opening');
        expect(closes.every(call => call.names === opens[0].windowName)).toBe(true)
    });

    test('a superseded channel and late native completion cannot replace a newer record', async () => {
        const native = deferred();
        openResult = native.promise;
        owner.openWorkSnapshot = snapshot([row(), row('neomjs/neo-agent-brain', 59)]);
        const first = launcher.open(recordId), old = channels[0];
        request(old);
        openResult = true;
        const second = launcher.open('neomjs/neo-agent-brain#59'), current = channels[1];
        expect(old.closed).toBe(true);
        request(old, 'late-old-child');
        paint(old);
        expect(state()).toMatchObject({recordId: 'neomjs/neo-agent-brain#59', state: 'opening'});
        native.resolve(true);
        await pause(0);
        expect(closes.every(call => call.names === opens[0].windowName)).toBe(true);
        expect(opens[0].windowName).not.toBe(opens[1].windowName);
        request(current);
        paint(current);
        expect(await first).toEqual({state: 'superseded'});
        expect(await second).toEqual({state: 'painted', windowId: childId});
        expect(state()).toMatchObject({recordId: 'neomjs/neo-agent-brain#59', state: 'painted'})
    });

    test('native close before draw retires without painting; monitoring also survives a successful draw', async () => {
        let pending = launcher.open(recordId);
        request();
        closedResult = true;
        expect(await Promise.race([pending, pause(1000).then(() => 'not-retired')])).toEqual({state: 'superseded'});
        expect(state().state).toBe('closed');
        expect(channels[0].closed).toBe(true);
        expect(closeReads[0]).toEqual({nativeHandleKey: `handle-${childId}`, windowId});

        closedResult = false;
        pending = launcher.open(recordId);
        request();
        paint();
        expect(await pending).toEqual({state: 'painted', windowId: childId});
        closedResult = true;
        await expect.poll(() => state().state, {timeout: 1000, intervals: [100]}).toBe('closed');
        expect(channels.at(-1).closed).toBe(true);
        expect(launcher.active).toBeNull()
    });

    test('a painted child survives its launch deadline, and a foreign native route grants no close observation', async () => {
        launcher.launchTimeout = 30;
        const pending = launcher.open(recordId), channel = channels[0], token = channel.name.slice('neo-stage:'.length);
        message(channel, {type: 'request', token, windowId: childId,
            nativeRoute: {ownerWindowId: 'some-other-owner', targetWindowId: childId, nativeHandleKey: 'foreign-handle'}});
        paint(channel);
        expect(await pending).toEqual({state: 'painted', windowId: childId});
        await pause(550);
        expect(state().state).toBe('painted');
        expect(launcher.active).not.toBeNull();
        expect(channel.closed).toBe(false);
        expect(closes).toEqual([]);
        expect(closeReads).toEqual([])
    });

    test('a failed native-close observation grants no closure; a bound return publishes closing before requesting its sibling close', async () => {
        Neo.Main.windowNativeIsClosed = async params => { closeReads.push(params); throw new Error('unread') };
        const pending = launcher.open(recordId), channel = channels[0];
        request(channel);
        paint(channel);
        await pending;
        await expect.poll(() => closeReads.length, {timeout: 1000, intervals: [100]}).toBeGreaterThan(0);
        expect(state().state).toBe('painted');
        expect(launcher.active).not.toBeNull();
        const atCloseRequest = [], close = Neo.Main.windowClose,
            requested = {recordId, state: 'closing', message: 'Stage close requested.'};
        Neo.Main.windowClose = params => { atCloseRequest.push({...state()}); return close(params) };
        message(channel, {type: 'return', token: channel.name.slice('neo-stage:'.length), windowId: childId});
        expect(state(), 'return requests closure; it cannot claim a verified physical close').toEqual(requested);
        expect(atCloseRequest, 'the addressed closing state precedes the ordinary Main close call').toEqual([requested]);
        expect(focuses, 'the child owns focusing its opener before sending this return').toEqual([]);
        expect(closes).toEqual([{names: opens[0].windowName, windowId}]);
        expect(channel.closed).toBe(true);
        expect(launcher.active).toBeNull()
    })
});
