import {expect, landFleetRoster, test} from '../../fixtures.mjs';

/**
 * @summary The evolved-D/synthesis AgentCard rendered against a pathological fleet at the
 * card-width matrix — the mounted witness for the operator-selected composition, carrying the
 * falsifiers the retired design-evidence baseline established (the carry-forward where they earn permanence):
 *
 * - long display/engine names crowding the identity column;
 * - two lanes sharing their first seven characters + 2-digit overflow counts — the narrow falsifier:
 *   the head+tail middle elision must preserve each lane's DISTINGUISHING tail;
 * - wake/throttle telltales + a pending control + a retained reject reason;
 * - mixed session state (wedged/limited/idle/off) and the full source-health vocabulary
 *   (wired-observed / wired-inferred / missing / not-wired) — the summary strip must NAME the
 *   abnormal source (no 9px acronym wall) and can never contradict the facts;
 * - the operator avatar-keeper invariant: a visible avatar at every card width — a real image slot for
 *   the faced rows, and for the faceless row a family-inked monogram in the same slot (no src-less
 *   `<img>`, no browser broken-image glyph).
 *
 * Captured on the CARD's own width (294 / 319 / 320 / 328 / 360 / 720) in BOTH skins (neo-dark +
 * neo-light, driven through the real ViewportController#setTheme) — the same axis the selected
 * design renders against. The 319/320 pair is the box-model transition: container queries evaluate
 * the content box (outer − 28px padding − 2px border), so 319 outer = 289 content (last narrow:
 * engine hidden, 44px touch targets) and 320 outer = 290 content (first regular: engine shown,
 * 32px controls); 328 is the operator's exact realistic case. The animated List is pinned to one
 * card-width-plus-margins surface per width, so its own measured geometry seats a one-column item
 * and the card-owned `@container` modes engage; the contrast guard is a luminance delta, honest in
 * either skin.
 * Goldens are created/refreshed under the visual/e2e config only. Fidelity against the repaired mockup
 * head is Phoebe's narrow/mobile design-check seat.
 *
 * Run: NEO_E2E_PORT=8121 npx playwright test agentos/AgentCardSynthesisRenderNL -c test/playwright/playwright.config.e2e.mjs --workers=1 --update-snapshots
 *
 * @see apps/agentos/view/fleet/roster/card/Container.mjs (the composition under test)
 */

// a deterministic generic-profile avatar at the real slot size; distinct hue per card stands in for
// the production github face image (no flaky network fetch in the golden)
const avatar = hue => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">` +
    `<rect width="80" height="80" fill="${hue}"/>` +
    `<circle cx="40" cy="31" r="14" fill="#ffffff" opacity="0.92"/>` +
    `<path d="M16 72 a24 22 0 0 1 48 0 Z" fill="#ffffff" opacity="0.92"/>` +
    `</svg>`
);

// per-axis source-health facts honoring the closed contract (wired needs the producer literal +
// observed/inferred confidence, else it fails closed to not-wired)
const
    roster  = (state, confidence = 'none') => ({source: 'fleet:listAgents',    state, confidence}),
    repo    = (state, confidence = 'none') => ({source: 'fleet:fleetStatus',    state, confidence}),
    runtime = (state, confidence = 'none') => ({source: 'fleet:runtimeStatus',  state, confidence});

// two lanes sharing the first seven chars ("control") + 2-digit overflow — the tail-elision falsifier
const PATHOLOGICAL_ROSTER = [
    {
        // the faceless row: no avatarUrl at all — the S5 path before a GitHub face resolves. The
        // avatar keeper must hold the slot with the initials on the family ink instead of a src-less
        // <img>. It LEADS the rendered roster by construction (tier 0 via `ok`, a name that sorts
        // before "Alexander" — the store ranks tier, then folded name) so it sits inside the captured
        // box: the list element is shorter than the full column, and the goldens show its top.
        agentId: 'stress-faceless', githubUsername: '@stress-faceless', displayName: 'Abelard Fontaine-Marchbanks', engineTag: 'kimi-k3',
        family : 'kimi', state: 'ok', laneLine: 'defined through the S5 form — face not yet resolved', openLaneCount: 1,
        sources: {roster: roster('wired', 'observed'), repoStatus: repo('not-wired'), runtime: runtime('wired', 'inferred')}
    },
    {
        agentId      : 'stress-wedged', githubUsername: '@stress-wedged', displayName: 'Alexander Constantine Maximilianus',
        engineTag    : 'opus-4.8-experimental-preview-turbo', family: 'claude', state: 'wedged', avatarUrl: avatar('#7c5cbf'),
        laneLine     : 'control-plane restart actuator R3 seam reconciliation across the multi-window dock topology',
        openLaneCount: 23,
        wake         : {source: 'fleet:wake', state: 'suppressed', confidence: 'observed'},
        throttle     : {source: 'fleet:throttle', state: 'rate-limited', confidence: 'observed'},
        controlReason: {action: 'stop', kind: 'rejected', reason: 'fleet: stop rejected — resident holds an uncommitted transaction'},
        sources      : {roster: roster('wired', 'observed'), repoStatus: repo('not-wired'), runtime: runtime('wired', 'observed')}
    },
    {
        agentId      : 'stress-limited', githubUsername: '@stress-limited', displayName: 'Bartholomew Wolfgang Amadeus',
        engineTag    : 'gpt-5.6-sol-turbo-preview', family: 'gpt', state: 'limited', avatarUrl: avatar('#2f9e6b'),
        laneLine     : 'control-plane deployment-state bridge self-heal recent-event-limit tuning + overlay migration',
        openLaneCount: 17,
        pendingAction: 'start',
        throttle     : {source: 'fleet:throttle', state: 'overage', confidence: 'observed'},
        sources      : {roster: roster('wired', 'observed'), repoStatus: repo('wired', 'inferred'), runtime: runtime('missing')}
    },
    {
        agentId: 'stress-idle', githubUsername: '@stress-idle', displayName: 'Clementina', engineTag: 'fable-5',
        family : 'claude', state: 'idle', avatarUrl: avatar('#c0873a'), laneLine: 'awaiting review', openLaneCount: 3,
        wake   : {source: 'fleet:wake', state: 'unknown', confidence: 'unobserved'},
        sources: {roster: roster('not-wired'), repoStatus: repo('not-wired'), runtime: runtime('wired', 'observed')}
    },
    {
        agentId: 'stress-off', githubUsername: '@stress-off', displayName: 'Dionysius', engineTag: '3.1-pro',
        family : 'gemini', state: 'off', avatarUrl: avatar('#3f72c4'), laneLine: 'operator-benched', openLaneCount: null,
        sources: {roster: roster('wired', 'observed'), repoStatus: repo('missing'), runtime: runtime('not-wired')}
    }
];

// the card-OWN-width matrix (not viewport) — the axis the selected design renders against.
// The 319/320 pair is the box-model boundary: container queries evaluate the CONTENT box
// (outer − 28px padding − 2px border), so 319 outer = 289 content (last narrow) and
// 320 outer = 290 content (first regular). 328 is the operator's exact realistic case.
const CARD_WIDTHS = [
    {label: 'narrow-294'  , width: 294, narrow: true},
    {label: 'boundary-319', width: 319, narrow: true},
    {label: 'boundary-320', width: 320, narrow: false},
    {label: 'boundary-328', width: 328, narrow: false},
    {label: 'regular-360' , width: 360, narrow: false},
    {label: 'roomy-720'   , width: 720, narrow: false}   // the live-AC roomy width — the wide alignment mode at full breadth
];

test.describe('AgentOS fleet cockpit — AgentCard evolved-D synthesis render at pathological density (card-width matrix)', () => {
    test.setTimeout(150000);

    test('the selected composition under long names, tail-elided shared-prefix lanes, mixed source health, telltales, and the avatar keeper', async ({page, neuralLink}) => {
        await page.setViewportSize({width: 900, height: 1000});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const app      = await neuralLink.connectToApp('AgentOS'),
              [roster] = await app.findInstances({className: 'AgentOS.store.FleetRoster'}, ['id']),
              storeId  = (Array.isArray(roster) ? roster[0] : roster)?.id;

        expect(storeId, 'the provider-owned FleetRoster store must exist').toBeTruthy();

        // the pathological fleet lands as the fleet's answer
        await landFleetRoster(page, PATHOLOGICAL_ROSTER);

        // RENDERED cards, not instances: since the animated-list conversion the roster POOLS one
        // AgentCard instance per index (create on first use, re-seat via `record` on reuse — the
        // roster List's documented contract), so shrinking the store leaves surplus pooled
        // instances alive by design and an instance census would over-count forever. The rendered
        // surface is the contract under test; the store count is the engine-truth half.
        await expect.poll(async () => page.locator('.fm-agent-card').count(), {
            message: 'the grid renders one card per pathological resident', timeout: 15000, intervals: [250]
        }).toBe(PATHOLOGICAL_ROSTER.length);

        const storeCount = await app.callMethod(storeId, 'getCount');

        expect(storeCount, 'the store carries exactly the pathological fleet').toBe(PATHOLOGICAL_ROSTER.length);

        // the avatar keeper must be painted before capture (data-URI decode is async) — the four faced
        // rows through their images, the faceless row through its monogram in the same slot
        await expect.poll(async () => page.evaluate(() => {
            const imgs = [...document.querySelectorAll('img.fm-card-avatar')],
                  mono = [...document.querySelectorAll('.fm-card-monogram')];
            return imgs.length === 4 && imgs.every(el => el.complete && el.naturalWidth > 0) &&
                mono.length === 1 && mono[0].dataset.initials === 'AF' && mono[0].textContent === '';
        }), {message: 'every faced card avatar image is loaded and the faceless card shows its monogram', timeout: 15000, intervals: [250]}).toBe(true);

        await page.evaluate(() => document.fonts.ready);

        // resolve the viewport's theme controller — the both-theme gate renders the matrix in BOTH
        // skins, driven through the real ViewportController#setTheme (never a CSS-class poke)
        const [viewport]    = await app.queryComponent({className: 'AgentOS.view.Viewport'}, ['id']),
              viewportState = await app.getComponent(viewport.properties.id, ['controller']),
              controllerId  = viewportState.controller.id;

        // Capture one skin's card-width matrix by sizing the LIST's own rendered surface. Animate's
        // one-column formula reserves two 10px outer margins, so list width = requested card width + 20.
        // This is the production geometry path, not a retired CSS-grid track override.
        const captureWidthMatrix = async themeTag => {
            for (const {label, width, narrow} of CARD_WIDTHS) {
                const scope = `${themeTag} ${label}`;

                await page.evaluate(({count, width}) => {
                    const list = document.querySelector('.fm-fleet-cards');

                    list.style.width     = `${width + 20}px`;
                    list.style.minWidth  = `${width + 20}px`;
                    list.style.maxWidth  = `${width + 20}px`;
                    // Absolute plugin items do not establish flow height, and the row is measured: a
                    // generous column until the row has settled, sized to the rendered one below.
                    list.style.height    = `${10 + count * 400}px`;
                    list.style.maxHeight = 'none'
                }, {count: PATHOLOGICAL_ROSTER.length, width});

                // EXACT poll, no tolerance: one-column plugin math is deterministic (item = pinned
                // list width − 20px margins), and the matrix's neighbouring modes sit 1px apart —
                // any band wide enough to be useful contains the PREVIOUS mode's width, turning the
                // poll into a no-op that asserts before Animate re-derives (the 319/320 falsifier).
                await expect.poll(async () => page.evaluate(() => {
                    const card = document.querySelector('.fm-agent-card');
                    return card ? Math.round(card.getBoundingClientRect().width) : 0
                }), {
                    message  : `[${scope}] Animate re-seats the card at exactly ${width}px`,
                    timeout  : 15000,
                    intervals: [100, 250]
                }).toBe(width);

                const settledWidth = await page.evaluate(() => Math.round(document.querySelector('.fm-agent-card').getBoundingClientRect().width));

                expect(settledWidth, `[${scope}] the measured list renders the card at ~${width}px`).toBeLessThanOrEqual(width + 4);

                await page.evaluate(() => document.fonts.ready);

                // The row is measured after the width lands: wait until every card carries the one
                // row height, then size the capture to the rendered column so no card is scroll-clipped.
                await expect.poll(async () => page.evaluate(() => {
                    const heights = [...document.querySelectorAll('.fm-fleet-cards .neo-list-item')].map(item => item.style.visibility === 'hidden' ? '' : item.style.height);
                    return heights.length > 0 && heights.every(Boolean) ? new Set(heights).size : 0
                }), {
                    message  : `[${scope}] every card takes the one measured row height`,
                    timeout  : 15000,
                    intervals: [100, 250]
                }).toBe(1);

                await page.evaluate(() => {
                    const list   = document.querySelector('.fm-fleet-cards'),
                          top    = list.getBoundingClientRect().top - list.scrollTop,
                          bottom = Math.max(...[...list.querySelectorAll('.neo-list-item')].map(item => item.getBoundingClientRect().bottom));

                    list.style.height = `${Math.ceil(bottom - top) + 10}px`
                });

                // render-fit + contrast guards (repaired-semantics pins, not just snapshot-green): every card
                // must CONTAIN its full anatomy (no overflow clip), the source strip must sit inside the card
                // boundary, and the name must read against the panel. Contrast is a luminance delta between
                // the resolved name colour and the card background — so this guard holds in BOTH skins.
                const fit = await page.evaluate(() => [...document.querySelectorAll('.fm-agent-card')].map(card => {
                    const rect  = card.getBoundingClientRect(),
                          strip = card.querySelector('.fm-card-strip'),
                          name  = card.querySelector('.fm-card-name'),
                          sRect = strip?.getBoundingClientRect(),
                          lum   = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.299 * r + 0.587 * g + 0.114 * b };
                    return {
                        clipped   : card.scrollHeight - card.clientHeight,
                        stripBelow: sRect ? sRect.bottom - rect.bottom : -1,
                        contrast  : name ? Math.abs(lum(getComputedStyle(name).color) - lum(getComputedStyle(card).backgroundColor)) : 0
                    }
                }));
                fit.forEach((g, i) => {
                    expect(g.clipped, `[${scope}] card ${i} contains its full anatomy (no overflow clip)`).toBe(0);
                    expect(g.stripBelow, `[${scope}] card ${i} source strip sits inside the card boundary`).toBeLessThanOrEqual(0);
                    expect(g.contrast, `[${scope}] card ${i} name text reads against the panel (luminance delta)`).toBeGreaterThan(90)
                });

                // Lifecycle controls stay INLINE + visible at EVERY width (a semantic guard, not just
                // snapshot-green): the real Start/Stop toggle is always a visible glyph, and there is NO
                // overflow ⋯ menu hiding the action behind a generic affordance (operator UX direction).
                const controls = await page.evaluate(() => [...document.querySelectorAll('.fm-agent-card')].map(card => {
                    const shown = sel => { const el = card.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' };
                    return {
                        toggle : shown('.fm-card-action:not(.fm-card-action-restart)'),
                        hasMenu: !!card.querySelector('.fm-card-action-menu')
                    }
                }));
                controls.forEach((c, i) => {
                    expect(c.toggle, `[${scope}] card ${i}: the primary lifecycle toggle is inline + visible`).toBe(true);
                    expect(c.hasMenu, `[${scope}] card ${i}: no overflow ⋯ menu — controls are inline, not hidden`).toBe(false)
                });

                // Capacity classification guard (the regression witness for the content-box breakpoint):
                // the engine tag is hidden only where the head genuinely cannot hold it (narrow class),
                // and controls compact to 32px wherever capacity exists. The 319/320 pair pins the exact
                // transition — previously the 319px content-box error hid the engine at 328 outer while
                // inflating controls to 44px (94px = 31.5% of a 298px head), manufacturing the scarcity
                // the rule was meant to absorb.
                const capacity = await page.evaluate(() => [...document.querySelectorAll('.fm-agent-card')].map(card => {
                    const engine = card.querySelector('.fm-card-engine'),
                          action = card.querySelector('.fm-card-action');

                    return {
                        engineShown: !!engine && getComputedStyle(engine).display !== 'none',
                        actionSize : action ? Math.round(action.getBoundingClientRect().width) : null
                    }
                }));

                capacity.forEach((c, i) => {
                    expect(c.engineShown, `[${scope}] card ${i}: engine tag ${narrow ? 'hidden at genuine narrow' : 'shown — head has capacity'}`).toBe(!narrow);
                    expect(c.actionSize, `[${scope}] card ${i}: controls ${narrow ? '44px touch target at genuine narrow' : 'compact 32px where capacity exists'}`).toBe(narrow ? 44 : 32)
                });

                // The avatar keeper at every width: the faceless card mounts NO <img> and its monogram
                // fills the avatar slot at the mode's avatar size (40px regular, 32px narrow), so the
                // width modes size the two keeper halves alike.
                const keeper = await page.evaluate(() => {
                    const card = [...document.querySelectorAll('.fm-agent-card')].find(c => c.querySelector('.fm-card-monogram')),
                          mono = card?.querySelector('.fm-card-monogram');

                    return {
                        first: document.querySelector('.fm-agent-card') === card,
                        img  : !!card?.querySelector('img.fm-card-avatar'),
                        size : mono ? Math.round(mono.getBoundingClientRect().width) : null,
                        // the initials paint from the attribute; the card's text stays the name alone
                        text : mono ? (mono.textContent === '' ? mono.dataset.initials : `text-node:${mono.textContent}`) : null
                    }
                });

                expect(keeper.img,  `[${scope}] the faceless card mounts no <img>`).toBe(false);
                expect(keeper.text, `[${scope}] the monogram reads the initials`).toBe('AF');
                expect(keeper.first, `[${scope}] the faceless card leads the rendered roster (tier 0, folded name) — inside the captured box`).toBe(true);
                expect(keeper.size, `[${scope}] the monogram fills the avatar slot`).toBe(narrow ? 32 : 40);

                // The goldens are headless captures, and a headless run compares byte-exact (no ratio
                // option — the default per-pixel threshold only): a SAME-SIZE content change on these
                // dense cards — a chip fill, a telltale colour, a verb icon — fails there. A DIMENSION
                // change (the 2px trailing-edge change of 2026-09-01: 314×407 → 314×405) fails on size
                // mismatch on every path, before any ratio is computed. The battery's honest HEADED
                // run drifts from the captures by text antialiasing only (0.02 measured at 294px,
                // 2026-09-01), so it alone carries a 0.03 allowance — enough for antialiasing, and an
                // admission that a same-size change below it passes headed. The strict path is the
                // local headless run: no CI job executes a Neural Link witness.
                await expect(page.locator('.fm-fleet-cards')).toHaveScreenshot(
                    `agentcard-synthesis-${themeTag}-${label}.png`,
                    test.info().project.use.headless === false ? {maxDiffPixelRatio: 0.03} : {}
                )
            }
        };

        for (const theme of ['neo-theme-neo-dark', 'neo-theme-neo-light']) {
            await app.callMethod(controllerId, 'setTheme', [theme, false]);
            await expect.poll(async () => (await app.getComponent(viewport.properties.id, ['theme'])).theme, {
                message: `the viewport re-themes to ${theme}`, timeout: 15000, intervals: [250]
            }).toBe(theme);

            await captureWidthMatrix(theme.replace('neo-theme-neo-', ''))
        }

        // Motion contract: the ghost hover animates with the app's motion tokens, and the
        // reduced-motion contract is honored by construction — a reduced-motion user gets the instant state
        // (the wash is affordance feedback, not signal, so nothing informational is lost). A static golden
        // proves only the END state, so this is the deterministic motion witness: the animated background
        // wash is present in the transition set under no-preference and absent under reduce (robust to the
        // Button base's own outline-width transition).
        const actionTransitionProperty = () => page.evaluate(() =>
            getComputedStyle(document.querySelector('.fm-card-action')).transitionProperty);

        await page.emulateMedia({reducedMotion: 'no-preference'});
        expect(await actionTransitionProperty(), 'the ghost action animates its background wash under no-preference').toMatch(/background/);

        await page.emulateMedia({reducedMotion: 'reduce'});
        expect(await actionTransitionProperty(), 'reduced-motion users get the instant state — the wash is not animated').not.toMatch(/background/);

        await page.emulateMedia({reducedMotion: null})
    });

    test('the beacon facet across the card-width matrix: the band glyph carries it at every width, the words yield to the state line, and nothing overlaps or clips beyond the fresh control (#112)', async ({page}) => {
        // Each beacon row has a control sharing every other fact, so any geometry delta is the facet's
        // own. The widest pair carries the widest ordinary state line an active seat can render (the
        // longest state word, the longest active band, a two-digit badge): the words' threshold must
        // hold it whole. Geometry-asserted, no golden — the matrix goldens above keep the fresh case.
        const presenceOf    = (state, beacon) => ({source: 'fleet:presenceState', state, confidence: 'observed', lastSeenAt: '2026-09-04T22:00:00.000Z', beacon}),
              seat          = (id, displayName, extra) => ({
                  agentId : id, githubUsername: `@${id}`, displayName, engineTag: 'fable-5', family: 'claude',
                  laneLine: 'awaiting review', avatarUrl: avatar('#c0873a'),
                  sources : {roster: roster('wired', 'observed'), repoStatus: repo('not-wired'), runtime: runtime('wired', 'observed')},
                  ...extra
              }),
              BEACON_ROSTER = [
                  seat('beacon-control',        'Aa control',        {state: 'ok',      openLaneCount: 1,  presence: presenceOf('fresh',       'fresh')}),
                  seat('beacon-absent',         'Ab beacon absent',  {state: 'ok',      openLaneCount: 1,  presence: presenceOf('fresh',       'absent')}),
                  seat('beacon-stale',          'Ac beacon stale',   {state: 'ok',      openLaneCount: 1,  presence: presenceOf('recent',      'stale')}),
                  seat('beacon-widest-control', 'Ad widest control', {state: 'limited', openLaneCount: 23, presence: presenceOf('active-turn', 'fresh')}),
                  seat('beacon-widest-absent',  'Ae widest absent',  {state: 'limited', openLaneCount: 23, presence: presenceOf('active-turn', 'absent')})
              ],
              PAIRS         = [
                  ['Ab beacon absent', 'Aa control',        'absent', '◌'],
                  ['Ac beacon stale',  'Aa control',        'stale',  '◎'],
                  ['Ae widest absent', 'Ad widest control', 'absent', '◌']
              ],
              // the sub-narrow band, the vessel window, the first regular width, the roster's own
              // multi-column floor, the last width whose line is below the words' threshold, the first
              // at it, and the roomy AC width
              WIDTHS        = [240, 314, 320, 410, 498, 500, 720],
              WORDS_FROM    = 340;

        await page.setViewportSize({width: 900, height: 1000});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        await landFleetRoster(page, BEACON_ROSTER);

        await expect.poll(async () => page.locator('.fm-agent-card').count(), {
            message: 'the grid renders one card per beacon row', timeout: 15000, intervals: [250]
        }).toBe(BEACON_ROSTER.length);
        await page.evaluate(() => document.fonts.ready);

        for (const width of WIDTHS) {
            await page.evaluate(({count, width}) => {
                const list = document.querySelector('.fm-fleet-cards');

                list.style.width = list.style.minWidth = list.style.maxWidth = `${width + 20}px`;
                list.style.height    = `${10 + count * 136}px`;
                list.style.maxHeight = 'none'
            }, {count: BEACON_ROSTER.length, width});

            await expect.poll(async () => page.evaluate(() => Math.round(document.querySelector('.fm-agent-card').getBoundingClientRect().width)), {
                message: `[${width}] Animate re-seats the card at exactly ${width}px`, timeout: 15000, intervals: [100, 250]
            }).toBe(width);
            await page.evaluate(() => document.fonts.ready);

            const cards = await page.evaluate(() => {
                const rect    = el => el?.getBoundingClientRect(),
                      overlap = (a, b) => a && b
                          ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
                          : 0;

                return Object.fromEntries([...document.querySelectorAll('.fm-agent-card')].map(card => {
                    const q     = sel => card.querySelector(sel),
                          line  = q('.fm-card-state-line'),
                          band  = q('.fm-card-presence'),
                          words = q('.fm-card-beacon'),
                          shown = !!words && getComputedStyle(words).display !== 'none';

                    return [q('.fm-card-name').textContent, {
                        clip            : card.scrollHeight - card.clientHeight,
                        lineWidth       : Math.round(rect(line).width),
                        lineHeight      : Math.round(rect(line).height),
                        glyph           : band.textContent[0],
                        bandTitle       : band.getAttribute('title'),
                        bandAria        : band.getAttribute('aria-label'),
                        wordsShown      : shown,
                        wordsInLine     : shown ? rect(words).right <= rect(line).right + 0.5 : null,
                        wordsBeforeBadge: shown ? rect(words).right <= rect(q('.fm-card-lane-count')).left : null,
                        wordsUnderVerbs : shown ? overlap(rect(words), rect(q('.fm-card-control-verbs'))) : 0
                    }]
                }))
            });

            for (const [name, controlName, facet, glyph] of PAIRS) {
                const card    = cards[name],
                      control = cards[controlName],
                      scope   = `[${width}] ${name}`;

                expect(control.glyph, `[${width}] ${controlName}: the ring is filled`).toBe('◉');
                expect(control.wordsShown, `[${width}] ${controlName}: renders no words`).toBe(false);

                // the glyph, title and aria pair carry the facet at EVERY width
                expect(card.glyph, `${scope}: the band's glyph marks the ${facet} beacon`).toBe(glyph);
                expect(card.bandTitle, `${scope}: the band's title names the diagnostic`).toContain(facet === 'absent' ? 'no turn-presence beacon' : 'past its horizon');
                expect(card.bandAria, `${scope}: the band speaks the facet`).toContain(facet === 'absent' ? 'No turn-presence beacon' : 'beacon stale');

                // the words render exactly where the line holds the widest ordinary line plus them
                expect(card.wordsShown, `${scope}: the words ${card.lineWidth >= WORDS_FROM ? 'render on' : 'yield to'} a ${card.lineWidth}px line`).toBe(card.lineWidth >= WORDS_FROM);

                // where they render they sit inside the line, before the badge, never under the verbs
                if (card.wordsShown) {
                    expect(card.wordsInLine,      `${scope}: the words end inside the state line`).toBe(true);
                    expect(card.wordsBeforeBadge, `${scope}: the words sit before the right-pinned badge`).toBe(true);
                    expect(card.wordsUnderVerbs,  `${scope}: the words never run under the verbs`).toBe(0)
                }

                // no delta against the control: the same clip, the same line height
                expect(card.clip,       `${scope}: no clipping beyond its control`).toBe(control.clip);
                expect(card.lineHeight, `${scope}: the state line keeps its control's height — no row added`).toBe(control.lineHeight)
            }
        }
    });

    test('the state line\'s fit across the card-width matrix: one row, members leave whole from the end, nothing past the line or under the verbs, and the card\'s height never follows its resident\'s data', async ({page}) => {
        // The closed vocabularies' long rows beside the ordinary ones. Geometry-asserted, no golden.
        const presenceOf = (state, beacon = 'fresh') => ({source: 'fleet:presenceState', state, confidence: 'observed', lastSeenAt: '2026-09-04T22:00:00.000Z', beacon}),
              seat       = (id, displayName, extra) => ({
                  agentId : id, githubUsername: `@${id}`, displayName, engineTag: 'fable-5', family: 'claude',
                  laneLine: 'awaiting review', avatarUrl: avatar('#c0873a'),
                  sources : {roster: roster('wired', 'observed'), repoStatus: repo('not-wired'), runtime: runtime('wired', 'observed')},
                  ...extra
              }),
              bothAxes   = {
                  wake    : {source: 'fleet:wake', state: 'suppressed', confidence: 'observed'},
                  throttle: {source: 'fleet:throttle', state: 'rate-limited', confidence: 'observed'}
              },
              CONTROL    = seat('fit-control', 'Aa control', {state: 'ok', openLaneCount: 1, presence: presenceOf('fresh')}),
              FIT_ROSTER = [
                  CONTROL,
                  seat('fit-widest',   'Ab widest',   {state: 'limited', openLaneCount: 23, presence: presenceOf('active-turn')}),
                  seat('fit-dense',    'Ac dense',    {state: 'limited', openLaneCount: 23, presence: presenceOf('active-turn'), ...bothAxes}),
                  seat('fit-one-axis', 'Ad one axis', {state: 'ok',      openLaneCount: 3,  presence: presenceOf('fresh'),
                      throttle: {source: 'fleet:throttle', state: 'overage', confidence: 'observed'}}),
                  seat('fit-benched',  'Ae benched',  {state: 'off',     openLaneCount: 12, presence: presenceOf('neverConnected')}),
                  seat('fit-beacon',   'Af beacon',   {state: 'limited', openLaneCount: 23, presence: presenceOf('active-turn', 'absent'), ...bothAxes}),
                  seat('fit-bare',     'Ag bare',     {state: 'idle',    openLaneCount: null})
              ],
              // the vessel card, the sub-narrow band, both ends of the narrow band, the vessel window,
              // the first regular width, the roster's column floor, and the first widths whose line
              // holds the badge's noun (283) and the telltale's words (508)
              WIDTHS     = [191, 240, 271, 294, 314, 319, 320, 410, 443, 500, 668],
              ROW        = 16,
              NOUN_FROM  = 283,
              WORDS_FROM = 508,
              ORDER      = ['state', 'telltale', 'presence', 'beacon', 'lane-count'];

        await page.setViewportSize({width: 900, height: 1600});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const seatRoster = async rows => {
                  await landFleetRoster(page, rows);
                  await expect.poll(async () => page.locator('.fm-agent-card').count(), {
                      message: 'the grid renders one card per row', timeout: 15000, intervals: [250]
                  }).toBe(rows.length)
              },
              pinWidth   = async width => {
                  await page.evaluate(({width}) => {
                      const list = document.querySelector('.fm-fleet-cards');

                      list.style.width = list.style.minWidth = list.style.maxWidth = `${width + 20}px`;
                      list.style.height    = '1500px';
                      list.style.maxHeight = 'none'
                  }, {width});

                  await expect.poll(async () => page.evaluate(() => Math.round(document.querySelector('.fm-agent-card').getBoundingClientRect().width)), {
                      message: `[${width}] Animate re-seats the card at exactly ${width}px`, timeout: 15000, intervals: [100, 250]
                  }).toBe(width);
                  await page.evaluate(() => document.fonts.ready)
              },
              cardHeight = () => page.evaluate(() => Math.round(document.querySelector('.fm-agent-card').getBoundingClientRect().height));

        // the control alone gives each width its height: what a card measures when no resident is dense
        const controlHeights = {};

        await seatRoster([CONTROL]);

        for (const width of WIDTHS) {
            await pinWidth(width);
            controlHeights[width] = await cardHeight()
        }

        await seatRoster(FIT_ROSTER);

        for (const width of WIDTHS) {
            await pinWidth(width);

            // the measured row settles after the re-seat: every card takes one height
            await expect.poll(async () => page.evaluate(() => new Set([...document.querySelectorAll('.fm-agent-card')].map(card => Math.round(card.getBoundingClientRect().height))).size), {
                message: `[${width}] the cards settle on one height`, timeout: 15000, intervals: [100, 250]
            }).toBe(1);

            const cards = await page.evaluate(({ORDER, ROW}) => {
                const rect    = el => el.getBoundingClientRect(),
                      overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

                return Object.fromEntries([...document.querySelectorAll('.fm-agent-card')].map(card => {
                    const q     = sel => card.querySelector(sel),
                          line  = q('.fm-card-state-line'),
                          verbs = q('.fm-card-control-verbs'),
                          form  = el => el && {before: getComputedStyle(el, '::before').content, fontSize: getComputedStyle(el).fontSize};

                    return [q('.fm-card-name').textContent, {
                        badge     : form(q('.fm-card-lane-count')),
                        cardHeight: Math.round(rect(card).height),
                        lineHeight: Math.round(rect(line).height),
                        lineWidth : Math.round(rect(line).width),
                        telltale  : form(q('.fm-card-telltale')),
                        members   : ORDER.map(name => [name, q(`.fm-card-${name}`)])
                            .filter(([, el]) => el && getComputedStyle(el).display !== 'none')
                            .map(([name, el]) => {
                                const visible = rect(el).top - rect(line).top < ROW;

                                return {
                                    name,
                                    visible,
                                    pastLine  : visible ? Math.max(0, Math.round((rect(el).right - rect(line).right) * 10) / 10) : 0,
                                    underVerbs: visible ? overlap(rect(el), rect(verbs)) : 0
                                }
                            })
                    }]
                }))
            }, {ORDER, ROW});

            for (const [name, card] of Object.entries(cards)) {
                const scope   = `[${width}] ${name}`,
                      visible = card.members.map(member => member.visible);

                // one row, and the card's height is the control's: no resident's data reaches it
                expect(card.lineHeight, `${scope}: the state line is one row`).toBe(ROW);
                expect(card.cardHeight, `${scope}: the card keeps the control-only height`).toBe(controlHeights[width]);

                // the word is the 1.4.1 carrier: visible at every width
                expect(card.members[0], `${scope}: the state word is on the row`).toMatchObject({name: 'state', visible: true});

                // members leave from the END: past the first one that left, none is visible
                expect(visible.indexOf(false) === -1 || !visible.slice(visible.indexOf(false)).includes(true),
                    `${scope}: a member that left takes every later member with it (${JSON.stringify(card.members.map(m => `${m.name}:${m.visible}`))})`).toBe(true);

                for (const member of card.members) {
                    expect(member.pastLine,   `${scope}: ${member.name} ends inside the line`).toBeLessThanOrEqual(0.5);
                    expect(member.underVerbs, `${scope}: ${member.name} never runs under the verbs`).toBe(0)
                }

                // the forms follow the line's width: words and noun where the line holds them, the mark and the number below
                if (card.telltale) {
                    expect(card.telltale.fontSize, `${scope}: the telltale renders its ${card.lineWidth >= WORDS_FROM ? 'words' : 'mark'} on a ${card.lineWidth}px line`).toBe(card.lineWidth >= WORDS_FROM ? '10px' : '0px');
                    card.lineWidth < WORDS_FROM && expect(card.telltale.before, `${scope}: the mark names the axes`).toMatch(/^"(w|t|w·t)"$/)
                }

                if (card.badge) {
                    expect(card.badge.fontSize, `${scope}: the badge renders its ${card.lineWidth >= NOUN_FROM ? 'phrase' : 'number'} on a ${card.lineWidth}px line`).toBe(card.lineWidth >= NOUN_FROM ? '10px' : '0px');
                    card.lineWidth < NOUN_FROM && expect(card.badge.before, `${scope}: the number is the count`).toMatch(/^"\d+"$/)
                }
            }

            // the roster's column floor holds the widest active line whole, both telltale axes included
            width === 410 && expect(cards['Ac dense'].members.every(member => member.visible), '[410] the widest active line with both axes shows every member').toBe(true)
        }
    });

    test('the name line\'s fit across the card-width matrix: a long name ellipsizes inside its line, the chip and the engine tag are whole or absent, and the card\'s height never follows the name', async ({page}) => {
        const LONG        = 'Alexander Constantine Maximilianus',
              SHORT       = 'Ada',
              seat        = (id, displayName, engineTag) => ({
                  agentId : id, githubUsername: `@${id}`, displayName, engineTag, family: 'claude',
                  laneLine: 'awaiting review', avatarUrl: avatar('#c0873a'), state: 'ok', openLaneCount: 3,
                  sources : {roster: roster('wired', 'observed'), repoStatus: repo('not-wired'), runtime: runtime('wired', 'observed')}
              }),
              NAME_ROSTER = [
                  seat('name-long',  LONG,  'opus-4.8-experimental-preview-turbo'),
                  seat('name-short', SHORT, 'opus-5')
              ],
              // the vessel card, the narrow band, the operator's realistic case, the column floor, roomy
              WIDTHS      = [191, 294, 328, 410, 720];

        await page.setViewportSize({width: 900, height: 1200});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        await landFleetRoster(page, NAME_ROSTER);

        await expect.poll(async () => page.locator('.fm-agent-card').count(), {
            message: 'the grid renders one card per row', timeout: 15000, intervals: [250]
        }).toBe(NAME_ROSTER.length);
        await page.evaluate(() => document.fonts.ready);

        const lineHeights = new Set();

        for (const width of WIDTHS) {
            await page.evaluate(({width}) => {
                const list = document.querySelector('.fm-fleet-cards');

                list.style.width = list.style.minWidth = list.style.maxWidth = `${width + 20}px`;
                list.style.height    = '1000px';
                list.style.maxHeight = 'none'
            }, {width});

            await expect.poll(async () => page.evaluate(() => Math.round(document.querySelector('.fm-agent-card').getBoundingClientRect().width)), {
                message: `[${width}] Animate re-seats the card at exactly ${width}px`, timeout: 15000, intervals: [100, 250]
            }).toBe(width);
            await page.evaluate(() => document.fonts.ready);

            const cards = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fm-agent-card')].map(card => {
                const q      = sel => card.querySelector(sel),
                      rect   = el => el.getBoundingClientRect(),
                      line   = q('.fm-card-name-line'),
                      name   = q('.fm-card-name'),
                      member = sel => {
                          const el = q(sel);

                          // on the line's row, or on a row the line does not show
                          return el && getComputedStyle(el).display !== 'none'
                              ? {visible: rect(el).top - rect(line).top < rect(line).height, pastLine: Math.round((rect(el).right - rect(line).right) * 10) / 10}
                              : null
                      };

                return [name.textContent, {
                    cardHeight  : Math.round(rect(card).height),
                    chip        : member('.fm-name-provenance'),
                    engine      : member('.fm-card-engine'),
                    lineHeight  : Math.round(rect(line).height * 10) / 10,
                    namePastLine: Math.round((rect(name).right - rect(line).right) * 10) / 10,
                    nameClient  : name.clientWidth,
                    nameScroll  : name.scrollWidth,
                    textOverflow: getComputedStyle(name).textOverflow,
                    title       : name.getAttribute('title')
                }]
            })));

            const long = cards[LONG], short = cards[SHORT];

            // the name never leaves its line: where it cannot fit it overflows ITSELF — the only
            // state in which its ellipsis renders — instead of being cut by an ancestor
            for (const name of [LONG, SHORT]) {
                const card = cards[name];

                expect(card.namePastLine, `[${width}] ${name}: the name ends inside the name line`).toBeLessThanOrEqual(0.5);
                expect(card.textOverflow, `[${width}] ${name}: the name's overflow form is the ellipsis`).toBe('ellipsis');
                expect(card.title,        `[${width}] ${name}: the title keeps the name whole`).toBe(name);

                for (const [label, member] of [['the chip', card.chip], ['the engine tag', card.engine]]) {
                    member?.visible && expect(member.pastLine, `[${width}] ${name}: ${label} is whole — it ends inside the line`).toBeLessThanOrEqual(0.5)
                }

                lineHeights.add(card.lineHeight)
            }

            // 245px of name against a 118–168px line: ellipsized below the column floor, whole from it
            expect(long.nameScroll > long.nameClient, `[${width}] the long name ${width < 410 ? 'ellipsizes' : 'renders whole'} (scroll ${long.nameScroll} / client ${long.nameClient})`).toBe(width < 410);

            // a short name keeps its chip at every width, and the card's height is the name's business at none
            expect(short.chip?.visible, `[${width}] the short name keeps its provenance chip`).toBe(true);
            expect(long.cardHeight, `[${width}] both cards share one height`).toBe(short.cardHeight)
        }

        expect([...lineHeights], 'the name line is one row at every width').toHaveLength(1)
    });
});
