import {test, expect}              from '@playwright/test';
import {GOLD, PEER_HUES, peerHues} from '../../../../../../apps/agentos/canvas/fmPalette.mjs';

/**
 * @summary The peers' palette: a few hues evenly apart outside the route's gold, and each identity's own place
 * in it, probed free among the peers shown together.
 */
test.describe('AgentOS.canvas.fmPalette — the peers\' hues', () => {
    test('the palette keeps out of the route\'s gold and spreads its hues evenly around the rest of the wheel', () => {
        const
            sorted = [...PEER_HUES].sort((a, b) => a - b),
            gaps   = sorted.map((hue, at) => (sorted[(at + 1) % sorted.length] - hue + 360) % 360).sort((a, b) => a - b);

        expect(PEER_HUES.every(hue => hue < GOLD.from || hue >= GOLD.from + GOLD.span)).toBe(true);
        expect(gaps).toEqual([37.5, 37.5, 37.5, 37.5, 37.5, 37.5, 37.5, 37.5 + GOLD.span])
    });

    test('an identity takes its own place whoever else is shown, unless a peer before it holds that place', () => {
        const [preview] = peerHues(['@neo-preview']), next = PEER_HUES[(PEER_HUES.indexOf(preview) + 1) % PEER_HUES.length];

        expect(peerHues(['@tobiu']), 'two identities whose own places coincide').toEqual([preview]);
        expect(peerHues(['@neo-opus-vega', '@neo-preview'])[1], 'shown with a peer elsewhere, it keeps its own').toBe(preview);
        expect(peerHues(['@neo-preview', '@tobiu']), 'the later one takes the next free place').toEqual([preview, next]);
        expect(peerHues(['@tobiu', '@neo-preview']), 'whoever comes first keeps it').toEqual([preview, next])
    });

    test('peers shown together share a hue only once the palette has run out: nine of the roster, three pairs of them on one own place', () => {
        const
            roster = ['@tobiu', '@neo-opus-ada', '@neo-opus-grace', '@neo-opus-vega', '@neo-gemini-pro', '@neo-gpt', '@neo-fable', '@neo-fable-clio', '@neo-preview'],
            own    = roster.map(identity => peerHues([identity])[0]),
            hues   = peerHues(roster);

        expect(new Set(own).size, 'Grace and Fable, Ada and Clio, the operator and Eos').toBe(6);
        expect(new Set(hues.slice(0, PEER_HUES.length)).size).toBe(PEER_HUES.length);
        expect(hues[8], 'the ninth, past a full palette, repeats its own').toBe(own[8])
    });
});
