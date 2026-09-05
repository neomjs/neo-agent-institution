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
                  // own state line and never runs under the verbs (it once lost "rved" under them)
                  cards    = [...document.querySelectorAll('.fm-agent-card')].map(card => {
                      const word  = rect(card.querySelector('.fm-card-state')),
                            line  = rect(card.querySelector('.fm-card-state-line')),
                            verbs = rect(card.querySelector('.fm-card-control-verbs'));

                      return {
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
        // the scope control paints inside its own box, and the wordmark yields at this band (the
        // logo is the mark, the window title carries "Agent OS", the scope keeps its tail)
        expect(geometry.shell.labelInside, 'the instance label sits inside the switcher box').toBe(true);
        expect(geometry.shell.labelOverTheme, 'the instance label never reaches the theme switch').toBe(0);
        expect(geometry.shell.titleWidth, 'the wordmark yields at the vessel band').toBe(0);
        expect(geometry.cards.length, 'the roster rendered cards to measure').toBeGreaterThan(0);
        for (const card of geometry.cards) {
            expect(card.wordPastLine, 'the state word ends inside its own state line').toBeLessThanOrEqual(0);
            expect(card.wordUnderVerbs, 'the state word never runs under the verbs').toBe(0);
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

        // the first click only makes the config default explicit (the controller assumes light while
        // viewport.theme is unset and sets dark) — click until the light class is on the viewport
        for (let i = 0; i < 3; i++) {
            await page.locator('.agent-theme-button').click();

            if (await page.locator('.agent-os-viewport.neo-theme-neo-light').waitFor({timeout: 2000}).then(() => true, () => false)) {
                break
            }
        }

        const light = await readContrast();
        expect(light.theme, 'the light skin is on the viewport').toBe('neo-theme-neo-light');
        expect(light.contrast, 'the wordmark reads on the light band — it measured 1.04:1 before the ink binding').toBeGreaterThanOrEqual(4.5);
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

    /**
     * @summary Activates the Tasks tab (the south strip's second surface) and waits for the pane's
     * cold spine — the committed sample shape, which since #113 includes the queue's starved
     * waiter (its wait as text, its own cause) and the lease line under the queued head.
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
            document.querySelector('.fm-tasks-pane .fm-tasks-section-head.is-queued').scrollIntoView({block: 'start'});
            // a narrow band wraps the rows taller than the strip is high: keep the head where it fits,
            // and scroll the starved waiter the rest of the way in
            document.querySelector('.fm-tasks-pane .fm-task-state.is-starved').closest('.fm-task-row').scrollIntoView({block: 'nearest'})
        });
        await expect(page.locator('.fm-tasks-pane .fm-task-state.is-starved')).toBeInViewport()
    };

    /** @summary The light skin on the viewport — the wordmark arm's click loop, shared. */
    const switchToLightSkin = async page => {
        for (let i = 0; i < 3; i++) {
            await page.locator('.agent-theme-button').click();

            if (await page.locator('.agent-os-viewport.neo-theme-neo-light').waitFor({timeout: 2000}).then(() => true, () => false)) {
                break
            }
        }

        await expect(page.locator('.agent-os-viewport.neo-theme-neo-light')).toBeVisible();
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
        await openTasksPane(page);

        const geometry = await measureTasksPane(page);

        expect(geometry.noClip, 'nothing clips inside the pane').toBe(true);
        expect(geometry.spill, 'no descendant leaves the pane').toBe(0);
        await expect(page.locator('.fm-tasks-pane')).toHaveScreenshot('tasks-pane-720.png');

        await switchToLightSkin(page);
        await expect(page.locator('.fm-tasks-pane')).toHaveScreenshot('tasks-pane-720-light.png')
    });

    test('the Tasks pane in the 314 vessel window — the narrow-band regime is in force and nothing clips (geometry asserted, no golden)', async ({page}) => {
        // The south strip hands the pane 224–243 CSS px here depending on whether the region grew a
        // scrollbar (measured across runs), which is why this is a geometry witness and not a golden:
        // a pixel comparator would only bless whichever width it saw first. Both widths sit inside
        // the pane's narrow-band regime (its own width-query context, ≤ 300), so the rule that makes
        // the name lead on its own line must be in force, and nothing may leave the border.
        await page.setViewportSize({width: 314, height: 900});
        await bootSettledCockpit(page);
        await openTasksPane(page);

        const geometry = await measureTasksPane(page),
              narrow   = await page.evaluate(() => getComputedStyle(document.querySelector('.fm-tasks-pane .fm-task-state.is-starved').closest('.fm-task-row').querySelector('.fm-task-name')).order);

        expect(geometry.width, JSON.stringify(geometry)).toBeLessThanOrEqual(300);
        expect(narrow, 'the narrow-band rule leads with the name').toBe('-1');
        expect(geometry.noClip, JSON.stringify(geometry)).toBe(true);
        expect(geometry.spill, JSON.stringify(geometry)).toBe(0)
    });

    test('the Tasks pane in the 240 px band — the sketch\'s Frame 4 pinned: name first, time · state second, the wait and the cause whole; both skins (#113)', async ({page}) => {
        // The band is the pane's OWN width-query context (#113 at d95fce7), so it is pinned through
        // the pane's inline size where the strip is wide enough to honour it exactly — through a
        // stylesheet, never an inline style: the vdom owns the element's `style` and rewrites it on
        // the next liveness render, which is how a pixel golden would silently capture the full strip.
        await page.setViewportSize({width: 720, height: 900});
        await bootSettledCockpit(page);
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
});
