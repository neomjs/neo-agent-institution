import {setup} from '../../../../../../setup.mjs';

const appName = 'AgentOSPerspectivesPaneTest';

setup({
    appConfig: {
        name: appName
    }
});

import {test, expect}      from '@playwright/test';
import Neo                 from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core           from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance            from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import {resolveCallback}   from '../../../../../../../../node_modules/neo.mjs/src/util/Function.mjs';
import CockpitPerspectives from '../../../../../../../../apps/agentos/util/CockpitPerspectives.mjs';
import {shippedDockDocument} from '../cockpit/shippedDockDocument.mjs';
import PerspectivesPane    from '../../../../../../../../apps/agentos/view/fleet/perspectives/Container.mjs';

/**
 * The saved-layouts pane renders the cockpit's PROJECTED perspective list and fires intent; it
 * never touches the library. These arms pin the pane's honest states and its two verbs on the
 * instance, and the capture wrapper the cockpit uses to turn the live dock document into a saved
 * layout. The rendered drawer (rail reveal, both themes) is read by eye on the running cockpit.
 */

// the list the cockpit publishes: the declared duties as rows (`captureScope` null); which one is
// live is the engine's own leaf, bound into the pane as `activePerspective`
const projected = (captureNote = null) => ({
    captureNote,
    items: CockpitPerspectives.rows()
});

const cardsOf = pane => pane.getReference('perspectives-rows').items;

test.describe('AgentOS.view.fleet.perspectives.Container — the saved-layouts drawer', () => {
    let pane;

    test.afterEach(() => {
        pane?.destroy();
        pane = null
    });

    test('nothing projected renders as unobserved: the meta names it and no card poses as a layout', () => {
        pane = Neo.create(PerspectivesPane, {appName});

        expect(pane.getReference('perspectives-meta').text).toContain('No layouts projected yet');
        expect(cardsOf(pane)).toHaveLength(1);
        expect(cardsOf(pane)[0].cls).toContain('fm-perspectives-empty');
        expect(pane.getReference('perspectives-capture').disabled, 'capture rests without a name').toBe(true)
    });

    test('a projected list renders one card per perspective, marks the live one and names it in the meta', () => {
        pane = Neo.create(PerspectivesPane, {appName, activePerspective: 'Focus', perspectives: projected()});

        const cards = cardsOf(pane);

        expect(cards).toHaveLength(3);
        expect(pane.getReference('perspectives-meta').text).toBe('3 layouts · Focus active');

        const
            titles  = cards.map(card => card.items[0].items[0].text),
            verbs   = cards.map(card => card.items[1]),
            focus   = cards[1];

        expect(titles).toEqual(['Overview', 'Focus', 'Review']);
        expect(focus.cls, 'the live layout carries the active marker').toContain('is-active');
        expect(verbs[1].text).toBe('Active');
        expect(verbs[1].disabled, 'the live layout cannot be applied again').toBe(true);
        expect(verbs[0].text).toBe('Apply');
        expect(verbs[0].disabled).toBe(false);
        expect(cards[0].items[0].items[1].text, 'the title line says more than the name').toBe('Overview — mission control')
    });

    test('a re-projection moves the cards in place — object permanence: the instances survive, the marker and the verbs move, a new perspective inserts, a departed one removes', () => {
        pane = Neo.create(PerspectivesPane, {appName, activePerspective: 'Overview', perspectives: projected()});

        const before = cardsOf(pane).slice();

        // the engine committed another duty: the marker moves on the bound leaf alone
        pane.activePerspective = 'Review';
        pane.perspectives      = projected('captured "triage" — apply it from its card');

        const cards = cardsOf(pane);

        expect(cards.every((card, index) => card === before[index]), 'the three card instances are the same objects').toBe(true);
        expect(cards[2].cls).toContain('is-active');
        expect(cards[0].cls).not.toContain('is-active');
        expect(cards[2].items[1].text).toBe('Active');
        expect(cards[2].items[1].disabled).toBe(true);
        expect(cards[0].items[1].text).toBe('Apply');
        expect(cards[0].items[1].disabled).toBe(false);
        expect(pane.getReference('perspectives-meta').text).toBe('3 layouts · Review active · captured "triage" — apply it from its card');

        // a capture joins as a FOURTH card; the three keep their instances
        const grown = projected();

        grown.items.push({layoutId: 'capture-triage', perspectiveName: 'Triage', title: 'Triage', captureScope: 'window'});
        pane.perspectives = grown;

        expect(cardsOf(pane)).toHaveLength(4);
        expect(cardsOf(pane).slice(0, 3).every((card, index) => card === before[index])).toBe(true);
        expect(cardsOf(pane)[3].items[0].items[0].text).toBe('Triage');
        expect(cardsOf(pane)[3].items[0].items[1].text, 'a capture titled by its name shows its scope').toBe('window scope');
        expect(cardsOf(pane)[3].items[1].presetName).toBe('Triage');

        // a departed perspective removes its card; the rest keep their instances
        pane.perspectives = projected();

        expect(cardsOf(pane)).toHaveLength(3);
        expect(cardsOf(pane).every((card, index) => card === before[index])).toBe(true);

        // the same content under a new reference is a no-op — the drawer renders on identity, so a
        // provider that re-hands the list on every leaf touch can never re-enter the projection
        const rowsBefore = cardsOf(pane);

        pane.perspectives = projected('captured "triage" — apply it from its card');

        expect(cardsOf(pane)[0], 'a reference-only change re-renders nothing').toBe(rowsBefore[0]);

        pane.perspectives = projected('capture refused: "Overview" is a declared perspective — a capture needs its own name');

        expect(pane.getReference('perspectives-meta').text).toContain('capture refused: "Overview" is a declared perspective — a capture needs its own name')
    });

    test('a refused switch is named on the meta line, ahead of a capture verdict, until the projection clears it', () => {
        pane = Neo.create(PerspectivesPane, {appName, activePerspective: 'Focus', perspectives: {
            ...projected('captured "triage" — apply it from its card'),
            applyNote: 'switch refused: Ghost: no perspective named "Ghost"'
        }});

        expect(pane.getReference('perspectives-meta').text)
            .toBe('3 layouts · Focus active · switch refused: Ghost: no perspective named "Ghost" · captured "triage" — apply it from its card');

        pane.perspectives = projected();

        expect(pane.getReference('perspectives-meta').text).toBe('3 layouts · Focus active')
    });

    test('the verbs fire intent only: apply names the card, capture names the typed layout and arms with it', () => {
        pane = Neo.create(PerspectivesPane, {appName, activePerspective: 'Overview', perspectives: projected()});

        const fired = [];

        pane.on('perspectiveRequest', data => fired.push(data));

        const applyFocus = cardsOf(pane)[1].items[1];

        // the verb sits two containers below the pane: its `up.` handler must resolve through the
        // card nesting to the pane — asserted on the engine's own resolver, which is what a click
        // runs (the DOM click itself is the running cockpit's business)
        const resolved = resolveCallback(applyFocus.handler, applyFocus);

        expect(resolved.scope, 'the up. walk lands on the pane').toBe(pane);
        expect(resolved.fn).toBe(pane.onApplyClick);

        // the capture verb sits in the static capture rail (container → row → button): same walk
        const captureBtn = pane.getReference('perspectives-capture'),
              captureRes = resolveCallback(captureBtn.handler, captureBtn);

        expect(captureRes.scope, 'the capture verb resolves to the pane too').toBe(pane);
        expect(captureRes.fn).toBe(pane.onCaptureClick);

        pane.onApplyClick({component: applyFocus});
        // `fire` stamps the emitting instance as `source`; the intent payload is the pair below
        expect(fired).toHaveLength(1);
        expect(fired[0]).toMatchObject({action: 'apply', name: 'Focus'});

        const capture = pane.getReference('perspectives-capture');

        expect(capture.disabled).toBe(true);

        pane.onNameChange({value: '   '});
        expect(pane.captureName, 'whitespace is not a name').toBeNull();
        expect(capture.disabled).toBe(true);

        // the field reports the keystroke value; the verb arms on the trimmed name and uses THAT —
        // never a late read of the field's own value, which commits on blur and races the click
        pane.onNameChange({value: ' Triage '});
        expect(pane.captureName).toBe('Triage');
        expect(capture.disabled).toBe(false);

        pane.onCaptureClick();
        expect(fired).toHaveLength(2);
        expect(fired[1]).toMatchObject({action: 'capture', name: 'Triage'})
    });
});

test.describe('AgentOS.util.CockpitPerspectives.captureSavedLayout — the live document as a named saved layout', () => {
    test('a named capture wraps the document under the folded name, titled by the name, stamped as a capture', () => {
        const {layout, errors} = CockpitPerspectives.captureSavedLayout(shippedDockDocument(),'  Triage view ');

        expect(errors).toEqual([]);
        expect(layout.layoutId, 'the capture prefix keeps the id off the shipped presets').toBe('capture-triage-view');
        expect(layout.perspectiveName).toBe('Triage view');
        expect(layout.title).toBe('Triage view');
        expect(layout.metadata).toEqual({source: 'fm-cockpit-capture'});
        expect(layout.captureScope).toBe('window')
    });

    test('an empty name is refused before the wrapper sees the document', () => {
        for (const name of ['', '   ', null, undefined]) {
            const {layout, errors} = CockpitPerspectives.captureSavedLayout(shippedDockDocument(),name);

            expect(layout).toBeNull();
            expect(errors).toEqual(['a perspective needs a name'])
        }
    });

    test('a name of nothing but punctuation still gets an addressable id', () => {
        const {layout, errors} = CockpitPerspectives.captureSavedLayout(shippedDockDocument(),'***');

        expect(errors).toEqual([]);
        expect(layout.layoutId).toBe('capture-layout');
        expect(layout.perspectiveName).toBe('***')
    });

    test('a reserved name — a declared duty — is refused before the document is read', () => {
        const {layout, errors} = CockpitPerspectives.captureSavedLayout(null, ' Overview ', Object.keys(CockpitPerspectives.declare()));

        expect(layout).toBeNull();
        expect(errors).toEqual(['"Overview" is a declared perspective — a capture needs its own name'])
    });
});
