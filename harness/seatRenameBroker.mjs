import crypto                                                   from 'node:crypto';
import path                                                     from 'node:path';
import {buildPackagedBrainEnv, runBrainScript}                  from './brain.mjs';
import {readSeatRootRecord}                                     from './seatRootRecord.mjs';

/**
 * @module harness/seatRenameBroker
 * @summary Main-owned review and apply for a stopped seat's durable Fleet-id transition
 * (`neomjs/neo-agent-institution#760`). The renderer reviews a fingerprinted plan (`from -> to`,
 * seat home, retired path, records that follow, carried sessions, repointed harness state, and
 * repaired worktrees); main validates sender trust, verifies the plan fingerprint before apply,
 * quiesces its owned Fleet child while `renameSeat` runs against the registry, and restarts the
 * Fleet child afterwards.
 */
export const SEAT_RENAME_CHANNELS = Object.freeze({
    apply: 'shell-seat-rename-apply',
    plan : 'shell-seat-rename-plan'
});

const
    SEAT_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i,
    FINGERPRINT_PATTERN  = /^[0-9a-f]{64}$/;

/**
 * The one-shot the shell runs in the Brain root to plan or apply a seat rename. Inputs travel in
 * the environment, never in the script text.
 * @type {String}
 */
export const SEAT_RENAME_SCRIPT = [
    "import 'dotenv/config';",
    "import fs from 'node:fs/promises';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import Neo from 'neo.mjs/src/Neo.mjs';",
    "import * as core from 'neo.mjs/src/core/_export.mjs';",
    "import InstanceManager from 'neo.mjs/src/manager/Instance.mjs';",
    "import AiConfig from './ai/config.mjs';",
    "import FleetRegistryService from './ai/services/fleet/FleetRegistryService.mjs';",
    "import FleetTenantService from './ai/services/fleet/FleetTenantService.mjs';",
    "import {claudeSlug} from './ai/services/fleet/carrySeatSessions.mjs';",
    "import {deriveAgentInstanceHome} from './ai/services/fleet/deriveAgentInstanceHome.mjs';",
    "import {renameSeat} from './ai/services/fleet/renameSeat.mjs';",
    "import {readSeatWindowRecord} from './ai/services/fleet/seatWindowRect.mjs';",
    "const {NEO_HARNESS_SEAT_RENAME_STEP: step, NEO_HARNESS_SEAT_RENAME_ID: id, NEO_HARNESS_SEAT_RENAME_TO: to, NEO_HARNESS_SEAT_RENAME_MOVE_ID: moveId} = process.env;",
    "const agents = FleetRegistryService.listAgents();",
    "const agent = agents.find(row => row.id === id) ?? agents.find(row => row.id === to && row.previousId === id) ?? null;",
    "const dryRun = step === 'plan';",
    "const registry = dryRun && agent ? {",
    "    listAgents: () => FleetRegistryService.listAgents(),",
    "    getDataDir: () => null,",
    "    admissionDirectory: () => null",
    "} : FleetRegistryService;",
    "const outcome = await renameSeat({registry, tenants: FleetTenantService, id, to, moveId: moveId || null, dryRun});",
    "if (outcome.plan && agent) {",
    "    const harnessType = agent.harnessType ?? null;",
    "    const seatHome = outcome.plan.seatHome ?? agent.seatHome ?? null;",
    "    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');",
    "    outcome.plan.harnessType = harnessType;",
    "    outcome.plan.retiredSeatHome = outcome.plan.retiredSeatHome ?? (seatHome ? path.join(path.dirname(path.dirname(seatHome)), 'retired-seats', `${id}.pre-rename-${today}`) : null);",
    "    let worktrees = 0, sessionCount = 0, claudeDesktopPresets = false, windowRecord = 'absent';",
    "    if (seatHome && outcome.plan.materialized) {",
    "        const instanceHome = deriveAgentInstanceHome({instanceRoot: path.dirname(seatHome), agentId: id, harnessType});",
    "        windowRecord = readSeatWindowRecord(instanceHome) ? 'present' : 'absent';",
    "        for (const entry of await fs.readdir(seatHome, {recursive: true, withFileTypes: true}).catch(() => [])) {",
    "            if (entry.isFile() && entry.name === '.git') {",
    "                const raw = await fs.readFile(path.join(entry.parentPath, entry.name), 'utf8').catch(() => '');",
    "                if (/^gitdir:\\s*(.+?)\\r?\\n?$/.test(raw)) worktrees++;",
    "            }",
    "        }",
    "        if (harnessType === 'claude-code' || harnessType === 'claude-desktop') {",
    "            const projects = harnessType === 'claude-code' ? path.join(instanceHome, 'projects') : path.join(os.homedir(), '.claude', 'projects');",
    "            const prefix = claudeSlug(seatHome);",
    "            const dirs = (await fs.readdir(projects, {withFileTypes: true}).catch(() => [])).filter(e => e.isDirectory() && e.name.startsWith(prefix));",
    "            sessionCount = dirs.length;",
    "            if (harnessType === 'claude-desktop') {",
    "                const presetsRaw = await fs.readFile(path.join(instanceHome, 'ccd-session-presets.json'), 'utf8').catch(() => '');",
    "                claudeDesktopPresets = presetsRaw.includes(seatHome);",
    "            }",
    "        } else if (harnessType === 'antigravity') {",
    "            sessionCount = 1;",
    "        }",
    "    }",
    "    if (!dryRun && outcome.plan.sessions) {",
    "        const s = outcome.plan.sessions;",
    "        sessionCount = Array.isArray(s.transcripts) ? s.transcripts.length : (typeof s.threads === 'number' ? s.threads : (s.project ? 1 : sessionCount));",
    "    }",
    "    if (!dryRun && outcome.plan.links?.worktrees) {",
    "        worktrees = outcome.plan.links.worktrees.length;",
    "    }",
    "    outcome.plan.records = {",
    "        registry: 1,",
    "        planeCredentials: Array.isArray(outcome.plan.planeCredentials) ? outcome.plan.planeCredentials.length : 0,",
    "        windowRecord,",
    "        continuity: ['presence', 'memory', 'wakes', 'continuity']",
    "    };",
    "    outcome.plan.sessionsSummary = {",
    "        harnessType,",
    "        total: sessionCount,",
    "        byHarness: harnessType ? {[harnessType]: sessionCount} : {}",
    "    };",
    "    outcome.plan.carriedSessions = sessionCount;",
    "    outcome.plan.repointed = {",
    "        claudeDesktopPresets,",
    "        antigravityNote: 'Antigravity: open conversations keep the old workspace — start a new one'",
    "    };",
    "    outcome.plan.worktrees = worktrees;",
    "}",
    "if (!dryRun && outcome.state === 'renamed') {",
    "    outcome.agent = FleetRegistryService.listAgents().find(row => row.id === to) ?? null;",
    "}",
    "process.stdout.write(JSON.stringify(outcome) + '\\n');"
].join('\n');

/**
 * @summary Validates a proposed or current seat id segment.
 * @param {*} value
 * @returns {Boolean}
 */
export function isValidSeatId(value) {
    return typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 128 &&
        !value.includes('..') &&
        SEAT_SEGMENT_PATTERN.test(value)
}

/**
 * @summary Computes a deterministic 64-character SHA-256 hex digest over the reviewed plan facts.
 * @param {Object} plan
 * @returns {String}
 */
export function computeRenamePlanFingerprint(plan = {}) {
    const canonical = {
        destination    : plan.destination ?? null,
        harnessType    : plan.harnessType ?? null,
        id             : plan.id ?? null,
        materialized   : Boolean(plan.materialized),
        records        : plan.records ?? null,
        repointed      : plan.repointed ?? null,
        retiredSeatHome: plan.retiredSeatHome ?? null,
        seatHome       : plan.seatHome ?? null,
        sessionsSummary: plan.sessionsSummary ?? null,
        state          : plan.state ?? null,
        to             : plan.to ?? null,
        worktrees      : Number.isFinite(plan.worktrees) ? plan.worktrees : 0
    };

    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/**
 * @summary Runs one seat-rename step (`plan` or `apply`) in the Brain runtime root.
 * @param {Object} options
 * @param {'plan'|'apply'} options.step
 * @param {String} options.id
 * @param {String} options.to
 * @param {String|null} [options.moveId=null]
 * @param {Function} [options.runScript=runBrainScript]
 * @returns {Promise<Object>}
 */
export function runSeatRenameStep({step, id, to, moveId = null, runScript = runBrainScript}) {
    return runScript({
        label : `seat rename (${step})`,
        script: SEAT_RENAME_SCRIPT,
        env   : {
            NEO_HARNESS_SEAT_RENAME_STEP   : step,
            NEO_HARNESS_SEAT_RENAME_ID     : id,
            NEO_HARNESS_SEAT_RENAME_TO     : to,
            NEO_HARNESS_SEAT_RENAME_MOVE_ID: moveId ?? ''
        }
    })
}

/**
 * @summary Binds the seat-rename broker to this installation's Brain runtime root and userData.
 * @param {Object} options
 * @param {String} options.repoRoot The packaged or explicit Brain root
 * @param {String} options.userData The installation's state directory
 * @param {String} [options.execPath=process.execPath] Bundled Electron executable
 * @param {Function} [options.runScript=runBrainScript] Script invocation for isolated tests
 * @returns {{runStep: Function}}
 */
export function createSeatRenameRuntime({repoRoot, userData, execPath = process.execPath, runScript = runBrainScript}) {
    return {
        runStep: step => {
            let recordedRoot = '';
            try {
                recordedRoot = readSeatRootRecord({dir: userData})?.root ?? ''
            } catch {
                recordedRoot = ''
            }

            const env = {
                ...buildPackagedBrainEnv({backupRoot: path.join(userData, 'backups'), dataRoot: path.join(userData, 'brain')}),
                ELECTRON_RUN_AS_NODE    : '1',
                NEO_HARNESS_ELECTRON_BIN: execPath,
                NEO_FLEET_AGENTS_ROOT   : recordedRoot
            };

            return runSeatRenameStep({
                ...step,
                runScript: ({env: stepEnv, ...script}) => runScript({...script, env: {...env, ...stepEnv}, repoRoot})
            })
        }
    }
}

/**
 * @summary Creates the shell's `plan` and `apply` handlers for renaming a stopped seat.
 * @param {Object} options
 * @param {Boolean} options.packaged Whether host operations are available
 * @param {Function} options.isTrustedSender Sender-frame validation
 * @param {Function|null} options.runStep Installation-bound Brain invocation (`{step, id, to, moveId}`)
 * @param {Function} [options.quiesceFleet] Wraps the `apply` step while the shell's owned Fleet child is stopped
 * @returns {Object} Handlers keyed by `SEAT_RENAME_CHANNELS`
 */
export function createSeatRenameBroker({packaged, isTrustedSender, runStep, quiesceFleet = fn => fn()}) {
    const refuse = (code, reason = code, extra = {}) => ({state: 'refused', code, reason, ...extra});
    let chain = Promise.resolve();

    function admit(event) {
        if (!isTrustedSender(event)) throw new Error('seat-rename: untrusted sender');
        if (!packaged) return refuse('not-packaged', 'seat rename requires the packaged shell');
        if (typeof runStep !== 'function') return refuse('no-brain-root', 'no Brain runtime root is configured');
        return null
    }

    function validatePair(id, to) {
        if (!isValidSeatId(id)) return refuse('invalid-seat-id', 'current seat id is invalid', {plan: {id: id ?? null, to: to ?? null}});
        if (!isValidSeatId(to)) return refuse('invalid-seat-id', 'new seat id must use letters, digits, dots, underscores, or hyphens', {plan: {id, to: to ?? null}});
        if (id === to) return refuse('same-seat-id', `seat '${id}' already has that id`, {plan: {id, to}});
        return null
    }

    async function buildPlan(id, to) {
        const result = await runStep({step: 'plan', id, to});

        if (!result || result.state === 'refused') {
            return refuse(result?.code || 'plan-refused', result?.reason || 'seat rename plan was refused', {
                plan : result?.plan ?? {id, to},
                stage: 'plan'
            })
        }

        const
            plan        = result.plan ?? {id, to},
            fingerprint = computeRenamePlanFingerprint(plan);

        return {
            state: 'planned',
            fingerprint,
            plan : {...plan, fingerprint}
        }
    }

    return {
        /**
         * @summary Plans a seat rename (`from -> to`) without mutating the registry or seat folder.
         * @param {Object} event
         * @param {Object} request
         * @returns {Promise<Object>}
         */
        async plan(event, {id, to} = {}) {
            const denied = admit(event);
            if (denied) return denied;

            const invalid = validatePair(id, to);
            if (invalid) return invalid;

            try {
                return await buildPlan(id, to)
            } catch (error) {
                return refuse('plan-failed', error?.message || String(error), {plan: {id, to}, stage: 'plan'})
            }
        },

        /**
         * @summary Verifies the reviewed plan fingerprint, quiesces the owned Fleet child, and applies the rename.
         * @param {Object} event
         * @param {Object} request
         * @returns {Promise<Object>}
         */
        apply(event, {id, to, fingerprint} = {}) {
            const denied = admit(event);
            if (denied) return Promise.resolve(denied);

            const invalid = validatePair(id, to);
            if (invalid) return Promise.resolve(invalid);

            if (typeof fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(fingerprint)) {
                return Promise.resolve(refuse('invalid-fingerprint', 'a 64-character hex plan fingerprint is required', {
                    plan : {id, to},
                    stage: 'verify-plan'
                }))
            }

            const run = chain.then(async () => {
                let fresh;
                try {
                    fresh = await buildPlan(id, to)
                } catch (error) {
                    return refuse('plan-failed', error?.message || String(error), {plan: {id, to}, stage: 'verify-plan'})
                }

                if (fresh.state !== 'planned') {
                    return {...fresh, stage: fresh.stage || 'verify-plan'}
                }

                if (fresh.fingerprint !== fingerprint) {
                    return refuse('plan-changed', 'the seat changed since the plan was shown; review it again', {
                        plan : fresh.plan,
                        stage: 'verify-plan'
                    })
                }

                const moveId = crypto.randomUUID();

                try {
                    const applied = await quiesceFleet(() => runStep({step: 'apply', id, to, moveId}));

                    if (!applied || applied.state !== 'renamed') {
                        return refuse(applied?.code || 'apply-refused', applied?.reason || 'seat rename was refused', {
                            plan : applied?.plan ?? fresh.plan,
                            stage: applied?.stage || 'apply'
                        })
                    }

                    return {
                        state: 'renamed',
                        agent: applied.agent ?? null,
                        plan : {
                            ...fresh.plan,
                            ...applied.plan,
                            carriedSessions: applied.plan?.carriedSessions ?? fresh.plan?.carriedSessions ?? 0,
                            retiredSeatHome: applied.plan?.retiredSeatHome ?? fresh.plan?.retiredSeatHome ?? null
                        }
                    }
                } catch (error) {
                    return refuse(error?.code || 'apply-failed', error?.message || String(error), {
                        plan : fresh.plan,
                        stage: error?.stage || 'apply'
                    })
                }
            });

            chain = run.catch(() => {});
            return run
        }
    }
}
