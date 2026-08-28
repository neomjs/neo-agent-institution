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
 * edges (no wrap, no column jump), degrading to the flat order at one column.
 *
 * The move must DELEGATE to the list's own `updateItemFocus` — the engine method owning the
 * complete Navigator envelope (top-level `windowId` remote routing for multi-window rosters,
 * enriched subscription data, headerless index translation, not-yet-mounted replay). A reviewer
 * falsifier proved a hand-rolled envelope with only a NESTED windowId routes a popped-out
 * roster's focus to the main window — so the witness here asserts the delegation target, and the
 * envelope's correctness rides the engine method it belongs to.
 */
test.describe('Fleet roster SelectionModel — the grid\'s vertical axis (±columns) delegated to updateItemFocus', () => {
    let RosterList, SelectionModel, calls;

    test.beforeAll(async () => {
        SelectionModel = (await import('../../../../../../../../apps/agentos/view/fleet/roster/SelectionModel.mjs')).default;
        RosterList     = (await import('../../../../../../../../apps/agentos/view/fleet/roster/List.mjs')).default
    });

    test.beforeEach(() => {
        calls = []
    });

    // a model over a stubbed view: plugin columns, store count, focus and the delegation sink are
    // the ONLY members navigateRow consumes — the base view_ config stores just the component ID
    // (beforeSetView) and re-resolves through the registry on read, so an instance-level getter
    // shadow hands the hooks their stub without registering a full component
    const makeModel = ({columns = 3, count = 9, focusIndex = null} = {}) => {
        const model = Neo.create(SelectionModel, {});

        Object.defineProperty(model, 'view', {
            get: () => ({
                focusIndex,
                id             : 'test-roster-list',
                windowId       : 1,
                getPlugin      : () => (columns === null ? null : {columns}),
                store          : {getCount: () => count},
                updateItemFocus: target => calls.push(target)
            })
        });

        return model
    };

    test('ArrowDown moves one visual row: +columns, delegated to the list\'s updateItemFocus', () => {
        makeModel({columns: 3, focusIndex: 1}).onKeyDownDown({});

        expect(calls).toEqual([4])
    });

    test('ArrowUp moves one visual row up: −columns', () => {
        makeModel({columns: 3, focusIndex: 7}).onKeyDownUp({});

        expect(calls).toEqual([4])
    });

    test('the top edge is a hard stop — no wrap, no column jump', () => {
        makeModel({columns: 3, focusIndex: 1}).onKeyDownUp({});

        expect(calls).toEqual([])
    });

    test('the bottom edge is a hard stop, including a ragged last row', () => {
        // 8 records in 3 columns: index 6 sits in the last (ragged) row — down must not wrap
        makeModel({columns: 3, count: 8, focusIndex: 6}).onKeyDownDown({});

        expect(calls).toEqual([])
    });

    test('no focused row yet: the first vertical key enters the grid at index 0', () => {
        makeModel({columns: 3, focusIndex: null}).onKeyDownDown({});

        expect(calls).toEqual([0])
    });

    test('one column (or no measured plugin truth) degrades to the flat order: ±1', () => {
        makeModel({columns: null, count: 9, focusIndex: 2}).onKeyDownDown({});

        expect(calls).toEqual([3])
    });

    test('an empty roster never navigates', () => {
        makeModel({count: 0, focusIndex: null}).onKeyDownDown({});

        expect(calls).toEqual([])
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
