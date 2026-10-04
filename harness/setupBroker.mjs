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
    cli          : 'ai/scripts/setup/firstRun.mjs',
    hostEffects  : 'ai/services/fleet/hostEffects.mjs',
    orchestration: 'ai/services/fleet/setupOrchestration.mjs',
    presets      : 'ai/services/fleet/placementPresets.mjs',
    probe        : 'ai/services/fleet/probePlacement.mjs',
    recipe       : 'ai/services/fleet/firstRunRecipe.mjs',
    record       : 'ai/services/fleet/setupRunRecord.mjs'
});

/**
 * The Brain's `ai/configBase.mjs`, relative to the runtime root: the file a preset's env set is
 * checked against before any write (the orchestration derives no path itself).
 * @type {String}
 */
export const CONFIG_SOURCE_PATH = 'ai/configBase.mjs';

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
 * @returns {Promise<Object>} `{cli, hostEffects, orchestration, presets, probe, recipe, record}`
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
 * @param {String|null} [options.configSourcePath=null] The Brain's `ai/configBase.mjs` under the runtime root; `null` without a Brain root.
 * @param {Object} [options.fsModule=fs]
 * @param {Function} [options.now=Date.now]
 * @returns {Object} One handler per {@link SETUP_CHANNELS} key: `(event, request) => Promise<Object>`.
 */
export function createSetupBroker({isTrustedSender, loadModules, packaged, promptCredential, setupRoot, stateRoot, configSourcePath = null, fsModule = fs, now = Date.now}) {
    const refuse = (reason, extra = {}) => ({ok: false, reason, ...extra});

    // the broker holds the run's BINDING only — the path of its record. The record itself is read
    // from disk by every operation: a write the host rejected may or may not have landed (an
    // effect's handler ran, its acknowledgement did not), and only the record on disk says which.
    let boundRecordPath = null;

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
     * @summary The run as one operation starts from it: the bound record read from disk, or — on
     * the first operation of a boot — the newest record under the setup root resumed, or a new one
     * created. A bound record that is gone or unreadable refuses the operation: nothing runs over
     * a record that was not read, and no fresh run takes its place. A record bound to another
     * target or recipe version retires its proof the way the CLI does.
     * @param {Object} modules
     * @param {Object|null} requested A target the renderer named (`{planeId, dataRoot, endpoint}`)
     * @returns {Promise<{host: Object, record: Object, recordPath: String, target: Object}>}
     */
    async function resolveRun(modules, requested) {
        const
            {hostEffects, record: recordModule, recipe} = modules,
            host                                        = hostEffects.createHost({fsModule, now});

        let record, recordPath = boundRecordPath;

        if (recordPath) {
            const read = await recordModule.readSetupRecord(recordPath, {fsModule});

            if (!read.record) {
                throw new Error(`the run's record could not be read (${read.problem ?? 'absent'}): nothing runs over an unread record`)
            }

            record = read.record
        } else {
            const resumed = await newestRecord({setupRoot, record: recordModule, fsModule});

            if (resumed) {
                ({record, recordPath} = resumed)
            } else {
                const runId = randomUUID();

                record     = recordModule.createSetupRecord({runId, target: requested ?? {}, recipeVersion: recipe.RECIPE_VERSION, now});
                recordPath = recordModule.setupRecordPath(setupRoot, runId);
                await hostEffects.persistSetupRecord(recordPath, record, host)
            }

            // bound once the record is on disk: a rejected first write binds nothing
            boundRecordPath = recordPath
        }

        // a resume names what it names; the record's bound target fills the rest
        const
            target  = recordModule.resumeTarget(record, requested ?? {}),
            binding = recordModule.describeBinding(record, {target, recipeVersion: recipe.RECIPE_VERSION});

        if (binding !== 'bound') {
            record = recordModule.retireCurrentProof(record, {
                target,
                recipeVersion: recipe.RECIPE_VERSION,
                reason       : binding === 'version-mismatch' ? recordModule.RETIRE_REASONS.versionChanged : recordModule.RETIRE_REASONS.targetChanged,
                now
            });
            await hostEffects.persistSetupRecord(recordPath, record, host)
        }

        return {host, record, recordPath, target}
    }

    /**
     * @summary One live evaluation of a resolved run over the CLI's production observers.
     * @param {Object} modules
     * @param {Object} resolved From {@link resolveRun}, its `record` the operation's current one
     * @returns {Promise<Object>} The CLI's `--json` shape: `{runId, recordPath, ...evaluation}`
     */
    async function evaluateRun(modules, {host, record, recordPath, target}) {
        const
            {cli, presets, recipe} = modules,
            layout                 = cli.hostLayout({stateRoot}),
            observers              = cli.productionObservers({layout, host}),
            evaluation             = await recipe.evaluateRecipe({target, record, observers, presets: presets.presets, now});

        return {runId: record.runId, recordPath, ...evaluation}
    }

    /**
     * @summary The run read from disk and evaluated, with the CLI's settle pass in between: an
     * interrupted effect whose result is observable while the served plane is the target's settles
     * through the shared orchestration, then the run is evaluated again. Nothing to settle → one
     * evaluation.
     * @param {Object} modules
     * @param {Object|null} [requested=null]
     * @returns {Promise<{evaluation: Object, resolved: Object}>} The CLI's `--json` shape, and the run it was read over
     */
    async function settleThenEvaluate(modules, requested = null) {
        const
            resolved   = await resolveRun(modules, requested),
            evaluation = await evaluateRun(modules, resolved);

        if (!evaluation.steps.some(step => step.status === 'reconcile-required')) {
            return {evaluation, resolved}
        }

        const
            {host, record, recordPath} = resolved,
            settled                    = {...resolved, record: await modules.orchestration.settlePending({record, recordPath, host, evaluation})};

        return {evaluation: await evaluateRun(modules, settled), resolved: settled}
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
                return {ok: true, evaluation: (await serialize(() => settleThenEvaluate(admitted.modules, request?.target ?? null))).evaluation}
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
                    const
                        resolved                   = await resolveRun(admitted.modules, null),
                        {host, record, recordPath} = resolved,
                        consented                  = (await hostEffects.recordConsent({stepId, answer, record, recordPath, host})).record;

                    return {ok: true, evaluation: await evaluateRun(admitted.modules, {...resolved, record: consented})}
                })
            } catch (error) {
                return refuse(`the consent was not recorded: ${error.message}`, {stepId})
            }
        },

        /**
         * @summary Consent to one host effect: the shared orchestration (the CLI's own module) runs
         * the one named effect in the recipe's order rules — the settle pass first, an earlier
         * effect that is not `ok` halts it, a refusal (the preset's env set, the credential
         * composition) writes nothing and answers in the orchestration's words — and the reply is
         * the re-evaluated run. An effect that ran answers the run whatever came of it: its receipt
         * moved and its row carries the reason, so the card never shows a refusal over a stale row;
         * only a report that moved nothing is a refusal. One serialized operation over the record as
         * disk holds it, so an effect whose acknowledgement write was rejected is found `pending` by
         * the next request and settled by observation, never run again; never a second
         * implementation of the effects here.
         * @param {Electron.IpcMainInvokeEvent} event
         * @param {{effectId: String}} request
         * @returns {Promise<Object>} `{ok: true, evaluation}`, or `{ok: false, reason, effectId}`
         */
        async effect(event, request = {}) {
            const admitted = await admit(event, SETUP_CHANNELS.effect);

            if (!admitted.modules) return admitted;

            const
                {cli, orchestration} = admitted.modules,
                effectId             = request?.effectId ?? null;

            if (!orchestration.EFFECT_ORDER.includes(effectId)) {
                return refuse(`'${effectId}' is not an effect of this recipe`, {effectId})
            }

            if (!configSourcePath) {
                return refuse('no-brain-root: the preset\'s env set has no config to be checked against', {effectId})
            }

            try {
                return await serialize(async () => {
                    const
                        {evaluation, resolved}             = await settleThenEvaluate(admitted.modules, null),
                        {host, record, recordPath, target} = resolved,
                        layout                             = cli.hostLayout({stateRoot}),
                        reported                           = [];

                    const performed = await orchestration.performEffects({
                        record, recordPath, host, layout, target, evaluation,
                        configSourcePath,
                        effectIds: [effectId],
                        report   : line => reported.push(String(line))
                    });

                    const
                        receiptOf = from => JSON.stringify((from?.receipts ?? []).find(receipt => receipt.effectId === effectId) ?? null),
                        moved     = receiptOf(performed) !== receiptOf(record);

                    if (reported.length > 0 && !moved) {
                        return refuse(reported.join('; '), {effectId})
                    }

                    return {ok: true, evaluation: await evaluateRun(admitted.modules, {...resolved, record: performed})}
                })
            } catch (error) {
                return refuse(`${effectId} could not run: ${error.message}`, {effectId})
            }
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

            // the run the window is opened FOR, captured before the prompt: the window is modal to
            // its own shell window only, and another window may re-target the run meanwhile
            let expected;

            try {
                expected = await serialize(async () => {
                    const {record, target} = await resolveRun(admitted.modules, null);

                    return {runId: record.runId, target: JSON.stringify(target)}
                })
            } catch (error) {
                return refuse(`the run could not be resolved: ${error.message}`, {stepId})
            }

            const value = await promptCredential({event, method: 'setup-credential'});

            if (!value) {
                return refuse('canceled', {stepId})
            }

            try {
                const
                    dir      = path.join(setupRoot, 'credentials'),
                    filePath = path.join(dir, stepId);

                // the file write is part of the consent's operation: a second window answered while
                // this consent is still being accepted cannot replace the value its path refers to;
                // and a value answered for one run never lands in another — the run and its target
                // are verified inside the operation before anything is written or admitted
                return await serialize(async () => {
                    const current = await resolveRun(admitted.modules, null);

                    if (current.record.runId !== expected.runId || JSON.stringify(current.target) !== expected.target) {
                        return refuse('the run was re-targeted while the window was open: nothing kept', {stepId})
                    }

                    await fsModule.mkdir(dir, {recursive: true, mode: 0o700});
                    await fsModule.writeFile(filePath, value, {mode: 0o600});
                    await fsModule.chmod(filePath, 0o600);

                    const
                        {host, record, recordPath} = current,
                        reference                  = await hostEffects.admitCredentialReference({answer: filePath, fsModule});

                    if (!reference.ok) {
                        return refuse(reference.reason, {stepId})
                    }

                    const consented = (await hostEffects.recordConsent({stepId, answer: reference.path, record, recordPath, host})).record;

                    return {ok: true, evaluation: await evaluateRun(admitted.modules, {...current, record: consented}), path: reference.path}
                })
            } catch (error) {
                return refuse(`the credential was not kept: ${error.message}`, {stepId})
            }
        }
    }
}
