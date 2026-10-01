/**
 * @summary The per-pixel threshold every screenshot comparison here uses, declared once so the visual
 * and e2e configs cannot drift. Playwright's 0.2 default (a YIQ distance) reads a dark card on a dark
 * page as unchanged, so a geometry change on the cockpit's surfaces could pass its golden; 0.03 sees
 * it and still absorbs the anti-aliasing of the Darwin host the goldens are pinned to. Tone shifts
 * finer than this stay invisible: colour belongs to the static SCSS checks.
 * @type {Number}
 */
export const SCREENSHOT_THRESHOLD = 0.03;
