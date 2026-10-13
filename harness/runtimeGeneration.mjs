import {execFile}                         from 'node:child_process';
import {createHash}                       from 'node:crypto';
import {constants, createReadStream}      from 'node:fs';
import fs                                 from 'node:fs/promises';
import path                               from 'node:path';
import {promisify}                        from 'node:util';

/**
 * @module harness/runtimeGeneration
 * @summary Publishes verified package execution copies outside the replaceable app bundle.
 * The host lifecycle owns seat references and retirement; this module owns payload identity,
 * integrity and atomic publication only. A generation is never repaired or overwritten in place.
 */

const
    RECORD = 'generation.json',
    PAYLOAD = 'host.runtime',
    execute = promisify(execFile);

/** @summary Creates a named refusal without turning an unknown binding into a fallback. */
function refusal(code, detail, cause) {
    return Object.assign(new Error(code + ': ' + detail, cause ? {cause} : undefined), {code})
}

/** @summary Hashes one canonical manifest or identity serialization. */
function hash(value) {
    return createHash('sha256').update(value).digest('hex')
}

/**
 * @summary Derives the ADR's package identity, excluding location and staging timestamps.
 * @param {Object} receipt The embedded organism-build-info.json record.
 * @returns {{id: String, identity: String[]}}
 */
export function runtimeGenerationIdentity(receipt) {
    const identity = ['product', 'brain', 'engine'].map(owner => receipt?.owners?.[owner]?.revision);
    identity.push(receipt?.electronVersion);

    if (identity.slice(0, 3).some(value => typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) ||
        typeof identity[3] !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(identity[3])) {
        throw refusal('runtime-receipt-invalid', 'complete product, Brain, Engine revisions and Electron version are required')
    }

    return {id: hash(JSON.stringify(identity)), identity}
}

/** @summary Tests containment without accepting sibling paths with a shared string prefix. */
function inside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)
}

/** @summary Resolves a manifest-relative binding, rejecting traversal and alternate spellings. */
function binding(root, relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) ||
        path.normalize(relative) !== relative || !inside(root, path.resolve(root, relative))) {
        throw refusal('runtime-binding-invalid', 'runtime bindings must be canonical relative paths')
    }
    return path.resolve(root, relative)
}

/** @summary Reads a record; a missing or malformed record is never inferred from directory contents. */
async function readJson(file) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (cause) {
        throw refusal('runtime-record-invalid', file + ' cannot be read as a complete record', cause)
    }
}

/**
 * @summary Inventories bytes, permission modes and verbatim internal links in deterministic order.
 * @param {String} root Payload root, never followed through a symlink.
 * @param {Boolean} readonlyMode Compare a source tree as it will be sealed.
 * @returns {Promise<{entries: Array, digest: String}>}
 */
async function inventory(root, readonlyMode = false) {
    const entries = [];

    /** @summary Visits one entry without following directory symlinks. */
    async function visit(relative) {
        const file = path.join(root, relative), stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) {
            const target = await fs.readlink(file);
            if (path.isAbsolute(target) || !inside(root, await fs.realpath(file))) {
                throw refusal('runtime-payload-invalid', relative + ' has a non-relocatable link')
            }
            entries.push([relative, 'link', target]);
            return
        }
        if (stat.mode & 0o7000) throw refusal('runtime-payload-invalid', relative + ' has special permission bits');
        const mode = stat.mode & (readonlyMode ? 0o555 : 0o777);
        if (stat.isDirectory()) {
            entries.push([relative, 'directory', mode]);
            for (const name of (await fs.readdir(file)).sort()) await visit(path.join(relative, name));
        } else if (stat.isFile()) {
            const digest = createHash('sha256');
            for await (const chunk of createReadStream(file)) digest.update(chunk);
            const after = await fs.lstat(file);
            if (after.ino !== stat.ino || after.size !== stat.size || after.mode !== stat.mode || after.mtimeMs !== stat.mtimeMs) {
                throw refusal('runtime-payload-changed', relative + ' changed while being read')
            }
            entries.push([relative, 'file', mode, stat.size, digest.digest('hex')]);
        } else {
            throw refusal('runtime-payload-invalid', relative + ' is neither a file, directory nor internal link')
        }
    }

    try {
        await visit('');
    } catch (cause) {
        if (cause.code?.startsWith('runtime-')) throw cause;
        throw refusal('runtime-payload-invalid', 'payload cannot be fully inventoried', cause)
    }
    return {entries, digest: hash(JSON.stringify(entries))}
}

/** @summary Makes copied files read-only, sealing child directories before their parents. */
async function seal(root, entries) {
    for (const [relative, kind, mode] of [...entries].reverse()) {
        if (kind !== 'link') await fs.chmod(path.join(root, relative), mode)
    }
}

/** @summary Removes only this invocation's staging tree, without following its symlinks. */
async function discardStage(root) {
    /** @summary Restores directory write permission only within the owned staging tree. */
    async function unlock(file) {
        let stat;
        try { stat = await fs.lstat(file) } catch (error) { if (error.code === 'ENOENT') return; throw error }
        if (!stat.isDirectory() || stat.isSymbolicLink()) return;
        await fs.chmod(file, 0o700);
        for (const name of await fs.readdir(file)) await unlock(path.join(file, name));
    }
    await unlock(root);
    await fs.rm(root, {recursive: true, force: true})
}

/** @summary Exposes distinct generation-directory, organism-root and executable authorities. */
function descriptor(directory, record) {
    const payload = path.join(directory, PAYLOAD);
    return Object.freeze({
        id           : record.id,
        identity     : Object.freeze([...record.identity]),
        directory,
        runtimeRoot  : binding(payload, record.runtimeRelativePath),
        executable   : binding(payload, record.executableRelativePath),
        payloadDigest: record.payloadDigest,
        createdAt    : record.createdAt,
        compatibility: Object.freeze({...record.compatibility})
    })
}

/**
 * @summary Verifies a published generation before returning any executable binding.
 * @param {Object} options
 * @param {String} options.directory Generation directory, whose basename is its identity.
 * @param {String} [options.platform=process.platform]
 * @param {String} [options.arch=process.arch]
 * @returns {Promise<Object|null>} Null only when the whole directory is absent.
 */
export async function readRuntimeGeneration({directory, platform = process.platform, arch = process.arch}) {
    let stat;
    try { stat = await fs.lstat(directory) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o222) {
        throw refusal('runtime-generation-invalid', 'the published directory is not sealed')
    }
    const record = await readJson(path.join(directory, RECORD));
    if (record.version !== 1 || !Array.isArray(record.identity) || record.identity.length !== 4 ||
        record.id !== path.basename(directory) || record.id !== hash(JSON.stringify(record.identity)) ||
        !/^[a-f0-9]{64}$/u.test(record.payloadDigest ?? '') || typeof record.createdAt !== 'string') {
        throw refusal('runtime-record-invalid', 'generation identity or manifest header is inconsistent')
    }
    if (record.compatibility?.platform !== platform || record.compatibility?.arch !== arch ||
        record.compatibility?.electronVersion !== record.identity[3]) {
        throw refusal('runtime-compatibility-failed', 'generation is not verified for this host and Electron version')
    }
    const result = descriptor(directory, record);
    const payload = await inventory(path.join(directory, PAYLOAD));
    if (payload.digest !== record.payloadDigest || JSON.stringify(payload.entries) !== JSON.stringify(record.entries)) {
        throw refusal('runtime-integrity-failed', 'published bytes, modes or links differ from their manifest')
    }
    const actual = runtimeGenerationIdentity(await readJson(path.join(result.runtimeRoot, 'organism-build-info.json')));
    const executable = await fs.stat(result.executable);
    if (actual.id !== record.id || !executable.isFile() || !(executable.mode & 0o111) ||
        !(await fs.stat(result.runtimeRoot)).isDirectory()) {
        throw refusal('runtime-binding-invalid', 'receipt, runtime or executable does not match the generation')
    }
    return result
}

/**
 * @summary Runs the copied Electron as Node with no inherited runtime-injection environment.
 * The probe resolves the copied launcher and exercises its SQLite native addon in memory only.
 * @param {Object} candidate Verified copy descriptor.
 * @returns {Promise<Object>} Actual platform, architecture and native-runtime observations.
 */
export async function probeRuntimeGeneration(candidate) {
    const source = [
        "const fs = require('node:fs'), path = require('node:path');",
        "const root = fs.realpathSync(process.argv[1]);",
        "const load = require('node:module').createRequire(path.join(root, 'package.json'));",
        "const Database = load('better-sqlite3'), db = new Database(':memory:');",
        "if (db.prepare('select 42 as value').get().value !== 42) throw Error('native addon failed');",
        "db.close();",
        "console.log(JSON.stringify({platform:process.platform,arch:process.arch,",
        "electronVersion:process.versions.electron,nodeVersion:process.versions.node,",
        "moduleAbi:process.versions.modules,executable:fs.realpathSync(process.execPath),",
        "runtimeRoot:root,launcher:fs.realpathSync(load.resolve('./ai/mcp/client/fleetMcpLauncher.mjs'))}));"
    ].join('\n');
    try {
        const {stdout} = await execute(candidate.executable, ['-e', source, candidate.runtimeRoot], {
            cwd: candidate.runtimeRoot, env: {ELECTRON_RUN_AS_NODE: '1'}, timeout: 30000, maxBuffer: 65536
        });
        const result = JSON.parse(stdout.trim());
        if (result.executable !== await fs.realpath(candidate.executable) ||
            result.runtimeRoot !== await fs.realpath(candidate.runtimeRoot) || !inside(result.runtimeRoot, result.launcher)) {
            throw new Error('the probe resolved code outside its copied binding')
        }
        return result
    } catch (cause) {
        throw refusal('runtime-compatibility-failed', 'the copied executable/native-module probe did not complete', cause)
    }
}

/**
 * @summary Creates one sealed generation, or verifies and reuses the existing exact payload.
 * @param {Object} options
 * @param {String} options.bundlePath Complete package execution closure to copy.
 * @param {String} options.runtimeRoot Organism root inside that package.
 * @param {String} options.executable Node-capable executable inside that package.
 * @param {String} options.directory Host-owned runtime-generation parent directory.
 * @param {String} [options.platform=process.platform]
 * @param {String} [options.arch=process.arch]
 * @param {Function} [options.probe=probeRuntimeGeneration] Compatibility probe, injectable for fixtures.
 * @param {Function} [options.now] Clock for the non-identity installation timestamp.
 * @returns {Promise<Object>} Verified published descriptor; never a staging or bundle fallback.
 */
export async function materializeRuntimeGeneration({
    bundlePath, runtimeRoot, executable, directory,
    platform = process.platform, arch = process.arch, probe = probeRuntimeGeneration, now = () => new Date()
}) {
    if ([bundlePath, runtimeRoot, executable, directory].some(value => typeof value !== 'string' || !path.isAbsolute(value))) {
        throw refusal('runtime-binding-invalid', 'package, runtime, executable and destination must be explicit absolute paths')
    }
    const source = await fs.realpath(bundlePath);
    const sourceRuntime = await fs.realpath(runtimeRoot), sourceExecutable = await fs.realpath(executable);
    if (!inside(source, sourceRuntime) || !inside(source, sourceExecutable) || inside(source, path.resolve(directory))) {
        throw refusal('runtime-binding-invalid', 'source bindings must stay inside the package and destination outside it')
    }
    const identity = runtimeGenerationIdentity(await readJson(path.join(sourceRuntime, 'organism-build-info.json')));
    const sourceStat = await fs.stat(sourceExecutable);
    if (!sourceStat.isFile() || !(sourceStat.mode & 0o111) || !(await fs.stat(sourceRuntime)).isDirectory()) {
        throw refusal('runtime-binding-invalid', 'the source runtime or executable is not usable')
    }
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const parent = await fs.lstat(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw refusal('runtime-generation-invalid', 'generation parent is not a real directory');
    directory = await fs.realpath(directory);
    if (inside(source, directory)) throw refusal('runtime-binding-invalid', 'resolved generation parent is inside the source package');
    const target = path.join(directory, identity.id);
    const expected = await inventory(source, true);
    const existing = await readRuntimeGeneration({directory: target, platform, arch});
    if (existing) {
        if (existing.payloadDigest !== expected.digest) throw refusal('non-reproducible-build', 'one package identity has different payload bytes, modes or links');
        return existing
    }
    const stage = await fs.mkdtemp(path.join(directory, '.' + identity.id + '-'));
    try {
        const payload = path.join(stage, PAYLOAD);
        await fs.cp(source, payload, {recursive: true, dereference: false, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE});
        await seal(payload, expected.entries);
        const copied = await inventory(payload);
        if (copied.digest !== expected.digest) throw refusal('runtime-integrity-failed', 'the copied payload does not match its source manifest');
        const record = {
            version: 1, ...identity, payloadDigest: copied.digest, entries: copied.entries,
            runtimeRelativePath: path.relative(source, sourceRuntime) || '.',
            executableRelativePath: path.relative(source, sourceExecutable), createdAt: now().toISOString()
        };
        const candidate = descriptor(stage, record);
        let observed;
        try { observed = await probe(candidate) } catch (cause) {
            throw refusal('runtime-compatibility-failed', 'copied runtime probe failed', cause)
        }
        if (observed?.platform !== platform || observed?.arch !== arch ||
            observed?.electronVersion !== identity.identity[3]) {
            throw refusal('runtime-compatibility-failed', 'copied executable does not match the target platform, architecture or Electron version')
        }
        record.compatibility = Object.fromEntries(
            ['platform', 'arch', 'electronVersion', 'nodeVersion', 'moduleAbi'].map(key => [key, observed[key]])
        );
        if ((await inventory(payload)).digest !== copied.digest) throw refusal('runtime-integrity-failed', 'the probe changed the sealed payload');
        await fs.writeFile(path.join(stage, RECORD), JSON.stringify(record) + '\n', {mode: 0o400});
        await fs.chmod(stage, 0o500);
        try {
            await fs.rename(stage, target);
        } catch (error) {
            // macOS can report EACCES for a sealed winner, rather than ENOTEMPTY.
            // Only a fully verified matching publication discharges a failed rename.
            const winner = await readRuntimeGeneration({directory: target, platform, arch});
            if (!winner) throw error;
            if (winner.payloadDigest !== copied.digest) {
                throw refusal('non-reproducible-build', 'a concurrent publication has another payload for this identity')
            }
            return winner
        }
        const published = await readRuntimeGeneration({directory: target, platform, arch});
        if (!published || published.payloadDigest !== copied.digest) {
            throw refusal('non-reproducible-build', 'a concurrent publication has another payload for this identity')
        }
        return published
    } finally {
        await discardStage(stage)
    }
}
