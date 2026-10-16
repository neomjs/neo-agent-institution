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
//   - detached desktop harnesses survive FM quit. Their local MCP processes can still use the
//     bundle, so the census includes every executable inside ANY `Neo Harness*.app` bundle;
//     `--quit` only asks the canonical FM app to quit and remaining bundle users still refuse;
//   - a swap is several renames, and a process can die between two of them. Every intermediate
//     state is a slot the next run recognizes and completes, never an absence it refuses.
//
// `planInstall` is pure and unit-specced; `executePlan` is the thin shell around `rename(2)`,
// `ditto` and `osascript`, with the child-process runner injectable like pack.mjs's `runFn`.

import {execFileSync}                                                                                            from 'node:child_process';
import {createHash}                                                                                              from 'node:crypto';
import fs                                                                                                        from 'node:fs';
import os                                                                                                        from 'node:os';
import path                                                                                                      from 'node:path';
import {fileURLToPath}                                                                                           from 'node:url';
import {isDeepStrictEqual}                                                                                       from 'node:util';
import {inspectRuntimeSupport, materializeRuntimeGeneration, probeRuntimeRecovery}                               from './runtimeGeneration.mjs';
import * as runtimeVerifier                                                                                      from 'neo-agent-brain/runtime-generation';
import {holdLaunchAdmissionHandoff, holdLaunchAdmissionVacancy, isAdmissionSnapshot, readLaunchAdmissionJournal} from 'neo-agent-brain/launch-admission-journal';

import {holdFileLease}                                                                                      from 'neo-agent-brain/file-lease';
import * as runtimeReferences                                                                               from 'neo-agent-brain/runtime-generation-lease';
import {DEFAULT_INSTALL_TRANSACTION_DIR, holdPackageTransaction, PACKAGE_RECEIPT_PATH, publishPackageSlots} from './packageSlots.mjs';

export {DEFAULT_INSTALL_TRANSACTION_DIR} from './packageSlots.mjs';

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
export const RECEIPT_RELATIVE_PATH = PACKAGE_RECEIPT_PATH;

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
 * @summary Serializes cooperating installers for this host account, including shared recovery slots.
 * A single transaction lease covers all application, staging, parked and rollback paths even when
 * two plans use different userData roots or path aliases. It does not fence a legacy app process;
 * the issuer guard and fresh bundle-process census remain independent requirements.
 * @param {Object} [options]
 * @param {String} [options.directory=DEFAULT_INSTALL_TRANSACTION_DIR] Isolated fixture seam, never a CLI flag.
 * @returns {{assertCurrent:Function, release:Function}} Protected lease with observed release.
 */
export function holdInstallTransaction({directory = DEFAULT_INSTALL_TRANSACTION_DIR} = {}) {
    return holdPackageTransaction({directory, acquireLease: holdFileLease});
}

/**
 * The custody set the leg proves it left alone: the plane record at the userData root and the
 * fleet root's own files (registry, credentials, keys, tenants). Seat homes under `brain/fleet/agents/`
 * are the seats' own mutable state — full checkouts whose `.neo-ai-data` links point INTO the
 * bundle this leg replaces — so only their presence is custody, never their contents.
 */
export const CUSTODY_PLANE_FILES = Object.freeze(['plane.json', 'plane-bearer.bin', 'seat-root.json']);
export const CUSTODY_FLEET_DIR   = path.join('brain', 'fleet');
export const CUSTODY_AGENTS_DIR  = 'agents';

/**
 * @summary Observes all managed custody locations without reading contents or following links.
 * This is not a fleet-liveness proof. The installer revalidates the observation under exclusion;
 * retained runtime generations count even though the ordinary custody digest excludes them.
 * @param {String} userDataDir Explicit absolute target userData root.
 * @param {Object} [options]
 * @param {Object} [options.fileSystem=fs] Read-only filesystem seam.
 * @returns {{state:String, locations:Object[]}} Absent, present or unknown; never a guessed empty fleet.
 */
export function inspectManagedCustody(userDataDir, {fileSystem = fs} = {}) {
    if (typeof userDataDir !== 'string' || !path.isAbsolute(userDataDir)) throw new TypeError('an absolute userData root is required');
    const locations = [...CUSTODY_PLANE_FILES, CUSTODY_FLEET_DIR, path.join('brain', 'runtime')].map(relative => {
        const target  = path.resolve(userDataDir, relative), parsed = path.parse(target);
        const parts   = path.relative(parsed.root, target).split(path.sep);
        let   current = parsed.root;
        for (let i = 0; i < parts.length; i++) {
            current = path.join(current, parts[i]);
            let stat;
            try { stat = fileSystem.lstatSync(current) } catch (error) {
                return {path: relative, kind: error.code === 'ENOENT' ? 'absent' : 'unknown'};
            }
            const last = i === parts.length - 1;
            if (stat.isSymbolicLink()) return {path: relative, kind: last ? 'link' : 'unknown'};
            if (!last && !stat.isDirectory()) return {path: relative, kind: 'unknown'};
            if (last) return {path: relative, kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'};
        }
    });
    return {state: locations.some(row => row.kind === 'unknown') ? 'unknown'
        : locations.some(row => row.kind !== 'absent') ? 'present' : 'absent', locations};
}

export const PEER_QUIT_WARNING =
    `Quitting ${APP_NAME} leaves detached desktop harnesses running. Their MCP processes may still use this bundle; ` +
    'the installer refuses replacement until those processes exit. Any separate seat shutdown needs a checkpoint.';

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
        generation   = bundle => custodyDir && steps.push({type: 'runtime', bundle, directory: path.join(custodyDir, 'brain', 'runtime')}),
        quit         = () => {
            if (running.length) {
                steps.push({type: 'quit', bundle: installed.path, paths: running});
                warnings.push(PEER_QUIT_WARNING)
            }
            // The baseline is taken once nothing of the app's own runs: a lifecycle write during its
            // shutdown is the app's, not this leg's.
            custody('baseline')
        };

    /** @summary Carries the observed package slots into execution instead of silently replanning a stale update. */
    const finish = note => {
        if (steps.length) {
            const slots = [installed, rollback, parked ?? {path: `${installed.path}.restoring`, exists: false, receipt: null}];
            if (mode === 'install' && !parked?.exists) slots.push(artifact);
            steps.unshift({type: 'bind-slots', slots: structuredClone(slots), custodyDir,
                protectionPaths  : slots.slice(0, 3).map(slot => slot.path),
                sourceBundle     : [installed, parked, rollback].find(slot => slot?.exists)?.path ?? null,
                destinationBundle: parked?.exists ? (installed.exists ? installed.path : parked.path)
                    : mode === 'restore' ? rollback.path : artifact.path,
                legacyMigration: flags.legacyMigration === true,
                requireStopped : steps.some(step => ['stage', 'remove', 'rename'].includes(step.type))});
            if (flags.legacyMigration) warnings.push('Legacy migration is discontinuous: checkpoint and Stop all seats before installation, then Start them again.');
            const openIndex = steps.findIndex(step => step.type === 'open');
            steps.splice(openIndex < 0 ? steps.length : openIndex, 0, {type: 'publish-protection'});
        }
        return {ok: true, steps, warnings, ...(note ? {note} : {})};
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
        if (!parked.receipt) return refusal('parked-receipt-missing', ['The interrupted slot has no readable package receipt.']);
        if (installed.exists && rollback.exists) {
            return refusal('interrupted-restore-ambiguous', [
                `An interrupted restore left ${parked.path} beside a filled installed slot and a filled rollback slot; move one by hand before running again.`
            ])
        }

        const to = installed.exists ? rollback.path : installed.path;

        quit();
        generation(installed.exists ? installed.path : parked.path);
        steps.push({type: 'rename', from: parked.path, to});
        steps.push({type: 'verify', path: installed.path, receipt: installed.exists ? installed.receipt : parked.receipt});
        custody('compare');

        return finish(`An interrupted restore left ${parked.path}; this run only completes it (→ ${to}). Re-run for a swap.`)
    }

    if (mode === 'restore') {
        if (!rollback.exists) {
            return refusal('rollback-missing', [`No rollback bundle at ${rollback.path}.`])
        }
        if (!rollback.receipt) return refusal('rollback-receipt-missing', ['The rollback slot has no readable package receipt.']);
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
            // A receipt match cannot hide different bytes, or skip first-run materialisation.
            generation(installed.path);
            generation(artifact.path);
            return finish(`${installed.path} already carries this receipt; nothing to replace.`)
        }
    }

    quit();

    if (mode === 'restore') {
        generation(rollback.path);
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
        generation(staged);

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

    return finish()
}

/**
 * @summary Binds the current issuer before Quit without consuming its handoff or changing custody.
 * A capable source must have a readable journal even when stopped. First install proves absence of
 * managed records under vacancy exclusion; legacy migration requires explicit discontinuous intent.
 * @param {Object} binding Planned source/destination bundles, custodyDir and legacyMigration intent.
 * @param {Object} [options]
 * @param {Function} [options.inspectSupport=inspectRuntimeSupport] Receipt-bound capability inspection.
 * @returns {Promise<{hold:Function}>} Acquire the sealed predecessor after ordinary Quit completes.
 */
export async function prepareInstallContinuity({sourceBundle, destinationBundle, custodyDir, legacyMigration = false}, {inspectSupport = inspectRuntimeSupport} = {}) {
    if (!path.isAbsolute(custodyDir || '')) throw new Error('update continuity requires an explicit userData root');
    const inspect = bundlePath => inspectSupport({bundlePath,
        runtimeRoot: path.dirname(path.join(bundlePath, RECEIPT_RELATIVE_PATH)), verifier: runtimeVerifier});
    const support       = sourceBundle ? await inspect(sourceBundle) : null;
    const target        = await inspect(destinationBundle);
    const discontinuous = support?.kind === 'legacy' || target.kind === 'legacy';
    if (discontinuous && !legacyMigration) throw new Error('legacy migration requires explicit --legacy-migration intent');
    const directory = path.join(custodyDir, CUSTODY_FLEET_DIR, 'launch-admission');
    const observed  = readLaunchAdmissionJournal({directory});
    if (!observed && support?.kind === 'generation') throw new Error('generation-capable source has no admission journal; update refused');
    if (!sourceBundle) {
        if (observed) throw new Error('admission custody remains without a source package; recovery is required');
        assertFirstInstallCustody(custodyDir);
    }
    const expected = observed ? {issuer: observed.state.issuer, epoch: observed.state.epoch} : null;
    if (expected && (observed.fence.issuer !== expected.issuer || observed.fence.epoch !== expected.epoch)) {
        throw new Error('admission predecessor is already fenced');
    }
    return {hold() {
        const held = expected ? holdLaunchAdmissionHandoff({directory, expected}) : holdLaunchAdmissionVacancy({directory});
        try {
            if (!sourceBundle) assertFirstInstallCustody(custodyDir, {held: true});
            if (discontinuous && held.evidence) {
                const snapshot = held.evidence.state.snapshot;
                if (!snapshot.seats.every(row => ['stopped', 'exited'].includes(row.state) && !row.ownershipUnresolved && !row.cleanupUnresolved) ||
                    !snapshot.generations.every(row => row.state === 'revoked' && row.servers.every(server => server.state === 'revoked'))) {
                    throw new Error('legacy migration requires terminal original Starts and revoked grants');
                }
            }
            return {...held, requiresRecovery: target.kind === 'generation'};
        } catch (error) {
            held.release();
            throw error;
        }
    }};
}

/**
 * @summary Refuses every managed record, retained runtime or unknown path before first install.
 * Empty Fleet/journal directories are structural retry residue. Under exclusion the only permitted
 * journal entry is this guard's issuer lock; no app, issuer, seat or plane history is inferred away.
 */
function assertFirstInstallCustody(userDataDir, {held = false} = {}) {
    const observation = inspectManagedCustody(userDataDir);
    if (observation.state === 'unknown' || observation.locations.some(row => row.path !== CUSTODY_FLEET_DIR && row.kind !== 'absent')) {
        throw new Error('managed custody remains without a source package; recovery is required');
    }
    const fleet = observation.locations.find(row => row.path === CUSTODY_FLEET_DIR);
    if (fleet.kind === 'absent') return;
    const directory = path.join(userDataDir, CUSTODY_FLEET_DIR);
    if (fleet.kind !== 'directory' || fs.readdirSync(directory).some(name => name !== 'launch-admission')) {
        throw new Error('managed Fleet custody remains without a source package; recovery is required');
    }
    if (held && fs.readdirSync(path.join(directory, 'launch-admission')).some(name => name !== 'issuer.lock')) {
        throw new Error('unknown admission custody prevents first install');
    }
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
 * @param {Function} [options.materializeFn=materializeRuntimeGeneration] Verified runtime publisher.
 * @param {Function} [options.continuityFn=prepareInstallContinuity] Source-owned journal preparation.
 * @param {Function} [options.recoveryFn=probeRuntimeRecovery] Destination snapshot compatibility probe.
 * @param {Function} [options.verifyRuntimeFn=runtimeVerifier.readRuntimeGeneration] Trusted payload verifier.
 * @param {Function} [options.transactionFn=holdInstallTransaction] Host-account package transaction guard.
 * @param {Function} [options.publishSlotsFn=publishPackageSlots] Durable installer-owned package protection.
 * @returns {Promise<{custody: Object|null, generation: Object|null}>}
 */
export async function executePlan(steps, {
    runFn = run, runningFn = () => runningHarnessPaths(), quitTimeoutMs = 30000,
    materializeFn = materializeRuntimeGeneration, continuityFn = prepareInstallContinuity,
    recoveryFn = probeRuntimeRecovery, verifyRuntimeFn = runtimeVerifier.readRuntimeGeneration,
    transactionFn = holdInstallTransaction, publishSlotsFn = publishPackageSlots
} = {}) {
    const custody        = {before: undefined, after: undefined};
    let   generation     = null, bindings = null, requireStopped = false;
    let   continuity     = null, guard = null, transaction = null;
    let   referenceGuard = null, runtimeDirectory = null, protectionPaths = null, protectionPublished = false;

    /** @summary Acquires the second guard only after package ownership and any issuer handoff. */
    async function holdReferences() {
        if (!runtimeDirectory || referenceGuard) return;
        fs.mkdirSync(runtimeDirectory, {recursive: true, mode: 0o700});
        runtimeDirectory = fs.realpathSync(runtimeDirectory);
        referenceGuard = await runtimeReferences.waitForRuntimeGenerationReferences({directory: runtimeDirectory});
        beforeMutation();
    }

    /** @summary Completes durable slot protection before release/open, including no-op and restore plans. */
    function publishProtection() {
        if (!runtimeDirectory || protectionPublished) return;
        beforeMutation();
        publishSlotsFn({directory: runtimeDirectory, slots: protectionPaths.map(target => bindings.get(target)),
            packageGuard: transaction, referenceGuard, references: runtimeReferences, verifier: runtimeVerifier});
        protectionPublished = true;
    }

    /** @summary Checks the original plan plus this executor's own completed slot moves. */
    function verifyBindings() {
        if (!bindings) throw new Error('package slot bindings are missing from the install plan');
        for (const expected of bindings.values()) {
            if (!isDeepStrictEqual(readSlot(expected.path), expected)) {
                throw new Error(`planned package slot changed: ${expected.path}; rebuild the plan before retrying`);
            }
        }
    }

    /** @summary A stopped census and current slots are required before any destructive slot action. */
    function beforeMutation() {
        transaction?.assertCurrent();
        if (requireStopped && !guard) {
            if (!continuity) throw new Error('update continuity was not prepared');
            guard = continuity.hold();
        }
        guard?.assertCurrent();
        if (referenceGuard) runtimeReferences.assertRuntimeGenerationReferences(referenceGuard, runtimeDirectory);
        verifyBindings();
        if (requireStopped && runningFn().length) throw new Error('bundle users appeared after planning or Quit; refusing package mutation');
        guard?.assertCurrent();
        verifyBindings();
    }

    /** @summary Attempts every release even if one fails, and never launches after an unproved release. */
    function releaseExclusion() {
        const failures = [];
        for (const [held, clear] of [[referenceGuard, () => { referenceGuard = null }],
            [guard, () => { guard = null }], [transaction, () => { transaction = null }]]) {
            if (!held) continue;
            try {
                if (held.release() !== true) throw new Error('installer exclusion release is unproved; app was not launched');
                clear();
            } catch (error) { failures.push(error) }
        }
        if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
    }

    /** @summary Advances only a slot change this plan performed; foreign changes never become its new baseline. */
    function moveBinding(from, to) {
        const source = bindings.get(from);
        if (!source?.exists) throw new Error('planned source slot is unavailable');
        bindings.set(to, {...source, path: to});
        bindings.set(from, {path: from, exists: false, receipt: null});
    }

    try {
        for (const step of steps) {
            try {
                if (['stage', 'remove', 'runtime', 'rename', 'open'].includes(step.type)) {
                    beforeMutation();
                    if (runtimeDirectory && !referenceGuard) await holdReferences();
                }
                switch (step.type) {
                    case 'bind-slots':
                        if (bindings) throw new Error('install plan contains multiple slot bindings');
                        transaction = transactionFn();
                        transaction?.assertCurrent();
                        bindings = new Map(step.slots.map(slot => [slot.path, structuredClone(slot)]));
                        requireStopped = step.requireStopped;
                        runtimeDirectory = step.custodyDir ? path.join(step.custodyDir, 'brain', 'runtime') : null;
                        protectionPaths = step.protectionPaths;
                        verifyBindings();
                        if (requireStopped) {
                            continuity = await continuityFn(step);
                            transaction?.assertCurrent();
                            verifyBindings();
                        }
                        break;
                    case 'quit':
                        transaction?.assertCurrent();
                        verifyBindings();
                        // Through the app's own lifecycle, never a signal: quit drains its owned Brain
                        // children, not detached desktop seats. The census still waits for all bundle users.
                        // Addressed by PATH, not bundle identifier: development builds share the identifier,
                        // so an id-based quit resolves through a Launch Services pick among every copy — and
                        // AppleScript launches the copy it picked if that one is not running.
                        runFn('osascript', ['-e', `tell application "${step.bundle}" to quit`]);
                        waitUntilGone(runningFn, quitTimeoutMs);
                        break;
                    case 'custody':
                        beforeMutation();
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
                        bindings.set(step.to, {...bindings.get(step.from), path: step.to});
                        break;
                    case 'remove':
                        fs.rmSync(step.path, {force: true, recursive: true});
                        bindings.set(step.path, {path: step.path, exists: false, receipt: null});
                        break;
                    case 'runtime':
                        generation = await materializeFn({
                            bundlePath : step.bundle,
                            runtimeRoot: path.dirname(path.join(step.bundle, RECEIPT_RELATIVE_PATH)),
                            executable : path.join(step.bundle, 'Contents', 'MacOS', APP_NAME),
                            directory  : step.directory,
                            verifier   : runtimeVerifier,
                            references : runtimeReferences,
                            referenceGuard
                        });
                        beforeMutation();
                        if (guard?.evidence) {
                            if (guard.requiresRecovery !== false) {
                                await recoveryFn(generation, guard.evidence.state.snapshot, {validateSnapshot: isAdmissionSnapshot});
                            }
                            beforeMutation();
                            const verified = await verifyRuntimeFn({directory: generation.directory});
                            beforeMutation();
                            if (!isDeepStrictEqual(verified, generation)) throw new Error('destination runtime changed during compatibility verification');
                        }
                        break;
                    case 'rename':
                        fs.mkdirSync(path.dirname(step.to), {recursive: true});
                        fs.renameSync(step.from, step.to);
                        moveBinding(step.from, step.to);
                        break;
                    case 'verify': {
                        const slot = readSlot(step.path), found = slot.receipt;

                        if (!slot.exists || !found || !step.receipt) throw new Error('complete package receipts are required for verification');
                        if (!isDeepStrictEqual(found, step.receipt)) {
                            throw new Error(`carries "${describeReceipt(found)}", expected "${describeReceipt(step.receipt)}"`)
                        }
                        break
                    }
                    case 'open':
                        if (guard) {
                            if (custody.before === undefined || custody.after !== custody.before) throw new Error('custody comparison must complete before launch');
                        }
                        if (runtimeDirectory && !protectionPublished) throw Error('package protection must complete before launch');
                        releaseExclusion();
                        runFn('open', ['-a', step.path]);
                        break;
                    case 'publish-protection':
                        beforeMutation();
                        await holdReferences();
                        publishProtection();
                        break;
                    default:
                        throw new Error('unknown step')
                }
            } catch (error) {
                throw new Error(`failed at "${describeStep(step).split('\n')[0].trim()}": ${error.message}`, {cause: error})
            }
        }

        if (bindings && transaction) verifyBindings();
        return {custody: custody.before === undefined ? null : custody, generation}
    } finally {
        releaseExclusion();
    }
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
        brain    = owners.brain?.revision?.slice(0, 7)                ?? '?',
        // the Engine tracks `dev`, so its pin names a branch; a receipt from before the revision names it only there
        engine   = (owners.engine?.revision ?? owners.engine?.pin?.split('#').pop())?.slice(0, 7) ?? '?',
        product  = owners.product?.version                           ?? '?',
        revision = owners.product?.revision?.slice(0, 7)              ?? '?';

    return `staged ${stagedAt} · Brain ${brain} · Engine ${engine} · product ${product} @ ${revision}`
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
        legacyMigration: false,
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
            case '--legacy-migration': options.legacyMigration = true;     break;
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
 * own files alone. ONE policy for every selected path, applied before anything is read: a symlink
 * contributes its target string (dangling or not) and is never followed; a regular file its bytes;
 * the fleet root's directory its depth-1 entries under the same policy; the `agents` directory the
 * names of the seats, never their homes. Contents are hashed, never printed or copied. The first
 * run of this leg hashed every file under the seat homes and followed their `.neo-ai-data` links
 * into the bundle it had just replaced, so a correct install read as a custody change; the policy
 * here is the one that cannot, and it covers the plane record whether or not a fleet root exists.
 * @param {String} userDataDir The app's userData root (`app.getPath('userData')`)
 * @returns {String|null} `null` when no custody member exists at all — the empty set, not a verdict
 */
export function custodyDigest(userDataDir) {
    const
        hash = createHash('sha256'),
        feed = (label, bytes) => {
            hash.update(`${label}\0`);
            bytes !== null && hash.update(bytes);
            hash.update('\0')
        },
        // The classification is the policy: what a path IS decides what is read, and a link is read
        // as a link however the loop that found it would have liked to treat it.
        classify = full => {
            let stat;

            try {
                stat = fs.lstatSync(full)
            } catch {
                return null
            }

            if (stat.isSymbolicLink()) return {kind: 'link', bytes: Buffer.from(fs.readlinkSync(full))};
            if (stat.isFile())         return {kind: 'file', bytes: fs.readFileSync(full)};
            if (stat.isDirectory())    return {kind: 'dir',  bytes: null};
            return {kind: 'other', bytes: null}
        },
        fleetDir  = path.join(userDataDir, CUSTODY_FLEET_DIR),
        fleetRoot = classify(fleetDir);

    let members = 0;

    for (const name of CUSTODY_PLANE_FILES) {
        const member = classify(path.join(userDataDir, name));

        if (member) {
            members++;
            feed(`${name} [${member.kind}]`, member.bytes)
        }
    }

    if (fleetRoot) {
        members++;
        feed(`${CUSTODY_FLEET_DIR} [${fleetRoot.kind}]`, fleetRoot.bytes);

        // Only a real directory is entered; a linked fleet root is custody by its target alone.
        if (fleetRoot.kind === 'dir') {
            const entries = fs.readdirSync(fleetDir).sort();

            for (const name of entries) {
                const
                    label  = path.join(CUSTODY_FLEET_DIR, name),
                    member = classify(path.join(fleetDir, name));

                if (!member) continue;

                // The seats' presence is custody; their homes are their own.
                feed(`${label} [${member.kind}]`, member.kind === 'dir' && name === CUSTODY_AGENTS_DIR
                    ? Buffer.from(fs.readdirSync(path.join(fleetDir, name)).sort().join('\0'))
                    : member.bytes)
            }
        }
    }

    return members ? hash.digest('hex') : null
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
        case 'bind-slots': return 'verify the planned package-slot bindings';
        case 'publish-protection': return 'record verified installed and rollback package protection';
        case 'quit'   : return `quit    ${APP_NAME} (${processCount(step.paths)})`;
        case 'custody': return `${step.phase === 'baseline' ? 'hash   ' : 'compare'} the custody set under ${step.dir} (plane record · fleet root · seat presence)`;
        case 'stage'  : return `copy    ${step.from}\n     →  ${step.to}`;
        case 'remove' : return `remove  ${step.path}`;
        case 'rename' : return `move    ${step.from}\n     →  ${step.to}`;
        case 'verify' : return `verify  ${step.path} carries "${describeReceipt(step.receipt)}"`;
        case 'runtime': return `prepare verified runtime from ${step.bundle}\n     →  ${step.directory}`;
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
    console.log('  --legacy-migration  Explicit discontinuous Stop-all/install/Start path for a recognized legacy package.');
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
        plan       = planInstall({artifact, custodyDir, flags: {open: options.open, quit: options.quit, legacyMigration: options.legacyMigration}, installed, mode: options.mode, parked, rollback, running});

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

    const {custody, generation} = await executePlan(plan.steps);

    console.log(`\n${describeSlot('installed', readSlot(installed.path), 'absent')}`);
    console.log(describeSlot('rollback', readSlot(rollback.path), 'empty'));
    generation && console.log(`runtime    ${generation.id}\n           ${generation.directory}`);
    custody && console.log(`${'custody'.padEnd(10)} ${custodyDir}\n           ${custody.before === null ? 'absent' : `unchanged (${custody.before.slice(0, 12)})`}`)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

invokedDirectly && main().catch(error => {
    console.error(error.message);
    process.exit(1)
});
