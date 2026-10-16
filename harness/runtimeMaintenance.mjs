import {randomUUID}                                                                                    from 'node:crypto';
import fs                                                                                              from 'node:fs';
import path                                                                                            from 'node:path';
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
 * @param {Object} options Explicit host generation, trusted Brain contracts and custody directory.
 * @param {Object} [dependencies] Isolated transaction, census and interruption seams for fixtures.
 * @returns {Promise<Object>} Per-generation removal/retention facts; never readiness or seat migration.
 */
export async function retireRuntimeGenerations({directory, currentGeneration, journalDirectory, verifier, references, journal, leases}, {
    transactionFn = () => holdPackageTransaction({acquireLease: leases.holdFileLease}),
    inspectProcesses = inspectRuntimeGenerationProcesses, removeTree = removeOwnedRuntimeTree, renameTree = fs.renameSync
} = {}) {
    const generations = [];
    let packageGuard, referenceGuard;
    /** @summary Revalidates both exclusion owners in the acquisition order. */
    function assertCurrent() {
        packageGuard.assertCurrent();
        references.assertRuntimeGenerationReferences(referenceGuard, directory);
    }
    /** @summary Reads the full journal, never the registry-filtered cockpit projection. */
    function evidence() {
        assertCurrent();
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
    function classify(generation, census) {
        return classifyRuntimeGenerationRetention({generation, ...evidence(), census, verifier,
            validateReferences: journal.isRuntimeReferenceSnapshot});
    }
    /** @summary Distinguishes positive or unknown retention from the still-unperformed process observation. */
    function preliminarilyRetained(generation) {
        return classify(generation, {state: 'unknown', processes: []}).reasons.filter(reason => reason.code !== 'process-census-unknown');
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
        const census = await inspectProcesses({directories: [target]});
        // The receipt retains the original pin; only this inode's physical path moved.
        const decision = classify(pin, {...census, processes: census.processes?.map(row => ({...row,
            directories: row.directories?.map(directory => directory === target ? pin.directory : directory)}))});
        if (!decision.eligible) return {id: pin.id, directory: target, state: 'retained', reasons: decision.reasons};
        const current = ownedDirectory(target);
        if (current.dev !== stat.dev || current.ino !== stat.ino || current.birthtimeNs !== stat.birthtimeNs) throw Error('runtime-removal-inode-changed');
        assertCurrent();
        await removeTree(target);
        assertCurrent();
        fs.unlinkSync(target + '.json');
        flushDirectory(directory);
        return {id: pin.id, directory: target, state: 'removed', reasons: []};
    }
    try {
        if (path.dirname(verifier.runtimeGenerationPin(currentGeneration).directory) !== directory) throw Error('runtime-maintenance-host-binding-invalid');
        packageGuard = transactionFn();
        referenceGuard = references.holdRuntimeGenerationReferences({directory});
        assertCurrent();
        const pending = new Set(fs.readdirSync(directory).filter(name => name.startsWith(RETIRING))
            .map(name => name.endsWith('.json') ? name.slice(0, -5) : name));
        for (const name of pending) {
            const target = path.join(directory, name);
            try {
                if (!transactionPattern.test(name.slice(RETIRING.length))) throw Error('runtime-removal-name-unknown');
                generations.push(await finishRemoval(target));
            } catch (error) { generations.push({directory: target, state: 'retained', reasons: [{code: error.code || error.message}]}) }
        }
        for (const id of fs.readdirSync(directory).filter(name => idPattern.test(name))) {
            const target = path.join(directory, id);
            try {
                ownedDirectory(target);
                const metadata    = readOwnedJson(path.join(target, verifier.RUNTIME_GENERATION_RECORD), 16 * 1024 * 1024);
                const candidate   = verifier.runtimeGenerationDescriptor(target, metadata);
                const preliminary = preliminarilyRetained(candidate);
                if (preliminary.length) {
                    generations.push({id, directory: target, state: 'retained', reasons: preliminary});
                    continue;
                }
                const generation = await verifier.readRuntimeGeneration({directory: target});
                const original   = ownedDirectory(target);
                const census     = await inspectProcesses({directories: [target]});
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
            } catch (error) { generations.push({id, directory: target, state: 'retained', reasons: [{code: error.code || error.message}]}) }
        }
        return {state: 'observed', generations};
    } catch (error) {
        return {state: 'deferred', reason: error.code || error.message, generations};
    } finally {
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
 * @param {Function} run One bounded asynchronous maintenance pass.
 * @param {Object} [options] Clock and report seams; no new operator configuration.
 * @returns {{close: Function}} Closing prevents another pass and waits for the one already running.
 */
export function startRuntimeMaintenance(run, {intervalMs = 60000, onResult = () => {}, onError = () => {},
    setIntervalFn = setInterval, clearIntervalFn = clearInterval} = {}) {
    let pending = null, closed = false;
    /** @summary Coalesces cadence overlap without losing the in-flight teardown join. */
    function tick() {
        if (closed || pending) return;
        pending = Promise.resolve().then(run).then(onResult).catch(onError).finally(() => { pending = null });
    }
    const timer = setIntervalFn(tick, intervalMs);
    timer.unref?.();
    tick();
    return {async close() { closed = true; clearIntervalFn(timer); await pending }};
}
