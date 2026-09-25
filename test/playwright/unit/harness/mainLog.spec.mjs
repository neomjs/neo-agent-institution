import {expect, test}                     from '@playwright/test';
import {existsSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir}                           from 'node:os';
import path                               from 'node:path';
import {
    carriesSecret,
    createMainLog,
    MAIN_LOG_FILE,
    REDACTED_LINE
} from '../../../../harness/mainLog.mjs';

const
    FLEET_BEARER = 'fleet-fixture-bearer-0000',
    PLANE_BEARER = 'ghp_planeFixtureBearer0000000000000000',
    NOW          = () => new Date('2026-09-25T20:50:00.000Z'),
    tempDir      = () => mkdtempSync(path.join(tmpdir(), 'main-log-'));

test.describe('harness/mainLog — the shell\'s own log', () => {
    test('lines land in main.log with a timestamp, in order', () => {
        const dir = tempDir(), log = createMainLog({dir, now: NOW});

        log.write('HARNESS_BRAIN_PLAN', {mode: 'own', startFleet: true});
        log.write('HARNESS_BRAIN_MODE own');

        expect(readFileSync(path.join(dir, MAIN_LOG_FILE), 'utf8')).toBe(
            '2026-09-25T20:50:00.000Z HARNESS_BRAIN_PLAN {"mode":"own","startFleet":true}\n' +
            '2026-09-25T20:50:00.000Z HARNESS_BRAIN_MODE own\n'
        )
    });

    test('a line carrying either bearer reaches the file only as the redaction marker', () => {
        const dir = tempDir(), log = createMainLog({dir, now: NOW, secrets: () => [FLEET_BEARER, PLANE_BEARER, null]});

        log.write(`HARNESS_BRAIN Authorization: Bearer ${FLEET_BEARER}`);
        log.write('env', {NEO_FLEET_PLANE_BEARER: PLANE_BEARER});
        log.write('HARNESS_BRAIN_MODE plane-attach');

        const text = readFileSync(path.join(dir, MAIN_LOG_FILE), 'utf8');

        expect(text).not.toContain(FLEET_BEARER);
        expect(text).not.toContain(PLANE_BEARER);
        expect(text.split('\n').filter(Boolean)).toEqual([
            `2026-09-25T20:50:00.000Z ${REDACTED_LINE}`,
            `2026-09-25T20:50:00.000Z ${REDACTED_LINE}`,
            '2026-09-25T20:50:00.000Z HARNESS_BRAIN_MODE plane-attach'
        ])
    });

    test('a secret main does not hold redacts nothing', () => {
        expect(carriesSecret('HARNESS_BRAIN_MODE own', [null, '', undefined])).toBe(false);
        expect(carriesSecret(`x ${PLANE_BEARER} y`, [null, PLANE_BEARER])).toBe(true)
    });

    test('the file rotates once past its cap and never grows unbounded', () => {
        const dir = tempDir(), log = createMainLog({dir, now: NOW, maxBytes: 120});

        for (let i = 0; i < 10; i++) {
            log.write(`line ${i} ${'x'.repeat(20)}`)
        }

        const
            current  = readFileSync(path.join(dir, MAIN_LOG_FILE), 'utf8'),
            previous = readFileSync(path.join(dir, `${MAIN_LOG_FILE}.1`), 'utf8');

        expect(Buffer.byteLength(current)).toBeLessThanOrEqual(120);
        expect(Buffer.byteLength(previous)).toBeLessThanOrEqual(120);
        expect(current).toContain('line 9');
        expect(existsSync(path.join(dir, `${MAIN_LOG_FILE}.2`))).toBe(false)
    });

    test('a log that cannot write stops quietly and never throws into the boot', () => {
        let appends = 0;

        const log = createMainLog({
            dir     : '/nonexistent',
            now     : NOW,
            fsModule: {
                appendFileSync: () => { appends++; throw new Error('EROFS') },
                existsSync    : () => false,
                mkdirSync     : () => {},
                renameSync    : () => {},
                statSync      : () => ({size: 0})
            }
        });

        expect(() => log.write('HARNESS_BRAIN_MODE own')).not.toThrow();
        expect(() => log.write('HARNESS_BRAIN_MODE own')).not.toThrow();
        expect(appends, 'the first failure disables the log').toBe(1)
    });

    test('install tees log, warn and error into the file while the originals still print', () => {
        const
            dir     = tempDir(),
            printed = [],
            target  = {
                error: (...args) => printed.push(['error', ...args]),
                log  : (...args) => printed.push(['log', ...args]),
                warn : (...args) => printed.push(['warn', ...args])
            };

        createMainLog({dir, now: NOW}).install(target);

        target.log('HARNESS_BRAIN_PLAN');
        target.warn('HARNESS_BRAIN_STOP_FAILED', new Error('boom'));
        target.error('HARNESS_BRAIN exit 1');

        expect(printed.map(([level]) => level)).toEqual(['log', 'warn', 'error']);

        const text = readFileSync(path.join(dir, MAIN_LOG_FILE), 'utf8');

        expect(text).toContain('HARNESS_BRAIN_PLAN');
        expect(text).toContain('HARNESS_BRAIN_STOP_FAILED Error: boom');
        expect(text).toContain('HARNESS_BRAIN exit 1')
    })
});
