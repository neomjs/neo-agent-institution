import {test, expect} from '../../fixtures.mjs';

const
    fingerprint = 'a'.repeat(64),
    from = '/Users/operator/Library/Application Support/neo-harness/brain/fleet/agents',
    to = '/Users/operator/.neo-ai/agents',
    status = {packaged: true, root: {root: from, origin: 'adopted', recordedAt: '2026-10-06T12:00:00Z'}, pending: null, outcome: {state: 'none'}},
    rows = [
        {id: 'local-seat', seatHome: `${from}/local-seat`, destination: `${to}/local-seat`, state: 'copy', materialized: true},
        {id: 'elsewhere-seat', seatHome: '/other/<em>literal</em>/seat', destination: `${to}/elsewhere-seat`, state: 'untouched', materialized: false, reason: 'bound elsewhere <b>literal</b>'}
    ],
    plan = {state: 'planned', from, to, rows, fingerprint};

/**
 * @summary Gives the browser a test-owned preload surface. The real ShellPlane remote, controller,
 * Store and rendering run; no Electron handler, registry or filesystem effect is invoked.
 * @param {Object} page
 * @param {Object} [answers]
 */
async function installShell(page, answers = {}) {
    await page.addInitScript(data => {
        window.seatMoveFixture = {calls: [], ...data};
        window.neoShell = {
            seatRootStatus: async () => window.seatMoveFixture.status,
            seatRootPlan: async () => window.seatMoveFixture.plan,
            seatRootConsent: async request => {
                window.seatMoveFixture.calls.push(request);
                return window.seatMoveFixture.consent
            }
        }
    }, {status, plan, consent: {state: 'consented'}, ...answers})
}

/**
 * @summary Opens System and binds whitebox reads to the app that rendered it.
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function openSystem({page, neuralLink}) {
    await page.goto('/apps/agentos/index.html#/system');
    await expect(page.locator('.fm-seat-root')).toBeVisible({timeout: 60000});
    const app = await neuralLink.connectToApp('AgentOS');
    return {app, section: page.locator('.fm-seat-root')}
}

/**
 * @summary Reads the actual App Worker state, rather than inferring a consent from a button caption.
 * @param {Object} app
 * @returns {Promise<Object>}
 */
async function readSeatView(app) {
    const matches = await app.queryComponent({className: 'AgentOS.view.system.SeatRootContainer'}, ['snapshot', 'plan', 'busy', 'feedback', 'moveStore']);
    expect(matches).toHaveLength(1);
    return matches[0].properties
}

test.describe('System seat placement through the shell capability', () => {
    for (const width of [560, 1400]) {
        test(`reviews every row and consents only to its fingerprint at ${width}px`, async ({page, neuralLink}, testInfo) => {
            await page.setViewportSize({width, height: 1000});
            await installShell(page);
            const {app, section} = await openSystem({page, neuralLink});
            await section.locator('.fm-seat-root-recheck').click();
            await expect(section.locator('.fm-seat-root-review')).toBeVisible();
            await section.locator('.fm-seat-root-review').click();
            await expect(section.locator('.fm-seat-move-row')).toHaveCount(2);
            expect((await readSeatView(app)).moveStore.count).toBe(2);
            expect((await readSeatView(app)).plan.fingerprint).toBe(fingerprint);
            await expect(section).toContainText(rows[1].seatHome);
            await expect(section).toContainText(rows[1].reason);
            await expect(section.locator('em, b')).toHaveCount(0);
            await expect(section.locator('.fm-seat-root-consent')).toBeVisible();

            const overflow = await section.locator('.fm-seat-move-row').evaluateAll(elements => elements.map(el => el.scrollWidth - el.clientWidth));
            expect(overflow.every(value => value <= 1), 'paths and reasons wrap within every row').toBe(true);
            await testInfo.attach(`seat-move-review-${width}`, {body: await section.screenshot(), contentType: 'image/png'});

            await section.locator('.fm-seat-root-consent').click();
            await expect.poll(async () => (await readSeatView(app)).feedback?.state).toBe('consented');
            expect(await page.evaluate(() => window.seatMoveFixture.calls)).toEqual([{fingerprint}]);
            expect((await readSeatView(app)).plan).toBeNull();
            await expect(section.locator('.fm-seat-root-consent')).toBeHidden()
        })
    }

    test('a refused consent invalidates the reviewed plan', async ({page, neuralLink}) => {
        await installShell(page, {consent: {state: 'refused', code: 'plan-changed', reason: 'Fresh plan differs; review it again.'}});
        const {app, section} = await openSystem({page, neuralLink});
        await section.locator('.fm-seat-root-recheck').click();
        await section.locator('.fm-seat-root-review').click();
        await section.locator('.fm-seat-root-consent').click();
        await expect(section).toContainText('Fresh plan differs; review it again.');
        expect((await readSeatView(app)).plan).toBeNull();
        await expect(section.locator('.fm-seat-root-consent')).toBeHidden();
        expect(await page.evaluate(() => window.seatMoveFixture.calls)).toHaveLength(1)
    });

    test('a held boot remains visible beside an unreadable root record', async ({page, neuralLink}, testInfo) => {
        await installShell(page, {status: {...status, root: {unreadable: 'record is incomplete'}, outcome: {state: 'held', reason: 'registry writer could not be ruled out'}}});
        const {app, section} = await openSystem({page, neuralLink});
        await expect(section).toContainText('record is incomplete');
        await expect(section).toContainText('registry writer could not be ruled out');
        const observed = await readSeatView(app);
        expect(observed.snapshot.outcome.state).toBe('held');
        expect(observed.snapshot.root.unreadable).toBe('record is incomplete');
        await expect(section.locator('.fm-seat-root-review')).toBeHidden();
        await expect(section.locator('.fm-seat-root-consent')).toBeHidden();
        await testInfo.attach('seat-move-held', {body: await section.screenshot(), contentType: 'image/png'})
    });

    test('a committed move with held retirement keeps Fleet held and shows already-arrived seats unchanged', async ({page, neuralLink}) => {
        await installShell(page, {status: {...status, root: {root: to, origin: 'moved'}, outcome: {state: 'committed', retirement: {state: 'held', reason: 'archive occupied'}}, pending: {
            from, to, archive: `${from}/.archive`, consentedAt: '2026-10-06T12:00:00Z',
            rows: [{id: 'local-seat', from: rows[0].seatHome, to: rows[0].destination, materialized: true}],
            outOfScope: [{id: 'arrived-seat', seatHome: `${to}/arrived-seat`, reason: 'already at its destination'}]
        }}});
        const {app, section} = await openSystem({page, neuralLink});
        await expect(section).toContainText('Root move committed');
        await expect(section).toContainText('Fleet start held');
        await expect(section).toContainText('archive occupied');
        const arrived = section.locator('.fm-seat-move-row').filter({hasText: 'arrived-seat'});
        await expect(arrived).toContainText('unchanged by this move');
        await expect(arrived).toContainText('already at its destination');
        expect((await readSeatView(app)).snapshot.outcome.state).toBe('committed');
        await expect(section.locator('.fm-seat-root-consent')).toBeHidden();
        expect(await page.evaluate(() => window.seatMoveFixture.calls)).toEqual([])
    });

    test('an initial unsettled move refreshes to its boot outcome without a click', async ({page, neuralLink}) => {
        await installShell(page, {status: {...status, outcome: null, pending: {
            from, to, archive: `${from}/.archive`, consentedAt: '2026-10-06T12:00:00Z', outOfScope: [],
            rows: [{id: 'local-seat', from: rows[0].seatHome, to: rows[0].destination, materialized: true}]
        }}});
        const {app, section} = await openSystem({page, neuralLink});
        await expect(section).toContainText('this boot has not reported its outcome yet');
        await page.evaluate(() => { window.seatMoveFixture.status.outcome = {state: 'held', reason: 'writer still active'} });
        await expect(section).toContainText('writer still active');
        expect((await readSeatView(app)).snapshot.outcome.state).toBe('held');
        expect(await page.evaluate(() => window.seatMoveFixture.calls)).toEqual([])
    });

    test('a browser names the missing shell and cannot offer consent', async ({page, neuralLink}) => {
        const {app, section} = await openSystem({page, neuralLink});
        await section.locator('.fm-seat-root-recheck').click();
        await expect(section).toContainText('no-shell');
        expect((await readSeatView(app)).snapshot.state).toBe('refused');
        await expect(section.locator('.fm-seat-root-review')).toBeHidden();
        await expect(section.locator('.fm-seat-root-consent')).toBeHidden()
    })
});
