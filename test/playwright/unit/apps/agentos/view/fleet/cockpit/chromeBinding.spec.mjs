import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'BannerProbeTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect}       from '@playwright/test';
import Neo                  from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core            from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                           '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import CockpitStateProvider from '../../../../../../../../apps/agentos/view/fleet/cockpit/StateProvider.mjs';
import DeploymentStateRead  from '../../../../../../../../apps/agentos/util/DeploymentStateRead.mjs';
import FleetActivityEvents  from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import FleetCockpit         from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import FleetRoster          from '../../../../../../../../apps/agentos/store/FleetRoster.mjs';
import ViewerWakeFeed       from '../../../../../../../../apps/agentos/store/ViewerWakeFeed.mjs';
import {installFleetBridge} from '../../../../../../../../apps/agentos/fleet/installFleetBridge.mjs';
import {createFleetWireResponse} from '../../../../../../../../apps/agentos/config/fleetWireMethods.mjs';

/**
 * The chrome-binding REVEAL witness over a real constructed cockpit: the declared chrome slots
 * bind the provider's formula-owned leaves. The formula model, source-exact: the provider's
 * onConstructed performs the initial run, each formula PULLS its dependencies through the
 * hierarchical data proxy while its Effect subscribes those Configs, and later dependency
 * changes schedule re-runs automatically. Object-valued setData drills into leaf paths, so the
 * derived truths are declared leaf-complete and consumers bind leaves. The banner must arrive
 * REVEALED with the cold verdict on a cold boot, and the reconnect affordance must share it.
 */
test('the declared chrome binds the derived truths — banner revealed with the cold verdict', async () => {
    const cockpit = Neo.create(FleetCockpit, {
        stateProvider: {
            module: CockpitStateProvider,
            stores: {
                fleetActivityEvents: {module: FleetActivityEvents},
                fleetRoster        : {module: FleetRoster, autoLoad: false},
                viewerWakeFeed     : {module: ViewerWakeFeed}
            }
        }
    });

    await cockpit.refreshPromise;

    const
        banner    = cockpit.getReference('fleet-spine-banner'),
        reconnect = cockpit.getReference('fleet-reconnect-button'),
        telltale  = cockpit.getReference('viewer-wake-telltale');

    expect(banner).toBeTruthy();
    expect(banner.hidden, 'the cold verdict reveals the banner').toBe(false);
    // #23: the visible label is the STATUS WORD; the full sentence rides title + aria
    expect(banner.text).toBe('fleet offline');
    expect(banner.cls).toContain('fm-spine-banner-cold');
    expect(banner.vdom.title).toContain('Fleet server offline');
    expect(banner.vdom['aria-label']).toContain('Fleet server offline');

    // the reconnect affordance binds the SAME derived leaf — visible on any spoken verdict
    expect(reconnect.hidden).toBe(false);

    // the wake chip binds its own derivation
    expect(telltale.text).toContain('wake');
    expect(telltale.cls).toContain('fm-viewer-wake-degraded');

    cockpit.destroy()
});

test('typed wire refusal and recovery drive the real read owner, reactive banner and parent dot', async () => {
    const previousFleet = globalThis.AgentOS?.fleet,
          parent = Neo.create((await import('../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs')).default, {
              data: {boundProfileId: null, instanceState: 'off'}
          }),
          cockpit = Neo.create(FleetCockpit, {
              stateProvider: {
                  module: CockpitStateProvider,
                  parent,
                  stores: {
                      fleetActivityEvents: {module: FleetActivityEvents},
                      fleetRoster: {module: FleetRoster, autoLoad: false},
                      viewerWakeFeed: {module: ViewerWakeFeed}
                  }
              }
          });

    try {
        await cockpit.refreshPromise;
        const provider = cockpit.getStateProvider(),
              banner = cockpit.getReference('fleet-spine-banner');
        provider.setData({gridAdapterState: 'live', streamAdapterState: 'sample'});

        let answer;
        installFleetBridge({send: () => new Promise(resolve => { answer = resolve })});
        const pending = cockpit.getController().loadActivity();
        await expect.poll(() => banner.text).toBe('feed connecting');
        answer(createFleetWireResponse('refused', {error: 'request denied; token=private-token'}));
        await pending;

        expect(banner.text).toBe('feed refused');
        expect(banner.vdom.title).toContain('request denied');
        expect(banner.vdom.title).not.toContain('private-token');
        expect(banner.vdom['aria-label']).toBe(banner.vdom.title);
        expect(parent.getData('instanceState')).toBe('limited');

        installFleetBridge({send: async () => createFleetWireResponse('ok', {
            result: {capability: {state: 'wired'}, events: []}
        })});
        await cockpit.getController().loadActivity();
        expect(provider.getData('streamConnection.state')).toBeNull();
        expect(banner.hidden).toBe(true);
        expect(parent.getData('instanceState')).toBe('ok')
    } finally {
        cockpit.destroy();
        parent.destroy();
        previousFleet === undefined ? delete globalThis.AgentOS.fleet : globalThis.AgentOS.fleet = previousFleet
    }
});

test('RA-1 witness: the cockpit derivation writes the PARENT-owned instanceState — live→ok, degraded→limited, never a child shadow', async () => {
    // the review falsifier inverted: with the child shadow removed, the derived dot verdict must
    // land on the Viewport-owned key (the instance switcher binds THERE), through setData's
    // closest-owner walk
    const parentProvider = Neo.create((await import('../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs')).default, {
        data: {boundProfileId: null, instanceState: 'off'}
    });

    const cockpit = Neo.create(FleetCockpit, {
        stateProvider: {
            module: CockpitStateProvider,
            parent: parentProvider,
            stores: {
                fleetActivityEvents: {module: FleetActivityEvents},
                fleetRoster        : {module: FleetRoster, autoLoad: false},
                viewerWakeFeed     : {module: ViewerWakeFeed}
            }
        }
    });

    await cockpit.refreshPromise;

    const child = cockpit.getStateProvider();

    // the child must NOT own a twin — ownership stays with the parent
    // the CLASS declares no local twin (a child redeclaration would shadow the parent owner)
    expect(Object.hasOwn(CockpitStateProvider.config.data, 'instanceState')).toBe(false);

    // cold boot derives 'off' onto the PARENT
    expect(parentProvider.getData('instanceState')).toBe('off');

    // a live spine flips the PARENT to ok
    child.setData({gridAdapterState: 'live', streamAdapterState: 'live'});
    expect(parentProvider.getData('instanceState')).toBe('ok');

    // a degrade flips the PARENT to limited — the switcher one level up sees every transition
    child.setData({streamAdapterState: 'stale', streamDegradedReason: 'transport lost'});
    expect(parentProvider.getData('instanceState')).toBe('limited');

    cockpit.destroy();
    parentProvider.destroy()
});

test('RA-2 falsifier: the wake title moves while the visible text stays byte-identical — no channel rides another as a change proxy', async () => {
    const cockpit = Neo.create(FleetCockpit, {
        stateProvider: {
            module: CockpitStateProvider,
            stores: {
                fleetActivityEvents: {module: FleetActivityEvents},
                fleetRoster        : {module: FleetRoster, autoLoad: false},
                viewerWakeFeed     : {module: ViewerWakeFeed}
            }
        }
    });

    await cockpit.refreshPromise;

    const
        provider = cockpit.getStateProvider(),
        telltale = cockpit.getReference('viewer-wake-telltale'),
        stream   = {alive: false, reason: 'wake stream disconnected', capturedAt: 1000};

    // stamp 1: no catch-up observation
    provider.setData('viewerWake', {stream, catchUp: {state: null, at: null, pending: null}, signals: []});

    const text1  = telltale.text,
          title1 = telltale.chipTitle;

    // stamp 2: the catch-up observation arrives — the visible text derives ONLY from the stream
    // half here, so it stays byte-identical while the drill detail (title) must move
    provider.setData('viewerWake', {stream, catchUp: {state: 'fresh', at: 2000, pending: 3}, signals: []});

    expect(telltale.text, 'the visible chip line is byte-identical across the stamps').toBe(text1);
    expect(telltale.chipTitle, 'the drill detail moved anyway — its own first-class binding').not.toBe(title1);
    expect(telltale.chipTitle).toContain('catch-up: fresh (3 pending drained)');
    expect(telltale.vdom.title).toBe(telltale.chipTitle);
    expect(telltale.vdom['aria-label']).toContain('Viewer wake push');

    cockpit.destroy()
});

// The leaf-complete witness the fakes cannot give: `setData` drills object values into leaf paths
// and bubbles a new leaf up ONLY through object-valued parents — a parent declared `null` stops the
// bubble, so a block that arrives as an object where the default was `null` would read `null`
// forever. The picture is declared on the VIEWPORT provider (the System keeper-view is the cockpit's
// sibling) and written by the cockpit's read owner through setData's closest-owner walk, so the
// witness composes the real parent/child pair: the landing must read back on the PARENT, nested
// blocks included, and a later absent block clears back to the declared blank instead of vanishing.
test('the deployment-state picture lands leaf-complete on the REAL parent provider — nested maintenance blocks read back, and an absent block clears', async () => {
    const
        parent  = Neo.create((await import('../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs')).default, {
            data: {deploymentState: DeploymentStateRead.blank(), systemConnection: {state: null, reason: null}}
        }),
        cockpit = Neo.create(FleetCockpit, {
            stateProvider: {
                module: CockpitStateProvider,
                parent,
                stores: {
                    fleetActivityEvents: {module: FleetActivityEvents},
                    fleetRoster        : {module: FleetRoster, autoLoad: false},
                    viewerWakeFeed     : {module: ViewerWakeFeed}
                }
            }
        });

    try {
        await cockpit.refreshPromise;

        const
            controller = cockpit.getController(),
            projection = {
                state      : 'ok',
                reason     : null,
                generatedAt: 1_700_000_000_000,
                ageMs      : 12_000,
                services   : [{serviceKey: 'mc-server', status: 'available'}],
                maintenance: {
                    backup    : {phase: 'exhausted', lastSuccessAt: null, lastSuccessAgeMs: null, health: {status: 'degraded', reasonCodes: ['backup-never-succeeded']}, lastBackup: {finishedAt: '2026-09-04T16:41:27.657Z', status: 'success', offHostSync: 'disabled'}},
                    starvation: {posture: 'degraded', breachCount: 5}
                }
            };

        DeploymentStateRead.apply(controller, projection);

        const landed = parent.data.deploymentState;

        expect(landed.state).toBe('ok');
        expect(landed.services, 'rows stay one atomic array').toEqual(projection.services);
        expect(landed.maintenance.backup.phase, 'the nested block reads back through the proxy').toBe('exhausted');
        expect(landed.maintenance.backup.lastBackup.status, 'two levels down as well').toBe('success');
        expect(landed.maintenance.backup.health.reasonCodes, 'the codes stay one atomic array').toEqual(['backup-never-succeeded']);
        expect(landed.maintenance.starvation.breachCount).toBe(5);
        expect(parent.getData('deploymentState.maintenance.starvation.posture'), 'and by leaf path').toBe('degraded');
        expect(parent.data.systemConnection, 'the answered surface carries no observation').toEqual({state: null, reason: null});
        expect(cockpit.getStateProvider().getDataConfig?.('deploymentState.state') ?? null, 'the child declares no shadow of the parent truth').toBeNull();

        // the plane stops reporting its lanes: the blocks clear to the declared blank, never to `null`
        DeploymentStateRead.apply(controller, {...projection, maintenance: {backup: null, starvation: null}});

        expect(parent.data.deploymentState.maintenance.backup.phase).toBeNull();
        expect(parent.data.deploymentState.maintenance.backup.health.reasonCodes).toEqual([]);
        expect(parent.data.deploymentState.maintenance.backup.lastBackup.status).toBeNull();
        expect(parent.data.deploymentState.maintenance.starvation.breachCount).toBeNull()
    } finally {
        cockpit.destroy();
        parent.destroy()
    }
});
