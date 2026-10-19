import {expect, test}   from '@playwright/test';
import {spawnSync}      from 'node:child_process';
import crypto           from 'node:crypto';
import fs               from 'node:fs';
import os               from 'node:os';
import path             from 'node:path';
import {fileURLToPath}  from 'node:url';
import {runBrainScript} from '../../../../harness/brain.mjs';
import {
    INSTALLED_APP,
    RECEIPT_SUFFIX,
    REHEARSAL_FAMILIES,
    REHEARSAL_VIEWER,
    judgeRehearsal,
    readCheckoutIdentity,
    readOrganismIdentity,
    readStartOffers,
    rehearsalFleetEnv,
    rehearsalSeats,
    resolveReceiptPath,
    resolveRehearsal,
    resolveStandInRuntime,
    rosterMappingScript,
    runRehearsal,
    writeReceipt
} from '../../../../harness/rehearsal.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * @summary The pre-install rehearsal's Electron-free half: the arm rehearses only on its own fixture plane, the
 * stand-in runs on a Node that answers or the run refuses, the candidate's identity is its build receipt, and the
 * verdict lands beside the candidate, never inside the installed app.
 */
test.describe('harness rehearsal', () => {
    let root;

    test.beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-rehearsal-'))
    });

    test.afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    });

    test('the rehearsal acts only in the isolated Brain smoke, and names why it refuses anywhere else', () => {
        const env = {NEO_HARNESS_REHEARSAL: '1'};

        expect(resolveRehearsal({env: {}, smokeMode: true, brainMode: true, smokePlaneMode: false}), 'unset').toEqual({rehearsal: false, refusal: null});
        expect(resolveRehearsal({env, smokeMode: true, brainMode: true, smokePlaneMode: false})).toEqual({rehearsal: true, refusal: null});
        expect(resolveRehearsal({env, smokeMode: false, brainMode: true, smokePlaneMode: false}).refusal).toContain('organism running here');
        expect(resolveRehearsal({env, smokeMode: true, brainMode: false, smokePlaneMode: false}).refusal).toContain('organism running here');
        expect(resolveRehearsal({env, smokeMode: true, brainMode: true, smokePlaneMode: true}).refusal).toContain('registers a forge')
    });

    test('the stand-in runs on the pinned or PATH Node that answers, and refuses without one', () => {
        expect(resolveStandInRuntime({env: {NEO_HARNESS_STAND_IN_NODE: process.execPath}})).toEqual({runtime: process.execPath, refusal: null});
        expect(resolveStandInRuntime({env: {PATH: path.dirname(process.execPath)}}).runtime).toMatch(/node$/);

        const
            silent = path.join(root, 'node'),
            hung   = path.join(root, 'app');

        fs.writeFileSync(silent, '#!/bin/sh\nexit 1\n', {mode: 0o755});
        fs.writeFileSync(hung, '#!/bin/sh\nsleep 30\n', {mode: 0o755});

        expect(resolveStandInRuntime({env: {NEO_HARNESS_STAND_IN_NODE: silent}}).refusal).toContain(`'${silent}', which did not answer`);
        expect(resolveStandInRuntime({env: {PATH: root + '-absent'}}).refusal).toContain('found none');

        // A packaged shell points NEO_HARNESS_NODE_BIN at its Electron runtime, which opens as an app instead of answering
        expect(resolveStandInRuntime({env: {NEO_HARNESS_NODE_BIN: silent, PATH: path.dirname(process.execPath)}}).runtime, 'the shell\'s runtime is not the stand-in\'s')
            .toMatch(/node$/);

        const started = Date.now();

        expect(resolveStandInRuntime({env: {NEO_HARNESS_STAND_IN_NODE: hung}, timeoutMs: 300}).refusal).toContain(`'${hung}', which did not answer`);
        expect(Date.now() - started, 'a binary that never answers is cut off, not waited for').toBeLessThan(5_000)
    });

    test('the candidate is identified by its build receipt: the owners and the receipt digest', () => {
        const receipt = {electronVersion: '43.5.0', owners: {
            brain  : {name: 'neo-agent-brain', revision: 'b'.repeat(40), version: '0.0.0'},
            engine : {name: 'neo.mjs', revision: 'e'.repeat(40), pin: 'github:neomjs/neo#dev'},
            product: {name: 'neo-agent-institution', revision: 'p'.repeat(40)}
        }};

        fs.writeFileSync(path.join(root, 'organism-build-info.json'), JSON.stringify(receipt));

        expect(readOrganismIdentity(root)).toEqual({
            digest         : crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'organism-build-info.json'))).digest('hex'),
            electronVersion: '43.5.0',
            owners         : {
                brain  : {name: 'neo-agent-brain', revision: 'b'.repeat(40)},
                engine : {name: 'neo.mjs', revision: 'e'.repeat(40)},
                product: {name: 'neo-agent-institution', revision: 'p'.repeat(40)}
            }
        })
    });

    test('the receipt lands beside a candidate or under the checkout, never inside the installed app', () => {
        const artifact = path.join(root, 'dist-artifacts', 'mac-arm64', 'Neo Harness.app');

        expect(resolveReceiptPath({artifactPath: artifact, harnessDir: root})).toEqual({receiptPath: artifact + RECEIPT_SUFFIX, refusal: null});
        expect(resolveReceiptPath({artifactPath: null, harnessDir: root})).toEqual({receiptPath: path.join(root, '.brain', 'rehearsal.json'), refusal: null});
        expect(resolveReceiptPath({artifactPath: INSTALLED_APP, harnessDir: root}).refusal).toContain('does not run against the installed app');

        const written = writeReceipt(artifact + RECEIPT_SUFFIX, {verdict: 'pass'});

        expect(JSON.parse(fs.readFileSync(written, 'utf8'))).toEqual({verdict: 'pass'});
        expect(fs.readdirSync(path.dirname(written)), 'no scratch file is left beside it').toEqual(['Neo Harness.app.rehearsal.json'])
    });

    test('a checkout candidate is identified by the commit its runtime root has checked out', () => {
        spawnSync('git', ['init', '-q', root]);
        spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'seed']);

        const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).stdout.trim();

        expect(readCheckoutIdentity(root)).toEqual({revision: head, runtimeRoot: root, source: 'checkout'});
        expect(readCheckoutIdentity(path.join(root, 'absent')).revision, 'no repository, no revision').toBeNull()
    });

    test('each covered family gets one seat that reads no forge and keeps only Neural Link, and the Fleet runs as the rehearsal viewer', () => {
        const seats = rehearsalSeats();

        expect(seats.map(seat => seat.definition.harnessType)).toEqual(REHEARSAL_FAMILIES);

        seats.forEach(({definition, repo}) => {
            expect(definition.mcpServers).toEqual({'github-workflow': false, 'knowledge-base': false, 'memory-core': false});
            expect(definition.gitEmail).toMatch(/@example\.invalid$/);
            expect(new URL(repo.cloneUrl).hostname).toBe('example.invalid')
        });

        expect(rehearsalFleetEnv({codex: {binary: '/c/Codex', cli: '/c/codex'}, graphPath: '/r/graph.sqlite', nlPort: 4321, signingKey: 'PEM', standIn: '/r/stand-in.mjs'})).toEqual({
            NEO_AGENT_IDENTITY          : REHEARSAL_VIEWER,
            NEO_FLEET_CLAUDE_DESKTOP_BIN: '/r/stand-in.mjs',
            NEO_FLEET_CODEX_BIN         : '/c/codex',
            NEO_FLEET_CODEX_DESKTOP_BIN : '/c/Codex',
            NEO_FLEET_SIGNING_KEY       : 'PEM',
            NEO_MEMORY_DB_PATH_TEST     : '/r/graph.sqlite',
            NEO_NL_PORT                 : '4321'
        })
    });

    test("the Start offer is the cockpit's own mapping: a stopped seat is offered Start, a seat still running is not", async () => {
        const
            runtime = {confidence: 'observed', source: 'fleet:runtimeStatus', state: 'wired'},
            row     = (id, state) => ({id, lifecycle: {confidence: 'observed', source: 'fleet:runtimeStatus', state}, sources: {runtime}}),
            mapRows = async rows => (await runBrainScript({env: {NEO_REHEARSAL_ROWS: JSON.stringify(rows)}, label: 'the roster mapping', repoRoot: REPO_ROOT, script: rosterMappingScript()})).states,
            client  = {fleetRoster: async () => ({rows: [row('a', 'stopped'), row('b', 'running'), row('other', 'running')]})};

        expect(await readStartOffers({client, mapRows, seatIds: ['a', 'b', 'gone']})).toEqual({
            a   : {offered: true, state: 'off'},
            b   : {offered: false, state: 'ok'},
            gone: {offered: false, state: null}
        })
    });

    test('the verdict names each failed step, and each recovered seat the roster offers no Start', () => {
        const
            row    = (step, ok = true, reason = null) => ({family: 'claude-desktop', ok, reason, seat: 'a', step}),
            passed = [row('start'), row('recover'), row('start-after-recovery')];

        expect(judgeRehearsal({journey: {ok: true, rows: passed}, offers: {a: {offered: true, state: 'off'}}})).toEqual({failures: [], ok: true});
        expect(judgeRehearsal({journey: {ok: true, rows: passed}, offers: {a: {offered: false, state: 'ok'}}}).failures)
            .toEqual(["a (claude-desktop) start-offer: the roster reads 'ok' and offers no Start"]);
        expect(judgeRehearsal({journey: {ok: true, rows: passed}, offers: null}).failures)
            .toEqual(['a (claude-desktop) start-offer: the roster was not read after the restart']);
        expect(judgeRehearsal({journey: {ok: false, rows: [row('start', false, "seat reached 'failed'")]}, offers: null}).failures, 'a seat that never recovered owes no offer')
            .toEqual(["a (claude-desktop) start: seat reached 'failed'"])
    });

    test("the Start offer is read from the rebooted Fleet, between the restart and the journey's next Start", async () => {
        const
            calls    = [],
            first    = {fleetRoster: async () => {throw new Error('the first Fleet is dead by now')}},
            rebooted = {fleetRoster: async () => ({rows: [{id: 'a'}]})},
            organism = {runSeatJourney: async ({fleet, restartFleet, seats}) => {
                calls.push(['journey', fleet === first, seats.length]);
                calls.push(['restarted', await restartFleet({beforeBoot: async () => calls.push(['beforeBoot'])}) === rebooted]);
                return {ok: true, rows: [{family: 'claude-desktop', ok: true, reason: null, seat: 'a', step: 'recover'}]}
            }},
            result   = await runRehearsal({
                bridgePort: 4321,
                client    : first,
                mapRows   : async rows => Object.fromEntries(rows.map(({id}) => [id, 'off'])),
                organism,
                reboot    : async ({beforeBoot}) => {
                    await beforeBoot();
                    calls.push(['reboot']);
                    return rebooted
                },
                seats: [{definition: {id: 'a'}}]
            });

        expect(calls).toEqual([['journey', true, 1], ['beforeBoot'], ['reboot'], ['restarted', true]]);
        expect(result.offers).toEqual({a: {offered: true, state: 'off'}});
        expect(result.verdict).toEqual({failures: [], ok: true})
    })
});
