import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: 'FleetCockpitOperatorSeatIdentityTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
// the spec file stands in for the thread ENTRYPOINT (src/worker/App.mjs in production), which is
// the one place that imports the instance manager — real Store/Record paths resolve Neo.get here
import                     '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * Covers the operator-seat identity posture — the conflation-honesty half of the operator mailbox:
 * `deriveOperatorIdentityPosture` marks a viewer whose identity is also a roster agent as CONFLATED
 * (an outside viewer is clean), answers null when there is no roster truth or no identity to judge
 * against (absence is not a clean bill), and `loadOperatorIdentity` holds the posture owner-side and
 * pushes record + posture to the mailbox pane through its accessor. Prototype-call harness; the
 * roster Store and the registry bridge are faked at the seams the methods read.
 */
test.describe('Fleet cockpit — operator-seat identity posture (the conflation honesty half)', () => {
    let FleetCockpitController;

    test.beforeAll(async () => {
        FleetCockpitController = (await import('../../../../../../../../apps/agentos/view/fleet/cockpit/Controller.mjs')).default
    });

    const derive = (viewerIdentity, rows) => FleetCockpitController.prototype.deriveOperatorIdentityPosture.call(
        {resolveFleetRosterStore: () => ({items: rows})},
        viewerIdentity
    );

    const ROWS = [{agentId: 'neo-fable-clio'}, {agentId: 'neo-opus-vega'}, {agentId: 'neo-opus-ada'}];

    test('a viewer matching a roster agent identity is conflated; an outside viewer is clean', () => {
        expect(derive('@neo-fable-clio', ROWS)).toEqual({conflated: true, seatIdentity: '@neo-fable-clio'});
        expect(derive('@tobiu', ROWS)).toEqual({conflated: false, seatIdentity: '@tobiu'})
    });

    test('an empty roster answers null — absence of roster truth is not a clean bill', () => {
        expect(derive('@tobiu', [])).toBeNull();
        expect(derive(null, ROWS)).toBeNull();
        expect(derive('   ', ROWS)).toBeNull()
    });

    test('loadOperatorIdentity holds the posture owner-side and pushes record + posture through the accessor', async () => {
        const pushes = [],
              me     = Object.assign(Object.create(FleetCockpitController.prototype), {
                  component              : {getOperatorMailboxPane: () => ({set: config => pushes.push(config)})},
                  isDestroyed            : false,
                  resolveFleetRosterStore: () => ({items: ROWS})
              }),
              previousNs = globalThis.AgentOS;

        globalThis.AgentOS = {fleet: {registryBridge: {
            resolveViewerIdentity: async () => ({ok: true, agentIdentityNodeId: '@neo-fable-clio'})
        }}};

        try {
            await me.loadOperatorIdentity();

            expect(me.operatorRecord).toEqual({agentIdentityNodeId: '@neo-fable-clio', githubUsername: 'neo-fable-clio'});
            expect(me.operatorIdentityPosture).toEqual({conflated: true, seatIdentity: '@neo-fable-clio'});
            expect(pushes).toEqual([{
                record         : {agentIdentityNodeId: '@neo-fable-clio', githubUsername: 'neo-fable-clio'},
                identityPosture: {conflated: true, seatIdentity: '@neo-fable-clio'}
            }])
        } finally {
            globalThis.AgentOS = previousNs
        }
    });
});
