import {test, expect} from '@playwright/test';
import {landFleetActivity, landFleetRoster, landFleetSample, landFleetTasks} from '../fixtures.mjs';
import {sampleTasks} from '../fixture/fleetSample.mjs';

/**
 * The FM cockpit's visual-regression baselines — the design gate's mechanical guard: pixel
 * goldens for the scope-floor states where a diff means a DESIGN regression (a wrong rail
 * width, an off-token color), never content churn.
 *
 * Determinism stack (each layer load-bearing):
 * - the config forces `reducedMotion: 'reduce'` — every transition collapses through the
 *   motion-token layer, so settling means "the dock motion signal class is ABSENT", never a
 *   timing sleep;
 * - the tests' sample roster and activity land through the liveness owner's own admission
 *   (`landFleetSample`), while task width arms land `sampleTasks` through `landFleetTasks`:
 *   the registry bridge stays unwired here, nothing is seeded, and the cold and empty states
 *   get their own arm;
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
     * loaded, at least one card rendered from the fixture, every card image settled, and no dock
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
        // the tests' sample fleet lands as the fleet's answer — nothing is seeded any more
        await landFleetSample(page);
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
        await installFleetHeadMeasure(page)
    };

    /**
     * Boots the agentos shell to the SETTLED but UNANSWERED cockpit: shell visible, fonts loaded, no dock
     * motion in flight, both surfaces cold — nothing is landed, nothing is seeded. The arms that witness
     * the cold spine (the banner's narrow form, the empty states) boot here.
     * @param {Object} page
     */
    const bootColdCockpit = async page => {
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-fleet-head')).toHaveClass(/is-cold/);
        await expect(page.locator('.fm-stream-head')).toHaveClass(/is-cold/);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
        await installFleetHeadMeasure(page)
    };

    /**
     * Installs the fleet head's shared no-clip measure — its geometry, read by the narrow arms below:
     * a legend that hides its last states says those states do not exist, so every band asserts
     * scrollWidth inside clientWidth and the last swatch inside the row.
     * @param {Object} page
     */
    const installFleetHeadMeasure = async page => {
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

        // every inline dock header paints the cockpit's own plate and edge — never the
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
                      .map(el => Math.round(el.getBoundingClientRect().width)),
                  // the shell's scope control contains its own label (it once spilled 11px over the
                  // wordmark and past the theme switch), and the wordmark yields at this band
                  rect     = el => el?.getBoundingClientRect(),
                  // the intersection AREA: the verbs sit on their own row under the identity at this
                  // band, so an x-only overlap would read a word above them as a word under them
                  overlap  = (a, b) => a && b
                      ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
                      : 0,
                  switcher = rect(document.querySelector('.fm-instance-switcher')),
                  label    = rect(document.querySelector('.fm-instance-switcher .fm-instance-label')),
                  title    = rect(document.querySelector('.agent-shell-title')),
                  // the no-mid-word-clipping law on the densest card — every state word ends inside its
                  // own state line and never runs under the verbs (it once lost "rved" under them).
                  // The law holds for EVERY member on the line's row: the badge, the band and the
                  // telltale once ran under the verbs while only the word was guarded. A member the
                  // row cannot hold sits on a row the line does not show, so it is not measured.
                  cards    = [...document.querySelectorAll('.fm-agent-card')].map(card => {
                      const line  = rect(card.querySelector('.fm-card-state-line')),
                            verbs = rect(card.querySelector('.fm-card-control-verbs')),
                            word  = rect(card.querySelector('.fm-card-state'));

                      return {
                          lineHeight    : Math.round(line.height),
                          members       : [...card.querySelectorAll('.fm-card-state-line > *')]
                              .map(el => ({cls: el.className, box: rect(el)}))
                              .filter(({box}) => box.width > 0 && box.top - line.top < line.height)
                              .map(({cls, box}) => ({cls, pastLine: Math.round(box.right - line.right), underVerbs: Math.round(overlap(box, verbs))})),
                          wordPastLine  : word && line ? Math.round(word.right - line.right) : 0,
                          wordUnderVerbs: Math.round(overlap(word, verbs))
                      }
                  });

            return {
                viewport      : window.innerWidth,
                clientWidth   : Math.round(cockpit.clientWidth),
                scrollWidth   : Math.round(cockpit.scrollWidth),
                startRect     : start ? start.getBoundingClientRect().toJSON() : null,
                docScrollWidth: Math.round(document.documentElement.scrollWidth),
                minIdentity   : idents.length ? Math.min(...idents) : 0,
                head          : globalThis.__fmMeasureFleetHead(),
                shell         : {
                    labelInside  : !!label && label.left >= switcher.left && label.right <= switcher.right,
                    labelOverTheme: Math.round(overlap(label, rect(document.querySelector('.agent-theme-button')))),
                    titleWidth   : title ? Math.round(title.width) : 0
                },
                cards
            }
        });

        expect(geometry.viewport, 'the viewport itself is the 314px vessel window').toBe(314);
        // the five-state legend folds inside its bar at vessel width — never clips a state
        expect(geometry.head.swatches, 'all five legend states are rendered at vessel width').toBe(5);
        expect(geometry.head.scrollWidth, 'the head row hides nothing: no horizontal pressure').toBeLessThanOrEqual(geometry.head.clientWidth);
        expect(geometry.head.lastSwatchRight, 'the last legend state sits inside the head row').toBeLessThanOrEqual(geometry.head.right);
        expect(geometry.scrollWidth, 'the repaired cockpit no longer overflows its vessel — scroll width stays inside the client box').toBeLessThanOrEqual(geometry.clientWidth);
        expect(geometry.docScrollWidth, 'the document carries no horizontal overflow at vessel width').toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.startRect, 'the Start fleet button is rendered').not.toBeNull();
        expect(geometry.startRect.right, 'the Start fleet button sits inside the vessel window — the interactive core is reachable').toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.startRect.left, 'the Start fleet button is not clipped at the left edge either').toBeGreaterThanOrEqual(0);
        // The regression class this floor guards: the narrow band's 44px touch pair once starved the identity
        // column to 15px and every resident's name collapsed to two letters. The sub-narrow card
        // mode exists to prevent exactly that — this floor keeps it honest.
        expect(geometry.minIdentity, 'every card still NAMES its resident at vessel width — the identity column never collapses').toBeGreaterThanOrEqual(44);
        // the scope control paints inside its own box, and the wordmark yields at this band (the
        // logo is the mark, the window title carries "Agent OS", the scope keeps its tail)
        expect(geometry.shell.labelInside, 'the instance label sits inside the switcher box').toBe(true);
        expect(geometry.shell.labelOverTheme, 'the instance label never reaches the theme switch').toBe(0);
        expect(geometry.shell.titleWidth, 'the wordmark yields at the vessel band').toBe(0);
        expect(geometry.cards.length, 'the roster rendered cards to measure').toBeGreaterThan(0);
        for (const card of geometry.cards) {
            expect(card.wordPastLine, 'the state word ends inside its own state line').toBeLessThanOrEqual(0);
            expect(card.wordUnderVerbs, 'the state word never runs under the verbs').toBe(0);
            expect(card.lineHeight, 'the state line is one row at vessel width').toBe(16);

            for (const member of card.members) {
                expect(member.pastLine, `${member.cls} ends inside the state line`).toBeLessThanOrEqual(0);
                expect(member.underVerbs, `${member.cls} never runs under the verbs`).toBe(0)
            }
        }

        await expect(page).toHaveScreenshot('cockpit-vessel-314.png')
    });

    test('the shell wordmark reads on its band in both skins (computed contrast, no golden)', async ({page}) => {
        // the wordmark rendered the engine's one-colour label ink in both skins — 16.56:1 on the dark
        // rail, 1.04:1 on the light one. A computed receipt on purpose: no light-skin golden exists,
        // and a pixel comparator would only bless whatever frame it saw first.
        await page.setViewportSize({width: 1280, height: 720});
        await bootSettledCockpit(page);

        const readContrast = () => page.evaluate(() => {
            const title = document.querySelector('.agent-shell-title'),
                  band  = document.querySelector('.agent-top-toolbar'),
                  lum   = color => {
                      const [r, g, b] = color.match(/[\d.]+/g).map(Number),
                            f         = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 };

                      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
                  },
                  a = lum(getComputedStyle(title).color),
                  b = lum(getComputedStyle(band).backgroundColor);

            return {
                theme   : [...document.querySelector('.agent-os-viewport').classList].find(cls => cls.startsWith('neo-theme-')) || 'config-default',
                contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
            }
        });

        const dark = await readContrast();
        expect(dark.contrast, `the wordmark reads on the dark band (${dark.theme})`).toBeGreaterThanOrEqual(4.5);

        // one click from the dark the viewport opens in, with no theme stored and no dark preference
        await page.locator('.agent-theme-button').click();
        await expect(page.locator('.agent-os-viewport.neo-theme-neo-light'), 'the first click switches').toBeVisible();

        const light = await readContrast();
        expect(light.theme, 'the light skin is on the viewport').toBe('neo-theme-neo-light');
        expect(light.contrast, 'the wordmark reads on the light band — it measured 1.04:1 before the ink binding').toBeGreaterThanOrEqual(4.5);
    });

    test('the 720 intermediate band — mark regime: no wrap, no overflow, state collapses to marks with titles (viewport capture, geometry asserted)', async ({page}) => {
        // The lattice's third point, between the 314 fit witness and the desktop baselines:
        // above the 570px vessel-narrow threshold (the @container block must stay silent — no bar
        // wrap, no split stacking) but inside the cockpit bar's collapse order at its narrow step (≤730): state
        // drops its words and keeps its marks + T5 titles, action labels drop to their glyphs,
        // and the view labels never drop. The old shrink-only regime witnessed the banner
        // ellipsizing under pressure; its own receipt said a design fix widening the box must go
        // red, not quiet — this cut IS that design fix (chrome labels are never sentences), so
        // the witness now pins the designed narrow FORM instead of the pressure it removed. The cold
        // boot is the band's subject: the banner is the state mark, and only an unanswered spine
        // renders one (a live spine earns zero pixels).
        await page.setViewportSize({width: 720, height: 900});
        await bootColdCockpit(page);

        const geometry = await page.evaluate(() => {
            const bar       = document.querySelector('.fm-cockpit-bar'),
                  banner    = document.querySelector('.fm-spine-banner'),
                  start     = document.querySelector('.fm-fleet-start'),
                  startText = start?.querySelector('.neo-button-text');

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
                startTextShown: startText ? getComputedStyle(startText).display : null,
                startRight    : start ? Math.round(start.getBoundingClientRect().right) : null,
                head          : globalThis.__fmMeasureFleetHead()
            }
        });

        expect(geometry.viewport, 'the viewport is the 720px intermediate band').toBe(720);
        // the legend wraps under the title at this band instead of clipping its tail
        expect(geometry.head.swatches, 'all five legend states are rendered in the intermediate band').toBe(5);
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
        // the collapse order's last clause: action labels drop to glyphs
        expect(geometry.startTextShown, 'action labels drop to their glyphs').toBe('none');
        expect(geometry.startRight, 'Start fleet stays inside the band').toBeLessThanOrEqual(geometry.viewport);

        await expect(page).toHaveScreenshot('cockpit-intermediate-720.png')
    });

    test('the Review preset at 1280×720 — the fleet head keeps its whole legend when the inspector docks beside it (geometry asserted)', async ({page}) => {
        // the legend's exact case: the shipped Review preset narrows the fleet pane to ~896px, and
        // the five-state legend still fits beside the title there, so the Review preset keeps the
        // one-line head the wide presets have. The head row wraps (layout wrap) wherever the legend
        // cannot fit. The capture pins the one-line form; the geometry pins the no-clip contract.
        await page.setViewportSize({width: 1280, height: 720});
        await bootSettledCockpit(page);
        // perspectives switch from their drawer: reveal it, apply Review, dismiss the reveal
        await page.locator('.neo-dashboard-dock-rail-tab', {hasText: 'Perspectives'}).first().click();
        await page.locator('.fm-perspectives-card', {hasText: 'Review'}).locator('.fm-perspectives-apply').click();
        await page.keyboard.press('Escape');
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
        expect(geometry.head.swatches, 'all five legend states are rendered').toBe(5);
        expect(geometry.head.scrollWidth, 'the head row hides nothing: scrollWidth stays inside clientWidth').toBeLessThanOrEqual(geometry.head.clientWidth);
        expect(geometry.head.lastSwatchRight, 'the last legend state (offline) sits inside the head row').toBeLessThanOrEqual(geometry.head.right);
        expect(geometry.head.legendTop, 'the five-state legend fits on the title\'s line').toBeLessThan(geometry.head.titleBottom);

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
        // the rail tab's tooltip opens over this surface: dwell until it has shown, leave, and wait out its hide
        await page.waitForTimeout(300);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);

        await expect(page.locator('.agent-panel-accounts')).toHaveScreenshot('accounts-config-surface.png')
    });

    /**
     * @summary Activates the Tasks tab (the south strip's second surface) and waits for the pane's
     * test-owned dense task answer — the queue's starved waiter (its wait as text, its own cause)
     * and the lease line under the queued head.
     * @param {Object} page
     */
    const openTasksPane = async page => {
        const tab = page.locator('.neo-dashboard-dock-tabs .neo-tab-header-button', {hasText: /tasks/i});

        await expect(tab).toBeVisible({timeout: 30000});
        await tab.click();
        await expect(page.locator('.fm-tasks-pane')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-tasks-pane .fm-tasks-section-meta')).toHaveCount(1);
        await expect(page.locator('.fm-tasks-pane .fm-task-state.is-starved')).toHaveCount(1);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
        // the list owns the scroll inside the south strip: the golden witnesses the QUEUE — its head
        // with the counts, the lease line, the starved waiter — so the queued head leads the capture
        await page.evaluate(() => {
            const
                pane = document.querySelector('.fm-tasks-pane'),
                list = pane.querySelector('.fm-tasks-list'),
                head = pane.querySelector('.fm-tasks-section-head.is-queued'),
                row  = pane.querySelector('.fm-task-state.is-starved').closest('.fm-task-row');

            head.scrollIntoView({block: 'start'});
            // a narrow band wraps the rows taller than the strip is high: bring the starved waiter in,
            // then give its first line (the name, in the band) back the room the sticky head covers
            row.scrollIntoView({block: 'nearest'});

            const covered = head.getBoundingClientRect().bottom - row.getBoundingClientRect().top;

            if (covered > 0) { list.scrollTop -= covered }
        });
        await expect(page.locator('.fm-tasks-pane .fm-task-row:has(.fm-task-state.is-starved) .fm-task-name')).toBeInViewport();
        await expect(page.locator('.fm-tasks-pane .fm-task-state.is-starved')).toBeInViewport()
    };

    /** @summary The light skin on the viewport: the switch activated once, from the keyboard, from the dark the
     * viewport opens in. A pointer on the switch would put its tooltip in the shot; the wordmark arm clicks. */
    const switchToLightSkin = async page => {
        const toggle = page.locator('.agent-theme-button');

        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.agent-os-viewport.neo-theme-neo-light'), 'the first activation switches').toBeVisible();
        await toggle.blur();
        await page.evaluate(() => document.fonts.ready)
    };

    /** @summary The tasks pane's no-clip geometry: the pane and every structural row inside their own width. */
    const measureTasksPane = page => page.evaluate(() => {
        const pane  = document.querySelector('.fm-tasks-pane'),
              right = pane.getBoundingClientRect().right,
              rows  = [...pane.querySelectorAll('.fm-task-row, .fm-tasks-section-head, .fm-tasks-section-meta')];

        return {
            // the layout width — what the pane's own width-query context reads (a scaled ancestor
            // shrinks the painted rect, never this)
            width  : pane.clientWidth,
            noClip : pane.scrollWidth <= pane.clientWidth && rows.every(row => row.scrollWidth <= row.clientWidth),
            spill  : [...pane.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > right + 0.5).length,
            // the receipt behind a red: which row overflows its own box, and by how much
            clipped: rows.filter(row => row.scrollWidth > row.clientWidth).map(row => `${row.className}: ${row.scrollWidth} > ${row.clientWidth}`),
            pane   : `${pane.scrollWidth} / ${pane.clientWidth}`
        }
    });

    test('the Tasks pane at the 720 band — the queue\'s starved shape, the lease line, the counts; both skins (#113)', async ({page}) => {
        await page.setViewportSize({width: 720, height: 900});
        await bootSettledCockpit(page);
        await landFleetTasks(page, sampleTasks);
        await openTasksPane(page);

        const geometry = await measureTasksPane(page);

        expect(geometry.noClip, 'nothing clips inside the pane').toBe(true);
        expect(geometry.spill, 'no descendant leaves the pane').toBe(0);
        await expect(page.locator('.fm-tasks-pane')).toHaveScreenshot('tasks-pane-720.png');

        await switchToLightSkin(page);
        await expect(page.locator('.fm-tasks-pane')).toHaveScreenshot('tasks-pane-720-light.png')
    });

    test('the cold Tasks pane has only unanswered sections — no task, lease, count, or source claim; both skins (#240)', async ({page}) => {
        await page.setViewportSize({width: 720, height: 900});
        await bootColdCockpit(page);
        // The app's boot fallback is an unavailable answer. A null landing captures the distinct
        // pre-answer state without putting a fixture row in the product.
        await landFleetTasks(page, null);

        const tab = page.locator('.neo-dashboard-dock-tabs .neo-tab-header-button', {hasText: /tasks/i});

        await expect(tab).toBeVisible({timeout: 30000});
        await tab.click();

        const pane = page.locator('.fm-tasks-pane');

        await expect(pane).toBeVisible({timeout: 30000});
        await expect(pane.locator('.fm-tasks-section-head .fm-freshness.is-cold')).toHaveCount(3);
        await expect(pane.locator('.fm-tasks-empty-row .fm-tasks-empty')).toHaveText([
            'Tasks not answered yet.', 'Tasks not answered yet.', 'Tasks not answered yet.'
        ]);
        await expect(pane.locator('.fm-task-row, .fm-tasks-section-meta, .fm-tasks-section-count, .fm-freshness[class*="is-source-"]')).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
        await expect(pane).toHaveScreenshot('tasks-pane-cold.png');

        await switchToLightSkin(page);
        await expect(pane).toHaveScreenshot('tasks-pane-cold-light.png')
    });

    /**
     * @summary Activates the Memories tab (the south strip's third surface) and waits for its cold
     * spine — the head, the authority words, the null-selection meta line. No seat is selected in
     * the fixture boot, so the registers stay empty: the golden witnesses the pane's own rhythm and
     * the registers' chrome, never a card (the cards' chrome is the Neural Link witness's arm).
     * @param {Object} page
     */
    const openMemoriesPane = async page => {
        const tab = page.locator('.neo-dashboard-dock-tabs .neo-tab-header-button', {hasText: /memories/i});

        await expect(tab).toBeVisible({timeout: 30000});
        await tab.click();
        await expect(page.locator('.fm-memories-pane')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-memories-pane .fm-pane-title')).toHaveText('What they remember');
        await expect(page.locator('.fm-memories-pane')).toContainText('Select an agent card in the roster');
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0)
    };

    test('the Memories pane at the 720 band — the head on the pane contract, the registers without grid chrome; both skins', async ({page}) => {
        await page.setViewportSize({width: 720, height: 900});
        await bootSettledCockpit(page);
        await openMemoriesPane(page);

        // the pane contract's inset, one gap between the head and the meta line. The registers are
        // not in the DOM until a seat is chosen, so their chrome (the container frame, the cell
        // lattice) is the Neural Link witness's arm on live cards.
        const rhythm = await page.evaluate(() => {
            const pane  = document.querySelector('.fm-memories-pane'),
                  head  = pane.querySelector('.fm-pane-head'),
                  meta  = pane.querySelector('.fm-memories-meta'),
                  style = getComputedStyle(pane);

            return {
                paddingTop: style.paddingTop,
                rowGap    : style.rowGap,
                headToMeta: Math.round(meta.getBoundingClientRect().top - head.getBoundingClientRect().bottom)
            }
        });

        expect(rhythm.paddingTop, 'the pane inset (--fm-space-3), every pane\'s').toBe('12px');
        expect(rhythm.rowGap, 'the panel gap (--fm-space-3)').toBe('12px');
        expect(rhythm.headToMeta, 'the meta line sits one gap under the head').toBe(12);
        await expect(page.locator('.fm-memories-pane')).toHaveScreenshot('memories-pane-720.png');

        await switchToLightSkin(page);
        await expect(page.locator('.fm-memories-pane')).toHaveScreenshot('memories-pane-720-light.png')
    });

    test('every strip and rail pane reads one head — the chrome title on the pane inset, no button at a slab\'s scale (computed, no golden)', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);

        // [tab, pane root, the title's inset from the pane's host]: the strip pane and the rail's
        // reveal well both frame on --fm-space-3; the Add agent form is a card IN the well (the
        // drawer ruling), so its head sits on the card's own inset inside its 1px border
        const panes = [
            ['Activity', '.fm-activity-stream', 12], ['Tasks', '.fm-tasks-pane', 12], ['Memories', '.fm-memories-pane', 12],
            ['Mailbox', '.fm-operator-mailbox', 12], ['Catch up', '.fm-catch-up-pane', 12], ['Golden Path', '.fm-golden-path-pane', 12],
            ['Perspectives', '.fm-perspectives-pane', 12], ['Add agent', '.fm-add-agent-form', 25], ['Wake routes', '.fm-wakeroutes-pane', 12]
        ];

        for (const [label, root, inset] of panes) {
            const name  = new RegExp(`^\\s*${label}\\s*$`, 'i'),
                  strip = page.locator('.neo-dashboard-dock-tabs .neo-tab-header-button', {hasText: name}),
                  tab   = await strip.count() ? strip.first() : page.locator('.neo-dashboard-dock-rail-tab', {hasText: name}).first();

            await tab.click();
            // a strip tab selects, a rail tab reveals: both end pressed, so a click that did not land
            // fails here, apart from a pane that did not render
            await expect(tab, `${label}: the tab took the click`).toHaveClass(/\bpressed\b/, {timeout: 10000});
            await expect(page.locator(root).first()).toBeVisible({timeout: 30000});
            await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

            const read = await page.evaluate(selector => {
                const pane  = [...document.querySelectorAll(selector)].find(el => el.getClientRects().length),
                      title = pane.querySelector('.fm-pane-head > .fm-pane-title'),
                      probe = pane.appendChild(Object.assign(document.createElement('span'), {style: 'color: var(--fm-ink-dim)'})),
                      ink   = getComputedStyle(probe).color,
                      style = title && getComputedStyle(title);

                probe.remove();

                return {
                    ink,
                    title  : title && {color: style.color, inset: Math.round(title.getBoundingClientRect().left - pane.parentElement.getBoundingClientRect().left), size: style.fontSize, tracking: style.letterSpacing, transform: style.textTransform},
                    buttons: [...pane.querySelectorAll('.neo-button')]
                        .filter(button => button.getClientRects().length && !button.closest('.neo-tab-header-toolbar'))
                        .map(button => ({height: Math.round(button.getBoundingClientRect().height), size: parseFloat(getComputedStyle(button.querySelector('.neo-button-text') ?? button).fontSize), text: button.textContent.trim()}))
                }
            }, root);

            expect(read.title, `${label}: the head's title`).not.toBeNull();
            expect(read.title, `${label}: the chrome role, uppercase, tracked, in the dim ink`).toEqual({color: read.ink, inset, size: '11px', tracking: '0.88px', transform: 'uppercase'});

            for (const button of read.buttons) {
                expect(button.size, `${label}: "${button.text}" speaks at the chrome scale or below`).toBeLessThanOrEqual(11);
                expect(button.height, `${label}: "${button.text}" is a verb, not a slab`).toBeLessThanOrEqual(24)
            }
        }
    });

    test('the Tasks pane in the 314 vessel window — the narrow-band regime is in force and nothing clips (geometry asserted, no golden)', async ({page}) => {
        // The south strip hands the pane 224–243 CSS px here depending on whether the region grew a
        // scrollbar (measured across runs), which is why this is a geometry witness and not a golden:
        // a pixel comparator would only bless whichever width it saw first. Both widths sit inside
        // the pane's narrow-band regime (its own width-query context, ≤ 300), so the rule that makes
        // the name lead on its own line must be in force, and nothing may leave the border.
        await page.setViewportSize({width: 314, height: 900});
        await bootSettledCockpit(page);
        await landFleetTasks(page, sampleTasks);
        await openTasksPane(page);

        const geometry = await measureTasksPane(page),
              narrow   = await page.evaluate(() => getComputedStyle(document.querySelector('.fm-tasks-pane .fm-task-state.is-starved').closest('.fm-task-row').querySelector('.fm-task-name')).order);

        expect(geometry.width, JSON.stringify(geometry)).toBeLessThanOrEqual(300);
        expect(narrow, 'the narrow-band rule leads with the name').toBe('-1');
        expect(geometry.noClip, JSON.stringify(geometry)).toBe(true);
        expect(geometry.spill, JSON.stringify(geometry)).toBe(0)
    });

    test('the Tasks pane in the 240 px band — the sketch\'s Frame 4 pinned: name first, time · state second, the wait and the cause whole; both skins (#113)', async ({page}) => {
        // The band is the pane's OWN width-query context (the approved sketch's Frame 4), so it is pinned through
        // the pane's inline size where the strip is wide enough to honour it exactly — through a
        // stylesheet, never an inline style: the vdom owns the element's `style` and rewrites it on
        // the next liveness render, which is how a pixel golden would silently capture the full strip.
        await page.setViewportSize({width: 720, height: 900});
        await bootSettledCockpit(page);
        await landFleetTasks(page, sampleTasks);
        // the pin lands BEFORE the pane opens: its rows wrap taller in the band, and the capture's
        // scroll position must be taken on that final layout, never on the wide one
        await page.addStyleTag({content: '.fm-tasks-pane { max-width: 240px; }'});
        await openTasksPane(page);

        const geometry = await measureTasksPane(page);

        expect(geometry.width, JSON.stringify(geometry)).toBe(240);
        expect(geometry.noClip, JSON.stringify(geometry)).toBe(true);
        expect(geometry.spill, JSON.stringify(geometry)).toBe(0);
        await expect(page.locator('.fm-tasks-pane')).toHaveScreenshot('tasks-pane-240.png');

        await switchToLightSkin(page);
        await expect(page.locator('.fm-tasks-pane')).toHaveScreenshot('tasks-pane-240-light.png')
    });

    test('the Tasks pane between the bands — 301 · 400 · 649: the dense rows wrap, no fact clips, every name keeps its floor (geometry asserted, no golden)', async ({page}) => {
        // The widths the wrap band does not cover and the desktop does not reach: the fixture's
        // starved waiter carries the live queue's density (an instant, both flags, a yield cause),
        // and a row must fold its facts onto the next line before a name can lose its width. The
        // pane is pinned through a stylesheet (the 240 arm's reason); each pin re-lays the rows live.
        await page.setViewportSize({width: 720, height: 900});
        await bootSettledCockpit(page);
        await landFleetTasks(page, sampleTasks);
        await openTasksPane(page);

        const nameFloorPx = await page.evaluate(() => {
            const name = document.querySelector('.fm-tasks-pane .fm-task-name');

            // 12ch of the name's own font — the floor the skin declares
            return 12 * parseFloat(getComputedStyle(name).fontSize) * 0.5
        });

        for (const width of [649, 400, 301]) {
            await page.addStyleTag({content: `.fm-tasks-pane { max-width: ${width}px; }`});
            await page.evaluate(() => document.querySelector('.fm-tasks-pane .fm-task-state.is-starved').closest('.fm-task-row').scrollIntoView({block: 'nearest'}));

            const geometry = await measureTasksPane(page),
                  names    = await page.evaluate(() => [...document.querySelectorAll('.fm-tasks-pane .fm-task-row .fm-task-name')].map(name => ({
                      text : name.textContent,
                      width: Math.round(name.getBoundingClientRect().width)
                  })));

            expect(geometry.width, `pinned at ${width}`).toBe(width);
            expect(geometry.noClip, `${width}: ${JSON.stringify(geometry)}`).toBe(true);
            expect(geometry.spill, `${width}: ${JSON.stringify(geometry)}`).toBe(0);
            expect(names.length, `${width}: rows rendered`).toBeGreaterThan(0);
            names.forEach(name => expect(name.width, `${width}: "${name.text}" keeps its floor`).toBeGreaterThanOrEqual(nameFloorPx))
        }
    });

    /**
     * The fixture-envelope driver, as `Neo.worker.App.loadModule` imports it: relative to the App
     * worker's own module under `node_modules/neo.mjs/src/worker/`, four levels above the checkout.
     * @type {String}
     */
    const GOLDEN_PATH_DRIVER = '../../../../test/playwright/visual/goldenPathEnvelope.driver.mjs';

    let driverTick = 0;

    /**
     * The graph scene driver, resolved the way {@link GOLDEN_PATH_DRIVER} is.
     * @type {String}
     */
    const GRAPH_SCENE_DRIVER = '../../../../test/playwright/visual/graphSceneEnvelope.driver.mjs';

    /**
     * @summary Activates the Observatory keeper-view in the shell rail and waits for the pane's cold
     * spine: the head with the read's line and the gesture hint, the empty selection strip, the canvas
     * mounted. Cold, the graph read answers unavailable — the reason is the bridge's own and moves with the
     * Brain pin, so only the word is asserted here.
     * @param {Object} page
     */
    const openObservatoryPane = async page => {
        const tab = page.getByRole('tab', {name: 'Observatory', exact: true});

        await expect(tab).toBeVisible({timeout: 30000});
        await tab.click();
        await expect(page.locator('.fm-observatory-pane')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-observatory-pane .fm-observatory-currency')).toHaveText(/^Unavailable · /);
        await expect(page.locator('.fm-observatory-pane .fm-observatory-hover')).toHaveText('drag orbits · wheel zooms · click selects');
        await expect(page.locator('.fm-observatory-pane .fm-observatory-selected-label')).toHaveText('No node selected');
        await expect(page.locator('.fm-observatory-pane canvas')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0)
    };

    /**
     * @summary Lands one fixture `fleetGraphScene` envelope through the graph scene driver, optionally with a
     * selection, and waits for the observatory's line; the scene follows one canvas-worker frame later, so a
     * short settle follows.
     * @param {Object} page
     * @param {String} state `current|team|truncated|degraded|routeless|unavailable`
     * @param {RegExp|String} currency The line that envelope must produce
     * @param {String} [select] The qualified id to select
     */
    const feedObservatory = async (page, state, currency, select) => {
        const
            query  = `state=${state}${select ? `&select=${encodeURIComponent(select)}` : ''}&t=${++driverTick}`,
            result = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${GRAPH_SCENE_DRIVER}?${query}`);

        expect(result.success, `the driver loaded: ${JSON.stringify(result)}`).toBe(true);
        await expect(page.locator('.fm-observatory-pane .fm-observatory-currency')).toHaveText(currency);
        await page.waitForTimeout(600)
    };

    test('the Observatory pane — a read draws its density wells, the nodes in no well in a faint halo, and the route as an overlay of rank beacons the toggle removes; a selection lights its neighbourhood; a budget cut names the budget; a scene without a route and an unavailable read leave the surface clean; both skins', async ({page}) => {
        const
            pane    = page.locator('.fm-observatory-pane'),
            toggle  = pane.getByRole('button', {name: 'Golden Path'}),
            label   = pane.locator('.fm-observatory-selected-label'),
            current = /^Current · captured .+ · 16 nodes · 15 edges · 3 in the halo · complete$/,
            // no tooltip in a shot. The pointer dwells until any pending tooltip has shown, then leaves and
            // waits out the hide: an engine tooltip whose target is left inside its show delay stays up.
            rest    = async () => {
                await page.waitForTimeout(300);
                await page.mouse.move(0, 0);
                await page.waitForTimeout(500)
            };

        await bootSettledCockpit(page);
        await openObservatoryPane(page);
        await rest();

        await feedObservatory(page, 'current', current);
        await expect(pane).toHaveScreenshot('observatory-pane-current.png');

        // a control's state is its label's ink, which the pixel budget cannot see: Messages is off, Outside wells on
        const inkOf = name => pane.getByRole('button', {name}).locator('.neo-button-text').evaluate(text => getComputedStyle(text).color);

        expect(await inkOf('Messages'), 'an off control reads apart from an on one').not.toBe(await inkOf('Outside wells'));

        // the route is an overlay: switched off, the same graph stays where it was
        await toggle.click();
        await rest();
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(pane).toHaveScreenshot('observatory-pane-route-off.png');
        await toggle.click();
        await rest();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');

        await feedObservatory(page, 'current', current, 'neomjs/neo#issue-8');
        // this read's kinds are no graph kind, so the section says it has no source view for them
        await expect(label).toHaveText('Golden Path currency on the cockpit');
        await expect(pane.locator('.fm-observatory-selected-facts')).toHaveText('Golden Path rank 2');
        await expect(pane.locator('.fm-observatory-selected-no-source')).toHaveText('No source view for issue');
        await expect(pane.locator('.fm-observatory-relation-list .neo-list-header')).toHaveCount(4);
        await expect(pane).toHaveScreenshot('observatory-pane-selected.png');

        await feedObservatory(page, 'truncated', /^Current · captured .+ · 16 nodes · 15 edges · 3 in the halo · partial, budget 150 nodes \/ 300 edges \/ 32 KiB$/);
        await expect(label, 'a new snapshot that holds the id keeps the selection').toHaveText('Golden Path currency on the cockpit');
        await expect(pane).toHaveScreenshot('observatory-pane-truncated.png');

        await switchToLightSkin(page);
        await rest();
        await expect(pane, 'a skin change inks the same scene and selection again').toHaveScreenshot('observatory-pane-truncated-light.png');

        // a withheld Golden Path route is named beside the graph read's own words, never folded into them
        const withheld = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${GOLDEN_PATH_DRIVER}?state=withheld&t=${++driverTick}`);

        expect(withheld.success, `the driver loaded: ${JSON.stringify(withheld)}`).toBe(true);
        await expect(pane.locator('.fm-observatory-currency')).toHaveText(/ · partial, budget 150 nodes \/ 300 edges \/ 32 KiB · route withheld · freshness-sla-breached$/);
        await expect(toggle, 'the control says so without a hover').toHaveText('Golden Path · withheld');
        await expect(pane).toHaveScreenshot('observatory-pane-withheld-light.png');
        await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${GOLDEN_PATH_DRIVER}?state=current&t=${++driverTick}`);
        await expect(pane.locator('.fm-observatory-currency')).toHaveText(/ \/ 32 KiB$/);

        await feedObservatory(page, 'degraded', 'Degraded · graph-seam-refused · 16 nodes · 15 edges · 3 in the halo · complete');
        await expect(pane).toHaveScreenshot('observatory-pane-degraded-light.png');

        await feedObservatory(page, 'routeless', 'Degraded · route-not-found');
        await expect(label).toHaveText('Selection cleared · neomjs/neo#issue-8 is not in this read');
        await expect(pane.locator('.fm-observatory-selected-facts'), 'a cleared selection keeps none of its facts').toHaveCount(0);
        await expect(pane).toHaveScreenshot('observatory-pane-routeless-light.png');

        await feedObservatory(page, 'unavailable', 'Unavailable · fleet graph scene verb not wired');
        await expect(pane).toHaveScreenshot('observatory-pane-unavailable-light.png')
    });

    test('the Observatory\'s team lens and heat — two checked peers draw their union in hues of their own and the Team list and the rows carry them; the heat brightens what drew attention and greys what it cannot read; nothing moves; both skins', async ({page}) => {
        const
            pane  = page.locator('.fm-observatory-pane'),
            peer  = id => pane.locator('.fm-observatory-peer-list .neo-list-item').filter({hasText: id}),
            heat  = pane.getByRole('button', {name: 'Attention'}),
            lensed = / · lens · 5 nodes · 2 peers$/,
            rest  = async () => {
                await page.waitForTimeout(300);
                await page.mouse.move(0, 0);
                await page.waitForTimeout(500)
            };

        await bootSettledCockpit(page);
        await openObservatoryPane(page);
        await rest();

        await feedObservatory(page, 'team', /^Current · captured .+ · complete$/);

        // the operator's direction: Vega's AND Grace's nodes, as one union
        await peer('@neo-opus-vega').click();
        await peer('@neo-opus-grace').click();
        await expect(pane.locator('.fm-observatory-currency')).toHaveText(lensed);
        await rest();
        await expect(pane).toHaveScreenshot('observatory-pane-lens.png');

        await peer('@neo-opus-vega').click();
        await peer('@neo-opus-grace').click();
        await heat.click();
        await expect(pane.locator('.fm-observatory-currency')).toHaveText(/ · complete · heat · last 3 days · 2 unknown$/);
        await rest();
        await expect(pane).toHaveScreenshot('observatory-pane-heat.png');

        await switchToLightSkin(page);
        await rest();
        await expect(pane).toHaveScreenshot('observatory-pane-heat-light.png');

        // the Attention tooltip shows once the pointer dwells, and would stay up if the pointer left inside its delay
        await heat.click();
        await rest();
        await peer('@neo-opus-vega').click();
        await peer('@neo-opus-grace').click();
        await expect(pane.locator('.fm-observatory-currency')).toHaveText(lensed);
        await rest();
        await expect(pane).toHaveScreenshot('observatory-pane-lens-light.png');

        // a work item of the graph's own kinds says what the read carries about it and opens its page
        await feedObservatory(page, 'team', /^Current · captured .+ · complete · lens · /, 'neomjs/neo#issue-8');
        await expect(pane.locator('.fm-observatory-selected-facts')).toHaveText(/^open, as last ingested · authored by @neo-opus-grace · last activity .+ · Golden Path rank 2$/);
        await expect(pane.getByRole('link', {name: 'Open on GitHub'})).toHaveAttribute('href', 'https://github.com/neomjs/neo/issues/8');
        await rest();
        await expect(pane).toHaveScreenshot('observatory-pane-selected-source-light.png');

        // the id is behind Copy: the panel never shows it, and the action copies it
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        const copy = pane.getByRole('button', {name: 'Copy id'});

        await copy.click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('neomjs/neo#issue-8');
        await expect(copy, 'the focus the selection took returns to the action').toBeFocused();

        await page.evaluate(() => navigator.clipboard.writeText(''));
        await copy.press('Enter');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), 'and so does the keyboard').toBe('neomjs/neo#issue-8');
        await expect(copy).toBeFocused()
    });

    test('the Observatory offers the team busiest first and every focus has a way back — the head reads in two rows, a click outlines nothing the keys would, Clear and Escape leave a selection and then the lens', async ({page}) => {
        const
            pane      = page.locator('.fm-observatory-pane'),
            peers     = pane.locator('.fm-observatory-peer-list .neo-list-item'),
            node      = at => pane.locator('.fm-observatory-node-list .neo-list-item').nth(at),
            head      = pane.locator('.fm-observatory-peers-head'),
            label     = pane.locator('.fm-observatory-selected-label'),
            currency  = pane.locator('.fm-observatory-currency'),
            top       = async selector => Math.round((await pane.locator(selector).boundingBox()).y),
            outlineOf = locator => locator.evaluate(el => getComputedStyle(el).outlineStyle);

        await bootSettledCockpit(page);
        await openObservatoryPane(page);
        await feedObservatory(page, 'team', /^Current · captured .+ · complete$/);

        // the title and the gesture hint share the first row; the read's line has the second to itself, whole
        expect(await top('.fm-observatory-hover')).toBe(await top('.fm-observatory-title'));
        expect(await top('.fm-observatory-currency')).toBeGreaterThan(await top('.fm-observatory-title'));
        expect(await currency.evaluate(el => el.scrollWidth <= el.clientWidth), 'no hover truncates the line').toBe(true);

        // the team busiest first; the outside contributor only under All, the ties by identity
        await expect(head.locator('.fm-observatory-side-title')).toHaveText('Team · 5 of 6');
        await expect(peers).toHaveText([/^@neo-opus-grace3 nodes$/, /^@neo-opus-vega3 nodes$/, /^@neo-gpt2 nodes$/, /^@tobiu2 nodes$/, /^@neo-preview1 node$/]);
        await head.getByRole('button', {name: 'All'}).click();
        await expect(peers).toHaveText([/^@neo-opus-grace/, /^@neo-opus-vega/, /^@neo-gpt/, /^@tobiu/, /^@a-contributor1 node$/, /^@neo-preview/]);
        await head.getByRole('button', {name: 'All'}).click();
        await expect(peers).toHaveCount(5);

        // an outsider Team holds only while it is checked
        await head.getByRole('button', {name: 'All'}).click();
        await peers.filter({hasText: '@a-contributor'}).click();
        await head.getByRole('button', {name: 'All'}).click();
        await expect(peers).toHaveCount(6);
        await peers.filter({hasText: '@a-contributor'}).click();
        await expect(peers, 'unchecked, it leaves Team').toHaveCount(5);

        // a mouse click selects without an outline; the keys move the selection and outline the row they reach
        await node(1).click();
        await expect(label).toHaveText('Golden Path currency on the cockpit');
        expect(await outlineOf(node(1))).toBe('none');
        await page.keyboard.press('ArrowDown');
        await expect(label).toHaveText('REM digests the backlog before the next cut');
        expect(await outlineOf(node(2))).toBe('solid');

        // Escape backs out one step at a time: the selection first, then the lens
        await peers.first().click();
        await node(1).click();
        await expect(currency).toHaveText(/ · lens · /);
        await page.keyboard.press('Escape');
        await expect(label).toHaveText('No node selected');
        await expect(currency, 'the lens outlives the selection').toHaveText(/ · lens · /);
        await page.keyboard.press('Escape');
        await expect(currency).not.toHaveText(/lens/);

        // and each has its own Clear
        await peers.first().click();
        await head.getByRole('button', {name: 'Clear'}).click();
        await expect(currency).not.toHaveText(/lens/);
        await expect(head.getByRole('button', {name: 'Clear'}), 'no lens, nothing to clear').toBeHidden();
        await node(1).click();
        await pane.locator('.fm-observatory-selected-actions').getByRole('button', {name: 'Clear'}).click();
        await expect(label).toHaveText('No node selected')
    });

    /**
     * @summary Creates the packaged shell's plane-setup card in the viewport above the shell, the way
     * `ViewportController#mountPlaneSetup` inserts it on an unconfigured packaged boot. The harness
     * never boots packaged, so this is the card's only render witness; the App worker creates it
     * through the same seam the component specs drive stores through.
     * @param {Object} page
     */
    const mountPlaneSetupCard = async page => {
        const result = await page.evaluate(() => Neo.worker.App.createNeoInstance({
            importPath : '../../../../apps/agentos/view/PlaneSetupPanel.mjs',
            className  : 'AgentOS.view.PlaneSetupPanel',
            parentId   : document.querySelector('.agent-os-viewport').id,
            parentIndex: 1,
            flex       : 'none',
            reference  : 'plane-setup'
        }));

        expect(result?.id, `the card was created: ${JSON.stringify(result)}`).toBeTruthy();
        await expect(page.locator('.agent-plane-setup')).toBeVisible({timeout: 15000});
        await expect(page.locator('.agent-plane-setup .agent-plane-setup-connect')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300)
    };

    /**
     * @summary The card's control facts: the button scale, the label role, the hierarchy weights, the
     * field font — and the row's geometry, because an element's own box says nothing about what shows:
     * a row squeezed by its column and clipping its hidden overflow reports 32 px controls with their
     * tops cut off, so every control must lie inside the row and share its line.
     */
    const measurePlaneSetupCard = page => page.evaluate(() => {
        const
            cs      = el => getComputedStyle(el),
            rect    = el => { const r = el.getBoundingClientRect(); return {top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height)} },
            card    = document.querySelector('.agent-plane-setup'),
            dismiss = card.querySelector('.agent-plane-setup-dismiss'),
            connect = card.querySelector('.agent-plane-setup-connect'),
            label   = card.querySelector('.neo-toolbar .neo-label'),
            input   = card.querySelector('.neo-textfield-input'),
            row     = card.querySelector('.agent-plane-setup-row');

        return {
            dismissHeight: rect(dismiss).height,
            connectHeight: rect(connect).height,
            radius       : cs(connect).borderTopLeftRadius,
            textSize     : cs(connect.querySelector('.neo-button-text')).fontSize,
            connectWeight: cs(connect.querySelector('.neo-button-text')).fontWeight,
            dismissWeight: cs(dismiss.querySelector('.neo-button-text')).fontWeight,
            labelWeight  : cs(label).fontWeight,
            inputFont    : cs(input).fontFamily,
            row          : rect(row),
            connect      : rect(connect),
            input        : rect(input)
        }
    });

    test('the plane-setup card — the packaged shell\'s first surface reads the FM tokens: the 32 px button scale, the body role, Not now quiet and Connect in the signal; both skins', async ({page}) => {
        await bootSettledCockpit(page);
        await mountPlaneSetupCard(page);

        const paint = await measurePlaneSetupCard(page);

        expect(paint.dismissHeight, 'the quiet button on the 32 px scale').toBe(32);
        expect(paint.connectHeight, 'the primary button on the 32 px scale').toBe(32);
        expect(paint.radius).toBe('6px');
        expect(paint.textSize, 'the button label in the body role').toBe('12px');
        expect(paint.connectWeight, 'the primary carries the 600 weight').toBe('600');
        expect(paint.dismissWeight, 'the quiet action keeps 500').toBe('500');
        expect(paint.labelWeight, 'the card title at 600').toBe('600');
        expect(paint.inputFont, 'the field in the FM font, not the theme\'s Arial').not.toMatch(/Arial/);
        // what shows, not what the element claims: the row holds both controls whole, on one line
        for (const control of ['connect', 'input']) {
            expect(paint[control].top, `${control} starts inside the row ${JSON.stringify(paint.row)}`).toBeGreaterThanOrEqual(paint.row.top);
            expect(paint[control].bottom, `${control} ends inside the row ${JSON.stringify(paint.row)}`).toBeLessThanOrEqual(paint.row.bottom)
        }
        expect(paint.connect.top, 'Connect and the field share a top').toBe(paint.input.top);

        await expect(page.locator('.agent-plane-setup')).toHaveScreenshot('plane-setup-card.png');

        await switchToLightSkin(page);
        // the card sits right under the theme switch, whose tooltip would otherwise ride the capture
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await expect(page.locator('.agent-plane-setup')).toHaveScreenshot('plane-setup-card-light.png')
    });

    test('the keeper nav is an icon rail — each tab keeps its label as its accessible name and speaks it as a tooltip to its right, clear of the rail', async ({page}) => {
        await bootSettledCockpit(page);

        const
            nav    = page.locator('.agent-shell > .neo-tab-header-toolbar'),
            labels = ['Home', 'Fleet', 'Observatory', 'System', 'Accounts', 'Chat'],
            tabs   = labels.map(label => nav.getByRole('tab', {name: label, exact: true})),
            tip    = page.locator('.neo-tooltip');

        for (const [index, tab] of tabs.entries()) {
            await expect(tab, `${labels[index]} keeps its accessible name`).toHaveCount(1);
            // hidden visually only: a clipped box, never display:none, which would leave the tree
            await expect(tab.locator('.neo-button-text')).toHaveCSS('position', 'absolute');
            await expect(tab.locator('.neo-button-text')).not.toHaveCSS('display', 'none')
        }

        const boxes = await Promise.all(tabs.map(tab => tab.boundingBox()));

        for (const [index, tab] of tabs.entries()) {
            await tab.hover();
            await expect(tip).toHaveText(labels[index]);
            await expect(tip).toBeVisible();

            const box = await tip.boundingBox();

            expect(box.x, `${labels[index]}'s tooltip opens right of its icon`).toBeGreaterThanOrEqual(boxes[index].x + boxes[index].width);

            for (const [other, rail] of boxes.entries()) {
                const overlaps = box.x < rail.x + rail.width && rail.x < box.x + box.width && box.y < rail.y + rail.height && rail.y < box.y + box.height;

                expect(overlaps, `${labels[index]}'s tooltip covers no part of ${labels[other]}`).toBe(false)
            }
        }
    });

    /**
     * The Home driver, resolved the way {@link GRAPH_SCENE_DRIVER} is.
     * @type {String}
     */
    const HOME_DRIVER = '../../../../test/playwright/visual/homeState.driver.mjs';

    /**
     * @summary Opens Home from the rail and waits for its fonts. The pointer dwells until the tab's
     * tooltip has shown, then leaves and waits out the hide: a tooltip whose target is left inside its
     * show delay stays up.
     * @param {Object} page
     * @returns {Promise<Object>} The Home locator
     */
    const openHome = async page => {
        const home = page.locator('.fm-home-view');

        await page.getByRole('tab', {name: 'Home', exact: true}).click();
        await expect(home).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);

        return home
    };

    /**
     * @summary Lands `shellPlaneConfigured` through the Home driver: `false` puts Home in front of a
     * packaged shell without a plane, `null` back in front of the returning team.
     * @param {Object} page
     * @param {Boolean|null} configured
     */
    const landShellPlane = async (page, configured) => {
        const result = await page.evaluate(path => Neo.worker.App.loadModule({path}), `${HOME_DRIVER}?shellPlaneConfigured=${configured}&t=${++driverTick}`);

        expect(result.success, `the driver loaded: ${JSON.stringify(result)}`).toBe(true)
    };

    /**
     * The Home field driver, resolved the way {@link HOME_DRIVER} is.
     * @type {String}
     */
    const FIELD_DRIVER = '../../../../test/playwright/e2e/agentos/homeField.driver.mjs';

    /**
     * @summary Waits until Home's field has drawn its still frame (the config's reduced motion) with the named
     * marks in the named skin: the canvas worker draws after the DOM settles, so a capture that does not wait
     * for it misses the field.
     * @param {Object} page
     * @param {String} marks `none` or the mark count
     * @param {String} [theme='dark']
     */
    const settleField = async (page, marks, theme = 'dark') => {
        const result = await page.evaluate(async path => {
            const {error, success} = await Neo.worker.App.loadModule({path});

            return {error: error?.message ?? null, success}
        }, `${FIELD_DRIVER}?still=true&marks=${marks}&theme=${theme}&t=${++driverTick}`);

        expect(result.success, `the field settled: ${result.error}`).toBe(true)
    };

    test('Home before any answer — the team line says no word has come, the plane line says the plane is not connected, over one column of doors and a field without marks', async ({page}) => {
        await bootColdCockpit(page);

        const home = await openHome(page);

        await expect(home.locator('.fm-home-h1')).toHaveText('No word from the team yet');
        await expect(home.locator('.fm-home-h1')).toHaveClass(/is-quiet/);
        await expect(home.locator('.fm-home-plane')).toHaveText('Plane not connected');
        await expect(home.getByRole('button', {name: 'Connect a plane'})).toBeHidden();
        await settleField(page, 'none');
        await expect(home).toHaveScreenshot('home-returning-cold.png')
    });

    test('Home over a live fleet — the team line counts who is up and the plane line is quiet; a packaged shell without a plane gets the product line, the lede in its family, and Connect a plane; both skins', async ({page}) => {
        await bootSettledCockpit(page);

        const
            home    = await openHome(page),
            connect = home.getByRole('button', {name: 'Connect a plane'}),
            family  = selector => home.locator(selector).evaluate(el => getComputedStyle(el).fontFamily);

        await expect(home.locator('.fm-home-h1')).toHaveText(/^\d+ of 11 agents up$/);
        await expect(home.locator('.fm-home-plane'), 'a connected plane is quiet').toBeHidden();
        await expect(home.locator('.fm-home-doors')).toBeVisible();
        await settleField(page, '11');
        await expect(home).toHaveScreenshot('home-returning.png');

        await landShellPlane(page, false);
        await expect(connect).toBeVisible();
        await expect(home.locator('.fm-home-doors')).toBeHidden();
        await expect(home.locator('.fm-home-plane')).toBeHidden();
        // the lede declared no family and inherited the theme's body face, apart from the display line above it
        expect(await family('.fm-home-lede')).toBe(await family('.fm-home-h1'));
        await settleField(page, 'none');
        await expect(home).toHaveScreenshot('home-first-run.png');

        await switchToLightSkin(page);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await settleField(page, 'none', 'light');
        await expect(home).toHaveScreenshot('home-first-run-light.png');

        await landShellPlane(page, null);
        await expect(connect).toBeHidden();
        await settleField(page, '11', 'light');
        await expect(home).toHaveScreenshot('home-returning-light.png')
    });

    test('the cockpit before any answer and after an empty one — cold says "not answered yet", an empty answer offers the first agent; both skins', async ({page}) => {
        // the cold boot: nothing is landed — nothing is seeded, no source has answered
        await bootColdCockpit(page);

        const cockpit = page.locator('.fm-fleet-cockpit');

        await expect(page.locator('.fm-fleet-stale')).toHaveText('not answered yet');
        await expect(page.locator('.fm-stream-state')).toHaveText('not answered yet');
        // an unanswered roster is not an empty fleet: no CTA, no "no activity yet"
        await expect(page.locator('.fm-fleet-empty-cta')).toBeHidden();
        await expect(page.locator('.fm-stream-empty')).toBeHidden();
        await expect(cockpit).toHaveScreenshot('cockpit-cold.png');

        // the fleet answers with nothing: live, and the surfaces' own empty words
        await landFleetRoster(page, []);
        await landFleetActivity(page, []);

        await expect(page.locator('.fm-fleet-head')).toHaveClass(/is-live/);
        await expect(page.locator('.fm-stream-head')).toHaveClass(/is-live/);
        await expect(page.locator('.fm-fleet-empty-cta')).toBeVisible();
        await expect(page.locator('.fm-fleet-empty-cta')).toHaveText('Add your first agent');
        await expect(page.locator('.fm-stream-empty')).toHaveText('no activity yet');
        await expect(page.locator('.fm-agent-card')).toHaveCount(0);
        await expect(cockpit).toHaveScreenshot('cockpit-empty.png');

        await switchToLightSkin(page);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await expect(cockpit).toHaveScreenshot('cockpit-empty-light.png')
    });

    test('every strip and rail pane at 1280 — its head, its inset and its verbs, as the operator reads them', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);
        await landFleetTasks(page, sampleTasks);

        const settle = async () => {
            await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
            await page.mouse.move(0, 0);
            await page.waitForTimeout(400)
        };

        for (const [label, root, golden] of [
            ['Activity', '.fm-activity-stream', 'pane-activity.png'], ['Tasks', '.fm-tasks-pane', 'pane-tasks.png'],
            ['Memories', '.fm-memories-pane', 'pane-memories.png'], ['Mailbox', '.fm-operator-mailbox', 'pane-mailbox.png'],
            ['Catch up', '.fm-catch-up-pane', 'pane-catch-up.png'], ['Golden Path', '.fm-golden-path-pane', 'pane-golden-path.png'],
            ['Perspectives', '.fm-perspectives-pane', 'pane-perspectives.png'], ['Add agent', '.fm-add-agent-form', 'pane-add-agent.png'],
            ['Wake routes', '.fm-wakeroutes-pane', 'pane-wake-routes.png']
        ]) {
            const name  = new RegExp(`^\\s*${label}\\s*$`, 'i'),
                  strip = page.locator('.neo-dashboard-dock-tabs .neo-tab-header-button', {hasText: name}),
                  tab   = await strip.count() ? strip.first() : page.locator('.neo-dashboard-dock-rail-tab', {hasText: name}).first(),
                  pane  = page.locator(`${root}:visible`).first();

            await tab.click();
            await expect(tab, `${label}: the tab took the click`).toHaveClass(/\bpressed\b/, {timeout: 10000});
            await expect(pane).toBeVisible({timeout: 30000});
            await settle();
            await expect(pane, label).toHaveScreenshot(golden)
        }

        // the inspector's section heads, drilled into the first resident
        const detail = page.locator('.fm-agent-detail:visible').first();

        await page.locator('.fm-agent-card').first().click();
        await expect(detail.locator('.fm-detail-pane-head').first()).toBeVisible({timeout: 30000});
        await page.waitForFunction(() => [...document.querySelectorAll('.fm-agent-detail img')].every(img => img.complete), null, {timeout: 10000});
        await settle();
        await expect(detail, 'Agent detail').toHaveScreenshot('pane-agent-detail.png')
    });
});
