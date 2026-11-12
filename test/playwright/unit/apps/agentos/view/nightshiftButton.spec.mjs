import {setup} from '../../../../setup.mjs';

const appName = 'AgentOSNightshiftButtonTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * @summary The product bar's Nightshift toggle: the plane's record decides what it shows, unknown is
 * never present, a click while away switches it off, and a span turns it on with the `until` the plane
 * enforces.
 */
test.describe('NightshiftButton — the product bar\'s operator presence toggle', () => {
    let FleetAdmission, NIGHTSHIFT_SPANS, NightshiftButton, describeNightshift, nightshiftRefusal;

    const
        clock   = {locale: 'en-GB', timeZone: 'UTC', now: Date.parse('2026-11-12T09:00:00.000Z')},
        since   = '2026-11-12T06:02:00.000Z',
        until   = '2026-11-12T14:02:00.000Z',
        leaf    = record => FleetAdmission.operatorPresenceOf(record),
        present = () => leaf({mode: 'present', since: null, until: null, setBy: null}),
        away    = (extra = {}) => leaf({mode: 'away', since, until: null, setBy: 'AGENT:@tobiu', ...extra});

    test.beforeAll(async () => {
        const module = await import('../../../../../../apps/agentos/view/NightshiftButton.mjs');

        NightshiftButton   = module.default;
        NIGHTSHIFT_SPANS   = module.NIGHTSHIFT_SPANS;
        describeNightshift = module.describeNightshift;
        nightshiftRefusal  = module.nightshiftRefusal;
        FleetAdmission     = (await import('../../../../../../apps/agentos/util/FleetAdmission.mjs')).default
    });

    test('the record decides the words: away with and without an end, present, an expired away, unknown', () => {
        expect(describeNightshift(away({until}), clock)).toEqual({
            label: 'Nightshift on since 06:02, ends 14:02', pressed: true, state: 'away'
        });
        expect(describeNightshift(away(), clock).label).toBe('Nightshift on since 06:02, until you switch it off');
        expect(describeNightshift(present(), clock)).toEqual({label: 'Nightshift off', pressed: false, state: 'present'});

        // the plane reads an away whose end passed as present, `since` its end
        expect(describeNightshift(leaf({mode: 'present', since: until, until: null, expired: true}), clock).label)
            .toBe('Nightshift off, ended 14:02');

        // unknown is its own state, never present: no answer, an older Fleet, a mode the toggle does not know
        [null, leaf(null), leaf({mode: 'asleep'})].forEach(record => {
            expect(describeNightshift(record, clock)).toEqual({
                label: 'Nightshift unknown: the fleet has not reported it', pressed: false, state: 'unknown'
            })
        })
    });

    test('the roster record becomes a leaf-complete provider value, and only present or away is known', () => {
        expect(leaf({mode: 'away', since, until, setBy: 'AGENT:@tobiu', expired: false}))
            .toEqual({expired: false, mode: 'away', since, until});
        expect(leaf({mode: 'present', since: until, until: null, expired: true}))
            .toEqual({expired: true, mode: 'present', since: until, until: null});

        const blank = {expired: false, mode: null, since: null, until: null};

        expect(leaf(null)).toEqual(blank);
        expect(leaf({mode: 'asleep', since, until}), 'an unknown mode carries no times').toEqual(blank);
        expect(leaf({mode: 'away', since: 7, until: {}}), 'non-string times are dropped').toEqual({...blank, mode: 'away'})
    });

    test('a refusal is named by its validated class, never by the remote text', () => {
        const fail = (props, message = 'Authorization: Bearer secret-value') => Object.assign(new Error(message), props);

        expect(nightshiftRefusal(fail({fleetWireState: 'unsupported-method'}))).toBe('this Fleet does not offer it yet');
        expect(nightshiftRefusal(fail({fleetWireState: 'refused', fleetConnectionState: 'refused'}))).toBe('the Fleet refused it');
        expect(nightshiftRefusal(fail({fleetWireState: 'operation-failed'}))).toBe('the plane did not take it');
        expect(nightshiftRefusal(fail({fleetWireState: 'degraded'}))).toBe('the plane did not take it');
        expect(nightshiftRefusal(fail({fleetConnectionState: 'unreachable'}))).toBe('the Fleet is unreachable');
        expect(nightshiftRefusal(fail({}))).toBe('the request failed');
        expect(nightshiftRefusal(undefined)).toBe('the request failed')
    });

    test('the toggle renders the bound record: pressed while away, a menu only while it can turn on', async () => {
        const button = Neo.create(NightshiftButton, {appName, operatorPresence: leaf(null)});

        try {
            let root = button.getVdomRoot();

            expect(button.pressed).toBe(false);
            expect(button.cls).toContain('is-unknown');
            expect(root['aria-pressed']).toBe('false');
            expect(root['aria-haspopup']).toBe('menu');
            expect(root.title).toBe('Nightshift unknown: the fleet has not reported it');
            expect(button.text).toBe('Nightshift');
            expect(button.iconCls, 'the theme switch beside it owns the plain moon').toBe('fa-solid fa-cloud-moon');

            button.operatorPresence = away();
            root = button.getVdomRoot();

            expect(button.pressed).toBe(true);
            expect(button.cls).toContain('pressed');
            expect(button.cls).not.toContain('is-unknown');
            expect(root['aria-pressed']).toBe('true');
            expect(root['aria-haspopup'], 'a click while away switches it off, no menu').toBeNull();
            expect(root['aria-label']).toMatch(/^Nightshift on since .+, until you switch it off$/);

            button.operatorPresence = present();

            expect(button.pressed).toBe(false);
            expect(button.getVdomRoot()['aria-label']).toBe('Nightshift off')
        } finally {
            button.destroy()
        }
    });

    test('a refusal shows until the next record or the next click', async () => {
        const button = Neo.create(NightshiftButton, {appName, operatorPresence: present()});

        try {
            button.writeError = 'the Fleet refused it';

            expect(button.cls).toContain('is-refused');
            expect(button.getVdomRoot().title).toBe('Nightshift could not be set: the Fleet refused it');
            expect(button.pressed, 'the record is unchanged').toBe(false);

            button.operatorPresence = away();

            expect(button.writeError).toBeNull();
            expect(button.cls).not.toContain('is-refused');

            button.writeError = 'the Fleet is unreachable';
            await button.toggleMenu();

            expect(button.writeError, 'a click retires the last refusal').toBeNull()
        } finally {
            button.destroy()
        }
    });

    test('a click while away switches Nightshift off and opens nothing', async () => {
        const
            button  = Neo.create(NightshiftButton, {appName, operatorPresence: away()}),
            intents = [];

        try {
            button.on('nightshiftchange', ({mode, until}) => intents.push({mode, until}));
            await expect.poll(() => Boolean(button.menuList)).toBe(true);

            await button.toggleMenu();

            expect(intents).toEqual([{mode: 'present', until: undefined}]);
            expect(button.menuList.hidden, 'no span menu while away').toBe(true)
        } finally {
            button.destroy()
        }
    });

    test('the span menu turns Nightshift on: open-ended, or ending after its hours', async () => {
        const
            button  = Neo.create(NightshiftButton, {appName, operatorPresence: present()}),
            intents = [],
            now     = Date.parse('2026-11-12T05:00:00.000Z');

        try {
            button.on('nightshiftchange', ({mode, until}) => intents.push({mode, until}));
            await expect.poll(() => Boolean(button.menuList)).toBe(true);

            const {store} = button.menuList;

            expect(store.items.map(record => record.text)).toEqual(['Until I switch it off', 'For 8 hours', 'For 12 hours']);
            expect(button.menuList.cls).toContain('fm-nightshift-menu');

            // each row's handler is the span's own choice
            store.get('open').handler();
            NIGHTSHIFT_SPANS.filter(span => span.hours).forEach(span => button.onSpanSelect(span, now));

            expect(intents).toEqual([
                {mode: 'away', until: undefined},
                {mode: 'away', until: '2026-11-12T13:00:00.000Z'},
                {mode: 'away', until: '2026-11-12T17:00:00.000Z'}
            ])
        } finally {
            button.destroy()
        }
    })
});
