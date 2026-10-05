import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'PerspectiveCaptureTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect}       from '@playwright/test';
import Neo                  from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core            from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                           '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import CockpitPerspectives  from '../../../../../../../../apps/agentos/util/CockpitPerspectives.mjs';
import CockpitStateProvider from '../../../../../../../../apps/agentos/view/fleet/cockpit/StateProvider.mjs';
import FleetActivityEvents  from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import FleetCockpit         from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import ViewerWakeFeed       from '../../../../../../../../apps/agentos/store/ViewerWakeFeed.mjs';
import WorkspaceDocument    from '../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/WorkspaceDocument.mjs';
import Operations           from '../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Operations.mjs';
import {createShellProvider} from './shellProvider.mjs';

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
        parent: createShellProvider(),
        stores: {
            fleetActivityEvents: {module: FleetActivityEvents},
            viewerWakeFeed     : {module: ViewerWakeFeed}
        }
    }
});

const projected = cockpit => cockpit.getStateProvider().data.perspectives;

// Out of scope: missing awaiting-merge fixture store warning (defect-note MESSAGE:e5dcc130-ea69-40ea-b5e3-da55c32fbfe2).

test.describe('FleetCockpit — the perspectives drawer\'s verbs through the real relay', () => {
    let cockpit;

    test.afterEach(() => {
        const shell = cockpit?.getStateProvider().parent;

        cockpit?.destroy();
        shell?.destroy();
        cockpit = null
    });

    test('boot projects the three declared duties ahead of an empty capture library; the live row is the engine\'s own leaf', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const list = projected(cockpit);

        expect(list.items.map(item => item.layoutId)).toEqual(['Overview', 'Focus', 'Review']);
        expect(list.items.map(item => item.captureScope), 'the duties are declared rows, not captures').toEqual([null, null, null]);
        expect(list.captureNote).toBeNull();
        expect(list.applyNote).toBeNull();
        expect(cockpit.perspectiveStore.list(), 'the capture library starts empty').toEqual([]);
        // seeded by the Workspace onto the cockpit's own provider — the drawer binds it
        expect(cockpit.getStateProvider().getData('dock.perspective.active')).toBe('Overview')
    });

    test('capture files the live layout under the name and projects the verdict — filed, never activated, and never a bar button', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const verdict = cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Triage'});

        expect(verdict).toEqual({saved: true, layoutId: 'capture-triage', name: 'Triage', errors: []});
        expect(cockpit.perspectiveStore.list().map(item => item.layoutId)).toEqual(['capture-triage']);
        // activating would restore the capture as a new document, and a perspective restore
        // releases every open reveal — the drawer would close on its own verdict; the live layout
        // already IS this document, so the engine's committed name stays where it was
        expect(cockpit.getStateProvider().getData('dock.perspective.active'), 'a capture is filed, not restored').toBe('Overview');

        const list = projected(cockpit);

        expect(list.items.map(item => item.perspectiveName)).toEqual(['Overview', 'Focus', 'Review', 'Triage']);
        expect(list.captureNote).toBe('captured "Triage" — apply it from its card');

        // filed, never activated: the committed name is still the declared duty
        expect(cockpit.getStateProvider().getData('dock.perspective.active')).toBe('Overview')
    });

    test('a capture taken while the inspector is away in its vessel files it in its home, not as closed', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const home = WorkspaceDocument.findContainingTabsId(cockpit.dockModel, 'detail');

        // the engine's own detach: its wrapper records the home with the tear-out owner
        cockpit.onDockZoneDocumentChange(cockpit.applyTearOutOperation({operation: 'detachItem', itemId: 'detail'}).document);

        expect(home, 'the inspector has a home to return to').toBeTruthy();
        expect(WorkspaceDocument.findContainingTabsId(cockpit.dockModel, 'detail'), 'the live document places it nowhere').toBeNull();

        expect(cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Away'}).saved).toBe(true);

        expect(WorkspaceDocument.findContainingTabsId(cockpit.perspectiveStore.getPerspective('Away').layout.dockZone, 'detail')).toBe(home)
    });

    test('a duty\'s name is refused by the wrapper — nothing filed, the refusal projected; a re-capture under a held name updates that capture in place', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const verdict = cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Overview'});

        // a duty is not a library record: the refusal comes before the document is read
        expect(verdict.saved).toBe(false);
        expect(verdict.layoutId).toBeNull();
        expect(verdict.errors).toEqual(['"Overview" is a declared perspective — a capture needs its own name']);
        expect(cockpit.perspectiveStore.list(), 'nothing filed').toEqual([]);
        expect(projected(cockpit).captureNote).toBe('capture refused: "Overview" is a declared perspective — a capture needs its own name');

        // a re-capture under a held name folds to the SAME id, and the library's own-id update
        // flow replaces the record in place — one capture, the latest document, never two rows
        // answering to one name (the collision verdict guards a FOREIGN id holding the name: an
        // imported artifact's)
        expect(cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Triage'}).saved).toBe(true);

        cockpit.onDockZoneDocumentChange(cockpit.applyDockZoneOperation({operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.2, 0.8]}).document);

        const again = cockpit.getController().onPerspectiveRequest({action: 'capture', name: 'Triage'});

        expect(again).toEqual({saved: true, layoutId: 'capture-triage', name: 'Triage', errors: []});
        expect(cockpit.perspectiveStore.list()).toHaveLength(1);
        expect(cockpit.perspectiveStore.getPerspective('Triage').layout.dockZone.nodes['primary-split'].sizes, 'the latest document').toEqual([0.2, 0.8]);
        expect(projected(cockpit).captureNote).toBe('captured "Triage" — apply it from its card')
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
            expect(cockpit.perspectiveStore.list()).toHaveLength(0)
        } finally {
            console.error = originalError
        }
    });

    test('an unnamed capture is refused before the wrapper sees the document', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const verdict = cockpit.getController().onPerspectiveRequest({action: 'capture', name: '   '});

        expect(verdict).toEqual({saved: false, layoutId: null, name: null, errors: ['a perspective needs a name']});
        expect(cockpit.perspectiveStore.list()).toHaveLength(0)
    });

    test('apply on a declared duty is the engine\'s activePerspective write: the document commits and the name publishes synchronously, the request stays pending until the refresh settles', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const provider = cockpit.getStateProvider(),
              settled  = cockpit.getController().onPerspectiveRequest({action: 'apply', name: 'Focus'});

        // Like every dock commit: stored and published synchronously, re-projected deferred. The
        // switch's refresh does not settle in this harness (no main thread lands the
        // re-projection), so the settled verdict and the cleared request are the declaration
        // spec's witness over a settling cockpit; what this harness CAN pin is the write and the
        // publication the drawer follows with no reconcile.
        expect(settled).toBeInstanceOf(Promise);
        expect(cockpit.activePerspective).toBe('Focus');
        expect(cockpit.dockModel.nodes['primary-split'].sizes).toEqual([0.85, 0.15]);
        expect(provider.getData('dock.perspective.active')).toBe('Focus');
        expect(provider.getData('dock.perspective.modified')).toBe(false);
        expect(provider.getData('dock.perspective.pending'), 'the request clears with the refresh, which never lands here').toBe('Focus');
        expect(cockpit.perspectiveStore.collection.activeLayoutId, 'the library is not the selection').toBeNull()
    });

    test('a stored perspective that names a retired pane applies without it — no refusal, no tab for a pane that is gone', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        // a capture exported before the Route graph left the cockpit, filed the way an import files it
        const legacy = WorkspaceDocument.clone(cockpit.getPerspectiveDocument());

        legacy.items.goldenPathGraph = {reference: 'golden-path-graph', title: 'Route graph'};
        legacy.nodes['stream-tabs'].items.push('goldenPathGraph');

        const {layout} = CockpitPerspectives.captureSavedLayout(legacy, 'Legacy', Object.keys(cockpit.perspectives ?? {}));

        cockpit.perspectiveStore.savePerspective(layout, {activate: true});

        // the commit lands synchronously; its re-projection never settles in this harness (see above)
        expect(cockpit.activatePerspective('Legacy')).toBeInstanceOf(Promise);
        expect(cockpit.presetError, 'the apply is not refused').toBeNull();
        expect(cockpit.dockModel.items.goldenPathGraph).toBeUndefined();
        expect(cockpit.dockModel.nodes['stream-tabs'].items).toEqual(['stream', 'tasks', 'memories', 'operator', 'catchUp', 'goldenPath'])
    });

    for (const closable of [true, undefined]) {
        test(`a stored Fleet close flag of ${closable} cannot override the current pane policy`, async () => {
            cockpit = createCockpit();
            await cockpit.refreshPromise;

            const legacy = WorkspaceDocument.clone(cockpit.getPerspectiveDocument());

            if (closable === undefined) delete legacy.items.fleet.closable;
            else legacy.items.fleet.closable = closable;
            legacy.items.stream.closable = false;

            const {layout} = CockpitPerspectives.captureSavedLayout(legacy, 'Legacy Fleet');

            cockpit.perspectiveStore.savePerspective(layout);
            expect(cockpit.activatePerspective('Legacy Fleet')).toBeInstanceOf(Promise);
            expect(cockpit.presetError).toBeNull();
            expect(cockpit.dockModel.items.fleet.closable).toBe(false);
            expect(cockpit.dockModel.items.stream.closable, 'the optional pane keeps its saved policy').toBe(false);
            expect(Operations.closeItem(cockpit.dockModel, {itemId: 'fleet'}).errors).toEqual(['item "fleet" is not closable']);
            expect(cockpit.perspectiveStore.loadPerspective('Legacy Fleet').document.items.fleet.closable,
                'applying a layout does not rewrite the stored capture').toBe(closable)
        })
    }

    test('a saved layout without Fleet is refused visibly and leaves the current document intact', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const legacy = WorkspaceDocument.clone(cockpit.getPerspectiveDocument());
        legacy.items.fleet.closable = true;

        const {document, errors} = Operations.closeItem(legacy, {itemId: 'fleet'}),
              {layout}           = CockpitPerspectives.captureSavedLayout(document, 'No Fleet'),
              before             = cockpit.dockModel;

        expect(errors).toEqual([]);
        cockpit.perspectiveStore.savePerspective(layout);

        const verdict = await cockpit.activatePerspective('No Fleet');

        expect(verdict).toEqual({switched: false, errors: ['This layout has no Fleet roster. Choose Overview, Focus or Review.']});
        expect(cockpit.dockModel).toBe(before);
        expect(cockpit.presetError).toBe('No Fleet: This layout has no Fleet roster. Choose Overview, Focus or Review.');
        expect(projected(cockpit).applyNote).toBe(`switch refused: ${cockpit.presetError}`)
    });

    test('a saved layout with Fleet detached keeps its catalog record and remains admissible', async () => {
        cockpit = createCockpit();
        await cockpit.refreshPromise;

        const {document, errors} = Operations.detachItem(cockpit.getPerspectiveDocument(), {itemId: 'fleet'}),
              {layout}           = CockpitPerspectives.captureSavedLayout(document, 'Detached Fleet');

        expect(errors).toEqual([]);
        cockpit.perspectiveStore.savePerspective(layout);
        expect(cockpit.activatePerspective('Detached Fleet')).toBeInstanceOf(Promise);
        expect(cockpit.presetError).toBeNull();
        expect(cockpit.dockModel.items.fleet.closable).toBe(false);
        expect(WorkspaceDocument.findContainingTabsId(cockpit.dockModel, 'fleet')).toBeNull()
    });
});
