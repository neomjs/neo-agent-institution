import crypto                        from 'node:crypto';
import fs                            from 'node:fs';
import os                            from 'node:os';
import path                          from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {probePort, resolveSmokeRoot}  from './brain.mjs';
import {FIXTURE_PLANE_ID}             from './fixturePlane.mjs';

/**
 * @module harness/walkControl
 * @summary A walker's handle on a HELD smoke run. `NEO_HARNESS_SMOKE_HOLD=1` keeps the fixture-plane
 * smoke's organism and window open instead of posting its verdict, so a peer can walk the installed
 * candidate's failures against a plane that is the run's own. The held run writes a walk manifest
 * under its smoke root; this module reads it and acts only on what it names:
 *
 * - `plane stop` / `plane start`: the held harness owns the plane child, so the request goes through a
 *   control file it watches, and the script waits for its acknowledgement;
 * - `token revoke` / `token remap <identity>`: rewrites of the fixture's seat-token registry, which the
 *   plane's verifier re-reads on its next request, with no restart;
 * - `cleanup`: after the walker closed the window, removes the smoke root and proves the plane gone.
 *
 * A manifest that names another plane id, another root, or a registry outside the root is refused, so
 * nothing here can reach the operator's live plane or profile.
 */

/**
 * @type {String}
 */
export const WALK_DIR = 'walk';

/**
 * @type {String[]}
 */
export const PLANE_COMMANDS = Object.freeze(['plane-stop', 'plane-start']);

/**
 * @summary Whether this boot holds. Hold acts only in the fixture-plane arm; set anywhere else it is a
 * refusal with its reason, because a held harness without a plane of its own would attach to, or take
 * over, the organism already running on this machine.
 * @param {Object} options
 * @param {Object} options.env
 * @param {Boolean} options.smokePlaneMode The fixture-plane arm: smoke, the Brain leg, and its own plane.
 * @returns {{hold: Boolean, refusal: String|null}}
 */
export function resolveSmokeHold({env, smokePlaneMode}) {
    if (env.NEO_HARNESS_SMOKE_HOLD !== '1') {
        return {hold: false, refusal: null}
    }

    return smokePlaneMode
        ? {hold: true, refusal: null}
        : {hold: false, refusal: 'NEO_HARNESS_SMOKE_HOLD=1 holds only a smoke run on its own fixture plane (NEO_HARNESS_SMOKE=1, the Brain leg on, NEO_HARNESS_SMOKE_PLANE=1); without one this harness would attach to or take over the organism running here, so it does not start'}
}

/**
 * @summary The walk files under one smoke root.
 * @param {String} smokeRoot
 * @returns {{ack: String, control: String, dir: String, manifest: String}}
 */
export function walkPaths(smokeRoot) {
    const dir = path.join(smokeRoot, WALK_DIR);

    return {
        ack     : path.join(dir, 'ack.json'),
        control : path.join(dir, 'control.json'),
        dir,
        manifest: path.join(dir, 'manifest.json')
    }
}

/**
 * @summary Writes a JSON document through a scratch file and a rename, so a reader never sees half of it.
 * @param {String} file
 * @param {Object} document
 */
function writeJsonAtomic(file, document) {
    const scratch = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;

    fs.writeFileSync(scratch, JSON.stringify(document, null, 4) + '\n', {mode: 0o600});
    fs.renameSync(scratch, file)
}

/**
 * @summary The held run's manifest: what a walker may act on. Written once the organism is up and attached
 * to the fixture plane; any walk files of an earlier run are cleared first, so a stale request never runs.
 * @param {Object} options
 * @param {String} options.smokeRoot
 * @param {Object} options.manifest `{planeId, registryPath, runtimeRoot, identities, planePort, ingressPort, pid, candidate, auth}`
 * @returns {Object} The manifest as written, with its `smokeRoot`.
 */
export function writeWalkManifest({smokeRoot, manifest}) {
    const paths    = walkPaths(smokeRoot),
          document = {...manifest, smokeRoot: path.resolve(smokeRoot)};

    fs.rmSync(paths.dir, {force: true, recursive: true});
    fs.mkdirSync(paths.dir, {mode: 0o700, recursive: true});
    writeJsonAtomic(paths.manifest, document);

    return document
}

/**
 * @summary Accepts a manifest only for the smoke's own fixture plane under this root: its plane id, its
 * root, and a registry inside that root.
 * @param {Object} options
 * @param {String} options.smokeRoot
 * @param {Object} options.manifest
 * @returns {Object} The manifest.
 * @throws {Error} Naming what does not match.
 */
export function assertWalkTarget({smokeRoot, manifest}) {
    const root     = path.resolve(smokeRoot),
          relative = typeof manifest?.registryPath === 'string' ? path.relative(root, path.resolve(manifest.registryPath)) : '..';

    if (manifest?.planeId !== FIXTURE_PLANE_ID) {
        throw new Error(`walkControl refuses plane '${manifest?.planeId}': it acts only on the smoke's fixture plane, '${FIXTURE_PLANE_ID}'`)
    }

    if (typeof manifest.smokeRoot !== 'string' || path.resolve(manifest.smokeRoot) !== root) {
        throw new Error(`walkControl refuses a manifest for root '${manifest.smokeRoot}': this walk's smoke root is '${root}'`)
    }

    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`walkControl refuses registry '${manifest.registryPath}': it is not inside the smoke root '${root}'`)
    }

    return manifest
}

/**
 * @summary Reads and checks the held run's manifest under a smoke root.
 * @param {Object} options
 * @param {String} options.smokeRoot
 * @returns {Object}
 * @throws {Error} When no run holds there, or its manifest names anything else.
 */
export function readWalkManifest({smokeRoot}) {
    let manifest;

    try {
        manifest = JSON.parse(fs.readFileSync(walkPaths(smokeRoot).manifest, 'utf8'))
    } catch (error) {
        throw new Error(`no held smoke run under '${path.resolve(smokeRoot)}' (${error.code ?? error.message}): start one with NEO_HARNESS_SMOKE_HOLD=1 on the fixture-plane arm`)
    }

    return assertWalkTarget({manifest, smokeRoot})
}

/**
 * @summary Revokes the fixture seat: the next registry generation holds no row, so the plane refuses the
 * stored token (`stale-generation`) on its next request.
 * @param {Object} options
 * @param {Object} options.manifest A checked manifest.
 * @param {Object} options.seats The Brain's `seatToken` helpers.
 * @returns {{generation: Number, rows: Number}}
 */
export function revokeFixtureToken({manifest, seats}) {
    const previous = seats.readSeatTokenRegistry(manifest.registryPath),
          next     = seats.buildSeatTokenRegistry({generation: previous.generation + 1, planeId: previous.planeId, previousRegistry: previous, rows: []});

    seats.writeSeatTokenRegistry(manifest.registryPath, next);

    return {generation: next.generation, rows: next.rows.length}
}

/**
 * @summary Re-maps the fixture seat's token to another identity the fixture plane's graph holds, so the
 * plane names the stored token as another account on its next request.
 * @param {Object} options
 * @param {Object} options.manifest A checked manifest.
 * @param {Object} options.seats The Brain's `seatToken` helpers.
 * @param {String} options.identity
 * @returns {{generation: Number, identity: String}}
 * @throws {Error} For an identity the plane's graph does not hold: the plane would refuse it as unknown
 *     rather than name it, which is a different failure from the one a remap walks.
 */
export function remapFixtureToken({manifest, seats, identity}) {
    if (!manifest.identities?.includes(identity)) {
        throw new Error(`walkControl refuses identity '${identity}': the fixture plane's graph holds only ${manifest.identities?.join(', ')}, and a token bound to anything else is refused as unknown, not named as another account`)
    }

    const previous = seats.readSeatTokenRegistry(manifest.registryPath),
          rows     = previous.rows.map(row => ({...row, agentIdentityNodeId: `AGENT_IDENTITY:${identity}`})),
          next     = seats.buildSeatTokenRegistry({generation: previous.generation + 1, planeId: previous.planeId, previousRegistry: previous, rows});

    seats.writeSeatTokenRegistry(manifest.registryPath, next);

    return {generation: next.generation, identity}
}

/**
 * @summary Asks the held run to stop or start its plane, and waits for its acknowledgement.
 * @param {Object} options
 * @param {String} options.smokeRoot
 * @param {String} options.command One of {@link PLANE_COMMANDS}.
 * @param {Number} [options.timeoutMs=60000] A plane start reseeds nothing but still waits for its port.
 * @param {Number} [options.pollMs=200]
 * @returns {Promise<{command: String, id: String, ok: Boolean, error?: String}>}
 * @throws {Error} For an unknown command, or when the held run does not answer in time.
 */
export async function requestPlane({smokeRoot, command, timeoutMs = 60000, pollMs = 200}) {
    if (!PLANE_COMMANDS.includes(command)) {
        throw new Error(`walkControl knows no plane command '${command}' (${PLANE_COMMANDS.join(', ')})`)
    }

    const paths    = walkPaths(smokeRoot),
          id       = crypto.randomUUID(),
          deadline = Date.now() + timeoutMs;

    writeJsonAtomic(paths.control, {command, id, requestedAt: new Date().toISOString()});

    while (Date.now() < deadline) {
        try {
            const ack = JSON.parse(fs.readFileSync(paths.ack, 'utf8'));

            if (ack.id === id) {
                return ack
            }
        } catch {
            // no answer yet
        }

        await new Promise(resolve => setTimeout(resolve, pollMs))
    }

    throw new Error(`the held run did not answer '${command}' within ${timeoutMs} ms: is its window still open?`)
}

/**
 * @summary The held run's side of the plane commands: polls the control file, runs each new request once,
 * one at a time, and answers it in the acknowledgement file.
 * @param {Object} options
 * @param {String} options.smokeRoot
 * @param {Object} options.handlers `{'plane-stop': async () => {}, 'plane-start': async () => {}}`
 * @param {Function} [options.onLog]
 * @param {Number} [options.pollMs=300]
 * @returns {{stop: Function}}
 */
export function watchPlaneControl({smokeRoot, handlers, onLog = () => {}, pollMs = 300}) {
    const paths = walkPaths(smokeRoot);

    let busy   = false,
        lastId = null;

    const timer = setInterval(async () => {
        let request;

        if (busy) return;

        try {
            request = JSON.parse(fs.readFileSync(paths.control, 'utf8'))
        } catch {
            return
        }

        if (!request?.id || request.id === lastId) return;

        busy   = true;
        lastId = request.id;

        let ack;

        try {
            if (!Object.hasOwn(handlers, request.command)) {
                throw new Error(`unknown plane command '${request.command}'`)
            }

            await handlers[request.command]();
            ack = {command: request.command, id: request.id, ok: true}
        } catch (error) {
            ack = {command: request.command, error: error.message, id: request.id, ok: false}
        }

        onLog(`[walk] ${request.command} ${ack.ok ? 'done' : `failed: ${ack.error}`}`);
        writeJsonAtomic(paths.ack, ack);
        busy = false
    }, pollMs);

    timer.unref?.();

    return {stop: () => clearInterval(timer)}
}

/**
 * @summary After the walker closed the held run's window: proves the run and its plane gone, then removes
 * the smoke root. Only the root is removed; the held run wrote nothing outside it.
 * @param {Object} options
 * @param {String} options.smokeRoot
 * @param {Object} options.manifest A checked manifest.
 * @param {Function} [options.isAlive]
 * @param {Function} [options.probePortFn=probePort]
 * @returns {Promise<{planeStopped: Boolean, rootRemoved: Boolean, smokeRoot: String}>}
 * @throws {Error} While the held run or its plane still runs.
 */
export async function cleanupHeldRun({smokeRoot, manifest, isAlive = pid => {
    try {
        process.kill(pid, 0);
        return true
    } catch {
        return false
    }
}, probePortFn = probePort}) {
    if (Number.isInteger(manifest.pid) && isAlive(manifest.pid)) {
        throw new Error(`the held run (pid ${manifest.pid}) still runs: close its window, which stops the organism and the plane, then clean up`)
    }

    for (const [port, what] of [[manifest.planePort, 'fixture plane'], [manifest.ingressPort, 'fixture ingress']]) {
        if (Number.isInteger(port) && await probePortFn({port})) {
            throw new Error(`something still listens on the ${what}'s port ${port}`)
        }
    }

    fs.rmSync(smokeRoot, {force: true, recursive: true});

    return {planeStopped: true, rootRemoved: !fs.existsSync(smokeRoot), smokeRoot: path.resolve(smokeRoot)}
}

/**
 * @summary The CLI: `node harness/walkControl.mjs [--packaged] plane stop|start | token revoke |
 * token remap <identity> | cleanup`. The smoke root resolves as the held run resolved it
 * (`NEO_HARNESS_BRAIN_ROOT`, else the packaged temp root with `--packaged`, else the checkout's).
 * @param {Object} options
 * @param {String[]} options.argv
 * @param {Object} [options.env=process.env]
 * @param {String} [options.harnessDir]
 * @param {String} [options.tempDir]
 * @param {Function} [options.importSeats] Loads the Brain's `seatToken` helpers from the runtime root.
 * @returns {Promise<Object>} The receipt.
 */
export async function runWalkControl({
    argv,
    env         = process.env,
    harnessDir  = path.dirname(fileURLToPath(import.meta.url)),
    tempDir     = os.tmpdir(),
    importSeats = runtimeRoot => import(pathToFileURL(path.join(runtimeRoot, 'ai/mcp/server/shared/helpers/seatToken.mjs')).href)
}) {
    const
        packaged          = argv.includes('--packaged'),
        [noun, verb, arg] = argv.filter(value => value !== '--packaged'),
        smokeRoot         = resolveSmokeRoot({env, harnessDir, packaged, tempDir}),
        manifest          = readWalkManifest({smokeRoot});

    if (noun === 'plane' && (verb === 'stop' || verb === 'start')) {
        return requestPlane({command: `plane-${verb}`, smokeRoot})
    }

    if (noun === 'token' && verb === 'revoke') {
        return revokeFixtureToken({manifest, seats: await importSeats(manifest.runtimeRoot)})
    }

    if (noun === 'token' && verb === 'remap' && arg) {
        return remapFixtureToken({identity: arg, manifest, seats: await importSeats(manifest.runtimeRoot)})
    }

    if (noun === 'cleanup') {
        return cleanupHeldRun({manifest, smokeRoot})
    }

    throw new Error('usage: walkControl.mjs [--packaged] plane stop|start | token revoke | token remap <identity> | cleanup')
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    runWalkControl({argv: process.argv.slice(2)}).then(
        receipt => console.log(JSON.stringify(receipt, null, 4)),
        error => {
            console.error(error.message);
            process.exit(1)
        }
    )
}
