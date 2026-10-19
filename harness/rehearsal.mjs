import crypto      from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs          from 'node:fs';
import path        from 'node:path';

/**
 * @module harness/rehearsal
 * @summary The pre-install rehearsal (`NEO_HARNESS_REHEARSAL=1`): a windowless arm of the fixture-plane smoke. A
 * candidate's own host boots its organism exactly as `smoke:plane` does, a packaged run in its runtime generation,
 * then runs the organism's seat journey (`ai/services/fleet/seatJourney.mjs`) against that fleet. Start, Stop,
 * Start again, an unclean Fleet restart and recovery run where the 10-18 install failed only after the swap:
 * launch admission, the Bridge-token owner and custody recovery exist only on the generation path.
 *
 * This module holds what needs no Electron: the arm's gate, the stand-in's runtime, the candidate's identity and
 * the receipt. The verdict lands beside a packaged artifact as `<artifact>.rehearsal.json`, so an installer can ask
 * whether this exact candidate was rehearsed.
 * @see harness/walkControl.mjs
 */

/**
 * The suffix a packaged artifact's receipt carries beside it.
 * @type {String}
 */
export const RECEIPT_SUFFIX = '.rehearsal.json';

/**
 * The installed app. A rehearsal proves a candidate before it replaces this one, so it never targets it.
 * @type {String}
 */
export const INSTALLED_APP = '/Applications/Neo Harness.app';

/**
 * @summary Whether this boot rehearses. The rehearsal acts only in the fixture-plane arm; set anywhere else it is a
 * refusal with its reason, because a rehearsal without a plane of its own would start seats against the organism
 * already running on this machine.
 * @param {Object}  options
 * @param {Object}  options.env
 * @param {Boolean} options.smokePlaneMode The fixture-plane arm: smoke, the Brain leg, and its own plane.
 * @returns {{rehearsal: Boolean, refusal: String|null}}
 */
export function resolveRehearsal({env, smokePlaneMode}) {
    if (env.NEO_HARNESS_REHEARSAL !== '1') {
        return {rehearsal: false, refusal: null}
    }

    return smokePlaneMode
        ? {rehearsal: true, refusal: null}
        : {rehearsal: false, refusal: 'NEO_HARNESS_REHEARSAL=1 rehearses only a smoke run on its own fixture plane (NEO_HARNESS_SMOKE=1, the Brain leg on, NEO_HARNESS_SMOKE_PLANE=1); without one its seats would start against the organism running here, so it does not start'}
}

/**
 * @summary The Node the stand-in harness runs on: `NEO_HARNESS_NODE_BIN`, else the `node` on `PATH`.
 *
 * The Fleet proves a seat's process by its command line: the launch binary, or a script behind exactly its shebang
 * interpreter. Electron runs as Node only under `ELECTRON_RUN_AS_NODE=1`, which a seat's ambient environment drops
 * and a shebang cannot set without changing the interpreter the proof compares. So the stand-in, a test double,
 * runs on the host's Node, and the product's runtime stays the product's. Without a Node that answers, the
 * rehearsal refuses; it never falls back to another runtime.
 * @param {Object}   options
 * @param {Object}   options.env
 * @param {Function} [options.run=spawnSync]
 * @returns {{runtime: String|null, refusal: String|null}}
 */
export function resolveStandInRuntime({env, run = spawnSync}) {
    const
        located = env.NEO_HARNESS_NODE_BIN || run('/bin/sh', ['-c', 'command -v node'], {encoding: 'utf8', env: {PATH: env.PATH ?? ''}}).stdout?.trim(),
        answer  = located && path.isAbsolute(located) && run(located, ['-p', 'process.version'], {encoding: 'utf8'});

    return answer?.status === 0 && /^v\d+\./.test(answer.stdout?.trim() ?? '')
        ? {runtime: located, refusal: null}
        : {runtime: null, refusal: `the stand-in harness needs a Node runtime: set NEO_HARNESS_NODE_BIN or put node on PATH (found ${located ? `'${located}', which did not answer` : 'none'})`}
}

/**
 * @summary The candidate's identity, read from the organism's build receipt: its three owners' revisions and the
 * receipt's own digest, so a later reader can tell this exact build from another with the same version label.
 * @param {String} organismRoot
 * @returns {{digest: String, electronVersion: String|null, owners: Object}}
 */
export function readOrganismIdentity(organismRoot) {
    const
        bytes   = fs.readFileSync(path.join(organismRoot, 'organism-build-info.json')),
        receipt = JSON.parse(bytes.toString('utf8'));

    return {
        digest         : crypto.createHash('sha256').update(bytes).digest('hex'),
        electronVersion: receipt.electronVersion ?? null,
        owners         : Object.fromEntries(Object.entries(receipt.owners ?? {}).map(([owner, {name, revision}]) => [owner, {name, revision}]))
    }
}

/**
 * @summary Where a rehearsal's receipt goes: beside a packaged artifact, or under the checkout's `.brain/`, outside the
 * smoke root its teardown removes. The installed app is refused: its directory is the operator's, and a rehearsal
 * targets the candidate that would replace it.
 * @param {Object}      options
 * @param {String|null} options.artifactPath The packaged `.app`, or `null` for a checkout run.
 * @param {String}      options.harnessDir
 * @returns {{receiptPath: String|null, refusal: String|null}}
 */
export function resolveReceiptPath({artifactPath, harnessDir}) {
    if (!artifactPath) {
        return {receiptPath: path.join(harnessDir, '.brain', 'rehearsal.json'), refusal: null}
    }

    return path.resolve(artifactPath) === INSTALLED_APP
        ? {receiptPath: null, refusal: `a rehearsal proves a candidate before it replaces ${INSTALLED_APP}, so it does not run against the installed app itself`}
        : {receiptPath: path.resolve(artifactPath) + RECEIPT_SUFFIX, refusal: null}
}

/**
 * @summary Writes the receipt whole, then renames it into place, so a reader never sees half a verdict.
 * @param {String} receiptPath
 * @param {Object} receipt
 * @returns {String} The receipt path.
 */
export function writeReceipt(receiptPath, receipt) {
    const scratch = `${receiptPath}.tmp-${process.pid}`;

    fs.mkdirSync(path.dirname(receiptPath), {recursive: true});
    fs.writeFileSync(scratch, JSON.stringify(receipt, null, 2) + '\n');
    fs.renameSync(scratch, receiptPath);
    return receiptPath
}
