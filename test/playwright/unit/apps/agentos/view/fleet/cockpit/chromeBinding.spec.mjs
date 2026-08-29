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
 * bind the provider's DERIVED data leaves (engine constraints hold: child-provider formulas
 * never re-run post-boot, object-valued setData drills into leaf paths, and only declared leaf
 * configs deliver to binds — all verified live 2026-08-29), so the banner must arrive REVEALED
 * with the cold verdict on a cold boot, and the reconnect affordance must share it.
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
