import {expect, test} from '@playwright/test';
import fs             from 'node:fs';
import {tmpdir}       from 'node:os';
import path           from 'node:path';
import {
    SEAT_ROOT_MOVE_FILE,
    consentSeatMove,
    findFleetWriters,
    planSeatMove,
    readSeatRootMove,
    retireMovedHomes,
    seatMoveBootHold,
    settleSeatRootMove
} from '../../../../harness/seatRootMove.mjs';
import {readSeatRootRecord, settleSeatRoot, writeSeatRootRecord} from '../../../../harness/seatRootRecord.mjs';

/**
 * @summary The shell's orchestration of a consented seat move, on real temp folders. The Brain's side
 * (copy, prove, publish, relocate) is a fake that keeps the registry in memory and copies with `fs`;
 * `moveSeatHomes` itself is proven in the Brain. Every boot is a fresh `settleSeatRootMove` over what
 * the previous one left on disk.
 */

const NOW = () => new Date('2026-10-06T14:00:00.000Z');

let userData, from, to;

test.beforeEach(() => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'seat-root-move-')));

    userData = path.join(root, 'userData');
    from     = path.join(userData, 'brain', 'fleet', 'agents');
    to       = path.join(root, 'neo-ai', 'agents');

    fs.mkdirSync(userData, {recursive: true});
    writeSeatRootRecord({dir: userData, root: from, origin: 'adopted', now: NOW})
});

test.afterEach(() => {
    fs.rmSync(path.dirname(userData), {recursive: true, force: true})
});

/**
 * @summary A seat folder the Fleet provisioned under the old root.
 */
function seatFolder(id) {
    fs.mkdirSync(path.join(from, id, 'harness', 'codex'), {recursive: true});
    fs.writeFileSync(path.join(from, id, 'harness', 'codex', 'config.toml'), `# ${id}\n`);

    return path.join(from, id)
}

/**
 * @summary The Brain as the shell reaches it: a registry of `id → seatHome`, and the four steps of
 * `runSeatMoveStep` with the plan states `moveSeatHomes` reports. A step named in `fail` throws once.
 */
function fakeBrain(bindings, {fail = {}} = {}) {
    const
        registry = new Map(Object.entries(bindings)),
        calls    = [],
        moveIds  = [];

    const plan = ({from: source, to: destinationRoot}) => [...registry].map(([id, seatHome]) => {
        const destination = path.join(destinationRoot, id);

        if (seatHome === destination) return {id, seatHome, destination, materialized: false, state: 'done'};
        if (seatHome !== path.join(source, id)) return {id, seatHome, destination, materialized: false, state: 'untouched', reason: 'bound elsewhere'};
        if (!fs.existsSync(seatHome)) return {id, seatHome, destination, materialized: false, state: 'rebind'};

        return {id, seatHome, destination, materialized: true, state: fs.existsSync(destination) ? 'relocate' : 'copy'}
    });

    const runStep = async ({step, from: source, to: destinationRoot, rows, moveId}) => {
        calls.push(step);
        moveId && moveIds.push(`${step}:${moveId}`);

        if (fail[step]) {
            const reason = fail[step];

            delete fail[step];
            throw new Error(reason)
        }

        if (step === 'plan') return {state: 'planned', rows: plan({from: source, to: destinationRoot})};

        if (step === 'move') {
            const moved = plan({from: source, to: destinationRoot});

            for (const row of moved.filter(row => ['copy', 'relocate', 'rebind'].includes(row.state))) {
                row.state === 'copy' && fs.cpSync(row.seatHome, row.destination, {recursive: true});
                registry.set(row.id, row.destination);
                row.state = row.state === 'rebind' ? 'rebound' : 'moved'
            }

            return {state: 'moved', rows: moved}
        }

        if (step === 'bindings') return [...registry].map(([id, seatHome]) => ({id, seatHome}));

        return rows.map(row => registry.get(row.id) === row.to
            ? (registry.set(row.id, row.from), {id: row.id, state: 'restored'})
            : {id: row.id, state: 'unchanged'})
    };

    return {calls, moveIds, registry, runStep}
}

const exclusive = async () => ({exclusive: true});

/**
 * @summary The operator's consent to the plan as it stands.
 */
async function consent(brain) {
    const plan = await planSeatMove({from, to, runStep: brain.runStep});

    return consentSeatMove({dir: userData, to, fingerprint: plan.fingerprint, runStep: brain.runStep, now: NOW, newId: () => 'move-1'})
}

const boot = (brain, options = {}) => settleSeatRootMove({dir: userData, checkWriter: exclusive, runStep: brain.runStep, now: NOW, ...options});

test('consent records the inputs of the plan it was shown, and changes nothing else', async () => {
    seatFolder('neo-gpt-sophie');

    const
        brain  = fakeBrain({'neo-gpt-sophie': path.join(from, 'neo-gpt-sophie'), 'neo-opus-ada': path.join(from, 'neo-opus-ada'), carol: '/elsewhere/carol'}),
        result = await consent(brain);

    expect(result.state).toBe('consented');
    expect(readSeatRootMove({dir: userData})).toEqual({
        version       : 1,
        moveId        : 'move-1',
        consentedAt   : '2026-10-06T14:00:00.000Z',
        from,
        to,
        archive       : path.join(from, '.moved-2026-10-06T14-00-00-000Z'),
        previousRecord: {origin: 'adopted', recordedAt: '2026-10-06T14:00:00.000Z', root: from},
        rows          : [
            {id: 'neo-gpt-sophie', from: path.join(from, 'neo-gpt-sophie'), to: path.join(to, 'neo-gpt-sophie'), materialized: true},
            {id: 'neo-opus-ada', from: path.join(from, 'neo-opus-ada'), to: path.join(to, 'neo-opus-ada'), materialized: false}
        ],
        outOfScope: [{id: 'carol', seatHome: '/elsewhere/carol', reason: 'bound elsewhere'}]
    });
    expect(brain.calls, 'only plans ran').toEqual(['plan', 'plan']);
    expect(readSeatRootRecord({dir: userData}).root).toBe(from);
    expect(fs.existsSync(to)).toBe(false)
});

test('consent refuses with a code a caller decides on: a refused plan, a changed one, a second consent, nothing to move, no root', async () => {
    seatFolder('neo-gpt-sophie');

    const brain = fakeBrain({'neo-gpt-sophie': path.join(from, 'neo-gpt-sophie')});
    const shown = await planSeatMove({from, to, runStep: brain.runStep});

    brain.registry.set('neo-opus-ada', path.join(from, 'neo-opus-ada'));

    expect(await consentSeatMove({dir: userData, to, fingerprint: shown.fingerprint, runStep: brain.runStep}))
        .toEqual({state: 'refused', code: 'plan-changed', reason: 'the seats changed since the plan was shown; review it again'});

    const refusing = {runStep: async () => ({state: 'refused', reason: "'/x/neo-gpt-sophie' holds something other than a verified copy of seat 'neo-gpt-sophie'", rows: []})};

    expect(await consentSeatMove({dir: userData, to, fingerprint: 'any', ...refusing}))
        .toMatchObject({state: 'refused', code: 'plan-refused', reason: expect.stringMatching(/verified copy/)});
    expect(fs.existsSync(path.join(userData, SEAT_ROOT_MOVE_FILE))).toBe(false);

    expect((await consent(brain)).state).toBe('consented');
    expect(await consent(brain)).toEqual({state: 'refused', code: 'already-consented', reason: 'a move of the seats is already consented'});

    fs.rmSync(path.join(userData, SEAT_ROOT_MOVE_FILE));

    const settled = fakeBrain({'neo-gpt-sophie': path.join(to, 'neo-gpt-sophie')});

    expect(await consent(settled)).toEqual({state: 'refused', code: 'nothing-to-move', reason: 'no seat would move'});

    fs.rmSync(path.join(userData, 'seat-root.json'));

    expect((await consent(brain)).code).toBe('no-seat-root')
});

test('a row already at its destination before the consent stays out of the move: a refusal never rebinds it', async () => {
    const
        alice = path.join(to, 'alice'),
        brain = fakeBrain({alice, 'neo-gpt-sophie': seatFolder('neo-gpt-sophie')});

    fs.mkdirSync(alice, {recursive: true});

    const {inputs} = await consent(brain);

    expect(inputs.rows.map(row => row.id)).toEqual(['neo-gpt-sophie']);
    expect(inputs.outOfScope).toEqual([{id: 'alice', seatHome: alice, reason: 'already at its destination'}]);

    // a seat registered after the consent refuses the move; the restore gives back only this move's bindings
    brain.registry.set('neo-fable', path.join(from, 'neo-fable'));

    expect((await boot(brain)).state).toBe('refused');
    expect(brain.registry.get('alice'), 'alice stays where she was').toBe(alice);

    brain.registry.delete('neo-fable');
    await consent(brain);

    expect((await boot(brain)).state).toBe('committed');
    expect(Object.fromEntries(brain.registry)).toEqual({alice, 'neo-gpt-sophie': path.join(to, 'neo-gpt-sophie')})
});

test('a consented move commits at boot: copies, bindings, the root record, then the old folders archived', async () => {
    const sophie = seatFolder('neo-gpt-sophie');
    const brain  = fakeBrain({'neo-gpt-sophie': sophie, 'neo-opus-ada': path.join(from, 'neo-opus-ada'), carol: '/elsewhere/carol'});
    const lines  = [];

    await consent(brain);

    const outcome = await boot(brain, {log: entry => lines.push(entry)});

    expect(outcome).toEqual({state: 'committed', retirement: {state: 'retired', archived: ['neo-gpt-sophie']}});
    expect(brain.moveIds, 'the Brain stages under the consent\'s id').toEqual(['plan:move-1', 'move:move-1']);
    expect(readSeatRootRecord({dir: userData})).toEqual({origin: 'moved', recordedAt: '2026-10-06T14:00:00.000Z', root: to});
    expect(Object.fromEntries(brain.registry)).toEqual({'neo-gpt-sophie': path.join(to, 'neo-gpt-sophie'), 'neo-opus-ada': path.join(to, 'neo-opus-ada'), carol: '/elsewhere/carol'});
    expect(fs.readFileSync(path.join(to, 'neo-gpt-sophie', 'harness', 'codex', 'config.toml'), 'utf8')).toBe('# neo-gpt-sophie\n');
    expect(fs.existsSync(sophie), 'the old folder left the root').toBe(false);
    expect(fs.readFileSync(path.join(from, '.moved-2026-10-06T14-00-00-000Z', 'neo-gpt-sophie', 'harness', 'codex', 'config.toml'), 'utf8')).toBe('# neo-gpt-sophie\n');
    expect(lines).toEqual([
        {row: 'neo-gpt-sophie', state: 'moved'},
        {row: 'neo-opus-ada', state: 'rebound'},
        {row: 'carol', state: 'untouched'},
        {state: 'committed', root: to},
        {row: 'neo-gpt-sophie', state: 'archived'}
    ]);

    // the first-launch choice reads the record, and an emptied old root could no longer be adopted anyway
    expect(settleSeatRoot({dir: userData, legacyRoot: from}).record.root).toBe(to);
    expect((await boot(brain)).state, 'a later boot only reads').toBe('committed')
});

test('a move that cannot commit brings the old bindings back, spends the consent and keeps the old root', async () => {
    const sophie = seatFolder('neo-gpt-sophie');
    const brain  = fakeBrain({'neo-gpt-sophie': sophie, 'neo-opus-ada': path.join(from, 'neo-opus-ada')});

    await consent(brain);

    // a seat registered after the consent would move too: the scope changed
    brain.registry.set('neo-fable', path.join(from, 'neo-fable'));

    expect(await boot(brain)).toEqual({state: 'refused', reason: "the seats changed since the move was consented ('neo-fable' would move but was not consented); review the plan again"});
    expect(brain.calls).toEqual(['plan', 'plan', 'plan', 'restore']);
    expect(readSeatRootRecord({dir: userData}).root).toBe(from);
    expect(fs.existsSync(path.join(userData, SEAT_ROOT_MOVE_FILE))).toBe(false);

    // the readback disagrees: the move left a binding off its destination
    brain.registry.delete('neo-fable');
    await consent(brain);

    const stuck = {...brain, runStep: async step => step.step === 'bindings'
        ? [{id: 'neo-gpt-sophie', seatHome: path.join(to, 'neo-gpt-sophie')}, {id: 'neo-opus-ada', seatHome: path.join(from, 'neo-opus-ada')}]
        : brain.runStep(step)};

    expect((await boot(stuck)).reason).toBe(`'neo-opus-ada' reads '${path.join(from, 'neo-opus-ada')}', not '${path.join(to, 'neo-opus-ada')}'`);
    expect(Object.fromEntries(brain.registry), 'restored').toEqual({'neo-gpt-sophie': sophie, 'neo-opus-ada': path.join(from, 'neo-opus-ada')});
    expect(fs.existsSync(path.join(to, 'neo-gpt-sophie')), 'the copy stays').toBe(true);
    expect(readSeatRootRecord({dir: userData}).root).toBe(from)
});

test('a move held by a possible writer, or one that cannot come back, changes nothing and keeps the consent', async () => {
    const brain = fakeBrain({'neo-gpt-sophie': seatFolder('neo-gpt-sophie')});

    await consent(brain);

    expect(await boot(brain, {checkWriter: async () => ({exclusive: false, reason: 'a process listens on the Fleet port 8083; quit it, then relaunch'})}))
        .toEqual({state: 'held', reason: 'a process listens on the Fleet port 8083; quit it, then relaunch'});
    expect(brain.calls).toEqual(['plan', 'plan']);

    const failing = fakeBrain({'neo-gpt-sophie': path.join(from, 'neo-gpt-sophie')}, {fail: {move: 'disk full', restore: 'registry unreadable'}});

    expect(await boot(failing)).toEqual({state: 'held', reason: 'the move failed: disk full; the old bindings could not be restored (registry unreadable)'});
    expect(readSeatRootRecord({dir: userData}).root).toBe(from);
    expect(readSeatRootMove({dir: userData}), 'still consented').not.toBeNull();

    expect((await boot(failing)).state, 'the next boot goes on').toBe('committed')
});

test('interrupted after the plan, the next boot moves and commits', async () => {
    const brain = fakeBrain({'neo-gpt-sophie': seatFolder('neo-gpt-sophie')});

    await consent(brain);
    await brain.runStep({step: 'plan', from, to});

    expect((await boot(brain)).state).toBe('committed');
    expect(readSeatRootRecord({dir: userData}).root).toBe(to)
});

test('interrupted inside the move, the next boot resumes it and commits', async () => {
    seatFolder('neo-gpt-sophie');
    seatFolder('neo-opus-ada');

    const brain = fakeBrain({'neo-gpt-sophie': path.join(from, 'neo-gpt-sophie'), 'neo-opus-ada': path.join(from, 'neo-opus-ada')});

    await consent(brain);

    // the first seat was copied and relocated, the second only copied, when the shell went down
    fs.cpSync(path.join(from, 'neo-gpt-sophie'), path.join(to, 'neo-gpt-sophie'), {recursive: true});
    fs.cpSync(path.join(from, 'neo-opus-ada'), path.join(to, 'neo-opus-ada'), {recursive: true});
    brain.registry.set('neo-gpt-sophie', path.join(to, 'neo-gpt-sophie'));

    expect((await boot(brain)).state).toBe('committed');
    expect(Object.fromEntries(brain.registry)).toEqual({'neo-gpt-sophie': path.join(to, 'neo-gpt-sophie'), 'neo-opus-ada': path.join(to, 'neo-opus-ada')})
});

test('interrupted after the commit, the next boot only finishes the retirement, and never rolls back', async () => {
    const
        sophie = seatFolder('neo-gpt-sophie'),
        ada    = seatFolder('neo-opus-ada'),
        brain  = fakeBrain({'neo-gpt-sophie': sophie, 'neo-opus-ada': ada});

    await consent(brain);

    const inputs = readSeatRootMove({dir: userData});

    // the move committed; one old folder was archived when the shell went down
    await brain.runStep({step: 'move', from, to});
    writeSeatRootRecord({dir: userData, root: to, origin: 'moved', now: NOW});
    fs.mkdirSync(inputs.archive, {recursive: true});
    fs.renameSync(sophie, path.join(inputs.archive, 'neo-gpt-sophie'));
    brain.calls.length = 0;

    expect(await boot(brain)).toEqual({state: 'committed', retirement: {state: 'retired', archived: ['neo-opus-ada']}});
    expect(brain.calls, 'no Brain step after the commit').toEqual([]);
    expect(fs.existsSync(ada)).toBe(false)
});

test('after the retirement, a lost or unreadable root record is written again from the archive: no Brain step, nothing restored', async () => {
    const brain = fakeBrain({'neo-gpt-sophie': seatFolder('neo-gpt-sophie'), 'neo-opus-ada': seatFolder('neo-opus-ada')});

    await consent(brain);
    expect((await boot(brain)).state).toBe('committed');

    const moved = Object.fromEntries(brain.registry);

    // the record is lost, and the Brain cannot plan
    fs.rmSync(path.join(userData, 'seat-root.json'));
    brain.calls.length = 0;

    const unplanned = {...brain, runStep: async step => step.step === 'plan' ? Promise.reject(new Error('the Brain cannot plan')) : brain.runStep(step)};

    expect(await boot(unplanned)).toEqual({state: 'committed', retirement: {state: 'retired', archived: []}});
    expect(readSeatRootRecord({dir: userData})).toMatchObject({origin: 'moved', root: to});
    expect(Object.fromEntries(brain.registry)).toEqual(moved);

    // the record is corrupt, and one row left the registry
    fs.writeFileSync(path.join(userData, 'seat-root.json'), '{"root": ');
    brain.registry.delete('neo-opus-ada');

    expect((await boot(brain)).state).toBe('committed');
    expect(brain.registry.get('neo-gpt-sophie')).toBe(path.join(to, 'neo-gpt-sophie'));
    expect(readSeatRootRecord({dir: userData}).root).toBe(to);
    expect(brain.calls, 'no Brain step either time').toEqual([])
});

test('a root record lost before the retirement: a move that cannot go on holds with its consent while a row reads its destination', async () => {
    const brain = fakeBrain({'neo-gpt-sophie': seatFolder('neo-gpt-sophie')});

    await consent(brain);

    // the move published and relocated, then the record was lost: committed or not, it cannot tell
    await brain.runStep({step: 'move', from, to});
    fs.rmSync(path.join(userData, 'seat-root.json'));

    const refusing = {...brain, runStep: async step => step.step === 'plan' ? {state: 'refused', reason: 'the plan is unavailable', rows: []} : brain.runStep(step)};

    expect(await boot(refusing)).toEqual({
        state : 'held',
        reason: "the plan is unavailable; with no readable seat root record, 'neo-gpt-sophie' at its destination may be a committed move, so nothing is restored"
    });
    expect(brain.registry.get('neo-gpt-sophie')).toBe(path.join(to, 'neo-gpt-sophie'));
    expect(readSeatRootMove({dir: userData}), 'the consent stays').not.toBeNull();
    expect(fs.existsSync(path.join(userData, 'seat-root.json')), 'no record is guessed').toBe(false);

    expect((await boot(brain)).state, 'a boot that can plan commits').toBe('committed');
    expect(readSeatRootRecord({dir: userData}).root).toBe(to)
});

test('a missing or unreadable root record is written from the move, never by the first-launch choice', async () => {
    const brain = fakeBrain({'neo-gpt-sophie': seatFolder('neo-gpt-sophie')});

    await consent(brain);
    fs.rmSync(path.join(userData, 'seat-root.json'));

    expect((await boot(brain)).state).toBe('committed');
    expect(readSeatRootRecord({dir: userData})).toMatchObject({origin: 'moved', root: to});

    // a refused move over an unreadable record writes the record it replaced
    fs.rmSync(path.join(userData, SEAT_ROOT_MOVE_FILE));
    writeSeatRootRecord({dir: userData, root: from, origin: 'adopted', now: NOW});

    const back = fakeBrain({'neo-opus-ada': seatFolder('neo-opus-ada')});

    await consent(back);
    fs.writeFileSync(path.join(userData, 'seat-root.json'), '{"root": ');
    fs.mkdirSync(path.join(to, 'neo-opus-ada', 'other'), {recursive: true});   // now occupied by something else

    const occupied = {...back, runStep: async step => step.step === 'plan' ? {state: 'refused', reason: 'occupied', rows: []} : back.runStep(step)};

    expect((await boot(occupied)).state).toBe('refused');
    expect(readSeatRootRecord({dir: userData})).toMatchObject({origin: 'adopted', root: from})
});

test('a root record naming neither side, or inputs that cannot be read, hold the boot and change nothing', async () => {
    const brain = fakeBrain({'neo-gpt-sophie': seatFolder('neo-gpt-sophie')});

    await consent(brain);
    writeSeatRootRecord({dir: userData, root: '/somewhere/else', origin: 'environment', now: NOW});

    expect(await boot(brain)).toEqual({state: 'held', reason: "the seat root record names '/somewhere/else', neither side of the consented move"});

    fs.writeFileSync(path.join(userData, SEAT_ROOT_MOVE_FILE), '{"version": 1}');

    expect((await boot(brain)).reason).toMatch(/does not describe a move of the seats; restore it before they can move$/);
    expect(brain.calls).toEqual(['plan', 'plan'])
});

test('the retirement touches only the folders the move names, and an occupied archive path stops it before any rename', async () => {
    const
        sophie = seatFolder('neo-gpt-sophie'),
        ada    = seatFolder('neo-opus-ada'),
        inputs = {
            archive: path.join(from, '.moved-x'),
            rows   : [
                {id: 'neo-gpt-sophie', from: sophie, to: path.join(to, 'neo-gpt-sophie'), materialized: true},
                {id: 'neo-opus-ada', from: ada, to: path.join(to, 'neo-opus-ada'), materialized: true}
            ]
        };

    seatFolder('unrelated');
    fs.mkdirSync(path.join(inputs.archive, 'neo-opus-ada'), {recursive: true});

    expect(retireMovedHomes({inputs})).toEqual({state: 'held', reason: `'${path.join(inputs.archive, 'neo-opus-ada')}' is occupied; no old folder was archived`});
    expect(fs.existsSync(sophie)).toBe(true);

    fs.rmSync(path.join(inputs.archive, 'neo-opus-ada'), {recursive: true});

    expect(retireMovedHomes({inputs})).toEqual({state: 'retired', archived: ['neo-gpt-sophie', 'neo-opus-ada']});
    expect(fs.readdirSync(from).sort()).toEqual(['.moved-x', 'unrelated'])
});

test('an archive path that is a link, not a folder in the old root, stops the retirement before any rename', async () => {
    const
        sophie    = seatFolder('neo-gpt-sophie'),
        elsewhere = fs.mkdtempSync(path.join(tmpdir(), 'seat-root-move-elsewhere-')),
        inputs    = {
            archive: path.join(from, '.moved-x'),
            rows   : [{id: 'neo-gpt-sophie', from: sophie, to: path.join(to, 'neo-gpt-sophie'), materialized: true}]
        };

    try {
        fs.symlinkSync(elsewhere, inputs.archive);

        expect(retireMovedHomes({inputs})).toEqual({state: 'held', reason: `'${inputs.archive}' is a link or a file, not a folder in the old root; no old folder was archived`});
        expect(fs.existsSync(path.join(sophie, 'harness', 'codex', 'config.toml'))).toBe(true);
        expect(fs.readdirSync(elsewhere)).toEqual([])
    } finally {
        fs.rmSync(elsewhere, {recursive: true, force: true})
    }
});

test('a committed move whose retirement is held holds the Fleet boot, as a held move does; a retired one does not', async () => {
    const
        brain    = fakeBrain({'neo-gpt-sophie': seatFolder('neo-gpt-sophie')}),
        {inputs} = await consent(brain),
        occupant = path.join(inputs.archive, 'neo-gpt-sophie');

    fs.mkdirSync(occupant, {recursive: true});

    const outcome = await boot(brain);

    expect(outcome).toEqual({state: 'committed', retirement: {state: 'held', reason: `'${occupant}' is occupied; no old folder was archived`}});
    expect(seatMoveBootHold(outcome)).toBe(`the move committed, but '${occupant}' is occupied; no old folder was archived`);
    expect(readSeatRootRecord({dir: userData}).root, 'the commit stands').toBe(to);
    expect(brain.registry.get('neo-gpt-sophie'), 'and so do the bindings').toBe(path.join(to, 'neo-gpt-sophie'));

    fs.rmSync(occupant, {recursive: true});

    const retired = await boot(brain);

    expect(retired).toEqual({state: 'committed', retirement: {state: 'retired', archived: ['neo-gpt-sophie']}});
    expect(seatMoveBootHold(retired)).toBeNull();
    expect(seatMoveBootHold({state: 'held', reason: 'a process listens on the Fleet port 8083; quit it, then relaunch'})).toBe('a process listens on the Fleet port 8083; quit it, then relaunch');
    expect(seatMoveBootHold({state: 'none'})).toBeNull();
    expect(seatMoveBootHold(null)).toBeNull()
});

test('a writer is ruled out only by a free Fleet port and a readable process list without this installation\'s Fleet', async () => {
    const
        fleetEntry = '/Applications/Neo.app/Contents/Resources/organism/ai/services/fleet/devFleetServer.mjs',
        free       = async () => false;

    expect(await findFleetWriters({fleetEntry, fleetPort: 8083, probePortFn: async () => true, listProcessesFn: async () => []}))
        .toEqual({exclusive: false, reason: 'a process listens on the Fleet port 8083; quit it, then relaunch'});
    expect(await findFleetWriters({fleetEntry, fleetPort: 8083, probePortFn: free, listProcessesFn: async () => [{pid: 42, command: `/x/Electron --import data:x ${fleetEntry} --neo-harness-owner=u`}]}))
        .toEqual({exclusive: false, reason: "process 42 runs this installation's Fleet; quit it, then relaunch"});
    expect((await findFleetWriters({fleetEntry, fleetPort: 8083, probePortFn: free, listProcessesFn: async () => { throw new Error('ps: not permitted') }})).reason)
        .toBe('the running processes could not be read (ps: not permitted), so a Fleet writer cannot be ruled out');
    expect(await findFleetWriters({fleetEntry, fleetPort: 8083, probePortFn: free, listProcessesFn: async () => [{pid: 7, command: '/checkout/node ai/services/fleet/devFleetServer.mjs'}]}))
        .toEqual({exclusive: true})
});
