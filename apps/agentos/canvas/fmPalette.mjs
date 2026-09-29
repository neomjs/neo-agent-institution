/**
 * @module apps/agentos/canvas/fmPalette
 * @summary The FM ink tiers a canvas-worker renderer draws in, per theme — the values of the `--fm-*`
 * tokens the cockpit's stylesheets bind (the dark and light `apps/agentos/Viewport.scss` theme files).
 * A canvas worker has no stylesheet to read, so the mirror lives here, once, and is named as one: a
 * token value changes in the SCSS and here, together.
 */

/**
 * The ink tiers per theme, as the stylesheets bind them.
 * @type {Object}
 */
export const PALETTES = {
    dark : {ink: '#d6dce6', inkDim: '#8b97a8', signal: '#5eead4', route: '#f5c451', line: '#262f3d', lineSoft: '#1c242f', panel: '#141a23', panel2: '#1a212c'},
    light: {ink: '#1f2733', inkDim: '#5a6b80', signal: '#0f766e', route: '#a16207', line: '#d3dae4', lineSoft: '#e4e9f0', panel: '#ffffff', panel2: '#f7f9fc'}
};

/**
 * The band of hues the route owns alone: no community and no peer takes a hue inside it.
 * @type {Object}
 */
export const GOLD = {from: 25, span: 60};

/**
 * The peers' palette: eight hues spread evenly over the wheel outside the gold band, far enough apart to tell
 * apart at the peer lightness of either skin, which hues hashed from the whole wheel are not.
 * @type {Number[]}
 */
export const PEER_HUES = Array.from({length: 8}, (_, place) => (GOLD.from + GOLD.span + (place + .5) * (360 - GOLD.span) / 8) % 360);

/**
 * @summary The hues of peers shown together, in the order they were checked. Each takes its identity's place in
 * {@link PEER_HUES}, drawn from the identity alone by an FNV-1a hash so a peer keeps it on every read, every
 * machine and both skins, unless a peer before it holds that place; then it takes the next free one. Two peers
 * shown together share a hue only once the palette has run out.
 * @param {String[]} identities
 * @returns {Number[]} Degrees, one per identity
 */
export function peerHues(identities) {
    const taken = new Set();

    return identities.map(identity => {
        let hash = 2166136261, place;

        for (let i = 0; i < identity.length; i++) {
            hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619)
        }

        place = (hash >>> 0) % PEER_HUES.length;

        for (let step = 0; step < PEER_HUES.length && taken.has(place); step++) {
            place = (place + 1) % PEER_HUES.length
        }

        taken.add(place);

        return PEER_HUES[place]
    })
}

/**
 * @summary A hex colour as the three unit floats a WebGL attribute takes.
 * @param {String} hex `#rrggbb`
 * @returns {Number[]} `[r, g, b]`, each 0…1
 */
export function rgb(hex) {
    const value = parseInt(hex.slice(1), 16);

    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255]
}
