import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetSeatModelGroupTest';

setup({
    neoConfig: {
        unitTestMode: true
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * @summary Configuration's Seat group: each row says what is declared beside what the harness's config is set to,
 * and offers only what the harness names. The group changes nothing itself; it fires a catalog read or a declaration
 * and shows what its owner sets back.
 */
test.describe('AgentOS.view.fleet.detail.SeatModelContainer (#559)', () => {
    let SeatModelContainer;

    const
        codex   = {id: 'euclid', harnessType: 'codex-desktop', model: null, reasoningEffort: null},
        catalog = {state: 'complete', reason: null, models: [
            {id: 'gpt-6-luna', efforts: ['low', 'high']},
            {id: 'gpt-6-astra', hidden: true, efforts: ['low']},
            {id: 'gpt-6-sol', isDefault: true, efforts: ['low', 'max']}
        ]},
        line    = (group, field) => group.getReference(`${field}-line`).text,
        shown   = (group, field) => ['change', 'adopt'].filter(action => !group.getReference(`${field}-${action}`).hidden),
        offered = group => group.getReference('offer').items.map(chip => [chip.text, chip.cls.includes('is-selected'), chip.vdom['aria-pressed']]),
        status  = group => {
            const component = group.getReference('status-line');

            return [component.text, component.cls.find(cls => cls.startsWith('is-'))]
        },
        fired   = group => {
            const events = [];

            group.on({
                declareSeatModel: data => events.push(['declare', data.field, data.value]),
                readSeatCatalog : ()   => events.push(['read'])
            });

            return events
        };

    test.beforeAll(async () => {
        SeatModelContainer = (await import('../../../../../../../../apps/agentos/view/fleet/detail/SeatModelContainer.mjs')).default
    });

    test('AC-1: nothing declared reads as derived, with what the config is set to where it was read', () => {
        const group = Neo.create(SeatModelContainer, {appName, seat: codex});

        expect(line(group, 'model')).toBe('derived from the harness default');
        expect(shown(group, 'model')).toEqual(['change']);

        group.configured = {model: 'gpt-6-luna', reasoningEffort: 'high'};
        expect(line(group, 'model')).toBe('derived · reads gpt-6-luna (configured on disk)');
        expect(line(group, 'reasoningEffort')).toBe('derived · reads high (configured on disk)');
        // nothing to say: the status line holds its space hidden
        expect(status(group)).toEqual(['', 'is-idle']);

        group.destroy()
    });

    test('AC-1: Change asks for the catalog once, says so while it reads, then offers only what the harness lists', () => {
        const
            group  = Neo.create(SeatModelContainer, {appName, seat: codex}),
            events = fired(group);

        group.onActionClick({component: group.getReference('model-change')});
        expect(events).toEqual([['read']]);
        expect(group.getReference('model-change').text).toBe('Close');
        expect(status(group)).toEqual(['Reading what the harness offers…', 'is-pending']);

        // a hidden model is offered only when it is the declared one; nothing declared presses the harness default
        group.catalog = catalog;
        expect(offered(group)).toEqual([['gpt-6-luna', false, 'false'], ['gpt-6-sol', false, 'false'], ['Use the harness default', true, 'true']]);
        expect(status(group)).toEqual(['', 'is-idle']);

        group.getReference('offer').items[1].handler();
        expect(events.at(-1)).toEqual(['declare', 'model', 'gpt-6-sol']);

        // the effort offer belongs to the declared model, else the configured one, else the catalog's default
        group.onActionClick({component: group.getReference('model-change')});
        group.onActionClick({component: group.getReference('reasoningEffort-change')});
        expect(events.filter(([kind]) => kind === 'read'), 'the catalog is read once').toHaveLength(1);
        expect(offered(group).map(([text]) => text)).toEqual(['low', 'max', 'Use the harness default']);

        group.seat = {...codex, model: 'gpt-6-astra', reasoningEffort: 'low'};
        group.onActionClick({component: group.getReference('model-change')});
        expect(offered(group)).toEqual([['gpt-6-luna', false, 'false'], ['gpt-6-astra', true, 'true'], ['gpt-6-sol', false, 'false'], ['Use the harness default', false, 'false']]);

        group.getReference('offer').items[3].handler();
        expect(events.at(-1), 'the default hands the field back').toEqual(['declare', 'model', null]);

        group.destroy()
    });

    test('a declaration in flight keeps the chips it was clicked on, disabled, and its answer closes them', () => {
        const group = Neo.create(SeatModelContainer, {appName, seat: codex, catalog});

        group.onActionClick({component: group.getReference('model-change')});

        const chips = [...group.getReference('offer').items];

        // the owner's pending answer arrives while the clicked chip's handler may still be running
        group.status = {state: 'pending', reason: ''};
        expect(group.getReference('offer').items.every((chip, index) => chip === chips[index]), 'not rebuilt').toBe(true);
        expect(chips.every(chip => chip.disabled)).toBe(true);

        // the accepted readback re-seats the definition
        group.seat = {...codex, model: 'gpt-6-sol'};
        expect([group.editing, group.getReference('offer').hidden]).toEqual([null, true]);

        group.destroy()
    });

    test('a model declared by its slug offers that model\'s efforts and keeps it on offer though hidden', () => {
        const
            bySlug = {state: 'complete', reason: null, models: [
                {id: 'gpt-6-luna-2026-09', slug: 'gpt-6-luna', hidden: true, efforts: ['high']},
                {id: 'gpt-6-sol', isDefault: true, efforts: ['low']}
            ]},
            group  = Neo.create(SeatModelContainer, {appName, seat: {...codex, model: 'gpt-6-luna'}, catalog: bySlug});

        group.onActionClick({component: group.getReference('model-change')});
        expect(offered(group)).toEqual([['gpt-6-luna-2026-09', true, 'true'], ['gpt-6-sol', false, 'false'], ['Use the harness default', false, 'false']]);

        group.onActionClick({component: group.getReference('model-change')});
        group.onActionClick({component: group.getReference('reasoningEffort-change')});
        expect(offered(group).map(([text]) => text), 'never the default model\'s').toEqual(['high', 'Use the harness default']);

        group.destroy()
    });

    test('another harness on the same seat drops the catalog read for the last one', () => {
        const group = Neo.create(SeatModelContainer, {appName, seat: codex, catalog});

        group.seat = {...codex, model: 'gpt-6-sol'};
        expect(group.catalog, 'the same seat and harness keep it').toEqual(catalog);

        group.seat = {...codex, harnessType: 'claude-code'};
        expect(group.catalog).toBeNull();

        group.destroy()
    });

    test('a catalog the Fleet could not read says why where the values would be, never an empty offer posing as complete', () => {
        const group = Neo.create(SeatModelContainer, {appName, seat: codex});

        group.catalog = {state: 'unavailable', models: [], reason: 'this Fleet cannot list what the harness offers yet'};
        group.onActionClick({component: group.getReference('model-change')});

        expect(status(group)).toEqual(['this Fleet cannot list what the harness offers yet', 'is-unavailable']);
        expect(offered(group).map(([text]) => text)).toEqual(['Use the harness default']);

        group.destroy()
    });

    test('AC-5: a declaration that differs from the config shows both values and when it applies, running or not', () => {
        const
            group  = Neo.create(SeatModelContainer, {appName, seat: {...codex, reasoningEffort: 'max'}, configured: {model: null, reasoningEffort: 'ultra'}}),
            events = fired(group);

        expect(line(group, 'reasoningEffort')).toBe('declared max · reads ultra (configured on disk) · applies at next start');
        expect(shown(group, 'reasoningEffort')).toEqual(['change', 'adopt']);
        expect(group.getReference('reasoningEffort-adopt').text, 'named by the value it declares').toBe('Adopt ultra');

        // Adopt declares what the config is set to
        group.onActionClick({component: group.getReference('reasoningEffort-adopt')});
        expect(events).toEqual([['declare', 'reasoningEffort', 'ultra']]);

        // the same declaration read back from the config is one value
        group.configured = {model: null, reasoningEffort: 'max'};
        expect(line(group, 'reasoningEffort')).toBe('declared max');
        expect(shown(group, 'reasoningEffort')).toEqual(['change']);

        group.destroy()
    });

    test('the row the card sends the operator to says why the Fleet refused the start, once, on the declared model', () => {
        const group = Neo.create(SeatModelContainer, {appName, seat: {...codex, model: 'gpt-6-astra', reasoningEffort: 'low'}, configured: {model: 'gpt-6-luna', reasoningEffort: 'low'}});

        group.refusal = 'model gpt-6-astra is not available';
        expect([line(group, 'model'), line(group, 'reasoningEffort')]).toEqual(['declared gpt-6-astra · start refused: model gpt-6-astra is not available', 'declared low']);
        expect(shown(group, 'model')).toEqual(['change']);

        // an effort declared alone carries the refusal on its own row
        group.seat = {...codex, reasoningEffort: 'ultra'};
        group.refusal = 'reasoning effort ultra is not available';
        expect(line(group, 'reasoningEffort')).toBe('declared ultra · start refused: reasoning effort ultra is not available');

        group.destroy()
    });

    test('AC-1: a claude-desktop seat says its harness sets both per session, reads what it reported, and offers nothing', () => {
        const group = Neo.create(SeatModelContainer, {appName, seat: {id: 'ada', harnessType: 'claude-desktop', model: null, reasoningEffort: null}});

        expect([line(group, 'model'), line(group, 'reasoningEffort')]).toEqual(['set per session in the app · not read back yet', 'set per session in the app · not read back yet']);

        group.observed = {model: 'claude-opus-5-5', reasoningEffort: null};
        expect(line(group, 'model')).toBe('claude-opus-5-5 · set per session in the app');

        for (const field of ['model', 'reasoningEffort']) {
            expect(shown(group, field), field).toEqual([])
        }

        group.destroy()
    });

    test('claude-code takes any model id it accepts, typed, and its efforts from its own list', () => {
        const
            group  = Neo.create(SeatModelContainer, {appName, seat: {id: 'vega', harnessType: 'claude-code', model: null, reasoningEffort: null}}),
            events = fired(group);

        group.catalog = {state: 'complete', models: [], efforts: ['low', 'medium', 'high', 'max'], reason: null};

        group.onActionClick({component: group.getReference('model-change')});
        expect([group.getReference('free').hidden, group.getReference('offer').hidden]).toEqual([false, true]);

        group.getReference('free-model').value = '  ';
        group.onFreeSave();
        expect(events, 'a blank id declares nothing').toEqual([]);

        group.getReference('free-model').value = ' claude-opus-5-5 ';
        group.onFreeSave();
        expect(events).toEqual([['declare', 'model', 'claude-opus-5-5']]);

        group.onActionClick({component: group.getReference('reasoningEffort-change')});
        expect(group.getReference('free').hidden).toBe(true);
        expect(offered(group).map(([text]) => text)).toEqual(['low', 'medium', 'high', 'max', 'Use the harness default']);

        group.destroy()
    });

    test('the round-trip\'s answer shows on the status line, and another seat starts clean', () => {
        const group = Neo.create(SeatModelContainer, {appName, seat: codex, catalog});

        group.status = {state: 'pending', reason: ''};
        expect(status(group)).toEqual(['Saving…', 'is-pending']);
        expect(group.getReference('model-change').disabled).toBe(true);

        group.status = {state: 'rejected', reason: "model 'gpt-x' is not a model id"};
        expect(status(group)).toEqual(["model 'gpt-x' is not a model id", 'is-rejected']);

        group.onActionClick({component: group.getReference('model-change')});
        group.seat = {...codex, id: 'emmy'};

        expect([group.catalog, group.editing, group.status.state]).toEqual([null, null, 'idle']);
        expect(group.getReference('offer').hidden).toBe(true);

        group.destroy()
    });
});
