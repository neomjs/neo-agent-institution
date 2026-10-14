import {execFile}                         from 'node:child_process';
import {constants}                       from 'node:fs';
import fs                                 from 'node:fs/promises';
import path                               from 'node:path';
import {promisify}                        from 'node:util';
import {pathToFileURL}                    from 'node:url';
import {createRequire}                    from 'node:module';

/**
 * @module harness/runtimeGeneration
 * @summary Publishes verified package execution copies outside the replaceable app bundle.
 * The host owns copying, probing and publication. Its assembled Brain supplies the single manifest
 * format and read-only verifier. A generation is never repaired or overwritten in place.
 */

const execute = promisify(execFile);

/** @summary Creates a named refusal without turning an unknown binding into a fallback. */
function refusal(code, detail, cause) {
    return Object.assign(new Error(code + ': ' + detail, cause ? {cause} : undefined), {code})
}

/** @summary Tests containment without accepting sibling paths with a shared string prefix. */
function inside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)
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
 * @summary Loads verification only from the source package's assembled, revision-bound Brain.
 * The retained generation under test is never an import root, and escaping source links refuse.
 * @param {Object} options Explicit package and assembled organism roots.
 * @returns {Promise<Object>} The source package's verifier and manifest-format namespace.
 */
export async function loadRuntimeGenerationVerifier({bundlePath, runtimeRoot}) {
    const source = await fs.realpath(bundlePath), root = await fs.realpath(runtimeRoot);
    if (!inside(source, root)) throw refusal('runtime-verifier-invalid', 'the verifier must belong to the source package');
    const receipt = await readJson(path.join(root, 'organism-build-info.json'));
    const revision = receipt?.owners?.brain?.revision;
    if (typeof revision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) {
        throw refusal('runtime-verifier-invalid', 'the source package has no complete Brain revision')
    }
    const manifest = await readJson(path.join(root, 'package.json'));
    if (!manifest.dependencies?.['neo-agent-brain']?.endsWith('#' + revision)) {
        throw refusal('runtime-verifier-invalid', 'the assembled Brain dependency does not match the package receipt')
    }
    let verifier;
    try {
        const require = createRequire(path.join(root, 'package.json'));
        const file = await fs.realpath(require.resolve('neo-agent-brain/runtime-generation'));
        if (!inside(path.join(root, 'node_modules/neo-agent-brain'), file)) {
            throw refusal('runtime-verifier-invalid', 'the verifier escapes the assembled Brain dependency')
        }
        verifier = await import(pathToFileURL(file).href + '?brain=' + revision);
    } catch (cause) {
        throw refusal('runtime-verifier-invalid', 'the assembled Brain verifier could not be loaded', cause)
    }
    assertVerifier(verifier);
    return verifier
}

/** @summary Requires the trusted caller's complete format/verifier namespace, without a target-tree fallback. */
function assertVerifier(verifier) {
    const functions = ['runtimeGenerationIdentity', 'runtimeGenerationArguments', 'readRuntimeGeneration', 'inventoryRuntimePayload',
        'runtimeGenerationDescriptor', 'createRuntimeGenerationRecord', 'completeRuntimeGenerationRecord'];
    if (!verifier || functions.some(name => typeof verifier[name] !== 'function') ||
        typeof verifier.RUNTIME_GENERATION_RECORD !== 'string' || typeof verifier.RUNTIME_GENERATION_PAYLOAD !== 'string') {
        throw refusal('runtime-verifier-invalid', 'the trusted host supplied no compatible generation format')
    }
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
 * @param {Object} options.verifier Namespace from the current trusted host, never the copy target.
 * @param {String} [options.platform=process.platform]
 * @param {String} [options.arch=process.arch]
 * @param {Function} [options.probe=probeRuntimeGeneration] Compatibility probe, injectable for fixtures.
 * @param {Function} [options.now] Clock for the non-identity installation timestamp.
 * @returns {Promise<Object>} Verified published descriptor; never a staging or bundle fallback.
 */
export async function materializeRuntimeGeneration({
    bundlePath, runtimeRoot, executable, directory, verifier,
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
    assertVerifier(verifier);
    const {
        runtimeGenerationIdentity, readRuntimeGeneration,
        inventoryRuntimePayload: inventory, runtimeGenerationDescriptor: descriptor,
        createRuntimeGenerationRecord, completeRuntimeGenerationRecord,
        RUNTIME_GENERATION_RECORD: RECORD, RUNTIME_GENERATION_PAYLOAD: PAYLOAD
    } = verifier;
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
        let record = createRuntimeGenerationRecord({
            identity, payload: copied,
            runtimeRelativePath: path.relative(source, sourceRuntime) || '.',
            executableRelativePath: path.relative(source, sourceExecutable), createdAt: now().toISOString()
        });
        const candidate = descriptor(stage, record);
        let observed;
        try { observed = await probe(candidate) } catch (cause) {
            throw refusal('runtime-compatibility-failed', 'copied runtime probe failed', cause)
        }
        if (observed?.platform !== platform || observed?.arch !== arch ||
            observed?.electronVersion !== identity.identity[3]) {
            throw refusal('runtime-compatibility-failed', 'copied executable does not match the target platform, architecture or Electron version')
        }
        record = completeRuntimeGenerationRecord(record, observed);
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
