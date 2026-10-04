import {mkdtempSync}  from 'node:fs';
import {tmpdir}       from 'node:os';
import path           from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONFIG_SOURCE_PATH, createSetupBroker, loadSetupModules} from '../../../harness/setupBroker.mjs';

/**
 * @module test/playwright/fixture/pinnedSetupHost
 * @summary The setup broker over the PINNED Brain with the world outside the host's files scripted:
 * the one fixture the broker's unit arms and the setup card's e2e share. Recipe, record, host
 * effects, orchestration and the verify effect are the pinned Brain's; a row's status and reason are
 * always its answer, never written here. Scripted are facts only: what the machine has, which
 * commands were asked for (recorded, never run), what the plane answers.
 */

export const GiB = 1073741824;

/**
 * The pinned Brain package the recipe's modules load from.
 * @type {String}
 */
export const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../node_modules/neo-agent-brain');

/**
 * The one sender the broker trusts in a test process.
 * @type {Object}
 */
export const TRUSTED = Object.freeze({sender: 'trusted'});

/**
 * What a placement probe reads on two machines: one every local preset fits with headroom, and a
 * 32 GiB laptop under other use that fits none of them.
 * @type {Object}
 */
export const MACHINES = Object.freeze({
    roomy : Object.freeze({host: {totalBytes: 64 * GiB, availableBytes: 48 * GiB, pressure: 'ok', complete: true}, guest: {capBytes: 32 * GiB, availableBytes: 29 * GiB, complete: true}}),
    laptop: Object.freeze({host: {totalBytes: 32 * GiB, availableBytes: 15.5 * GiB, pressure: 'ok', complete: true}, guest: {capBytes: 16 * GiB, availableBytes: 13.5 * GiB, complete: true}})
});

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'pinned-setup-'));

/**
 * @summary A broker over the pinned Brain on a scripted host. `world` is the script and the log:
 * `commands` (asked for, never run), `rows` (the plane's witness rows), and three switches the plane
 * reads at every call — `recallLands`, `refuseWrite`, and `dropWrite` (the write's acknowledgement
 * never arrives and no row lands).
 * @param {Object}       [options]
 * @param {String}       [options.setupRoot] The setup records' temp directory
 * @param {String}       [options.stateRoot] The host state root, a temp directory
 * @param {String}       [options.configSourcePath] The config a preset's env set is checked against
 * @param {Object}       [options.machine=MACHINES.roomy] The placement probe's facts
 * @param {Boolean|null} [options.running=null] The compose project's state; `null` follows the recorded `up`
 * @param {Object|null}  [options.served=null] A plane that answers whatever the run did; `null` follows the run: nothing answers until the project is up, then the profile's plane
 * @returns {Promise<{broker: Object, profile: Object, setupRoot: String, stateRoot: String, world: Object}>} `profile` is the target the pinned Brain's layout declares
 */
export async function pinnedSetupHost({setupRoot = tempDir(), stateRoot = tempDir(), configSourcePath = path.join(BRAIN_ROOT, CONFIG_SOURCE_PATH), machine = MACHINES.roomy, running = null, served = null} = {}) {
    const
        real    = await loadSetupModules({runtimeRoot: BRAIN_ROOT}),
        world   = {commands: [], dropWrite: false, recallLands: false, refuseWrite: false, rows: []},
        plane   = {
            addMemory  : async content => {
                if (world.refuseWrite) {
                    throw Object.assign(new Error('403 the seat token is not admitted'), {refused: true})
                }

                if (world.dropWrite) {
                    throw new Error('socket hang up')
                }

                const row = {id: `witness-${world.rows.length + 1}`, sessionId: 'pinned-host', timestamp: '2026-10-04T12:00:00.000Z', ...content};

                world.rows.push(row);

                return row
            },
            close      : async () => {},
            recall     : async () => ({results: world.recallLands ? world.rows : []}),
            recentTurns: async () => ({turns: world.rows, count: world.rows.length, nextCursor: null})
        },
        run     = async (command, args = []) => {
            world.commands.push([command, ...args].join(' '));

            return {stdout: '', stderr: ''}
        },
        layout  = real.cli.hostLayout({stateRoot}),
        isUp    = () => running ?? world.commands.some(command => command.startsWith('docker compose ') && command.includes(' up ')),
        probe   = async () => ({...machine, observed: {}, runningPlane: isUp() ? {project: layout.composeProject} : null}),
        modules = {
            ...real,
            hostEffects  : {...real.hostEffects, createHost: options => real.hostEffects.createHost({...options, run})},
            orchestration: {...real.orchestration, performEffects: options => real.orchestration.performEffects({...options, createPlaneClient: () => plane})},
            probe        : {...real.probe, probePlacement: probe},
            cli          : {...real.cli, productionObservers: ({layout, host}) => real.cli.productionObservers({
                layout,
                host,
                healthcheck: async () => {
                    // the profile pins its plane: what comes up is the one its layout declares, whatever the run named
                    const answering = served ?? (isUp() ? {id: layout.target.planeId, dataRoot: layout.target.dataRoot} : null);

                    if (!answering) throw new Error(`connect ECONNREFUSED ${new URL(layout.target.endpoint).host}`);

                    return {status: 'healthy', plane: answering}
                },
                probe,
                validate   : async ({preset}) => ({embedding: {dimension: preset.vectorDimension, ok: true}, provider: {ok: true}})
            })}
        },
        broker  = createSetupBroker({
            configSourcePath,
            isTrustedSender : event => event === TRUSTED,
            loadModules     : async () => modules,
            packaged        : true,
            promptCredential: async () => 'ghp_fixtureValueNeverReal0123456789',
            setupRoot,
            stateRoot,
            now             : () => 1_700_000_000_000
        });

    return {broker, profile: layout.target, setupRoot, stateRoot, world}
}

/**
 * The preload key of each broker channel the page-side shell forwards.
 * @type {Object}
 */
const PAGE_CHANNELS = Object.freeze({setupAnswer: 'answer', setupCredential: 'credential', setupEffect: 'effect', setupEvaluate: 'evaluate', setupPresets: 'presets', setupProbe: 'probe'});

/**
 * @summary Installs `window.neoShell` in a page before the app boots: a packaged, unconfigured shell
 * whose setup channels reach `run.broker` in this process. The page logs each call under
 * `window.__neoShellCalls` as `[key, request]`. Call it before `page.goto`.
 * @param {import('@playwright/test').Page} page
 * @param {Object} run From {@link pinnedSetupHost}
 * @returns {Promise<void>}
 */
export async function installPinnedSetupShell(page, {broker}) {
    await page.exposeFunction('__pinnedSetupShell', (key, request) => broker[PAGE_CHANNELS[key]](TRUSTED, request ?? {}));

    await page.addInitScript(keys => {
        const calls = window.__neoShellCalls = [];

        window.neoShell = {
            attachPlane: async request => { calls.push(['attachPlane', request]); return {ok: false, reason: 'unreachable', relaunching: false} },
            planeStatus: async () => ({attached: false, configured: false, packaged: true, planeBase: null}),
            verifyPlane: async () => ({cause: null})
        };

        for (const key of keys) {
            window.neoShell[key] = request => {
                calls.push(request === undefined ? [key] : [key, request]);

                return window.__pinnedSetupShell(key, request ?? null)
            }
        }
    }, Object.keys(PAGE_CHANNELS))
}
