import {test, expect} from '../../fixtures.mjs';
import {execFileSync} from 'node:child_process';
import path           from 'node:path';
import {
    startRealFleetServer,
    wireAuthenticatedFleetBridge,
    wireRealFleetSources
} from './authenticatedFleetHarness.mjs';

/**
 * @summary Row 2's walkthrough, its fixture half: the states a peer can provoke without the team's
 * plane, provoked in turn on one mounted cockpit against a real Fleet server, with every census
 * surface the page carries read in each (`learn/CockpitStateWalkthrough.md` is the script,
 * `learn/CockpitStateCensus.md` the expected words). Each state's words are attached as its receipt,
 * `receipt-<state>.json`, beside the Institution and Brain revisions the run read.
 *
 * Run: NEO_AGENTOS_RUNTIME_ROOT=<a Brain checkout at the pin> npm run test-e2e -- agentos/CockpitStateWalkthroughNL --workers=1
 */

const
    // the sentence, then the run's own cause: pinned to its source, so a word added between the two shows
    reason = (prefix, cause) => expect.stringMatching(new RegExp(`^${prefix} · ${cause}$`)),
    lost   = 'fleet: request transport failed',
    rows   = 'sources · mailbox · 1 / 24h · 1 total',
    empty  = {title: 'Fleet · 0 agents', marker: null, emptyCta: 'Add your first agent'},
    /**
     * The census cells each state's words must match, surface by surface: `learn/CockpitStateCensus.md`
     * made executable for the cockpit page. A cell that changes on either side fails here first.
     * @type {Object}
     */
    CENSUS = {
        cold: {
            banner  : {kind: 'cold', pill: 'fleet offline', sentence: 'Fleet server offline — start it from the neo-agent-brain checkout'},
            roster  : {...empty, marker: 'not answered yet', emptyCta: null},
            activity: {head: 'not answered yet', sources: null, note: null},
            switcher: expect.stringMatching(/ — not connected$/)
        },
        unreachable: {
            banner  : {kind: 'cold', pill: 'fleet unreachable', sentence: reason('Roster connection unavailable — no fleet data yet', lost)},
            roster  : {...empty, marker: 'not answered yet', emptyCta: null},
            activity: {head: 'not answered yet', sources: null, note: null},
            switcher: expect.stringMatching(/ — not connected$/)
        },
        live: {
            banner  : null,
            roster  : empty,
            activity: {head: '● streaming', sources: rows, note: null},
            switcher: expect.stringMatching(/ — connected$/)
        },
        stale: {
            banner  : {kind: 'degraded', pill: 'fleet unreachable', sentence: reason('Roster connection unavailable — showing last-known data', lost)},
            roster  : {...empty, marker: 'stale — reconnecting'},
            activity: {head: 'stale — reconnecting', sources: rows, note: null},
            switcher: expect.stringMatching(/ — degraded$/)
        },
        'one-source-failing': {
            // the PR/lane reader's own failure, whose text carries this checkout's path
            banner  : {kind: 'degraded', pill: 'feed partial', sentence: reason('Activity feed partial — some sources unavailable', 'pr-lane: neo: ENOENT: [^·]+')},
            roster  : empty,
            activity: {head: 'partial — some sources unavailable', sources: rows, note: null},
            switcher: expect.stringMatching(/ — degraded$/)
        },
        degraded: {
            banner  : {kind: 'degraded', pill: 'agent os degraded', sentence: 'Agent OS degraded — showing the cockpit over a partial organism · the wake daemon stopped answering'},
            roster  : empty,
            activity: {head: 'partial — some sources unavailable', sources: rows, note: null},
            switcher: expect.stringMatching(/ — degraded$/)
        }
    };

/**
 * @summary The words every census surface on the cockpit page shows now. A hidden surface reads null.
 * @param {Object} page
 * @returns {Promise<Object>}
 */
const readSurfaces = page => page.evaluate(() => {
    const
        visible = element => Boolean(element) && element.offsetParent !== null,
        text    = selector => {
            const element = document.querySelector(selector);

            return visible(element) ? element.textContent.trim() || null : null
        },
        banner  = [...document.querySelectorAll('.fm-spine-banner')].find(visible),
        trigger = document.querySelector('.fm-instance-switcher.fm-instance-trigger');

    return {
        banner  : banner ? {
            kind    : [...banner.classList].find(cls => cls.startsWith('fm-spine-banner-'))?.slice('fm-spine-banner-'.length) ?? null,
            pill    : banner.textContent.trim(),
            sentence: banner.getAttribute('title')
        } : null,
        roster  : {title: text('.fm-fleet-title'), marker: text('.fm-fleet-stale'), emptyCta: text('.fm-fleet-empty-cta')},
        activity: {head: text('.fm-stream-state'), sources: text('.fm-stream-sources'), note: text('.fm-stream-empty')},
        switcher: trigger?.getAttribute('aria-label') ?? null
    }
});

/**
 * @summary The revision a checkout is at.
 * @param {String} cwd
 * @returns {String}
 */
const revisionOf = cwd => execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

test.describe('AgentOS cockpit — row 2\'s walkthrough on a fixture Fleet server', () => {
    test.setTimeout(180000);

    test('each provoked state is read on every census surface of the cockpit page and attached as its receipt', async ({page, neuralLink}, testInfo) => {
        const
            revisions = {institution: revisionOf(process.cwd()), brain: revisionOf(path.resolve(process.env.NEO_AGENTOS_RUNTIME_ROOT))},
            receipts  = {},
            receipt   = async (state, provocation) => {
                let words;

                // a read still in flight shows its own words first, so the page gets time to settle on the cell
                await expect.poll(async () => words = await readSurfaces(page), {
                    message: `${state}: every surface on the page reads its census cell`, timeout: 15000, intervals: [250]
                }).toEqual(CENSUS[state]);

                receipts[state] = {state, provocation, revisions, words};
                await testInfo.attach(`receipt-${state}.json`, {body: JSON.stringify(receipts[state], null, 4), contentType: 'application/json'})
            };

        // one A2A row from the start, so the live feed has rows a stale one can keep
        const listMessages = async () => ({messages: [{messageId: 'MESSAGE:walkthrough', from: '@fixture-sender', to: '@e2e-operator',
            subject: 'a row the stale feed keeps', sentAt: new Date().toISOString(), priority: 'normal'}], totalCount: 1, truncated: false, offset: 0});

        await wireRealFleetSources({listMessages});

        let fleet = await startRealFleetServer();

        const
            fleetPort = fleet.port,
            dead      = await startRealFleetServer();

        // a port that answered once and no longer listens: the address an unreachable instance names
        await dead.close();

        await page.goto('/apps/agentos/index.html');
        await expect(page.locator('.fm-fleet-cockpit')).toBeVisible({timeout: 60000});

        const
            app        = await neuralLink.connectToApp('AgentOS'),
            [cockpit]  = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']),
            cockpitId  = cockpit.properties.id,
            readState  = async () => (await app.callMethod(cockpitId, 'getStateProvider'))?.data ?? {},
            settle     = (read, value, message) => expect.poll(read, {message, timeout: 30000, intervals: [250]}).toBe(value),
            switchTo   = async server => {
                await wireAuthenticatedFleetBridge({app, fleetUrl: server.endpoint, bearerToken: server.bearerToken});
                await app.callMethod(cockpitId, 'controller.reconnectFleet')
            };

        await receipt('cold', 'the cockpit mounted on its fail-closed bridge; nothing has answered');

        await switchTo(dead);
        await settle(async () => (await readState()).gridConnection?.state, 'unreachable', 'the roster read names the dead address');
        await receipt('unreachable', 'the bridge re-pointed at a loopback address nothing listens on: the transport half of an instance switch');

        await switchTo(fleet);
        await settle(async () => (await readState()).gridAdapterState, 'live', 'the roster answers from the real bridge');
        await settle(async () => (await readState()).streamAdapterState, 'live', 'the activity answers from the real producer');
        await receipt('live', 'the bridge re-pointed back at the answering Fleet server');

        // the liveness timer drives every later edge, on a fast cadence
        await app.setProperties(cockpitId, {
            livenessCadence     : {activity: 0, roster: 0, brainHealth: 0, tasks: 0, deploymentState: 0},
            livenessPollInterval: 300,
            livenessReadTimeout : 2500
        });
        await app.callMethod(cockpitId, 'controller.stopLiveness');
        await app.callMethod(cockpitId, 'controller.startLiveness');

        await fleet.close();
        await settle(async () => (await readState()).gridAdapterState, 'stale', 'the roster keeps its last answer when the transport dies');
        await settle(async () => (await readState()).streamAdapterState, 'stale', 'the activity keeps its last answer when the transport dies');
        await receipt('stale', 'the Fleet server stopped after answering; its last answer is all the cockpit has');

        // the same server back, with its PR/lane source failing while the A2A source answers
        await wireRealFleetSources({issuesDir: path.join(testInfo.project.testDir, '../fixtures/issues/missing-corpus'), listMessages});
        fleet = await startRealFleetServer({port: fleetPort, bearerToken: fleet.bearerToken});
        await settle(async () => (await readState()).streamAdapterState, 'partial', 'one source failing leaves the activity partial');
        await receipt('one-source-failing', 'the PR/lane source reads a missing corpus while the A2A source answers');

        // a browser has no lifecycle owner, so the shell's answer arrives through the cockpit's fixture handle
        await app.callMethod(cockpitId, 'controller.stopLiveness');
        await app.callMethod(cockpitId, 'controller.applyBrainHealth', [{state: 'degraded', cause: {source: 'wake-daemon', detail: 'the wake daemon stopped answering'}}]);
        await settle(async () => (await readSurfaces(page)).banner?.kind, 'degraded', 'the banner names the daemon fault');
        await receipt('degraded', 'the shell\'s lifecycle answer `degraded` applied through applyBrainHealth');

        await fleet.close();

        expect(Object.keys(receipts)).toEqual(['cold', 'unreachable', 'live', 'stale', 'one-source-failing', 'degraded'])
    });
});
