export {
    expect,
    loadAgentOsModule,
    loadNeuralLinkModules,
    test
} from '../../node_modules/neo.mjs/test/playwright/fixtures.mjs';

import {sampleActivity, sampleDefinitions, sampleRoster} from './fixture/fleetSample.mjs';

/**
 * @summary What an arm that closes a window on purpose names with `workerErrors.expect`: the components
 * leaving with that window still address it (addon teardown, a grid's size pass), and the engine reports each
 * send as an App Worker error — its typed dead-port sentence, or the main thread finding no worker under the
 * window's uuid. Only windows are uuid-named: a missing `data` or `vdom` worker still fails the arm, as does
 * every other error. Delete with its callers once the engine's unhandled-rejection boundary disposes of a
 * departed window's sends itself.
 * @type {RegExp}
 */
export const departedWindowSends = /^App Worker: Error: (?:worker\.Base#promiseMessage: no live port for destination "[0-9a-f-]{36}" \([^)]*\) — a window closed\?|Target worker '[0-9a-f-]{36}' does not exist\.)/;

/**
 * The landing's path as `Neo.worker.App.loadModule` imports it: relative to the App worker's own module
 * under `node_modules/neo.mjs/src/worker/`, four levels above the checkout.
 * @type {String}
 */
const FLEET_LANDING = '../../../../test/playwright/fixture/FleetLanding.mjs';

let fleetLandingTick = 0;

/**
 * @summary Loads the landing into the App worker under a fresh URL: its instance survives, the load finds it.
 * @param {Object} page The Playwright page.
 * @returns {Promise<void>}
 */
async function loadLanding(page) {
    const loaded = await page.evaluate(path => Neo.worker.App.loadModule({path}), `${FLEET_LANDING}?t=${++fleetLandingTick}`);

    if (!loaded?.success) {
        throw new Error(`the fleet landing did not load: ${JSON.stringify(loaded)}`)
    }
}

/**
 * @summary The mounted Viewport provider's `setupRun` leaves (`{decisions, manualActions, preset, runId}`),
 * read inside the App worker through the landing.
 * @param {Object} page The Playwright page.
 * @returns {Promise<Object|null>}
 */
export async function readSetupRun(page) {
    await loadLanding(page);

    return page.evaluate(() => Neo.worker.App.getConfigs({id: 'fm-fleet-landing', keys: 'setupRun'}))
}

/**
 * @summary Sets the landing's configs inside the App worker, then `Neo.worker.App.setConfigs` carries the payload.
 * @param {Object} page The Playwright page.
 * @param {Object} configs `{roster: {rows}}`, `{activity: {events}}`, `{tasks: {snapshot}}`, `{mailbox: {events}}`
 *     and/or `{definitions: {rows}}`.
 * @returns {Promise<void>}
 */
async function landFleet(page, configs) {
    await loadLanding(page);

    const landed = await page.evaluate(data => Neo.worker.App.setConfigs(data), {id: 'fm-fleet-landing', ...configs});

    if (!landed?.success) {
        throw new Error(`landFleet: the landing refused: ${landed?.error?.message ?? JSON.stringify(landed)}`)
    }
}

/**
 * @summary Serves a mailbox the mounted cockpit reads through its bridge: every `fleetActivity` read answers
 * the events' page at its offset. The spec reads the reads with `readMailboxReads` on `fm-fleet-landing`.
 * @param {Object} page The Playwright page.
 * @param {Object[]} events The stream's snapshot shape, newest first.
 * @returns {Promise<void>}
 */
export async function serveFleetMailbox(page, events) {
    await landFleet(page, {mailbox: {events}})
}

/**
 * @summary Lands activity events in the mounted cockpit as a wired feed's answer.
 * @param {Object} page The Playwright page.
 * @param {Object[]} events The stream's snapshot shape.
 * @returns {Promise<void>}
 */
export async function landFleetActivity(page, events) {
    await landFleet(page, {activity: {events}})
}

/**
 * @summary Lands a roster in the mounted cockpit as the fleet's answer, through the liveness owner's
 * own admission: the first landing replaces, a later one reconciles, the surface reads `live`.
 * @param {Object} page The Playwright page.
 * @param {Object[]} rows The roster store's record shape.
 * @returns {Promise<void>}
 */
export async function landFleetRoster(page, rows) {
    await landFleet(page, {roster: {rows}})
}

/**
 * @summary Lands agent definitions as the registry's answer: they replace the Viewport provider's
 * `agentDefinitions` Store, the Accounts view's source.
 * @param {Object} page The Playwright page.
 * @param {Object[]} [rows=sampleDefinitions] Public definitions (`test/playwright/fixture/fleetSample.mjs`).
 * @returns {Promise<void>}
 */
export async function landAgentDefinitions(page, rows=sampleDefinitions) {
    await landFleet(page, {definitions: {rows}})
}

/**
 * @summary Land a test-owned tasks envelope, or `null` for the unobserved cold state, through
 * the cockpit owner's App-worker admission path.
 * @param {Object} page The Playwright page.
 * @param {Object|null} snapshot One `fleetTasks` envelope or the unobserved state.
 * @returns {Promise<void>}
 */
export async function landFleetTasks(page, snapshot) {
    await landFleet(page, {tasks: {snapshot}})
}

/**
 * @summary Lands the tests' sample fleet (`test/playwright/fixture/fleetSample.mjs`): eleven roster
 * cards and six activity events, as live answers. A spec that reads cards or events calls this after
 * the cockpit is visible; it resolves once the first card renders.
 * @param {Object} page The Playwright page.
 * @param {Object} [options]
 * @param {Boolean} [options.roster=true] Land the roster.
 * @param {Boolean} [options.activity=true] Land the activity events.
 * @returns {Promise<void>}
 */
export async function landFleetSample(page, {roster = true, activity = true} = {}) {
    await landFleet(page, {
        ...(roster   && {roster  : {rows  : sampleRoster}}),
        ...(activity && {activity: {events: sampleActivity}})
    });

    roster && await page.locator('.fm-fleet-cards .fm-agent-card').first().waitFor({state: 'visible', timeout: 30000})
}
