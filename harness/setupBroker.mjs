import fs             from 'node:fs/promises';
import os             from 'node:os';
import path           from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID}   from 'node:crypto';

/**
 * @module harness/setupBroker
 * @summary The main-process handlers behind the preload's six `setup*` calls — the setup card's Create
 * door (the shell spec's inline, dismissible first run). Every reply is the recipe's own JSON: main
 * evaluates the recipe live for the bound target through the Brain's recipe module, records a
 * consent through its host-effect module, and runs nothing the operator did not consent to. A
 * credential enters main's own window and leaves as the path of an owner-only file; no value crosses
 * the IPC in either direction. Like `createPlaneBroker`, every handler refuses an untrusted sender,
 * and a boot without a Brain root answers each channel with the named reason instead of a missing
 * handler.
 */

/**
 * The preload key → IPC channel of every setup call.
 * @type {Object}
 */
export const SETUP_CHANNELS = Object.freeze({
    answer    : 'shell-setup-answer',
    credential: 'shell-setup-credential',
    effect    : 'shell-setup-effect',
    evaluate  : 'shell-setup-evaluate',
    presets   : 'shell-setup-presets',
    probe     : 'shell-setup-probe'
});

/**
 * The Brain modules the broker reaches through the runtime root, relative to it.
 * @type {Object}
 */
export const SETUP_MODULE_PATHS = Object.freeze({
    cli        : 'ai/scripts/setup/firstRun.mjs',
    hostEffects: 'ai/services/fleet/hostEffects.mjs',
    presets    : 'ai/services/fleet/placementPresets.mjs',
    probe      : 'ai/services/fleet/probePlacement.mjs',
    recipe     : 'ai/services/fleet/firstRunRecipe.mjs',
    record     : 'ai/services/fleet/setupRunRecord.mjs'
});

/**
 * The reason every channel answers while the effect orchestration is not exported by the Brain.
 * @type {String}
 */
export const EFFECT_UNWIRED_REASON = 'unwired: the recipe\'s effect orchestration is the CLI\'s own until the Brain exports it; run the CLI on the host, then re-check';

const setupModules = new Map();

/**
 * @summary The host state roots the CLI uses, from the same environment names: the state root
 * (`~/.neo-ai`) and the setup-record root under it.
 * @param {Object} options
 * @param {Object} options.env
 * @param {String} [options.homeDir=os.homedir()]
 * @returns {{setupRoot: String, stateRoot: String}}
 */
export function resolveSetupRoots({env, homeDir = os.homedir()}) {
    const stateRoot = path.resolve(env.NEO_HOST_STATE_ROOT || path.join(homeDir, '.neo-ai'));

    return {
        setupRoot: path.resolve(env.NEO_HOST_SETUP_RECORD_ROOT || path.join(stateRoot, 'setup')),
        stateRoot
    }
}

/**
 * @summary Imports the recipe, the host-effect module, the record, the presets, the probe and the
 * CLI's observers from the runtime root — the same modules the CLI runs — cached per root.
 * @param {Object} options
 * @param {String} options.runtimeRoot Absolute path of the Brain checkout or the packaged organism root
 * @returns {Promise<Object>} `{cli, hostEffects, presets, probe, recipe, record}`
 */
export function loadSetupModules({runtimeRoot}) {
    if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) {
        throw new TypeError('The setup broker needs an explicit absolute runtimeRoot; no cwd fallback.')
    }

    const root = path.resolve(runtimeRoot);

    let modules = setupModules.get(root);

    if (!modules) {
        modules = Promise.all(Object.entries(SETUP_MODULE_PATHS).map(async ([name, relative]) => [name, await import(pathToFileURL(path.join(root, relative)).href)]))
            .then(entries => Object.fromEntries(entries));

        setupModules.set(root, modules)
    }

    return modules
}

/**
 * @summary The newest readable setup record under the setup root, so a vessel resumes the run the
 * operator left — the CLI's `--run-id` without asking for it.
 * @param {Object} options
 * @param {String} options.setupRoot
 * @param {Object} options.record The record module
 * @param {Object} options.fsModule
 * @returns {Promise<{record: Object, recordPath: String}|null>}
 */
async function newestRecord({setupRoot, record, fsModule}) {
    const names = await fsModule.readdir(setupRoot).catch(() => []);

    let newest = null;

    for (const name of names) {
        if (!name.endsWith('.json')) continue;

        const
            recordPath = path.join(setupRoot, name),
            stat       = await fsModule.stat(recordPath).catch(() => null);

        if (!stat?.isFile() || (newest && stat.mtimeMs <= newest.mtimeMs)) continue;

        const read = await record.readSetupRecord(recordPath, {fsModule}).catch(() => null);

        read?.record && (newest = {mtimeMs: stat.mtimeMs, record: read.record, recordPath})
    }

    return newest ? {record: newest.record, recordPath: newest.recordPath} : null
}

/**
 * @summary The main-process setup broker.
 * @param {Object} options
 * @param {Function} options.isTrustedSender `(event) => Boolean`, the §2.3.4 check.
 * @param {Function|null} options.loadModules `() => Promise<modules>`, or `null` for a boot without a Brain root.
 * @param {Boolean} options.packaged Only a packaged boot runs the recipe on this host.
 * @param {Function} options.promptCredential `({event, method}) => Promise<String|null>` in main custody.
 * @param {String} options.setupRoot The setup records' directory.
 * @param {String} options.stateRoot The host state root the recipe's layout derives from.
 * @param {Object} [options.fsModule=fs]
 * @param {Function} [options.now=Date.now]
 * @returns {Object} One handler per {@link SETUP_CHANNELS} key: `(event, request) => Promise<Object>`.
 */
export function createSetupBroker({isTrustedSender, loadModules, packaged, promptCredential, setupRoot, stateRoot, fsModule = fs, now = Date.now}) {
    const
        refuse = (reason, extra = {}) => ({ok: false, reason, ...extra}),
        run    = {record: null, recordPath: null, target: null};

    // the run owner's record operations are SERIALIZED: one chain, every read-modify-write of the
    // record (resolve, consent, retire, evaluate) runs after the previous one settled, so two answers
    // landing together never capture the same record and lose a consent. A rejected operation
    // surfaces to its caller and leaves the chain usable for the next one.
    let chain = Promise.resolve();

    /**
     * @summary Runs one record operation after every earlier one, rejections included.
     * @param {Function} operation `() => Promise<*>`
     * @returns {Promise<*>}
     */
    function serialize(operation) {
        const next = chain.then(operation, operation);

        chain = next.catch(() => {});

        return next
    }

    /**
     * @summary Refuses an untrusted sender, a browser boot, and a boot without a Brain root — in
     * that order, each by name.
     * @param {Electron.IpcMainInvokeEvent} event
     * @param {String} channel
     * @returns {Promise<Object>} The modules, or a refusal envelope
     */
    async function admit(event, channel) {
        if (!isTrustedSender(event)) {
            throw new Error(`${channel}: untrusted sender`)
        }

        if (!packaged) {
            return refuse('not-packaged: the recipe runs on the host only from the installed Fleet Manager')
        }

        if (!loadModules) {
            return refuse('no-brain-root: this shell boots without a Brain root, so it cannot run the recipe')
        }

        try {
            return {modules: await loadModules()}
        } catch (error) {
            return refuse(`the recipe modules did not load: ${error.message}`)
        }
    }

    /**
     * @summary The run's record: resumed from the newest record under the setup root, or created.
     * A record bound to another target or recipe version retires its proof the way the CLI does.
     * @param {Object} modules
     * @param {Object|null} requested A target the renderer named (`{planeId, dataRoot, endpoint}`)
     * @returns {Promise<{record: Object, recordPath: String, target: Object}>}
     */
    async function resolveRun(modules, requested) {
        const
            {hostEffects, record: recordModule, recipe} = modules,
            host                                        = hostEffects.createHost({fsModule, now});

        if (!run.record) {
            const resumed = await newestRecord({setupRoot, record: recordModule, fsModule});

            if (resumed) {
                run.record     = resumed.record;
                run.recordPath = resumed.recordPath
            } else {
                const runId = randomUUID();

                run.record     = recordModule.createSetupRecord({runId, target: requested ?? {}, recipeVersion: recipe.RECIPE_VERSION, now});
                run.recordPath = recordModule.setupRecordPath(setupRoot, runId);
                await hostEffects.persistSetupRecord(run.recordPath, run.record, host)
            }
        }

        // a resume names what it names; the record's bound target fills the rest
        run.target = recordModule.resumeTarget(run.record, requested ?? {});

        const binding = recordModule.describeBinding(run.record, {target: run.target, recipeVersion: recipe.RECIPE_VERSION});

        if (binding !== 'bound') {
            run.record = recordModule.retireCurrentProof(run.record, {
                target       : run.target,
                recipeVersion: recipe.RECIPE_VERSION,
                reason       : binding === 'version-mismatch' ? recordModule.RETIRE_REASONS.versionChanged : recordModule.RETIRE_REASONS.targetChanged,
                now
            });
            await hostEffects.persistSetupRecord(run.recordPath, run.record, host)
        }

        return {host, record: run.record, recordPath: run.recordPath, target: run.target}
    }

    /**
     * @summary One live evaluation for the run's target over the CLI's production observers.
     * @param {Object} modules
     * @param {Object|null} [requested=null]
     * @returns {Promise<Object>} The CLI's `--json` shape: `{runId, recordPath, ...evaluation}`
     */
    async function evaluateNow(modules, requested = null) {
        const
            {cli, presets, recipe}      = modules,
            {host, record, recordPath, target} = await resolveRun(modules, requested),
            layout                      = cli.hostLayout({stateRoot}),
            observers                   = cli.productionObservers({layout, host}),
            evaluation                  = await recipe.evaluateRecipe({target, record, observers, presets: presets.presets, now});

        return {runId: record.runId, recordPath, ...evaluation}
    }

    return {
        /**
         * @param {Electron.IpcMainInvokeEvent} event
         * @param {{target: Object|null}} [request]
         * @returns {Promise<Object>} `{ok: true, evaluation}` or a refusal
         */
        async evaluate(event, request = {}) {
            const admitted = await admit(event, SETUP_CHANNELS.evaluate);

            if (!admitted.modules) return admitted;

            try {
                return {ok: true, evaluation: await serialize(() => evaluateNow(admitted.modules, request?.target ?? null))}
            } catch (error) {
                return refuse(`the recipe could not be evaluated: ${error.message}`)
            }
        },

        /**
         * @param {Electron.IpcMainInvokeEvent} event
         * @returns {Promise<Object>} `{ok: true, probe}` or a refusal
         */
        async probe(event) {
            const admitted = await admit(event, SETUP_CHANNELS.probe);

            if (!admitted.modules) return admitted;

            const {hostEffects, probe} = admitted.modules;

            try {
                const host = hostEffects.createHost({fsModule, now});

                return {ok: true, probe: await probe.probePlacement({target: {kind: 'local'}, readers: probe.createDefaultReaders({run: host.run})})}
            } catch (error) {
                return refuse(`the placement probe failed: ${error.message}`)
            }
        },

        /**
         * @param {Electron.IpcMainInvokeEvent} event
         * @returns {Promise<Object>} `{ok: true, presets}` or a refusal
         */
        async presets(event) {
            const admitted = await admit(event, SETUP_CHANNELS.presets);

            if (!admitted.modules) return admitted;

            return {ok: true, presets: admitted.modules.presets.presets}
        },

        /**
         * @summary Records one consent for a choice question (the preset; the advanced fold). A
         * credential question is refused here by name: its only ingress is main's window through
         * `credential()`, so no renderer-supplied path is ever admitted. The reply is the
         * re-evaluated run.
         * @param {Electron.IpcMainInvokeEvent} event
         * @param {{stepId: String, answer: String}} request
         * @returns {Promise<Object>}
         */
        async answer(event, request = {}) {
            const admitted = await admit(event, SETUP_CHANNELS.answer);

            if (!admitted.modules) return admitted;

            const
                {hostEffects, presets, recipe} = admitted.modules,
                {answer, stepId}               = request,
                step                           = recipe.RECIPE_STEPS.find(row => row.id === stepId);

            if (!step || step.kind !== recipe.STEP_KINDS.question) {
                return refuse(`'${stepId}' is not a question of this recipe`, {stepId})
            }

            if (step.answer === 'file') {
                return refuse(`'${stepId}' is a credential question: it is answered in main's window, never with a path from the renderer`, {stepId})
            }

            if (typeof answer !== 'string' || !answer) {
                return refuse('an answer is a non-empty string', {stepId})
            }

            if (stepId === 'preset' && !presets.presets.some(preset => preset.id === answer)) {
                return refuse(`'${answer}' is not a preset`, {stepId})
            }

            try {
                return await serialize(async () => {
                    const {host, record, recordPath} = await resolveRun(admitted.modules, null);

                    run.record = (await hostEffects.recordConsent({stepId, answer, record, recordPath, host})).record;

                    return {ok: true, evaluation: await evaluateNow(admitted.modules, null)}
                })
            } catch (error) {
                return refuse(`the consent was not recorded: ${error.message}`, {stepId})
            }
        },

        /**
         * @summary Consent to one host effect. Until the Brain exports the CLI's effect orchestration
         * (the per-effect inputs composed from the preset and the credential files), the vessel
         * refuses by name and the row's action is the operator's instruction — never a second
         * implementation of the effects here.
         * @param {Electron.IpcMainInvokeEvent} event
         * @param {{effectId: String}} request
         * @returns {Promise<Object>}
         */
        async effect(event, request = {}) {
            const admitted = await admit(event, SETUP_CHANNELS.effect);

            if (!admitted.modules) return admitted;

            return refuse(EFFECT_UNWIRED_REASON, {effectId: request?.effectId ?? null})
        },

        /**
         * @summary Opens main's credential window for one credential question, keeps the value as an
         * owner-only file under the setup root, records the file's PATH as the consent, and answers the
         * re-evaluated run with that path. The value never crosses the IPC.
         * @param {Electron.IpcMainInvokeEvent} event
         * @param {{stepId: String}} request
         * @returns {Promise<Object>}
         */
        async credential(event, request = {}) {
            const admitted = await admit(event, SETUP_CHANNELS.credential);

            if (!admitted.modules) return admitted;

            const
                {hostEffects, recipe} = admitted.modules,
                stepId                = request?.stepId,
                step                  = recipe.RECIPE_STEPS.find(row => row.id === stepId);

            if (!step || step.answer !== 'file') {
                return refuse(`'${stepId}' is not a credential question of this recipe`, {stepId})
            }

            const value = await promptCredential({event, method: 'setup-credential'});

            if (!value) {
                return refuse('canceled', {stepId})
            }

            try {
                const
                    dir      = path.join(setupRoot, 'credentials'),
                    filePath = path.join(dir, stepId);

                await fsModule.mkdir(dir, {recursive: true, mode: 0o700});
                await fsModule.writeFile(filePath, value, {mode: 0o600});
                await fsModule.chmod(filePath, 0o600);

                return await serialize(async () => {
                    const
                        {host, record, recordPath} = await resolveRun(admitted.modules, null),
                        reference                  = await hostEffects.admitCredentialReference({answer: filePath, fsModule});

                    if (!reference.ok) {
                        return refuse(reference.reason, {stepId})
                    }

                    run.record = (await hostEffects.recordConsent({stepId, answer: reference.path, record, recordPath, host})).record;

                    return {ok: true, evaluation: await evaluateNow(admitted.modules, null), path: reference.path}
                })
            } catch (error) {
                return refuse(`the credential was not kept: ${error.message}`, {stepId})
            }
        }
    }
}
