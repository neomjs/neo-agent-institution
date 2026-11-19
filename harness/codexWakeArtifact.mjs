import {constants}              from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import nodeFs                   from 'node:fs';
import {createRequire}          from 'node:module';
import path                     from 'node:path';

/**
 * @module harness/codexWakeArtifact
 * @summary Publishes and retires immutable wake payloads through the existing runtime and package exclusion owners.
 */

const fs          = (process.versions.electron ? createRequire(import.meta.url)('original-fs') : nodeFs).promises;
const pool        = 'wake-artifacts-v1', declarationPath = 'Contents/Resources/organism/codex-wake-artifact.json';
const digestName  = /^[0-9a-f]{64}$/;
const stagingName = /^\.(?:building|removing)-[a-f0-9-]{36}$/;
// Reuse positive retention only. A deletion always re-verifies all remaining packages under exclusion.
let lastScan;

/** @summary Refuses an alternate filesystem owner or a link in an artifact's address. */
async function ownedDirectory(dir) {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.uid !== process.getuid() || stat.mode & 0o022 || await fs.realpath(dir) !== dir) {
        throw Error('wake-artifact-custody-unproven')
    }
}

/** @summary Reads a declaration only when its bytes match the parent generation's inventory. */
async function describe(payload, entries, verifier) {
    const row = entries.find(entry => entry[0] === declarationPath);
    if (!row) return null;
    if (typeof verifier.describeCodexWakeArtifact !== 'function') throw Error('wake-artifact-verifier-outdated');
    if (row[1] !== 'file' || row[3] < 1 || row[3] > 262144) throw Error('wake-artifact-declaration-invalid');
    const file = path.join(payload, declarationPath);
    if (await fs.realpath(file) !== file) throw Error('wake-artifact-declaration-link');
    const data = await fs.readFile(file);
    if (data.length !== row[3] || createHash('sha256').update(data).digest('hex') !== row[4]) throw Error('wake-artifact-declaration-changed');
    return verifier.describeCodexWakeArtifact({declaration:JSON.parse(data), entries})
}

/**
 * @summary Whether a trusted verifier reads the wake-artifact declaration a bundle may carry. A bundle without one needs nothing.
 * @param {String} bundle   Bundle root.
 * @param {Object} verifier The trusted runtime-generation module.
 * @returns {Boolean}
 */
export function verifierReadsBundle(bundle, verifier) {
    return typeof verifier.describeCodexWakeArtifact === 'function' || !nodeFs.existsSync(path.join(bundle, declarationPath))
}

/** @summary Verifies a published address. An existing corrupt object cannot become a writable repair target. */
async function verified(dir, digest, verifier) {
    await ownedDirectory(dir);
    if ((await verifier.inventoryRuntimePayload(dir)).digest !== digest) throw Error('wake-artifact-integrity-failed');
}

/**
 * @summary Atomically publishes an immutable wake execution closure under the active generation-acquisition lease.
 * @param {Object} options Verified source, final seal rows, package owner, and the existing exclusion/cleanup operations.
 */
export async function publishCodexWakeArtifact({directory,payload,entries,verifier,assertCurrent,removeTree}) {
    const artifact = await describe(payload,entries,verifier);
    if (!artifact) return;
    if (!digestName.test(artifact.digest)) throw Error('wake-artifact-digest-invalid');
    const parent = path.join(directory,pool), target = path.join(parent,artifact.digest);
    assertCurrent();
    await fs.mkdir(parent,{recursive:true,mode:0o700});
    await ownedDirectory(parent);
    if (await fs.lstat(target).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false })) {
        await verified(target,artifact.digest,verifier);
        assertCurrent();
        return
    }
    const stage = path.join(parent,'.building-' + randomUUID());
    await fs.mkdir(stage,{mode:0o700});
    try {
        for (const [relative,kind,modeOrLink] of artifact.entries) {
            if (!relative) continue;
            const destination = path.join(stage,relative);
            if (kind === 'directory') await fs.mkdir(destination,{mode:0o700});
            else if (kind === 'file') {
                await fs.copyFile(path.join(payload,relative),destination,constants.COPYFILE_FICLONE);
                await fs.chmod(destination,modeOrLink)
            } else if (kind === 'link') await fs.symlink(modeOrLink,destination);
            else throw Error('wake-artifact-entry-invalid')
        }
        for (const [relative,kind,mode] of [...artifact.entries].reverse()) {
            if (kind === 'directory') await fs.chmod(path.join(stage,relative),mode)
        }
        await verified(stage,artifact.digest,verifier);
        assertCurrent();
        nodeFs.renameSync(stage,target)
    } finally { await removeTree(stage) }
}

/**
 * @summary Collects only physically unreachable, unused artifacts under the package and runtime-reference leases.
 * A declaring generation, an uncertain process observation or an interrupted generation retirement keeps the bytes.
 * @param {Object} options Locked generation parent and maintenance's own verifier, census, phase and cleanup operations.
 * @returns {Promise<Object[]>} One result per examined orphan.
 */
export async function retireCodexWakeArtifacts({directory,verifier,assertCurrent,inspectProcesses,removeTree,bounded,protectedIds,snapshot}) {
    const parent = path.join(directory,pool);
    try { await ownedDirectory(parent) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const names = await fs.readdir(directory);
    if (names.some(name => name.startsWith('.retiring-'))) throw Error('wake-artifact-retirement-pending');
    const ids = names.filter(name => digestName.test(name)).sort(), artifacts = [], result = [];
    for (const name of await fs.readdir(parent)) {
        if (digestName.test(name) || stagingName.test(name)) artifacts.push(name);
        else result.push({id:name,state:'retained',reason:'wake-artifact-unrecognized-entry'})
    }
    if (!artifacts.length) return result;
    const key = directory + '\n' + ids.join('\n');
    if (lastScan?.key === key && artifacts.every(name => lastScan.live.has(name))) return result;
    if (!protectedIds || !snapshot || protectedIds.some(id => !ids.includes(id))) throw Error('wake-artifact-references-unknown');
    const roots = [
        ...snapshot.seats.filter(s => !['stopped','exited'].includes(s.state) || s.ownershipUnresolved !== false || s.cleanupUnresolved !== false)
            .map(s => s.start.runtime),
        ...snapshot.generations.filter(g => g.state !== 'revoked').map(g => g.runtime)
    ];
    if (roots.some(pin => !verifier.isRuntimeGenerationPin(pin) || !ids.includes(pin.id) || pin.directory !== path.join(directory,pin.id))) {
        throw Error('wake-artifact-journal-reference-unknown')
    }
    /** @summary A manifest can retain bytes cheaply. Only verified source packages may establish absence. */
    async function referenced(verify) {
        const live = new Set();
        for (const id of ids) {
            const generation = path.join(directory,id);
            await ownedDirectory(generation);
            const record = JSON.parse(await fs.readFile(path.join(generation,verifier.RUNTIME_GENERATION_RECORD),'utf8'));
            if (record.id !== id || !Array.isArray(record.entries)) throw Error('wake-artifact-retention-record-invalid');
            if (verify) {
                const proof = await bounded('wake-reference',id,verifier.readRuntimeGeneration({directory:generation}));
                if (!proof || createHash('sha256').update(JSON.stringify(record.entries)).digest('hex') !== proof.payloadDigest) {
                    throw Error('wake-artifact-retention-record-unproven')
                }
            }
            const artifact = await describe(path.join(generation,verifier.RUNTIME_GENERATION_PAYLOAD),record.entries,verifier);
            if (artifact) live.add(artifact.digest)
        }
        return live
    }
    lastScan = {key,live:await referenced(false)};
    if (artifacts.every(name => lastScan.live.has(name))) return result;
    lastScan = {key,live:await referenced(true)};
    const unreferenced = artifacts.filter(name => !lastScan.live.has(name));
    if (!unreferenced.length) return result;
    const directories = unreferenced.map(name => path.join(parent,name));
    const census      = await bounded('wake-census',null,inspectProcesses({directories}));
    if (census?.state !== 'observed' || !Array.isArray(census.processes) || census.processes.some(p =>
        !Number.isSafeInteger(p?.pid) || p.pid <= 0 || !Array.isArray(p.directories) || p.directories.some(dir => !directories.includes(dir)))) {
        throw Error('wake-artifact-processes-unknown')
    }
    for (const name of unreferenced) {
        let dir = path.join(parent,name);
        if (census.processes.some(p => p.directories.includes(dir))) {
            result.push({id:name,state:'retained',reason:'process-held'}); continue
        }
        try {
            await ownedDirectory(dir);
            if (digestName.test(name)) {
                await bounded('wake-verify',name,verified(dir,name,verifier));
                const quarantine = path.join(parent,'.removing-' + randomUUID());
                assertCurrent();
                // Synchronous rename keeps the exclusion check adjacent to removing the public address.
                nodeFs.renameSync(dir,quarantine);
                dir = quarantine
            }
            assertCurrent();
            await removeTree(dir);
            result.push({id:name,state:'removed'})
        } catch (error) {
            if (error.code === 'pass-aborted' || error.code === 'pass-deadline') throw error;
            assertCurrent();
            result.push({id:name,state:'retained',reason:error.code || error.message})
        }
    }
    return result
}
