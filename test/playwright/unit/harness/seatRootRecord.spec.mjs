import {expect, test}                                      from '@playwright/test';
import fs, {mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir}                                            from 'node:os';
import path                                                from 'node:path';
import {
    SEAT_ROOT_FILE,
    readSeatRootRecord,
    settleSeatRoot,
    writeSeatRootRecord
} from '../../../../harness/seatRootRecord.mjs';

const
    NOW     = () => new Date('2026-10-01T16:30:00.000Z'),
    tempDir = () => mkdtempSync(path.join(tmpdir(), 'seat-root-'));

/**
 * @summary An installation as the incident left it: `userData` holding the record (or not), and the agents
 * root earlier versions placed beneath the Brain data root.
 */
function installation({legacySeats = []} = {}) {
    const
        userData   = tempDir(),
        legacyRoot = path.join(userData, 'brain', 'fleet', 'agents');

    legacySeats.forEach(seat => mkdirSync(path.join(legacyRoot, seat), {recursive: true}));

    return {legacyRoot, userData}
}

/**
 * @summary Counts directory probes: a launch with a record must make none.
 */
function probingFs() {
    const calls = {readdir: 0};

    return {calls, fsModule: {...fs, readdirSync: (...args) => (calls.readdir++, fs.readdirSync(...args))}}
}

test.describe('harness/seatRootRecord — where the installed shell keeps its agents\' seats', () => {
    test('a seat under the legacy root survives a plain restart: adopted once, then read without probing', () => {
        const {legacyRoot, userData} = installation({legacySeats: ['neo-gpt-sophie', 'neo-opus-ada']});

        const first = settleSeatRoot({dir: userData, legacyRoot, now: NOW});

        expect(first.record).toEqual({origin: 'adopted', recordedAt: '2026-10-01T16:30:00.000Z', root: legacyRoot});

        const {calls, fsModule} = probingFs();
        const restart = settleSeatRoot({dir: userData, legacyRoot, fsModule});

        expect(restart.record.root).toBe(legacyRoot);
        expect(calls.readdir).toBe(0)
    });

    test('a present record is honoured with zero probes, whatever the legacy root holds', () => {
        const {legacyRoot, userData} = installation({legacySeats: ['neo-gpt-sophie']});

        writeSeatRootRecord({dir: userData, root: '/Users/someone/.neo-ai/agents', origin: 'moved', now: NOW});

        const {calls, fsModule} = probingFs();

        expect(settleSeatRoot({dir: userData, legacyRoot, fsModule}).record.root).toBe('/Users/someone/.neo-ai/agents');
        expect(calls.readdir).toBe(0)
    });

    test('a fresh installation leaves the choice to the Brain\'s resolved root, recorded as the default', () => {
        const {legacyRoot, userData} = installation();

        expect(settleSeatRoot({dir: userData, legacyRoot})).toEqual({record: null, ignoredEnvRoot: null});

        writeSeatRootRecord({dir: userData, root: '/Users/someone/.neo-ai/agents', origin: 'default', now: NOW});

        expect(readSeatRootRecord({dir: userData})).toEqual({origin: 'default', recordedAt: '2026-10-01T16:30:00.000Z', root: '/Users/someone/.neo-ai/agents'})
    });

    test('an empty or hidden-only legacy root holds no seat', () => {
        const {legacyRoot, userData} = installation();

        mkdirSync(path.join(legacyRoot, '.cache'), {recursive: true});
        writeFileSync(path.join(legacyRoot, '.DS_Store'), '');

        expect(settleSeatRoot({dir: userData, legacyRoot}).record).toBeNull()
    });

    test('a deliberate move changes only the record, and the next launch passes the new root', () => {
        const {legacyRoot, userData} = installation({legacySeats: ['neo-gpt-sophie']});

        settleSeatRoot({dir: userData, legacyRoot, now: NOW});
        writeSeatRootRecord({dir: userData, root: '/Users/someone/.neo-ai/agents', origin: 'moved', now: NOW});

        expect(settleSeatRoot({dir: userData, legacyRoot}).record).toMatchObject({origin: 'moved', root: '/Users/someone/.neo-ai/agents'});
        expect(readdirSync(legacyRoot)).toEqual(['neo-gpt-sophie'])
    });

    test('the environment is recorded at the first launch only; later it is reported and ignored', () => {
        const {legacyRoot, userData} = installation({legacySeats: ['neo-gpt-sophie']});

        expect(settleSeatRoot({dir: userData, envRoot: legacyRoot, legacyRoot, now: NOW}).record)
            .toMatchObject({origin: 'environment', root: legacyRoot});

        expect(settleSeatRoot({dir: userData, envRoot: '/elsewhere/agents', legacyRoot}))
            .toEqual({record: expect.objectContaining({root: legacyRoot}), ignoredEnvRoot: '/elsewhere/agents'});
        expect(settleSeatRoot({dir: userData, envRoot: legacyRoot, legacyRoot}).ignoredEnvRoot).toBeNull();
        expect(() => settleSeatRoot({dir: userData, envRoot: 'relative/agents', legacyRoot})).toThrow(/absolute/)
    });

    test('a record that exists but cannot be used refuses instead of choosing again', () => {
        const {legacyRoot, userData} = installation({legacySeats: ['neo-gpt-sophie']});

        writeFileSync(path.join(userData, SEAT_ROOT_FILE), '{"root": "relative", "origin": "adopted"}');
        expect(() => settleSeatRoot({dir: userData, legacyRoot})).toThrow(/no absolute root/);

        writeFileSync(path.join(userData, SEAT_ROOT_FILE), 'not json');
        expect(() => settleSeatRoot({dir: userData, legacyRoot})).toThrow(/cannot be read/)
    });

    test('a legacy root that cannot be read throws rather than letting the choice move away from it', () => {
        const
            {legacyRoot, userData} = installation(),
            fsModule               = {...fs, readdirSync: () => { throw Object.assign(new Error('denied'), {code: 'EACCES'}) }};

        expect(() => settleSeatRoot({dir: userData, legacyRoot, fsModule})).toThrow(/denied/);
        expect(readSeatRootRecord({dir: userData})).toBeNull()
    });

    test('the record is written whole and owner-only, with no temp file left behind', () => {
        const {userData} = installation();

        writeSeatRootRecord({dir: userData, root: '/Users/someone/.neo-ai/agents', origin: 'default', now: NOW});

        expect(statSync(path.join(userData, SEAT_ROOT_FILE)).mode & 0o777).toBe(0o600);
        expect(readdirSync(userData)).toEqual([SEAT_ROOT_FILE]);
        expect(JSON.parse(readFileSync(path.join(userData, SEAT_ROOT_FILE), 'utf8')).root).toBe('/Users/someone/.neo-ai/agents');
        expect(() => writeSeatRootRecord({dir: userData, root: 'relative', origin: 'default'})).toThrow(TypeError);
        expect(() => writeSeatRootRecord({dir: userData, root: '/abs', origin: 'guessed'})).toThrow(TypeError)
    })
});
