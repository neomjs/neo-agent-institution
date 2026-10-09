import {test, expect} from '@playwright/test';
import {landAgentDefinitions, landBrainHealth, landFleetActivity, landFleetOpenWork, landFleetRoster, landFleetSample, landFleetTasks} from '../fixtures.mjs';
import {sampleDefinitions, sampleOpenWork, sampleRoster, sampleTasks} from '../fixture/fleetSample.mjs';
import {MACHINES, TRUSTED, installPinnedSetupShell, pinnedSetupHost} from '../fixture/pinnedSetupHost.mjs';

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
        await installBarMeasures(page)
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
        await installBarMeasures(page)
    };

    /**
     * Installs the bar's shared measures, read by the narrow arms below. The fleet head's no-clip
     * geometry: a legend that hides its last states says those states do not exist, so every band
     * asserts scrollWidth inside clientWidth and the last swatch inside the row. The banner's lead:
     * its text, its line, and whether its ellipsis is cutting it (`null` while no lead renders).
     * @param {Object} page
     */
    const installBarMeasures = async page => {
        await page.evaluate(() => {
            globalThis.__fmMeasureBannerLead = () => {
                const lead = document.querySelector('.fm-spine-banner-lead');

                if (!lead) return null;

                const style = getComputedStyle(lead),
                      line  = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;

                return {
                    clipped: lead.scrollWidth > lead.clientWidth,
                    oneLine: style.whiteSpace === 'nowrap' && lead.getBoundingClientRect().height <= line + 1,
                    text   : lead.textContent,
                    width  : Math.round(lead.clientWidth)
                }
            };

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

    test('the lane claim reads on its card, while a wired empty lane says so', async ({page}) => {
        await bootSettledCockpit(page);

        const laneLine = 'control-plane state synchronization for source-alpha continuation',
              laneClaimedAt = new Date(Date.now() - 12 * 60_000).toISOString();

        await landFleetRoster(page, sampleRoster.map((row, index) => index < 2 ? {
            ...row,
            laneLine     : index === 0 ? laneLine : null,
            laneClaimedAt: index === 0 ? laneClaimedAt : null,
            sources      : {
                ...row.sources,
                lane: {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', reason: null}
            }
        } : row));

        const card = row => page.locator('.fm-agent-card', {
            has: page.getByRole('img', {name: row.displayName, exact: true})
        });

        await expect(card(sampleRoster[0]).locator('.fm-card-lane')).toContainText('source-alpha continuation · claimed 12m ago');
        await expect(card(sampleRoster[1]).locator('.fm-card-lane')).toHaveText('no lane claimed');
        await expect(card(sampleRoster[0])).toHaveScreenshot('fleet-card-lane-claim.png');
        await expect(card(sampleRoster[1])).toHaveScreenshot('fleet-card-lane-empty.png')
    });

    test('the open work reads on the cards it waits on, and the merge queue sits after the bar; both skins', async ({page}) => {
        await bootSettledCockpit(page);
        await landFleetOpenWork(page, sampleOpenWork);

        const head = page.locator('.fm-fleet-head'),
              card = displayName => page.locator('.fm-agent-card', {
                  has: page.getByRole('img', {name: displayName, exact: true})
              });

        await expect(head.locator('.fm-awaiting-merge')).toHaveText('2 awaiting merge');
        await expect(card('Grace').locator('.fm-card-open-work')).toHaveText('2 PRs · red');
        await expect(card('Euclid').locator('.fm-card-open-work')).toHaveText('1 PR · changes requested');
        await expect(card('Vega').locator('.fm-card-open-work')).toHaveText('1 PR · review due');
        await expect(card('Ada').locator('.fm-card-open-work'), 'nothing held: no chip').toBeHidden();
        await expect(head).toHaveScreenshot('fleet-head-awaiting-merge.png');
        await expect(card('Grace')).toHaveScreenshot('fleet-card-open-work.png');

        await switchToLightSkin(page);
        await expect(head).toHaveScreenshot('fleet-head-awaiting-merge-light.png');
        await expect(card('Grace')).toHaveScreenshot('fleet-card-open-work-light.png')
    });

    test('the merge queue opens to rows named by their titles, two lines at most', async ({page}) => {
        await bootSettledCockpit(page);
        await landFleetOpenWork(page, sampleOpenWork);

        const menu = page.locator('.fm-awaiting-merge-menu'),
              refs = menu.locator('.fm-awaiting-merge-ref');

        await page.locator('.fm-fleet-head .fm-awaiting-merge').click();
        await expect(refs).toHaveText([/^#19499 · feat\(fleet\): a seat records/, 'neomjs/neo-agent-brain #799']);

        // the fixture title needs more than two lines; the row shows two, the height of two untitled rows
        const [titled, untitled] = await refs.evaluateAll(nodes => nodes.map(node => ({client: node.clientHeight, scroll: node.scrollHeight})));

        expect(titled.scroll).toBeGreaterThan(titled.client);
        expect(Math.round(titled.client / untitled.client)).toBe(2);
        await expect(menu).toHaveScreenshot('fleet-head-merge-queue-open.png')
    });

    test('the Seat group reads derived, declared, the app\'s own, a declaration against what the config reads, and a refused start; the card reads that refusal as its reason; both skins (#559)', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);

        const
            configured = {model: 'gpt-6-luna', reasoningEffort: 'high'},
            // Sophie's seat, on its monogram: no live avatar joins the suite; no engine tag either, which no
            // production roster row carries yet, so the refused card names one model
            roster     = facts => landFleetRoster(page, [...sampleRoster, {
                ...sampleRoster.find(row => row.agentId === 'neo-gpt-emmy'),
                agentId: 'neo-gpt-sophie', githubUsername: 'neo-gpt-sophie', displayName: 'Sophie', avatarUrl: null, engineTag: null, harnessSettings: configured, ...facts
            }]),
            define     = facts => landAgentDefinitions(page, sampleDefinitions.map(row => row.id === 'neo-gpt-sophie' ? {...row, ...facts} : row)),
            card       = name => page.locator('.fm-agent-card', {hasText: name}),
            detail     = page.locator('.fm-agent-detail:visible').first(),
            group      = detail.locator('.fm-seat-model'),
            modelLine  = group.locator('.fm-seat-model-line').first(),
            settle     = async () => {
                await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                await page.mouse.move(0, 0);
                await page.waitForTimeout(400)
            },
            open       = async name => {
                await card(name).click();
                await detail.getByRole('tab', {name: 'Configuration', exact: true}).click();
                await expect(group).toBeVisible({timeout: 30000})
            };

        await roster({state: 'off'});
        await define({});
        await open('Sophie');

        for (const [facts, line, golden] of [
            [{},                                             'derived · reads gpt-6-luna (configured on disk)',                                    'seat-model-derived.png'],
            [configured,                                     'declared gpt-6-luna',                                                                'seat-model-declared.png'],
            [{model: 'gpt-6-sol', reasoningEffort: 'max'},   'declared gpt-6-sol · reads gpt-6-luna (configured on disk) · applies at next start', 'seat-model-differs-stopped.png']
        ]) {
            await define(facts);
            await expect(modelLine).toHaveText(line);
            await settle();
            await expect(group, line).toHaveScreenshot(golden)
        }

        // a running seat reads the same sentence: the harness reads its config when it launches
        await roster({state: 'ok'});
        await expect(modelLine).toHaveText('declared gpt-6-sol · reads gpt-6-luna (configured on disk) · applies at next start');

        // Desktop leaves its model to the app and offers an effort declaration before the first Start.
        await open('Ada');
        await expect(modelLine).toHaveText('set per session in the app · not read back yet');
        await expect(group.locator('.fm-seat-model-line').nth(1)).toHaveText('app default');
        await settle();
        await expect(group).toHaveScreenshot('seat-model-app.png');

        await group.locator('.fm-seat-model-row').nth(1).locator('.fm-seat-model-change').click();
        await expect(group.locator('.fm-seat-model-offer .fm-chip')).toHaveText(['Low', 'Medium', 'High', 'Extra', 'Max', 'Use app default']);
        await settle();
        await expect(group).toHaveScreenshot('seat-model-app-effort.png');

        // a start refused for the declared model: the card's line is the reason, and the row it sends the operator to
        await define({model: 'gpt-6-astra', reasoningEffort: null});
        await roster({state: 'off', seatModel: {state: 'refused', model: 'gpt-6-astra', reasoningEffort: null, reason: 'model gpt-6-astra is not available'}});
        await expect(card('Sophie').locator('.fm-card-control-status')).toHaveText('start refused: model gpt-6-astra is not available');
        await settle();
        await expect(card('Sophie')).toHaveScreenshot('fleet-card-model-refused.png');

        await open('Sophie');
        await expect(modelLine).toHaveText('declared gpt-6-astra · start refused: model gpt-6-astra is not available');
        await settle();
        await expect(group).toHaveScreenshot('seat-model-refused.png');

        await switchToLightSkin(page);
        await settle();
        await expect(card('Sophie')).toHaveScreenshot('fleet-card-model-refused-light.png');

        await define({model: 'gpt-6-sol', reasoningEffort: 'max'});
        await roster({state: 'off'});
        await expect(modelLine).toHaveText('declared gpt-6-sol · reads gpt-6-luna (configured on disk) · applies at next start');
        await settle();
        await expect(group).toHaveScreenshot('seat-model-differs-stopped-light.png');

        await open('Ada');
        await group.locator('.fm-seat-model-row').nth(1).locator('.fm-seat-model-change').click();
        await expect(group.locator('.fm-seat-model-offer .fm-chip')).toHaveText(['Low', 'Medium', 'High', 'Extra', 'Max', 'Use app default']);
        await settle();
        await expect(group).toHaveScreenshot('seat-model-app-effort-light.png')
    });

    test('the Seat group\'s Memory row: no choice recorded reads as that, the choice opens in Add\'s list and names the chosen folder under Details, a recorded consent reads back; both skins (#572)', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);

        const
            source = '/home/operator/.claude/projects/-work/memory',
            card   = name => page.locator('.fm-agent-card', {hasText: name}),
            detail = page.locator('.fm-agent-detail:visible').first(),
            group  = detail.locator('.fm-seat-model'),
            row    = group.locator('.fm-seat-memory'),
            line   = row.locator('.fm-seat-model-line'),
            define = facts => landAgentDefinitions(page, sampleDefinitions.map(row => row.id === 'neo-gpt-sophie' ? {...row, ...facts} : row)),
            settle = async () => {
                await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                await page.mouse.move(0, 0);
                await page.waitForTimeout(400)
            },
            // the choice opens on two candidates; picking one names its folder under Details, opened for the capture
            choose = async () => {
                const loaded = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${SEAT_MEMORY_DRIVER}?state=candidates&t=${++driverTick}`);

                expect(loaded.success, `the driver loaded: ${JSON.stringify(loaded)}`).toBe(true);
                await expect(group.locator('.fm-seat-memory-offer')).toBeVisible();
                await row.locator('.neo-list-item', {hasText: 'Mnemosyne'}).click();
                await row.locator('.fm-seat-memory-details summary').click();
                await expect(row.locator('.fm-seat-memory-source')).toHaveText(source)
            };

        await landFleetRoster(page, [...sampleRoster, {
            ...sampleRoster.find(row => row.agentId === 'neo-gpt-emmy'),
            agentId: 'neo-gpt-sophie', githubUsername: 'neo-gpt-sophie', displayName: 'Sophie', avatarUrl: null, engineTag: null, state: 'off'
        }]);
        await define({});
        await card('Sophie').click();
        await detail.getByRole('tab', {name: 'Configuration', exact: true}).click();
        await expect(group).toBeVisible({timeout: 30000});

        await expect(line).toHaveText('no import choice recorded');
        // the open choice outgrows the inspector's fold, so it is captured as its own row
        await choose();
        await settle();
        await expect(row).toHaveScreenshot('seat-memory-choice.png');

        // a recorded consent arrives as a new definitions Store: another binding, so the choice folds and the line reads it
        await define({memoryImport: source});
        await expect(line).toHaveText(`recorded: import the memory at ${source}`);
        await expect(group.locator('.fm-seat-memory-change')).toHaveText('Change');
        await expect(group.locator('.fm-seat-memory-offer')).toBeHidden();
        await settle();
        await expect(group).toHaveScreenshot('seat-memory-recorded.png');

        await switchToLightSkin(page);
        await define({});
        await choose();
        await settle();
        await expect(row).toHaveScreenshot('seat-memory-choice-light.png')
    });

    test('the Participation group: benched with the operator\'s date and reason, unobserved with the read\'s reason, active with the bench command, and no command on the shell\'s own plan; the benched seat\'s Start closed in the Fleet\'s words; both skins (#568)', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);

        const
            refusal = 'the seat is benched by the operator: its participation is operator_benched',
            benched = {participationStatus: 'operator_benched', participationReason: 'the preview model behind this chair ended', participationSince: '2026-07-01T00:00:00.000Z', participationRead: {state: 'read'}, launchRefusal: refusal},
            card    = page.locator('.fm-agent-card', {hasText: 'Sophie'}),
            detail  = page.locator('.fm-agent-detail:visible').first(),
            group   = detail.locator('.fm-participation'),
            line    = group.locator('.fm-participation-line'),
            land    = facts => landFleetRoster(page, [...sampleRoster, {
                ...sampleRoster.find(row => row.agentId === 'neo-gpt-emmy'),
                agentId: 'neo-gpt-sophie', githubUsername: 'neo-gpt-sophie', displayName: 'Sophie', avatarUrl: null, engineTag: null, state: 'off', ...facts
            }]),
            plane   = async base => {
                const loaded = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${SHELL_PLANE_DRIVER}?base=${encodeURIComponent(base ?? '')}&t=${++driverTick}`);

                expect(loaded.success, `the driver loaded: ${JSON.stringify(loaded)}`).toBe(true)
            },
            settle  = async () => {
                await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                await page.mouse.move(0, 0);
                await page.waitForTimeout(400)
            };

        await land(benched);
        await expect(card.locator('.fm-card-action').first()).toHaveAttribute('title', refusal);
        await settle();
        await expect(card).toHaveScreenshot('participation-card-benched.png');

        await card.click();
        await detail.getByRole('tab', {name: 'Configuration', exact: true}).click();
        await expect(line).toHaveText('benched since 2026-07-01 — the preview model behind this chair ended', {timeout: 30000});

        // the shell's own plan names no plane: the group says why it offers no command
        await expect(group.locator('.fm-participation-place')).toHaveText('No command is offered: this view cannot name where the plane\'s Memory Core runs.');
        await settle();
        await expect(group).toHaveScreenshot('participation-own-plan.png');

        // attached to this machine's plane: the command, and where its Memory Core runs
        await plane('http://127.0.0.1:3102');
        await expect(group.locator('.fm-participation-command')).toHaveText('node ai/scripts/fleet/participation.mjs activate --identity @neo-gpt-sophie --apply');
        await settle();
        await expect(group).toHaveScreenshot('participation-benched.png');

        // a re-read in place: the group re-seats without a restart
        await land({participationStatus: null, participationRead: {state: 'unread', reason: 'presence unreadable'}, launchRefusal: null});
        await expect(line).toHaveText('unobserved — presence unreadable');
        await settle();
        await expect(group).toHaveScreenshot('participation-unobserved.png');

        await land({participationStatus: 'active', participationRead: {state: 'read'}, launchRefusal: null});
        await expect(group.locator('.fm-participation-command')).toHaveText('node ai/scripts/fleet/participation.mjs bench --identity @neo-gpt-sophie --reason "<why>" --apply');
        await settle();
        await expect(group).toHaveScreenshot('participation-active.png');

        await switchToLightSkin(page);
        await land(benched);
        await expect(line).toHaveText('benched since 2026-07-01 — the preview model behind this chair ended');
        await settle();
        await expect(group).toHaveScreenshot('participation-benched-light.png')
    });

    test('a running seat whose working checkout the last start did not prepare reads skills not verified on its card; Detail\'s Repository pane reads each checkout\'s preparation, a long failure whole and parallel installs as this start; both skins (#610)', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);

        const
            npm     = 'npm ci exited 1: npm error code ERESOLVE · npm error ERESOLVE unable to resolve dependency tree · While resolving: neo-agent-brain@0.0.0 · Found: neo.mjs@13.1.0 · Could not resolve dependency: peer neo.mjs@"^13.2.0" from neo-agent-skills@0.1.30',
            settled = [
                {repoSlug: 'neomjs/neo',                   state: 'skipped', reason: 'skipped during the install'},
                {repoSlug: 'neomjs/neo-agent-brain',       state: 'failed',  reason: npm},
                {repoSlug: 'neomjs/neo-agent-institution', state: 'installed'}
            ],
            // the Start's three installs run in parallel: two still running, one already done
            live    = [
                {repoSlug: 'neomjs/neo',                   state: 'installing'},
                {repoSlug: 'neomjs/neo-agent-brain',       state: 'installing'},
                {repoSlug: 'neomjs/neo-agent-institution', state: 'present'}
            ],
            emmy    = sampleRoster.find(row => row.agentId === 'neo-gpt-emmy'),
            // Fleet runs this seat: a wired runtime, so the card reads it working rather than offline. The
            // repository status stays unwired, so the pane's freshness pill carries no clock into the golden
            sources = {...emmy.sources, runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}},
            land    = facts => landFleetRoster(page, [...sampleRoster, {
                ...emmy,
                agentId: 'neo-gpt-sophie', githubUsername: 'neo-gpt-sophie', displayName: 'Sophie', avatarUrl: null, engineTag: null,
                repoSlug: 'neomjs/neo', repoPath: '/Users/Shared/agents/neo-gpt-sophie/neomjs/neo', sources, ...facts
            }]),
            card    = page.locator('.fm-agent-card', {hasText: 'Sophie'}),
            detail  = page.locator('.fm-agent-detail:visible').first(),
            pane    = detail.locator('.fm-detail-pane-repo'),
            head    = pane.locator('.fm-detail-repo-prep-head'),
            // a reason wraps whole: neither the pane nor a row is wider than its own box
            noClip  = () => pane.evaluate(node => [node, ...node.querySelectorAll('.fm-repository-list .neo-list-item, .fm-repo-reason')].every(el => el.scrollWidth <= el.clientWidth + 1)),
            settle  = async () => {
                await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                await page.mouse.move(0, 0);
                await page.waitForTimeout(400)
            };

        await land({state: 'ok', dependencyOutcomes: settled});
        await expect(card.locator('.fm-card-state')).toHaveText('working');
        await expect(card.locator('.fm-card-control-status')).toHaveText('skills not verified');
        await settle();
        await expect(card).toHaveScreenshot('fleet-card-skills-unverified.png');

        await card.click();
        await expect(head).toHaveText('Preparation · last start', {timeout: 30000});
        await expect(pane.locator('.fm-repo-reason').nth(1)).toHaveText(npm);
        expect(await noClip(), 'the long failure wraps whole inside the pane').toBe(true);
        await settle();
        await expect(pane).toHaveScreenshot('detail-repo-preparation.png');

        await land({state: 'off', dependencyOutcomes: live});
        await expect(head).toHaveText('Preparation · this start');
        await settle();
        await expect(pane).toHaveScreenshot('detail-repo-preparation-live.png');

        await switchToLightSkin(page);
        await land({state: 'ok', dependencyOutcomes: settled});
        await expect(head).toHaveText('Preparation · last start');
        await settle();
        await expect(pane).toHaveScreenshot('detail-repo-preparation-light.png');
        await expect(card).toHaveScreenshot('fleet-card-skills-unverified-light.png')
    });

    test('a Start the Fleet reports installing: the card counts it and its power verb cancels it; the Repository pane offers Skip with its consequence once the wire has the verb; both skins (#616)', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);

        const
            emmy    = sampleRoster.find(row => row.agentId === 'neo-gpt-emmy'),
            sources = {...emmy.sources, runtime: {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}},
            live    = [
                {repoSlug: 'neomjs/neo',                   state: 'installing'},
                {repoSlug: 'neomjs/neo-agent-brain',       state: 'installed'},
                {repoSlug: 'neomjs/neo-agent-institution', state: 'installing'}
            ],
            land    = () => landFleetRoster(page, [...sampleRoster, {
                ...emmy,
                agentId: 'neo-gpt-sophie', githubUsername: 'neo-gpt-sophie', displayName: 'Sophie', avatarUrl: null, engineTag: null,
                repoSlug: 'neomjs/neo', repoPath: '/Users/Shared/agents/neo-gpt-sophie/neomjs/neo', sources, state: 'off', dependencyOutcomes: live
            }]),
            card    = page.locator('.fm-agent-card', {hasText: 'Sophie'}),
            detail  = page.locator('.fm-agent-detail:visible').first(),
            pane    = detail.locator('.fm-detail-pane-repo'),
            settle  = async () => {
                await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                await page.mouse.move(0, 0);
                await page.waitForTimeout(400)
            };

        await land();
        await expect(card.locator('.fm-card-control-status')).toHaveText('start… preparing dependencies (1/3 done)');
        await expect(card.locator('.fm-card-state')).toHaveText('starting');
        await expect(card.getByRole('button', {name: 'Cancel start Sophie'})).toBeEnabled();
        await settle();
        await expect(card).toHaveScreenshot('fleet-card-preparing.png');

        // the verb arrives with a newer pin; the pane reads the wire when it renders, so the roster lands again
        const loaded = await page.evaluate(path => Neo.worker.App.loadModule({path}), `${SKIP_WIRE_DRIVER}?t=${++driverTick}`);

        expect(loaded.success, `the driver loaded: ${JSON.stringify(loaded)}`).toBe(true);
        await card.click();
        await land();
        await expect(pane.locator('.fm-detail-repo-skip')).toHaveText('Skip remaining preparation', {timeout: 30000});
        await expect(pane.locator('.fm-detail-repo-skip-note')).toContainText('The seat launches without waiting');
        await settle();
        await expect(pane).toHaveScreenshot('detail-repo-skip.png');

        await switchToLightSkin(page);
        await settle();
        await expect(pane).toHaveScreenshot('detail-repo-skip-light.png');
        await expect(card).toHaveScreenshot('fleet-card-preparing-light.png')
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
                lead          : globalThis.__fmMeasureBannerLead(),
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
        // the mark stays, the lead keeps the reason on one visible line, and title + aria repeat it
        expect(geometry.banner.fontSize, 'the state word retracts in the mark regime').toBe('0px');
        expect(geometry.banner.scrollWidth, 'no hidden pressure: the mark never overflows its box').toBeLessThanOrEqual(geometry.banner.clientWidth);
        expect(geometry.lead?.text, 'the reason stays visible beside the mark').toBe('Fleet server offline');
        expect(geometry.lead.width, 'the lead keeps a line to read').toBeGreaterThan(0);
        expect(geometry.lead.oneLine, 'the lead never wraps').toBe(true);
        expect(geometry.banner.title, 'the title repeats the lead').toContain('Fleet server offline');
        expect(geometry.banner.ariaLabel, 'the aria mirror carries the sentence').toContain('Fleet server offline');
        // the collapse order's last clause: action labels drop to glyphs
        expect(geometry.startTextShown, 'action labels drop to their glyphs').toBe('none');
        expect(geometry.startRight, 'Start fleet stays inside the band').toBeLessThanOrEqual(geometry.viewport);

        await expect(page).toHaveScreenshot('cockpit-intermediate-720.png')
    });

    /**
     * The four answers a plane gives a shell it refuses, as the shell's lifecycle owner reports a typed
     * boot refusal: the cause and, as its detail, the plane's address. They are the row 5 walk's provocations.
     * @type {Object[]}
     */
    const PLANE_REFUSAL_FRAMES = [
        {golden: 'banner-plane-unreachable.png', source: 'plane-unreachable',        word: 'plane unreachable'},
        {golden: 'banner-pat-refused.png',       source: 'plane-credential-refused', word: 'pat refused'},
        {golden: 'banner-account-changed.png',   source: 'plane-identity-changed',   word: 'account changed'},
        {golden: 'banner-not-a-plane.png',       source: 'plane-not-a-plane',        word: 'not a plane'}
    ];

    /**
     * The refused plane's address, which only the title may carry.
     * @type {String}
     */
    const REFUSING_PLANE = 'https://plane.neo.test:8443';

    /**
     * @summary Lands one typed boot refusal and waits for the bar to read it: the pill's word and Connect.
     * @param {Object} page
     * @param {String} source The refusal's cause code
     * @param {String} word The pill's status word for it
     */
    const landPlaneRefusal = async (page, source, word) => {
        await landBrainHealth(page, {cause: {detail: REFUSING_PLANE, observedAt: 0, source}, state: 'degraded'});
        await expect(page.locator('.fm-spine-banner')).toHaveText(word);
        await expect(page.locator('.fm-reconnect-button')).toHaveText('Connect')
    };

    /**
     * @summary Reads the bar's state block for a refusal: the lead's line and the title and aria that repeat it.
     * @param {Object} page
     * @returns {Promise<Object>}
     */
    const readRefusal = page => page.evaluate(() => {
        const banner = document.querySelector('.fm-spine-banner'),
              wake   = document.querySelector('.fm-viewer-wake'),
              cut    = el => el ? el.scrollWidth > el.clientWidth : null;

        return {
            ariaLabel: banner.getAttribute('aria-label') || '',
            buttons  : [...document.querySelectorAll('.fm-cockpit-bar > .neo-button')].map(el => Math.round(el.getBoundingClientRect().width)),
            fontSize : getComputedStyle(banner).fontSize,
            lead     : globalThis.__fmMeasureBannerLead(),
            pillCut  : cut(banner),
            title    : banner.getAttribute('title') || '',
            wakeCut  : cut(wake),
            wakeFont : wake ? getComputedStyle(wake).fontSize : null,
            wakeLive : wake ? wake.classList.contains('fm-viewer-wake-live') : null
        }
    });

    test('the four plane refusals — the pill names the state, the lead beside it says why and what Connect fixes, the title repeats it with the address; wide, light, and the mark regime (#533)', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootColdCockpit(page);

        const bar   = page.locator('.fm-cockpit-bar'),
              wides = {};

        for (const {golden, source, word} of PLANE_REFUSAL_FRAMES) {
            await landPlaneRefusal(page, source, word);

            const read = await readRefusal(page);

            expect(read.lead?.text, `${word}: the lead says why, and what connecting fixes`).toMatch(/\bconnect\b/i);
            expect(read.lead.text, `${word}: the lead carries no address and no code`).not.toMatch(/plane\.neo\.test|plane-[a-z]/);
            expect(read.lead.oneLine, `${word}: the lead is one line`).toBe(true);
            expect(read.lead.clipped, `${word}: at the design width the lead reads whole`).toBe(false);
            expect(read.pillCut, `${word}: the pill keeps its word`).toBe(false);
            expect(read.title, `${word}: the title repeats the lead`).toContain(read.lead.text);
            expect(read.title, `${word}: the address rides the title only`).toContain(REFUSING_PLANE);
            expect(read.ariaLabel, `${word}: the aria mirror is the title`).toBe(read.title);

            wides[source] = read;
            await expect(bar).toHaveScreenshot(golden)
        }

        // just above the marks step the lead is the row's slack: it ellipsizes, while the longest pill
        // word, the wake pill and every button keep their width
        await page.setViewportSize({width: 821, height: 800});
        await landPlaneRefusal(page, 'plane-unreachable', 'plane unreachable');
        await expect.poll(() => readRefusal(page).then(read => read.lead?.clipped), {message: 'the lead ellipsizes first', timeout: 10000}).toBe(true);

        const squeezed = await readRefusal(page);

        expect(squeezed.lead.width, 'the lead keeps a line to read').toBeGreaterThan(0);
        expect(squeezed.pillCut, 'the pill keeps its word').toBe(false);
        expect(squeezed.wakeCut, 'the wake pill keeps its word').toBe(false);
        expect(squeezed.buttons, 'every button keeps its width').toEqual(wides['plane-unreachable'].buttons);

        await page.setViewportSize({width: 1280, height: 800});
        await landPlaneRefusal(page, 'plane-credential-refused', 'pat refused');
        await switchToLightSkin(page);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await expect(bar).toHaveScreenshot('banner-pat-refused-light.png');

        // the mark regime: the fleet pill retracts to its mark and its lead keeps one truncated line;
        // no non-live state is a bare mark, so a degraded wake chip, which has no lead, keeps its word
        await page.setViewportSize({width: 720, height: 900});
        await expect.poll(() => readRefusal(page).then(read => read.fontSize), {message: 'the pill drops to its mark', timeout: 10000}).toBe('0px');

        const narrow = await readRefusal(page);

        expect(narrow.lead?.width, 'the reason keeps a visible line beside the mark').toBeGreaterThan(0);
        expect(narrow.lead.oneLine, 'the narrow lead never wraps').toBe(true);
        expect(narrow.title, 'the title still carries the whole sentence').toContain(narrow.lead.text);
        expect(narrow.wakeLive, 'the fixture wake is degraded').toBe(false);
        expect(narrow.wakeFont, 'a degraded wake keeps its word in the mark regime').not.toBe('0px');
        expect(narrow.wakeCut, 'and the word reads whole').toBe(false);

        await expect(bar).toHaveScreenshot('banner-pat-refused-light-720.png')
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

    /**
     * Opens Accounts over the tests' sample definitions, landed as the registry's answer, and waits
     * out the rail tab's tooltip: it opens over this surface, so dwell until it has shown, leave, and
     * wait out its hide.
     * @param {Object} page
     */
    const openAccounts = async page => {
        await landAgentDefinitions(page);
        await page.locator('.agent-shell').getByText('Accounts', {exact: true}).click();
        await expect(page.locator('.agent-panel-accounts')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-accounts-list .neo-list-item')).toHaveCount(3);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500)
    };

    test('the Accounts surface — the inherited design-gate golden, under harness refresh semantics', async ({page}) => {
        await bootSettledCockpit(page);
        await openAccounts(page);

        // The card's class is fm-agent-config-card (introduced by the define-agent config-card
        // re-skin); the older reference-only `.agent-config-card` selector went stale with it.
        await expect(page.locator('.fm-agent-config-card')).toBeVisible();

        await expect(page.locator('.agent-panel-accounts')).toHaveScreenshot('accounts-config-surface.png')
    });

    // At both common window sizes no Accounts control is clipped and nothing scrolls
    // sideways — the master-detail columns, the card with its product chips, and the add-agent form.
    for (const [width, height] of [[1000, 640], [1280, 800]]) {
        test(`the Accounts surface at ${width}×${height} — no clipped control, no sideways scroll (viewport capture, geometry asserted)`, async ({page}) => {
            await page.setViewportSize({width, height});
            await bootSettledCockpit(page);
            await openAccounts(page);

            const measure = () => page.evaluate(() => {
                const
                    panel    = document.querySelector('.agent-panel-accounts'),
                    bounds   = panel.getBoundingClientRect(),
                    // the layout boxes this view owns; the engine's own clipping boxes (a button's
                    // ripple, a hidden field trigger) are deliberate and stay out of the census
                    boxes    = ['.fm-accounts-master', '.fm-accounts-list', '.fm-accounts-detail', '.fm-agent-config-card', '.fm-agent-repos-card', '.fm-add-agent-form']
                        .map(selector => panel.querySelector(selector)),
                    controls = [...panel.querySelectorAll('.neo-button, .fm-chip, input, .neo-list-item')]
                        .filter(node => node.getClientRects().length);

                return {
                    // holding more width than it shows: scrolled sideways, or cut off by an engine
                    // container's `overflow: hidden` — either hides content from the operator
                    overflowing: [document.documentElement, panel, ...boxes]
                        .filter(node => node?.getClientRects().length && node.scrollWidth > node.clientWidth + 1)
                        .map(node => node.className.split(' ')[0] || node.tagName),
                    clipped    : controls.filter(node => {
                        const rect = node.getBoundingClientRect();
                        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
                    }).map(node => node.textContent.trim() || node.className)
                }
            });

            expect(await measure()).toEqual({overflowing: [], clipped: []});
            await expect(page).toHaveScreenshot(`accounts-${width}x${height}.png`);

            // the add form, in the same frame
            await page.locator('.fm-accounts-add').click();
            await expect(page.locator('.agent-panel-accounts .fm-add-agent-form')).toBeVisible();
            await page.mouse.move(0, 0);

            expect(await measure()).toEqual({overflowing: [], clipped: []});
            await expect(page).toHaveScreenshot(`accounts-adding-${width}x${height}.png`);

            // a GitLab account adds its instance field to the same form, and still nothing clips
            await page.locator('.agent-panel-accounts .fm-add-forge-row .fm-chip', {hasText: 'GitLab'}).click();
            await expect(page.locator('.agent-panel-accounts .fm-add-agent-form input[name="forgeHost"]')).toBeVisible();
            await page.mouse.move(0, 0);

            expect(await measure()).toEqual({overflowing: [], clipped: []});
            await expect(page).toHaveScreenshot(`accounts-adding-gitlab-${width}x${height}.png`)
        })
    }

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

    /**
     * The Add agent memory driver, resolved the way {@link GOLDEN_PATH_DRIVER} is.
     * @type {String}
     */
    const ADD_AGENT_MEMORY_DRIVER = '../../../../test/playwright/visual/addAgentMemory.driver.mjs';

    /**
     * The Seat group's Memory row driver, resolved the way {@link GOLDEN_PATH_DRIVER} is.
     * @type {String}
     */
    const SEAT_MEMORY_DRIVER = '../../../../test/playwright/visual/seatMemory.driver.mjs';

    /**
     * The shell-plane driver, resolved the way {@link GOLDEN_PATH_DRIVER} is: it attaches the views to a plane.
     * @type {String}
     */
    const SHELL_PLANE_DRIVER = '../../../../test/playwright/visual/shellPlane.driver.mjs';

    /**
     * The Skip-verb driver, resolved the way {@link GOLDEN_PATH_DRIVER} is: it puts the verb a newer pin adds on the wire.
     * @type {String}
     */
    const SKIP_WIRE_DRIVER = '../../../../test/playwright/visual/skipWire.driver.mjs';

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
     * @param {RegExp|String} currency The complete words that envelope must produce (the head keeps them behind Details)
     * @param {String} [select] The qualified id to select
     */
    const feedObservatory = async (page, state, currency, select) => {
        const
            query  = `state=${state}${select ? `&select=${encodeURIComponent(select)}` : ''}&t=${++driverTick}`,
            result = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${GRAPH_SCENE_DRIVER}?${query}`);

        expect(result.success, `the driver loaded: ${JSON.stringify(result)}`).toBe(true);
        await expect(page.locator('.fm-observatory-pane .fm-observatory-details')).toHaveText(currency);
        await page.waitForTimeout(600)
    };

    test('the Observatory pane — a read draws its density wells, the nodes in no well in a faint halo, and the route as an overlay of rank beacons the toggle removes; a selection lights its neighbourhood; a budget cut names the budget; a scene without a route and an unavailable read leave the surface clean; both skins', async ({page}) => {
        const
            pane    = page.locator('.fm-observatory-pane'),
            toggle  = pane.getByRole('button', {name: 'Route'}),
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
        await expect(pane.locator('.fm-observatory-details')).toHaveText(/ · partial, budget 150 nodes \/ 300 edges \/ 32 KiB · route withheld · freshness-sla-breached$/);
        await expect(toggle, 'the control says so without a hover').toHaveText('Route · withheld');
        await expect(pane).toHaveScreenshot('observatory-pane-withheld-light.png');
        await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${GOLDEN_PATH_DRIVER}?state=current&t=${++driverTick}`);
        await expect(pane.locator('.fm-observatory-details')).toHaveText(/ \/ 32 KiB$/);

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
        await expect(pane.locator('.fm-observatory-details')).toHaveText(lensed);
        await rest();
        await expect(pane).toHaveScreenshot('observatory-pane-lens.png');

        await peer('@neo-opus-vega').click();
        await peer('@neo-opus-grace').click();
        await heat.click();
        await expect(pane.locator('.fm-observatory-details')).toHaveText(/ · complete · heat · last 3 days · 2 unknown$/);
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
        await expect(pane.locator('.fm-observatory-details')).toHaveText(lensed);
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
            // one section opens to the panel's height at a time; its head opens it
            teamHead  = pane.getByRole('button', {name: /^Team/}),
            nodesHead = pane.getByRole('button', {name: /^Nodes/}),
            label     = pane.locator('.fm-observatory-selected-label'),
            currency  = pane.locator('.fm-observatory-currency'),
            details   = pane.locator('.fm-observatory-details'),
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

        // View sits first: opening a section never moves the lens controls
        const viewTop = await top('.fm-observatory-view-row >> nth=0');

        // no box holds the open Team list to a height of its own
        expect(await pane.locator('.fm-observatory-peer-list').evaluate(el => getComputedStyle(el).maxHeight)).toBe('none');

        // a mouse click selects without an outline; the keys move the selection and outline the row they reach
        await nodesHead.click();
        await expect(node(0)).toBeVisible();
        expect(await top('.fm-observatory-view-row >> nth=0')).toBe(viewTop);
        await node(1).click();
        await expect(label).toHaveText('Currency line reads the admission');
        expect(await outlineOf(node(1))).toBe('none');
        await page.keyboard.press('ArrowDown');
        await expect(label).toHaveText('The release notes sweep the merges since the last cut');
        expect(await outlineOf(node(2))).toBe('solid');

        // Escape backs out one step at a time: the selection first, then the lens
        await teamHead.click();
        await peers.first().click();
        await nodesHead.click();
        await node(1).click();
        await expect(details).toHaveText(/ · lens · /);
        await page.keyboard.press('Escape');
        await expect(label).toHaveText('No node selected');
        await expect(details, 'the lens outlives the selection').toHaveText(/ · lens · /);
        await page.keyboard.press('Escape');
        await expect(details).not.toHaveText(/lens/);

        // and each has its own Clear
        await teamHead.click();
        await peers.first().click();
        await head.getByRole('button', {name: 'Clear'}).click();
        await expect(details).not.toHaveText(/lens/);
        await expect(head.getByRole('button', {name: 'Clear'}), 'no lens, nothing to clear').toBeHidden();
        await nodesHead.click();
        await node(1).click();
        await pane.getByRole('button', {name: /^Selected node/}).click();
        await pane.locator('.fm-observatory-selected-actions').getByRole('button', {name: 'Clear'}).click();
        await expect(label).toHaveText('No node selected')
    });

    test('the side panel reads a crowded read in full — All lists 161 peers and Nodes 500 rows, the last of each reachable by scrolling, while View holds its place and the other sections stay at their heads; a 90-character title wraps whole on its own row', async ({page}) => {
        const
            pane     = page.locator('.fm-observatory-pane'),
            head     = pane.locator('.fm-observatory-peers-head'),
            peers    = pane.locator('.fm-observatory-peer-list .neo-list-item'),
            nodes    = pane.locator('.fm-observatory-node-list .neo-list-item'),
            viewTop  = async () => Math.round((await pane.locator('.fm-observatory-view-row').first().boundingBox()).y),
            heightOf = locator => locator.locator('.fm-observatory-row-label').evaluate(label => label.clientHeight);

        await bootSettledCockpit(page);
        await openObservatoryPane(page);
        await feedObservatory(page, 'crowded', /^Current · captured .+ · complete$/);

        const top = await viewTop();

        await expect(head.locator('.fm-observatory-side-title')).toHaveText('Team · 13 of 161');
        await head.getByRole('button', {name: 'All'}).click();
        await expect(peers).toHaveCount(161);
        await peers.last().scrollIntoViewIfNeeded();
        await expect(peers.last(), 'the last peer scrolls into the open section').toBeInViewport();
        await expect(nodes.first(), 'Nodes stays at its head').toBeHidden();
        expect(await viewTop()).toBe(top);

        await pane.getByRole('button', {name: /^Nodes/}).click();
        await expect(nodes).toHaveCount(500);
        await expect(peers.first(), 'Team folds to its head').toBeHidden();
        await nodes.last().scrollIntoViewIfNeeded();
        await expect(nodes.last(), 'the last row scrolls into the open section').toBeInViewport();
        expect(await viewTop()).toBe(top);

        const
            long  = nodes.filter({hasText: 'A ninety-character node title'}),
            short = nodes.filter({has: page.locator('.fm-observatory-row-label', {hasText: /^crowded issue 1$/})});

        await long.scrollIntoViewIfNeeded();
        expect(await long.locator('.fm-observatory-row-label').evaluate(label => label.scrollHeight > label.clientHeight || label.scrollWidth > label.clientWidth), 'a long title is never clipped').toBe(false);
        expect(Math.round(await heightOf(long) / await heightOf(short)), 'it takes the lines it needs').toBeGreaterThan(1)
    });

    test('the side panel is as wide as the operator drags it, between 280 px and half the body, for the session only', async ({page}) => {
        const
            pane     = page.locator('.fm-observatory-pane'),
            side     = pane.locator('.fm-observatory-side'),
            splitter = pane.locator('.fm-observatory-splitter'),
            widthOf  = async locator => (await locator.boundingBox()).width,
            drag     = async dx => {
                const box = await splitter.boundingBox(),
                      x   = box.x + box.width / 2,
                      y   = box.y + box.height / 2;

                await page.mouse.move(x, y);
                await page.mouse.down();
                await page.mouse.move(x + dx, y, {steps: 8});
                await page.mouse.up()
            };

        await bootSettledCockpit(page);
        await openObservatoryPane(page);
        await feedObservatory(page, 'team', /^Current · captured .+ · complete$/);

        expect(await widthOf(side), 'a pane starts at the default').toBe(320);

        await drag(-200);
        await expect.poll(() => widthOf(side)).toBe(520);
        await page.mouse.move(0, 0);
        await expect(pane).toHaveScreenshot('observatory-pane-widened.png');
        await switchToLightSkin(page);
        await expect(pane).toHaveScreenshot('observatory-pane-widened-light.png');

        await drag(-2000);
        const half = (await widthOf(pane.locator('.fm-observatory-body'))) / 2;
        await expect.poll(async () => Math.abs(await widthOf(side) - half), 'never wider than half the body').toBeLessThanOrEqual(1);

        await drag(2000);
        await expect.poll(() => widthOf(side), 'never narrower than 280 px').toBe(280);

        // nothing keeps the width: a reload is a new session
        await bootSettledCockpit(page);
        await openObservatoryPane(page);
        expect(await widthOf(side)).toBe(320)
    });

    test('without a canvas worker the side panel takes the whole body, and no splitter is drawn', async ({page}) => {
        const
            pane    = page.locator('.fm-observatory-pane'),
            widthOf = async selector => (await pane.locator(selector).boundingBox()).width;

        // a host without a canvas worker: the app boots from a neo-config that turns it off
        await page.route('**/apps/agentos/neo-config.json', async route => {
            const response = await route.fetch();

            await route.fulfill({response, json: {...await response.json(), useCanvasWorker: false}})
        });
        await bootSettledCockpit(page);
        await page.getByRole('tab', {name: 'Observatory', exact: true}).click();
        await expect(pane).toBeVisible({timeout: 30000});
        await feedObservatory(page, 'team', /^Current · captured .+ · complete$/);

        await expect(pane.locator('canvas')).toHaveCount(0);
        await expect(pane.locator('.fm-observatory-splitter')).toHaveCount(0);
        expect(Math.abs(await widthOf('.fm-observatory-side') - await widthOf('.fm-observatory-body'))).toBeLessThanOrEqual(1)
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
            importPath : '../../../../apps/agentos/view/setup/Panel.mjs',
            className  : 'AgentOS.view.setup.Panel',
            parentId   : document.querySelector('.agent-os-viewport').id,
            parentIndex: 1,
            activeDoor : 'connect',
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

    test('the setup card\'s Create door — the cold recipe projected on the pinned host: three question blocks on one left edge, the token open; the ledger under Details, twelve rows in two channels; the chrome\'s progress line; the front at 720 px; both skins', async ({page}) => {
        // the vessel's seam, installed before the app boots: a packaged, unconfigured shell whose
        // setup channels reach the real broker over the pinned Brain, so the cockpit runs its real
        // mount path and every row is the recipe's own answer
        const run = await pinnedSetupHost({machine: MACHINES.laptop});

        await installPinnedSetupShell(page, run);
        await bootSettledCockpit(page);

        const
            card     = page.locator('.agent-plane-setup'),
            expected = (await run.broker.evaluate(TRUSTED, {})).evaluation.steps.map(step => step.status);

        await expect(card).toBeVisible({timeout: 15000});
        await expect(card.locator('.fm-setup-ask')).toHaveCount(3);
        await expect(card.locator('.fm-setup-ask-token')).toHaveClass(/is-open/);
        await expect(card.locator('.fm-setup-ask-where')).toHaveClass(/is-next/);
        await expect(card.locator('.fm-setup-steps'), 'the ledger is folded').toHaveCount(0);
        await expect(page.locator('.agent-setup-progress')).toHaveText('2 of 12 observed ok · next: preset');
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);

        // what shows, not what the element claims: inside a block every visible line starts on the
        // same left edge, and no block is clipped behind its hidden overflow
        const geometry = await page.evaluate(() => {
            const blocks = [...document.querySelectorAll('.fm-setup-ask')];

            return {
                lefts: blocks.map(block => [...block.querySelectorAll('.fm-setup-ask-title, .fm-setup-ask-line, .fm-setup-ask-controls, .fm-setup-ask-help')].filter(el => el.offsetParent).map(el => Math.round(el.getBoundingClientRect().left))),
                whole: blocks.every(block => block.clientHeight >= block.scrollHeight)
            }
        });

        expect(geometry.whole, 'no block is clipped').toBe(true);
        geometry.lefts.forEach((lefts, index) => expect(new Set(lefts).size, `block ${index} has one left edge: ${lefts.join(', ')}`).toBe(1));

        await expect(card).toHaveScreenshot('setup-card-create.png');

        // Details: the recipe's rows, every status in two channels — the word carries it beside the glyph
        await card.locator('.fm-setup-details-toggle').click();
        await expect(card.locator('.fm-setup-steps .neo-list-item')).toHaveCount(12);

        const paint = await page.evaluate(() => {
            const
                cs   = el => getComputedStyle(el),
                rows = [...document.querySelectorAll('.fm-setup-steps .neo-list-item')];

            return {
                words       : rows.map(row => row.querySelector('.fm-setup-step-status').textContent),
                unknownColor: cs(rows.find(row => row.classList.contains('is-unknown')).querySelector('.fm-setup-step-glyph')).color,
                dimInk      : cs(document.querySelector('.fm-setup-ask-help')).color
            }
        });

        // law-1: every status survives hue removal; the words are the recipe's own statuses
        expect(paint.words).toEqual(expected);
        // an unknown row is an indicator: the dim ink, never the faint one
        expect(paint.unknownColor).toBe(paint.dimInk);

        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        await expect(card).toHaveScreenshot('setup-card-create-details.png');
        await card.locator('.fm-setup-details-toggle').click();
        await expect(card.locator('.fm-setup-steps')).toHaveCount(0);

        // the narrow card: the front keeps one column and nothing scrolls sideways
        await page.setViewportSize({width: 720, height: 900});
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => { const card = document.querySelector('.agent-plane-setup'); return card.scrollWidth <= card.clientWidth }), 'no horizontal overflow at 720 px').toBe(true);
        await expect(card).toHaveScreenshot('setup-card-create-720.png');
        await page.setViewportSize({width: 1280, height: 800});
        await page.waitForTimeout(300);

        await switchToLightSkin(page);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await expect(card).toHaveScreenshot('setup-card-create-light.png')
    });

    test('the witness row with two exits — re-check is the chip and write again a text link beside it; the first press of write again adds its line under the reason; both skins', async ({page}) => {
        // the same seam with the real broker behind it: the row's data is the pinned recipe's own
        const run = await pinnedSetupHost({machine: MACHINES.laptop});

        await installPinnedSetupShell(page, run);
        await bootSettledCockpit(page);

        const
            card   = page.locator('.agent-plane-setup'),
            rows   = card.locator('.fm-setup-steps .neo-list-item'),
            row    = id => rows.filter({has: page.locator(`.fm-setup-step-id:text-is("${id}")`)}),
            chip   = (id, verb) => row(id).locator('.fm-setup-step-action', {hasText: verb}),
            settle = async () => { await page.mouse.move(0, 0); await page.waitForTimeout(400) };

        // the front answers one question at a time: the token, then the choice under Other choices,
        // then the ledger's chips behind Details — the e2e walk's own route
        await expect(card.locator('.fm-setup-ask-token')).toHaveClass(/is-open/, {timeout: 15000});
        await card.locator('.fm-setup-credential-button').click();
        await expect(card.locator('.fm-setup-ask-where')).toHaveClass(/is-open/);
        await card.locator('.fm-setup-other-choices-toggle').click();
        await expect(card.locator('.fm-setup-preset')).toHaveCount(3);
        await card.locator('.fm-setup-preset').first().locator('.fm-setup-preset-choose').click();
        await card.locator('.fm-setup-details-toggle').click();
        await expect(row('preset')).toHaveClass(/is-ok/);
        await expect(row('plane-credential')).toHaveClass(/is-ok/);
        await chip('provider-key', 'open window').click();
        await expect(row('provider-key')).toHaveClass(/is-ok/);

        for (const id of ['write-secrets', 'write-env', 'compose-up']) {
            await chip(id, 'run').click();
            await expect(row(id)).toHaveClass(/is-ok/)
        }

        // the acknowledgement never arrives and the search finds no row: the Brain names both exits
        run.world.dropWrite = true;
        await chip('verify', 'run').click();
        await chip('verify', 're-check').click();
        await expect(row('verify').locator('.fm-setup-step-action')).toHaveText(['re-check', 'write again']);
        await page.evaluate(() => document.fonts.ready);

        // the Brain's order reads as a hierarchy: the first exit keeps the chip's fill and border, the second has neither
        const paint = await page.evaluate(() => [...document.querySelectorAll('.fm-setup-steps .is-reconcile-required .fm-setup-step-action')].map(el => {
            const cs = getComputedStyle(el);

            return {filled: cs.backgroundColor !== 'rgba(0, 0, 0, 0)', bordered: cs.borderTopColor !== 'rgba(0, 0, 0, 0)', underlined: cs.textDecorationLine === 'underline'}
        }));

        expect(paint).toEqual([{filled: true, bordered: true, underlined: false}, {filled: false, bordered: false, underlined: true}]);

        // the door's foot fades under its sticky gradient (`.fm-setup-create::after`): before each
        // capture the real scroll surface puts the row in its unobscured reading area, and the
        // boundary is asserted — the row's box clips nothing, the wrapped reason ends inside it, and
        // the row ends above the fade. The fade itself stays as designed.
        const inReadingArea = async () => {
            await row('verify').evaluate(el => el.scrollIntoView({block: 'center'}));
            await settle();

            const fit = await row('verify').evaluate(el => {
                const
                    door   = el.closest('.fm-setup-door'),
                    fade   = parseFloat(getComputedStyle(door, '::after').height) || 0,
                    rowBox = el.getBoundingClientRect();

                return {
                    clipped  : el.scrollHeight - el.clientHeight,
                    overhang : el.querySelector('.fm-setup-step-reason').getBoundingClientRect().bottom - rowBox.bottom,
                    clearance: door.getBoundingClientRect().bottom - fade - rowBox.bottom
                }
            });

            expect(fit.clipped, 'the row clips nothing').toBe(0);
            expect(fit.overhang, 'the reason ends inside the row').toBeLessThanOrEqual(0);
            expect(fit.clearance, 'the row ends above the door\'s fade').toBeGreaterThanOrEqual(0)
        };

        await inReadingArea();
        await expect(row('verify')).toHaveScreenshot('setup-row-two-exits.png');

        await chip('verify', 'write again').click();
        await expect(row('verify').locator('.fm-setup-step-confirm')).toBeVisible();
        await inReadingArea();
        await expect(row('verify')).toHaveScreenshot('setup-row-two-exits-confirming.png');

        // another row's click takes the first press back
        await chip('placement', 're-read').click();
        await expect(row('verify').locator('.fm-setup-step-confirm')).toHaveCount(0);

        await switchToLightSkin(page);
        await inReadingArea();
        await expect(row('verify')).toHaveScreenshot('setup-row-two-exits-light.png')
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
        await expect(home.getByRole('button', {name: 'Set up your institution'})).toBeHidden();
        await settleField(page, 'none');
        await expect(home).toHaveScreenshot('home-returning-cold.png')
    });

    test('Home over a live fleet — the team line counts who is up and the plane line is quiet; a packaged shell without a plane gets the product line, the promise in its family, Set up your institution and the quiet Connect door; both skins', async ({page}) => {
        await bootSettledCockpit(page);

        const
            home    = await openHome(page),
            connect = home.getByRole('button', {name: 'Set up your institution'}),
            family  = selector => home.locator(selector).evaluate(el => getComputedStyle(el).fontFamily);

        await expect(home.locator('.fm-home-h1')).toHaveText(/^\d+ of 11 agents up$/);
        await expect(home.locator('.fm-home-plane'), 'a connected plane is quiet').toBeHidden();
        await expect(home.locator('.fm-home-doors')).toBeVisible();
        await settleField(page, '11');
        await expect(home).toHaveScreenshot('home-returning.png');

        await landShellPlane(page, false);
        await expect(connect).toBeVisible();
        await expect(home.locator('.fm-home-connect-line'), 'joining stays reachable as the second door, only its verb a link').toHaveText('Joining a team that already runs one?Connect to it');
        await expect(home.locator('.fm-home-connect')).toHaveText('Connect to it');
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

    test('Home\'s operator line — one axis unreadable (the steady state until the Brain lists the operator\'s questions), stale merges, nothing waits, and both axes counted; both skins for the last; the merge count opens the fleet head\'s merge queue (#557)', async ({page}) => {
        await bootSettledCockpit(page);

        const
            home     = await openHome(page),
            operator = home.locator('.fm-home-operator'),
            land     = async query => {
                const result = await page.evaluate(path => Neo.worker.App.loadModule({path}), `${HOME_DRIVER}?shellPlaneConfigured=null&${query}&t=${++driverTick}`);

                expect(result.success, `the driver loaded: ${JSON.stringify(result)}`).toBe(true)
            };

        await land('merges=5');
        await expect(operator).toHaveText('your questions are not listed yet · 5 merges wait for you');
        await expect(operator).toHaveAttribute('title', 'your questions: questions are not listed yet');
        await settleField(page, '11');
        await expect(home).toHaveScreenshot('home-operator-unreadable.png');

        await land('merges=5&staleMinutes=12&questions=3');
        await expect(operator).toHaveText('3 questions · 5 merges as of 12m ago wait for you');
        await expect(home).toHaveScreenshot('home-operator-stale.png');

        await land('merges=0&questions=0');
        await expect(operator).toHaveText('nothing waits for you');
        await expect(home).toHaveScreenshot('home-operator-nothing.png');

        await land('merges=5&questions=3');
        await expect(operator).toHaveText('3 questions · 5 merges wait for you');
        await expect(home).toHaveScreenshot('home-operator-both.png');

        await switchToLightSkin(page);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await settleField(page, '11', 'light');
        await expect(home).toHaveScreenshot('home-operator-both-light.png');

        // the merge count is marked as a way in, in the line's own type
        const link = operator.getByRole('button', {name: '5 merges'});

        expect(await link.evaluate(el => {
            const style = getComputedStyle(el);

            return {decoration: style.textDecorationStyle, family: style.fontFamily === getComputedStyle(el.parentElement).fontFamily}
        })).toEqual({decoration: 'dotted', family: true});

        // one click on the merge count: the Fleet view, its head's merge queue open on the same five rows
        await link.click();
        await expect(page.locator('.fm-awaiting-merge-menu')).toBeVisible();
        await expect(page.locator('.fm-awaiting-merge-row')).toHaveCount(5);
        expect(new URL(page.url()).hash).toBe('#/fleet')
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

    test('the Add agent memory frame at 1280 — candidates with the empty row closing their group, and a check that could not answer, in the operator\'s words', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 800});
        await bootSettledCockpit(page);

        const
            tab  = page.locator('.neo-dashboard-dock-rail-tab', {hasText: /^\s*Add agent\s*$/i}).first(),
            form = page.locator('.fm-add-agent-form:visible').first();

        await tab.click();
        await expect(tab).toHaveClass(/\bpressed\b/, {timeout: 10000});
        await expect(form).toBeVisible({timeout: 30000});

        for (const [state, golden] of [['candidates', 'add-agent-memory-candidates.png'], ['unavailable', 'add-agent-memory-unavailable.png']]) {
            const loaded = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), `${ADD_AGENT_MEMORY_DRIVER}?state=${state}&t=${++driverTick}`);

            expect(loaded.success, `the driver loaded: ${JSON.stringify(loaded)}`).toBe(true);
            await expect(form.locator('.fm-add-memory')).toBeVisible();
            await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
            await page.mouse.move(0, 0);
            await page.waitForTimeout(400);
            await expect(form, `Add agent, memory ${state}`).toHaveScreenshot(golden)
        }
    });
});
