import {test, expect} from '@playwright/test';

/**
 * The System keeper-view's visual baseline — the design gate's mechanical guard for the engine
 * room's COLD state: the registry bridge stays unwired in this harness, so the view renders its
 * honest never-answered picture BY DESIGN (head line, empty plane grid, three lanes reading
 * "not observed", the logs region naming its missing verb). A diff here means a DESIGN
 * regression — an off-token color, a lane that lost its rhythm — never content churn.
 *
 * Determinism stack: the config's `reducedMotion: 'reduce'`, `document.fonts.ready` before the
 * capture, the pinned viewport, and the globalSetup's theme-freshness refusal.
 */
test.describe('System keeper-view — visual baseline (the cold engine room)', () => {
    test.setTimeout(120000);

    test.skip(process.env.NEO_TEST_SKIP_CI === 'true', 'visual baselines are rendered-platform artifacts — local harness only');

    test('the cold System view: head · empty planes · three lanes · logs absence', async ({page}) => {
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

        // the rail's own route reaches the keeper-view — the same path an operator's click takes
        await page.evaluate(() => { location.hash = '#/system' });
        await expect(page.locator('.fm-system-view')).toBeVisible({timeout: 30000});
        await expect(page.locator('.fm-system-fresh')).toHaveText('not observed yet');
        await page.evaluate(() => document.fonts.ready);

        await expect(page.locator('.fm-system-view')).toHaveScreenshot('system-view-cold.png')
    })
});

/**
 * The populated System view at the operator's own window widths: six plane cards, one carrying
 * the installed picture's longest words (a 240+ character diagnosis, a long class) and one an unmapped
 * compose id. The guard is the reading contract: every line on a card wraps inside it, a card is as tall
 * as its content, a column is at least 360 px, and a narrow list is one column. The picture lands through
 * `systemPlanes.driver.mjs` in the wire shape; its age is fixed and every row shares its `generatedAt`,
 * so "observed 12s ago" never churns.
 */
test.describe('System keeper-view — visual baseline (populated plane cards)', () => {
    test.setTimeout(120000);

    test.skip(process.env.NEO_TEST_SKIP_CI === 'true', 'visual baselines are rendered-platform artifacts — local harness only');

    const
        DRIVER        = '../../../../test/playwright/visual/systemPlanes.driver.mjs',
        recoveryClass = 'sustained-memory-saturation: the container stayed above its class threshold across three ' +
            'consecutive observation windows while restart churn stayed under its baseline, so the orchestrator ' +
            'recommends one supervised restart',
        generatedAt   = 1790000000000,
        service       = (serviceKey, serviceClass, overrides = {}) => ({
            serviceKey, status: 'available', observedAt: generatedAt,
            memoryPressure: {disposition: 'below'},
            restartChurn  : {baseline: 'available', detecting: false},
            classification: {serviceClass, appliedMemoryThreshold: 85, sampleCount: 120},
            diagnosis     : {status: 'healthy'},
            ...overrides
        }),
        rows = [
            service('chroma',       'vector-store'),
            service('kb-server',    'knowledge-base'),
            service('mc-server',    'stateful-memory-core-with-sqlite-holder-and-embedding-drain', {
                status        : 'degraded',
                memoryPressure: {disposition: 'at-cap', reason: 'heap observation unavailable: the container reports no cgroup memory limit, so no ratio is computed'},
                restartChurn  : {baseline: 'available', detecting: true},
                diagnosis     : {status: 'recommend', recoveryClass, confidence: 0.92, actionClass: 'supervised-restart'}
            }),
            service('fleet-server', 'fleet-control'),
            service('orchestrator', 'orchestrator'),
            service('neo-agent-os-embedding-gateway-sidecar-canonical-plane-01', 'sidecar')
        ],
        picture = {state: 'ok', ageMs: 12000, observedAt: null, generatedAt, services: rows};

    // 1504: the operator's window (its System list is 1432 px, three columns) · 700: one column
    for (const width of [1504, 700]) {
        test(`the populated System view at a ${width} px window: every card reads in full`, async ({page}) => {
            await page.setViewportSize({width, height: 1257});
            await page.goto('/apps/agentos/index.html');
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            await page.evaluate(() => { location.hash = '#/system' });
            await expect(page.locator('.fm-system-view')).toBeVisible({timeout: 30000});

            const result = await page.evaluate(path => Neo.worker.App.loadModule({path}),
                `${DRIVER}?picture=${encodeURIComponent(JSON.stringify(picture))}&t=${width}`);

            expect(result.success, `systemPlanes driver: ${result.error?.message ?? ''}`).toBe(true);
            await expect(page.locator('.fm-plane-card')).toHaveCount(rows.length, {timeout: 30000});
            await page.evaluate(() => document.fonts.ready);

            await expect(page.locator('.fm-system-view')).toHaveScreenshot(`system-view-populated-${width}.png`)
        })
    }

    // The seat-move block by its state, at the operator's 1552 × 850 window, beside the same six cards. Its
    // twelve consented rows are a decision only until the move commits; while they are, they scroll in their
    // own box. The shell is a test-owned preload answer: no Electron handler, registry or filesystem effect runs.
    const
        from     = '/Users/operator/Library/Application Support/neo-harness/brain/fleet/agents',
        to       = '/Users/operator/.neo-ai/agents',
        moveRows = Array.from({length: 12}, (_, i) => ({id: `seat-${i + 1}`, from: `${from}/seat-${i + 1}`, to: `${to}/seat-${i + 1}`, materialized: true}));

    for (const [state, outcome, statusText] of [
        ['committed', {state: 'committed'}, `Root move committed · ${to}`],
        ['pending',   null,                 'A move is consented; this boot has not reported its outcome yet.']
    ]) {
        test(`a ${state} seat move at the operator's 1552 × 850 window: the plane cards stay in reach (#614)`, async ({page}) => {
            await page.addInitScript(status => {
                window.neoShell = {seatRootStatus: async () => status, seatRootPlan: async () => null, seatRootConsent: async () => null}
            }, {packaged: true, root: {root: outcome ? to : from, origin: outcome ? 'moved' : 'adopted'}, pending: {from, to, rows: moveRows}, outcome});

            await page.setViewportSize({width: 1552, height: 850});
            await page.goto('/apps/agentos/index.html');
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            await page.evaluate(() => { location.hash = '#/system' });
            await expect(page.locator('.fm-system-view')).toBeVisible({timeout: 30000});
            await expect(page.locator('.fm-seat-root-status')).toHaveText(statusText, {timeout: 30000});

            const result = await page.evaluate(path => Neo.worker.App.loadModule({path}),
                `${DRIVER}?picture=${encodeURIComponent(JSON.stringify(picture))}&t=seat-move-${state}`);

            expect(result.success, `systemPlanes driver: ${result.error?.message ?? ''}`).toBe(true);
            await expect(page.locator('.fm-plane-card')).toHaveCount(rows.length, {timeout: 30000});
            await page.evaluate(() => document.fonts.ready);

            if (outcome) {
                await expect(page.locator('.fm-seat-root-plan')).toBeHidden()
            } else {
                await expect(page.locator('.fm-seat-move-row')).toHaveCount(moveRows.length);
                expect(await page.locator('.fm-seat-root-plan .fm-seat-move-list').evaluate(list => list.scrollHeight > list.clientHeight), 'the rows scroll in their own box').toBe(true)
            }

            // reach is the rendered fact, not an inference: the first card's head reads inside the plane list's
            // visible box without a scroll, so the list is more than a sliver that technically starts on screen
            const reach = await page.evaluate(() => ({
                head: Math.round(document.querySelector('.fm-plane-card .fm-plane-head').getBoundingClientRect().bottom),
                list: Math.round(document.querySelector('.fm-plane-list').getBoundingClientRect().bottom)
            }));

            expect(reach.head, 'the first card\'s head reads without a scroll').toBeLessThanOrEqual(reach.list);

            await expect(page.locator('.fm-system-view')).toHaveScreenshot(`system-view-seat-move-${state}.png`)
        })
    }
});

/**
 * The reviewed seat move on the FM skin: mixed dispositions and a refused row, every text node on a
 * documented role, every row on the FM panel at rest, hover and press, with no pointer, since nothing
 * here is selectable. The shell is a test-owned preload answer; Review move asks it for the plan.
 */
test.describe('System keeper-view — the reviewed seat move on the FM skin (#589)', () => {
    test.setTimeout(120000);

    test.skip(process.env.NEO_TEST_SKIP_CI === 'true', 'visual baselines are rendered-platform artifacts — local harness only');

    const
        from  = '/Users/operator/Library/Application Support/neo-harness/brain/fleet/agents',
        to    = '/Users/operator/.neo-ai/agents',
        seat  = (id, state, facts = {}) => ({id, seatHome: `${from}/${id}`, destination: `${to}/${id}`, state, materialized: true, ...facts}),
        plan  = {state: 'planned', from, to, fingerprint: 'a'.repeat(64), rows: [
            seat('neo-opus-vega', 'copy'),
            seat('neo-fable', 'rebind'),
            seat('neo-gpt-emmy', 'done', {seatHome: `${to}/neo-gpt-emmy`, reason: 'already at its destination'}),
            seat('neo-kimi-phoebe', 'untouched', {seatHome: '/Volumes/elsewhere/neo-kimi-phoebe', destination: null, materialized: false, reason: 'bound to a home outside this installation'}),
            seat('neo-opus-ada', 'untouched', {destination: null, code: 'SEAT_HOME_BUSY', reason: 'a running harness holds this seat home open; stop it, then review the move again'})
        ]},
        status = {packaged: true, root: {root: from, origin: 'adopted'}, pending: null, outcome: {state: 'none'}};

    /**
     * @summary The first row's background and cursor against a probe painted with `--fm-panel` in the same
     * block, so the comparison reads the compiled theme rather than a hardcoded color.
     * @param {Object} page
     * @returns {Promise<Object>}
     */
    const rowSurface = page => page.evaluate(() => {
        const block = document.querySelector('.fm-seat-root'),
              probe = block.appendChild(document.createElement('div'));

        probe.style.background = 'var(--fm-panel)';

        const panel = getComputedStyle(probe).backgroundColor,
              row   = getComputedStyle(document.querySelector('.fm-seat-move-row'));

        probe.remove();

        return {background: row.backgroundColor, cursor: row.cursor, panel}
    });

    for (const width of [1552, 560]) {
        test(`mixed dispositions and a refused row read on the panel at rest, hover and press at ${width} px; both skins at 1552`, async ({page}) => {
            await page.addInitScript(answers => {
                window.neoShell = {seatRootStatus: async () => answers.status, seatRootPlan: async () => answers.plan, seatRootConsent: async () => null}
            }, {plan, status});

            await page.setViewportSize({width, height: 1000});
            await page.goto('/apps/agentos/index.html');
            await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

            await page.evaluate(() => { location.hash = '#/system' });

            const block = page.locator('.fm-seat-root'), rows = block.locator('.fm-seat-move-row');

            await expect(block.locator('.fm-seat-root-review')).toBeVisible({timeout: 30000});
            await block.locator('.fm-seat-root-review').click();
            await expect(rows).toHaveCount(plan.rows.length, {timeout: 30000});
            // every disposition keeps its words, and the plan stays consentable
            await expect(rows.filter({hasText: 'SEAT_HOME_BUSY'})).toContainText('stop it, then review the move again');
            await expect(block.locator('.fm-seat-root-consent')).toBeVisible();
            await page.evaluate(() => document.fonts.ready);

            const states = [['at rest', await rowSurface(page)]];

            await rows.first().hover();
            states.push(['hovered', await rowSurface(page)]);
            await page.mouse.down();
            states.push(['pressed', await rowSurface(page)]);
            await page.mouse.up();
            await page.mouse.move(0, 0);

            for (const [phase, surface] of states) {
                expect(surface.background, `${phase}: the row sits on the FM panel`).toBe(surface.panel);
                expect(surface.cursor, `${phase}: nothing here is selectable`).toBe('default')
            }

            await expect(block).toHaveScreenshot(`system-seat-move-review-${width}.png`);

            if (width === 1552) {
                const toggle = page.locator('.agent-theme-button');

                await toggle.focus();
                await page.keyboard.press('Enter');
                await expect(page.locator('.agent-os-viewport.neo-theme-neo-light')).toBeVisible();
                await toggle.blur();
                await page.evaluate(() => document.fonts.ready);

                const light = await rowSurface(page);

                expect(light.background, 'light: the row sits on the FM panel').toBe(light.panel);
                await expect(block).toHaveScreenshot('system-seat-move-review-1552-light.png')
            }
        })
    }
});
