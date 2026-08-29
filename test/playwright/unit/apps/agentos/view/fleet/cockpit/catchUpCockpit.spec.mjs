import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'FleetCatchUpCockpitTest', isMounted: () => true, vnodeInitialising: false}
});

import {expect, test} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import FleetCockpit           from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import FleetCockpitController from '../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs';

// the catch-up loads are CONTROLLER methods now — a prototype host with the pane accessor on the
// component seat drives them as production code
const makeCatchUpHost = pane => Object.assign(Object.create(FleetCockpitController.prototype), {
    catchUpMarkOutcome   : null,
    catchUpReadGeneration: 0,
    catchUpSnapshot      : null,
    component            : {getCatchUpPane: () => pane},
    isDestroyed          : false
});

const clearBridge = () => { delete globalThis.AgentOS?.fleet };

test.describe('FleetCockpit — catch-up owner routing', () => {
    test.afterEach(() => clearBridge());

    test('load routes to the authenticated verb and writes both owner and live pane', async () => {
        const snapshot = {capability: {state: 'wired'}, partition: '@neo-opus-ada', window: {}, sources: {}},
              pane     = {},
              calls    = [],
              cockpit  = makeCatchUpHost(pane);

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetHistory: async params => { calls.push(params); return snapshot; }}};

        await expect(cockpit.loadCatchUp({partition: '@neo-opus-ada'})).resolves.toBe(snapshot);
        expect(calls).toEqual([{partition: '@neo-opus-ada'}]);
        expect(cockpit.catchUpSnapshot).toBe(snapshot);
        expect(pane.snapshot).toBe(snapshot)
    });

    test('unwired/throw read and unwired/throw mark remain explicit, never empty or advanced', async () => {
        const pane = {},
              make = () => makeCatchUpHost(pane);

        clearBridge();
        await expect(make().loadCatchUp({partition: 'unified'}))
            .resolves.toMatchObject({capability: {state: 'unavailable'}, sources: null});
        await expect(make().markCatchUp({windowEnd: '2026-07-18T12:00:00.000Z'}))
            .resolves.toEqual({status: 'not-wired', reason: 'fleet catch-up mark verb not wired'});

        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {
            fleetHistory     : async () => { throw new Error('secret read detail') },
            markFleetCaughtUp: async () => { throw new Error('secret write detail') }
        }};
        await expect(make().loadCatchUp())
            .resolves.toMatchObject({capability: {state: 'unavailable', reason: 'fleet history read failed'}, sources: null});
        await expect(make().markCatchUp({windowEnd: '2026-07-18T12:00:00.000Z'}))
            .resolves.toEqual({status: 'error', reason: 'fleet catch-up mark failed'})
    });

    test('an older read loses the generation race', async () => {
        let resolveOld;
        const pane    = {},
              cockpit = makeCatchUpHost(pane),
              old     = new Promise(resolve => { resolveOld = resolve });

        let reads = 0;
        (globalThis.AgentOS ??= {}).fleet = {registryBridge: {fleetHistory: () => ++reads === 1 ? old : Promise.resolve({id: 'new'})}};

        const first  = cockpit.loadCatchUp(),
              second = cockpit.loadCatchUp();

        await second;
        resolveOld({id: 'old'});
        await first;

        expect(cockpit.catchUpSnapshot).toEqual({id: 'new'});
        expect(pane.snapshot).toEqual({id: 'new'})
    });

    test('partition choices come from roster mailbox identities; live adjacency activates the stream TAB, then focuses', async () => {
        const focused = [],
              rows    = [
                  {agentId: 'ada', githubUsername: 'neo-opus-ada', displayName: 'Ada'},
                  {agentId: 'guest', githubUsername: null, displayName: 'Guest'}
              ],
              stream = {id: 'stream-1', focus: (...args) => focused.push(args)},
              // the resident south strip: catch-up is the active tab when the jump fires, so the
              // adjacency must re-activate the stream's tab before focus can reach mounted DOM
              strip   = {activeIndex: 3},
              cockpit = {
                  dockModel    : {nodes: {'stream-tabs': {items: ['stream', 'memories', 'operator', 'catchUp']}}},
                  down         : config => config.dockNodeId === 'stream-tabs' ? strip : null,
                  getReference : ref => ref === 'activity-stream' ? stream : null,
                  timeout      : () => Promise.resolve()
              };

        expect(FleetCockpitController.prototype.buildCatchUpPartitionOptions.call({resolveFleetRosterStore: () => ({items: rows})})).toEqual([
            {id: 'catch-up-ada', label: 'Ada', partition: '@neo-opus-ada'}
        ]);
        const controller = Object.assign(Object.create(FleetCockpitController.prototype), {
            component   : cockpit,
            getReference: cockpit.getReference
        });

        await expect(controller.openCatchUpLiveSurface({target: 'activity-stream'}))
            .resolves.toEqual({opened: true, target: 'activity-stream'});
        expect(strip.activeIndex, 'the stream tab is active again').toBe(0);
        expect(focused).toEqual([['stream-1', false, true]])
    })
});
