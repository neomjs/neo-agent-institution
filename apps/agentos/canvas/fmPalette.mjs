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
    dark : {ink: '#d6dce6', inkDim: '#8b97a8', signal: '#5eead4', line: '#262f3d', lineSoft: '#1c242f', panel: '#141a23', panel2: '#1a212c'},
    light: {ink: '#1f2733', inkDim: '#5a6b80', signal: '#0f766e', line: '#d3dae4', lineSoft: '#e4e9f0', panel: '#ffffff', panel2: '#f7f9fc'}
};

/**
 * @summary A hex colour as the three unit floats a WebGL attribute takes.
 * @param {String} hex `#rrggbb`
 * @returns {Number[]} `[r, g, b]`, each 0…1
 */
export function rgb(hex) {
    const value = parseInt(hex.slice(1), 16);

    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255]
}
