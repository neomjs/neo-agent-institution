import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetRosterKeyNavTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        unitTestMode           : true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

/**
 * The roster's 2D keyboard grammar, pinned at the model layer: Left/Right belong to the list's
 * Navigator subscription (the row-major flat order — asserted here as the pinned key pair), and
 * Up/Down are THIS model's row hooks: ±columns from live plugin truth, hard stops at the vertical
 * edges (no wrap, no column jump), degrading to the flat order at one column. The move itself is
 * delegated to the Navigator addon — the one focus authority — captured here through the same
 * namespace-stub pattern the roster container spec uses for the Stylesheet addon.
 */
test.describe('Fleet roster SelectionModel — the grid\'s vertical axis (±columns) over the Navigator authority', () => {
    let RosterList, SelectionModel, priorNavigateTo, calls;

    test.beforeAll(async () => {
        SelectionModel = (await import('../../../../../../../../apps/agentos/view/fleet/roster/SelectionModel.mjs')).default;
        RosterList     = (await import('../../../../../../../../apps/agentos/view/fleet/roster/List.mjs')).default;

        Neo.ns('Neo.main.addon.Navigator', true);
        priorNavigateTo = Neo.main.addon.Navigator.navigateTo;
        Neo.main.addon.Navigator.navigateTo = config => calls.push(config)
    });

    test.afterAll(() => {
        Neo.main.addon.Navigator.navigateTo = priorNavigateTo
    });

    test.beforeEach(() => {
        calls = []
    });

    // a model over a stubbed view: plugin columns + store count + focus are the ONLY inputs
    // navigateRow consumes, so the stub pins the contract without a mounted grid's layout noise
    const makeModel = ({columns = 3, count = 9, focusIndex = null} = {}) => {
        const model = Neo.create(SelectionModel, {});

        // The base view_ config stores only the component ID (beforeSetView) and re-resolves the
        // instance through the registry on read — an instance-level getter shadow hands the hooks
        // their five-member stub (the ONLY inputs navigateRow consumes) without registering a
        // full component.
        Object.defineProperty(model, 'view', {
            get: () => ({
                focusIndex,
                id       : 'test-roster-list',
                windowId : 1,
                getPlugin: () => ({columns}),
                store    : {getCount: () => count}
            })
        });

        return model
    };

    test('ArrowDown moves one visual row: +columns through Navigator.navigateTo, same focus authority', () => {
        makeModel({columns: 3, focusIndex: 1}).onKeyDownDown({});

        expect(calls).toHaveLength(1);
        expect(calls[0].target).toBe(4);
        expect(calls[0].data).toEqual({id: 'test-roster-list', windowId: 1})
    });

    test('ArrowUp moves one visual row up: −columns', () => {
        makeModel({columns: 3, focusIndex: 7}).onKeyDownUp({});

        expect(calls).toHaveLength(1);
        expect(calls[0].target).toBe(4)
    });

    test('the top edge is a hard stop — no wrap, no column jump', () => {
        makeModel({columns: 3, focusIndex: 1}).onKeyDownUp({});

        expect(calls).toHaveLength(0)
    });

    test('the bottom edge is a hard stop, including a ragged last row', () => {
        // 8 records in 3 columns: index 6 sits in the last (ragged) row — down must not wrap
        makeModel({columns: 3, count: 8, focusIndex: 6}).onKeyDownDown({});

        expect(calls).toHaveLength(0)
    });

    test('no focused row yet: the first vertical key enters the grid at index 0', () => {
        makeModel({columns: 3, focusIndex: null}).onKeyDownDown({});

        expect(calls).toHaveLength(1);
        expect(calls[0].target).toBe(0)
    });

    test('one column (or no measured plugin truth) degrades to the flat order: ±1', () => {
        const model = Neo.create(SelectionModel, {});

        Object.defineProperty(model, 'view', {
            get: () => ({
                focusIndex: 2,
                id        : 'test-roster-list',
                windowId  : 1,
                getPlugin : () => null,
                store     : {getCount: () => 9}
            })
        });

        model.onKeyDownDown({});

        expect(calls).toHaveLength(1);
        expect(calls[0].target).toBe(3)
    });

    test('an empty roster never navigates', () => {
        makeModel({count: 0, focusIndex: null}).onKeyDownDown({});

        expect(calls).toHaveLength(0)
    });

    test('the horizontal axis is pinned to the Navigator subscription: Left/Right as the bound key pair', () => {
        // the class field rides into Navigator.subscribe via the afterSetMounted merge — pinning
        // it here means the addon's layout auto-detection (which would read the absolutely-
        // positioned grid as a vertical stack) can never claim Up/Down back. The animate plugin
        // writes CSS rules at construct, so the Stylesheet addon is stubbed for the instance's
        // lifetime (the roster container spec's own pattern).
        Neo.ns('Neo.main.addon.Stylesheet', true);

        const
            priorInsert = Neo.main.addon.Stylesheet.insertCssRules,
            priorDelete = Neo.main.addon.Stylesheet.deleteCssRules;

        Neo.main.addon.Stylesheet.insertCssRules = () => {};
        Neo.main.addon.Stylesheet.deleteCssRules = () => {};

        try {
            const list = Neo.create(RosterList, {appName});

            expect(list.navigator).toEqual({previousKey: 'ArrowLeft', nextKey: 'ArrowRight'});
            list.destroy()
        } finally {
            Neo.main.addon.Stylesheet.insertCssRules = priorInsert;
            Neo.main.addon.Stylesheet.deleteCssRules = priorDelete
        }
    });
});
