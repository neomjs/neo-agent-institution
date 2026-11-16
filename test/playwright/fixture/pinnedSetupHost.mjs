import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir}                   from 'node:os';
import path                       from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
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
 * The plane's forge-connection CLI, as the Brain runs it inside the Fleet service (`hostEffects.FORGE_CLI`), and
 * the forge the pinned plane declares — what the recipe's `register-forge` row registers and reads back.
 * @type {String}
 */
export const FORGE_CLI = 'ai/scripts/fleet/forgeConnections.mjs';
/** @type {Readonly<{authProvider: String, endpoint: String}>} */
export const FORGE_DECLARED = Object.freeze({authProvider: 'github', endpoint: 'https://api.github.com'});

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
 * @param {String}       [options.homeDir] The home directory root, a temp directory (never the real home)
 * @param {String}       [options.configSourcePath] The config a preset's env set is checked against
 * @param {Object}       [options.machine=MACHINES.roomy] The placement probe's facts
 * @param {String}       [options.platform='darwin'] Scripted host OS platform (`'darwin'` | `'linux'`)
 * @param {Boolean|null} [options.running=null] The compose project's state; `null` follows the recorded `up`
 * @param {Object|null}  [options.served=null] A plane that answers whatever the run did; `null` follows the run: nothing answers until the project is up, then the profile's plane
 * @returns {Promise<{broker: Object, homeDir: String, profile: Object, setupRoot: String, stateRoot: String, world: Object}>} `profile` is the target the pinned Brain's layout declares
 */
export async function pinnedSetupHost({setupRoot = tempDir(), stateRoot = tempDir(), homeDir = tempDir(), configSourcePath = path.join(BRAIN_ROOT, CONFIG_SOURCE_PATH), machine = MACHINES.roomy, platform = 'darwin', running = null, served = null} = {}) {
    const
        real                    = await loadSetupModules({runtimeRoot: BRAIN_ROOT}),
        {parseLaunchAgentPlist} = await import(pathToFileURL(path.join(BRAIN_ROOT, 'ai/services/fleet/wakeReceiverSetup.mjs')).href),
        world                   = {commands: [], dropWrite: false, forgeCalls: [], recallLands: false, refuseWrite: false, rows: []},
        layout                  = real.cli.hostLayout({stateRoot, homeDir}),
        wakeService             = {loaded: false, plistPath: null, running: false},
        envRecordsDir           = () => {
            try {
                const match = readFileSync(layout.envFile, 'utf8').match(/^NEO_WAKE_RECEIVER_RECORDS_HOST_DIR=(.+)$/m);

                return match ? path.resolve(match[1].trim()) : null
            } catch {
                return null
            }
        },
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
        // the plane's forge-connection registry, as its CLI answers inside the Fleet service: the canonical
        // `status` shape the recipe's `register-forge` row reads, and the two mutations a run performs
        // (`init`, `register`) — scripted, so the row's own observer and effect run their real code against it
        // a plane that already runs when the host is scripted (`running: true`) was set up before this run,
        // so its registry already binds the declared forge: the row adopts it, performed by nobody here
        forge   = running
            ? {state: 'ok', binding: {connectionId: 'forge-0', authProvider: FORGE_DECLARED.authProvider}}
            : {state: 'absent', binding: null},
        forgeAnswer = args => {
            const command = args[args.indexOf(FORGE_CLI) + 1];

            world.forgeCalls.push(command);

            switch (command) {
                case 'status':
                    return {ok: true, dataDir: '/app/.neo-ai-data', declared: FORGE_DECLARED, declaredReason: null, state: forge.state, reason: null, binding: forge.binding, tombstoned: false};
                case 'init':
                    forge.state = 'ok';
                    return {ok: true, applied: true, version: 1};
                case 'register':
                    forge.binding = {connectionId: 'forge-1', authProvider: FORGE_DECLARED.authProvider};
                    return {ok: true, connectionId: 'forge-1', endpoint: FORGE_DECLARED.endpoint, authProvider: FORGE_DECLARED.authProvider};
                default:
                    return {ok: false, refused: 'unscripted', reason: `the pinned host scripts no '${command}'`}
            }
        };

    let composeRecordsDir = null;

    const
        isUp    = () => running ?? world.commands.some(command => command.startsWith('docker compose ') && command.includes(' up ')),
        run     = async (command, args = []) => {
            // the registry's CLI is the plane answering, not a command asked of the host: the tests count those
            if (args.includes(FORGE_CLI)) {
                return {stdout: JSON.stringify(forgeAnswer(args)), stderr: ''}
            }

            if (command === 'docker' && args[0] === 'ps' && args.includes('label=com.docker.compose.service=mc-server')) {
                return {stdout: isUp() ? 'pinned-mc-server\n' : '', stderr: ''}
            }

            if (command === 'docker' && args[0] === 'inspect' && args.includes('{{json .Mounts}}')) {
                const source = composeRecordsDir ?? (running ? envRecordsDir() : null);

                return {stdout: JSON.stringify(source ? [{Destination: '/app/wake-receiver-records', Source: source}] : []), stderr: ''}
            }

            if (command === 'launchctl') {
                if (args[0] === 'print') {
                    if (!wakeService.loaded || !wakeService.plistPath) {
                        throw new Error('Could not find service "com.neomjs.agent-os-wake" in domain')
                    }

                    const
                        parsed   = parseLaunchAgentPlist(readFileSync(wakeService.plistPath, 'utf8'), {allowComments: false}),
                        argLines = (parsed.ProgramArguments ?? []).map(arg => `\t\t${arg}`),
                        envLines = Object.entries(parsed.EnvironmentVariables ?? {}).map(([key, value]) => `\t\t${key} => ${value}`);

                    return {
                        stdout: [
                            `\tstate = ${wakeService.running ? 'running' : 'not running'}`,
                            ...(wakeService.running ? ['\tpid = 4242'] : []),
                            `\tpath = ${wakeService.plistPath}`,
                            `\tprogram = ${parsed.ProgramArguments?.[0] ?? ''}`,
                            `\tworking directory = ${parsed.WorkingDirectory ?? ''}`,
                            '\targuments = {',
                            ...argLines,
                            '\t}',
                            '\tenvironment = {',
                            ...envLines,
                            '\t}'
                        ].join('\n'),
                        stderr: ''
                    }
                }

                if (args[0] === 'bootstrap') {
                    wakeService.loaded    = true;
                    wakeService.running   = true;
                    wakeService.plistPath = args[2] ?? wakeService.plistPath;
                } else if (args[0] === 'bootout') {
                    wakeService.loaded  = false;
                    wakeService.running = false;
                }
            }

            if (command === 'docker' && args[0] === 'compose' && args.includes('up')) {
                composeRecordsDir = envRecordsDir()
            }

            world.commands.push([command, ...args].join(' '));

            return {stdout: '', stderr: ''}
        },
        probe   = async () => ({...machine, observed: {}, runningPlane: isUp() ? {project: layout.composeProject} : null}),
        modules = {
            ...real,
            hostEffects  : {...real.hostEffects, createHost: options => real.hostEffects.createHost({
                ...options,
                platform             : () => platform,
                probeWakeListener    : async ({host, port}) => wakeService.running
                    ? {listening: true, wakeReceiver: true, statusCode: 404, reason: null}
                    : {listening: false, wakeReceiver: false, statusCode: null, reason: `connect ECONNREFUSED ${host}:${port}`},
                run,
                wakeReadinessAttempts: 2,
                wakeReadinessDelayMs : 0
            })},
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
            homeDir,
            isTrustedSender : event => event === TRUSTED,
            loadModules     : async () => modules,
            packaged        : true,
            promptCredential: async () => 'ghp_fixtureValueNeverReal0123456789',
            setupRoot,
            stateRoot,
            now             : () => 1_700_000_000_000
        });

    return {broker, homeDir, profile: layout.target, setupRoot, stateRoot, world}
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
