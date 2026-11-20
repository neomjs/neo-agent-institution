import {randomUUID}                                                                                    from 'node:crypto';
import fs                                                                                              from 'node:fs';
import path                                                                                            from 'node:path';
import {retireCodexWakeArtifacts}                                                                      from './codexWakeArtifact.mjs';
import {classifyRuntimeGenerationRetention, inspectRuntimeGenerationProcesses, removeOwnedRuntimeTree} from './runtimeGeneration.mjs';
import {holdPackageTransaction, inspectPackageProtection}                                              from './packageSlots.mjs';

/**
 * @module harness/runtimeMaintenance
 * @summary Retires unused package generations through the existing package, reference and journal owners.
 * A private removal receipt permits interrupted cleanup of the same inode. It never authorizes
 * removal of a published path, and carries no independent seat or admission reference counts.
 */
const RETIRING  = '.retiring-';
const idPattern = /^[a-f0-9]{64}$/, transactionPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/**
 * @summary How long one pass may run. Every seat Start and every install waits on the package and
 * reference leases, so the pass verifies payloads before it takes them: a verify that never settles
 * holds neither, and the leases cover only the census and a removal. A real pass verifies a generation
 * in about 6 s and its census takes at most 30 s (three 10 s probes); 2 minutes is roughly ten real passes.
 */
export const RUNTIME_MAINTENANCE_DEADLINE_MS = 120000;

/**
 * @summary The longest wait after consecutive deadline halts. Nothing cancels a halted verify's read,
 * so the wait doubles from the cadence up to this cap instead of starting another read every tick.
 */
export const RUNTIME_MAINTENANCE_MAX_BACKOFF_MS = 1800000;

/**
 * @summary How long the pass may wait on a read while it holds both leases. A seat Start waits at most the
 * Brain's `RUNTIME_REFERENCE_START_WAIT_MS` (20 s) for the reference lease, so a census that never settles
 * halts here rather than at the pass deadline. A real census takes well under a second.
 */
export const RUNTIME_MAINTENANCE_LEASED_DEADLINE_MS = 10000;
const DEADLINES = new Set(['pass-deadline', 'lease-deadline']), HALTS = new Set([...DEADLINES, 'pass-aborted']);

/**
 * @summary Reports removals and each active deferral reason once until it clears.
 * @param {Object} logger Shell log sink.
 * @returns {Function} The ordinary scheduled maintenance result observer.
 */
export function runtimeMaintenanceReporter(logger = console) {
    let previous = new Set();
    return result => {
        const removed = result.generations.filter(row => row.state === 'removed').map(row => row.id);
        if (removed.length) logger.log('HARNESS_RUNTIME_RETIRED ' + JSON.stringify(removed));
        const reasons = new Set((result.artifacts || []).filter(row => row.state === 'retained' && row.reason !== 'process-held').map(row => row.reason));
        if (result.phase) logger.warn(`HARNESS_RUNTIME_MAINTENANCE_DEFERRED ${result.reason} ${result.phase.step} ${result.phase.id ?? '-'}`);
        else if (result.state === 'deferred') reasons.add(result.reason);
        for (const reason of reasons) {
            if (!previous.has(reason)) logger.warn('HARNESS_RUNTIME_MAINTENANCE_DEFERRED ' + reason)
        }
        previous = reasons
    }
}

/** @summary Requires an owner-controlled canonical directory without repairing its custody. */
function ownedDirectory(directory) {
    const stat = fs.lstatSync(directory, {bigint: true});
    if (!stat.isDirectory() || stat.uid !== BigInt(process.getuid()) || stat.mode & 0o022n ||
        fs.realpathSync(directory) !== directory) throw Error('runtime-maintenance-directory-unknown');
    return stat;
}

/** @summary Flushes directory-entry changes before a removal transaction proceeds. */
function flushDirectory(directory) {
    const descriptor = fs.openSync(directory, 'r');
    try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

/** @summary Reads bounded owner-only metadata without following or accepting a substituted file. */
function readOwnedJson(file, maxBytes) {
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const before = fs.fstatSync(descriptor, {bigint: true});
        if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.mode & 0o077n ||
            before.nlink !== 1n || before.size > BigInt(maxBytes)) throw Error('runtime-maintenance-record-unknown');
        const buffer = Buffer.alloc(Number(before.size) + 1);
        let   count  = 0;
        while (count < buffer.length) {
            const read = fs.readSync(descriptor, buffer, count, buffer.length - count, count);
            if (!read) break;
            count += read;
        }
        const after = fs.fstatSync(descriptor, {bigint: true}), named = fs.lstatSync(file, {bigint: true});
        if (count !== Number(before.size) || [after, named].some(stat =>
            ['dev', 'ino', 'uid', 'mode', 'size', 'mtimeNs', 'ctimeNs'].some(key => stat[key] !== before[key]))) {
            throw Error('runtime-removal-receipt-changed');
        }
        return JSON.parse(buffer.subarray(0, count).toString('utf8'));
    } finally { fs.closeSync(descriptor) }
}

/** @summary Binds a removal receipt to its original pin and one privately quarantined inode. */
function readRemovalReceipt(target, verifier) {
    ownedDirectory(path.dirname(target));
    const record = readOwnedJson(target + '.json', 65536);
    if (!record || Object.keys(record).sort().join(',') !== 'birth,dev,ino,pin,version' || record.version !== 1 ||
        !verifier.isRuntimeGenerationPin(record.pin) || record.pin.directory !== path.join(path.dirname(target), record.pin.id) ||
        ![record.birth, record.dev, record.ino].every(value => typeof value === 'string' && /^[0-9]+$/.test(value))) throw Error('runtime-removal-receipt-invalid');
    return record;
}

/**
 * @summary Performs one guarded maintenance pass; every uncertain observation retains its generation.
 * Expensive payload verification is skipped for positively retained generations. A removal requires
 * the current trusted verifier plus a fresh complete census and current package/journal evidence.
 *
 * Payload verification reads only sealed, non-current trees, so it runs before the pass takes either
 * lease; unguarded evidence there only chooses what to verify. Under both leases the pass decides again on
 * fresh evidence and a census, and removes only a tree whose inode is the one captured before its verify.
 * Once it holds them, a shorter leased deadline bounds its reads, so a census that never settles keeps a
 * seat Start waiting no longer than that deadline.
 * Either deadline or the owner's abort ends a pending read (payload verify, census), the `finally` releases
 * the leases the pass took, and the result names the step and generation it stopped in. A removal is never
 * abandoned: it deletes by path, so a successor holding the leases could see its tree retained or replaced.
 * It finishes under both leases, and a halt takes effect at the next step.
 * @param {Object} options Explicit host generation, trusted Brain contracts and custody directory.
 * @param {Number} [options.deadlineMs=RUNTIME_MAINTENANCE_DEADLINE_MS] Longest time the pass runs.
 * @param {Number} [options.leasedDeadlineMs=RUNTIME_MAINTENANCE_LEASED_DEADLINE_MS] Longest wait on a read under both leases.
 * @param {AbortSignal} [options.signal] The owner's teardown; aborting ends the pass at its pending step.
 * @param {Object} [dependencies] Isolated transaction, census, interruption and clock seams for fixtures.
 * @returns {Promise<Object>} Per-generation removal/retention facts; never readiness or seat migration.
 * A halted pass returns `{state: 'deferred', reason: 'pass-deadline' | 'lease-deadline' | 'pass-aborted', phase: {step, id}}`.
 */
export async function retireRuntimeGenerations({directory, currentGeneration, journalDirectory, verifier, references, journal, leases,
    deadlineMs = RUNTIME_MAINTENANCE_DEADLINE_MS, leasedDeadlineMs = RUNTIME_MAINTENANCE_LEASED_DEADLINE_MS, signal}, {
    transactionFn = () => holdPackageTransaction({acquireLease: leases.holdFileLease}),
    inspectProcesses = inspectRuntimeGenerationProcesses, removeTree = removeOwnedRuntimeTree, renameTree = fs.renameSync,
    setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout
} = {}) {
    const generations = [];
    let packageGuard, referenceGuard, timer, leasedTimer, halt, haltCode = null, phase = {step: 'acquire', id: null};
    const halted  = new Promise((resolve, reject) => { halt = code => { haltCode ??= code; reject(Object.assign(Error(code), {code})) } });
    const onAbort = () => halt('pass-aborted');
    halted.catch(() => {});
    /** @summary Records where the pass is, then lets its deadline or its owner's abort end a step that never settles. */
    function bounded(step, id, promise) {
        phase = {step, id};
        return Promise.race([promise, halted]);
    }
    /** @summary Lets a halt leave a per-item catch, even one a running step reaches with its own late error, so the pass stops at that step's phase. */
    function rethrowHalt(error) {
        if (HALTS.has(error.code)) throw error;
        stopIfHalted();
    }
    /** @summary Starts no further step once the pass has halted; a removal already running still finishes under both leases. */
    function stopIfHalted() {
        if (haltCode) throw Object.assign(Error(haltCode), {code: haltCode});
    }
    /** @summary Joins a step that must finish under both leases, never racing it, then lets a halt that fired during it leave with its phase. */
    async function joined(step, id, promise) {
        phase = {step, id};
        const value = await promise;
        stopIfHalted();
        return value;
    }
    /** @summary Revalidates both exclusion owners in the acquisition order. */
    function assertCurrent() {
        packageGuard.assertCurrent();
        references.assertRuntimeGenerationReferences(referenceGuard, directory);
    }
    /** @summary Reads the full journal, never the registry-filtered cockpit projection; unguarded, it only chooses what to verify. */
    function evidence(guarded = true) {
        if (guarded) assertCurrent();
        const packages = inspectPackageProtection({directory, verifier});
        let   snapshot = null;
        try {
            const observed = journal.readLaunchAdmissionJournal({directory: journalDirectory,
                validateSnapshot: journal.isRuntimeReferenceSnapshot});
            if (observed && observed.state.issuer === observed.fence.issuer && observed.state.epoch === observed.fence.epoch) {
                snapshot = observed.state.snapshot;
            }
        } catch {}
        return {snapshot, protectedIds: packages.state === 'observed' ? [...packages.protectedIds, currentGeneration.id] : null};
    }
    /** @summary Applies the same retention rules before and after asynchronous process inspection. */
    function classify(generation, census, guarded = true) {
        return classifyRuntimeGenerationRetention({generation, ...evidence(guarded), census, verifier,
            validateReferences: journal.isRuntimeReferenceSnapshot});
    }
    /** @summary Distinguishes positive or unknown retention from the still-unperformed process observation. */
    function preliminarilyRetained(generation, guarded = true) {
        return classify(generation, {state: 'unknown', processes: []}, guarded).reasons.filter(reason => reason.code !== 'process-census-unknown');
    }
    /** @summary The published generation directories, listed afresh for each phase. */
    function generationIds() {
        return fs.readdirSync(directory).filter(name => idPattern.test(name));
    }
    /** @summary A generation's owned directory and its record's descriptor, never a substituted record. */
    function readCandidate(target) {
        const stat = ownedDirectory(target);
        return {stat, candidate: verifier.runtimeGenerationDescriptor(target,
            readOwnedJson(path.join(target, verifier.RUNTIME_GENERATION_RECORD), 16 * 1024 * 1024))};
    }
    /** @summary Cleans only a committed inode after fresh retention and process observations permit it. */
    async function finishRemoval(target) {
        const record = readRemovalReceipt(target, verifier), {pin} = record;
        let stat;
        try { stat = ownedDirectory(target) } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            assertCurrent();
            fs.unlinkSync(target + '.json');
            return {id: pin.id, directory: target, state: 'receipt-cleared', reasons: []};
        }
        if (String(stat.dev) !== record.dev || String(stat.ino) !== record.ino || String(stat.birthtimeNs) !== record.birth) throw Error('runtime-removal-inode-changed');
        const preliminary = preliminarilyRetained(pin);
        if (preliminary.length) return {id: pin.id, directory: target, state: 'retained', reasons: preliminary};
        const census = await bounded('census', pin.id, inspectProcesses({directories: [target]}));
        // The receipt retains the original pin; only this inode's physical path moved.
        const decision = classify(pin, {...census, processes: census.processes?.map(row => ({...row,
            directories: row.directories?.map(directory => directory === target ? pin.directory : directory)}))});
        if (!decision.eligible) return {id: pin.id, directory: target, state: 'retained', reasons: decision.reasons};
        const current = ownedDirectory(target);
        if (current.dev !== stat.dev || current.ino !== stat.ino || current.birthtimeNs !== stat.birthtimeNs) throw Error('runtime-removal-inode-changed');
        assertCurrent();
        phase = {step: 'remove', id: pin.id};
        await removeTree(target);
        assertCurrent();
        fs.unlinkSync(target + '.json');
        flushDirectory(directory);
        return {id: pin.id, directory: target, state: 'removed', reasons: []};
    }
    try {
        if (signal?.aborted) throw Object.assign(Error('pass-aborted'), {code: 'pass-aborted'});
        signal?.addEventListener('abort', onAbort, {once: true});
        timer = setTimeoutFn(() => halt('pass-deadline'), deadlineMs);
        timer?.unref?.();
        if (path.dirname(verifier.runtimeGenerationPin(currentGeneration).directory) !== directory) throw Error('runtime-maintenance-host-binding-invalid');
        // No lease is held yet: a verify that never settles keeps no seat Start or install waiting.
        const verified = new Map();
        for (const id of generationIds()) {
            const target = path.join(directory, id);
            try {
                const {stat, candidate} = readCandidate(target);
                if (preliminarilyRetained(candidate, false).length) continue;
                verified.set(id, {original: stat, generation: await bounded('verify', id, verifier.readRuntimeGeneration({directory: target}))});
            } catch (error) {
                rethrowHalt(error);
                verified.set(id, {error});
            }
        }
        packageGuard = transactionFn();
        referenceGuard = references.holdRuntimeGenerationReferences({directory});
        leasedTimer = setTimeoutFn(() => halt('lease-deadline'), leasedDeadlineMs);
        leasedTimer?.unref?.();
        assertCurrent();
        const pending = new Set(fs.readdirSync(directory).filter(name => name.startsWith(RETIRING))
            .map(name => name.endsWith('.json') ? name.slice(0, -5) : name));
        for (const name of pending) {
            const target = path.join(directory, name);
            try {
                if (!transactionPattern.test(name.slice(RETIRING.length))) throw Error('runtime-removal-name-unknown');
                generations.push(await finishRemoval(target));
                stopIfHalted();
            } catch (error) {
                rethrowHalt(error);
                generations.push({directory: target, state: 'retained', reasons: [{code: error.code || error.message}]})
            }
        }
        for (const id of generationIds()) {
            const target = path.join(directory, id);
            try {
                const preliminary = preliminarilyRetained(readCandidate(target).candidate);
                if (preliminary.length) {
                    generations.push({id, directory: target, state: 'retained', reasons: preliminary});
                    continue;
                }
                // one the unguarded evidence skipped is verified by a later pass, never removed unverified
                const entry = verified.get(id) ?? {error: Error('runtime-verify-deferred')};
                if (entry.error) throw entry.error;
                const {generation, original} = entry;
                const census = await bounded('census', id, inspectProcesses({directories: [target]}));
                const decision   = classify(generation, census);
                if (!decision.eligible) {
                    generations.push({id, directory: target, state: 'retained', reasons: decision.reasons});
                    continue;
                }
                const current = ownedDirectory(target);
                if (current.dev !== original.dev || current.ino !== original.ino || current.birthtimeNs !== original.birthtimeNs ||
                    current.mode !== original.mode) throw Error('runtime-generation-changed');
                assertCurrent();
                const destination = path.join(directory, RETIRING + randomUUID());
                const pin         = verifier.runtimeGenerationPin(generation);
                const descriptor  = fs.openSync(destination + '.json', 'wx', 0o600);
                try {
                    fs.writeFileSync(descriptor, JSON.stringify({version: 1, pin, birth: String(original.birthtimeNs),
                        dev: String(original.dev), ino: String(original.ino)}) + '\n');
                    fs.fsyncSync(descriptor);
                } finally { fs.closeSync(descriptor) }
                flushDirectory(directory);
                assertCurrent();
                renameTree(target, destination);
                flushDirectory(directory);
                generations.push(await finishRemoval(destination));
                stopIfHalted();
            } catch (error) {
                rethrowHalt(error);
                generations.push({id, directory: target, state: 'retained', reasons: [{code: error.code || error.message}]})
            }
        }
        const artifacts = await retireCodexWakeArtifacts({directory,verifier,assertCurrent,inspectProcesses,removeTree,bounded,joined,rethrowHalt,stopIfHalted,...evidence()});
        return {state: 'observed', generations, ...(artifacts.length ? {artifacts} : {})};
    } catch (error) {
        return {state: 'deferred', reason: error.code || error.message, ...(HALTS.has(error.code) ? {phase} : {}), generations};
    } finally {
        clearTimeoutFn(timer);
        clearTimeoutFn(leasedTimer);
        signal?.removeEventListener('abort', onAbort);
        const failures = [];
        for (const guard of [referenceGuard, packageGuard]) {
            if (!guard) continue;
            try { if (guard.release() !== true) throw Error('runtime-maintenance-release-unproved') } catch (error) { failures.push(error) }
        }
        if (failures.length) throw new AggregateError(failures, 'runtime-maintenance-release-unproved');
    }
}

/**
 * @summary Runs non-overlapping maintenance on a host cadence and joins the final pass during teardown.
 * Each pass receives `{signal}`. Teardown aborts it and waits at most `closeTimeoutMs`, so an FM quit
 * never hangs behind a pass, even one that ignores its signal. Consecutive deadline halts double the
 * wait before the next pass, from the cadence up to `maxBackoffMs`; any other result resets it.
 * @param {Function} run One bounded asynchronous maintenance pass, called with `{signal}`.
 * @param {Object} [options] Clock and report seams; no new operator configuration.
 * @returns {{close: Function}} Closing prevents another pass, aborts the running one and joins it within the bound.
 */
export function startRuntimeMaintenance(run, {intervalMs = 60000, closeTimeoutMs = 5000, maxBackoffMs = RUNTIME_MAINTENANCE_MAX_BACKOFF_MS,
    onResult = () => {}, onError = () => {}, now = Date.now,
    setIntervalFn = setInterval, clearIntervalFn = clearInterval, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout} = {}) {
    let pending = null, closed = false, controller = null, halts = 0, resumeAt = 0;
    /** @summary Counts consecutive deadline halts and sets when the next pass may start. */
    function observe(result) {
        halts    = DEADLINES.has(result?.reason) ? halts + 1 : 0;
        resumeAt = halts ? now() + Math.min(intervalMs * 2 ** halts, maxBackoffMs) : 0;
        return result
    }
    /** @summary Coalesces cadence overlap without losing the in-flight teardown join. */
    function tick() {
        if (closed || pending || now() < resumeAt) return;
        controller = new AbortController();
        const {signal} = controller;
        pending = Promise.resolve().then(() => run({signal})).then(observe).then(onResult).catch(onError).finally(() => { pending = null; controller = null });
    }
    const timer = setIntervalFn(tick, intervalMs);
    timer.unref?.();
    tick();
    return {async close() {
        closed = true;
        clearIntervalFn(timer);
        controller?.abort();
        let bound;
        await Promise.race([pending, new Promise(resolve => { bound = setTimeoutFn(resolve, closeTimeoutMs) })]);
        clearTimeoutFn(bound);
    }};
}
