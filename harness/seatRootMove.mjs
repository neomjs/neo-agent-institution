import {execFile}                                                   from 'node:child_process';
import crypto                                                       from 'node:crypto';
import fs                                                           from 'node:fs';
import path                                                         from 'node:path';
import {SEAT_ROOT_ORIGINS, readSeatRootRecord, writeSeatRootRecord} from './seatRootRecord.mjs';

/**
 * @module harness/seatRootMove
 * @summary The installed shell's one deliberate move of its seats to another agents root. The operator
 * consents to a plan, and the move then runs at the next boot, before the first-launch choice and before
 * any Brain child, so the Fleet that owns the registry is not running.
 *
 * The Brain does the seat work (its `moveSeatHomes`: copy, prove, publish, relocate each binding with its
 * exact `from`); the shell decides when it may run and commits it. The consent persists only the move's
 * inputs, in `seat-root-move.json` beside the seat root record. Every state is read, never stored: the
 * registry's bindings, the root record, and the old folders. So the move commits by writing the root
 * record (origin `moved`) once the registry reads every consented row at its destination. Before that, an
 * interruption resumes, or the old bindings come back and the consent is spent. After it, only the
 * retirement of the old folders resumes, into an archive under the old root that the first-launch choice
 * never counts.
 */

/**
 * @type {String}
 */
export const SEAT_ROOT_MOVE_FILE = 'seat-root-move.json';

/**
 * The Brain's plan states for a row that the move carries to its destination.
 * @type {ReadonlySet<String>}
 */
const MOVING_STATES = new Set(['copy', 'relocate', 'rebind', 'done']);

/**
 * The one-shot the shell runs in the Brain root for each step of a move. The step and its inputs travel
 * in the environment, never in the script text.
 * @type {String}
 */
export const SEAT_MOVE_SCRIPT = [
    "import 'dotenv/config';",
    "import Neo from 'neo.mjs/src/Neo.mjs';",
    "import * as core from 'neo.mjs/src/core/_export.mjs';",
    "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
    "import AiConfig from './ai/config.mjs';",
    "import FleetRegistryService from './ai/services/fleet/FleetRegistryService.mjs';",
    "import {moveSeatHomes} from './ai/services/fleet/moveSeatHomes.mjs';",
    "const {NEO_HARNESS_SEAT_MOVE_STEP: step, NEO_HARNESS_SEAT_MOVE_FROM: from, NEO_HARNESS_SEAT_MOVE_TO: to, NEO_HARNESS_SEAT_MOVE_ROWS: rows} = process.env;",
    "let result;",
    "if (step === 'plan' || step === 'move') {",
    "    result = await moveSeatHomes({registry: FleetRegistryService, from, to, dryRun: step === 'plan'})",
    "} else if (step === 'bindings') {",
    "    result = FleetRegistryService.listAgents().map(({id, seatHome}) => ({id, seatHome: seatHome ?? null}))",
    "} else if (step === 'restore') {",
    "    result = JSON.parse(rows).map(row => FleetRegistryService.getAgent(row.id)?.seatHome === row.to",
    "        ? (FleetRegistryService.relocateSeatHome(row.id, {from: row.to, to: row.from}), {id: row.id, state: 'restored'})",
    "        : {id: row.id, state: 'unchanged'})",
    "} else {",
    "    throw new Error(`unknown seat move step '${step}'`)",
    "}",
    "process.stdout.write(JSON.stringify(result), () => process.exit(0));"
].join('\n');

/**
 * @summary Runs one step of a move in the Brain root.
 * @param {Object}   options
 * @param {String}   options.step      `plan`, `move`, `bindings` or `restore`.
 * @param {String}   [options.from]    The agents root the seats leave.
 * @param {String}   [options.to]      The agents root they move to.
 * @param {Object[]} [options.rows]    The consented rows, for `restore`.
 * @param {Function} options.runScript `({label, script, env}) => Promise<Object>`: the shell's `runBrainScript`
 *     bound to the installation's Brain root and environment.
 * @returns {Promise<Object>} The step's JSON answer.
 */
export function runSeatMoveStep({step, from, to, rows, runScript}) {
    return runScript({
        label : `seat move ${step}`,
        script: SEAT_MOVE_SCRIPT,
        env   : {
            NEO_HARNESS_SEAT_MOVE_FROM: from ?? '',
            NEO_HARNESS_SEAT_MOVE_ROWS: JSON.stringify(rows ?? []),
            NEO_HARNESS_SEAT_MOVE_STEP: step,
            NEO_HARNESS_SEAT_MOVE_TO  : to ?? ''
        }
    })
}

/**
 * @summary The Brain's dry run for moving the seats from one root to another, with a fingerprint of what it
 * shows: consent must name the plan it saw.
 * @param {Object}   options
 * @param {String}   options.from
 * @param {String}   options.to
 * @param {Function} options.runStep `(step) => Promise<Object>`, {@link runSeatMoveStep} bound to `runScript`.
 * @returns {Promise<{state: String, reason?: String, rows: Object[], fingerprint: String}>}
 */
export async function planSeatMove({from, to, runStep}) {
    const plan = await runStep({step: 'plan', from, to});

    return {...plan, fingerprint: planFingerprint({from, to, rows: plan.rows ?? []})}
}

/**
 * @summary The fingerprint of a plan: the roots and, per row, what the plan would do with it.
 * @param {Object} plan
 * @returns {String}
 * @private
 */
function planFingerprint({from, to, rows}) {
    const shown = rows.map(row => [row.id, row.seatHome ?? null, row.destination, row.state, !!row.materialized]);

    return crypto.createHash('sha256').update(JSON.stringify({from, to, shown})).digest('hex')
}

/**
 * @summary Records the operator's consent to move the seats from the recorded root to `to`: the inputs of a
 * fresh plan that still matches the one shown. Nothing else changes; the move runs at the next boot.
 * @param {Object}   options
 * @param {String}   options.dir         Directory holding the records (Electron `userData`).
 * @param {String}   options.to          The agents root the seats move to.
 * @param {String}   options.fingerprint The fingerprint of the plan the operator saw ({@link planSeatMove}).
 * @param {Function} options.runStep
 * @param {Function} [options.now]
 * @param {Object}   [options.fsModule=fs]
 * @returns {Promise<{state: 'consented', inputs: Object}|{state: 'refused', reason: String}>}
 */
export async function consentSeatMove({dir, to, fingerprint, runStep, now = () => new Date(), fsModule = fs}) {
    const record = readSeatRootRecord({dir, fsModule});

    if (!record) return {state: 'refused', reason: 'this installation records no seat root yet'};
    if (readSeatRootMove({dir, fsModule})) return {state: 'refused', reason: 'a move of the seats is already consented'};

    const plan = await planSeatMove({from: record.root, to, runStep});

    if (plan.state !== 'planned') return {state: 'refused', reason: plan.reason ?? `the plan reads '${plan.state}'`};
    if (plan.fingerprint !== fingerprint) return {state: 'refused', reason: 'the seats changed since the plan was shown; review it again'};

    const rows = plan.rows.filter(row => MOVING_STATES.has(row.state));

    if (rows.every(row => row.state === 'done')) return {state: 'refused', reason: 'no seat would move'};

    const
        moment = now(),
        inputs = {
            version       : 1,
            consentedAt   : moment.toISOString(),
            from          : record.root,
            to,
            archive       : path.join(record.root, `.moved-${moment.toISOString().replace(/[:.]/g, '-')}`),
            previousRecord: record,
            rows          : rows.map(row => ({id: row.id, from: path.join(record.root, row.id), to: row.destination, materialized: !!row.materialized})),
            outOfScope    : plan.rows.filter(row => !MOVING_STATES.has(row.state)).map(row => ({id: row.id, seatHome: row.seatHome ?? null, reason: row.reason ?? null}))
        };

    writeAtomically({file: path.join(dir, SEAT_ROOT_MOVE_FILE), content: inputs, fsModule});

    return {state: 'consented', inputs}
}

/**
 * @summary Reads the consented move. An absent file reads `null`; one that cannot be used throws, because
 * its state cannot be known.
 * @param {Object} options
 * @param {String} options.dir
 * @param {Object} [options.fsModule=fs]
 * @returns {Object|null}
 * @throws {Error} When the file exists but does not describe a move.
 */
export function readSeatRootMove({dir, fsModule = fs}) {
    const file = path.join(dir, SEAT_ROOT_MOVE_FILE);
    let inputs;

    try {
        inputs = JSON.parse(fsModule.readFileSync(file, 'utf8'))
    } catch (error) {
        if (error?.code === 'ENOENT') return null;

        throw new Error(`${file} cannot be read (${error.message}); restore it before the seats can move`)
    }

    if (!describesMove(inputs)) throw new Error(`${file} does not describe a move of the seats; restore it before they can move`);

    return inputs
}

/** @private */
function describesMove(inputs) {
    const absolute = value => typeof value === 'string' && path.isAbsolute(value);

    return inputs?.version === 1 && absolute(inputs.from) && absolute(inputs.to) && absolute(inputs.archive) &&
        path.dirname(inputs.archive) === inputs.from && path.basename(inputs.archive).startsWith('.') &&
        absolute(inputs.previousRecord?.root) && SEAT_ROOT_ORIGINS.includes(inputs.previousRecord.origin) &&
        Array.isArray(inputs.rows) && inputs.rows.length > 0 &&
        inputs.rows.every(row => typeof row?.id === 'string' && absolute(row.from) && absolute(row.to) && typeof row.materialized === 'boolean') &&
        Array.isArray(inputs.outOfScope)
}

/**
 * @summary Settles a consented move at boot, before the first-launch choice and before any Brain child.
 * - Nothing consented: `none`.
 * - The root record names the destination: the move committed; the retirement resumes (`committed`).
 * - Otherwise, with no process able to write this installation's registry: the plan is read again, the
 *   move runs, the registry is read back, and the root record is written (`committed`). A changed plan, a
 *   refused or failed move, or a binding off its destination brings the old bindings back, spends the
 *   consent and keeps the old root (`refused`). A missing or unreadable root record is written from the
 *   move either way, never by the first-launch choice.
 * - A move that can neither go on nor come back, or whose inputs cannot be read: `held`. The caller does
 *   not start the Fleet over it.
 * @param {Object}   options
 * @param {String}   options.dir         Directory holding the records (Electron `userData`).
 * @param {Function} options.checkWriter `() => Promise<{exclusive: Boolean, reason?: String}>` ({@link findFleetWriters}).
 * @param {Function} options.runStep     `(step) => Promise<Object>`, {@link runSeatMoveStep} bound to `runScript`.
 * @param {Function} [options.log]       Receives `{row, state}` per row and the outcome.
 * @param {Function} [options.now]
 * @param {Object}   [options.fsModule=fs]
 * @returns {Promise<{state: 'none'|'committed'|'refused'|'held', reason?: String, retirement?: Object}>}
 */
export async function settleSeatRootMove({dir, checkWriter, runStep, log = () => {}, now = () => new Date(), fsModule = fs}) {
    let inputs;

    try {
        inputs = readSeatRootMove({dir, fsModule})
    } catch (error) {
        return {state: 'held', reason: error.message}
    }

    if (!inputs) return {state: 'none'};

    let record = null;

    try {
        record = readSeatRootRecord({dir, fsModule})
    } catch {
        // an unreadable record is rewritten from the move below, never by the first-launch choice
    }

    if (record?.root === inputs.to) return {state: 'committed', retirement: retireMovedHomes({inputs, fsModule, log})};

    if (record && record.root !== inputs.from) {
        return {state: 'held', reason: `the seat root record names '${record.root}', neither side of the consented move`}
    }

    const writer = await checkWriter();

    if (!writer.exclusive) return {state: 'held', reason: writer.reason};

    let refusal;

    try {
        refusal = await moveConsentedSeats({inputs, runStep, log})
    } catch (error) {
        refusal = `the move failed: ${error.message}`
    }

    if (!refusal) {
        writeSeatRootRecord({dir, root: inputs.to, origin: 'moved', now, fsModule});
        log({state: 'committed', root: inputs.to});

        return {state: 'committed', retirement: retireMovedHomes({inputs, fsModule, log})}
    }

    try {
        for (const row of await runStep({step: 'restore', rows: inputs.rows})) {
            row.state === 'restored' && log({row: row.id, state: 'restored'})
        }
    } catch (error) {
        return {state: 'held', reason: `${refusal}; the old bindings could not be restored (${error.message})`}
    }

    if (!record) writeSeatRootRecord({dir, root: inputs.previousRecord.root, origin: inputs.previousRecord.origin, now, fsModule});

    fsModule.rmSync(path.join(dir, SEAT_ROOT_MOVE_FILE), {force: true});
    log({state: 'refused', reason: refusal});

    return {state: 'refused', reason: refusal}
}

/**
 * @summary The move itself, once the shell holds the registry alone: the plan read again and held against
 * the consent, the Brain's move, and the registry read back.
 * @param {Object}   options
 * @param {Object}   options.inputs The consented move.
 * @param {Function} options.runStep
 * @param {Function} options.log
 * @returns {Promise<String|null>} Why the move cannot commit, or `null` when every consented row reads its destination.
 * @private
 */
async function moveConsentedSeats({inputs, runStep, log}) {
    const plan = await runStep({step: 'plan', from: inputs.from, to: inputs.to});

    if (plan.state !== 'planned') return plan.reason ?? `the plan reads '${plan.state}'`;

    const changed = scopeChange({inputs, rows: plan.rows});

    if (changed) return `the seats changed since the move was consented (${changed}); review the plan again`;

    const moved = await runStep({step: 'move', from: inputs.from, to: inputs.to});

    (moved.rows ?? []).forEach(row => log({row: row.id, state: row.state}));

    if (moved.state !== 'moved') return moved.reason ?? `the move reads '${moved.state}'`;

    return bindingsChange({inputs, bindings: await runStep({step: 'bindings'})})
}

/**
 * @summary Whether a fresh plan still describes the consented move: each consented row would reach its
 * destination as consented or already has, and no other row would move.
 * @param {Object}   options
 * @param {Object}   options.inputs
 * @param {Object[]} options.rows The fresh plan's rows.
 * @returns {String|null} The first difference, or `null`.
 * @private
 */
function scopeChange({inputs, rows}) {
    const consented = new Map(inputs.rows.map(row => [row.id, row]));

    for (const row of rows) {
        const consent = consented.get(row.id);

        if (!consent) {
            if (MOVING_STATES.has(row.state) && row.state !== 'done') return `'${row.id}' would move but was not consented`;
            continue
        }

        const fits = row.destination === consent.to && [consent.from, consent.to].includes(row.seatHome) && (
            row.state === 'done' ||
            (row.state === 'rebind' && !consent.materialized) ||
            (['copy', 'relocate'].includes(row.state) && consent.materialized)
        );

        if (!fits) return `'${row.id}' now reads '${row.state}'`;

        consented.delete(row.id)
    }

    return consented.size ? `'${consented.keys().next().value}' is no longer registered` : null
}

/**
 * @summary Whether the registry reads the move as complete: every consented row at its destination, and
 * every row left out bound as it was.
 * @param {Object}   options
 * @param {Object}   options.inputs
 * @param {Object[]} options.bindings `{id, seatHome}` per registered row.
 * @returns {String|null} The first row that does not, or `null`.
 * @private
 */
function bindingsChange({inputs, bindings}) {
    const
        seatHomes = new Map(bindings.map(row => [row.id, row.seatHome])),
        unmoved   = inputs.rows.find(row => seatHomes.get(row.id) !== row.to),
        rebound   = inputs.outOfScope.find(row => seatHomes.has(row.id) && seatHomes.get(row.id) !== row.seatHome);

    if (unmoved) return `'${unmoved.id}' reads '${seatHomes.get(unmoved.id) ?? 'no seat home'}', not '${unmoved.to}'`;

    return rebound ? `'${rebound.id}' was rebound during the move` : null
}

/**
 * @summary Retires the old folders of a committed move into its archive, a dot-folder under the old root the
 * first-launch choice never counts. Only the folders the move names are touched, and an occupied archive path
 * stops the retirement before anything is renamed. Run again, it finishes what is left.
 * @param {Object}   options
 * @param {Object}   options.inputs The consented move.
 * @param {Object}   [options.fsModule=fs]
 * @param {Function} [options.log]
 * @returns {{state: 'retired', archived: String[]}|{state: 'held', reason: String}}
 */
export function retireMovedHomes({inputs, fsModule = fs, log = () => {}}) {
    const
        exists  = file => {
            try {
                fsModule.lstatSync(file);
                return true
            } catch (error) {
                if (error?.code === 'ENOENT') return false;
                throw error
            }
        },
        pending = [];

    try {
        for (const row of inputs.rows.filter(row => row.materialized)) {
            const archived = path.join(inputs.archive, row.id);

            if (!exists(row.from)) continue;
            if (exists(archived)) return {state: 'held', reason: `'${archived}' is occupied; no old folder was archived`};

            pending.push({id: row.id, from: row.from, to: archived})
        }

        pending.length && fsModule.mkdirSync(inputs.archive, {recursive: true, mode: 0o700});

        for (const move of pending) {
            fsModule.renameSync(move.from, move.to);
            log({row: move.id, state: 'archived'})
        }
    } catch (error) {
        return {state: 'held', reason: `the old folders could not be archived (${error.message})`}
    }

    return {state: 'retired', archived: pending.map(move => move.id)}
}

/**
 * @summary Whether any process could still write this installation's registry: a listener on the Fleet port,
 * or a process running this installation's Fleet entry. Running processes that cannot be read leave the
 * question open, so the move does not run.
 * @param {Object}   options
 * @param {Number}   options.fleetPort
 * @param {String}   options.fleetEntry       Absolute path of this installation's Fleet server entry.
 * @param {Function} options.probePortFn      `({port}) => Promise<Boolean>`.
 * @param {Function} [options.listProcessesFn] `() => Promise<{pid, command}[]>`.
 * @returns {Promise<{exclusive: Boolean, reason?: String}>}
 */
export async function findFleetWriters({fleetPort, fleetEntry, probePortFn, listProcessesFn = listProcesses}) {
    if (await probePortFn({port: fleetPort})) {
        return {exclusive: false, reason: `a process listens on the Fleet port ${fleetPort}; quit it, then relaunch`}
    }

    let processes;

    try {
        processes = await listProcessesFn()
    } catch (error) {
        return {exclusive: false, reason: `the running processes could not be read (${error.message}), so a Fleet writer cannot be ruled out`}
    }

    const writer = processes.find(entry => entry.command.includes(fleetEntry));

    return writer
        ? {exclusive: false, reason: `process ${writer.pid} runs this installation's Fleet; quit it, then relaunch`}
        : {exclusive: true}
}

/**
 * @summary This machine's processes, `{pid, command}` each.
 * @param {Object}   [options]
 * @param {Function} [options.execFileFn=execFile]
 * @returns {Promise<Object[]>}
 */
export function listProcesses({execFileFn = execFile} = {}) {
    return new Promise((resolve, reject) => {
        execFileFn('ps', ['-axo', 'pid=,command='], {maxBuffer: 16 * 1024 * 1024}, (error, stdout) => {
            if (error) return reject(error);

            resolve(String(stdout).split('\n')
                .map(line => line.trim().match(/^(\d+)\s+(.*)$/))
                .filter(Boolean)
                .map(([, pid, command]) => ({pid: Number(pid), command})))
        })
    })
}

/** @private */
function writeAtomically({file, content, fsModule}) {
    const temp = `${file}.${process.pid}.tmp`;

    fsModule.mkdirSync(path.dirname(file), {recursive: true});
    fsModule.writeFileSync(temp, JSON.stringify(content, null, 4) + '\n', {mode: 0o600});
    fsModule.renameSync(temp, file)
}
