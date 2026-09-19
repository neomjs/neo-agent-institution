import {test, expect, loadAgentOsModule}                                       from '../../fixtures.mjs';
import {authenticatedFleetOptions, reloadRoster, wireAuthenticatedFleetBridge} from './authenticatedFleetHarness.mjs';
import {EventEmitter}                                                          from 'node:events';
import fs                                                                      from 'node:fs';
import os                                                                      from 'node:os';
import path                                                                    from 'node:path';

const [
    {startFleetBridgeServer},
    {default: FleetLifecycleService},
    {default: FleetRegistryService}
] = await Promise.all([
    loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
    loadAgentOsModule('ai/services/fleet/FleetLifecycleService.mjs'),
    loadAgentOsModule('ai/services/fleet/FleetRegistryService.mjs')
]);

const
    ADDED_SEAT    = 'first-launch-seat',
    EXTERNAL_SEAT = 'external-harness-seat',
    PAT           = 'github_pat_FIRST_LAUNCH_WITNESS_1234abcd';

/**
 * @summary A child that stays up until killed, so the fleet holds a live process record exactly as
 * after a real launch, while nothing is executed.
 */
class RecordedChild extends EventEmitter {
    pid    = 0
    stderr = new EventEmitter()
    stdout = new EventEmitter()

    kill(signal) {
        queueMicrotask(() => this.emit('exit', 0, signal));
        return true
    }
}

/**
 * @summary The §04 bar — "the operator starts an agent from the cockpit UI instead of a terminal" — on
 * the REAL Fleet pipeline: the registry on a disposable data dir, the manager, the lifecycle service and
 * the cockpit status, served over the authenticated bridge exactly as the dev fleet server serves them.
 * One seam is replaced: the process spawn, by a recorder. A seat added in the cockpit is fleet-launched,
 * so its first Start comes from the cockpit and launches exactly once; a seat registered anywhere else
 * runs outside fleet supervision, so neither its Start nor "Start fleet" may launch a second session.
 */
test.describe('AgentOS §04 — the first launch of a seat from the cockpit (Neural Link)', () => {
    // the Brain services are process singletons: one arm at a time
    test.describe.configure({mode: 'serial'});
    test.setTimeout(120000);

    let fleet, launches, restore;

    test.beforeEach(async () => {
        const
            dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-first-launch-')),
            prior   = {
                execFileFn        : FleetLifecycleService.execFileFn,
                harnessBinaryPaths: FleetLifecycleService.harnessBinaryPaths,
                instanceRoot      : FleetLifecycleService.instanceRoot,
                spawnFn           : FleetLifecycleService.spawnFn
            },
            priorDataDir = FleetRegistryService.dataDir;

        launches = [];
        FleetRegistryService.dataDir = dataDir;
        FleetLifecycleService.processes.clear();

        Object.assign(FleetLifecycleService, {
            execFileFn        : () => {},                     // the harness version probe runs nothing
            harnessBinaryPaths: {codex: process.execPath},    // a real executable for the launch preflight
            instanceRoot      : path.join(dataDir, 'instances'),
            spawnFn           : (command, args) => (launches.push({args, command}), new RecordedChild())
        });

        const
            options = authenticatedFleetOptions(),
            server  = await startFleetBridgeServer(options);

        fleet = {bearerToken: options.bearerToken, fleetUrl: `http://127.0.0.1:${server.address().port}/fleet`};

        restore = async () => {
            await new Promise(resolve => server.close(resolve));
            FleetLifecycleService.processes.clear();
            Object.assign(FleetLifecycleService, prior);
            FleetRegistryService.dataDir = priorDataDir;
            fs.rmSync(dataDir, {force: true, recursive: true})
        }
    });

    test.afterEach(async () => {
        await restore?.()
    });

    /**
     * @summary Boot the cockpit, flip its fail-closed bridge live, and re-read the roster that raced it.
     * @param {Object} fixtures `{page, neuralLink}`.
     */
    async function bootCockpit({page, neuralLink}) {
        await page.goto(`/apps/agentos/index.html?${new URLSearchParams({fleetUrl: fleet.fleetUrl})}`);
        await expect(page.locator('.agent-shell')).toBeVisible({timeout: 60000});

        const app = await neuralLink.connectToApp('AgentOS');

        await wireAuthenticatedFleetBridge({app, fleetUrl: fleet.fleetUrl, bearerToken: fleet.bearerToken});
        await reloadRoster(app)
    }

    test('a seat added in the cockpit starts from the cockpit: one click, exactly one launch, the card reaches running', async ({page, neuralLink}) => {
        await bootCockpit({page, neuralLink});
        await expect(page.locator('.fm-fleet-title')).toHaveText('Fleet · 0 agents', {timeout: 30000});

        await page.locator('.fm-fleet-empty-cta').click();
        await expect(page.locator('.fm-add-agent-form')).toBeVisible({timeout: 30000});
        await page.locator('.fm-add-agent-form input[type="text"]').fill(ADDED_SEAT);
        await page.locator('.fm-add-agent-form input[type="password"]').fill(PAT);
        await page.locator('.fm-add-submit').click();
        await expect(page.locator('.fm-add-status.is-readback-confirmed')).toBeVisible({timeout: 15000});

        const
            card   = page.locator('.fm-fleet-cards .fm-agent-card'),
            toggle = card.locator('.fm-card-control-verbs button').first();

        await expect(card).toHaveCount(1, {timeout: 30000});

        // never launched, and startable all the same — the control names why
        await expect(toggle.locator('.fa-play')).toBeVisible();
        await expect(toggle).toBeEnabled({timeout: 30000});
        await expect(toggle).toHaveAttribute('title', /only launcher/);
        expect(launches).toHaveLength(0);

        await toggle.click();

        await expect(toggle.locator('.fa-stop')).toBeVisible({timeout: 30000});
        expect(launches).toHaveLength(1);
        expect(launches[0].command).toBe(process.execPath);

        // the registry holds the cockpit's declaration: this fleet is the seat's only launcher
        expect(FleetRegistryService.listAgents().map(agent => agent.launchOwner)).toEqual(['fleet'])
    });

    test('a seat registered outside the cockpit runs outside fleet supervision: its Start is closed with the reason, and Start fleet launches nothing', async ({page, neuralLink}) => {
        // the registration every non-cockpit seat gets: no launch owner declared
        FleetRegistryService.defineAgent({credential: PAT, githubUsername: EXTERNAL_SEAT, harnessType: 'codex'});

        await bootCockpit({page, neuralLink});
        await expect(page.locator('.fm-fleet-title')).toHaveText('Fleet · 1 agents', {timeout: 30000});

        const toggle = page.locator('.fm-fleet-cards .fm-agent-card .fm-card-control-verbs button').first();

        await expect(toggle).toBeDisabled();
        await expect(toggle).toHaveAttribute('title', /outside fleet supervision/);

        await page.locator('.fm-fleet-start').click();
        await expect(page.locator('.fm-fleet-start-summary')).toContainText('1 excluded', {timeout: 15000});
        expect(launches).toHaveLength(0)
    });
});
