import {expect, test, loadAgentOsModule} from '../../fixtures.mjs';
// The human-facing instant renders viewer-local through the ONE shared class (TOKENS.md T5) —
// the expectation imports it instead of hard-coding the UTC wire form or a zone-dependent literal.
import Neo        from '../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core  from '../../../../node_modules/neo.mjs/src/core/_export.mjs';
import {
    authenticatedFleetOptions,
    fleetE2EFailure,
    fleetE2ESuccess,
    wireAuthenticatedFleetBridge
} from './authenticatedFleetHarness.mjs';

const CAPTURED_AT = '2026-08-03T08:00:00.000Z';

const rosterRows = [
    {id: 'ada', githubUsername: 'neo-opus-ada', displayName: 'Ada', engineTag: 'fixture', family: 'claude'},
    {id: 'bob', githubUsername: 'neo-gpt-bob',  displayName: 'Bob', engineTag: 'fixture', family: 'gpt'}
];

/**
 * @summary One fixture envelope per page, exactly the `fleetMemories` source contract over
 * session summaries: the newest page carries two cards (one a multi-agent session whose
 * attribution must render), the offset continuation carries the older card whose title and
 * summary are NON-STRINGS — the vocabulary-collision class the model boundary must name instead
 * of coercing to `[object Object]`.
 * @param {Object} params
 * @returns {Object}
 */
function memoriesResult(params = {}) {
    const
        target = params.agentIdentity,
        shared = {viewer: '@e2e-operator', target};

    if (target === '@neo-gpt-bob') {
        return {
            capability: {state: 'wired', capturedAt: CAPTURED_AT},
            ...shared,
            page    : {offset: 0, limit: 20},
            sessions: [
                {
                    id         : 'bob-1', sessionId: 'bobsess1-0000', timestamp: '2026-08-02T18:00:00.000Z',
                    title      : 'Bob fixture session', summary: 'A single truthful session.', category: 'other',
                    memoryCount: 2, quality: 80, impact: 30, sourceAgentIdentities: ['@neo-gpt-bob']
                }
            ],
            count: 1,
            total: 1
        }
    }

    if (params.offset > 0) {
        return {
            capability: {state: 'wired', capturedAt: CAPTURED_AT},
            ...shared,
            page    : {offset: params.offset, limit: 20},
            sessions: [
                {
                    id         : 'summary-0', sessionId: '36ea85e4-fcdc', timestamp: '2026-08-02T09:00:00.000Z',
                    title      : {payload: 'not a string'}, summary: {payload: 'also not a string'}, category: 'other',
                    memoryCount: 3, quality: 50, impact: 20, sourceAgentIdentities: ['@neo-opus-ada']
                }
            ],
            count: 1,
            total: 3
        }
    }

    return {
        capability: {state: 'wired', capturedAt: CAPTURED_AT},
        ...shared,
        page    : {offset: 0, limit: 20},
        sessions: [
            {
                id         : 'summary-2', sessionId: '9286a9c0-91be', timestamp: '2026-08-02T21:00:00.000Z',
                title      : 'Wake transport and integrity contracts', summary: 'Established verifiable wake transport between plane and host.', category: 'feature',
                memoryCount: 61, quality: 95, impact: 85, sourceAgentIdentities: ['@neo-opus-ada', '@neo-gpt-emmy']
            },
            {
                id         : 'summary-1', sessionId: '9286a9c0-91be', timestamp: '2026-08-02T19:00:00.000Z',
                title      : 'Terminal audit for a grid PR', summary: 'Verified five required actions without repository mutation.', category: 'analysis',
                memoryCount: 1, quality: 100, impact: 40, sourceAgentIdentities: ['@neo-opus-ada']
            }
        ],
        count: 2,
        total: 3
    }
}

/**
 * @summary The drill envelope for one session — the `fleetSessionMemories` source contract over
 * authored turns: two turns, one with a miniSummary headline and one without, both attributed,
 * so the turn register renders every row form the skin styles.
 * @param {Object} params
 * @returns {Object}
 */
function sessionMemoriesResult(params = {}) {
    const sessionId = params.sessionId;

    return {
        capability: {state: 'wired', capturedAt: CAPTURED_AT},
        viewer    : '@e2e-operator',
        sessionId,
        page      : {offset: params.offset ?? 0, limit: 20},
        turns     : [
            {
                id: 'turn-2', sessionId, timestamp: '2026-08-02T20:40:00.000Z', agentIdentity: '@neo-opus-ada', amountToolCalls: 14,
                miniSummary: 'Wake transport verified end to end',
                prompt     : 'Verify the wake transport between plane and host.',
                thought    : 'Ran the integrity probe twice.',
                response   : 'The wake transport holds: both probes returned signed receipts, and the host replayed them in order.'
            },
            {
                id: 'turn-1', sessionId, timestamp: '2026-08-02T19:10:00.000Z', agentIdentity: '@neo-opus-ada', amountToolCalls: 3,
                miniSummary: null,
                prompt     : 'Read the integrity contract.',
                thought    : null,
                response   : 'The contract names two receipts per wake; the second one is the host\'s.'
            }
        ],
        count: 2,
        total: 2
    }
}

async function startMemoriesFleet() {
    const {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
          requests                 = [],
          gates                    = {},
          options                  = authenticatedFleetOptions({
              dispatch: async request => {
                  requests.push(request);

                  if (request.method === 'fleetMemories' && gates[request.params?.agentIdentity]) {
                      await gates[request.params.agentIdentity]
                  }

                  switch (request.method) {
                      case 'resolveViewerIdentity':
                          return fleetE2ESuccess({ok: true, agentIdentityNodeId: '@e2e-operator'});
                      case 'fleetRoster':
                          return fleetE2ESuccess({rows: rosterRows});
                      case 'fleetActivity':
                          return fleetE2ESuccess({capability: {state: 'wired'}, events: []});
                      case 'fleetMemories':
                          return fleetE2ESuccess(memoriesResult(request.params));
                      case 'fleetSessionMemories':
                          return fleetE2ESuccess(sessionMemoriesResult(request.params));
                      case 'getBootIdentity':
                          return fleetE2ESuccess({fact: null, classification: 'unknown', advisory: true});
                      default:
                          return fleetE2EFailure(`unexpected memories method: ${request.method}`)
                  }
              }
          }),
          server                   = await startFleetBridgeServer(options);

    return {
        requests,
        gates,
        bearerToken: options.bearerToken,
        endpoint   : `http://127.0.0.1:${server.address().port}/fleet`,
        close      : () => new Promise(resolve => server.close(resolve))
    }
}

/**
 * @summary Native Fleet memories journey over session summaries: activating the resident
 * south-strip tab shows the pane; choosing an agent is the roster's selection (the pane carries
 * no chooser of its own — the one-picker IA); the App Worker crosses the authenticated allowlisted
 * bridge; summary cards render with honest multi-agent attribution; the register's scroll edge
 * requests the older pages until the producer's total is assembled (the paging chrome is retired;
 * a corpus shorter than one window is at its edge on first layout, so it assembles unasked); guarded
 * non-string titles/summaries are named; and the wire carries only the explicit target — never a
 * viewer claim, never a projection. The rematerialization variants create TRUE document absence
 * (committed clones) — a resident tab switch only hides the inactive card.
 *
 * Run: NEO_E2E_PORT=49223 NEO_TEST_SKIP_CI=true npx playwright test agentos/FleetMemoriesNL -c test/playwright/playwright.config.e2e.mjs --workers=1
 */
test.describe('AgentOS Fleet memories — authenticated resident-tab journey (#16398)', () => {
    test.setTimeout(120000);
    test.use({viewport: {width: 1600, height: 1000}});

    test('tab → roster selection → summary cards → edge-requested append → guarded non-string card', async ({page, neuralLink}) => {
        const fleet = await startMemoriesFleet();

        try {
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}`);
            await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            expect(cockpit?.properties?.id).toBeTruthy();
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');

            // resident south reading-surface tab (the navigation model): activate, never rail-reveal
            const tab = page.getByRole('tab', {name: 'Memories', exact: true});
            await expect(tab).toHaveCount(1);
            await tab.click();

            // True-absence removal for the rematerialization variants: a resident tab SWITCH only
            // hides the inactive card (the instance survives), so the old rail-switch removal no
            // longer destroys the pane. Drop the item through a committed document (the wire hands
            // back a clone; committing it is the production reducer path), then re-add + activate.
            const cockpitId      = cockpit.properties.id,
                  removeMemories = async () => {
                      const doc = await app.callMethod(cockpitId, 'getDockZoneDocument');
                      doc.nodes['stream-tabs'].items = doc.nodes['stream-tabs'].items.filter(id => id !== 'memories');
                      await app.callMethod(cockpitId, 'onDockZoneDocumentChange', [doc]);
                      await expect(page.locator('.fm-memories-pane')).toHaveCount(0)
                  },
                  restoreMemories = async () => {
                      const readd = await app.callMethod(cockpitId, 'applyDockZoneOperation', [{operation: 'addTab', itemId: 'memories', tabsNodeId: 'stream-tabs'}]);
                      expect(readd.errors).toEqual([]);
                      await app.callMethod(cockpitId, 'onDockZoneDocumentChange', [readd.document]);
                      await page.getByRole('tab', {name: 'Memories', exact: true}).click()
                  };

            const pane = page.locator('.fm-memories-pane');
            await expect(pane).toBeVisible({timeout: 10000});

            // choosing whose memories is an explicit act: construction fires no read
            await expect(pane).toContainText('Select an agent card in the roster to read their recent sessions.');
            await expect(pane).toContainText('Session summaries render here once an agent is chosen.');
            await expect(pane.locator('.fm-memories-card')).toHaveCount(0);

            // ── rematerialization VARIANT B: pending first-ever read, NO prior snapshot ──
            // Gate Ada's page zero, select her, remove the pane mid-flight (true document
            // absence), return.
            let releaseAda;
            fleet.gates['@neo-opus-ada'] = new Promise(resolve => { releaseAda = resolve });

            // choosing whose memories is the roster's selection (the one-picker IA): the pane carries
            // no agent chooser of its own — the card click selects the resident, the pane follows
            await page.locator('.fm-fleet-cards > .neo-list-item', {hasText: /\bAda\b/}).click();
            await expect(pane).toContainText('Reading @neo-opus-ada…');

            await removeMemories();
            await restoreMemories();

            const paneB = page.locator('.fm-memories-pane');
            await expect(paneB).toBeVisible({timeout: 10000});
            // the owner-held PENDING selection travels into the rebuilt pane: honest pending
            // state — never the null-selection "Select an agent card" while a response is in flight
            await expect(paneB).toContainText('Reading @neo-opus-ada…');
            await expect(paneB).not.toContainText('Select an agent card');
            await expect(paneB.locator('.fm-memories-card')).toHaveCount(0);

            delete fleet.gates['@neo-opus-ada'];
            releaseAda();

            // the in-flight response lands in the REBUILT pane (write-time pane resolve), with
            // the selection attached — variant B's "renders with activeAgent: null" is dead. The
            // register's scroll EDGE (the paging chrome's replacement) then follows the producer's
            // total: two cards are shorter than the window, so the engine announces the edge on the
            // first layout and the pane asks for the next window once; the first page's "2 of 3"
            // is transient and the settled line reads the whole corpus. The captured stamp renders
            // in the VIEWER's locale (ViewerTime); asserted as a shape.
            await expect(paneB.locator('.fm-memories-card')).toHaveCount(3, {timeout: 10000});
            await expect(pane).toContainText(/@neo-opus-ada · 3 of 3 sessions · captured .+/);
            await expect(pane.locator('.fm-memories-card').nth(0)).toContainText('Wake transport and integrity contracts');
            await expect(pane.locator('.fm-memories-card').nth(0)).toContainText('feature · 61 memories · quality 95');
            // multi-agent session: attribution beyond the selected target renders explicitly
            await expect(pane.locator('.fm-memories-card').nth(0)).toContainText('with @neo-gpt-emmy');

            // the registers wear no engine grid chrome: the card carries the only frame and surface —
            // no cell lattice, no cell background, no cell padding around the height-normed card; and
            // a card click selects its row into the reader: the RowModel marks the row, the
            // skin re-binds its cell paint, and the card's own border carries the mark
            const cellChrome = () => pane.locator('.fm-memories-summary-grid .neo-grid-cell').first().evaluate(cell => {
                const style = getComputedStyle(cell);

                return {
                    background: style.backgroundColor,
                    border    : [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].join(' '),
                    padding   : [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
                    selected  : cell.closest('.neo-grid-row')?.classList.contains('neo-selected') ?? null
                }
            });

            expect(await cellChrome()).toEqual({background: 'rgba(0, 0, 0, 0)', border: '0px 0px 0px 0px', padding: '0px 0px 0px 0px', selected: false});
            expect(await pane.locator('.fm-memories-summary-grid').evaluate(grid => getComputedStyle(grid).borderTopWidth), 'the register carries no container frame').toBe('0px');
            await pane.locator('.fm-memories-card').nth(0).locator('.fm-memories-card-title').click();
            await expect(pane.locator('.fm-memories-card').nth(1)).not.toContainText('with @');
            await expect(pane.locator('.fm-memories-summary-grid .neo-grid-row', {hasText: 'Wake transport and integrity contracts'}), 'a card click marks its row').toHaveClass(/\bneo-selected\b/);
            expect(await cellChrome(), 'and no cell paints a band').toMatchObject({background: 'rgba(0, 0, 0, 0)', border: '0px 0px 0px 0px', padding: '0px 0px 0px 0px'});
            await expect(pane.locator('.fm-memories-reader .fm-memories-read-text'), 'the selected summary reads whole').toHaveText('Established verifiable wake transport between plane and host.');

            // the paging chrome is retired: the edge did the append, and no "Older sessions"
            // affordance exists to click — corpus exhaustion is the settled "3 of 3" line above
            const older = pane.getByRole('button', {name: 'Older sessions'});
            await expect(older).toHaveCount(0);

            // the vocabulary-collision class: non-string title AND summary are NAMED at the model boundary
            await expect(pane.locator('.fm-memories-card').nth(2)).toContainText('Title unavailable for this session.');
            await expect(pane.locator('.fm-memories-card').nth(2)).toContainText('Summary unavailable for this session.');
            await expect(pane).not.toContainText('[object Object]');

            // ── switch-while-pending coherence (the reviewer's exact-head probe as a witness) ──
            // Gate Bob's page zero so the switch-pending window is real and observable.
            let releaseBob;
            fleet.gates['@neo-gpt-bob'] = new Promise(resolve => { releaseBob = resolve });

            await page.locator('.fm-fleet-cards > .neo-list-item', {hasText: /\bBob\b/}).click();

            // old target's cards + continuation die IMMEDIATELY; pending state is honest
            await expect(pane).toContainText('Reading @neo-gpt-bob…');
            await expect(pane.locator('.fm-memories-card')).toHaveCount(0);
            await expect(older).toBeHidden();
            await expect(pane).toContainText('Waiting for this agent’s first page.');

            // ── rematerialization VARIANT A: pending switch WITH a prior (Ada) snapshot held ──
            // Remove + rebuild the pane mid-flight (true document absence): it must reopen on the
            // PENDING selection, never on the stale accepted snapshot's target, cards, or continuation.
            await removeMemories();
            await restoreMemories();
            await expect(pane).toBeVisible({timeout: 10000});
            await expect(pane).toContainText('Reading @neo-gpt-bob…');
            await expect(pane).not.toContainText('@neo-opus-ada · 3 of 3');
            await expect(pane.locator('.fm-memories-card')).toHaveCount(0);

            delete fleet.gates['@neo-gpt-bob'];
            releaseBob();

            await expect(pane.locator('.fm-memories-card')).toHaveCount(1, {timeout: 10000});
            await expect(pane).toContainText('@neo-gpt-bob · 1 of 1 sessions');
            await expect(pane.locator('.fm-memories-card').nth(0)).toContainText('Bob fixture session');
            await expect(older).toBeHidden();

            const memoriesRequests = fleet.requests.filter(request => request.method === 'fleetMemories');
            // The wire, in order: Ada's page zero from the roster selection; Ada's page zero AGAIN
            // from the rebuilt pane — a cold projection carrying a target and no snapshot re-reads
            // by design (memories/Container.mjs, onConstructed: a pane that renders "Reading X…"
            // forever is a hung claim), while the controller's read generation adopts the latest
            // response; the edge's one offset continuation (a second page-zero landing with the
            // same count announces no new edge); Bob's page zero. NO offset request for Bob exists
            // anywhere — his one card completes his corpus, so his edge asks nothing.
            expect(memoriesRequests.map(request => request.params)).toEqual([
                {agentIdentity: '@neo-opus-ada'},
                {agentIdentity: '@neo-opus-ada'},
                {agentIdentity: '@neo-opus-ada', offset: 2},
                {agentIdentity: '@neo-gpt-bob'}
            ]);
            // the wire carries the explicit target only — no viewer claim, no caller-chosen projection
            expect(memoriesRequests.every(request =>
                request.params.viewerIdentity === undefined && request.params.projection === undefined
            )).toBe(true)
        } finally {
            await fleet.close()
        }
    });

    /**
     * The populated registers, both skins: the summary cards over Ada's three sessions and, one
     * drill down, the turn cards — every pooled cell (even rows included) wears no engine grid
     * chrome, the pointer tints nothing, the row the engine's selection model marks paints
     * nothing, the registers carry no container frame; goldens of both registers in both skins
     * through the real ViewportController#setTheme. The empty pane's rhythm is the visual
     * config's golden; the cards' chrome lives here because only the wire populates them.
     *
     * Run: NEO_E2E_PORT=49223 NEO_TEST_SKIP_CI=true npx playwright test agentos/FleetMemoriesNL -c test/playwright/playwright.config.e2e.mjs --workers=1 --update-snapshots
     */
    test('populated registers: the summary and turn cards wear no grid chrome — lattice, stripe, hover, selection paint, frame — in both skins', async ({page, neuralLink}) => {
        const fleet = await startMemoriesFleet();

        // taller than the journey's viewport: the south register shows three summary cards and
        // both turns whole, so the goldens carry cards, not a sliver of one
        await page.setViewportSize({width: 1600, height: 1400});

        try {
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}`);
            await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
            await page.getByRole('tab', {name: 'Memories', exact: true}).click();

            const pane = page.locator('.fm-memories-pane');
            await expect(pane).toBeVisible({timeout: 10000});
            await page.locator('.fm-fleet-cards > .neo-list-item', {hasText: /\bAda\b/}).click();
            await expect(pane.locator('.fm-memories-card')).toHaveCount(3, {timeout: 10000});
            await expect(pane).toContainText(/@neo-opus-ada · 3 of 3 sessions/);
            await page.evaluate(() => document.fonts.ready);

            // the roster selection revealed the inspector on the right rail; a mousedown outside the
            // rail dismisses the reveal (Rail#onAppMouseDown → the machine's outsideClick) — the
            // register must be uncovered for the drill button and for the goldens
            await pane.locator('.fm-pane-title').click();
            await expect(page.locator('.neo-dashboard-dock-rail-tab.pressed'), 'the reveal is dismissed').toHaveCount(0, {timeout: 10000});
            await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

            const
                settleForGolden = async () => {
                    await page.mouse.move(8, 8);
                    await page.evaluate(() => document.querySelectorAll('.fm-memories-pane *').forEach(el => { if (el.scrollTop) { el.scrollTop = 0 } }));
                    await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);
                    await page.evaluate(() => document.fonts.ready)
                },
                chromeOf = selector => page.locator(selector).evaluateAll(cells => cells.map(cell => {
                    const style = getComputedStyle(cell),
                          row   = cell.closest('.neo-grid-row');

                    return {
                        background: style.backgroundColor,
                        border    : [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].join(' '),
                        padding   : [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
                        even      : row?.classList.contains('neo-even') ?? null,
                        selected  : row?.classList.contains('neo-selected') ?? null
                    }
                })),
                frameOf  = selector => page.locator(selector).evaluate(grid => getComputedStyle(grid).borderTopWidth),
                bare     = {background: 'rgba(0, 0, 0, 0)', border: '0px 0px 0px 0px', padding: '0px 0px 0px 0px'},
                assertBareRegister = async (name, selector) => {
                    const cells = await chromeOf(`${selector} .neo-grid-cell`);

                    expect(cells.length, `${name}: the pool is populated`).toBeGreaterThanOrEqual(2);
                    expect(cells.some(cell => cell.even), `${name}: the pool covers an even row`).toBe(true);
                    cells.forEach((cell, index) => expect(cell, `${name} cell ${index}`).toMatchObject(bare));
                    expect(await frameOf(selector), `${name}: no container frame`).toBe('0px')
                },
                [viewport] = await app.queryComponent({className: 'AgentOS.view.Viewport'}, ['id']),
                viewportState = await app.getComponent(viewport.properties.id, ['controller']),
                controllerId  = viewportState.controller.id,
                skins         = [['dark', 'neo-theme-neo-dark'], ['light', 'neo-theme-neo-light']],
                setSkin       = async theme => {
                    await app.callMethod(controllerId, 'setTheme', [theme, false]);
                    await expect(page.locator('.agent-os-viewport')).toHaveClass(new RegExp(`(?:^|\\s)${theme}(?:\\s|$)`));
                    await page.evaluate(() => document.fonts.ready)
                };

            // ── the summary register ──
            await assertBareRegister('summary', '.fm-memories-summary-grid');

            // the pointer over a card tints nothing (the engine's hover rule is re-bound to transparent)
            await pane.locator('.fm-memories-card').nth(1).hover();
            expect((await chromeOf('.fm-memories-summary-grid .neo-grid-cell'))[1].background, 'the hovered cell paints no tint').toBe('rgba(0, 0, 0, 0)');

            for (const [skin, theme] of skins) {
                await setSkin(theme);
                await settleForGolden();
                await expect(pane).toHaveScreenshot(`memories-summary-${skin}.png`)
            }

            // ── one drill down: the turn register ──
            await pane.locator('.fm-memories-card').nth(0).locator('.fm-memories-card-open').click();
            await expect(pane.locator('.fm-memories-turn-cell')).toHaveCount(2, {timeout: 10000});
            await expect(pane.locator('.fm-memories-turn').nth(0)).toContainText('Wake transport verified end to end');
            await expect(pane.locator('.fm-memories-turn').nth(1)).not.toContainText('Response unavailable');
            await page.evaluate(() => document.fonts.ready);

            await assertBareRegister('turns', '.fm-memories-turn-grid');

            // a click selects the turn into the reader: its row is marked, the card carries the
            // mark, no cell paints a band — and the reader holds the whole record, a missing thought named
            await pane.locator('.fm-memories-turn').nth(1).click();

            const reader = pane.locator('.fm-memories-reader');

            await expect(reader.locator('.fm-memories-read-label')).toHaveText(['Prompt', 'Thought', 'Response']);
            await expect(reader.locator('.fm-memories-read-text')).toHaveText([
                'Read the integrity contract.',
                'The plane returned no thought for this turn · turn turn-1',
                'The contract names two receipts per wake; the second one is the host\'s.'
            ]);
            (await chromeOf('.fm-memories-turn-grid .neo-grid-cell')).forEach((cell, index) => {
                expect(cell.background, `turn cell ${index} paints no selection band`).toBe('rgba(0, 0, 0, 0)')
            });
            expect((await chromeOf('.fm-memories-turn-grid .neo-grid-cell')).filter(cell => cell.selected), 'one marked row').toHaveLength(1);

            for (const [skin, theme] of [...skins].reverse()) {
                await setSkin(theme);
                await settleForGolden();
                await expect(pane).toHaveScreenshot(`memories-turns-${skin}.png`)
            }

            // Copy puts the field's whole text on the clipboard, through the main thread's selection
            const copyResponse = reader.getByRole('button', {name: 'Copy the response'});

            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await copyResponse.click();
            await expect(copyResponse).toHaveText('Copied');
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('The contract names two receipts per wake; the second one is the host\'s.')
        } finally {
            await fleet.close()
        }
    });

    /**
     * @summary Room for reading is the dock's own maximize, never a pane-local mode. A
     * selected summary reads whole beside its rail in the south strip; the strip's maximize toggle
     * paints the Memories node over the workspace and the reader takes the width; Escape restores
     * the strip, and the reading survives both moves.
     */
    test('reading takes the room through the dock\'s maximize, and Escape gives it back', async ({page, neuralLink}) => {
        const fleet = await startMemoriesFleet();

        try {
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}`);
            await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
            await page.getByRole('tab', {name: 'Memories', exact: true}).click();

            const
                pane   = page.locator('.fm-memories-pane'),
                reader = pane.locator('.fm-memories-reader'),
                strip  = page.locator('.neo-dashboard-dock-tabs', {has: page.getByRole('tab', {name: 'Memories', exact: true})}).first(),
                settle = () => expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

            await page.locator('.fm-fleet-cards > .neo-list-item', {hasText: /\bAda\b/}).click();
            await expect(pane.locator('.fm-memories-card')).toHaveCount(3, {timeout: 10000});
            await pane.locator('.fm-pane-title').click();   // dismiss the inspector's reveal
            await settle();

            await pane.locator('.fm-memories-card').nth(0).locator('.fm-memories-card-meta').click();
            await expect(reader.locator('.fm-memories-read-text')).toHaveText('Established verifiable wake transport between plane and host.');
            await expect(pane.locator('.fm-memories-summary-grid')).toHaveClass(/\bis-rail\b/);

            const docked = await reader.boundingBox();

            const readerHeight = async () => (await reader.boundingBox()).height;

            await strip.locator('.fa-window-maximize').first().click();
            // the FLIP lands after the click: the toggle flips to its restore glyph, then the rect grows
            await expect(strip.locator('.fa-window-minimize').first()).toBeVisible();
            await expect.poll(readerHeight, {message: 'the maximized node gives the reader the workspace height'}).toBeGreaterThan(docked.height * 2);
            await settle();
            await expect(reader.locator('.fm-memories-read-text'), 'the reading survives the move').toHaveText('Established verifiable wake transport between plane and host.');

            await page.keyboard.press('Escape');

            await expect.poll(readerHeight, {message: 'Escape returns the strip'}).toBeLessThan(docked.height * 1.5);
            await settle();
            await expect(reader.locator('.fm-memories-read-text')).toHaveText('Established verifiable wake transport between plane and host.')
        } finally {
            await fleet.close()
        }
    });

    /**
     * @summary Show all is one document whose rail follows the scroll, the reader's
     * title wraps, and at 720 px and below the pane is list OR reader — the rail collapses behind
     * the reader's back breadcrumb.
     */
    test('show all\'s rail follows the scroll, and the narrow regime swaps list and reader', async ({page, neuralLink}) => {
        const fleet = await startMemoriesFleet();

        try {
            await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.endpoint})}`);
            await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

            const app = await neuralLink.connectToApp('AgentOS');
            await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.endpoint, bearerToken: fleet.bearerToken});

            const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);
            await app.callMethod(cockpit.properties.id, 'controller.loadRoster');
            await page.getByRole('tab', {name: 'Memories', exact: true}).click();

            const
                pane     = page.locator('.fm-memories-pane'),
                reader   = pane.locator('.fm-memories-reader'),
                selected = () => pane.locator('.fm-memories-summary-grid .neo-grid-row.neo-selected').textContent();

            await page.locator('.fm-fleet-cards > .neo-list-item', {hasText: /\bAda\b/}).click();
            await expect(pane.locator('.fm-memories-card')).toHaveCount(3, {timeout: 10000});
            await pane.locator('.fm-pane-title').click();   // dismiss the inspector's reveal
            await expect(page.locator('.neo-dashboard-dock-animating')).toHaveCount(0);

            await pane.locator('.fm-memories-card').nth(0).locator('.fm-memories-card-meta').click();
            await pane.getByRole('button', {name: 'Show all'}).click();
            await expect(reader.locator('.fm-memories-read')).toHaveCount(3);
            expect(await selected()).toContain('Wake transport and integrity contracts');

            await reader.evaluate(node => node.scrollTop = node.scrollHeight);
            await expect.poll(selected, {message: 'the rail follows the record the reader shows'}).not.toContain('Wake transport and integrity contracts');

            expect(await reader.locator('.fm-memories-read-title').first().evaluate(title => {
                const style = getComputedStyle(title);
                return [style.whiteSpace, style.overflowWrap]
            }), 'a reading surface clips nothing: the title wraps').toEqual(['normal', 'anywhere']);

            await page.keyboard.press('Escape');   // leaves show all; the followed record stays read
            await expect(reader.locator('.fm-memories-read')).toHaveCount(1);

            await page.setViewportSize({width: 700, height: 1000});
            await expect(pane.locator('.fm-memories-list'), 'narrow and reading: the rail yields').toBeHidden();
            await reader.locator('.fm-memories-read-back').click();
            await expect(pane.locator('.fm-memories-list'), 'the breadcrumb returns to the list').toBeVisible();
            await expect(reader, 'an idle reader yields its room').toBeHidden()
        } finally {
            await fleet.close()
        }
    })
});
