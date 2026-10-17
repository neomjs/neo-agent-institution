import {expect, test}                                                       from '@playwright/test';
import fs                                                                   from 'node:fs';
import {tmpdir}                                                             from 'node:os';
import path                                                                 from 'node:path';
import {runBrainScript}                                                     from '../../../../harness/brain.mjs';
import {consentSeatMove, planSeatMove, runSeatMoveStep, settleSeatRootMove} from '../../../../harness/seatRootMove.mjs';
import {readSeatRootRecord, writeSeatRootRecord}                            from '../../../../harness/seatRootRecord.mjs';

/**
 * @summary The shell's seat move composed with a real Brain root: the one-shot the shell runs, the Brain's
 * `moveSeatHomes` and its registry, on temp roots. Live arm: it needs `NEO_AGENTOS_RUNTIME_ROOT`, a Brain
 * root with installed dependencies.
 */

const runtimeRoot = process.env.NEO_AGENTOS_RUNTIME_ROOT;

test.skip(!runtimeRoot, 'needs NEO_AGENTOS_RUNTIME_ROOT: a Brain root with installed dependencies');

test.describe.configure({mode: 'serial'});

let root, userData, dataDir, from, to;

test.beforeEach(() => {
    root     = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'seat-move-contract-')));
    userData = path.join(root, 'userData');
    dataDir  = path.join(root, 'fleet');
    from     = path.join(userData, 'brain', 'fleet', 'agents');
    to       = path.join(root, 'neo-ai', 'agents');

    // a Fleet-provisioned seat, one never started, and one bound outside the old root
    fs.mkdirSync(path.join(from, 'neo-gpt-sophie', 'harness', 'codex-desktop', 'codex-home'), {recursive: true});
    fs.writeFileSync(path.join(from, 'neo-gpt-sophie', 'harness', 'codex-desktop', 'codex-home', 'config.toml'), '# sophie\n');
    fs.mkdirSync(dataDir, {recursive: true});
    fs.writeFileSync(path.join(dataDir, 'registry.json'), JSON.stringify({agents: {
        'neo-gpt-sophie': {id: 'neo-gpt-sophie', githubUsername: 'neo-gpt-sophie', harnessType: 'codex-desktop', seatHome: path.join(from, 'neo-gpt-sophie')},
        'neo-opus-ada'  : {id: 'neo-opus-ada', githubUsername: 'neo-opus-ada', harnessType: 'claude-desktop', seatHome: path.join(from, 'neo-opus-ada')},
        carol           : {id: 'carol', githubUsername: 'carol', harnessType: 'codex', seatHome: '/elsewhere/carol'}
    }}));
    writeSeatRootRecord({dir: userData, root: from, origin: 'adopted'})
});

test.afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
});

/**
 * @summary A step as the shell runs it: the one-shot in the Brain root, over this installation's registry.
 */
const runStep = step => runSeatMoveStep({
    ...step,
    runScript: ({env, ...script}) => runBrainScript({...script, repoRoot: runtimeRoot, env: {...env, NEO_FLEET_DATA_DIR: dataDir}})
});

const bindings = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8')).agents;

test('the real Brain plans every row, and a consented move commits at boot', async () => {
    const plan = await planSeatMove({from, to, runStep});

    expect(plan.state).toBe('planned');
    expect(plan.rows.map(row => [row.id, row.state, row.materialized])).toEqual([
        ['neo-gpt-sophie', 'copy', true],
        ['neo-opus-ada', 'rebind', false],
        ['carol', 'untouched', false]
    ]);

    expect((await consentSeatMove({dir: userData, to, fingerprint: plan.fingerprint, runStep})).state).toBe('consented');

    const outcome = await settleSeatRootMove({dir: userData, checkWriter: async () => ({exclusive: true}), runStep});

    expect(outcome).toEqual({state: 'committed', retirement: {state: 'retired', archived: ['neo-gpt-sophie']}});
    expect(readSeatRootRecord({dir: userData})).toMatchObject({origin: 'moved', root: to});
    expect(bindings()['neo-gpt-sophie']).toMatchObject({seatHome: path.join(to, 'neo-gpt-sophie'), previousSeatHome: path.join(from, 'neo-gpt-sophie')});
    expect(bindings()['neo-opus-ada'].seatHome).toBe(path.join(to, 'neo-opus-ada'));
    expect(bindings().carol.seatHome).toBe('/elsewhere/carol');
    expect(fs.readFileSync(path.join(to, 'neo-gpt-sophie', 'harness', 'codex-desktop', 'codex-home', 'config.toml'), 'utf8')).toBe('# sophie\n')
});

test('the real Brain restores the old bindings of a move that cannot commit', async () => {
    const plan = await planSeatMove({from, to, runStep});

    await consentSeatMove({dir: userData, to, fingerprint: plan.fingerprint, runStep});

    // the registry reads back off its destination: the shell must bring every binding back
    const offTrack = step => step.step === 'bindings' ? Promise.resolve([]) : runStep(step);

    expect((await settleSeatRootMove({dir: userData, checkWriter: async () => ({exclusive: true}), runStep: offTrack})).state).toBe('refused');
    expect(bindings()['neo-gpt-sophie'].seatHome).toBe(path.join(from, 'neo-gpt-sophie'));
    expect(bindings()['neo-opus-ada'].seatHome).toBe(path.join(from, 'neo-opus-ada'));
    expect(readSeatRootRecord({dir: userData}).root).toBe(from);
    expect(fs.existsSync(path.join(to, 'neo-gpt-sophie')), 'the verified copy stays').toBe(true)
});
