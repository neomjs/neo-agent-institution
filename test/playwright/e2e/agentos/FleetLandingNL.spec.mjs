import {expect, landFleetRoster, landFleetSample, test} from '../../fixtures.mjs';
import {sampleActivity, sampleRoster}                    from '../../fixture/fleetSample.mjs';

/**
 * The tests' fleet landing (`test/playwright/fixture/FleetLanding.mjs`) read back through the
 * cockpit's own provider: the sample lands as eleven cards in the roster's order and six events,
 * both surfaces `live`; a spec's own rows land through the same seam, and landing again reconciles
 * instead of replacing — the contract every spec that needs cards or events relies on.
 */
test.describe('Fleet cockpit — the tests\' fleet landing (NL)', () => {
    const readProvider = async app => {
        const
            [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
            state     = await app.getComponent(cockpit.properties.id, ['stateProvider']);

        return state.stateProvider
    };

    test('landing the sample renders eleven cards and six events as live surfaces', async ({page, neuralLink}) => {
        await page.setViewportSize({width: 1600, height: 1100});
        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const app = await neuralLink.connectToApp('AgentOS');

        await landFleetSample(page);

        await expect(page.locator('.fm-fleet-cards .fm-agent-card')).toHaveCount(sampleRoster.length);
        await expect(page.locator('.fm-fleet-cards .fm-agent-card .fm-card-name').first()).toHaveText(sampleRoster[0].displayName);

        const {data, stores} = await readProvider(app);

        expect(data.gridAdapterState).toBe('live');
        expect(data.streamAdapterState).toBe('live');
        expect(data.gridDegradedReason).toBeNull();
        expect(stores.fleetRoster.count).toBe(sampleRoster.length);
        expect(stores.fleetActivityEvents.count).toBe(sampleActivity.length)
    });

    test('a spec\'s own rows land through the same seam, and landing again reconciles', async ({page, neuralLink}) => {
        const row = agentId => ({
            agentId,
            avatarUrl     : '',
            displayName   : agentId,
            engineTag     : 'fixture',
            family        : 'claude',
            githubUsername: agentId,
            laneLine      : 'landing fixture row',
            state         : 'ok'
        });

        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const app = await neuralLink.connectToApp('AgentOS');

        await landFleetRoster(page, ['land-a', 'land-b', 'land-c'].map(row));
        await expect(page.locator('.fm-fleet-cards .fm-agent-card')).toHaveCount(3);
        await expect(page.locator('.fm-fleet-cards .fm-agent-card .fm-card-name').first()).toHaveText('land-a');

        await landFleetRoster(page, ['land-b', 'land-d'].map(row));
        await expect(page.locator('.fm-fleet-cards .fm-agent-card')).toHaveCount(2);

        const {data, stores} = await readProvider(app);

        expect(data.gridAdapterState).toBe('live');
        expect(stores.fleetRoster.count).toBe(2)
    });
});
