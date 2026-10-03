import {expect, test}                                                       from '@playwright/test';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir}                                                             from 'node:os';
import path                                                                 from 'node:path';
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
    resolveArtifactPath,
    ROLLBACK_BUNDLE_NAME,
    runningHarnessPaths
} from '../../../../harness/install.mjs';

const
    APPLICATIONS = '/Applications',
    INSTALLED    = `${APPLICATIONS}/${APP_NAME}.app`,
    PARKED       = `${INSTALLED}.restoring`,
    STAGED       = `${INSTALLED}.installing`,
    ROLLBACK     = `/Users/me/Library/Application Support/neo-harness/rollback/${ROLLBACK_BUNDLE_NAME}`,
    ARTIFACT     = `/repo/harness/dist-artifacts/mac-arm64/${APP_NAME}.app`,
    CUSTODY      = '/Users/me/Library/Application Support/neo-harness',
    MAIN_EXE     = `${INSTALLED}/Contents/MacOS/${APP_NAME}`,
    HELPER_EXE   = `${INSTALLED}/Contents/Frameworks/${APP_NAME} Helper.app/Contents/MacOS/${APP_NAME} Helper`,
    PREVIOUS_EXE = `/Users/me/archive/${APP_NAME}.previous-20260930-pre-649.app/Contents/MacOS/${APP_NAME}`,
    DIST_EXE     = `${ARTIFACT}/Contents/MacOS/${APP_NAME}`;

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
    PREVIOUS  = receipt('2026-09-30T20:44:00.000Z', 'ddddddd4444444'),
    baseInput = () => ({
        artifact : slot(ARTIFACT, NEW),
        installed: slot(INSTALLED, OLD),
        parked   : slot(PARKED, null),
        rollback : slot(ROLLBACK, null)
    }),
    types     = plan => plan.steps.map(step => step.type);

test.describe('harness/install.mjs — the plan', () => {
    test('a running Neo Harness is a refusal by default, and the refusal carries the peer warning', () => {
        const plan = planInstall({...baseInput(), running: [MAIN_EXE, HELPER_EXE]});

        expect(plan.ok).toBe(false);
        expect(plan.reason).toBe('running');
        expect(plan.detail[0]).toContain('2 processes');
        expect(plan.detail).toContain(PEER_QUIT_WARNING)
    });

    test('the process census reads every bundle named Neo Harness….app, and a renamed or dist copy is refused by path through that census, with and without --quit', () => {
        const
            ps      = [
                '/usr/sbin/cfprefsd',
                MAIN_EXE,
                HELPER_EXE,
                PREVIOUS_EXE,
                DIST_EXE,
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                ''
            ].join('\n'),
            running = runningHarnessPaths(ps);

        expect(running).toEqual([MAIN_EXE, HELPER_EXE, PREVIOUS_EXE, DIST_EXE]);

        for (const flags of [{}, {quit: true}]) {
            const plan = planInstall({...baseInput(), running, flags});

            expect(plan.ok, JSON.stringify(flags)).toBe(false);
            expect(plan.reason).toBe('running-off-canonical');
            expect(plan.detail).toContain(PREVIOUS_EXE);
            expect(plan.detail).toContain(DIST_EXE);
            expect(plan.detail).not.toContain(MAIN_EXE)
        }

        // The same census with only canonical processes is the ordinary running refusal.
        expect(planInstall({...baseInput(), running: runningHarnessPaths([MAIN_EXE, HELPER_EXE].join('\n'))}).reason).toBe('running')
    });

    test('--quit puts the orderly quit first, the custody baseline right after it, and the comparison before --open', () => {
        const
            plan  = planInstall({...baseInput(), running: [MAIN_EXE], flags: {open: true, quit: true}, custodyDir: CUSTODY}),
            order = types(plan);

        expect(plan.ok).toBe(true);
        expect(order.slice(0, 2)).toEqual(['quit', 'custody']);
        expect(plan.steps[0]).toEqual({type: 'quit', bundle: INSTALLED, paths: [MAIN_EXE]});
        expect(plan.steps[1]).toEqual({type: 'custody', phase: 'baseline', dir: CUSTODY});
        expect(order.slice(-2)).toEqual(['custody', 'open']);
        expect(plan.steps.at(-2)).toEqual({type: 'custody', phase: 'compare', dir: CUSTODY});
        expect(plan.warnings).toEqual([PEER_QUIT_WARNING])
    });

    test('a first install stages beside the destination, verifies the copy there, and renames into place; nothing else is touched', () => {
        const plan = planInstall({...baseInput(), installed: slot(INSTALLED, null)});

        expect(plan.steps).toEqual([
            {type: 'stage',  from: ARTIFACT, to: STAGED},
            {type: 'verify', path: STAGED, receipt: NEW},
            {type: 'rename', from: STAGED, to: INSTALLED},
            {type: 'verify', path: INSTALLED, receipt: NEW}
        ])
    });

    test('an update verifies the staged copy before any slot moves, then replaces the rollback slot — exactly one rollback, never a sibling in the applications folder', () => {
        const
            plan    = planInstall({...baseInput(), rollback: slot(ROLLBACK, PREVIOUS)}),
            targets = plan.steps.filter(step => step.to).map(step => step.to);

        expect(plan.steps).toEqual([
            {type: 'stage',  from: ARTIFACT, to: STAGED},
            {type: 'verify', path: STAGED, receipt: NEW},
            {type: 'remove', path: ROLLBACK},
            {type: 'rename', from: INSTALLED, to: ROLLBACK},
            {type: 'rename', from: STAGED, to: INSTALLED},
            {type: 'verify', path: INSTALLED, receipt: NEW}
        ]);

        expect(targets.filter(target => target.startsWith(`${APPLICATIONS}/`)).every(target => target === INSTALLED || target === STAGED)).toBe(true);
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
        const plan = planInstall({...baseInput(), mode: 'restore', rollback: slot(ROLLBACK, PREVIOUS)});

        expect(plan.steps).toEqual([
            {type: 'rename', from: INSTALLED, to: PARKED},
            {type: 'rename', from: ROLLBACK, to: INSTALLED},
            {type: 'rename', from: PARKED, to: ROLLBACK},
            {type: 'verify', path: INSTALLED, receipt: PREVIOUS}
        ]);

        expect(planInstall({...baseInput(), mode: 'restore'}).reason).toBe('rollback-missing')
    });

    test('a parked bundle is an interrupted restore: the plan completes it toward the empty slot and stops, and refuses when both slots are full', () => {
        // Interrupted after the first rename: the installed slot is empty, the bundle goes back.
        const back = planInstall({...baseInput(), mode: 'restore', installed: slot(INSTALLED, null), parked: slot(PARKED, NEW), rollback: slot(ROLLBACK, PREVIOUS)});

        expect(back.steps).toEqual([
            {type: 'rename', from: PARKED, to: INSTALLED},
            {type: 'verify', path: INSTALLED, receipt: NEW}
        ]);
        expect(back.note).toContain('Re-run for a swap');

        // Interrupted after the second rename: the restore is in place, the parked bundle becomes the rollback.
        const forward = planInstall({...baseInput(), mode: 'install', installed: slot(INSTALLED, PREVIOUS), parked: slot(PARKED, NEW)});

        expect(forward.steps).toEqual([
            {type: 'rename', from: PARKED, to: ROLLBACK},
            {type: 'verify', path: INSTALLED, receipt: PREVIOUS}
        ]);

        expect(planInstall({...baseInput(), parked: slot(PARKED, NEW), rollback: slot(ROLLBACK, PREVIOUS)}).reason).toBe('interrupted-restore-ambiguous')
    });

    test('describeReceipt tells two builds apart by stagedAt, Brain and Engine — the version label cannot', () => {
        expect(describeReceipt(OLD)).toBe('staged 2026-10-01T14:21:46.232Z · Brain aaaaaaa · Engine bbbbbbb · product 0.1.0');
        expect(describeReceipt(NEW)).toContain('Brain ccccccc');
        expect(describeReceipt(null)).toBe('no receipt')
    })
});

test.describe('harness/install.mjs — the executor on real directories', () => {
    let root, applications, userData, custody, installed, parked, rollback, artifact;

    /** A bundle is a directory carrying the receipt at the organism path. */
    function writeBundle(bundlePath, bundleReceipt) {
        const receiptPath = path.join(bundlePath, RECEIPT_RELATIVE_PATH);

        mkdirSync(path.dirname(receiptPath), {recursive: true});
        writeFileSync(path.join(bundlePath, 'Contents', 'marker.txt'), bundleReceipt.stagedAt);
        writeFileSync(receiptPath, JSON.stringify(bundleReceipt))
    }

    /**
     * A userData root as the installed app leaves it: the plane record at the root, the fleet root's
     * files, and one seat home that is a checkout with a directory link INTO the bundle's organism.
     */
    function writeCustody() {
        const home = path.join(custody, 'agents', 'neo-opus-ada', 'neomjs', 'neo');

        mkdirSync(path.join(home, '.neo-ai-data'), {recursive: true});
        mkdirSync(path.join(root, 'organism', 'sqlite'), {recursive: true});
        writeFileSync(path.join(userData, 'plane.json'), '{"base":"https://plane.example"}');
        writeFileSync(path.join(userData, 'plane-bearer.bin'), Buffer.from([7, 7, 7]));
        writeFileSync(path.join(custody, 'registry.json'), '{"agents":{}}');
        writeFileSync(path.join(custody, 'credentials.enc'), Buffer.from([1, 2, 3]));
        writeFileSync(path.join(custody, 'fleet.key'), Buffer.from([4, 4]));
        writeFileSync(path.join(home, 'seat.json'), '{}');
        writeFileSync(path.join(root, 'organism', 'sqlite', 'storage.db'), 'rows-v1');
        symlinkSync(path.join(root, 'organism', 'sqlite'), path.join(home, '.neo-ai-data', 'sqlite'))
    }

    /** The slots as the CLI reads them from disk, for a re-plan after an interruption. */
    const slots = () => ({artifact: readSlot(artifact), installed: readSlot(installed), parked: readSlot(parked), rollback: readSlot(rollback)});

    /** `ditto` stands in as a recursive copy; the install leg's own writes are real renames. */
    const runFn = (calls, hooks = {}) => (command, args) => {
        calls.push({args, command});
        command === 'ditto' && cpSync(args[0], args[1], {recursive: true});
        hooks[command]?.(args)
    };

    test.beforeEach(() => {
        root         = mkdtempSync(path.join(tmpdir(), 'install-leg-'));
        applications = path.join(root, 'Applications');
        userData     = path.join(root, 'userData');
        custody      = path.join(userData, 'brain', 'fleet');
        installed    = path.join(applications, `${APP_NAME}.app`);
        parked       = `${installed}.restoring`;
        rollback     = path.join(root, 'rollback', ROLLBACK_BUNDLE_NAME);
        artifact     = path.join(root, 'dist', 'mac-arm64', `${APP_NAME}.app`)
    });

    test.afterEach(() => {
        rmSync(root, {force: true, recursive: true})
    });

    test('install then restore: the applications folder holds one bundle throughout, the displaced build sits in the rollback slot, and a restore swaps them back', () => {
        const calls = [];

        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);

        executePlan(planInstall(slots()).steps, {runFn: runFn(calls)});

        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`]);
        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readSlot(rollback).receipt).toEqual(OLD);
        expect(calls.map(call => call.command)).toEqual(['ditto']);

        executePlan(planInstall({...slots(), mode: 'restore'}).steps, {runFn: runFn(calls)});

        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`]);
        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).receipt).toEqual(NEW);

        // A second restore returns to the start.
        executePlan(planInstall({...slots(), mode: 'restore'}).steps, {runFn: runFn(calls)});
        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readSlot(rollback).receipt).toEqual(OLD)
    });

    test('a copy that lands without the artifact\'s receipt fails at the staged verify, and both slots still hold what they held', () => {
        writeBundle(installed, OLD);
        writeBundle(rollback, PREVIOUS);
        writeBundle(artifact, NEW);

        const corrupting = (command, args) => {
            command === 'ditto' && writeBundle(args[1], receipt('1970-01-01T00:00:00.000Z'))
        };

        expect(() => executePlan(planInstall(slots()).steps, {runFn: corrupting}))
            .toThrow(/failed at "verify .*\.installing .*expected "staged 2026-10-02/);

        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).receipt).toEqual(PREVIOUS)
    });

    test('a restore interrupted at either rename boundary is completed by the next run from what it finds on disk, and nothing is lost', () => {
        const calls = [];

        // After the first rename: installed empty, the bundle parked, the rollback untouched.
        writeBundle(installed, NEW);
        writeBundle(rollback, OLD);

        let plan = planInstall({...slots(), mode: 'restore'});

        executePlan(plan.steps.slice(0, 1), {runFn: runFn(calls)});
        expect(readSlot(installed).exists).toBe(false);
        expect(readSlot(parked).receipt).toEqual(NEW);

        plan = planInstall({...slots(), mode: 'restore'});
        expect(plan.note).toContain('completes it');
        executePlan(plan.steps, {runFn: runFn(calls)});

        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readSlot(rollback).receipt).toEqual(OLD);
        expect(readSlot(parked).exists).toBe(false);

        // After the second rename: the restore is in place, the parked bundle has no slot yet.
        plan = planInstall({...slots(), mode: 'restore'});
        executePlan(plan.steps.slice(0, 2), {runFn: runFn(calls)});
        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).exists).toBe(false);
        expect(readSlot(parked).receipt).toEqual(NEW);

        plan = planInstall({...slots(), mode: 'restore'});
        executePlan(plan.steps, {runFn: runFn(calls)});

        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).receipt).toEqual(NEW);
        expect(readSlot(parked).exists).toBe(false);
        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`])
    });

    test('the custody baseline is taken after the app\'s own shutdown write, and a change during the replacement stops the run before --open', () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        writeCustody();

        // A lifecycle write during the orderly quit is the app's: the baseline comes after it.
        const
            shutdownWrite = [],
            quiet         = runFn(shutdownWrite, {osascript: () => writeFileSync(path.join(custody, 'registry.json'), '{"agents":{},"lastQuit":1}')}),
            running       = [`${installed}/Contents/MacOS/${APP_NAME}`],
            gone          = () => [];

        let plan = planInstall({...slots(), running, flags: {quit: true, open: true}, custodyDir: userData});

        const {custody: digest} = executePlan(plan.steps, {runFn: quiet, runningFn: gone});

        expect(digest.before).toBe(digest.after);
        expect(shutdownWrite.map(call => call.command)).toEqual(['osascript', 'ditto', 'open']);
        // The quit addresses the canonical bundle by path, never by the shared bundle identifier.
        expect(shutdownWrite[0].args).toEqual(['-e', `tell application "${installed}" to quit`]);

        // A write while the slots move is NOT the app's: the comparison fails and nothing relaunches.
        const
            installerWrite = [],
            tampering      = runFn(installerWrite, {ditto: () => writeFileSync(path.join(custody, 'credentials.enc'), Buffer.from([9, 9, 9]))});

        writeBundle(artifact, receipt('2026-10-03T07:00:00.000Z', 'eeeeeee5555555'));
        plan = planInstall({...slots(), flags: {open: true}, custodyDir: userData});

        expect(() => executePlan(plan.steps, {runFn: tampering})).toThrow(/failed at "compare the custody set.*changed while the app was stopped/);
        expect(installerWrite.map(call => call.command)).not.toContain('open')
    });

    test('custodyDigest reads the plane record, the fleet root and seat presence — never a seat home\'s contents, never through a link', () => {
        writeCustody();

        const before = custodyDigest(userData);

        expect(before).toBe(custodyDigest(userData));

        // What a real install changes, and must not count: the organism behind a seat home's link.
        writeFileSync(path.join(root, 'organism', 'sqlite', 'storage.db'), 'rows-v2-from-the-new-bundle');
        expect(custodyDigest(userData), 'a change behind a seat home\'s link is not custody').toBe(before);

        // What a seat does to its own home, and must not count.
        writeFileSync(path.join(custody, 'agents', 'neo-opus-ada', 'neomjs', 'neo', 'seat.json'), '{"turns":1}');
        expect(custodyDigest(userData), 'a seat home\'s own file is not custody').toBe(before);

        // What IS custody: one byte of a fleet-root file, one byte of the plane record, a seat's presence,
        // and a depth-1 link's target string.
        writeFileSync(path.join(custody, 'credentials.enc'), Buffer.from([1, 2, 4]));
        const afterCredential = custodyDigest(userData);
        expect(afterCredential, 'a credential byte moves it').not.toBe(before);

        writeFileSync(path.join(userData, 'plane.json'), '{"base":"https://other.example"}');
        const afterPlane = custodyDigest(userData);
        expect(afterPlane, 'the plane record moves it').not.toBe(afterCredential);

        mkdirSync(path.join(custody, 'agents', 'neo-gpt-sophie'));
        const afterSeat = custodyDigest(userData);
        expect(afterSeat, 'a seat appearing moves it').not.toBe(afterPlane);

        symlinkSync(path.join(root, 'elsewhere-a'), path.join(custody, 'shared'));
        const afterLink = custodyDigest(userData);
        expect(afterLink, 'a depth-1 link counts by its target string').not.toBe(afterSeat);
        rmSync(path.join(custody, 'shared'));
        symlinkSync(path.join(root, 'elsewhere-b'), path.join(custody, 'shared'));
        expect(custodyDigest(userData), 'a retargeted depth-1 link moves it').not.toBe(afterLink);

        expect(custodyDigest(path.join(root, 'nowhere')), 'no member at all is the empty set').toBeNull()
    });

    test('the plane record is custody without a fleet root, and every selected path — a plane file, the fleet root itself — is read as what it IS: a link by its target string, never followed', () => {
        // A plane record written before any Fleet directory exists (planeConfig writes it alone).
        const planeOnly = path.join(root, 'plane-only');

        mkdirSync(planeOnly, {recursive: true});
        writeFileSync(path.join(planeOnly, 'plane.json'), '{"base":"https://plane.example"}');

        const before = custodyDigest(planeOnly);

        expect(before, 'a plane record alone is a custody set').not.toBeNull();
        writeFileSync(path.join(planeOnly, 'plane.json'), '{"base":"https://plane.example","viewer":"@me"}');
        expect(custodyDigest(planeOnly), 'a plane byte moves it without a fleet root').not.toBe(before);

        // A linked plane file: the link string is custody, its target's bytes are not.
        const linked = path.join(root, 'linked');

        mkdirSync(path.join(linked, 'elsewhere'), {recursive: true});
        writeFileSync(path.join(linked, 'elsewhere', 'bearer.bin'), Buffer.from([1]));
        symlinkSync(path.join(linked, 'elsewhere', 'bearer.bin'), path.join(linked, 'plane-bearer.bin'));

        const linkedBefore = custodyDigest(linked);

        writeFileSync(path.join(linked, 'elsewhere', 'bearer.bin'), Buffer.from([2]));
        expect(custodyDigest(linked), 'bytes behind a linked plane file are not read').toBe(linkedBefore);
        rmSync(path.join(linked, 'plane-bearer.bin'));
        symlinkSync(path.join(linked, 'elsewhere', 'other.bin'), path.join(linked, 'plane-bearer.bin'));
        expect(custodyDigest(linked), 'a retargeted (and dangling) plane link moves it').not.toBe(linkedBefore);

        // A linked fleet root: custody by its target string alone, never entered.
        const rootLinked = path.join(root, 'root-linked');

        mkdirSync(path.join(rootLinked, 'brain'), {recursive: true});
        mkdirSync(path.join(root, 'foreign-fleet'), {recursive: true});
        writeFileSync(path.join(root, 'foreign-fleet', 'registry.json'), '{"agents":{}}');
        symlinkSync(path.join(root, 'foreign-fleet'), path.join(rootLinked, 'brain', 'fleet'));

        const rootLinkedBefore = custodyDigest(rootLinked);

        expect(rootLinkedBefore, 'a linked fleet root is a custody member').not.toBeNull();
        writeFileSync(path.join(root, 'foreign-fleet', 'registry.json'), '{"agents":{"x":1}}');
        expect(custodyDigest(rootLinked), 'a linked fleet root is not entered').toBe(rootLinkedBefore)
    });

    test('legacyCopies lists only the hand-copied previous-* siblings; resolveArtifactPath requires exactly one mac* bundle', () => {
        const dist = path.join(root, 'dist');

        writeBundle(installed, NEW);
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
