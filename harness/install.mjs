#!/usr/bin/env node
// The local install leg of the unsigned packaging pipeline: the development artifact `npm run dist`
// produced replaces the installed app WHOLE (the shell ADR's "ships a new package" — never a partial
// copy into the old bundle), and the bundle it displaces becomes the ONE rollback, at a fixed path
// outside /Applications. A hand-copy had no retirement rule, so every refresh left another launchable
// `Neo Harness.previous-*.app` beside the live one; this leg leaves none.
//
// Three facts shape every rule here:
//   - the shell version (`0.0.1`) and bundle identifier are constant across development builds, so
//     the organism receipt (`organism-build-info.json`) is the only identity a build has; the leg
//     verifies the staged copy carries the artifact's receipt BEFORE any slot moves, and prints the
//     receipt old → new;
//   - quitting Neo Harness also stops the peer harnesses it launched (harness/README.md), so a
//     running app is a refusal by default, `--quit` is the only way this leg stops one, and a copy
//     running from ANY bundle named `Neo Harness*.app` counts — a renamed previous copy included;
//   - a swap is several renames, and a process can die between two of them. Every intermediate
//     state is a slot the next run recognizes and completes, never an absence it refuses.
//
// `planInstall` is pure and unit-specced; `executePlan` is the thin shell around `rename(2)`,
// `ditto` and `osascript`, with the child-process runner injectable like pack.mjs's `runFn`.

import {execFileSync}      from 'node:child_process';
import {createHash}        from 'node:crypto';
import fs                  from 'node:fs';
import os                  from 'node:os';
import path                from 'node:path';
import {fileURLToPath}     from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));

export const APP_NAME = 'Neo Harness';

/**
 * The rollback slot's bundle name carries no `.app` suffix: Launch Services registers every
 * `.app` Spotlight sees (this machine indexed 17 bundles with the harness's identifier at once),
 * and a registered copy is a launchable copy — the thing this leg exists to stop. The directory is
 * the same bundle byte for byte; `--restore` renames it back under its `.app` name.
 */
export const ROLLBACK_BUNDLE_NAME = `${APP_NAME}.rollback`;

/** The organism receipt inside a bundle — the only identity a development build carries. */
export const RECEIPT_RELATIVE_PATH = path.join('Contents', 'Resources', 'organism', 'organism-build-info.json');

/** Where `npm run dist` leaves the unpacked bundle (electron-builder.yml `directories.output`); the arch segment varies. */
export const DEFAULT_DIST_DIR = path.join(harnessDir, 'dist-artifacts');

export const DEFAULT_APPLICATIONS_DIR = '/Applications';

/**
 * The app's own Application Support root (`app.getPath('userData')`). The rollback slot lives
 * under it so the displaced bundle stays out of /Applications, Launchpad and the Dock. The plane
 * record and credentials beside it are never written by this leg; the custody files are READ once
 * per run, to hash them.
 */
export const DEFAULT_USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'neo-harness');
export const DEFAULT_ROLLBACK_DIR  = path.join(DEFAULT_USER_DATA_DIR, 'rollback');
export const DEFAULT_ROLLBACK_PATH = path.join(DEFAULT_ROLLBACK_DIR, ROLLBACK_BUNDLE_NAME);

/**
 * The custody set the leg proves it left alone: the plane record at the userData root and the
 * fleet root's own files (registry, credentials, keys, tenants). Seat homes under `brain/fleet/agents/`
 * are the seats' own mutable state — full checkouts whose `.neo-ai-data` links point INTO the
 * bundle this leg replaces — so only their presence is custody, never their contents.
 */
export const CUSTODY_PLANE_FILES = Object.freeze(['plane.json', 'plane-bearer.bin', 'seat-root.json']);
export const CUSTODY_FLEET_DIR   = path.join('brain', 'fleet');
export const CUSTODY_AGENTS_DIR  = 'agents';

export const PEER_QUIT_WARNING =
    `Quitting ${APP_NAME} also stops the peer harnesses it launched. Checkpoint those seats first; ` +
    'reopening the app does not itself prove their sessions resumed.';

/** A running executable inside any bundle named `Neo Harness….app`: the canonical one, a renamed copy, a staging twin. */
const HARNESS_BUNDLE_PATTERN = new RegExp(`/${APP_NAME.replace(/ /g, '\\s')}[^/]*\\.app/`);

/**
 * @summary The pure plan: ordered steps for one install or restore, or one refusal. Nothing here
 * touches the filesystem — callers pass what they read, tests pass what they mean.
 *
 * The slot vocabulary: `installed` is the canonical bundle, `rollback` the single rollback slot,
 * `parked` the `.restoring` sibling a restore moves the installed bundle through, `staged` the
 * `.installing` sibling an install copies into. A `parked` bundle found at planning time is an
 * interrupted restore; the plan completes it (installed empty → it goes back; rollback empty → it
 * becomes the rollback) and stops, so the operator re-reads the slots before asking for another
 * swap. Both slots full beside a parked bundle is a refusal: three bundles, two slots.
 * @param {Object} input
 * @param {'install'|'restore'} [input.mode='install']
 * @param {Object} input.artifact `{path, exists, receipt}` of the bundle to install (ignored on restore)
 * @param {Object} input.installed `{path, exists, receipt}` of the canonical installed bundle
 * @param {Object} input.rollback `{path, exists, receipt}` of the single rollback slot
 * @param {Object} [input.parked] `{path, exists, receipt}` of the `.restoring` sibling
 * @param {String[]} [input.running=[]] executable paths of every Neo Harness process alive now
 * @param {Object} [input.flags={}] `{quit, open}`
 * @param {String|null} [input.custodyDir=null] the userData root whose custody set is hashed before and after; `null` skips the check
 * @returns {{ok: true, steps: Object[], warnings: String[], note?: String}|{ok: false, reason: String, detail: String[]}}
 */
export function planInstall({mode = 'install', artifact, installed, rollback, parked, running = [], flags = {}, custodyDir = null}) {
    const
        offCanonical = running.filter(exe => !isInside(exe, installed.path)),
        steps        = [],
        warnings     = [],
        custody      = phase => custodyDir && steps.push({type: 'custody', phase, dir: custodyDir}),
        quit         = () => {
            if (running.length) {
                steps.push({type: 'quit', bundle: installed.path, paths: running});
                warnings.push(PEER_QUIT_WARNING)
            }
            // The baseline is taken once nothing of the app's own runs: a lifecycle write during its
            // shutdown is the app's, not this leg's.
            custody('baseline')
        };

    if (offCanonical.length) {
        return refusal('running-off-canonical', [
            `A ${APP_NAME} is running from outside ${installed.path}; this leg only replaces the canonical bundle:`,
            ...offCanonical
        ])
    }

    if (running.length && !flags.quit) {
        return refusal('running', [
            `${APP_NAME} is running (${processCount(running)}); pass --quit to stop it first.`,
            PEER_QUIT_WARNING
        ])
    }

    if (parked?.exists) {
        if (installed.exists && rollback.exists) {
            return refusal('interrupted-restore-ambiguous', [
                `An interrupted restore left ${parked.path} beside a filled installed slot and a filled rollback slot; move one by hand before running again.`
            ])
        }

        const to = installed.exists ? rollback.path : installed.path;

        quit();
        steps.push({type: 'rename', from: parked.path, to});
        steps.push({type: 'verify', path: installed.path, receipt: installed.exists ? installed.receipt : parked.receipt});
        custody('compare');

        return {ok: true, steps, warnings, note: `An interrupted restore left ${parked.path}; this run only completes it (→ ${to}). Re-run for a swap.`}
    }

    if (mode === 'restore') {
        if (!rollback.exists) {
            return refusal('rollback-missing', [`No rollback bundle at ${rollback.path}.`])
        }
    } else {
        if (!artifact.exists) {
            return refusal('artifact-missing', [`No bundle at ${artifact.path}; run \`npm run dist\` first.`])
        }

        if (!artifact.receipt) {
            return refusal('artifact-receipt-missing', [`${artifact.path} carries no ${RECEIPT_RELATIVE_PATH}; not a packaged organism.`])
        }

        // Equal receipts are the idempotence key: a chained `npm run dist && npm run install:mac`
        // must not rotate the rollback slot for a build that is already in place.
        if (installed.exists && isDeepStrictEqual(installed.receipt, artifact.receipt)) {
            return {ok: true, steps, warnings, note: `${installed.path} already carries this receipt; nothing to replace.`}
        }
    }

    quit();

    if (mode === 'restore') {
        // Three renames swap the two slots, so a second --restore returns to the start.
        const parkedPath = parked?.path ?? `${installed.path}.restoring`;

        installed.exists && steps.push({type: 'rename', from: installed.path, to: parkedPath});
        steps.push({type: 'rename', from: rollback.path, to: installed.path});
        installed.exists && steps.push({type: 'rename', from: parkedPath, to: rollback.path});
        steps.push({type: 'verify', path: installed.path, receipt: rollback.receipt})
    } else {
        const staged = `${installed.path}.installing`;

        // The artifact is copied beside the destination and verified THERE, so a copy that lost its
        // receipt stops the run while both slots still hold what they held. Then the live path is
        // replaced by one rename and is never half-written, and the displaced bundle takes the single
        // rollback slot, replacing whatever held it — exactly one rollback, never a sibling in the
        // applications folder.
        steps.push({type: 'stage', from: artifact.path, to: staged});
        steps.push({type: 'verify', path: staged, receipt: artifact.receipt});

        if (installed.exists) {
            rollback.exists && steps.push({type: 'remove', path: rollback.path});
            steps.push({type: 'rename', from: installed.path, to: rollback.path})
        }

        steps.push({type: 'rename', from: staged, to: installed.path});
        steps.push({type: 'verify', path: installed.path, receipt: artifact.receipt})
    }

    // The custody comparison sits BEFORE the relaunch: a mismatch stops the run with the app down.
    custody('compare');
    flags.open && steps.push({type: 'open', path: installed.path});

    return {ok: true, steps, warnings}
}

/**
 * @summary Runs the planned steps in order. The first failure stops the run; the error names the
 * step. Receipt verification turns "copied" into "installed", and the custody comparison turns
 * "replaced" into "replaced without touching the plane's custody files".
 * @param {Object[]} steps From {@link planInstall}
 * @param {Object} [options]
 * @param {Function} [options.runFn=run] Child-process seam (`ditto`, `osascript`, `open`); tests inject it
 * @param {Function} [options.runningFn] Process census the quit step polls; defaults to the real `ps` reader
 * @param {Number} [options.quitTimeoutMs=30000]
 * @returns {{custody: {before: String|null, after: String|null}|null}}
 */
export function executePlan(steps, {runFn = run, runningFn = () => runningHarnessPaths(), quitTimeoutMs = 30000} = {}) {
    const custody = {before: undefined, after: undefined};

    for (const step of steps) {
        try {
            switch (step.type) {
                case 'quit':
                    // Through the app's own lifecycle, never a signal: an orderly quit is what stops
                    // launched peers cleanly, and a SIGKILL would orphan them. Addressed by PATH, not
                    // bundle identifier: every development build shares the identifier, so an id-based
                    // quit resolves through a Launch Services pick among every registered copy — and
                    // AppleScript launches the copy it picked if that one is not running.
                    runFn('osascript', ['-e', `tell application "${step.bundle}" to quit`]);
                    waitUntilGone(runningFn, quitTimeoutMs);
                    break;
                case 'custody':
                    if (step.phase === 'baseline') {
                        custody.before = custodyDigest(step.dir)
                    } else {
                        custody.after = custodyDigest(step.dir);

                        if (custody.after !== custody.before) {
                            throw new Error(`the custody files under ${step.dir} (plane record, fleet root, seat presence) changed while the app was stopped; inspect them before launching`)
                        }
                    }
                    break;
                case 'stage':
                    fs.rmSync(step.to, {force: true, recursive: true});
                    runFn('ditto', [step.from, step.to]);
                    break;
                case 'remove':
                    fs.rmSync(step.path, {force: true, recursive: true});
                    break;
                case 'rename':
                    fs.mkdirSync(path.dirname(step.to), {recursive: true});
                    fs.renameSync(step.from, step.to);
                    break;
                case 'verify': {
                    const found = readSlot(step.path).receipt;

                    if (!isDeepStrictEqual(found, step.receipt)) {
                        throw new Error(`carries "${describeReceipt(found)}", expected "${describeReceipt(step.receipt)}"`)
                    }
                    break
                }
                case 'open':
                    runFn('open', ['-a', step.path]);
                    break;
                default:
                    throw new Error('unknown step')
            }
        } catch (error) {
            throw new Error(`failed at "${describeStep(step).split('\n')[0].trim()}": ${error.message}`, {cause: error})
        }
    }

    return {custody: custody.before === undefined ? null : custody}
}

/**
 * @summary Resolves the one unpacked bundle `npm run dist` left under the dist directory. The arch
 * segment of the folder varies (`mac-arm64`, `mac`), so the match is a glob and exactly one hit is
 * required: two candidates would make "the artifact" a guess.
 * @param {String} [distDir=DEFAULT_DIST_DIR]
 * @returns {String}
 */
export function resolveArtifactPath(distDir = DEFAULT_DIST_DIR) {
    const candidates = fs.existsSync(distDir)
        ? fs.readdirSync(distDir)
            .filter(name => name.startsWith('mac'))
            .map(name => path.join(distDir, name, `${APP_NAME}.app`))
            .filter(candidate => fs.existsSync(candidate))
        : [];

    if (candidates.length !== 1) {
        throw new Error(candidates.length
            ? `More than one packaged bundle under ${distDir}; pass --artifact:\n  ${candidates.join('\n  ')}`
            : `No packaged bundle under ${distDir}; run \`npm run dist\` first or pass --artifact.`)
    }

    return candidates[0]
}

/**
 * @summary One line that tells two development builds apart: the version label cannot.
 * @param {Object|null} receipt A parsed `organism-build-info.json`
 * @returns {String}
 */
export function describeReceipt(receipt) {
    if (!receipt) {
        return 'no receipt'
    }

    const
        {owners = {}, stagedAt = '?'} = receipt,
        brain   = owners.brain?.revision?.slice(0, 7)                ?? '?',
        engine  = owners.engine?.pin?.split('#').pop()?.slice(0, 7)  ?? '?',
        product = owners.product?.version                            ?? '?';

    return `staged ${stagedAt} · Brain ${brain} · Engine ${engine} · product ${product}`
}

/**
 * @summary Whether `candidate` is `root` itself or a path below it (helper processes live below the bundle).
 * @param {String} candidate
 * @param {String} root
 * @returns {Boolean}
 */
export function isInside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * @summary Parses the CLI flags. Unknown flags are a refusal, not a guess.
 * @param {String[]} argv
 * @returns {Object}
 */
export function parseInstallArgs(argv) {
    const options = {
        applicationsDir: DEFAULT_APPLICATIONS_DIR,
        artifactPath   : null,
        dryRun         : false,
        mode           : 'install',
        open           : false,
        quit           : false,
        rollbackDir    : DEFAULT_ROLLBACK_DIR,
        unknown        : [],
        userDataDir    : DEFAULT_USER_DATA_DIR
    };

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];

        switch (flag) {
            case '--applications-dir': options.applicationsDir = argv[++i]; break;
            case '--artifact'        : options.artifactPath    = argv[++i]; break;
            case '--dry-run'         : options.dryRun          = true;      break;
            case '--open'            : options.open            = true;      break;
            case '--quit'            : options.quit            = true;      break;
            case '--restore'         : options.mode            = 'restore'; break;
            case '--rollback-dir'    : options.rollbackDir     = argv[++i]; break;
            case '--user-data-dir'   : options.userDataDir     = argv[++i]; break;
            default                  : options.unknown.push(flag)
        }
    }

    return options
}

/**
 * @summary A SHA-256 over the custody set — the proof the leg left the plane record and the fleet's
 * own files alone. Contents are hashed, never printed or copied, and NO link is ever followed: a
 * symlink contributes its target string, the one custody fact about it. Seat homes contribute
 * their names only. The first run of this leg hashed every file under the seat homes and followed
 * their `.neo-ai-data` links into the bundle it had just replaced, so a correct install read as a
 * custody change; the scope here is the one that cannot.
 * @param {String} userDataDir The app's userData root (`app.getPath('userData')`)
 * @returns {String|null} `null` when the fleet root does not exist
 */
export function custodyDigest(userDataDir) {
    const fleetDir = path.join(userDataDir, CUSTODY_FLEET_DIR);

    if (!fs.existsSync(fleetDir)) {
        return null
    }

    const
        hash    = createHash('sha256'),
        feed    = (label, bytes) => {
            hash.update(`${label}\0`);
            bytes !== null && hash.update(bytes);
            hash.update('\0')
        },
        entries = fs.readdirSync(fleetDir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name));

    for (const name of CUSTODY_PLANE_FILES) {
        const file = path.join(userDataDir, name);
        fs.existsSync(file) && feed(name, fs.readFileSync(file))
    }

    for (const entry of entries) {
        const
            label = path.join(CUSTODY_FLEET_DIR, entry.name),
            full  = path.join(fleetDir, entry.name);

        if (entry.isSymbolicLink()) {
            feed(`${label} -> `, Buffer.from(fs.readlinkSync(full)))
        } else if (entry.isFile()) {
            feed(label, fs.readFileSync(full))
        } else if (entry.isDirectory()) {
            // The seats' presence is custody; their homes are their own. Any other directory counts by name.
            feed(`${label}/`, entry.name === CUSTODY_AGENTS_DIR
                ? Buffer.from(fs.readdirSync(full).sort().join('\0'))
                : null)
        }
    }

    return hash.digest('hex')
}

/**
 * @summary Reads one bundle slot: existence and its organism receipt.
 * @param {String} bundlePath
 * @returns {{path: String, exists: Boolean, receipt: Object|null}}
 */
export function readSlot(bundlePath) {
    const receiptPath = path.join(bundlePath, RECEIPT_RELATIVE_PATH);

    let receipt = null;

    if (fs.existsSync(receiptPath)) {
        try {
            receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
        } catch {
            receipt = null
        }
    }

    return {path: bundlePath, exists: fs.existsSync(bundlePath), receipt}
}

/**
 * @summary The hand-copied `Neo Harness.previous-*.app` siblings an applications folder still holds.
 * Listed with their receipts so the operator can retire them knowingly; this leg never removes them.
 * @param {String} applicationsDir
 * @returns {{path: String, exists: Boolean, receipt: Object|null}[]}
 */
export function legacyCopies(applicationsDir) {
    const prefix = `${APP_NAME}.previous`;

    return fs.existsSync(applicationsDir)
        ? fs.readdirSync(applicationsDir)
            .filter(name => name.startsWith(prefix) && name.endsWith('.app'))
            .sort()
            .map(name => readSlot(path.join(applicationsDir, name)))
        : []
}

/**
 * @summary Every running Neo Harness executable path (main process and helpers) inside ANY bundle
 * named `Neo Harness….app` — the canonical one, a renamed previous copy running from wherever it
 * was moved, a staging twin. The off-canonical refusal can only see what this returns.
 * @param {String} [psText] The `ps -axo comm=` output; read live when omitted (tests pass it)
 * @returns {String[]}
 */
export function runningHarnessPaths(psText = execFileSync('ps', ['-axo', 'comm='], {encoding: 'utf8'})) {
    return psText
        .split('\n')
        .map(line => line.trim())
        .filter(line => HARNESS_BUNDLE_PATTERN.test(line))
}

/**
 * @summary Default child-process runner: inherit stdio so `ditto` progress and errors reach the operator.
 * @param {String} command
 * @param {String[]} args
 * @returns {void}
 */
function run(command, args) {
    execFileSync(command, args, {stdio: 'inherit'})
}

function waitUntilGone(runningFn, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (!runningFn().length) {
            return
        }

        execFileSync('sleep', ['0.5'])
    }

    throw new Error(`still running ${timeoutMs / 1000}s after the quit request: ${runningFn().join(', ')}`)
}

function processCount(paths) {
    return `${paths.length} process${paths.length === 1 ? '' : 'es'}`
}

function refusal(reason, detail) {
    return {ok: false, reason, detail}
}

/**
 * @summary One step as the operator reads it in the plan.
 * @param {Object} step
 * @returns {String}
 */
export function describeStep(step) {
    switch (step.type) {
        case 'quit'   : return `quit    ${APP_NAME} (${processCount(step.paths)})`;
        case 'custody': return `${step.phase === 'baseline' ? 'hash   ' : 'compare'} the custody set under ${step.dir} (plane record · fleet root · seat presence)`;
        case 'stage'  : return `copy    ${step.from}\n     →  ${step.to}`;
        case 'remove' : return `remove  ${step.path}`;
        case 'rename' : return `move    ${step.from}\n     →  ${step.to}`;
        case 'verify' : return `verify  ${step.path} carries "${describeReceipt(step.receipt)}"`;
        case 'open'   : return `open    ${step.path}`;
        default       : return step.type
    }
}

function printUsage() {
    console.log('Usage: node install.mjs [--artifact <bundle.app>] [--quit] [--open] [--restore] [--dry-run]');
    console.log('');
    console.log(`  Replaces ${DEFAULT_APPLICATIONS_DIR}/${APP_NAME}.app with the packaged bundle and moves the displaced`);
    console.log(`  bundle to the single rollback slot (${DEFAULT_ROLLBACK_PATH}).`);
    console.log('');
    console.log('  --artifact   The bundle to install (default: the one bundle under dist-artifacts/mac*/).');
    console.log(`  --quit       Ask a running ${APP_NAME} to quit first. Without it a running app is a refusal.`);
    console.log('  --open       Launch the installed bundle afterwards (never after a failed custody comparison).');
    console.log('  --restore    Swap the rollback slot back into place (a second --restore undoes it).');
    console.log('  --dry-run    Print the plan and the receipts; change nothing.')
}

function describeSlot(label, slot, absent) {
    return `${label.padEnd(10)} ${slot.path}\n           ${slot.exists ? describeReceipt(slot.receipt) : absent}`
}

async function main() {
    const options = parseInstallArgs(process.argv.slice(2));

    if (options.unknown.length) {
        console.error(`Unknown flag(s): ${options.unknown.join(' ')}\n`);
        printUsage();
        process.exit(2)
    }

    if (process.platform !== 'darwin') {
        console.error('This leg replaces a macOS bundle; nothing to do here.');
        process.exit(2)
    }

    const
        custodyDir = options.userDataDir,
        installed  = readSlot(path.join(options.applicationsDir, `${APP_NAME}.app`)),
        parked     = readSlot(`${installed.path}.restoring`),
        rollback   = readSlot(path.join(options.rollbackDir, ROLLBACK_BUNDLE_NAME)),
        artifact   = options.mode === 'install' ? readSlot(options.artifactPath ?? resolveArtifactPath()) : null,
        running    = runningHarnessPaths(),
        legacy     = legacyCopies(options.applicationsDir),
        plan       = planInstall({artifact, custodyDir, flags: {open: options.open, quit: options.quit}, installed, mode: options.mode, parked, rollback, running});

    console.log(describeSlot('installed', installed, 'absent'));
    console.log(describeSlot('rollback', rollback, 'empty'));
    parked.exists && console.log(describeSlot('parked', parked, 'absent'));
    artifact && console.log(describeSlot('artifact', artifact, 'absent'));

    if (legacy.length) {
        console.log(`\n${legacy.length} hand-copied sibling${legacy.length === 1 ? '' : 's'} in ${options.applicationsDir} (left alone; retire them once the installed build is accepted):`);
        legacy.forEach(copy => console.log(`  ${path.basename(copy.path)}  ${describeReceipt(copy.receipt)}`))
    }

    console.log('');

    if (!plan.ok) {
        console.error(`refused (${plan.reason}):`);
        plan.detail.forEach(line => console.error(`  ${line}`));
        process.exit(1)
    }

    plan.note && console.log(`${plan.note}\n`);

    if (!plan.steps.length) {
        return
    }

    plan.warnings.forEach(line => console.warn(`! ${line}`));
    plan.steps.forEach((step, index) => console.log(`${String(index + 1).padStart(2)}. ${describeStep(step)}`));

    if (options.dryRun) {
        console.log('\ndry run — nothing changed.');
        return
    }

    console.log('');

    const {custody} = executePlan(plan.steps);

    console.log(`\n${describeSlot('installed', readSlot(installed.path), 'absent')}`);
    console.log(describeSlot('rollback', readSlot(rollback.path), 'empty'));
    custody && console.log(`${'custody'.padEnd(10)} ${custodyDir}\n           ${custody.before === null ? 'absent' : `unchanged (${custody.before.slice(0, 12)})`}`)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

invokedDirectly && main().catch(error => {
    console.error(error.message);
    process.exit(1)
});
