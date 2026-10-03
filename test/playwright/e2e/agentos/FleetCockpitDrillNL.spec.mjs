import {expect, landFleetOpenWork, landFleetRoster, landFleetSample, test} from '../../fixtures.mjs';
import {sampleOpenWork, sampleRoster}                                      from '../../fixture/fleetSample.mjs';

/**
 * @summary The FM cockpit card→detail drill, proven LIVE through nested content inside the semantic
 * roster item — the basic "live drill" the detail-view AC requires. Clicking one resident's avatar
 * selects its li, reveals the auto-hidden AgentDetail inspector, and renders THAT resident: the
 * whole chain — native DOM click →
 * `Neo.selection.ListModel` → roster `onRosterSelect` → `agentSelect` → cockpit `onAgentSelect` → owner-held `detailRecord`
 * → dock `setItemAutoHidden` reveal → projection — is exercised end-to-end, never via a
 * controller call. Whitebox: the DOM proves the render, the possessed component proves the engine
 * truth (the mounted inspector holds the activated resident's record).
 *
 * @see apps/agentos/view/fleet/detail/Container.mjs
 * @see apps/agentos/view/fleet/cockpit/Controller.mjs (onAgentSelect)
 * @see test/playwright/e2e/agentos/FleetActivityStreamBurstNL.spec.mjs (sibling possession pattern)
 */
test.describe('AgentOS fleet cockpit — semantic roster item→detail live drill (#14608, #15212, #17553)', () => {
    test.setTimeout(90000);

    test('nested avatar content selects its resident and reveals the AgentDetail inspector + four panes', async ({page, neuralLink}) => {
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});
        await landFleetSample(page);
        await expect(page.locator('.fm-agent-card').first()).toBeVisible({timeout: 30000});

        const
            app       = await neuralLink.connectToApp('AgentOS'),
            cards     = await app.queryComponent({className: 'AgentOS.view.fleet.roster.card.Container'}, ['record', 'id']),
            [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);

        expect(cards.length, 'the fleet should render cards with records').toBeGreaterThan(0);
        expect(cockpit?.properties?.id, 'the cockpit should expose its committed dock document').toBeTruthy();

        // Pin ONE specific card and derive its EXACT durable identity + DOM element id (=== the
        // component id) — so activation and assertion reference the same resident, not the set.
        const target = cards.find(entry => entry?.properties?.record?.agentId && entry?.properties?.id);
        expect(target, 'a card exposes both a record agentId and a component id').toBeTruthy();

        const expectedAgentId = target.properties.record.agentId,
              targetCardId    = target.properties.id;

        const
            targetItem    = page.locator('.fm-fleet-cards > .neo-list-item', {
                has: page.locator(`[id="${targetCardId}"]`)
            }),
            detail        = page.locator('.fm-agent-detail'),
            readDockModel = async () => (await app.getComponent(cockpit.properties.id, ['dockModel'])).dockModel,
            dockBefore    = await readDockModel();

        expect(dockBefore.items.detail.autoHidden, 'the Fleet preset starts with detail auto-hidden').toBe(true);

        // The avatar is ordinary nested card content — not a lifecycle control. Its REAL DOM click
        // bubbles to the list's delegated selection path, proving whole-card selection without a
        // card-local click listener. The lifecycle-control carve-out has its own mounted witness.
        await targetItem.locator('.fm-card-avatar').click();
        await expect(targetItem, 'avatar activation selects the containing semantic item')
            .toHaveAttribute('aria-selected', 'true');

        // the auto-hidden inspector reveals + renders a resident + the four SSOT panes
        await expect(detail).toBeVisible({timeout: 15000});
        await expect(detail.locator('.fm-detail-name')).not.toBeEmpty();
        await expect(detail.locator('.fm-detail-pane')).toHaveCount(4);

        // The state ledger renders in the MOUNTED DOM (not merely worker vdom) — the drill-in
        // counterpart to the card's one honest word-line: every liveness/wiring axis once, as an
        // `axis · pill` row. The three source axes state themselves unconditionally, so every label
        // is present regardless of each source's wired/not-wired state; this is the resident-detail
        // contract the compact card deliberately cannot carry.
        await expect(detail.locator('.fm-detail-ledger')).toBeVisible();

        const ledgerReadout = await detail.locator('.fm-detail-ledger').innerText();
        expect(ledgerReadout, 'the inspector states the runtime source axis in the mounted DOM').toMatch(/runtime/i);
        expect(ledgerReadout, 'the inspector states the repository source axis').toMatch(/repository/i);
        expect(ledgerReadout, 'the inspector states the roster source axis').toMatch(/roster/i);

        const dockAfterDrill = await readDockModel();
        expect(dockAfterDrill.items.detail.autoHidden, 'nested avatar selection must commit the reveal').toBe(false);

        // Engine truth: the mounted inspector holds the EXACT activated resident — equality, not
        // set-membership. Delegated item selection routed through owner-held state to the durable id.
        const [d] = await app.queryComponent({className: 'AgentOS.view.fleet.detail.Container'}, ['record']);
        expect(d?.properties?.record?.agentId, 'the inspector drilled into the exact activated resident').toBe(expectedAgentId);

        // The four Status panes state their sources. The sample roster carries no repository
        // fact, so the repository pill says that in words, the same fact as the header's repository
        // axis; each pane without a producer on this plane keeps the honest unobserved label with
        // the producer it waits for on its title — a gap named, never a bug disguised.
        const pill = key => detail.locator(`.fm-detail-pane-${key} .fm-freshness`);

        await expect(pill('repo')).toHaveText('not wired — the roster row carried no repository fact', {timeout: 15000});
        await expect(detail.locator('.fm-detail-pane-repo .fm-detail-repo-slug')).toHaveText('no repository declared');

        await expect(pill('lane')).toHaveText('not wired — the roster row carried no lane claim fact');

        await expect(pill('thought-stream')).toHaveText('not observed — source not wired');
        await expect(pill('thought-stream')).toHaveAttribute('title', /policy-aware read/);
        await expect(pill('prs')).toHaveText('not observed — open-work read unanswered');

        // The Pull requests pane reads the cockpit's one open-work answer: the red head the seat
        // authored before the review it owes, each reference a link to the forge, and the card's chip
        // counting the same rows.
        const
            seat       = `@${expectedAgentId}`,
            observedAt = new Date().toISOString(),
            prRow      = (repo, number, ci, role) => ({repo, number, head: null, ci, verdict: null, mergeable: null, draft: false, reviews: [], observedAt, stale: false, holder: {role, ids: [seat]}}),
            prs        = detail.locator('.fm-detail-pane-prs .fm-detail-pr');

        await landFleetOpenWork(page, {...sampleOpenWork, observedAt, seats: {
            [seat]: {authored: [prRow('neomjs/neo', 19501, 'red', 'author')], reviewing: [prRow('neomjs/neo-agent-brain', 802, 'green', 'reviewer')]}
        }});

        await expect(prs).toHaveCount(2, {timeout: 15000});
        await expect(prs.nth(0).locator('.fm-detail-pr-ref')).toHaveText('neomjs/neo #19501');
        await expect(prs.nth(0).locator('.fm-detail-pr-ref')).toHaveAttribute('href', 'https://github.com/neomjs/neo/pull/19501');
        await expect(prs.nth(0).locator('.fm-detail-pr-line')).toHaveText(/^author · red · observed \d+s ago$/);
        await expect(prs.nth(1).locator('.fm-detail-pr-line')).toHaveText(/^reviewer · review due · observed \d+s ago$/);
        await expect(pill('prs')).toHaveText(/^updated \d+s ago$/);
        await expect(targetItem.locator('.fm-card-open-work')).toHaveText('2 PRs · red');

        // A roster answer that carries the resident's repository fact lands on the open inspector
        // through the roster's own reconcile: the pill dates from that admission and the pane shows
        // the row's slug and clone path — one producer for the header row, the card and the pane.
        const laneLine = 'Keeping the fixture lane visible',
              laneClaimedAt = new Date(Date.now() - 12 * 60_000).toISOString();

        await landFleetRoster(page, sampleRoster.map(row => row.agentId === expectedAgentId ? {
            ...row,
            repoSlug: 'neomjs/neo',
            repoPath: '/seats/neo/clone',
            laneLine,
            laneClaimedAt,
            sources : {
                ...row.sources,
                repoStatus: {source: 'fleet:fleetStatus', state: 'wired', confidence: 'observed', reason: null},
                lane      : {source: 'memory-core:mailbox', state: 'wired', confidence: 'observed', reason: null}
            }
        } : row));

        await expect(pill('repo')).toHaveText(/^updated \d+s ago$/, {timeout: 15000});
        await expect(pill('repo')).toHaveClass(/\bis-fresh\b/);
        await expect(detail.locator('.fm-detail-pane-repo .fm-detail-repo-slug')).toHaveText('neomjs/neo');
        await expect(detail.locator('.fm-detail-pane-repo .fm-detail-repo-path')).toHaveText('/seats/neo/clone');
        await expect(detail.locator('.fm-detail-ledger'), 'the header row reads the same fact').toContainText(/repository\s*wired · observed/);

        await expect(targetItem.locator('.fm-card-lane')).toContainText(laneLine);
        await expect(targetItem.locator('.fm-card-lane')).toContainText(/claimed \d+m ago/);
        await expect(pill('lane')).toHaveText(/^updated \d+s ago$/);
        await expect(pill('lane')).toHaveClass(/\bis-fresh\b/);
        await expect(detail.locator('.fm-detail-pane-lane .fm-detail-pane-body')).toContainText(laneLine);
        await expect(detail.locator('.fm-detail-pane-lane .fm-detail-pane-body')).toContainText(/claimed \d+m ago/)
    })
});

