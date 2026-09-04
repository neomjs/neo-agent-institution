import {test, expect} from '@playwright/test';

/**
 * The FM cockpit's visual-regression baselines — the design gate's mechanical guard: pixel
 * goldens for the scope-floor states where a diff means a DESIGN regression (a wrong rail
 * width, an off-token color), never content churn.
 *
 * Determinism stack (each layer load-bearing):
 * - the config forces `reducedMotion: 'reduce'` — every transition collapses through the
 *   motion-token layer, so settling means "the dock motion signal class is ABSENT", never a
 *   timing sleep;
 * - data is the committed fixture seed only: the registry bridge stays unwired here, and the
 *   fail-closed loaders render the honestly-labelled sample state BY DESIGN — the fixture IS
 *   the deterministic render;
 * - `document.fonts.ready` gates every capture (half-loaded webfonts are the classic
 *   false-diff source);
 * - the globalSetup already refused the run if the built theme CSS trails the SCSS sources.
 *
 * Baselines refresh ONLY via `--update-snapshots` under the visual config — a refreshed
 * golden is a reviewed design decision (the PR diff is the review surface).
 */
test.describe('FM cockpit — visual baselines (the design-gate scope floor)', () => {
    test.setTimeout(120000);

    // CI never runs the visual config (named-config discipline), and the skip guard keeps the
    // suite honest even if a workflow ever sweeps broadly
    test.skip(process.env.NEO_TEST_SKIP_CI === 'true', 'visual baselines are rendered-platform artifacts — local harness only');

    /**
     * Boots the agentos shell and waits for the SETTLED fleet cockpit: shell visible, fonts
     * loaded, at least one card rendered from the seed, every card image settled, and no dock
     * motion in flight.
     * @param {Object} page
     */
    const bootSettledCockpit = async page => {
        // The determinism stack's clock layer, resolved WITHOUT freezing the clock: ViewerTime's
        // same-day ladder runs in the APP WORKER, which `page.clock` cannot reach — but the ladder's
        // older-day form carries no year, so the fixed 2026-07-05 fixture instants render the same
        // date-prefixed string on EVERY capture day except the fixture day itself. The pinned
        // context locale/zone (config `use`) do bind worker-side Intl, which closes the remaining
        // environment dependency.
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-agent-card').first()).toBeVisible({timeout: 30000});
        await page.evaluate(() => document.fonts.ready);
        // The one non-deterministic layer of the fixture render: card avatars are LIVE GitHub
        // image fetches, and a capture that races them locks placeholder circles into the pixels.
        // Wait for every present image to settle (load OR error), bounded so a dead fetch can
        // never wedge the suite.
        await page.evaluate(() => Promise.all(
            [...document.images]
                .filter(img => !img.complete)
                .map(img => new Promise(resolve => {
                    img.addEventListener('load',  resolve, {once: true});
                    img.addEventListener('error', resolve, {once: true});
                    setTimeout(() => {
                        // A dead fetch resolves identically to a load — without this line the gate
                        // emits nothing and the placeholder-circle capture it exists to prevent
                        // lands silently. The bound must be observable to be a bound.
                        console.warn(`[visual-fixture] image did not settle within 10s: ${img.currentSrc || img.src || '(no src)'} — capturing with whatever is rendered`);
                        resolve()
                    }, 10000)
                }))
        ));
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

        // #85's shared measure — the fleet head's no-clip geometry, read by the narrow arms below:
        // a legend that hides its last states says those states do not exist, so every band
        // asserts scrollWidth inside clientWidth and the last swatch inside the row.
        await page.evaluate(() => {
            globalThis.__fmMeasureFleetHead = () => {
                const head     = document.querySelector('.fm-fleet-head'),
                      title    = head.querySelector('.fm-fleet-title'),
                      legend   = head.querySelector('.fm-health-bar'),
                      swatches = [...head.querySelectorAll('.fm-health-swatch')],
                      rect     = head.getBoundingClientRect(),
                      last     = swatches.at(-1)?.getBoundingClientRect();

                return {
                    clientWidth    : head.clientWidth,
                    scrollWidth    : head.scrollWidth,
                    right          : Math.round(rect.right),
                    swatches       : swatches.length,
                    lastSwatchRight: last ? Math.round(last.right) : null,
                    titleBottom    : Math.round(title.getBoundingClientRect().bottom),
                    legendTop      : legend ? Math.round(legend.getBoundingClientRect().top) : null
                }
            }
        });
    };

    test('the default shell layout — the committed document projected (fleet over stream, chrome tucked)', async ({page}) => {
        await bootSettledCockpit(page);

        // #92: every inline dock header paints the cockpit's own plate and edge — never the
        // theme's neutral-highlighted band. This is a COMPUTED-STYLE witness on purpose: the
        // pixel comparator (pixelmatch at threshold 0.2, YIQ) reads the theme's rgb(41,45,40)
        // and the cockpit's rgb(20,26,35) as the same pixel, so the golden alone cannot see
        // this class of drift in the dark range.
        const paint = await page.evaluate(() => {
            const headers = [...document.querySelectorAll('.neo-tab-container-inline > .neo-tab-header-toolbar')],
                  probe   = document.createElement('div'),
                  resolve = token => {
                      probe.style.background = `var(${token})`;
                      document.body.appendChild(probe);
                      const value = getComputedStyle(probe).backgroundColor;
                      probe.remove();
                      return value
                  },
                  panel = resolve('--fm-panel'),
                  line  = resolve('--fm-line');

            return {
                count  : headers.length,
                panel,
                line,
                grounds: [...new Set(headers.map(el => getComputedStyle(el).backgroundColor))],
                edges  : [...new Set(headers.map(el => getComputedStyle(el).boxShadow))],
                images : [...new Set(headers.map(el => getComputedStyle(el).backgroundImage))]
            }
        });

        expect(paint.count, 'the shell projects its dock headers').toBeGreaterThanOrEqual(2);
        expect(paint.grounds, 'every dock header sits on the cockpit panel plate').toEqual([paint.panel]);
        expect(paint.edges, 'every dock header closes on the cockpit edge hairline').toEqual([`${paint.line} 0px -1px 0px 0px inset`]);
        expect(paint.images, 'no theme gradient reaches a strip').toEqual(['none']);

        await expect(page.locator('.fm-fleet-cockpit')).toHaveScreenshot('cockpit-default-shell.png')
    });

    test('the fleet grid — one card per seeded resident at the density-ranked bar', async ({page}) => {
        await bootSettledCockpit(page);

        await expect(page.locator('.fm-fleet-grid')).toHaveScreenshot('fleet-grid-cards.png')
    });

    test('the activity stream — the chip-row vocabulary against the fixture feed', async ({page}) => {
        await bootSettledCockpit(page);

        await expect(page.locator('.fm-activity-stream')).toHaveScreenshot('activity-stream-chips.png')
    });

    test('the ~314 vessel window — the cockpit fits and the interactive core is reachable (viewport capture, geometry asserted)', async ({page}) => {
        // The Retina evidence correction, honestly bounded: a 628-physical-px capture is ~314 CSS px.
        // The vessel-narrow layout makes the cockpit fit this window: inline-size containment
        // on the cockpit root (the own-width discipline) stops descendant min-content floors
        // from escalating, the spine banner shrinks into its ellipsis rules, and the wrapped bar keeps
        // Start fleet reachable. This receipt asserts the INVERSE of the pre-repair overflow witness:
        // the cockpit spans exactly the vessel width, nothing scrolls off-window, and the primary
        // action is inside the viewport.
        await page.setViewportSize({width: 314, height: 900});
        await bootSettledCockpit(page);

        const geometry = await page.evaluate(() => {
            const cockpit = document.querySelector('.fm-fleet-cockpit'),
                  start   = document.querySelector('.fm-fleet-start'),
                  // the sub-narrow card grammar's semantic floor: at vessel width every card must
                  // still name its resident — identity may ellipsize, never collapse
                  idents  = [...document.querySelectorAll('.fm-agent-card .fm-card-identity')]
                      .map(el => Math.round(el.getBoundingClientRect().width));

            return {
                viewport      : window.innerWidth,
                clientWidth   : Math.round(cockpit.clientWidth),
                scrollWidth   : Math.round(cockpit.scrollWidth),
                startRect     : start ? start.getBoundingClientRect().toJSON() : null,
                docScrollWidth: Math.round(document.documentElement.scrollWidth),
                minIdentity   : idents.length ? Math.min(...idents) : 0,
                head          : globalThis.__fmMeasureFleetHead()
            }
        });

        expect(geometry.viewport, 'the viewport itself is the 314px vessel window').toBe(314);
        // #85: the seven-state legend folds inside its bar at vessel width — never clips a state
        expect(geometry.head.swatches, 'all seven legend states are rendered at vessel width').toBe(7);
        expect(geometry.head.scrollWidth, 'the head row hides nothing: no horizontal pressure').toBeLessThanOrEqual(geometry.head.clientWidth);
        expect(geometry.head.lastSwatchRight, 'the last legend state sits inside the head row').toBeLessThanOrEqual(geometry.head.right);
        expect(geometry.scrollWidth, 'the repaired cockpit no longer overflows its vessel — scroll width stays inside the client box').toBeLessThanOrEqual(geometry.clientWidth);
        expect(geometry.docScrollWidth, 'the document carries no horizontal overflow at vessel width').toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.startRect, 'the Start fleet button is rendered').not.toBeNull();
        expect(geometry.startRect.right, 'the Start fleet button sits inside the vessel window — the interactive core is reachable').toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.startRect.left, 'the Start fleet button is not clipped at the left edge either').toBeGreaterThanOrEqual(0);
        // The RA-1 regression class: the narrow band's 44px touch pair once starved the identity
        // column to 15px and every resident's name collapsed to two letters. The sub-narrow card
        // mode exists to prevent exactly that — this floor keeps it honest.
        expect(geometry.minIdentity, 'every card still NAMES its resident at vessel width — the identity column never collapses').toBeGreaterThanOrEqual(44);

        await expect(page).toHaveScreenshot('cockpit-vessel-314.png')
    });

    test('the 720 intermediate band — mark regime: no wrap, no overflow, state collapses to marks with titles (viewport capture, geometry asserted)', async ({page}) => {
        // The lattice's third point, between the 314 fit witness and the desktop baselines:
        // above the 570px vessel-narrow threshold (the @container block must stay silent — no bar
        // wrap, no split stacking) but inside the #23 collapse order's narrow step (≤730): state
        // drops its words and keeps its marks + T5 titles, action labels drop to their glyphs,
        // and the view labels never drop. The old shrink-only regime witnessed the banner
        // ellipsizing under pressure; its own receipt said a design fix widening the box must go
        // red, not quiet — this cut IS that design fix (chrome labels are never sentences), so
        // the witness now pins the designed narrow FORM instead of the pressure it removed.
        await page.setViewportSize({width: 720, height: 900});
        await bootSettledCockpit(page);

        const geometry = await page.evaluate(() => {
            const bar       = document.querySelector('.fm-cockpit-bar'),
                  banner    = document.querySelector('.fm-spine-banner'),
                  start     = document.querySelector('.fm-fleet-start'),
                  startText = start?.querySelector('.neo-button-text'),
                  preset    = document.querySelector('.fm-preset-button .neo-button-text');

            return {
                viewport      : window.innerWidth,
                docScrollWidth: Math.round(document.documentElement.scrollWidth),
                barWrap       : getComputedStyle(bar).flexWrap,
                banner        : banner ? {
                    clientWidth: Math.round(banner.clientWidth),
                    scrollWidth: Math.round(banner.scrollWidth),
                    fontSize   : getComputedStyle(banner).fontSize,
                    title      : banner.getAttribute('title') || '',
                    ariaLabel  : banner.getAttribute('aria-label') || ''
                } : null,
                startTextShown : startText ? getComputedStyle(startText).display : null,
                presetTextShown: preset ? getComputedStyle(preset).display : null,
                startRight     : start ? Math.round(start.getBoundingClientRect().right) : null,
                head           : globalThis.__fmMeasureFleetHead()
            }
        });

        expect(geometry.viewport, 'the viewport is the 720px intermediate band').toBe(720);
        // #85: the legend wraps under the title at this band instead of clipping its tail
        expect(geometry.head.swatches, 'all seven legend states are rendered in the intermediate band').toBe(7);
        expect(geometry.head.scrollWidth, 'the head row hides nothing in the intermediate band').toBeLessThanOrEqual(geometry.head.clientWidth);
        expect(geometry.head.lastSwatchRight, 'the last legend state sits inside the head row').toBeLessThanOrEqual(geometry.head.right);
        expect(geometry.docScrollWidth, 'no horizontal document overflow in the mark regime').toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.barWrap, 'the vessel-narrow wrap rule stays silent above the 570px threshold').toBe('nowrap');
        expect(geometry.banner, 'the spine banner is rendered').not.toBeNull();
        // the designed narrow form: the word retracts (font-size 0 — never mid-word clipping),
        // the mark stays, and the FULL truth stays one hover away on title + aria
        expect(geometry.banner.fontSize, 'the state word retracts in the mark regime').toBe('0px');
        expect(geometry.banner.scrollWidth, 'no hidden pressure: the mark never overflows its box').toBeLessThanOrEqual(geometry.banner.clientWidth);
        expect(geometry.banner.title, 'the full honesty sentence rides the title').toContain('Fleet');
        expect(geometry.banner.ariaLabel, 'the aria mirror carries the sentence').toContain('Fleet');
        // the collapse order's last two clauses: action labels drop to glyphs, view labels never drop
        expect(geometry.startTextShown, 'action labels drop to their glyphs').toBe('none');
        expect(geometry.presetTextShown, 'view labels NEVER drop — they are the navigation').not.toBe('none');
        expect(geometry.startRight, 'Start fleet stays inside the band').toBeLessThanOrEqual(geometry.viewport);

        await expect(page).toHaveScreenshot('cockpit-intermediate-720.png')
    });

    test('the Review preset at 1280×720 — the fleet head keeps its whole legend when the inspector docks beside it (geometry asserted)', async ({page}) => {
        // #85's exact case: the shipped Review preset narrows the fleet pane to ~896px, which the
        // seven-state health legend does not fit beside the title. The head row wraps (layout
        // wrap), so the legend takes the line under the title — every state stays readable, and
        // the wide presets (Overview, Focus) keep their one-line head. The capture pins the
        // wrapped form; the geometry pins the no-clip contract.
        await page.setViewportSize({width: 1280, height: 720});
        await bootSettledCockpit(page);
        await page.locator('.fm-preset-button', {hasText: 'Review'}).click();
        await expect(page.locator('.fm-preset-button.pressed')).toHaveText(/Review/);
        // the switch commits through the dock loop one tick later: wait for the projected form
        // (the inspector docked beside the roster) rather than for the press
        await expect(page.locator('[class*="dock-flip-item-detail"]').first()).toBeVisible();
        await expect.poll(
            () => page.evaluate(() => Math.round(document.querySelector('.fm-fleet-grid').getBoundingClientRect().width)),
            {message: 'the Review preset narrows the fleet pane below the one-line legend width', timeout: 10000, intervals: [100]}
        ).toBeLessThan(1000);
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

        const geometry = await page.evaluate(() => ({
            viewport : window.innerWidth,
            paneWidth: Math.round(document.querySelector('.fm-fleet-grid').getBoundingClientRect().width),
            head     : globalThis.__fmMeasureFleetHead()
        }));

        expect(geometry.viewport, 'the viewport is the design pass width').toBe(1280);
        expect(geometry.head.swatches, 'all seven legend states are rendered').toBe(7);
        expect(geometry.head.scrollWidth, 'the head row hides nothing: scrollWidth stays inside clientWidth').toBeLessThanOrEqual(geometry.head.clientWidth);
        expect(geometry.head.lastSwatchRight, 'the last legend state (benched / offline) sits inside the head row').toBeLessThanOrEqual(geometry.head.right);
        expect(geometry.head.legendTop, 'the legend took the line under the title').toBeGreaterThan(geometry.head.titleBottom - 1);

        await expect(page).toHaveScreenshot('cockpit-review-1280.png')
    });

    test('the Accounts surface — the inherited design-gate golden, under harness refresh semantics', async ({page}) => {
        await bootSettledCockpit(page);

        await page.locator('.agent-shell').getByText('Accounts', {exact: true}).click();
        await expect(page.locator('.agent-panel-accounts')).toBeVisible({timeout: 30000});
        // The card's class is fm-agent-config-card (introduced by the define-agent config-card
        // re-skin); the older reference-only `.agent-config-card` selector went stale with it.
        await expect(page.locator('.fm-agent-config-card')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);

        await expect(page.locator('.agent-panel-accounts')).toHaveScreenshot('accounts-config-surface.png')
    });
});
