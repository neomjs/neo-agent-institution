import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'FleetCockpitDeclarationTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import Authoring            from '../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Authoring.mjs';
import Operations           from '../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/Operations.mjs';
import WorkspaceDocument    from '../../../../../../../../node_modules/neo.mjs/src/dashboard/dock/model/WorkspaceDocument.mjs';
import FleetActivityEvents  from '../../../../../../../../apps/agentos/store/FleetActivityEvents.mjs';
import FleetCockpit         from '../../../../../../../../apps/agentos/view/fleet/cockpit/Container.mjs';
import FleetRoster          from '../../../../../../../../apps/agentos/store/FleetRoster.mjs';
import CockpitStateProvider from '../../../../../../../../apps/agentos/view/fleet/cockpit/StateProvider.mjs';
import ViewerWakeFeed       from '../../../../../../../../apps/agentos/store/ViewerWakeFeed.mjs';
import {shippedDockDocument} from './shippedDockDocument.mjs';

const SHIPPED = shippedDockDocument();

/**
 * Contract specs for the cockpit's dock DECLARATION — `panes` + `zones` on the class, lowered by
 * the engine (`Authoring.fromZones`) instead of a hand-built document:
 *
 * 1. the declaration lowers to the shipped document node-for-node — explicit node ids, sizes,
 *    the resizable right edge with its committed extent, active items, and the auto-hidden
 *    records — so every preset and persisted perspective keyed by those ids restores unchanged;
 * 2. the live cockpit's document IS that document;
 * 3. the declared panes name the keeper-view surfaces by the same `reference` the shipped
 *    catalog carried, so `getReference()` answers by the record's name.
 */
test.describe('AgentOS.view.fleet.cockpit.Container — the dock declaration lowers to the shipped document', () => {
    let cockpit;

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
        })
    });

    test.afterEach(() => {
        cockpit?.destroy();
        cockpit = null;
        Neo.apps = {}
    });

    test('the Overview declaration lowers to the shipped document node-for-node: ids, sizes, the resizable right edge, active items, auto-hidden records', () => {
        const {panes, perspectives} = cockpit;

        expect(panes, 'the cockpit declares its panes').toBeTruthy();
        expect(Object.keys(perspectives), 'the cockpit declares its duties as perspectives').toEqual(['Overview', 'Focus', 'Review']);

        const {document, errors} = Authoring.fromZones(panes, perspectives.Overview);

        expect(errors).toEqual([]);
        expect(document).toEqual(SHIPPED);
        expect(WorkspaceDocument.validate(document)).toEqual([])
    });

    test('the live cockpit\'s document is the shipped document', () => {
        expect(cockpit.dockModel).toEqual(SHIPPED)
    });

    test('every declared pane carries the record\'s own reference and the keeper-view module it renders', () => {
        const {panes} = cockpit;

        Object.entries(SHIPPED.items).forEach(([itemId, record]) => {
            const pane = panes[itemId];

            expect(pane, `panes.${itemId}`).toBeTruthy();
            expect(pane.reference, `panes.${itemId}.reference`).toBe(record.reference);
            expect(pane.header?.text, `panes.${itemId}.header.text`).toBe(record.title);
            expect(typeof pane.module === 'function' || typeof pane.ntype === 'string', `panes.${itemId} names its view`).toBe(true)
        })
    });

    test('a declared rail pane is parked across a perspective switch and returns as the SAME instance — never re-created', async () => {
        const reveal = async () => {
            cockpit.onDockZoneDocumentChange(cockpit.applyDockZoneOperation({operation: 'setItemAutoHidden', itemId: 'detail', autoHidden: false}).document);
            await cockpit.refreshPromise
        };

        await reveal();

        const pane = cockpit.getReference('agent-detail');

        expect(pane, 'the revealed inspector is projected').toBeTruthy();

        // Review docks the inspector as a column: the switch re-trees the same instance
        expect((await cockpit.activatePerspective('Review')).errors).toEqual([]);
        await cockpit.refreshPromise;
        expect(cockpit.getReference('agent-detail')).toBe(pane);

        // Overview auto-hides it again: parked — alive and registered, not projected
        expect((await cockpit.activatePerspective('Overview')).errors).toEqual([]);
        await cockpit.refreshPromise;
        expect(pane.isDestroyed, 'parked, not retired').toBeFalsy();
        expect(Neo.get(pane.id)).toBe(pane);

        // revealed once more: the same instance, never a successor
        await reveal();
        expect(cockpit.getReference('agent-detail')).toBe(pane)
    })
});

/**
 * The duties are DECLARED perspectives the engine captures at construction, never the active
 * document: the engine lets a supplied `dockModel` (a restored perspective, a vessel host) win over
 * the declaration and keeps it active — Overview / Focus / Review stay lowered from `panes` + their
 * zones regardless, so a supplied document with a pane closed still boots, and a supplied resize
 * never becomes the seed. Selection is the engine's `activePerspective` write, and the bar and the
 * drawer follow its published `dock.perspective.active`.
 */
test.describe('AgentOS.view.fleet.cockpit.Container — the duties are declared perspectives; a supplied document stays active', () => {
    const
        create         = config => Neo.create(FleetCockpit, {
            stateProvider: {
                module: CockpitStateProvider,
                stores: {
                    fleetActivityEvents: {module: FleetActivityEvents},
                    fleetRoster        : {module: FleetRoster, autoLoad: false},
                    viewerWakeFeed     : {module: ViewerWakeFeed}
                }
            },
            ...config
        }),
        presetDocument = (cockpit, name) => cockpit.perspectiveSelection.document(name),
        pressed        = cockpit => ['overview', 'focus', 'review'].map(id => cockpit.getReference(`fleet-preset-${id}`).pressed);

    let cockpit;

    test.afterEach(() => {
        cockpit?.destroy();
        cockpit = null;
        Neo.apps = {}
    });

    test('default boot: the duties are the shipped variants of the declaration, Review a center column', () => {
        cockpit = create();

        expect(presetDocument(cockpit, 'Overview')).toEqual(SHIPPED);
        expect(presetDocument(cockpit, 'Focus').nodes['primary-split'].sizes).toEqual([0.85, 0.15]);

        const review = presetDocument(cockpit, 'Review');

        expect(review.nodes['primary-split'].sizes).toEqual([0.45, 0.55]);
        expect(WorkspaceDocument.findContainingTabsId(review, 'detail'), 'Review docks the inspector as a center column').toBe('detail-tabs');
        expect(review.nodes['review-split']).toMatchObject({type: 'split', orientation: 'horizontal', sizes: [0.75, 0.25], children: ['primary-split', 'detail-tabs']});
        expect(review.nodes['secondary-rail'].items, 'the band keeps the three tools').toEqual(['perspectives', 'defineAgent', 'wakeRoutes']);
        expect(WorkspaceDocument.validate(review)).toEqual([]);
        // the placement decides, not the shared autoHidden flag
        expect(cockpit.isInspectorRevealed(review), 'a center member reveals the inspector').toBe(true);
        expect(cockpit.isInspectorRevealed(presetDocument(cockpit, 'Overview')), 'a railed member does not').toBe(false)
    });

    test('the bar and the drawer follow the engine\'s published name: boot presses Overview, a settled switch presses Focus, the library never enters it', async () => {
        cockpit = create();

        const provider = cockpit.getStateProvider();

        expect(provider.getData('dock.perspective.active')).toBe('Overview');
        expect(pressed(cockpit)).toEqual([true, false, false]);
        expect(provider.data.perspectives.items.map(item => item.layoutId), 'the duties lead the projected list').toEqual(['Overview', 'Focus', 'Review']);

        expect(await cockpit.activatePerspective('Focus')).toEqual({errors: [], switched: true});

        expect(provider.getData('dock.perspective.active')).toBe('Focus');
        expect(provider.getData('dock.perspective.pending')).toBeNull();
        expect(cockpit.dockModel.nodes['primary-split'].sizes).toEqual([0.85, 0.15]);
        expect(pressed(cockpit)).toEqual([false, true, false]);
        expect(cockpit.perspectiveStore.collection.activeLayoutId, 'the library is not the selection').toBeNull()
    });

    test('an unknown name is refused: the committed name, the document and the bar stay, the refusal renders', async () => {
        cockpit = create();

        const before  = JSON.stringify(cockpit.dockModel),
              verdict = await cockpit.activatePerspective('Ghost');

        expect(verdict.switched).toBe(false);
        expect(verdict.errors.join(' ')).toContain('Ghost');
        expect(cockpit.presetError).toContain('Ghost');
        expect(cockpit.activePerspective).toBe('Overview');
        expect(JSON.stringify(cockpit.dockModel)).toBe(before);
        expect(pressed(cockpit)).toEqual([true, false, false])
    });

    test('re-applying the active duty resets its arrangement: a resized split returns to the declaration and modified clears', async () => {
        cockpit = create();

        const provider = cockpit.getStateProvider();

        cockpit.onDockZoneDocumentChange(cockpit.applyDockZoneOperation({operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.2, 0.8]}).document);
        await cockpit.refreshPromise;

        expect(cockpit.dockModel.nodes['primary-split'].sizes).toEqual([0.2, 0.8]);
        expect(provider.getData('dock.perspective.modified')).toBe(true);
        expect(provider.getData('dock.perspective.active'), 'a resize keeps the committed name').toBe('Overview');

        expect(await cockpit.activatePerspective('Overview')).toEqual({errors: [], switched: true});

        expect(cockpit.dockModel.nodes['primary-split'].sizes).toEqual([0.6078, 0.3922]);
        expect(provider.getData('dock.perspective.modified')).toBe(false)
    });

    test('a supplied document with the inspector closed boots, stays active, and leaves the presets untouched', () => {
        const {document: supplied, errors} = Operations.applyOperation(shippedDockDocument(), {operation: 'closeItem', itemId: 'detail'});

        expect(errors).toEqual([]);
        expect(supplied.items.detail, 'the supplied document has no inspector record').toBeUndefined();

        cockpit = create({dockModel: supplied});

        expect(cockpit.dockModel.items.detail, 'the supplied document wins over zones and stays active').toBeUndefined();
        expect(presetDocument(cockpit, 'Overview'), 'Overview is the declaration, not the supplied state').toEqual(SHIPPED);
        expect(WorkspaceDocument.findContainingTabsId(presetDocument(cockpit, 'Review'), 'detail'), 'Review still docks the inspector').toBe('detail-tabs')
    });

    test('a supplied resize stays active and never rewrites Overview\'s seed', () => {
        const {document: supplied, errors} = Operations.applyOperation(shippedDockDocument(), {operation: 'resizeSplit', splitNodeId: 'primary-split', sizes: [0.2, 0.8]});

        expect(errors).toEqual([]);

        cockpit = create({dockModel: supplied});

        expect(cockpit.dockModel.nodes['primary-split'].sizes, 'the supplied sizes are the active ones').toEqual([0.2, 0.8]);
        expect(presetDocument(cockpit, 'Overview').nodes['primary-split'].sizes, 'the seed is the declaration\'s').toEqual([0.6078, 0.3922])
    })
});
