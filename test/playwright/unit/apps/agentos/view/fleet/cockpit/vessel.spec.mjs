import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'FleetCockpitVesselTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs'; // defines Neo.get — the container child-add path resolves parents through it
import WorkspaceDocument    from '../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/WorkspaceDocument.mjs';
import FleetActivityEvents  from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import FleetCockpit         from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import FleetRoster          from '../../../../../../../../apps/agentos/store/FleetRoster.mjs';
import CockpitStateProvider from '../../../../../../../../apps/agentos/view/fleet/cockpit/StateProvider.mjs';
import ViewerWakeFeed       from '../../../../../../../../apps/agentos/store/ViewerWakeFeed.mjs';

/**
 * @summary Installs deterministic platform seams for the vessel window — `Neo.Main.windowOpen`
 * resolves a **Boolean** (a blocked popup resolves `false`, never throws), `windowClose` records
 * its call and answers with `closeResult` (`true` only when it closed that window), and the
 * window data the geometry reads is fixed.
 * @param {Object} [options={}]
 * @param {Boolean|Function} [options.openResult=true]
 * @param {Boolean|Function} [options.closeResult=true] The platform's close answer — a Boolean, or a
 *     function of the call returning one (or throwing).
 * @returns {Object} spy state + `restore()`.
 */
function installWindowVessel({openResult = true, closeResult = true} = {}) {
    let previous = {
            getByPath    : Neo.Main.getByPath,
            getWindowData: Neo.Main.getWindowData,
            windowClose  : Neo.Main.windowClose,
            windowOpen   : Neo.Main.windowOpen
        },
        previousWindowConfigs = Neo.windowConfigs,
        state = {closeCalls: [], openCalls: []};

    Neo.windowConfigs = {'unit-window': {basePath: './'}};

    Neo.Main.getByPath     = async () => null;
    Neo.Main.getWindowData = async () => ({innerHeight: 900, outerHeight: 960, screenLeft: 10, screenTop: 20});
    Neo.Main.windowOpen    = data => {
        state.openCalls.push(data);
        return typeof openResult === 'function' ? openResult(data) : Promise.resolve(openResult)
    };
    Neo.Main.windowClose   = async data => {
        state.closeCalls.push(data);
        return typeof closeResult === 'function' ? closeResult(data) : closeResult
    };

    return {
        get closeCalls() { return state.closeCalls },
        get openCalls()  { return state.openCalls },
        restore() {
            Object.assign(Neo.Main, previous);
            Neo.windowConfigs = previousWindowConfigs
        }
    }
}

/**
 * @summary A Group native lifecycle reduced to the three reads the cockpit makes — committed
 * ownership, a pending admission, a provisional connection — writable by the arms, plus the one
 * write it routes: `retire`, which asks the cockpit's close effect and answers with the engine's
 * documented grammar (`false` or a rejection retains the retirement, anything else retires). The
 * real lifecycle's own contract is the engine's spec territory, met by the coupling arm below;
 * here it is the input.
 * @param {Neo.component.Base} cockpit
 * @returns {Object}
 */
const fakeLifecycle = cockpit => {
    const owners = new Map(), admissions = new Map(), connections = new Map(), retirements = [];

    return {
        admissions, connections, owners, retirements,
        getAdmission    : (sourceId, itemId) => admissions.get(itemId)  ?? null,
        getConnection   : (sourceId, itemId) => connections.get(itemId) ?? null,
        getOwner        : (sourceId, itemId) => owners.get(itemId)      ?? null,
        // the engine registers and withdraws its effects on construct/destroy; inert here
        registerSource  : () => {},
        unregisterSource: () => {},
        retire          : async (sourceId, vessel) => {
            let closed;

            retirements.push(vessel);

            try { closed = await cockpit.closeTearOutVessel(vessel) } catch { closed = false }

            return closed !== false
        }
    }
};

/**
 * @summary The engine's handler bundle reduced to the click pop-out's pair — exit (admission)
 * and terminal (the one detach commit) — recording their calls. The terminal advances the
 * document through the cockpit's own pure reducer, which is what the engine's router reads to
 * tell a commit from a refusal.
 * @param {Neo.component.Base} cockpit
 * @param {Object} [options={}]
 * @returns {{calls: Array, handlers: Object}}
 */
const fakeHandlers = (cockpit, {commits = true, exitResult = true} = {}) => {
    const calls = [];

    return {
        calls,
        handlers: {
            activeVessel: null,
            heldPane    : () => null,
            heldPaneIds : () => [],
            heldPanes   : () => [],
            onDockTearOutExit: async data => {
                calls.push(['exit', data]);
                return exitResult
            },
            onDockTearOutTerminal: data => {
                calls.push(['terminal', data]);

                if (commits) {
                    cockpit.dockModel = cockpit.applyDockZoneOperation({operation: 'detachItem', itemId: data.itemId}).document
                }

                return true
            },
            retireActiveVessel: async () => true
        }
    }
};

/**
 * Contract specs for the cockpit's vessel layer — the seams the ENGINE's tear-out owner asks the
 * host for, and the click pop-out that rides the engine's own admission path. The lifecycle's
 * choreography (admission, the one commit, adoption, vessel death as the return) is the engine's
 * and is proven by its own specs and by the cockpit's Neural Link witnesses; these arms pin what
 * stays application code:
 *
 * 1. the platform seams — `openTearOutVessel` fails closed on the cockpit's preconditions and
 *    opens the widget-childapp window carrying the Group's reserved slot; `closeTearOutVessel`
 *    retires by the immutable window name and hands the platform's verdict to the Group
 *    unchanged (`false` and a rejection retain its retry authority);
 * 2. the vessel composition — the inspector opens at its designed 480×640, every other pane at
 *    its measured size;
 * 3. the ownership reads over the Group — owned, pending, or docked — the one toggle grammar
 *    they route (return / refuse / pop out), and `returnPane` as the Group's retirement of the
 *    owner's exact vessel, reported as the platform answered;
 * 4. `popOutPane` — refusals before any admission, and the happy path through the engine's
 *    exit → terminal pair;
 * 5. the chrome truth per phase and the stand-in a vesseled item leaves in the tree;
 * 6. the observation hooks that keep the chrome truthful after the engine acts;
 * 7. the coupling to the REAL Group lifecycle — a refused or failed close retains retirement,
 *    admission and connection and gates the next admission; the confirmed close retires them.
 */
test.describe.serial('AgentOS.view.fleet.cockpit.VesselContainer — the vessel layer over the engine\'s tear-out owner', () => {
    let cockpit, lifecycle, vessel;

    /**
     * Reveals the auto-hidden inspector so it is a projected, visible pane — the click's precondition.
     */
    const revealDetail = async () => {
        const reveal = cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'detail', autoHidden: false});

        cockpit.onDockZoneDocumentChange(reveal.document);
        await cockpit.refreshPromise
    };

    const tabContainerFor = itemId => ({
        activeIndex: 0,
        getTabBar  : () => ({sortZoneConfig: {dockItemIds: [itemId]}}),
        id         : 'live-tabs'
    });

    test.beforeEach(() => {
        cockpit = Neo.create(FleetCockpit, {
            stateProvider: {
                module: CockpitStateProvider,
                stores: {
                    fleetActivityEvents: {module: FleetActivityEvents},
                    fleetRoster        : {module: FleetRoster, autoLoad: false},
                    viewerWakeFeed     : {module: ViewerWakeFeed}
                }
            }
        });

        lifecycle             = fakeLifecycle(cockpit);
        cockpit.nativeWindows = lifecycle
    });

    test.afterEach(() => {
        cockpit?.destroy();
        cockpit = null;
        vessel?.restore();
        vessel = null;
        Neo.apps = {}
    });

    test('openTearOutVessel fails CLOSED on the cockpit\'s preconditions — an owned item and an unprojected pane never open a window; a blocked popup resolves null', async () => {
        vessel = installWindowVessel();

        // 'perspectives' is auto-hidden on the rail: no projected pane, nothing to embody
        expect(await cockpit.openTearOutVessel({itemId: 'perspectives', proxyRect: null, topologyIdentity: {}})).toBeNull();
        expect(vessel.openCalls, 'no vessel for an unprojected pane').toHaveLength(0);

        // an item the Group already records as vessel-owned opens no second window
        lifecycle.owners.set('stream', {itemId: 'stream', windowName: 'elsewhere'});
        expect(await cockpit.openTearOutVessel({itemId: 'stream', proxyRect: null, topologyIdentity: {}})).toBeNull();
        expect(vessel.openCalls, 'no vessel for an owned item').toHaveLength(0);
        lifecycle.owners.clear();

        // Boolean grammar: windowOpen resolving false IS the blocked popup — null, never a throw
        vessel.restore();
        vessel = installWindowVessel({openResult: false});
        expect(await cockpit.openTearOutVessel({itemId: 'stream', proxyRect: null, topologyIdentity: {}})).toBeNull();
        expect(vessel.openCalls, 'the platform WAS asked').toHaveLength(1);

        // a throwing platform degrades the same way
        vessel.restore();
        vessel = installWindowVessel({openResult: () => Promise.reject(new Error('platform exploded'))});
        expect(await cockpit.openTearOutVessel({itemId: 'stream', proxyRect: null, topologyIdentity: {}})).toBeNull()
    });

    test('openTearOutVessel opens the widget-childapp vessel carrying the Group\'s reserved slot, sized from the pane with the floors; closeTearOutVessel retires by window name', async () => {
        vessel = installWindowVessel();

        const identity = {groupId: 'g1', workspaceKey: 'popup:stream', generationToken: 7},
              opened   = await cockpit.openTearOutVessel({itemId: 'stream', proxyRect: {x: 40, y: 50, width: 640, height: 420}, topologyIdentity: identity});

        expect(opened).toEqual({popupHeight: 420, popupWidth: 640, windowName: `fm-tearout-stream-${cockpit.id}`});
        expect(vessel.openCalls).toHaveLength(1);

        const call = vessel.openCalls[0];

        expect(call.url, 'the vessel is the widget childapp, named by its item and nothing else').toBe('./apps/agentos/childapps/widget/index.html?tearout=stream');
        expect(call.topologyIdentity, 'the reserved slot rides the window — that is how the vessel binds to its admission').toBe(identity);
        expect(call.nativeCapabilities).toEqual({close: true, position: true, resize: true});
        expect(call.windowName).toBe(`fm-tearout-stream-${cockpit.id}`);
        expect(call.windowFeatures).toBe('height=420,left=50,top=130,width=640');

        // the floors: a tiny or missing rect never opens an unusable window
        const floored = await cockpit.openTearOutVessel({itemId: 'stream', proxyRect: {x: 0, y: 0, width: 100, height: 50}, topologyIdentity: identity});

        expect(floored).toEqual({popupHeight: 240, popupWidth: 320, windowName: `fm-tearout-stream-${cockpit.id}`});

        expect(await cockpit.closeTearOutVessel({itemId: 'stream', windowName: 'fm-tearout-stream-x'}), 'the platform confirmed the close').toBe(true);
        expect(vessel.closeCalls).toEqual([{names: ['fm-tearout-stream-x'], windowId: cockpit.windowId}])
    });

    test('closeTearOutVessel hands the platform\'s verdict to the Group unchanged — false stays false, a rejection propagates — never an inferred absence', async () => {
        vessel = installWindowVessel({closeResult: false});
        expect(await cockpit.closeTearOutVessel({itemId: 'stream', windowName: 'gone'}), 'no such window / already closed is NOT a close').toBe(false);

        vessel.restore();
        vessel = installWindowVessel({closeResult: () => { throw new Error('platform exploded') }});
        await expect(cockpit.closeTearOutVessel({itemId: 'stream', windowName: 'gone'})).rejects.toThrow('platform exploded');
        expect(vessel.closeCalls, 'the platform WAS asked').toHaveLength(1)
    });

    test('the vessel composition: the inspector opens at its designed 480×640; every other pane opens at the engine\'s measured rect', async () => {
        const composition = {x: 160, y: 120, width: 480, height: 640},
              measured    = await cockpit.measureDockPaneRect(tabContainerFor('stream'));

        expect(await cockpit.measureDockPaneRect(tabContainerFor('detail'))).toEqual(composition);
        // the engine measures the pane (the harness answers the DOM read with its fixed rect) — the
        // composition never leaks onto a pane that has none
        expect(measured).not.toEqual(composition);
        expect(measured?.width, 'a measured rect, not a composition').toBeGreaterThan(0)
    });

    test('ownership reads over the Group: owned, pending (admission · connection · in-flight vessel · held handle), or docked', () => {
        expect(cockpit.isVesselOwned('detail')).toBe(false);
        expect(cockpit.isVesselPending('detail')).toBe(false);

        lifecycle.admissions.set('detail', {itemId: 'detail'});
        expect(cockpit.isVesselPending('detail'), 'a pending admission is in flight').toBe(true);
        lifecycle.admissions.clear();

        lifecycle.connections.set('detail', {windowId: 'w1'});
        expect(cockpit.isVesselPending('detail'), 'a provisional connection is in flight').toBe(true);
        lifecycle.connections.clear();

        const {handlers} = fakeHandlers(cockpit);

        cockpit.tearOutHandlers = {...handlers, activeVessel: {itemId: 'detail'}};
        expect(cockpit.isVesselPending('detail'), 'the gesture\'s active vessel is in flight').toBe(true);

        cockpit.tearOutHandlers = {...handlers, heldPane: itemId => itemId === 'detail' ? {id: 'held'} : null};
        expect(cockpit.isVesselPending('detail'), 'a held handle is in flight').toBe(true);

        lifecycle.owners.set('detail', {itemId: 'detail', windowName: 'w'});
        expect(cockpit.isVesselOwned('detail')).toBe(true);
        expect(cockpit.isVesselPending('detail'), 'committed ownership is never pending').toBe(false);

        // the lifecycle off: nothing owned, nothing pending
        cockpit.nativeWindows   = null;
        cockpit.tearOutHandlers = null;
        expect(cockpit.isVesselOwned('detail')).toBe(false);
        expect(cockpit.isVesselPending('detail')).toBe(false)
    });

    test('the one toggle grammar: an owned vessel returns by closing its window, an in-flight one refuses, a docked pane pops out', async () => {
        vessel = installWindowVessel();

        // owned → return: the window closes by the owner's immutable name; the engine does the rest
        lifecycle.owners.set('memories', {itemId: 'memories', windowName: `fm-tearout-memories-${cockpit.id}`});
        expect(await cockpit.onMemoriesWindowToggle()).toEqual({returned: true, errors: []});
        expect(vessel.closeCalls).toEqual([{names: [`fm-tearout-memories-${cockpit.id}`], windowId: cockpit.windowId}]);
        lifecycle.owners.clear();

        // in flight → refuse instead of racing the admission
        lifecycle.admissions.set('memories', {itemId: 'memories'});
        expect(await cockpit.onMemoriesWindowToggle()).toEqual({errors: ['a vessel is in flight for this pane'], detached: false});
        lifecycle.admissions.clear();

        // docked, but not the visible pane of its zone (the inspector is auto-hidden on the rail): refused before any admission
        expect(await cockpit.onDetailWindowToggle()).toEqual({detached: false, errors: ['detail is not the visible pane of its zone']});
        expect(vessel.openCalls).toHaveLength(0);

        // returnPane on a docked pane names the refusal
        expect(await cockpit.returnPane('detail')).toEqual({returned: false, errors: ['detail is not in a vessel']})
    });

    test('returnPane reports the Group\'s retirement of the owner\'s exact vessel: a refused or failed close is not a return, and the owner stays for the retry', async () => {
        const owner = {itemId: 'memories', windowName: `fm-tearout-memories-${cockpit.id}`, generationToken: 'gen-1'};

        lifecycle.owners.set('memories', owner);

        // the platform refuses (no such window, already closed, not closable)
        vessel = installWindowVessel({closeResult: false});
        expect(await cockpit.returnPane('memories')).toEqual({returned: false, errors: ['the vessel window did not close']});
        expect(lifecycle.retirements, 'the return IS a retirement of the exact vessel — never a close around the Group').toEqual([owner]);
        expect(vessel.closeCalls).toEqual([{names: [owner.windowName], windowId: cockpit.windowId}]);
        expect(cockpit.isVesselOwned('memories'), 'an attempted close is never a return').toBe(true);

        // the platform fails
        vessel.restore();
        vessel = installWindowVessel({closeResult: () => { throw new Error('platform exploded') }});
        expect(await cockpit.returnPane('memories')).toEqual({returned: false, errors: ['the vessel window did not close']});
        expect(cockpit.isVesselOwned('memories')).toBe(true);

        // the platform confirms
        vessel.restore();
        vessel = installWindowVessel({closeResult: true});
        expect(await cockpit.returnPane('memories')).toEqual({returned: true, errors: []});
        expect(lifecycle.retirements).toHaveLength(3)
    });

    test('over the REAL Group lifecycle: a refused or failed platform close retains the retirement, the admission and the connection, gates the next admission, and the return reports it; the confirmed close retires all three', async () => {
        const manager   = (await import('../../../../../../../../node_modules/neo.mjs/src/manager/Transaction.mjs')).default,
              {groupId} = manager.bind({windowId: 'fm-vessel-unit'}),
              group     = manager.getNativeLifecycle(groupId),
              name      = `fm-tearout-stream-${cockpit.id}`;

        let answer = () => false;

        vessel = installWindowVessel({closeResult: () => answer()});

        try {
            // the three effects the engine's Workspace registers, bound to this cockpit
            group.registerSource(cockpit.id, {
                keyFor: itemId => cockpit.tearOutWorkspaceKey(itemId),
                open  : cockpit.openTearOutVessel.bind(cockpit),
                close : cockpit.closeTearOutVessel.bind(cockpit)
            });
            cockpit.nativeWindows = group;

            const identity = await group.acquire(cockpit.id, {itemId: 'stream', proxyRect: {x: 0, y: 0, width: 640, height: 420}});

            expect(identity, 'admitted through the cockpit\'s open effect').toMatchObject({itemId: 'stream', windowName: name, workspaceKey: 'popup:stream'});
            await group.onBind({...identity, windowId: 'vessel-1', generation: 1});
            expect(group.getAdmission(cockpit.id, 'stream')).toBeTruthy();
            expect(group.getConnection(cockpit.id, 'stream')).toBeTruthy();

            // refused: the Group keeps its retry authority over the exact vessel; nothing is cleared
            expect(await group.retire(cockpit.id, identity)).toBe(false);
            expect(group.pendingRetirements(cockpit.id)).toEqual([identity]);
            expect(group.getAdmission(cockpit.id, 'stream'), 'admission retained').toBeTruthy();
            expect(group.getConnection(cockpit.id, 'stream'), 'connection retained').toBeTruthy();
            expect(vessel.closeCalls).toEqual([{names: [name], windowId: cockpit.windowId}]);

            // failed: the rejection reaches the Group unchanged and is the same refusal
            answer = () => { throw new Error('platform exploded') };
            expect(await group.retire(cockpit.id, identity)).toBe(false);
            expect(group.pendingRetirements(cockpit.id)).toEqual([identity]);

            // the pending retirement gates the next admission for the item: one window, never two
            expect(await group.acquire(cockpit.id, {itemId: 'stream', proxyRect: null})).toBeNull();
            expect(vessel.openCalls).toHaveLength(1);

            // confirmed: retired, and the admission + connection it matched are gone
            answer = () => true;
            expect(await group.retire(cockpit.id, identity)).toBe(true);
            expect(group.pendingRetirements(cockpit.id)).toEqual([]);
            expect(group.getAdmission(cockpit.id, 'stream')).toBeNull();
            expect(group.getConnection(cockpit.id, 'stream')).toBeNull();

            // committed ownership: the return is that same retirement, reported
            group.recordOwner(cockpit.id, 'stream', {...identity, windowId: 'vessel-1'});
            answer = () => false;
            expect(await cockpit.returnPane('stream')).toEqual({returned: false, errors: ['the vessel window did not close']});
            expect(group.pendingRetirements(cockpit.id)).toHaveLength(1);
            expect(cockpit.isVesselOwned('stream'), 'the owner stays for the retry').toBe(true);
            answer = () => true;
            expect(await cockpit.returnPane('stream')).toEqual({returned: true, errors: []});
            expect(group.pendingRetirements(cockpit.id)).toEqual([])
        } finally {
            cockpit.nativeWindows = null;
            manager.retireGroup(groupId)
        }
    });

    test('popOutPane: refusals before any admission, then the happy path through the engine\'s exit → terminal pair with the composed rect', async () => {
        const synced = [];

        cockpit.syncControlBar = () => synced.push(1);

        // already in a vessel
        lifecycle.owners.set('detail', {itemId: 'detail', windowName: 'w'});
        expect(await cockpit.popOutPane('detail')).toEqual({detached: false, errors: ['detail is already in a vessel']});
        lifecycle.owners.clear();

        // a projected, visible inspector
        await revealDetail();
        expect(cockpit.findProjectedDockPane('detail'), 'the revealed inspector is projected').toBeTruthy();

        const {calls, handlers} = fakeHandlers(cockpit);

        cockpit.tearOutHandlers = handlers;

        const result = await cockpit.popOutPane('detail');

        expect(result).toEqual({detached: true, errors: []});
        expect(calls.map(entry => entry[0]), 'admission first, the one commit at the terminal').toEqual(['exit', 'terminal']);
        // `sortZone: null` is the click's signature; the rect is the inspector's designed composition
        expect(calls[0][1]).toEqual({itemId: 'detail', proxyRect: {x: 160, y: 120, width: 480, height: 640}, sortZone: null});
        expect(calls[1][1]).toEqual({itemId: 'detail'});
        expect(WorkspaceDocument.findContainingTabsId(cockpit.dockModel, 'detail'), 'the detach committed: the item left the tree').toBeNull();
        expect(cockpit.dockModel.items.detail, 'detachItem keeps the catalog record').toBeTruthy();
        expect(synced.length, 'the chrome re-synced after the commit').toBeGreaterThan(0);

        // no longer docked: refused before any admission
        expect(await cockpit.popOutPane('detail')).toEqual({detached: false, errors: ['detail is not a docked item']});
        expect(calls, 'no second admission').toHaveLength(2)
    });

    test('popOutPane: a refused admission commits nothing, names the refusal and leaves a warning — never a dead button', async () => {
        const warnings = [],
              warn     = console.warn;

        console.warn = (...args) => warnings.push(args);

        try {
            await revealDetail();

            const {calls, handlers} = fakeHandlers(cockpit, {exitResult: false});

            cockpit.tearOutHandlers = handlers;

            const result = await cockpit.popOutPane('detail');

            expect(result.detached).toBe(false);
            expect(result.errors[0]).toMatch(/refused by the host vessel seam/);
            expect(calls.map(entry => entry[0]), 'no terminal after a refused admission').toEqual(['exit']);
            expect(WorkspaceDocument.findContainingTabsId(cockpit.dockModel, 'detail'), 'nothing committed').toBeTruthy();
            expect(warnings).toHaveLength(1);
            expect(warnings[0][0]).toContain('detail-vessel admission failed (refused)')
        } finally {
            console.warn = warn
        }
    });

    test('the chrome truth per phase: the traveling toggles name the action they will take, the recall verbs show only while a pane is away', async () => {
        await revealDetail();

        const detailToggle = cockpit.getAgentDetailPane().getReference('detail-window-toggle'),
              recall       = cockpit.getReference('detail-recall-chrome');

        // docked
        cockpit.syncControlBar();
        expect(detailToggle.disabled).toBe(false);
        expect(detailToggle.vdom.title).toBe('Pop out detail');
        expect(recall.hidden).toBe(true);

        // in flight: the toggle refuses to race, the recall verb shows disabled
        lifecycle.admissions.set('detail', {itemId: 'detail'});
        cockpit.syncControlBar();
        expect(detailToggle.disabled).toBe(true);
        expect(detailToggle.vdom['aria-label']).toBe('Detail leaving');
        expect(recall.hidden).toBe(false);
        expect(recall.disabled).toBe(true);
        lifecycle.admissions.clear();

        // owned: both verbs offer the way home
        lifecycle.owners.set('detail', {itemId: 'detail', windowName: 'w'});
        cockpit.syncControlBar();
        expect(detailToggle.disabled).toBe(false);
        expect(detailToggle.vdom.title).toBe('Return detail');
        expect(recall.hidden).toBe(false);
        expect(recall.disabled).toBe(false);
        expect(recall.text).toBe('Return detail');

        // the memories twin
        const memoriesRecall = cockpit.getReference('memories-recall-chrome');

        lifecycle.owners.set('memories', {itemId: 'memories', windowName: 'm'});
        cockpit.syncControlBar();
        expect(memoriesRecall.hidden).toBe(false);
        expect(cockpit.getMemoriesPane()?.getReference('memories-window-toggle')?.text ?? 'Return memories').toBe('Return memories')
    });

    test('a vesseled item re-treed by a preset or an operation renders a stand-in — the live instance is never stolen back', async () => {
        await revealDetail();

        const detailPane = cockpit.getReference('agent-detail'),
              item       = cockpit.dockModel.items.detail;

        lifecycle.owners.set('detail', {itemId: 'detail', windowName: 'w'});

        const standIn = cockpit.resolvePane('detail', item);

        expect(standIn.cls).toContain('fm-pane-placeholder');
        expect(standIn.html).toBe('Agent detail is open in its own window');
        expect(detailPane.isDestroyed).toBeFalsy();

        // the pending phase leaves the same stand-in
        lifecycle.owners.clear();
        lifecycle.connections.set('detail', {windowId: 'w1'});
        expect(cockpit.resolvePane('detail', item).cls).toContain('fm-pane-placeholder');

        // docked again: the SAME live instance — the declared pane is parked, never re-created
        lifecycle.connections.clear();
        expect(cockpit.resolvePane('detail', item)).toBe(detailPane)
    });

    test('the observation hooks re-sync the chrome after the engine acts, and the return stays observable on the engine\'s channel', () => {
        const synced  = [],
              returns = [];

        cockpit.syncControlBar = () => synced.push(1);
        cockpit.on('dockPaneReturn', data => returns.push(data));

        cockpit.afterNativeOwnerChange('detail', {itemId: 'detail'}, null, false);
        cockpit.afterTearOutWindowDisconnect({});
        cockpit.onDockPaneReturn({itemId: 'detail', pane: null, phase: 'before'});
        cockpit.onDockPaneReturn({itemId: 'detail', pane: null, phase: 'after', returned: true});

        expect(synced, 'owner change · disconnect · the return\'s after phase').toHaveLength(3);
        expect(returns.map(data => data.phase)).toEqual(['before', 'after'])
    })
});
