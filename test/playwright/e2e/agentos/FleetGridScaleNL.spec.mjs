import {test, expect} from '../../fixtures.mjs';

/**
 * @summary The fleet grid at MEASURED live-roster scale, proven through Neural Link possession —
 * the density-evidence numbers made executable: a 20-agent roster (the evidence's near-term
 * ceiling band) loaded into the REAL provider-hosted FleetRoster store over the wire, then the
 * mounted grid asserted at the DOM: the online tier leads as cards, the idle tier folds to an
 * honest count (never a silent drop), the benched tail renders, and the health counters track the
 * possessed store. This is the leaf's "NL-verifiable mount bound to the live roster" — the unit
 * suite proves the ranking math; THIS proves the mounted surface obeys it at scale.
 *
 * @see apps/agentos/view/fleet/roster/Container.mjs
 * @see test/playwright/unit/apps/agentos/view/fleet/roster/container.spec.mjs
 */
test.describe('AgentOS fleet grid — density-evidence scale (Neural Link)', () => {
    test.setTimeout(90000);

    test('a 20-agent roster ranks, folds, and counts on the mounted grid via NL store possession', async ({page, neuralLink}) => {
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});
        await expect(page.locator('.fm-fleet-grid')).toBeVisible({timeout: 30000});

        // The seeded roster arrives via the store's ASYNC autoLoad fetch — possess only after it
        // landed, or the late seed load replaces the fixture (measured: a fixture written before
        // the fetch resolves reads back as the 7-row seed).
        await expect(page.locator('.fm-fleet-title')).not.toHaveText('Fleet · 0 agents', {timeout: 30000});
        // …and rendered: the title flips on the load event while the seed's records are still being
        // seated; possessing in that window reads back empty (the sibling AgentCard witness waits
        // for the first card for the same reason)
        await expect(page.locator('.fm-agent-card').first()).toBeVisible({timeout: 30000});

        // The provider-hosted FleetRoster instance, addressed by class — the store registry lists
        // more than one store of the FleetAgent model since the August rebuilds, and the first
        // registry hit is not the one the grid renders from (the sibling AgentCard witness's shape).
        // The instance question (#78): the class query answers TWO instances — the provider-hosted
        // store and its `-all` twin, the engine's unfiltered projection the roster's filters create
        // (`Neo.collection.Base#filter` clones the store's own class as `<id>-all`). The grid binds
        // the store; the twin is where the whole fleet lives once a filter is active.
        const
            app       = await neuralLink.connectToApp('AgentOS'),
            found     = await app.findInstances({className: 'AgentOS.store.FleetRoster'}, ['id']),
            instances = Array.isArray(found) ? found : [found],
            roster    = instances.find(instance => !instance?.id?.endsWith('-all')),
            wholeId   = `${roster?.id}-all`;

        expect(roster?.id, 'the provider-hosted FleetRoster store should be registered in the App Worker').toBeTruthy();
        expect(instances.some(instance => instance?.id === wholeId), 'the store carries its unfiltered twin').toBe(true);

        // The 20-agent fixture at the evidence's ceiling band: 4 online (2 ok + 1 limited +
        // 1 wedged) · 14 idle · 2 benched — over the density-derived fold threshold (12).
        const fixture = [
            ...['scale-ok-a', 'scale-ok-b'].map(agentId => ({agentId, state: 'ok'})),
            {agentId: 'scale-limited-a', state: 'limited'},
            {agentId: 'scale-wedged-a', state: 'wedged'},
            ...Array.from({length: 14}, (item, index) => ({agentId: `scale-idle-${String(index).padStart(2, '0')}`, state: 'idle'})),
            ...['scale-off-a', 'scale-off-b'].map(agentId => ({agentId, state: 'off'}))
        ].map(entry => ({
            // production-shaped rows: the model admits a resident with its identity handle and
            // its per-source provenance (the keyboard witness's row shape) — a bare id row is
            // refused at the record boundary since the August rebuilds
            avatarUrl     : '',
            displayName   : entry.agentId,
            engineTag     : 'fixture',
            family        : 'claude',
            githubUsername: entry.agentId,
            laneLine      : 'density-scale fixture row',
            lifecycle     : {source: 'fleet:runtimeStatus', state: entry.state === 'off' ? 'stopped' : 'running', confidence: 'observed'},
            sources       : {
                roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
                repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
                runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
            },
            ...entry
        }));

        // Possession: replace the roster through the store's OWN collection api over the wire —
        // the callMethod idiom the sibling lifecycle spec proves (clear, then add the fixture).
        await app.callMethod(roster.id, 'clear');
        await app.callMethod(roster.id, 'add', [fixture]);

        // The possessed store is the source of truth the grid derives from — read BOTH halves.
        // The whole fleet lives in the unfiltered twin (20); the view the grid renders is the
        // folded one: 14 idle rows filtered out by the density preset, 6 rows left (`items` /
        // `count`). `totalCount` is the remote-paging field frozen at the last URL load — it
        // deliberately does not track local mutations, so it must never gate this.
        await expect.poll(() => app.callMethod(wholeId, 'getCount'), {
            message: 'the whole fleet lands in the unfiltered twin', timeout: 10000, intervals: [100]
        }).toBe(20);

        const snapshot = await app.inspectStore(roster.id, 25);
        expect(snapshot.count, 'the folded view keeps every non-idle resident').toBe(6);
        expect(snapshot.items.map(item => item.agentId).sort()).toEqual(
            ['scale-limited-a', 'scale-off-a', 'scale-off-b', 'scale-ok-a', 'scale-ok-b', 'scale-wedged-a']
        );

        // DOM verdicts — the mounted surface obeys the density rules:
        // the header title tracks the possessed total,
        await expect(page.locator('.fm-fleet-title')).toHaveText('Fleet · 20 agents');
        // the idle tier folds to an honest count (14 idle never render as 14 cards),
        await expect(page.locator('.fm-roster-fold')).toHaveText('+14 idle · show');
        // online (4) + benched (2) stay as cards — working-first keeps the glance priority,
        await expect(page.locator('.fm-fleet-cards .fm-agent-card')).toHaveCount(6);
        // and dropping back BELOW threshold un-folds: every card renders again.
        await app.callMethod(roster.id, 'clear');
        await app.callMethod(roster.id, 'add', [fixture.slice(0, 6)]);

        await expect(page.locator('.fm-roster-fold')).toBeHidden();
        await expect(page.locator('.fm-fleet-title')).toHaveText('Fleet · 6 agents')
    });
});
