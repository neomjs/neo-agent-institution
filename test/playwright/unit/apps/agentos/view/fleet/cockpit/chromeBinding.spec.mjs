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
import FleetActivityEvents  from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import FleetCockpit         from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import FleetRoster          from '../../../../../../../../apps/agentos/store/FleetRoster.mjs';
import ViewerWakeFeed       from '../../../../../../../../apps/agentos/store/ViewerWakeFeed.mjs';

/**
 * The chrome-binding REVEAL witness over a real constructed cockpit: the declared chrome slots
 * bind the provider's DERIVED data leaves (the two engine constraints that shape the provider:
 * child-provider formulas never re-run post-boot, and object-valued setData drills into leaf
 * paths — so derived truths are declared leaf-complete and consumers bind leaves), so the banner
 * must arrive REVEALED with the cold verdict on a cold boot, and the reconnect affordance must
 * share it.
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
    expect(banner.text).toContain('Fleet server offline');
    expect(banner.cls).toContain('fm-spine-banner-cold');
    // the title mirror carries the full sentence in the same beat
    expect(banner.vdom.title).toBe(banner.text);

    // the reconnect affordance binds the SAME derived leaf — visible on any spoken verdict
    expect(reconnect.hidden).toBe(false);

    // the wake chip binds its own derivation
    expect(telltale.text).toContain('wake:');
    expect(telltale.cls).toContain('fm-viewer-wake-degraded');

    cockpit.destroy()
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
