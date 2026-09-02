import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'PerspectiveCaptureTest', isMounted: () => true, vnodeInitialising: false}
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
 * The perspectives drawer's two verbs, driven through the cockpit's REAL relay over a real
 * constructed cockpit: `apply` switches the layout and the settled refresh republishes the list;
 * `capture` wraps the live dock document under the operator's name, refuses a held name with the
 * library's own verdict, and every outcome reaches the projected list the drawer binds to
 * (`perspectives` in provider data) — never a side channel.
 */
const createCockpit = () => Neo.create(FleetCockpit, {
    stateProvider: {
        module: CockpitStateProvider,
        stores: {
            fleetActivityEvents: {module: FleetActivityEvents},
            fleetRoster        : {module: FleetRoster, autoLoad: false},
            viewerWakeFeed     : {module: ViewerWakeFeed}
        }
    }
});

const projected = cockpit => cockpit.getStateProvider().data.perspectives;

test.describe('FleetCockpit — the perspectives drawer\'s verbs through the real relay', () => {
    let cockpit;

    test.afterEach(() => {
        cockpit?.destroy();
        cockpit = null
    });

    test('boot projects the three shipped presets with Overview active', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const list = projected(cockpit);

        expect(list.items.map(item => item.layoutId)).toEqual(['overview', 'focus', 'review']);
        expect(list.items.map(item => item.perspectiveName)).toEqual(['Overview', 'Focus', 'Review']);
        expect(list.activeLayoutId).toBe('overview');
        expect(list.captureNote).toBeNull()
    });

    test('capture files the live layout under the name and projects the verdict — filed, never activated; the switcher seats it on the next refresh', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const verdict = cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Triage'});

        expect(verdict).toEqual({saved: true, layoutId: 'capture-triage', name: 'Triage', errors: []});
        expect(cockpit.perspectiveStore.list().map(item => item.layoutId)).toEqual(['overview', 'focus', 'review', 'capture-triage']);
        // activating would restore the capture as a new document, and a perspective restore
        // releases every open reveal — the drawer would close on its own verdict; the live layout
        // already IS this document, so the store's active pointer stays where it was
        expect(cockpit.perspectiveStore.collection.activeLayoutId, 'a capture is filed, not restored').toBe('overview');

        const list = projected(cockpit);

        expect(list.items.map(item => item.perspectiveName)).toEqual(['Overview', 'Focus', 'Review', 'Triage']);
        expect(list.activeLayoutId).toBe('overview');
        expect(list.captureNote).toBe('captured "Triage" — apply it from its card');

        // never in the capture's own tick: an update elsewhere in the cockpit while the drawer
        // re-renders inside its open reveal overlay drops the revealed pane (measured live)
        expect(cockpit.getReference('fleet-preset-capture-triage'), 'the switcher does not reconcile in the capture tick').toBeFalsy();

        // the next dock refresh's pre-projection chrome sync seats it
        cockpit.syncControlBar();

        const button = cockpit.getReference('fleet-preset-capture-triage');

        expect(button, 'the capture joins the preset switcher on the next refresh').toBeTruthy();
        expect(button.text).toBe('Triage');
        expect(button.pressed, 'seated, not pressed — Apply is the switch').toBe(false);
        expect(cockpit.getReference('fleet-preset-overview').pressed).toBe(true)
    });

    test('a held name is refused with the library\'s collision verdict — nothing replaced, the refusal projected', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const verdict = cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Overview'});

        // a capture's id carries the `capture-` prefix, so the preset's OWN id never absorbs it:
        // the library sees a different record claiming a held name and refuses
        expect(verdict.saved).toBe(false);
        expect(verdict.layoutId).toBeNull();
        expect(verdict.name).toBe('Overview');
        expect(verdict.errors).toEqual(['"Overview" is already held by Overview — mission control']);
        expect(cockpit.perspectiveStore.list()).toHaveLength(3);
        expect(cockpit.perspectiveStore.getPerspective('Overview').layout.metadata.source, 'the shipped preset is untouched').toBe('fm-cockpit-presets');

        const list = projected(cockpit);

        expect(list.captureNote).toBe('capture refused: "Overview" is already held by Overview — mission control');
        expect(list.activeLayoutId).toBe('overview')
    });

    test('a capture that throws inside the library still projects a verdict — never a silent nothing', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const originalError = console.error;

        console.error = () => {};
        cockpit.perspectiveStore.savePerspective = () => { throw new Error('collection storage refused') };

        try {
            const verdict = cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Triage'});

            expect(verdict).toEqual({saved: false, layoutId: null, name: 'Triage', errors: ['capture failed: collection storage refused']});
            expect(projected(cockpit).captureNote).toBe('capture refused: capture failed: collection storage refused');
            expect(cockpit.perspectiveStore.list()).toHaveLength(3)
        } finally {
            console.error = originalError
        }
    });

    test('an unnamed capture is refused before the wrapper sees the document', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const verdict = cockpit.getController().onPerspectiveRequest({action: 'capture', name: '   '});

        expect(verdict).toEqual({saved: false, layoutId: null, name: null, errors: ['a perspective needs a name']});
        expect(cockpit.perspectiveStore.list()).toHaveLength(3)
    });

    test('apply switches through the preset path: the store activates the layout and the switcher presses its button', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const verdict = cockpit.getController().onPerspectiveRequest({action: 'apply', name: 'Focus'});

        expect(verdict).toEqual({errors: [], switched: true});
        expect(cockpit.perspectiveStore.collection.activeLayoutId).toBe('focus');

        // The switch's refresh does not settle in this harness (no main thread lands the
        // re-projection, so neither refresh hook runs), and the SETTLED-refresh republish —
        // `afterRefreshDockWorkspace` → `publishPerspectives` — is the running cockpit's witness:
        // the drawer re-projects the new active layout after a switch there. What the harness CAN
        // pin is the projection itself: one publish over the switched store reaches the list the
        // drawer binds to, and the control bar's reconcile presses the switched preset.
        cockpit.publishPerspectives();
        cockpit.syncControlBar();

        expect(projected(cockpit).activeLayoutId).toBe('focus');
        expect(cockpit.getReference('fleet-preset-focus').pressed).toBe(true);
        expect(cockpit.getReference('fleet-preset-overview').pressed).toBe(false)
    });
});
