import {setup} from '../../../../setup.mjs';

const appName = 'AgentOSAvatarKeeperTest';

setup({
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import AgentCard      from '../../../../../../apps/agentos/view/fleet/roster/card/Container.mjs';

/**
 * The AgentCard's avatar keeper: the avatar slot holds either the face image or a family-inked
 * monogram, never a src-less `<img>`. The two halves flip in place on the live record — a face that
 * resolves after registration replaces the initials, a face that goes away brings them back — so the
 * pooled card instance never re-keys for a display-state change.
 *
 * The rendered geometry (one slot, sized alike at every width mode) is the synthesis witness's
 * business (`AgentCardSynthesisRenderNL`); this spec pins the keeper's state machine on the instance.
 */

const faceless = () => ({
    agentId    : 'faceless-1',
    displayName: 'Eulalia Fontaine-Marchbanks',
    engineTag  : 'kimi-k3',
    family     : 'kimi',
    laneLine   : 'defined through the S5 form',
    state      : 'idle',
    sources    : {}
});

const face = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';

test.describe('AgentCard avatar keeper — a faceless record shows a monogram, a face replaces it in place', () => {
    let card;

    test.afterEach(() => {
        card?.destroy();
        card = null
    });

    test('without a face: the image is withheld from the DOM, the monogram takes the slot on the family ink', () => {
        card = Neo.create(AgentCard, {appName, record: faceless()});

        const
            avatar   = card.getReference('card-avatar'),
            monogram = card.getReference('card-monogram');

        expect(avatar.hidden, 'the image is hidden').toBe(true);
        expect(avatar.vdom.removeDom, 'and withheld from the DOM — no src-less <img> ever mounts').toBe(true);
        expect(avatar.src, 'no src is written').toBeNull();

        expect(monogram.hidden, 'the monogram shows').toBe(false);
        expect(monogram.text, 'two initials, upper-cased').toBe('EF');
        expect(monogram.cls, 'on the family ink').toContain('fm-family-kimi');
        expect(monogram.vdom['aria-label'], 'named for assistive tech').toBe('Eulalia Fontaine-Marchbanks');
        expect(monogram.vdom.role, 'as an image').toBe('img')
    });

    test('a face that resolves later flips to the image; losing it flips back — the same instance', () => {
        card = Neo.create(AgentCard, {appName, record: faceless()});

        const
            avatar   = card.getReference('card-avatar'),
            monogram = card.getReference('card-monogram');

        card.record = {...faceless(), avatarUrl: face};

        expect(avatar.hidden, 'the image shows once the face exists').toBe(false);
        expect(avatar.src).toBe(face);
        expect(avatar.alt, 'the face keeps the name as its alt').toBe('Eulalia Fontaine-Marchbanks');
        expect(monogram.hidden, 'and the monogram steps back').toBe(true);

        card.record = faceless();

        expect(avatar.hidden, 'a face that goes away withholds the image again').toBe(true);
        expect(monogram.hidden).toBe(false);
        expect(monogram.text).toBe('EF')
    });

    test('an unknown family renders the monogram on the neutral marker, never a guessed family', () => {
        card = Neo.create(AgentCard, {appName, record: {...faceless(), family: 'ufo'}});

        const monogram = card.getReference('card-monogram');

        expect(monogram.cls).toContain('fm-family-unclassified');
        expect(monogram.cls.some(cls => /^fm-family-(claude|gpt|gemini|human|kimi)$/.test(cls)), 'no real family class').toBe(false)
    });

    test('the monogram reads two initials, a lone word\'s first two letters, or nothing', () => {
        expect(AgentCard.monogramFor('Alexander Constantine Maximilianus')).toBe('AC');
        expect(AgentCard.monogramFor('Eulalia Fontaine-Marchbanks')).toBe('EF');
        expect(AgentCard.monogramFor('neo-opus-ada'), 'a slug reads across its hyphens').toBe('NO');
        expect(AgentCard.monogramFor('Clio'), 'a single word gives its first two letters').toBe('CL');
        expect(AgentCard.monogramFor('  ')).toBe('');
        expect(AgentCard.monogramFor(null)).toBe('')
    });
});
