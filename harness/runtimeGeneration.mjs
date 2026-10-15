import {execFile}                     from 'node:child_process';
import {constants}                    from 'node:fs';
import nodeFs                         from 'node:fs';
import path                           from 'node:path';
import {isDeepStrictEqual, promisify} from 'node:util';
import {pathToFileURL}                from 'node:url';
import {createRequire}                from 'node:module';

/**
 * @module harness/runtimeGeneration
 * @summary Publishes verified package execution copies outside the replaceable app bundle.
 * The host owns copying, probing and publication. Its assembled Brain supplies the single manifest
 * format and read-only verifier. A generation is never repaired or overwritten in place.
 */

const execute            = promisify(execFile);
// Publication, sealing and removal operate on physical archives, matching the shared verifier.
const fs                 = (process.versions.electron ? createRequire(import.meta.url)('original-fs') : nodeFs).promises;
const VERIFIER_FUNCTIONS = ['runtimeGenerationIdentity', 'runtimeGenerationArguments', 'readRuntimeGeneration', 'inventoryRuntimePayload',
    'runtimeGenerationDescriptor', 'createRuntimeGenerationRecord', 'completeRuntimeGenerationRecord'];

/** @summary Creates a named refusal without turning an unknown binding into a fallback. */
function refusal(code, detail, cause) {
    return Object.assign(new Error(code + ': ' + detail, cause ? {cause} : undefined), {code})
}

/** @summary Tests containment without accepting sibling paths with a shared string prefix. */
function inside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)
}

/** @summary Reads a title-independent macOS process census, excluding only this probe's own child. */
function runtimeProcessTable(text, probePid, uid) {
    const rows = new Map();
    for (const line of text.split('\n').filter(line => line.trim())) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
        if (!match || !Number.isSafeInteger(Number(match[1])) || rows.has(Number(match[1]))) {
            throw new Error('process-table-invalid')
        }
        const pid = Number(match[1]);
        if (Number(match[2]) !== uid || pid === probePid || match[3].startsWith('Z')) continue;
        rows.set(pid, match[4]);
    }
    return rows
}

/** @summary Parses NUL-delimited loaded-file records without treating a filename's newline as a field. */
function runtimeProcessMappings(text) {
    const rows = new Map(), executables = new Set();
    let   pid  = null, descriptor = null, valid = !text || /\0\n?$/.test(text);
    for (const raw of text.split('\0')) {
        const field = raw.startsWith('\n') ? raw.slice(1) : raw;
        if (!field) continue;
        if (/^p[1-9]\d*$/.test(field)) {
            pid = Number(field.slice(1));
            if (!Number.isSafeInteger(pid) || rows.has(pid)) {
                valid = false; pid = null; continue
            }
            rows.set(pid, []);
            descriptor = null;
        } else if (/^f[\w.*-]+$/.test(field) && pid !== null) {
            descriptor = field.slice(1);
        } else if (field.startsWith('n') && pid !== null && descriptor !== null) {
            if (field.startsWith('n/')) {
                rows.get(pid).push(field.slice(1));
                if (descriptor === 'txt') executables.add(pid);
            }
        } else {
            valid = false; pid = null;
        }
    }
    return {rows, executables, valid}
}

/**
 * @summary Observes the host account's loaded and open runtime files independently of mutable process titles.
 * An uninspected survivor, changed birth token, new process, malformed output or failed tool makes
 * absence unknown. Positive mappings remain in the result even when another part of the scan fails.
 * The caller must still exclude new runtime references through its check/removal transaction.
 * @param {Object} options
 * @param {String[]} options.directories Verified canonical runtime-generation directories.
 * @param {Number} [options.uid=process.geteuid()] Managed child processes' effective host account.
 * @param {String} [options.platform=process.platform] Unsupported platforms retain all generations.
 * @param {Function} [options.executeFn] Shell-free promisified execFile; its child identifies the probe.
 * @returns {Promise<{state: String, reason: (String|null), processes: Object[]}>} Bounded non-secret census.
 */
export async function inspectRuntimeGenerationProcesses({
    directories, uid = process.geteuid?.(), platform = process.platform, executeFn = execute
}) {
    if (!Array.isArray(directories) || directories.some(root => typeof root !== 'string' ||
        !path.isAbsolute(root) || path.resolve(root) !== root) || new Set(directories).size !== directories.length ||
        !Number.isSafeInteger(uid) || uid < 0) throw refusal('runtime-census-invalid', 'canonical directories and host uid are required');
    const processes = [];
    let   reason    = platform === 'darwin' ? null : 'process-platform-unsupported';
    if (reason) return {state: 'unknown', reason, processes};

    /** @summary Bounds each observation and retains partial stdout without turning failure into absence. */
    async function observe(command, args) {
        let pending;
        try {
            pending = executeFn(command, args, {encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024,
                env: {PATH: '/usr/bin:/bin:/usr/sbin', LC_ALL: 'C', TZ: 'UTC'}});
            const result = await pending;
            return {text: String(result.stdout), pid: pending.child?.pid, ok: !String(result.stderr || '').trim()}
        } catch (error) {
            return {text: String(error.stdout || ''), pid: pending?.child?.pid, ok: false}
        }
    }

    const before = await observe('/bin/ps', ['-axo', 'pid=,uid=,stat=,lstart=']);
    const mapped = await observe('/usr/sbin/lsof', ['-nP', '-a', '-u', String(uid), '-F0pfn']);
    const after  = await observe('/bin/ps', ['-axo', 'pid=,uid=,stat=,lstart=']);
    if (![before, mapped, after].every(row => row.ok)) reason = 'process-inspection-failed';
    let first, last, files;
    try { first = runtimeProcessTable(before.text, before.pid, uid); last = runtimeProcessTable(after.text, after.pid, uid); }
    catch { reason ||= 'process-table-invalid' }
    const parsed = runtimeProcessMappings(mapped.text);
    files = parsed.rows;
    if (!parsed.valid) reason ||= 'process-mappings-invalid';
    if (files) {
        for (const [pid, names] of files) {
            const generations = directories.filter(root => names.some(name => inside(root, name)));
            if (generations.length) processes.push({pid, startedAt: first?.get(pid) ?? null, directories: generations});
        }
    }
    if (first && last && files) {
        if (!first.size || !last.size || !Number.isSafeInteger(before.pid) || !Number.isSafeInteger(after.pid)) {
            reason ||= 'process-census-incomplete';
        }
        for (const [pid, birth] of last) {
            if (first.get(pid) !== birth || !parsed.executables.has(pid)) reason ||= 'process-census-incomplete';
        }
    }
    return {state: reason ? 'unknown' : 'observed', reason, processes}
}

/**
 * @summary Pins a host's verified generation with an OS-held file, before releasing acquisition exclusion.
 * The file descriptor spans delayed boot, private imports, transport reuse and childless hosts. It is
 * visible to the process census and closes on host exit; it is not a second retention registry.
 * @param {Object} options Same explicit source, verifier and reference owner as materialization.
 * @param {Object} [dependencies]
 * @param {Function} [dependencies.materialize=materializeRuntimeGeneration] Trusted publisher seam.
 * @returns {Promise<{generation: Object, release: Function}>} The host owns release after teardown.
 */
export async function acquireHostRuntimeGeneration(options, {materialize = materializeRuntimeGeneration} = {}) {
    if (typeof options.directory !== 'string' || !path.isAbsolute(options.directory)) throw refusal('runtime-binding-invalid', 'host runtime parent is required');
    const source = await fs.realpath(options.bundlePath);
    if (inside(source, path.resolve(options.directory))) throw refusal('runtime-binding-invalid', 'host runtime parent is inside its source package');
    await fs.mkdir(options.directory, {recursive: true, mode: 0o700});
    const directory = await fs.realpath(options.directory), references = options.references;
    if (inside(source, directory)) throw refusal('runtime-binding-invalid', 'resolved host runtime parent is inside its source package');
    const guard = await references.waitForRuntimeGenerationReferences({directory, signal: options.signal});
    let handle, published = false;
    try {
        const generation = await materialize({...options, directory, referenceGuard: guard});
        if (path.dirname(generation.directory) !== directory) throw refusal('runtime-host-binding-invalid', 'host pin escapes its guarded parent');
        const file   = path.join(generation.directory, options.verifier.RUNTIME_GENERATION_RECORD);
        const before = await fs.lstat(file, {bigint: true});
        if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.nlink !== 1n || before.mode & 0o222n ||
            await fs.realpath(file) !== file) throw refusal('runtime-host-binding-invalid', 'host manifest custody is not sealed');
        handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        const opened = await handle.stat({bigint: true});
        const record = JSON.parse(await handle.readFile('utf8'));
        const after  = await fs.lstat(file, {bigint: true});
        if ([opened, after].some(stat => ['dev', 'ino', 'uid', 'mode', 'size', 'mtimeNs', 'ctimeNs'].some(key => stat[key] !== before[key])) ||
            !isDeepStrictEqual(options.verifier.runtimeGenerationDescriptor(generation.directory, record), generation)) {
            throw refusal('runtime-host-binding-invalid', 'host manifest changed during acquisition');
        }
        references.assertRuntimeGenerationReferences(guard, directory);
        let closing;
        const result = Object.freeze({generation, release() { return closing ||= handle.close() }});
        if (guard.release() !== true) throw refusal('runtime-reference-release-unproved', 'host acquisition exclusion was not released');
        published = true;
        return result;
    } finally {
        if (!published) {
            try { await handle?.close() } finally { guard.release() }
        }
    }
}

/**
 * @summary Classifies a runtime pin against the existing lifecycle/admission evidence.
 * A candidate is unused only when every observation is complete and no independent holder remains.
 * The host must verify the payload before removal and hold acquisition/package exclusion throughout.
 * @param {Object} options
 * @param {Object} options.generation Descriptor or manifest pin; this decision does not establish payload integrity.
 * @param {String[]} options.protectedIds Observed installed, rollback and current-host identities.
 * @param {Object} options.snapshot The existing journal's complete lifecycle/admission snapshot.
 * @param {Object} options.census The title-independent host-process observation.
 * @param {Object} options.verifier Current trusted runtime format namespace.
 * @param {Function} options.validateReferences The journal owner's guarded-writer predicate, not its legacy recovery codec.
 * @returns {{eligible: Boolean, reasons: Object[]}} Retention reasons, never removal authority by itself.
 */
export function classifyRuntimeGenerationRetention({generation, protectedIds, snapshot, census, verifier, validateReferences}) {
    const reasons = [];
    let pin;
    try { pin = verifier.runtimeGenerationPin(generation); }
    catch { return {eligible: false, reasons: [{code: 'runtime-unverified'}]} }
    /** @summary Names each independent observation that prevents retirement. */
    const retain = (code, subject) => reasons.push(subject === undefined ? {code} : {code, subject});
    if (!Array.isArray(protectedIds) || !protectedIds.length || protectedIds.some(id => !/^[a-f0-9]{64}$/.test(id))) {
        retain('package-protection-unknown');
    }
    if (Array.isArray(protectedIds) && protectedIds.includes(pin.id)) retain('package-protected');
    let validReferences = false;
    try { validReferences = validateReferences(snapshot) === true; } catch {}
    if (!validReferences) retain('runtime-references-unknown');

    /** @summary An inconsistent identity still retains a directory it names; malformed pins retain globally. */
    function matches(reference) {
        if (!verifier.isRuntimeGenerationPin(reference)) {
            retain('runtime-reference-invalid');
            return false;
        }
        return reference.id === pin.id || reference.directory === pin.directory;
    }

    for (const seat of Array.isArray(snapshot?.seats) ? snapshot.seats : []) {
        if (!seat || typeof seat !== 'object') continue;
        if (matches(seat.start?.runtime) && (!['stopped', 'exited'].includes(seat.state) ||
            seat.ownershipUnresolved !== false || seat.cleanupUnresolved !== false)) {
            retain(seat.ownershipUnresolved || seat.cleanupUnresolved || !['running', 'stopping'].includes(seat.state)
                ? 'seat-pin-unknown' : 'seat-pin-held', seat.start.agentId);
        }
    }
    for (const admission of Array.isArray(snapshot?.generations) ? snapshot.generations : []) {
        if (!admission || typeof admission !== 'object' || admission.state === 'revoked') continue;
        if (matches(admission.runtime)) retain('admission-reference-held', admission.agentId);
    }
    if (census?.state !== 'observed' || !Array.isArray(census.processes)) retain('process-census-unknown');
    for (const process of Array.isArray(census?.processes) ? census.processes : []) {
        if (!Number.isSafeInteger(process?.pid) || process.pid <= 0 || !Array.isArray(process.directories)) {
            retain('process-census-unknown');
        } else if (process.directories.includes(pin.directory)) {
            retain('runtime-process-held', process.pid);
        }
    }
    return {eligible: reasons.length === 0, reasons};
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
 * @summary Binds package metadata to its declared assembled Brain without loading its code.
 * Package metadata must stay inside its owner root; an escaped link cannot supply that binding.
 * @param {Object} options Explicit package and assembled organism roots.
 * @returns {Promise<Object>} The observed receipt, dependency binding and Brain manifest.
 */
async function packagedBrainBinding({bundlePath, runtimeRoot}) {
    const source = await fs.realpath(bundlePath), root = await fs.realpath(runtimeRoot);
    if (!inside(source, root)) throw refusal('runtime-verifier-invalid', 'the verifier must belong to the source package');
    const receipt  = await readBoundJson(root, 'organism-build-info.json');
    const revision = receipt?.owners?.brain?.revision;
    if (typeof revision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) {
        throw refusal('runtime-verifier-invalid', 'the source package has no complete Brain revision')
    }
    const manifest = await readBoundJson(root, 'package.json');
    if (!manifest.dependencies?.['neo-agent-brain']?.endsWith('#' + revision)) {
        throw refusal('runtime-verifier-invalid', 'the assembled Brain dependency does not match the package receipt')
    }
    const brain = await readBoundJson(path.join(root, 'node_modules/neo-agent-brain'), 'package.json');
    if (brain.name !== 'neo-agent-brain') throw refusal('runtime-verifier-invalid', 'the assembled dependency is not the declared Brain');
    return {root, revision, receipt, dependency: manifest.dependencies['neo-agent-brain'], brain};
}

/** @summary Reads package metadata only after its resolved file stays inside the declared owner root. */
async function readBoundJson(root, name) {
    const file = await fs.realpath(path.join(root, name));
    if (!inside(root, file)) throw refusal('runtime-verifier-invalid', 'package metadata escapes its owner root');
    return readJson(file);
}

/**
 * @summary Loads the current source package's single runtime format/verifier implementation.
 * @param {Object} options Explicit package and assembled organism roots.
 * @returns {Promise<Object>} Trusted source namespace, never a retained target's self-verifier.
 */
export async function loadRuntimeGenerationVerifier(options) {
    const verifier = await loadRuntimeContract(options, 'runtime-generation');
    assertVerifier(verifier);
    return verifier
}

/** @summary Loads the assembled source's reference owner without a checkout-level Brain import. */
export async function loadRuntimeGenerationReferences(options) {
    const references = await loadRuntimeContract(options, 'runtime-generation-lease');
    if (['holdRuntimeGenerationReferences', 'waitForRuntimeGenerationReferences', 'assertRuntimeGenerationReferences'].some(name => typeof references[name] !== 'function')) {
        throw refusal('runtime-verifier-invalid', 'the assembled Brain has no compatible reference owner')
    }
    return references
}

/** @summary Loads the current package's read-only journal codec and existing package-lease primitive. */
export async function loadRuntimeMaintenanceContracts(options) {
    const [journal, leases] = await Promise.all([
        loadRuntimeContract(options, 'launch-admission-journal'), loadRuntimeContract(options, 'file-lease')
    ]);
    if (typeof journal.readLaunchAdmissionJournal !== 'function' || typeof journal.isRuntimeReferenceSnapshot !== 'function' ||
        typeof leases.holdFileLease !== 'function') throw refusal('runtime-verifier-invalid', 'maintenance contracts are incomplete');
    return {journal, leases};
}

/** @summary Resolves an explicit Brain contract inside the current receipt-bound source package. */
async function loadRuntimeContract(options, name) {
    const {root, revision} = await packagedBrainBinding(options);
    let verifier;
    try {
        const require = createRequire(path.join(root, 'package.json'));
        const file    = await fs.realpath(require.resolve('neo-agent-brain/' + name));
        if (!inside(path.join(root, 'node_modules/neo-agent-brain'), file)) {
            throw refusal('runtime-verifier-invalid', 'the verifier escapes the assembled Brain dependency')
        }
        verifier = await import(pathToFileURL(file).href + '?brain=' + revision);
    } catch (cause) {
        throw refusal('runtime-verifier-invalid', 'the assembled Brain verifier could not be loaded', cause)
    }
    return verifier
}

/** @summary Requires the trusted caller's complete format/verifier namespace, without a target-tree fallback. */
function assertVerifier(verifier) {
    if (!verifier || VERIFIER_FUNCTIONS.some(name => typeof verifier[name] !== 'function') ||
        typeof verifier.RUNTIME_GENERATION_RECORD !== 'string' || typeof verifier.RUNTIME_GENERATION_PAYLOAD !== 'string' ||
        typeof verifier.LAUNCH_ADMISSION_PROTOCOL !== 'string') {
        throw refusal('runtime-verifier-invalid', 'the trusted host supplied no compatible generation format')
    }
}

/**
 * @summary Classifies a receipt-bound package's advertised API without treating failed discovery as legacy.
 * Legacy is the recognized pre-generation public export contract. A partial, unknown or unloadable
 * contract refuses. Isolated inspection returns data only; it never supplies the installer's verifier.
 * @param {Object} options
 * @param {String} options.bundlePath Package to inspect.
 * @param {String} options.runtimeRoot Its assembled organism root.
 * @param {Object} options.verifier The current trusted owner's runtime format namespace.
 * @returns {Promise<{kind:String, packageIdentity:Object}>} Advertised support, not runtime continuity.
 */
export async function inspectRuntimeSupport({verifier, ...options}) {
    assertVerifier(verifier);
    try {
        const binding         = await packagedBrainBinding(options), exports = binding.brain.exports;
        const packageIdentity = verifier.runtimeGenerationIdentity(binding.receipt);
        if (!exports || typeof exports !== 'object' || Array.isArray(exports) ||
            typeof exports['./fleet-contract'] !== 'string' || exports['./package.json'] !== './package.json') throw Error('unknown exports');
        const keys = Object.keys(exports).sort();
        const kind = keys.join(',') === './fleet-contract,./package.json' ? 'legacy'
            : typeof exports['./runtime-generation'] === 'string' && typeof exports['./launch-admission-journal'] === 'string' ? 'generation' : null;
        if (!kind || keys.some(key => key.includes('*') || key === '.')) throw Error('unknown exports');
        const source = [
            '(async()=>{',
            "const fs=require('node:fs'),path=require('node:path'),url=require('node:url');",
            'const root=fs.realpathSync(process.argv[1]),kind=process.argv[2];',
            "const load=require('node:module').createRequire(path.join(root,'package.json'));",
            "async function contract(name){const file=fs.realpathSync(load.resolve('neo-agent-brain/'+name));",
            "const relative=path.relative(path.join(root,'node_modules/neo-agent-brain'),file);",
            "if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('contract escapes package');",
            'return import(url.pathToFileURL(file).href);}',
            "const wire=await contract('fleet-contract');",
            "let valid=Array.isArray(wire.FLEET_WIRE_PROTOCOL_VERSIONS)&&wire.FLEET_WIRE_PROTOCOL_VERSIONS.includes(1)&&",
            "typeof wire.createFleetWireOffer==='function'&&typeof wire.selectFleetWireContract==='function';",
            "if(kind==='generation'){const runtime=await contract('runtime-generation'),journal=await contract('launch-admission-journal');",
            `valid=valid&&${JSON.stringify(VERIFIER_FUNCTIONS)}.every(name=>typeof runtime[name]==='function')&&`,
            "['RUNTIME_GENERATION_RECORD','RUNTIME_GENERATION_PAYLOAD','LAUNCH_ADMISSION_PROTOCOL'].every(name=>typeof runtime[name]==='string')&&",
            "['readLaunchAdmissionJournal','holdLaunchAdmissionHandoff','isAdmissionSnapshot'].every(name=>typeof journal[name]==='function');}",
            'console.log(JSON.stringify({valid}));',
            '})().catch(()=>{process.exitCode=1;});'
        ].join('\n');
        const {stdout} = await execute(process.execPath, ['--permission', '--allow-fs-read=' + binding.root, '-e', source, binding.root, kind], {
            cwd: binding.root, env: {ELECTRON_RUN_AS_NODE: '1'}, timeout: 30000, maxBuffer: 65536
        });
        const observed = JSON.parse(stdout.trim());
        if (!observed || Object.keys(observed).join(',') !== 'valid' || observed.valid !== true ||
            !isDeepStrictEqual(binding, await packagedBrainBinding(options))) throw Error('unproved or changed contract');
        return Object.freeze({kind, packageIdentity: Object.freeze({id: packageIdentity.id, identity: Object.freeze([...packageIdentity.identity])})});
    } catch (cause) {
        throw refusal('runtime-capability-unknown', 'the receipt-bound package contract could not be classified', cause);
    }
}

/** @summary Makes copied files read-only, sealing child directories before their parents. */
async function seal(root, entries) {
    for (const [relative, kind, mode] of [...entries].reverse()) {
        if (kind !== 'link') await fs.chmod(path.join(root, relative), mode)
    }
}

/**
 * @summary Removes only a caller-owned staging or committed retirement tree, without following symlinks.
 * @param {String} root The caller's private tree, never a still-published generation.
 * @returns {Promise<void>}
 */
export async function removeOwnedRuntimeTree(root) {
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
        "(async () => {",
        "const fs = require('node:fs'), path = require('node:path');",
        "const root = fs.realpathSync(process.argv[1]);",
        "const load = require('node:module').createRequire(path.join(root, 'package.json'));",
        "const Database = load('better-sqlite3'), db = new Database(':memory:');",
        "if (db.prepare('select 42 as value').get().value !== 42) throw Error('native addon failed');",
        "db.close();",
        "const protocolModule = fs.realpathSync(load.resolve('./ai/services/fleet/mcpLaunchAdmission.mjs'));",
        "const protocolRelative = path.relative(root, protocolModule);",
        "if (path.isAbsolute(protocolRelative) || protocolRelative === '..' || protocolRelative.startsWith('..' + path.sep)) throw Error('protocol escapes the copied runtime');",
        "const {LAUNCH_ADMISSION_PROTOCOL: launchProtocol} = await import(require('node:url').pathToFileURL(protocolModule).href);",
        "console.log(JSON.stringify({platform:process.platform,arch:process.arch,",
        "electronVersion:process.versions.electron,nodeVersion:process.versions.node,",
        "moduleAbi:process.versions.modules,executable:fs.realpathSync(process.execPath),",
        "runtimeRoot:root,launchProtocol,protocolModule,launcher:fs.realpathSync(load.resolve('./ai/mcp/client/fleetMcpLauncher.mjs'))}));",
        "})().catch(() => { process.exitCode = 1; });"
    ].join('\n');
    try {
        const {stdout} = await execute(candidate.executable, ['-e', source, candidate.runtimeRoot], {
            cwd: candidate.runtimeRoot, env: {ELECTRON_RUN_AS_NODE: '1'}, timeout: 30000, maxBuffer: 65536
        });
        const result = JSON.parse(stdout.trim());
        if (result.executable !== await fs.realpath(candidate.executable) ||
            result.runtimeRoot !== await fs.realpath(candidate.runtimeRoot) || !inside(result.runtimeRoot, result.launcher) ||
            !inside(result.runtimeRoot, result.protocolModule)) {
            throw new Error('the probe resolved code outside its copied binding')
        }
        return result
    } catch (cause) {
        throw refusal('runtime-compatibility-failed', 'the copied executable/native-module probe did not complete', cause)
    }
}

/**
 * @summary Checks whether the copied destination can read the complete non-secret handoff snapshot.
 * This executes its format reader for compatibility only. The current trusted verifier still owns
 * payload integrity; this child neither opens custody nor acquires an issuer or admission capability.
 * @param {Object} candidate Verified runtime descriptor with its own executable and organism root.
 * @param {Object} snapshot Closed snapshot inspected through the current trusted journal owner.
 * @param {Object} options
 * @param {Function} options.validateSnapshot Codec loaded by the trusted source owner, never the candidate.
 * @returns {Promise<true>} Refuses unsupported, malformed, escaped or non-completing destinations.
 */
export async function probeRuntimeRecovery(candidate, snapshot, {validateSnapshot} = {}) {
    if (typeof validateSnapshot !== 'function') throw refusal('runtime-recovery-incompatible', 'a trusted source snapshot codec is required');
    let valid = false;
    try { valid = validateSnapshot(snapshot) === true } catch {}
    if (!valid) throw refusal('runtime-recovery-incompatible', 'the source handoff snapshot is invalid');
    const source = [
        '(async () => {',
        "const fs=require('node:fs'),path=require('node:path');",
        'const root=fs.realpathSync(process.argv[1]);',
        "const load=require('node:module').createRequire(path.join(root,'package.json'));",
        "const file=fs.realpathSync(load.resolve('neo-agent-brain/launch-admission-journal'));",
        "const relative=path.relative(path.join(root,'node_modules','neo-agent-brain'),file);",
        "if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('reader escapes destination');",
        "const reader=await import(require('node:url').pathToFileURL(file).href);",
        "const snapshot=JSON.parse(fs.readFileSync(0,'utf8'));",
        "const compatible=typeof reader.isAdmissionSnapshot==='function'&&reader.isAdmissionSnapshot(snapshot)===true;",
        'console.log(JSON.stringify({compatible}));',
        '})().catch(()=>{process.exitCode=1;});'
    ].join('\n');
    try {
        const pending = execute(candidate.executable, ['-e', source, candidate.runtimeRoot], {
            cwd: candidate.runtimeRoot, env: {ELECTRON_RUN_AS_NODE: '1'}, timeout: 30000, maxBuffer: 65536
        });
        pending.child.stdin.on('error', () => {});
        pending.child.stdin.end(JSON.stringify(snapshot));
        const {stdout} = await pending, result = JSON.parse(stdout.trim());
        if (!result || Object.keys(result).join(',') !== 'compatible' || result.compatible !== true) throw Error('snapshot not accepted');
        return true;
    } catch (cause) {
        throw refusal('runtime-recovery-incompatible', 'the destination cannot read the complete handoff snapshot', cause);
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
 * @param {Object} options.references Trusted source's runtime-reference owner.
 * @param {Object} [options.referenceGuard] An already-held same-parent guard, owned by the caller.
 * @param {AbortSignal} [options.signal] Host lifecycle cancellation while waiting for exclusion.
 * @param {String} [options.platform=process.platform]
 * @param {String} [options.arch=process.arch]
 * @param {Function} [options.probe=probeRuntimeGeneration] Compatibility probe, injectable for fixtures.
 * @param {Function} [options.now] Clock for the non-identity installation timestamp.
 * @returns {Promise<Object>} Verified published descriptor; never a staging or bundle fallback.
 */
export async function materializeRuntimeGeneration({
    bundlePath, runtimeRoot, executable, directory, verifier, references, referenceGuard, signal,
    platform = process.platform, arch = process.arch, probe = probeRuntimeGeneration, now = () => new Date()
}) {
    if ([bundlePath, runtimeRoot, executable, directory].some(value => typeof value !== 'string' || !path.isAbsolute(value))) {
        throw refusal('runtime-binding-invalid', 'package, runtime, executable and destination must be explicit absolute paths')
    }
    const source        = await fs.realpath(bundlePath);
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
    const identity   = runtimeGenerationIdentity(await readJson(path.join(sourceRuntime, 'organism-build-info.json')));
    const sourceStat = await fs.stat(sourceExecutable);
    if (!sourceStat.isFile() || !(sourceStat.mode & 0o111) || !(await fs.stat(sourceRuntime)).isDirectory()) {
        throw refusal('runtime-binding-invalid', 'the source runtime or executable is not usable')
    }
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const parent = await fs.lstat(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw refusal('runtime-generation-invalid', 'generation parent is not a real directory');
    directory = await fs.realpath(directory);
    if (inside(source, directory)) throw refusal('runtime-binding-invalid', 'resolved generation parent is inside the source package');
    if (!references || typeof references.assertRuntimeGenerationReferences !== 'function' ||
        typeof references.waitForRuntimeGenerationReferences !== 'function') {
        throw refusal('runtime-reference-owner-missing', 'materialization requires the trusted reference owner');
    }
    const guard = referenceGuard ?? await references.waitForRuntimeGenerationReferences({directory, signal});
    try {
        references.assertRuntimeGenerationReferences(guard, directory);
        return await publish();
    } finally {
        if (!referenceGuard && guard.release() !== true) throw refusal('runtime-reference-release-unproved', 'publication exclusion was not released');
    }

    /** @summary Reads, probes and publishes while retirement and reference acquisition are excluded. */
    async function publish() {
        const target   = path.join(directory, identity.id);
        const expected = await inventory(source, true);
        const existing = await readRuntimeGeneration({directory: target, platform, arch});
        if (existing) {
            if (existing.payloadDigest !== expected.digest) throw refusal('non-reproducible-build', 'one package identity has different payload bytes, modes or links');
            references.assertRuntimeGenerationReferences(guard, directory);
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
                runtimeRelativePath   : path.relative(source, sourceRuntime) || '.',
                executableRelativePath: path.relative(source, sourceExecutable), createdAt: now().toISOString()
            });
            const candidate = descriptor(stage, record);
            let observed;
            try { observed = await probe(candidate) } catch (cause) {
                throw refusal('runtime-compatibility-failed', 'copied runtime probe failed', cause)
            }
            if (observed?.platform !== platform || observed?.arch !== arch ||
                observed?.electronVersion !== identity.identity[3] || observed?.launchProtocol !== verifier.LAUNCH_ADMISSION_PROTOCOL) {
                throw refusal('runtime-compatibility-failed', 'copied runtime does not match the target platform, architecture, Electron or launch protocol')
            }
            record = completeRuntimeGenerationRecord(record, observed);
            if ((await inventory(payload)).digest !== copied.digest) throw refusal('runtime-integrity-failed', 'the probe changed the sealed payload');
            await fs.writeFile(path.join(stage, RECORD), JSON.stringify(record) + '\n', {mode: 0o400});
            await fs.chmod(stage, 0o500);
            references.assertRuntimeGenerationReferences(guard, directory);
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
                references.assertRuntimeGenerationReferences(guard, directory);
                return winner
            }
            const published = await readRuntimeGeneration({directory: target, platform, arch});
            if (!published || published.payloadDigest !== copied.digest) {
                throw refusal('non-reproducible-build', 'a concurrent publication has another payload for this identity')
            }
            references.assertRuntimeGenerationReferences(guard, directory);
            return published
        } finally {
            await removeOwnedRuntimeTree(stage)
        }
    }
}
