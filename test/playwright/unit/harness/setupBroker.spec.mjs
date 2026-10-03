import {expect, test}            from '@playwright/test';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import fsPromises                from 'node:fs/promises';
import {tmpdir}                  from 'node:os';
import path                      from 'node:path';
import {fileURLToPath}           from 'node:url';
import {
    CONFIG_SOURCE_PATH,
    SETUP_CHANNELS,
    SETUP_MODULE_PATHS,
    createSetupBroker,
    loadSetupModules,
    resolveSetupRoots
} from '../../../../harness/setupBroker.mjs';

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'setup-broker-'));

/**
 * The pinned Brain package: the runtime root the Brain-backed arms load the recipe's modules from.
 * @type {String}
 */
const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../node_modules/neo-agent-brain');

/**
 * The Brain modules the broker reaches, as fakes with the exported names it calls — the recipe's
 * step table, a record module over an in-memory record, a host-effect module that records consents,
 * the presets table, a probe, and the CLI's observers.
 */
function fakeModules({evaluations = []} = {}) {
    const
        calls   = [],
        persisted = [],
        STEPS   = [
            {id: 'placement', kind: 'observation'},
            {id: 'preset', kind: 'question'},
            {id: 'plane-credential', kind: 'question', answer: 'file'},
            {id: 'advanced', kind: 'question', optional: true},
            {id: 'write-env', kind: 'effect', effectId: 'write-env'}
        ];

    return {
        calls,
        persisted,
        modules: {
            recipe: {
                RECIPE_VERSION: 1,
                RECIPE_STEPS  : STEPS,
                STEP_KINDS    : {question: 'question', effect: 'effect', observation: 'observation'},
                evaluateRecipe: async options => {
                    calls.push(['evaluateRecipe', {target: options.target, consents: options.record.consents.map(row => row.stepId)}]);

                    // the effect rows read the record's receipts the way the recipe does: an accepted
                    // receipt reads ok, a pending one reconcile-required, none pending
                    const effectRow = effectId => {
                        const receipt = options.record.receipts.find(row => row.effectId === effectId);

                        return {id: effectId, kind: 'effect', effectId, status: !receipt ? 'pending' : receipt.outcome === 'accepted' ? 'ok' : 'reconcile-required', receipt: receipt?.outcome ?? null}
                    };

                    return evaluations.shift() ?? {recipeVersion: 1, target: options.target, binding: 'bound', bindingReason: null, steps: [{id: 'placement', status: 'ok'}, effectRow('write-secrets'), effectRow('write-env'), effectRow('compose-up')], terminal: null}
                }
            },
            record: {
                RETIRE_REASONS   : {versionChanged: 'version-changed', targetChanged: 'target-changed'},
                createSetupRecord: ({runId, target, recipeVersion}) => ({runId, target, recipeVersion, consents: [], receipts: []}),
                setupRecordPath  : (root, runId) => path.join(root, `${runId}.json`),
                readSetupRecord  : async filePath => { try { return {record: JSON.parse(readFileSync(filePath, 'utf8')), problem: null} } catch { return {record: null, problem: 'unreadable'} } },
                resumeTarget     : (record, invocation) => ({...record.target, ...Object.fromEntries(Object.entries(invocation).filter(([, value]) => value != null))}),
                describeBinding  : (record, {recipeVersion, target}) => record.recipeVersion !== recipeVersion ? 'version-mismatch' : JSON.stringify(record.target) !== JSON.stringify(target) ? 'target-mismatch' : 'bound',
                // the real module re-binds the record to the new target and retires the old proof into history
                retireCurrentProof: (record, {reason, target}) => ({...record, target, consents: [], receipts: [], retired: reason})
            },
            hostEffects: {
                createHost             : () => ({run: async () => ({stdout: '', stderr: ''}), fsModule: null, now: Date.now}),
                persistSetupRecord     : async (recordPath, record) => { persisted.push({recordPath, record}); const {writeFileSync} = await import('node:fs'); writeFileSync(recordPath, JSON.stringify(record)) },
                admitCredentialReference: async ({answer}) => {
                    try { statSync(answer); return {ok: true, path: answer} } catch { return {ok: false, reason: 'the answer is not the path of an existing file'} }
                },
                recordConsent          : async ({stepId, answer, record, recordPath}) => {
                    const next = {...record, consents: [...record.consents, {stepId, answer, consentedAt: '2026-10-02T10:00:00.000Z'}]};
                    const {writeFileSync} = await import('node:fs');
                    writeFileSync(recordPath, JSON.stringify(next));
                    return {record: next}
                }
            },
            presets: {presets: [{id: 'hosted'}, {id: 'local-small'}]},
            probe  : {
                createDefaultReaders: ({run}) => ({run}),
                probePlacement      : async ({target}) => ({target, host: {totalBytes: 1}, runningPlane: null})
            },
            // the shared orchestration: one effect at a time in the recipe's order, a receipt per
            // applied effect, a refusal reported and nothing written; the settle pass flips a
            // pending receipt to accepted when the evaluation says the served plane matches
            orchestration: {
                EFFECT_ORDER  : ['write-secrets', 'write-env', 'compose-up'],
                performEffects: async ({record, recordPath, effectIds, report, configSourcePath, evaluation}) => {
                    calls.push(['performEffects', {effectIds, configSourcePath, hasEvaluation: Boolean(evaluation)}]);

                    if (record.consents.some(row => row.answer === 'refuse-me')) {
                        report('the preset \'refuse-me\' declares an env key the profile does not consume');

                        return record
                    }

                    const next = {...record, receipts: [...record.receipts, ...(effectIds ?? ['write-secrets', 'write-env', 'compose-up']).map(effectId => ({effectId, outcome: 'accepted'}))]};
                    const {writeFileSync} = await import('node:fs');

                    writeFileSync(recordPath, JSON.stringify(next));

                    return next
                },
                settlePending: async ({record, recordPath, evaluation}) => {
                    calls.push(['settlePending', {reconcile: evaluation.steps.filter(step => step.status === 'reconcile-required').map(step => step.id)}]);

                    const next = {...record, receipts: record.receipts.map(receipt => receipt.outcome === 'pending' ? {...receipt, outcome: 'accepted'} : receipt)};
                    const {writeFileSync} = await import('node:fs');

                    writeFileSync(recordPath, JSON.stringify(next));

                    return next
                }
            },
            cli: {
                hostLayout         : ({stateRoot}) => ({envFile: path.join(stateRoot, 'config', 'local-agent-os.env'), secretsDir: path.join(stateRoot, 'secrets')}),
                productionObservers: ({layout}) => ({layout})
            }
        }
    }
}

const trusted = {sender: 'trusted'};

function createBroker({modules, packaged = true, prompt = async () => null, setupRoot = tempDir(), stateRoot = tempDir(), loadModules, configSourcePath = '/runtime/ai/configBase.mjs', fsModule} = {}) {
    return {
        setupRoot,
        stateRoot,
        broker: createSetupBroker({
            configSourcePath,
            fsModule,
            isTrustedSender : event => event === trusted,
            loadModules     : loadModules === undefined ? (modules ? async () => modules : null) : loadModules,
            packaged,
            promptCredential: prompt,
            setupRoot,
            stateRoot,
            now             : () => 1_700_000_000_000
        })
    }
}

test.describe('harness/setupBroker — the main-process handlers behind the setup card', () => {
    test('the channel table and the module table are the preload\'s six keys and the CLI\'s modules', () => {
        expect(Object.keys(SETUP_CHANNELS).sort()).toEqual(['answer', 'credential', 'effect', 'evaluate', 'presets', 'probe']);
        expect(Object.values(SETUP_CHANNELS).every(channel => channel.startsWith('shell-setup-'))).toBe(true);
        expect(SETUP_MODULE_PATHS).toEqual({
            cli          : 'ai/scripts/setup/firstRun.mjs',
            hostEffects  : 'ai/services/fleet/hostEffects.mjs',
            orchestration: 'ai/services/fleet/setupOrchestration.mjs',
            presets      : 'ai/services/fleet/placementPresets.mjs',
            probe        : 'ai/services/fleet/probePlacement.mjs',
            recipe       : 'ai/services/fleet/firstRunRecipe.mjs',
            record       : 'ai/services/fleet/setupRunRecord.mjs'
        })
    });

    test('the roots follow the CLI\'s environment names, with the host state root\'s defaults', () => {
        expect(resolveSetupRoots({env: {}, homeDir: '/Users/op'})).toEqual({setupRoot: '/Users/op/.neo-ai/setup', stateRoot: '/Users/op/.neo-ai'});
        expect(resolveSetupRoots({env: {NEO_HOST_STATE_ROOT: '/srv/state', NEO_HOST_SETUP_RECORD_ROOT: '/srv/records'}, homeDir: '/Users/op'})).toEqual({setupRoot: '/srv/records', stateRoot: '/srv/state'})
    });

    test('every handler refuses an untrusted sender by throwing, a browser boot and a boot without a Brain root by name', async () => {
        const {modules} = fakeModules();

        for (const name of Object.keys(SETUP_CHANNELS)) {
            await expect(createBroker({modules}).broker[name]({sender: 'other'}, {})).rejects.toThrow(`${SETUP_CHANNELS[name]}: untrusted sender`);
            expect((await createBroker({modules, packaged: false}).broker[name](trusted, {})).reason).toMatch(/^not-packaged/);
            expect((await createBroker({loadModules: null}).broker[name](trusted, {})).reason).toMatch(/^no-brain-root/)
        }
    });

    test('evaluate creates the run\'s record once, evaluates over the CLI\'s observers for the state root, and answers the CLI\'s --json shape', async () => {
        const
            {calls, modules, persisted} = fakeModules(),
            {broker, setupRoot, stateRoot} = createBroker({modules});

        const first = await broker.evaluate(trusted, {target: null});

        expect(first.ok).toBe(true);
        expect(first.evaluation).toMatchObject({binding: 'bound', recipeVersion: 1});
        expect(first.evaluation.steps[0]).toEqual({id: 'placement', status: 'ok'});
        expect(first.evaluation.runId).toMatch(/^[0-9a-f-]{36}$/);
        expect(first.evaluation.recordPath).toBe(path.join(setupRoot, `${first.evaluation.runId}.json`));
        expect(persisted.length, 'the record is persisted at creation').toBe(1);
        expect(calls[0][1].target).toEqual({});

        const second = await broker.evaluate(trusted, {target: {planeId: 'outside-plane'}});

        expect(second.evaluation.runId, 'one run per boot').toBe(first.evaluation.runId);
        expect(calls[1][1].target, 'a named target field joins the record\'s bound target').toEqual({planeId: 'outside-plane'});
        expect(modules.cli.hostLayout({stateRoot}).envFile).toBe(path.join(stateRoot, 'config', 'local-agent-os.env'))
    });

    test('a later boot resumes the newest record under the setup root instead of starting another run', async () => {
        const
            {modules}          = fakeModules(),
            {broker, setupRoot} = createBroker({modules}),
            first              = await broker.evaluate(trusted, {}),
            again              = createBroker({modules, setupRoot}).broker;

        expect((await again.evaluate(trusted, {})).evaluation.runId).toBe(first.evaluation.runId)
    });

    test('answer records a preset consent and re-evaluates; a non-question, an empty answer, an unknown preset and a pasted credential value are refused and never recorded', async () => {
        const
            {calls, modules}   = fakeModules(),
            {broker, setupRoot} = createBroker({modules});

        await broker.evaluate(trusted, {});

        const consented = await broker.answer(trusted, {stepId: 'preset', answer: 'hosted'});

        expect(consented.ok).toBe(true);
        expect(calls.at(-1), 'the re-evaluation sees the consent').toEqual(['evaluateRecipe', {target: {}, consents: ['preset']}]);

        expect(await broker.answer(trusted, {stepId: 'placement', answer: 'x'})).toEqual({ok: false, reason: '\'placement\' is not a question of this recipe', stepId: 'placement'});
        expect(await broker.answer(trusted, {stepId: 'preset', answer: ''})).toEqual({ok: false, reason: 'an answer is a non-empty string', stepId: 'preset'});
        expect(await broker.answer(trusted, {stepId: 'preset', answer: 'nope'})).toEqual({ok: false, reason: '\'nope\' is not a preset', stepId: 'preset'});

        // the credential route is main's window only: a pasted value AND a renderer-supplied path
        // of a real readable file are refused before any admission, and nothing is written
        const readable = path.join(setupRoot, 'outside-input');

        writeFileSync(readable, 'ghp_pastedTokenNeverReal');

        for (const answer of ['ghp_pastedTokenNeverReal', readable]) {
            expect(await broker.answer(trusted, {stepId: 'plane-credential', answer})).toEqual({ok: false, reason: '\'plane-credential\' is a credential question: it is answered in main\'s window, never with a path from the renderer', stepId: 'plane-credential'})
        }

        const record = JSON.parse(readFileSync(path.join(setupRoot, `${consented.evaluation.runId}.json`), 'utf8'));

        expect(record.consents.map(row => row.stepId), 'only the preset reached the record').toEqual(['preset']);
        expect(JSON.stringify(record)).not.toContain('ghp_');
        expect(JSON.stringify(record)).not.toContain('outside-input')
    });

    test('the run owner serializes its record operations: two answers landing together both reach the record, a cold evaluate and an answer resolve one run, and a rejected operation leaves the chain usable', async () => {
        const
            {calls, modules}   = fakeModules(),
            {broker, setupRoot} = createBroker({modules});

        // a slow persistence: the first consent's write is still in flight when the second answer lands
        const
            original = modules.hostEffects.recordConsent,
            gate     = [];

        modules.hostEffects.recordConsent = async options => {
            await new Promise(resolve => gate.push(resolve));

            return original(options)
        };

        // cold: the evaluate and the answer start together — one run, both operations on it
        const [first, second] = await (async () => {
            const pending = [broker.evaluate(trusted, {}), broker.answer(trusted, {stepId: 'preset', answer: 'hosted'}), broker.answer(trusted, {stepId: 'advanced', answer: 'unfolded'})];

            // release the consents in arrival order once both are queued
            await new Promise(resolve => setTimeout(resolve, 10));
            while (gate.length) gate.shift()();
            await new Promise(resolve => setTimeout(resolve, 10));
            while (gate.length) gate.shift()();

            return Promise.all(pending)
        })();

        expect(first.ok && second.ok).toBe(true);

        const record = JSON.parse(readFileSync(path.join(setupRoot, `${first.evaluation.runId}.json`), 'utf8'));

        expect(record.consents.map(row => `${row.stepId}=${row.answer}`), 'both consents survive').toEqual(['preset=hosted', 'advanced=unfolded']);
        expect(new Set(calls.filter(([name]) => name === 'evaluateRecipe').map(([, {consents}]) => consents.length)).size, 'each evaluation saw its own prefix of the consents').toBeGreaterThan(1);

        // a rejected operation surfaces to its caller and the next one still runs
        modules.hostEffects.recordConsent = async () => { throw new Error('disk full') };

        expect((await broker.answer(trusted, {stepId: 'preset', answer: 'local-small'})).reason).toBe('the consent was not recorded: disk full');

        modules.hostEffects.recordConsent = original;

        expect((await broker.answer(trusted, {stepId: 'preset', answer: 'local-small'})).ok).toBe(true)
    });

    test('credential: main\'s window supplies the value, the broker keeps it as an owner-only file under the setup root and records the PATH; cancel refuses by name; a non-credential step is refused', async () => {
        const
            prompts            = [],
            {modules}          = fakeModules(),
            {broker, setupRoot} = createBroker({modules, prompt: async ({method}) => { prompts.push(method); return prompts.length === 1 ? null : 'ghp_fixtureValueNeverReal' }});

        await broker.evaluate(trusted, {});

        expect(await broker.credential(trusted, {stepId: 'preset'})).toEqual({ok: false, reason: '\'preset\' is not a credential question of this recipe', stepId: 'preset'});
        expect(await broker.credential(trusted, {stepId: 'plane-credential'})).toEqual({ok: false, reason: 'canceled', stepId: 'plane-credential'});

        const kept = await broker.credential(trusted, {stepId: 'plane-credential'});

        expect(prompts).toEqual(['setup-credential', 'setup-credential']);
        expect(kept.ok).toBe(true);
        expect(kept.path).toBe(path.join(setupRoot, 'credentials', 'plane-credential'));
        expect(statSync(kept.path).mode & 0o777, 'owner-only').toBe(0o600);
        expect(readFileSync(kept.path, 'utf8')).toBe('ghp_fixtureValueNeverReal');
        expect(JSON.stringify(kept.evaluation), 'the reply carries the path, never the value').not.toContain('ghp_');

        const record = JSON.parse(readFileSync(path.join(setupRoot, `${kept.evaluation.runId}.json`), 'utf8'));

        expect(record.consents).toEqual([{stepId: 'plane-credential', answer: kept.path, consentedAt: '2026-10-02T10:00:00.000Z'}])
    });

    test('two credential windows answered together: the second value is not written until the first consent is accepted, and each consent refers to its own value', async () => {
        const
            values             = ['ghp_firstValueNeverReal', 'ghp_secondValueNeverReal'],
            seenAtConsent      = [],
            gate               = [],
            {modules}          = fakeModules(),
            original           = modules.hostEffects.recordConsent,
            {broker, setupRoot} = createBroker({modules, prompt: async () => values.shift()}),
            filePath           = path.join(setupRoot, 'credentials', 'plane-credential');

        // the consent's persistence pauses until the test releases it, and records what the
        // referenced file holds at that moment
        modules.hostEffects.recordConsent = async options => {
            seenAtConsent.push(readFileSync(options.answer, 'utf8'));
            await new Promise(resolve => gate.push(resolve));

            return original(options)
        };

        await broker.evaluate(trusted, {});

        const
            first  = broker.credential(trusted, {stepId: 'plane-credential'}),
            second = broker.credential(trusted, {stepId: 'plane-credential'});

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(readFileSync(filePath, 'utf8'), 'the second window\'s value waits behind the first consent').toBe('ghp_firstValueNeverReal');
        expect(gate.length, 'one consent in flight').toBe(1);

        gate.shift()();
        await first;
        await new Promise(resolve => setTimeout(resolve, 20));
        gate.shift()();
        await second;

        expect(seenAtConsent, 'each consent was accepted over its own value').toEqual(values.length === 0 ? ['ghp_firstValueNeverReal', 'ghp_secondValueNeverReal'] : seenAtConsent);
        expect(readFileSync(filePath, 'utf8')).toBe('ghp_secondValueNeverReal');

        modules.hostEffects.recordConsent = original
    });

    test('a credential answered for one run never lands in another: a window opened for target A is refused once a second window re-targets the run to B; the same target stays A', async () => {
        const
            gate      = [],
            {modules} = fakeModules(),
            {broker, setupRoot} = createBroker({modules, prompt: () => new Promise(resolve => gate.push(resolve))}),
            targetA   = {planeId: 'plane-a', dataRoot: '/srv/a', endpoint: 'http://127.0.0.1:3102'},
            targetB   = {planeId: 'plane-b', dataRoot: '/srv/b', endpoint: 'http://127.0.0.1:3102'};

        const first = await broker.evaluate(trusted, {target: targetA});

        expect(first.evaluation.target).toEqual(targetA);

        // the window opens for A and is held; a second trusted window re-targets the run to B
        const held = broker.credential(trusted, {stepId: 'plane-credential'});

        await new Promise(resolve => setTimeout(resolve, 10));
        expect(gate.length, 'the window is open').toBe(1);

        const retargeted = await broker.evaluate(trusted, {target: targetB});

        expect(retargeted.evaluation.target).toEqual(targetB);

        // the held window answers: refused, nothing written, nothing recorded
        gate.shift()('ghp_answeredForA');

        expect(await held).toEqual({ok: false, reason: 'the run was re-targeted while the window was open: nothing kept', stepId: 'plane-credential'});
        expect(existsSync(path.join(setupRoot, 'credentials', 'plane-credential')), 'no file for the refused value').toBe(false);

        const record = JSON.parse(readFileSync(path.join(setupRoot, `${first.evaluation.runId}.json`), 'utf8'));

        expect(record.target).toEqual(targetB);
        expect(record.consents).toEqual([]);

        // the same-target control: a window opened for B, an evaluate for B meanwhile, the answer lands
        const heldSame = broker.credential(trusted, {stepId: 'plane-credential'});

        await new Promise(resolve => setTimeout(resolve, 10));
        await broker.evaluate(trusted, {target: targetB});
        gate.shift()('ghp_answeredForB');

        const kept = await heldSame;

        expect(kept.ok).toBe(true);
        expect(JSON.parse(readFileSync(path.join(setupRoot, `${first.evaluation.runId}.json`), 'utf8')).consents.map(row => row.stepId)).toEqual(['plane-credential']);
        expect(readFileSync(kept.path, 'utf8')).toBe('ghp_answeredForB')
    });

    test('effect runs the one consented effect through the shared orchestration, serialized, and answers the re-evaluated run; an unknown effect and a boot without a config source are refused by name', async () => {
        const
            {calls, modules} = fakeModules(),
            {broker}         = createBroker({modules});

        await broker.evaluate(trusted, {});

        expect(await broker.effect(trusted, {effectId: 'nope'})).toEqual({ok: false, reason: '\'nope\' is not an effect of this recipe', effectId: 'nope'});
        expect((await createBroker({modules, configSourcePath: null}).broker.effect(trusted, {effectId: 'write-env'})).reason).toMatch(/^no-brain-root/);

        const reply = await broker.effect(trusted, {effectId: 'write-env'});

        expect(reply.ok).toBe(true);
        expect(reply.evaluation.steps.find(step => step.id === 'write-env')).toMatchObject({status: 'ok', receipt: 'accepted'});
        expect(reply.evaluation.steps.find(step => step.id === 'compose-up')).toMatchObject({status: 'pending'});
        expect(calls.filter(([name]) => name === 'performEffects')).toEqual([['performEffects', {effectIds: ['write-env'], configSourcePath: '/runtime/ai/configBase.mjs', hasEvaluation: true}]]);
        expect(calls.filter(([name]) => name === 'settlePending'), 'nothing to settle: no settle pass ran').toEqual([]);
        expect(SETUP_MODULE_PATHS.orchestration).toBe('ai/services/fleet/setupOrchestration.mjs');
        expect(CONFIG_SOURCE_PATH).toBe('ai/configBase.mjs')
    });

    test('a refused effect answers in the orchestration\'s words and writes nothing', async () => {
        const
            {calls, modules}   = fakeModules(),
            {broker, setupRoot} = createBroker({modules});

        const first = await broker.evaluate(trusted, {});

        modules.presets.presets.push({id: 'refuse-me'});
        await broker.answer(trusted, {stepId: 'preset', answer: 'refuse-me'});

        expect(await broker.effect(trusted, {effectId: 'write-secrets'})).toEqual({ok: false, reason: 'the preset \'refuse-me\' declares an env key the profile does not consume', effectId: 'write-secrets'});

        const record = JSON.parse(readFileSync(path.join(setupRoot, `${first.evaluation.runId}.json`), 'utf8'));

        expect(record.receipts).toEqual([]);
        expect(calls.filter(([name]) => name === 'performEffects').length).toBe(1)
    });

    test('re-check: an interrupted effect settles through the shared pass before the run is read, on evaluate', async () => {
        const
            {calls, modules}   = fakeModules(),
            {broker, setupRoot} = createBroker({modules});

        const first = await broker.evaluate(trusted, {});

        // an effect interrupted before its receipt was written: the record holds a pending receipt
        const recordPath = path.join(setupRoot, `${first.evaluation.runId}.json`);

        writeFileSync(recordPath, JSON.stringify({...JSON.parse(readFileSync(recordPath, 'utf8')), receipts: [{effectId: 'write-env', outcome: 'pending'}]}));

        // a fresh broker resumes the record (the shell was restarted mid-effect)
        const again = createBroker({modules, setupRoot}).broker;
        const reply = await again.evaluate(trusted, {});

        expect(calls.filter(([name]) => name === 'settlePending')).toEqual([['settlePending', {reconcile: ['write-env']}]]);
        expect(reply.evaluation.steps.find(step => step.id === 'write-env')).toMatchObject({status: 'ok', receipt: 'accepted'})
    });

    test('probe and presets answer the Brain modules\' own tables', async () => {
        const
            {modules} = fakeModules(),
            {broker}  = createBroker({modules});

        expect(await broker.presets(trusted)).toEqual({ok: true, presets: [{id: 'hosted'}, {id: 'local-small'}]});
        expect(await broker.probe(trusted)).toEqual({ok: true, probe: {target: {kind: 'local'}, host: {totalBytes: 1}, runningPlane: null}})
    });

    test('a record from another recipe version retires its proof the way the CLI does, and the evaluation says so', async () => {
        const
            {modules}          = fakeModules(),
            {broker, setupRoot} = createBroker({modules});

        const first = await broker.evaluate(trusted, {});

        modules.recipe.RECIPE_VERSION = 2;

        const again = createBroker({modules, setupRoot}).broker;

        await again.evaluate(trusted, {});

        const record = JSON.parse(readFileSync(path.join(setupRoot, `${first.evaluation.runId}.json`), 'utf8'));

        expect(record.retired).toBe('version-changed')
    })
});

const TARGET = {planeId: 'plane-a', dataRoot: '/srv/plane-a', endpoint: 'http://127.0.0.1:3102'};

/**
 * A temp layout's filesystem with the record writes and the secret-file writes counted. The Brain's
 * writer lands every file through a rename, so a rename onto a record is one record write and a
 * rename into the secrets directory is the `write-secrets` handler at work. `failRecordWrite` names
 * the record write (1-based, since `recordWrites` was last reset) that rejects.
 */
function countingDisk({setupRoot, stateRoot}) {
    const
        secretsDir = path.join(stateRoot, 'secrets'),
        disk       = {
            failRecordWrite: null,
            recordWrites   : 0,
            secretWrites   : [],
            handlerRuns    : () => disk.secretWrites.filter(name => name === disk.secretWrites[0]).length,
            fsModule       : {
                ...fsPromises,
                rename: async (from, to) => {
                    if (path.dirname(to) === setupRoot && to.endsWith('.json') && ++disk.recordWrites === disk.failRecordWrite) {
                        throw Object.assign(new Error('EIO: i/o error, rename'), {code: 'EIO'})
                    }

                    path.dirname(to) === secretsDir && disk.secretWrites.push(path.basename(to));

                    return fsPromises.rename(from, to)
                }
            }
        };

    return disk
}

/**
 * The broker over the pinned Brain's own recipe, record, host-effect and orchestration modules: the
 * replay guard these arms read is theirs, never a double's. Only the host is scripted — what each
 * observer reports (`observed`, read at every evaluation) and the counting disk.
 */
async function brainBacked({setupRoot = tempDir(), stateRoot = tempDir(), disk = countingDisk({setupRoot, stateRoot}), observed = {}} = {}) {
    const
        real      = await loadSetupModules({runtimeRoot: BRAIN_ROOT}),
        observers = {
            envCarrier  : async () => observed.envCarrier   ?? {present: false, reason: 'not performed'},
            runningPlane: async () => observed.runningPlane ?? {present: false, reason: 'the compose project is not running'},
            secretFiles : async () => observed.secretFiles  ?? {present: false, reason: 'no secret files observed'},
            servedPlane : async () => observed.servedPlane  ?? {id: 'another-plane', dataRoot: '/srv/another'}
        },
        modules   = {...real, cli: {...real.cli, productionObservers: () => observers}},
        {broker}  = createBroker({modules, setupRoot, stateRoot, fsModule: disk.fsModule, configSourcePath: path.join(BRAIN_ROOT, CONFIG_SOURCE_PATH), prompt: async () => 'ghp_fixtureValueNeverReal0123456789abcdefgh'});

    return {broker, disk, observed, setupRoot, stateRoot}
}

/**
 * Binds the run to {@link TARGET} and consents to the preset and the plane credential.
 * @returns {Promise<String>} The run's record path
 */
async function consented({broker}) {
    const first = await broker.evaluate(trusted, {target: TARGET});

    expect((await broker.answer(trusted, {stepId: 'preset', answer: 'local-small'})).ok).toBe(true);
    expect((await broker.credential(trusted, {stepId: 'plane-credential'})).ok).toBe(true);

    return first.evaluation.recordPath
}

/**
 * Runs `write-secrets` with the record write that would acknowledge it rejected: the handler ran,
 * the record on disk holds the pending receipt.
 */
async function interruptedAfterTheHandler({broker, disk}) {
    disk.recordWrites    = 0;
    disk.failRecordWrite = 2;

    const reply = await broker.effect(trusted, {effectId: 'write-secrets'});

    disk.failRecordWrite = null;

    return reply
}

const receiptsOnDisk = recordPath => JSON.parse(readFileSync(recordPath, 'utf8')).receipts.map(receipt => [receipt.effectId, receipt.outcome]);

test.describe('harness/setupBroker over the Brain\'s own modules — every operation starts from the record on disk', () => {
    test('an effect whose acknowledgement write was rejected is never replayed: the same broker reads the pending receipt back, and so does a fresh one', async () => {
        const
            run            = await brainBacked(),
            {broker, disk} = run,
            recordPath     = await consented(run);

        expect(await interruptedAfterTheHandler(run)).toEqual({ok: false, reason: 'write-secrets could not run: EIO: i/o error, rename', effectId: 'write-secrets'});
        expect(disk.handlerRuns(), 'the handler ran once').toBe(1);
        expect(receiptsOnDisk(recordPath), 'the record holds the pending receipt').toEqual([['write-secrets', 'pending']]);

        // the same broker asks again: the effect settles only by its own observation, no secret file
        // shows here, so the orchestration halts behind the unsettled row and says why
        const again = await broker.effect(trusted, {effectId: 'write-secrets'});

        expect(disk.handlerRuns(), 'never replayed by the same broker').toBe(1);
        expect(again).toEqual({ok: false, reason: "'write-secrets' was interrupted and is not settled, so nothing runs past it: no secret files observed", effectId: 'write-secrets'});
        expect(receiptsOnDisk(recordPath)).toEqual([['write-secrets', 'reconcile-required']]);

        // the shell restarted: a fresh broker over the same roots
        const restarted = await brainBacked({setupRoot: run.setupRoot, stateRoot: run.stateRoot, disk});

        await restarted.broker.effect(trusted, {effectId: 'write-secrets'});

        expect(disk.handlerRuns(), 'never replayed by a fresh broker').toBe(1);
        expect(receiptsOnDisk(recordPath)).toEqual([['write-secrets', 'reconcile-required']])
    });

    test('a consent recorded after a rejected acknowledgement write is added to the record on disk: the pending receipt stays', async () => {
        const
            run            = await brainBacked(),
            {broker, disk} = run,
            recordPath     = await consented(run);

        await interruptedAfterTheHandler(run);

        expect((await broker.answer(trusted, {stepId: 'advanced', answer: 'unfolded'})).ok).toBe(true);

        const record = JSON.parse(readFileSync(recordPath, 'utf8'));

        expect(record.consents.map(row => row.stepId)).toEqual(['preset', 'plane-credential', 'advanced']);
        expect(receiptsOnDisk(recordPath), 'the consent did not overwrite the guard').toEqual([['write-secrets', 'pending']]);

        await broker.effect(trusted, {effectId: 'write-secrets'});

        expect(disk.handlerRuns(), 'and the effect is still never replayed').toBe(1)
    });

    test('control: an effect whose record writes land is acknowledged, and once the host shows its result it never runs again', async () => {
        const
            run                      = await brainBacked(),
            {broker, disk, observed} = run,
            recordPath               = await consented(run);

        expect((await broker.effect(trusted, {effectId: 'write-secrets'})).ok).toBe(true);
        expect(disk.handlerRuns()).toBe(1);
        expect(receiptsOnDisk(recordPath)).toEqual([['write-secrets', 'accepted']]);

        observed.secretFiles = {present: true, digest: null, problem: null};

        const again = await broker.effect(trusted, {effectId: 'write-secrets'});

        expect(again.evaluation.steps.find(step => step.id === 'write-secrets')).toMatchObject({status: 'ok', receipt: 'accepted'});
        expect(disk.handlerRuns(), 'no second run').toBe(1)
    });

    test('a bound record that cannot be read refuses every record operation and is left as it is: no effect, no consent, no fresh run in its place', async () => {
        const
            run            = await brainBacked(),
            {broker, disk} = run,
            recordPath     = await consented(run),
            refusals       = async () => [
                (await broker.effect(trusted, {effectId: 'write-secrets'})).reason,
                (await broker.answer(trusted, {stepId: 'advanced', answer: 'unfolded'})).reason,
                (await broker.evaluate(trusted, {})).reason
            ];

        writeFileSync(recordPath, '{not json');

        expect(await refusals()).toEqual([
            expect.stringMatching(/^write-secrets could not run: the run's record could not be read \(malformed: /),
            expect.stringMatching(/^the consent was not recorded: the run's record could not be read \(malformed: /),
            expect.stringMatching(/^the recipe could not be evaluated: the run's record could not be read \(malformed: /)
        ]);
        expect(readFileSync(recordPath, 'utf8'), 'the damaged record is not overwritten').toBe('{not json');

        rmSync(recordPath);

        expect(await refusals()).toEqual([
            'write-secrets could not run: the run\'s record could not be read (absent): nothing runs over an unread record',
            'the consent was not recorded: the run\'s record could not be read (absent): nothing runs over an unread record',
            'the recipe could not be evaluated: the run\'s record could not be read (absent): nothing runs over an unread record'
        ]);
        expect(disk.handlerRuns(), 'nothing ran').toBe(0);
        expect(readdirSync(run.setupRoot).filter(name => name.endsWith('.json')), 'no fresh run took its place').toEqual([])
    })
});
