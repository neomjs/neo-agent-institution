import {expect, test}                                            from '@playwright/test';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir}                                                  from 'node:os';
import path                                                      from 'node:path';
import {
    APP_NAME,
    custodyDigest,
    describeReceipt,
    executePlan,
    legacyCopies,
    PEER_QUIT_WARNING,
    planInstall,
    readSlot,
    RECEIPT_RELATIVE_PATH,
    resolveArtifactPath
} from '../../../../harness/install.mjs';

const
    APPLICATIONS = '/Applications',
    INSTALLED    = `${APPLICATIONS}/${APP_NAME}.app`,
    ROLLBACK     = `/Users/me/Library/Application Support/neo-harness/rollback/${APP_NAME}.app`,
    ARTIFACT     = `/repo/harness/dist-artifacts/mac-arm64/${APP_NAME}.app`,
    MAIN_EXE     = `${INSTALLED}/Contents/MacOS/${APP_NAME}`,
    HELPER_EXE   = `${INSTALLED}/Contents/Frameworks/${APP_NAME} Helper.app/Contents/MacOS/${APP_NAME} Helper`;

/**
 * One organism receipt as pack.mjs writes it: the build's only identity, the version label being
 * constant across development builds.
 */
function receipt(stagedAt, brain = 'aaaaaaa1111111', engine = 'bbbbbbb2222222') {
    return {
        electronVersion: '43.5.0',
        owners         : {
            brain  : {name: 'neo-agent-brain', revision: brain, version: '0.0.0'},
            engine : {name: 'neo.mjs', pin: `github:neomjs/neo#${engine}`, version: '13.1.0'},
            product: {name: 'neo-agent-institution', version: '0.1.0'}
        },
        rebuilt : true,
        stagedAt
    }
}

const
    slot      = (bundlePath, slotReceipt) => ({path: bundlePath, exists: slotReceipt !== null, receipt: slotReceipt}),
    OLD       = receipt('2026-10-01T14:21:46.232Z'),
    NEW       = receipt('2026-10-02T21:20:00.000Z', 'ccccccc3333333'),
    baseInput = () => ({
        artifact : slot(ARTIFACT, NEW),
        installed: slot(INSTALLED, OLD),
        rollback : slot(ROLLBACK, null)
    });

test.describe('harness/install.mjs — the plan', () => {
    test('a running Neo Harness is a refusal by default, and the refusal carries the peer warning', () => {
        const plan = planInstall({...baseInput(), running: [MAIN_EXE, HELPER_EXE]});

        expect(plan.ok).toBe(false);
        expect(plan.reason).toBe('running');
        expect(plan.detail[0]).toContain('2 processes');
        expect(plan.detail).toContain(PEER_QUIT_WARNING)
    });

    test('a Neo Harness running from outside the canonical bundle is refused by path, with or without --quit', () => {
        const stray = `${APPLICATIONS}/${APP_NAME}.previous-20260930-pre-649.app/Contents/MacOS/${APP_NAME}`;

        for (const flags of [{}, {quit: true}]) {
            const plan = planInstall({...baseInput(), running: [MAIN_EXE, stray], flags});

            expect(plan.ok, JSON.stringify(flags)).toBe(false);
            expect(plan.reason).toBe('running-off-canonical');
            expect(plan.detail).toContain(stray);
            expect(plan.detail).not.toContain(MAIN_EXE)
        }
    });

    test('--quit puts the orderly quit first and surfaces the warning; --open launches last', () => {
        const plan = planInstall({...baseInput(), running: [MAIN_EXE], flags: {open: true, quit: true}});

        expect(plan.ok).toBe(true);
        expect(plan.steps[0]).toEqual({type: 'quit', paths: [MAIN_EXE]});
        expect(plan.steps.at(-1)).toEqual({type: 'open', path: INSTALLED});
        expect(plan.warnings).toEqual([PEER_QUIT_WARNING])
    });

    test('a first install stages beside the destination and renames into place; nothing else is touched', () => {
        const plan = planInstall({...baseInput(), installed: slot(INSTALLED, null)});

        expect(plan.steps).toEqual([
            {type: 'stage',  from: ARTIFACT, to: `${INSTALLED}.installing`},
            {type: 'rename', from: `${INSTALLED}.installing`, to: INSTALLED},
            {type: 'verify', path: INSTALLED, receipt: NEW}
        ])
    });

    test('an update over a filled rollback slot replaces that slot — exactly one rollback, never a sibling in the applications folder', () => {
        const
            plan    = planInstall({...baseInput(), rollback: slot(ROLLBACK, receipt('2026-09-30T20:44:00.000Z'))}),
            targets = plan.steps.filter(step => step.to).map(step => step.to);

        expect(plan.steps).toEqual([
            {type: 'stage',  from: ARTIFACT, to: `${INSTALLED}.installing`},
            {type: 'remove', path: ROLLBACK},
            {type: 'rename', from: INSTALLED, to: ROLLBACK},
            {type: 'rename', from: `${INSTALLED}.installing`, to: INSTALLED},
            {type: 'verify', path: INSTALLED, receipt: NEW}
        ]);

        // Every path written under /Applications is the canonical bundle or its staging twin.
        expect(targets.filter(target => target.startsWith(`${APPLICATIONS}/`)).every(target => target === INSTALLED || target === `${INSTALLED}.installing`)).toBe(true);
        expect(targets.filter(target => target === ROLLBACK)).toHaveLength(1)
    });

    test('equal receipts are the idempotence key: already installed is an empty plan, not a rotation', () => {
        const plan = planInstall({...baseInput(), artifact: slot(ARTIFACT, structuredClone(OLD))});

        expect(plan.ok).toBe(true);
        expect(plan.steps).toEqual([]);
        expect(plan.note).toContain('already carries this receipt')
    });

    test('a missing bundle and a bundle without a receipt are distinct refusals', () => {
        expect(planInstall({...baseInput(), artifact: {path: ARTIFACT, exists: false, receipt: null}}).reason).toBe('artifact-missing');
        expect(planInstall({...baseInput(), artifact: {path: ARTIFACT, exists: true,  receipt: null}}).reason).toBe('artifact-receipt-missing')
    });

    test('--restore swaps the two slots with three renames and verifies the rollback receipt; an empty slot refuses', () => {
        const
            PREVIOUS = receipt('2026-09-30T20:44:00.000Z'),
            plan     = planInstall({...baseInput(), mode: 'restore', rollback: slot(ROLLBACK, PREVIOUS)});

        expect(plan.steps).toEqual([
            {type: 'rename', from: INSTALLED, to: `${INSTALLED}.restoring`},
            {type: 'rename', from: ROLLBACK, to: INSTALLED},
            {type: 'rename', from: `${INSTALLED}.restoring`, to: ROLLBACK},
            {type: 'verify', path: INSTALLED, receipt: PREVIOUS}
        ]);

        expect(planInstall({...baseInput(), mode: 'restore'}).reason).toBe('rollback-missing')
    });

    test('describeReceipt tells two builds apart by stagedAt, Brain and Engine — the version label cannot', () => {
        expect(describeReceipt(OLD)).toBe('staged 2026-10-01T14:21:46.232Z · Brain aaaaaaa · Engine bbbbbbb · product 0.1.0');
        expect(describeReceipt(NEW)).toContain('Brain ccccccc');
        expect(describeReceipt(null)).toBe('no receipt')
    })
});

test.describe('harness/install.mjs — the executor on real directories', () => {
    let root;

    /** A bundle is a directory carrying the receipt at the organism path. */
    function writeBundle(bundlePath, bundleReceipt) {
        const receiptPath = path.join(bundlePath, RECEIPT_RELATIVE_PATH);

        mkdirSync(path.dirname(receiptPath), {recursive: true});
        writeFileSync(path.join(bundlePath, 'Contents', 'marker.txt'), bundleReceipt.stagedAt);
        writeFileSync(receiptPath, JSON.stringify(bundleReceipt))
    }

    /** `ditto` stands in as a recursive copy; the install leg's own writes are real renames. */
    const runFn = calls => (command, args) => {
        calls.push({args, command});

        command === 'ditto' && cpSync(args[0], args[1], {recursive: true})
    };

    test.beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), 'install-leg-'))
    });

    test.afterEach(() => {
        rmSync(root, {force: true, recursive: true})
    });

    test('install then restore: the applications folder holds one bundle throughout, the displaced build sits in the rollback slot, and a restore swaps them back', () => {
        const
            applications = path.join(root, 'Applications'),
            rollbackDir  = path.join(root, 'rollback'),
            installed    = path.join(applications, `${APP_NAME}.app`),
            rollback     = path.join(rollbackDir, `${APP_NAME}.app`),
            artifact     = path.join(root, 'dist', 'mac-arm64', `${APP_NAME}.app`),
            calls        = [];

        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);

        const install = planInstall({artifact: readSlot(artifact), installed: readSlot(installed), rollback: readSlot(rollback)});

        executePlan(install.steps, {runFn: runFn(calls)});

        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`]);
        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readSlot(rollback).receipt).toEqual(OLD);
        expect(calls.map(call => call.command)).toEqual(['ditto']);

        const restore = planInstall({mode: 'restore', installed: readSlot(installed), rollback: readSlot(rollback)});

        executePlan(restore.steps, {runFn: runFn(calls)});

        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`]);
        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).receipt).toEqual(NEW)
    });

    test('a copy that lands without the artifact\'s receipt fails at verify, naming the step', () => {
        const
            applications = path.join(root, 'Applications'),
            installed    = path.join(applications, `${APP_NAME}.app`),
            rollback     = path.join(root, 'rollback', `${APP_NAME}.app`),
            artifact     = path.join(root, 'dist', 'mac-arm64', `${APP_NAME}.app`),
            corrupting   = (command, args) => {
                if (command === 'ditto') {
                    writeBundle(args[1], receipt('1970-01-01T00:00:00.000Z'))
                }
            };

        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);

        const plan = planInstall({artifact: readSlot(artifact), installed: readSlot(installed), rollback: readSlot(rollback)});

        expect(() => executePlan(plan.steps, {runFn: corrupting})).toThrow(/failed at "verify .*expected "staged 2026-10-02/)
    });

    test('custodyDigest is stable over untouched files and moves when one byte of a credential file does', () => {
        const custody = path.join(root, 'brain', 'fleet');

        mkdirSync(path.join(custody, 'agents', 'neo-opus-ada'), {recursive: true});
        writeFileSync(path.join(custody, 'registry.json'), '{"agents":{}}');
        writeFileSync(path.join(custody, 'credentials.enc'), Buffer.from([1, 2, 3]));
        writeFileSync(path.join(custody, 'agents', 'neo-opus-ada', 'seat.json'), '{}');

        const before = custodyDigest(custody);

        expect(before).toBe(custodyDigest(custody));
        writeFileSync(path.join(custody, 'credentials.enc'), Buffer.from([1, 2, 4]));
        expect(custodyDigest(custody)).not.toBe(before);
        expect(custodyDigest(path.join(root, 'nowhere'))).toBeNull()
    });

    test('legacyCopies lists only the hand-copied previous-* siblings; resolveArtifactPath requires exactly one mac* bundle', () => {
        const
            applications = path.join(root, 'Applications'),
            dist         = path.join(root, 'dist');

        writeBundle(path.join(applications, `${APP_NAME}.app`), NEW);
        writeBundle(path.join(applications, `${APP_NAME}.previous-20260930-pre-649.app`), OLD);
        writeBundle(path.join(applications, `${APP_NAME}.previous-20260926.app`), receipt('2026-09-25T21:52:00.000Z'));
        mkdirSync(path.join(applications, 'Other.app'));

        expect(legacyCopies(applications).map(copy => path.basename(copy.path))).toEqual([
            `${APP_NAME}.previous-20260926.app`,
            `${APP_NAME}.previous-20260930-pre-649.app`
        ]);

        expect(() => resolveArtifactPath(dist)).toThrow(/No packaged bundle/);
        writeBundle(path.join(dist, 'mac-arm64', `${APP_NAME}.app`), NEW);
        expect(resolveArtifactPath(dist)).toBe(path.join(dist, 'mac-arm64', `${APP_NAME}.app`));
        writeBundle(path.join(dist, 'mac', `${APP_NAME}.app`), NEW);
        expect(() => resolveArtifactPath(dist)).toThrow(/More than one/)
    })
});
