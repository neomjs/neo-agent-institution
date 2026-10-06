import {expect, test} from '@playwright/test';
import fs             from 'node:fs';
import {tmpdir}        from 'node:os';
import path            from 'node:path';

import {resolveBrainPaths} from '../../../../harness/brain.mjs';
import {createSeatRootBroker, createSeatRootRuntime, SEAT_ROOT_CHANNELS} from '../../../../harness/seatRootBroker.mjs';
import {consentSeatMove, planSeatMove, readSeatRootMove, SEAT_ROOT_MOVE_FILE} from '../../../../harness/seatRootMove.mjs';
import {SEAT_ROOT_FILE, writeSeatRootRecord} from '../../../../harness/seatRootRecord.mjs';

const
    TRUSTED = Object.freeze({frame: 'trusted shell frame'}),
    NOW     = () => new Date('2026-10-06T14:00:00.000Z');

test.describe.configure({mode: 'serial'});

/**
 * @summary One isolated installation record and its old and proposed roots. The helper removes every
 * file the broker and real seat-root record helpers create, including after a failed assertion.
 * @param {Function} fn
 * @returns {Promise<*>}
 */
async function withInstallation(fn) {
    const
        root    = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'seat-root-broker-'))),
        userData = path.join(root, 'userData'),
        from     = path.join(root, 'previous-agents'),
        to       = path.join(root, 'resolved-agents');

    fs.mkdirSync(from, {recursive: true});
    writeSeatRootRecord({dir: userData, now: NOW, origin: 'adopted', root: from});

    try {
        return await fn({from, root, to, userData})
    } finally {
        fs.rmSync(root, {force: true, recursive: true})
    }
}

/**
 * @summary A planned row for a real folder copy.
 * @param {String} from
 * @param {String} to
 * @param {String} id
 * @returns {Object}
 */
function copyRow(from, to, id='neo-gpt-sophie') {
    return {
        destination : path.join(to, id),
        id,
        materialized: true,
        seatHome    : path.join(from, id),
        state       : 'copy'
    }
}

/**
 * @summary Build a broker with explicit effect spies; tests never launch a Brain or relaunch Electron.
 * @param {Object} options
 * @returns {{broker: Object, calls: Object}}
 */
function makeBroker({dir, packaged=true, trusted=true, getOutcome=() => null, resolveDestination=async () => '/resolved/agents', runStep=async () => ({state: 'planned', rows: []}), relaunch=() => {}}) {
    const calls = {outcome: 0, relaunch: 0, resolveDestination: 0, runStep: []};

    return {
        broker: createSeatRootBroker({
            dir,
            packaged,
            isTrustedSender: event => trusted && event === TRUSTED,
            getOutcome: () => { calls.outcome++; return getOutcome() },
            resolveDestination: resolveDestination && (async () => { calls.resolveDestination++; return resolveDestination() }),
            runStep: step => { calls.runStep.push(step); return runStep(step) },
            relaunch: () => { calls.relaunch++; relaunch() }
        }),
        calls
    }
}

/**
 * @summary Records one consent through the production helper against only the test's temporary roots.
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function recordConsent({from, to, userData, rows=[copyRow(from, to)], runStep=null}) {
    const invoke = runStep ?? (async () => ({state: 'planned', rows})),
          shown  = await planSeatMove({from, to, runStep: invoke});

    return consentSeatMove({dir: userData, fingerprint: shown.fingerprint, newId: () => 'test-move-id', now: NOW, runStep: invoke, to})
}

test.describe('harness/seatRootBroker — installation-scoped consent handlers', () => {
    test('the channel table names the three shell capabilities', () => {
        expect(SEAT_ROOT_CHANNELS).toEqual({
            status : 'shell-seat-root-status',
            plan   : 'shell-seat-root-plan',
            consent: 'shell-seat-root-consent'
        })
    });

    test('untrusted sender is refused before outcome, record, Brain or relaunch work', async () => {
        await withInstallation(async ({root}) => {
            const missingDir = path.join(root, 'must-not-be-read-or-created'),
                  {broker, calls} = makeBroker({dir: missingDir, trusted: false, getOutcome: () => ({state: 'committed'}), runStep: async () => ({state: 'planned', rows: []})});

            await expect(broker.status({})).rejects.toThrow('seat-root: untrusted sender');
            await expect(broker.plan({})).rejects.toThrow('seat-root: untrusted sender');
            await expect(broker.consent({}, {fingerprint: 'a'.repeat(64)})).rejects.toThrow('seat-root: untrusted sender');

            expect(calls).toEqual({outcome: 0, relaunch: 0, resolveDestination: 0, runStep: []});
            expect(fs.existsSync(missingDir)).toBe(false)
        })
    });

    test('not-packaged is a named no-host-capability result with no reads or effects', async () => {
        await withInstallation(async ({root}) => {
            const missingDir = path.join(root, 'not-packaged-userData'),
                  {broker, calls} = makeBroker({dir: missingDir, packaged: false, getOutcome: () => ({state: 'held'}), runStep: async () => ({state: 'planned', rows: []})});

            expect(await broker.status(TRUSTED)).toEqual({packaged: false, root: null, pending: null, outcome: null});
            expect(await broker.plan(TRUSTED)).toEqual({state: 'refused', code: 'not-packaged', reason: 'not-packaged'});
            expect(await broker.consent(TRUSTED, {fingerprint: 'a'.repeat(64)})).toEqual({state: 'refused', code: 'not-packaged', reason: 'not-packaged'});
            expect(calls).toEqual({outcome: 0, relaunch: 0, resolveDestination: 0, runStep: []});
            expect(fs.existsSync(missingDir)).toBe(false)
        })
    });

    test('a packaged shell with no Brain root refuses plan and consent with a named code', async () => {
        await withInstallation(async ({userData}) => {
            const {broker, calls} = makeBroker({dir: userData, resolveDestination: null, runStep: async () => ({state: 'planned', rows: []})});

            expect(await broker.plan(TRUSTED)).toEqual({state: 'refused', code: 'no-brain-root', reason: 'no-brain-root'});
            expect(await broker.consent(TRUSTED, {fingerprint: 'a'.repeat(64)})).toEqual({state: 'refused', code: 'no-brain-root', reason: 'no-brain-root'});
            expect(calls).toEqual({outcome: 0, relaunch: 0, resolveDestination: 0, runStep: []});
            expect(fs.readdirSync(userData)).toEqual([SEAT_ROOT_FILE])
        })
    });

    test('status reports held boot outcome while preserving the other record when one record is corrupt', async () => {
        const held = {state: 'held', reason: 'Fleet boot is held until the seat move settles'};

        await withInstallation(async ({from, to, userData}) => {
            await recordConsent({from, to, userData});
            fs.writeFileSync(path.join(userData, SEAT_ROOT_FILE), '{broken root record');

            const {broker, calls} = makeBroker({dir: userData, getOutcome: () => held});
            const result = await broker.status(TRUSTED);

            expect(result).toMatchObject({
                packaged: true,
                root   : {unreadable: expect.stringContaining('cannot be read')},
                pending: {from, to, rows: [expect.objectContaining({id: 'neo-gpt-sophie'})]},
                outcome: held
            });
            expect(result.pending).not.toHaveProperty('moveId');
            expect(result.pending).not.toHaveProperty('previousRecord');
            expect(calls.outcome).toBe(1)
        });

        await withInstallation(async ({from, userData}) => {
            fs.writeFileSync(path.join(userData, SEAT_ROOT_MOVE_FILE), '{broken pending record');

            const {broker, calls} = makeBroker({dir: userData, getOutcome: () => held});
            const result = await broker.status(TRUSTED);

            expect(result).toMatchObject({
                packaged: true,
                root   : {origin: 'adopted', root: from},
                pending: {unreadable: expect.stringContaining('cannot be read')},
                outcome: held
            });
            expect(calls.outcome).toBe(1)
        })
    });

    test('status strips internal move id and previous root record from a consented DTO', async () => {
        await withInstallation(async ({from, to, userData}) => {
            await recordConsent({from, to, userData});
            const {broker} = makeBroker({dir: userData});
            const result = await broker.status(TRUSTED);

            expect(Object.keys(result.pending).sort()).toEqual(['archive', 'consentedAt', 'from', 'outOfScope', 'rows', 'to']);
            expect(result.pending).toMatchObject({from, to, rows: [expect.objectContaining({id: 'neo-gpt-sophie'})]});
            expect(result.pending).not.toHaveProperty('moveId');
            expect(result.pending).not.toHaveProperty('previousRecord');
            expect(readSeatRootMove({dir: userData})).toMatchObject({moveId: 'test-move-id', previousRecord: {root: from}})
        })
    });

    test('plan returns both roots and every Brain row, including rows outside the move', async () => {
        await withInstallation(async ({from, root, to, userData}) => {
            const rows = [copyRow(from, to), {
                destination : path.join(to, 'neo-opus-ada'),
                id          : 'neo-opus-ada',
                materialized: false,
                reason      : 'bound outside the recorded source',
                seatHome    : path.join(root, 'other-root', 'neo-opus-ada'),
                state       : 'untouched'
            }];
            const {broker, calls} = makeBroker({dir: userData, resolveDestination: async () => to, runStep: async () => ({state: 'planned', rows})});
            const result = await broker.plan(TRUSTED);

            expect(result).toMatchObject({state: 'planned', from, to, rows});
            expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
            expect(calls.runStep).toEqual([{step: 'plan', from, to}])
        })
    });

    test('invalid consent shapes reject before resolution or any file write', async () => {
        await withInstallation(async ({root}) => {
            const missingDir = path.join(root, 'consent-not-run'),
                  {broker, calls} = makeBroker({dir: missingDir});

            await expect(broker.consent(TRUSTED, {fingerprint: 'a'.repeat(64), moveId: 'renderer-chosen'})).rejects.toThrow(TypeError);
            await expect(broker.consent(TRUSTED, {fingerprint: 'not-a-sha256'})).rejects.toThrow(TypeError);
            expect(calls).toEqual({outcome: 0, relaunch: 0, resolveDestination: 0, runStep: []});
            expect(fs.existsSync(missingDir)).toBe(false)
        })
    });

    test('a changed fresh plan refuses without writing consent or relaunching', async () => {
        await withInstallation(async ({from, to, userData}) => {
            let rows = [copyRow(from, to)];
            const {broker, calls} = makeBroker({dir: userData, resolveDestination: async () => to, runStep: async () => ({state: 'planned', rows})});
            const shown = await broker.plan(TRUSTED);

            rows = [...rows, {...copyRow(from, to, 'neo-opus-ada'), state: 'relocate'}];
            const result = await broker.consent(TRUSTED, {fingerprint: shown.fingerprint});

            expect(result).toMatchObject({state: 'refused', reason: 'the seats changed since the plan was shown; review it again'});
            expect(calls.runStep).toEqual([{step: 'plan', from, to}, {step: 'plan', from, to}]);
            expect(calls.relaunch).toBe(0);
            expect(readSeatRootMove({dir: userData})).toBeNull();
            expect(fs.readdirSync(userData)).toEqual([SEAT_ROOT_FILE])
        })
    });

    test('concurrent consent persists one transition and relaunches once', async () => {
        await withInstallation(async ({from, to, userData}) => {
            let planCount = 0,
                releaseFirstConsentPlan,
                firstConsentPlanEntered;
            const firstConsentPlan = new Promise(resolve => { firstConsentPlanEntered = resolve }),
                  firstPlanGate     = new Promise(resolve => { releaseFirstConsentPlan = resolve }),
                  rows              = [copyRow(from, to)],
                  runStep           = async ({step, ...args}) => {
                      expect(step).toBe('plan');
                      planCount++;
                      if (planCount === 2) {
                          firstConsentPlanEntered();
                          await firstPlanGate
                      }
                      return {state: 'planned', rows}
                  },
                  {broker, calls} = makeBroker({dir: userData, resolveDestination: async () => to, runStep});
            const shown = await broker.plan(TRUSTED);

            const first = broker.consent(TRUSTED, {fingerprint: shown.fingerprint});
            await firstConsentPlan;
            const second = broker.consent(TRUSTED, {fingerprint: shown.fingerprint});

            releaseFirstConsentPlan();

            const [accepted, refused] = await Promise.all([first, second]);

            expect(accepted).toEqual({state: 'consented'});
            expect(refused).toMatchObject({state: 'refused', reason: 'a move of the seats is already consented'});
            expect(planCount).toBe(2); // displayed plan + one fresh consent plan; queued consent sees persisted inputs
            expect(calls.relaunch).toBe(1);
            const persisted = readSeatRootMove({dir: userData});

            expect(persisted).toMatchObject({from, to});
            expect(persisted.moveId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(fs.readdirSync(userData).sort()).toEqual([SEAT_ROOT_MOVE_FILE, SEAT_ROOT_FILE])
        })
    });

    test('a plan that would move no seat refuses without a write or relaunch', async () => {
        await withInstallation(async ({from, to, userData}) => {
            const rows = [{
                destination : path.join(to, 'neo-gpt-sophie'),
                id          : 'neo-gpt-sophie',
                materialized: false,
                seatHome    : path.join(to, 'neo-gpt-sophie'),
                state       : 'done'
            }];
            const {broker, calls} = makeBroker({dir: userData, resolveDestination: async () => to, runStep: async () => ({state: 'planned', rows})});
            const shown = await broker.plan(TRUSTED);
            const result = await broker.consent(TRUSTED, {fingerprint: shown.fingerprint});

            expect(result).toEqual({state: 'refused', code: 'nothing-to-move', reason: 'no seat would move'});
            expect(calls.relaunch).toBe(0);
            expect(readSeatRootMove({dir: userData})).toBeNull();
            expect(fs.readdirSync(userData)).toEqual([SEAT_ROOT_FILE])
        })
    });

    test('the packaged runtime uses the Brain-resolved root and scopes every move step to that Brain', async () => {
        await withInstallation(async ({from, root, to, userData}) => {
            const
                repoRoot = path.join(root, 'packaged-brain'),
                resolved = path.join(repoRoot, 'registry-resolved', 'agents'),
                inheritedAgentsRoot = path.join(root, 'inherited-agents'),
                parentEnvKey = 'NEO_HARNESS_SEAT_ROOT_PARENT_ENV',
                previous = {
                    agentsRoot: process.env.NEO_FLEET_AGENTS_ROOT,
                    parentEnv : process.env[parentEnvKey]
                };
            let resolverCall, stepCall;

            process.env.NEO_FLEET_AGENTS_ROOT = inheritedAgentsRoot;
            process.env[parentEnvKey] = 'kept-by-parent';

            try {
                const runtime = createSeatRootRuntime({
                    repoRoot,
                    userData,
                    execPath: '/packaged/Electron',
                    resolvePaths: options => resolveBrainPaths({
                        ...options,
                        execFileFn: (file, args, childOptions, callback) => {
                            resolverCall = {args, childOptions, file};
                            queueMicrotask(() => callback(null, JSON.stringify({fleetAgentsRoot: resolved}), ''))
                        }
                    }),
                    runScript: async options => { stepCall = options; return {step: 'bindings', rows: []} }
                });

                expect(await runtime.resolveDestination()).toBe(resolved);
                expect(resolverCall.childOptions.cwd).toBe(repoRoot);
                expect(resolverCall.childOptions.env.NEO_FLEET_AGENTS_ROOT).toBe('');
                expect(resolverCall.childOptions.env[parentEnvKey]).toBe('kept-by-parent');
                expect(resolverCall.childOptions.env.PATH).toBe(process.env.PATH);
                expect(process.env.NEO_FLEET_AGENTS_ROOT).toBe(inheritedAgentsRoot);
                expect(process.env[parentEnvKey]).toBe('kept-by-parent');

                await expect(runtime.runStep({from, moveId: 'move-1', rows: [{id: 'neo-gpt-sophie'}], step: 'bindings', to})).resolves.toEqual({step: 'bindings', rows: []});
                expect(stepCall).toMatchObject({label: 'seat move bindings', repoRoot});
                expect(stepCall.env).toMatchObject({
                    ELECTRON_RUN_AS_NODE                  : '1',
                    NEO_FLEET_AGENTS_ROOT                 : '',
                    NEO_HARNESS_ELECTRON_BIN              : '/packaged/Electron',
                    NEO_HARNESS_SEAT_MOVE_FROM            : from,
                    NEO_HARNESS_SEAT_MOVE_ID              : 'move-1',
                    NEO_HARNESS_SEAT_MOVE_STEP            : 'bindings',
                    NEO_HARNESS_SEAT_MOVE_TO              : to,
                    NEO_PLANE_DATA_ROOT                   : path.join(userData, 'brain'),
                    NEO_HARNESS_SEAT_MOVE_ROWS            : JSON.stringify([{id: 'neo-gpt-sophie'}])
                });
                expect(stepCall.script).toContain('FleetRegistryService.listAgents()')
            } finally {
                previous.agentsRoot === undefined ? delete process.env.NEO_FLEET_AGENTS_ROOT : process.env.NEO_FLEET_AGENTS_ROOT = previous.agentsRoot;
                previous.parentEnv === undefined ? delete process.env[parentEnvKey] : process.env[parentEnvKey] = previous.parentEnv
            }
        })
    });

    test('record and resolver failures reject plan and consent rather than becoming refusal DTOs', async () => {
        await withInstallation(async ({root, userData}) => {
            const badRecordBroker = makeBroker({dir: userData, resolveDestination: async () => path.join(root, 'to')}).broker;

            fs.writeFileSync(path.join(userData, SEAT_ROOT_FILE), '{corrupt');
            await expect(badRecordBroker.plan(TRUSTED)).rejects.toThrow(/cannot be read/);
            await expect(badRecordBroker.consent(TRUSTED, {fingerprint: 'a'.repeat(64)})).rejects.toThrow(/cannot be read/);
            expect(fs.readdirSync(userData)).toEqual([SEAT_ROOT_FILE]);

            writeSeatRootRecord({dir: userData, now: NOW, origin: 'adopted', root: path.join(root, 'previous-agents')});
            const resolverFailure = makeBroker({dir: userData, resolveDestination: async () => { throw new Error('resolver unavailable') }}).broker;

            await expect(resolverFailure.plan(TRUSTED)).rejects.toThrow('resolver unavailable');
            await expect(resolverFailure.consent(TRUSTED, {fingerprint: 'a'.repeat(64)})).rejects.toThrow('resolver unavailable');
            expect(readSeatRootMove({dir: userData})).toBeNull()
        })
    })
});
