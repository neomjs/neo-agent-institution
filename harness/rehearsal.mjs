import crypto      from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs          from 'node:fs';
import path        from 'node:path';

/**
 * @module harness/rehearsal
 * @summary The pre-install rehearsal (`NEO_HARNESS_REHEARSAL=1`): a windowless arm of the isolated Brain smoke. A
 * candidate's own host boots its organism exactly as `smoke:brain` does, a packaged run in its runtime generation
 * with the host lanes gated off, then runs the organism's seat journey (`ai/services/fleet/seatJourney.mjs`) against
 * that fleet. Start, Stop, Start again, an unclean Fleet restart and recovery run where the 10-18 install failed only
 * after the swap: launch admission, the Bridge-token owner and custody recovery exist only on the generation path.
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
 * The desktop families a rehearsal starts, one seat each: the families the organism's seat journey covers.
 * @type {String[]}
 */
export const REHEARSAL_FAMILIES = Object.freeze(['claude-desktop', 'codex-desktop']);

/**
 * The viewer the rehearsal's Fleet runs as, seeded into the run's own graph before the first boot, so the identity of
 * the shell that launched the rehearsal never becomes the candidate's viewer.
 * @type {String}
 */
export const REHEARSAL_VIEWER = '@neo-rehearsal';

/**
 * @summary Whether this boot rehearses. The rehearsal acts only in the isolated Brain smoke, whose organism owns its
 * paths, ports and registry; set anywhere else it is a refusal with its reason, because its seats would start against
 * the organism already running on this machine. The fixture-plane arm is refused too, for now: a plane-mode Fleet
 * defines seats only after its plane registers a forge, and that is a later row.
 * @param {Object}  options
 * @param {Object}  options.env
 * @param {Boolean} options.smokeMode      `NEO_HARNESS_SMOKE=1`.
 * @param {Boolean} options.brainMode      The Brain leg is on.
 * @param {Boolean} options.smokePlaneMode The fixture-plane arm.
 * @returns {{rehearsal: Boolean, refusal: String|null}}
 */
export function resolveRehearsal({env, smokeMode, brainMode, smokePlaneMode}) {
    if (env.NEO_HARNESS_REHEARSAL !== '1') {
        return {rehearsal: false, refusal: null}
    }

    if (!smokeMode || !brainMode) {
        return {rehearsal: false, refusal: 'NEO_HARNESS_REHEARSAL=1 rehearses only the isolated Brain smoke (NEO_HARNESS_SMOKE=1 with the Brain leg on); any other boot would start seats against the organism running here, so it does not start'}
    }

    return smokePlaneMode
        ? {rehearsal: false, refusal: 'NEO_HARNESS_REHEARSAL=1 does not run on the fixture plane yet: a plane-mode Fleet defines seats only after its plane registers a forge; drop NEO_HARNESS_SMOKE_PLANE=1'}
        : {rehearsal: true, refusal: null}
}

/**
 * @summary The Node the stand-in harness runs on: `NEO_HARNESS_STAND_IN_NODE`, else the `node` on `PATH`.
 *
 * The Fleet proves a seat's process by its command line: the launch binary, or a script behind exactly its shebang
 * interpreter. Electron runs as Node only under `ELECTRON_RUN_AS_NODE=1`, which a seat's ambient environment drops
 * and a shebang cannot set without changing the interpreter the proof compares. So the stand-in, a test double,
 * runs on the host's Node, and the product's runtime stays the product's. That is also why it never reads
 * `NEO_HARNESS_NODE_BIN`: a packaged shell points that at its own Electron runtime for the Brain's children. Each
 * probe is bounded, because a binary that opens as an app instead of answering would otherwise hold the shell's main
 * process. Without a Node that answers, the rehearsal refuses; it never falls back to another runtime.
 * @param {Object}   options
 * @param {Object}   options.env
 * @param {Function} [options.run=spawnSync]
 * @param {Number}   [options.timeoutMs=10000] Budget for each probe.
 * @returns {{runtime: String|null, refusal: String|null}}
 */
export function resolveStandInRuntime({env, run = spawnSync, timeoutMs = 10_000}) {
    const
        probe   = {encoding: 'utf8', killSignal: 'SIGKILL', timeout: timeoutMs},
        located = env.NEO_HARNESS_STAND_IN_NODE || run('/bin/sh', ['-c', 'command -v node'], {...probe, env: {PATH: env.PATH ?? ''}}).stdout?.trim(),
        answer  = located && path.isAbsolute(located) && run(located, ['-p', 'process.version'], probe);

    return answer?.status === 0 && /^v\d+\./.test(answer.stdout?.trim() ?? '')
        ? {runtime: located, refusal: null}
        : {runtime: null, refusal: `the stand-in harness needs a Node runtime: set NEO_HARNESS_STAND_IN_NODE or put node on PATH (found ${located ? `'${located}', which did not answer` : 'none'})`}
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

/**
 * @summary A checkout candidate's identity: its runtime root and the commit checked out there. A checkout carries no
 * build receipt, so the commit is what tells one rehearsed tree from another.
 * @param {String}   runtimeRoot
 * @param {Function} [run=spawnSync]
 * @returns {{revision: String|null, runtimeRoot: String, source: String}}
 */
export function readCheckoutIdentity(runtimeRoot, run = spawnSync) {
    const head = run('git', ['-C', runtimeRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'});

    return {revision: head.status === 0 ? head.stdout.trim() : null, runtimeRoot, source: 'checkout'}
}

/**
 * @summary The seats a rehearsal defines, one per covered family. Each declares its git identity, so no forge is
 * read, and keeps only Neural Link: Memory Core and the Knowledge Base need a plane, and github-workflow needs a PAT
 * the forge can prove. The clone URL is `.invalid`, because the checkout is seeded and never fetched.
 * @returns {Object[]} `{definition, repo}` per seat, the journey's input.
 */
export function rehearsalSeats() {
    return REHEARSAL_FAMILIES.map(harnessType => {
        const id = `rehearsal-${harnessType}`;

        return {
            definition: {
                credential    : 'ghp_fixture_only',
                gitEmail      : `${id}@example.invalid`,
                gitName       : `Rehearsal ${harnessType}`,
                githubUsername: `neo-${id}`,
                harnessType,
                id,
                mcpServers    : {'github-workflow': false, 'knowledge-base': false, 'memory-core': false}
            },
            repo: {cloneUrl: 'https://example.invalid/rehearsal/seat.git', repoSlug: 'rehearsal/seat'}
        }
    })
}

/**
 * @summary What the rehearsal adds to the smoke's Fleet profile: the stand-in as each desktop family's harness
 * binary, the Bridge port and signing key the run owns, and the rehearsal's viewer. Under `UNIT_TEST_MODE` a
 * checkout's graph lives in memory per process, so `NEO_MEMORY_DB_PATH_TEST` names the file the viewer is seeded
 * into; a packaged profile's graph is that file already.
 * @param {Object} options
 * @param {Object} options.codex      `{binary, cli}` from the journey's `writeCodexStandInBundle`.
 * @param {String} options.graphPath  The run's graph file.
 * @param {Number} options.nlPort     The run's Bridge port.
 * @param {String} options.signingKey The run's Ed25519 signing key, PKCS8 PEM.
 * @param {String} options.standIn    The launcher from the journey's `writeStandInLauncher`.
 * @returns {Object} env fragment
 */
export function rehearsalFleetEnv({codex, graphPath, nlPort, signingKey, standIn}) {
    return {
        NEO_AGENT_IDENTITY          : REHEARSAL_VIEWER,
        NEO_FLEET_CLAUDE_DESKTOP_BIN: standIn,
        NEO_FLEET_CODEX_BIN         : codex.cli,
        NEO_FLEET_CODEX_DESKTOP_BIN : codex.binary,
        NEO_FLEET_SIGNING_KEY       : signingKey,
        NEO_MEMORY_DB_PATH_TEST     : graphPath,
        NEO_NL_PORT                 : String(nlPort)
    }
}

/**
 * @summary The script that seeds the rehearsal's viewer into the run's graph, run in the organism's root through
 * `runBrainScript`, which parses the `{seeded}` it prints.
 * @returns {String}
 */
export function viewerSeedScript() {
    const identity = {
        description: "The pre-install rehearsal's viewer",
        id         : REHEARSAL_VIEWER,
        name       : 'Rehearsal',
        properties : {accountType: 'agent', displayName: 'Rehearsal', githubLogin: REHEARSAL_VIEWER},
        type       : 'AgentIdentity'
    };

    return [
        "import Neo from 'neo.mjs/src/Neo.mjs';",
        "import * as core from 'neo.mjs/src/core/_export.mjs';",
        "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
        "import {seedAgentIdentities} from './ai/scripts/setup/seedAgentIdentities.mjs';",
        `const seeded = await seedAgentIdentities({identities: [${JSON.stringify(identity)}], log: () => {}});`,
        'process.stdout.write(JSON.stringify({seeded}), () => process.exit(0));'
    ].join('\n')
}

/**
 * @summary The script that maps roster rows the way the cockpit does (`RosterRow.mapRosterRow`), run in the product
 * root through `runBrainScript` so Neo never loads into the shell's main process. It reads the rows from
 * `NEO_REHEARSAL_ROWS` and prints `{states: {[id]: state}}`.
 * @returns {String}
 */
export function rosterMappingScript() {
    return [
        "import Neo from './node_modules/neo.mjs/src/Neo.mjs';",
        "import * as core from './node_modules/neo.mjs/src/core/_export.mjs';",
        "import './node_modules/neo.mjs/src/manager/Instance.mjs';",
        "const {default: RosterRow} = await import('./apps/agentos/util/RosterRow.mjs');",
        'const states = Object.fromEntries(JSON.parse(process.env.NEO_REHEARSAL_ROWS).map(row => [row.id, RosterRow.mapRosterRow(row).state]));',
        'process.stdout.write(JSON.stringify({states}), () => process.exit(0));'
    ].join('\n')
}

/**
 * @summary Whether the roster offers Start for each seat, read as the cockpit reads it: the `fleetRoster` rows mapped
 * by `RosterRow.mapRosterRow`, with Start offered only for state `off`, the card's own rule
 * (`apps/agentos/view/fleet/roster/card/Controller.mjs`). A seat the roster does not list is not offered. This
 * catches a recovered seat the roster still shows running. The mapping downgrades an `exited` lifecycle to `off`, so
 * that symptom is the journey's `recover` row to name, not this read's.
 * @param {Object}   options
 * @param {Object}   options.client  A Fleet wire client.
 * @param {Function} options.mapRows `async rows => ({[id]: state})`.
 * @param {String[]} options.seatIds
 * @returns {Promise<Object>} `{[seatId]: {offered, state}}`
 */
export async function readStartOffers({client, mapRows, seatIds}) {
    const
        rows   = (await client.fleetRoster())?.rows ?? [],
        states = await mapRows(rows.filter(row => seatIds.includes(row.id)));

    return Object.fromEntries(seatIds.map(id => [id, {offered: states[id] === 'off', state: states[id] ?? null}]))
}

/**
 * @summary The rehearsal's verdict. Every journey row must pass, and after the unclean restart the roster must offer
 * Start for every seat that was recovered. A failure names its seat, family and step, so a red candidate reads as
 * the defect it carries.
 * @param {Object}      options
 * @param {Object}      options.journey `{ok, rows}` from the seat journey.
 * @param {Object|null} options.offers  From {@link readStartOffers} after the restart; `null` when it never ran.
 * @returns {{failures: String[], ok: Boolean}}
 */
export function judgeRehearsal({journey, offers}) {
    const failures = journey.rows.filter(row => !row.ok).map(row => `${row.seat} (${row.family}) ${row.step}: ${row.reason}`);

    journey.rows.filter(row => row.step === 'recover').forEach(row => {
        const offer = offers?.[row.seat];

        offer?.offered || failures.push(`${row.seat} (${row.family}) start-offer: ${offer ? `the roster reads '${offer.state ?? 'absent'}' and offers no Start` : 'the roster was not read after the restart'}`)
    });

    return {failures, ok: failures.length === 0}
}

/**
 * @summary Runs the organism's seat journey against the smoke's own Fleet, and reads the roster's Start offer for each
 * seat right after the unclean restart, before the journey starts it again. The harness owns every process: `reboot`
 * stops its Fleet uncleanly, awaits `beforeBoot`, boots a fresh one on the same root and returns its wire client.
 * @param {Object}   options
 * @param {Number}   options.bridgePort The run's Bridge port.
 * @param {Object}   options.client     The first Fleet's wire client.
 * @param {Function} [options.log]
 * @param {Function} options.mapRows    For {@link readStartOffers}.
 * @param {Object}   options.organism   `{runSeatJourney}` from the candidate's organism.
 * @param {Function} options.reboot     `async ({beforeBoot}) => client`.
 * @param {Object[]} options.seats      From {@link rehearsalSeats}.
 * @returns {Promise<{journey: Object, offers: Object|null, verdict: Object}>}
 */
export async function runRehearsal({bridgePort, client, log = () => {}, mapRows, organism, reboot, seats}) {
    let offers = null;

    const journey = await organism.runSeatJourney({
        bridgePort,
        fleet       : client,
        log,
        restartFleet: async ({beforeBoot}) => {
            const next = await reboot({beforeBoot});

            offers = await readStartOffers({client: next, mapRows, seatIds: seats.map(seat => seat.definition.id)});
            return next
        },
        seats
    });

    return {journey, offers, verdict: judgeRehearsal({journey, offers})}
}
