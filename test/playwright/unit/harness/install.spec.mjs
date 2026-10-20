import {expect, test}                                                                                  from '@playwright/test';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import fs                                                                                              from 'node:fs';
import {tmpdir, userInfo}                                                                              from 'node:os';
import path                                                                                            from 'node:path';
import {spawn}                                                                                         from 'node:child_process';
import {once}                                                                                          from 'node:events';
import {
    APP_NAME,
    custodyDigest,
    inspectManagedCustody,
    holdInstallTransaction,
    DEFAULT_INSTALL_TRANSACTION_DIR,
    describeReceipt,
    executePlan as executePlanImpl,
    legacyCopies,
    PEER_QUIT_WARNING,
    planInstall,
    parseInstallArgs,
    prepareInstallContinuity,
    readSlot,
    RECEIPT_RELATIVE_PATH,
    resolveArtifactPath,
    ROLLBACK_BUNDLE_NAME,
    runningHarnessPaths
} from '../../../../harness/install.mjs';
import {isAdmissionSnapshot, openLaunchAdmissionJournal, readLaunchAdmissionJournal} from 'neo-agent-brain/launch-admission-journal';

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
    operations = plan => plan.steps.filter(step => !['bind-slots', 'publish-protection'].includes(step.type)),
    types      = plan => operations(plan).map(step => step.type);

/** @summary Isolates the process census while retaining the real executor and filesystem operations. */
const executePlan = (steps, options = {}) => executePlanImpl(steps, {
    runningFn     : () => [], continuityFn: async () => ({hold: () => null}), transactionFn: () => null,
    publishSlotsFn: () => null, ...options
});

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
        expect(operations(plan)[0]).toEqual({type: 'quit', bundle: INSTALLED, paths: [MAIN_EXE]});
        expect(operations(plan)[1]).toEqual({type: 'custody', phase: 'baseline', dir: CUSTODY});
        expect(order.slice(-2)).toEqual(['custody', 'open']);
        expect(plan.steps.at(-3)).toEqual({type: 'custody', phase: 'compare', dir: CUSTODY});
        expect(plan.steps.at(-2)).toEqual({type: 'publish-protection'});
        expect(plan.warnings).toEqual([PEER_QUIT_WARNING])
    });

    test('a first install stages beside the destination, verifies the copy there, and renames into place; nothing else is touched', () => {
        const plan = planInstall({...baseInput(), installed: slot(INSTALLED, null)});

        expect(operations(plan)).toEqual([
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

        expect(operations(plan)).toEqual([
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

        expect(operations(plan)).toEqual([
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

        expect(operations(back)).toEqual([
            {type: 'rename', from: PARKED, to: INSTALLED},
            {type: 'verify', path: INSTALLED, receipt: NEW}
        ]);
        expect(back.note).toContain('Re-run for a swap');

        // Interrupted after the second rename: the restore is in place, the parked bundle becomes the rollback.
        const forward = planInstall({...baseInput(), mode: 'install', installed: slot(INSTALLED, PREVIOUS), parked: slot(PARKED, NEW)});

        expect(operations(forward)).toEqual([
            {type: 'rename', from: PARKED, to: ROLLBACK},
            {type: 'verify', path: INSTALLED, receipt: PREVIOUS}
        ]);

        expect(planInstall({...baseInput(), parked: slot(PARKED, NEW), rollback: slot(ROLLBACK, PREVIOUS)}).reason).toBe('interrupted-restore-ambiguous')
    });

    test('describeReceipt keeps older receipts readable when the product revision is missing', () => {
        expect(describeReceipt(OLD)).toBe('staged 2026-10-01T14:21:46.232Z · Brain aaaaaaa · Engine bbbbbbb · product 0.1.0 @ ?');
        expect(describeReceipt(NEW)).toContain('Brain ccccccc');
        expect(describeReceipt(null)).toBe('no receipt')
    });

    test('describeReceipt distinguishes builds differing only in product revision and preserves unknown', () => {
        for (const [revision, expected] of [['eeeeeee5555555', 'eeeeeee'], ['fffffff6666666', 'fffffff'], [null, '?']]) {
            const build = {...OLD, owners: {...OLD.owners, product: {...OLD.owners.product, revision}}};

            expect(describeReceipt(build)).toBe(`staged 2026-10-01T14:21:46.232Z · Brain aaaaaaa · Engine bbbbbbb · product 0.1.0 @ ${expected}`)
        }
    });

    test('describeReceipt names the Engine by its installed revision when the pin names the branch it tracks', () => {
        const build = {...OLD, owners: {...OLD.owners, engine: {name: 'neo.mjs', pin: 'github:neomjs/neo#dev', revision: '7aae7c3166b7fc35', version: '13.1.0'}}};

        expect(describeReceipt(build)).toContain('Engine 7aae7c3 ·')
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

    /** @summary Uses the production journal with only the package capability probe replaced for tiny bundles. */
    const prepareContinuity  = step => prepareInstallContinuity(step, {inspectSupport: async () => ({kind: 'generation'})});
    const snapshot           = {version: 6, generations: [], seats: []};
    const admissionDirectory = () => path.join(custody, 'launch-admission');
    const openIssuer         = () => openLaunchAdmissionJournal({directory: admissionDirectory(),
        validateSnapshot: isAdmissionSnapshot, emptySnapshot: snapshot});
    const transactionDirectory = () => path.join(root, 'account-installer');
    const transactionFn        = () => holdInstallTransaction({directory: transactionDirectory()});

    /** `ditto` stands in as a recursive copy; the install leg's own writes are real renames. */
    const runFn = (calls, hooks = {}) => (command, args) => {
        calls.push({args, command});
        command === 'ditto' && cpSync(args[0], args[1], {recursive: true});
        hooks[command]?.(args)
    };

    test.beforeEach(() => {
        root         = realpathSync(mkdtempSync(path.join(tmpdir(), 'install-leg-')));
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

    test('install then restore: the applications folder holds one bundle throughout, the displaced build sits in the rollback slot, and a restore swaps them back', async () => {
        const calls = [];

        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);

        await executePlan(planInstall(slots()).steps, {runFn: runFn(calls)});

        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`]);
        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readSlot(rollback).receipt).toEqual(OLD);
        expect(calls.map(call => call.command)).toEqual(['ditto']);

        await executePlan(planInstall({...slots(), mode: 'restore'}).steps, {runFn: runFn(calls)});

        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`]);
        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).receipt).toEqual(NEW);

        // A second restore returns to the start.
        await executePlan(planInstall({...slots(), mode: 'restore'}).steps, {runFn: runFn(calls)});
        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readSlot(rollback).receipt).toEqual(OLD)
    });

    test('a copy that lands without the artifact\'s receipt fails at the staged verify, and both slots still hold what they held', async () => {
        writeBundle(installed, OLD);
        writeBundle(rollback, PREVIOUS);
        writeBundle(artifact, NEW);

        const corrupting = (command, args) => {
            command === 'ditto' && writeBundle(args[1], receipt('1970-01-01T00:00:00.000Z'))
        };

        await expect(executePlan(planInstall(slots()).steps, {runFn: corrupting}))
            .rejects.toThrow(/failed at "verify .*\.installing .*expected "staged 2026-10-02/);

        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).receipt).toEqual(PREVIOUS)
    });

    test('a restore interrupted at either rename boundary is completed by the next run from what it finds on disk, and nothing is lost', async () => {
        const calls = [];

        // After the first rename: installed empty, the bundle parked, the rollback untouched.
        writeBundle(installed, NEW);
        writeBundle(rollback, OLD);

        let plan = planInstall({...slots(), mode: 'restore'});

        await executePlan(plan.steps.slice(0, 2), {runFn: runFn(calls)});
        expect(readSlot(installed).exists).toBe(false);
        expect(readSlot(parked).receipt).toEqual(NEW);

        plan = planInstall({...slots(), mode: 'restore'});
        expect(plan.note).toContain('completes it');
        await executePlan(plan.steps, {runFn: runFn(calls)});

        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readSlot(rollback).receipt).toEqual(OLD);
        expect(readSlot(parked).exists).toBe(false);

        // After the second rename: the restore is in place, the parked bundle has no slot yet.
        plan = planInstall({...slots(), mode: 'restore'});
        await executePlan(plan.steps.slice(0, 3), {runFn: runFn(calls)});
        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).exists).toBe(false);
        expect(readSlot(parked).receipt).toEqual(NEW);

        plan = planInstall({...slots(), mode: 'restore'});
        await executePlan(plan.steps, {runFn: runFn(calls)});

        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(rollback).receipt).toEqual(NEW);
        expect(readSlot(parked).exists).toBe(false);
        expect(readdirSync(applications)).toEqual([`${APP_NAME}.app`])
    });

    test('the custody baseline is taken after the app\'s own shutdown write, and a change during the replacement stops the run before --open', async () => {
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

        const materializeFn     = async () => ({id: 'fixture'});
        const {custody: digest} = await executePlan(plan.steps, {runFn: quiet, runningFn: gone, materializeFn});

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

        await expect(executePlan(plan.steps, {runFn: tampering, materializeFn})).rejects.toThrow(/failed at "compare the custody set.*changed while the app was stopped/);
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

    test('a second plan from the same predecessor refuses before staging cleanup or slot mutation', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        writeBundle(rollback, PREVIOUS);
        const first = planInstall(slots()), second = planInstall(slots());
        await executePlan(first.steps, {runFn: runFn([])});
        const staged = `${installed}.installing`;
        writeBundle(staged, PREVIOUS);
        const before = slots(), calls = [];
        await expect(executePlan(second.steps, {runFn: runFn(calls)})).rejects.toThrow(/planned package slot changed/);
        expect(calls).toEqual([]);
        expect(slots()).toEqual(before);
        expect(readSlot(staged).receipt).toEqual(PREVIOUS);
    });

    test('a slot changed during asynchronous materialization refuses before any package rotation', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        writeBundle(rollback, PREVIOUS);
        const plan = planInstall({...slots(), custodyDir: userData, flags: {open: true}}), calls = [];
        await expect(executePlan(plan.steps, {runFn: runFn(calls), materializeFn: async () => {
            await Promise.resolve();
            writeBundle(installed, PREVIOUS);
            return {id: 'fixture'};
        }})).rejects.toThrow(/planned package slot changed/);
        expect(readSlot(installed).receipt).toEqual(PREVIOUS);
        expect(readSlot(rollback).receipt).toEqual(PREVIOUS);
        expect(calls.map(call => call.command)).toEqual(['ditto']);
    });

    test('stale restore and interrupted-restore plans refuse without changing their completed result', async () => {
        writeBundle(installed, NEW);
        writeBundle(rollback, OLD);
        let first = planInstall({...slots(), mode: 'restore'}), stale = structuredClone(first);
        await executePlan(first.steps, {runFn: runFn([])});
        let before = slots();
        await expect(executePlan(stale.steps, {runFn: runFn([])})).rejects.toThrow(/planned package slot changed/);
        expect(slots()).toEqual(before);

        rmSync(installed, {recursive: true});
        writeBundle(parked, OLD);
        first = planInstall({...slots(), mode: 'restore'});
        stale = structuredClone(first);
        await executePlan(first.steps, {runFn: runFn([])});
        before = slots();
        await expect(executePlan(stale.steps, {runFn: runFn([])})).rejects.toThrow(/planned package slot changed/);
        expect(slots()).toEqual(before);
    });

    test('a bundle process appearing after Quit refuses before staging cleanup and reopens the app it quit', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const staged = `${installed}.installing`;
        writeBundle(staged, PREVIOUS);
        const running = [path.join(installed, 'Contents/MacOS', APP_NAME)];
        const plan    = planInstall({...slots(), running, flags: {quit: true, open: true}}), calls = [];
        let   reads   = 0;
        const error   = await executePlan(plan.steps, {runFn: runFn(calls), runningFn: () => ++reads === 1 ? [] : running}).catch(caught => caught);
        expect(error.message.split('\n')).toEqual([
            'Update stopped before the Fleet Manager was replaced.',
            'Reason: checking that nothing still holds the old bundle failed.',
            '  bundle users appeared after planning or Quit; refusing package mutation',
            'Nothing was changed, and your Fleet Manager is open again.',
            `Next: quit ${APP_NAME}, then run the same install command again.`
        ]);
        expect(calls.map(call => [call.command, ...call.args.slice(0, 1)])).toEqual([['osascript', '-e'], ['open', '-a']]);
        expect(calls[1].args[1]).toBe(installed);
        expect(readSlot(installed).receipt).toEqual(OLD);
        expect(readSlot(staged).receipt).toEqual(PREVIOUS);
    });

    for (const arm of [
        {
            name    : 'a planned slot changing after Quit',
            custody : false,
            options : calls => ({runFn: runFn(calls, {osascript: () => writeBundle(installed, PREVIOUS)})}),
            reason  : 'Reason: checking the planned install slot failed.',
            detail  : () => `  planned package slot changed: ${installed}; rebuild the plan before retrying`,
            next    : 'Next: run the same install command again.',
            commands: ['osascript', 'open']
        },
        {
            name    : 'a continuity guard refusal after Quit',
            custody : true,
            options : calls => ({runFn: runFn(calls), continuityFn: async () => ({hold() { throw new Error('Launch admission journal refused: held') }})}),
            reason  : 'Reason: checking running-seat continuity failed.',
            detail  : () => '  Launch admission journal refused: held',
            next    : 'Next: run the same install command again.',
            commands: ['osascript', 'open']
        },
        {
            name    : 'a stage copy failure after Quit',
            custody : false,
            options : calls => ({runFn: runFn(calls, {ditto: () => { throw new Error(`ENOSPC: no space left on device, copyfile '${installed}.installing'`) }})}),
            reason  : 'Reason: copying the new bundle beside the installed one failed.',
            detail  : () => `  ENOSPC: no space left on device, copyfile '${installed}.installing'`,
            next    : 'Next: run the same install command again; the error names the path.',
            commands: ['osascript', 'ditto', 'open']
        },
        {
            name    : 'a staged verify mismatch after Quit',
            custody : false,
            options : calls => ({
                runFn: (command, args) => {
                    calls.push({args, command});
                    command === 'ditto' && writeBundle(args[1], receipt('1970-01-01T00:00:00.000Z'));
                }
            }),
            reason  : 'Reason: verifying the staged bundle failed.',
            detail  : () => expect.stringMatching(/^  carries "staged 1970-01-01.*, expected "staged 2026-10-02/),
            next    : 'Next: rebuild the candidate, then run the install again.',
            commands: ['osascript', 'ditto', 'open']
        },
        {
            name    : 'a runtime prepare failure after Quit',
            custody : true,
            options : calls => ({runFn: runFn(calls), materializeFn: async () => { throw new Error('ENOSPC: no space left on device, copyfile runtime/server.mjs') }}),
            reason  : 'Reason: preparing the verified runtime failed.',
            detail  : () => '  ENOSPC: no space left on device, copyfile runtime/server.mjs',
            next    : 'Next: run the same install command again; the log names the file if it stops here twice.',
            commands: ['osascript', 'ditto', 'open']
        }
    ]) {
        test(`${arm.name} reopens the app with its step reason, verbatim error, and next action`, async () => {
            writeBundle(installed, OLD);
            writeBundle(artifact, NEW);
            const running = [path.join(installed, 'Contents/MacOS', APP_NAME)], calls = [];
            const plan    = planInstall({...slots(), ...(arm.custody ? {custodyDir: userData} : {}), running, flags: {quit: true}});
            const error   = await executePlan(plan.steps, arm.options(calls)).catch(caught => caught);
            expect(error.message.split('\n')).toEqual([
                'Update stopped before the Fleet Manager was replaced.',
                arm.reason,
                arm.detail(),
                'Nothing was changed, and your Fleet Manager is open again.',
                arm.next
            ]);
            expect(calls.map(call => call.command)).toEqual(arm.commands);
        });
    }

    test('a failed reopen after a stopped update is reported with its own next step, never swallowed', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const running = [path.join(installed, 'Contents/MacOS', APP_NAME)];
        const plan    = planInstall({...slots(), running, flags: {quit: true}}), calls = [];
        let   reads   = 0;
        const error   = await executePlan(plan.steps, {runningFn: () => ++reads === 1 ? [] : running,
            runFn: runFn(calls, {open: () => { throw new Error('LSOpenURLsWithRole() failed') }})}).catch(caught => caught);
        expect(error.message.split('\n')).toEqual([
            'Update stopped before the Fleet Manager was replaced.',
            'Reason: checking that nothing still holds the old bundle failed.',
            '  bundle users appeared after planning or Quit; refusing package mutation',
            'Nothing was changed, but reopening the Fleet Manager failed: LSOpenURLsWithRole() failed.',
            `Next: open "${installed}", then run the same install command again.`
        ]);
        expect(error.cause.message).toMatch(/bundle users appeared/)
    });

    test('a refusal before the quit reopens nothing and keeps its own words', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const running = [path.join(installed, 'Contents/MacOS', APP_NAME)];
        const plan    = planInstall({...slots(), running, flags: {quit: true, open: true}}), calls = [];
        await expect(executePlan(plan.steps, {runFn: runFn(calls), continuityFn: async () => { throw new Error('continuity unavailable') }}))
            .rejects.toThrow(/^failed at ".*": continuity unavailable$/);
        expect(calls).toEqual([])
    });

    test('missing receipts cannot authorize restore, interrupted recovery or an absent-slot verification', async () => {
        writeBundle(installed, OLD);
        mkdirSync(rollback, {recursive: true});
        expect(planInstall({...slots(), mode: 'restore'})).toMatchObject({ok: false, reason: 'rollback-receipt-missing'});
        mkdirSync(parked, {recursive: true});
        expect(planInstall({...slots(), mode: 'restore'})).toMatchObject({ok: false, reason: 'parked-receipt-missing'});
        await expect(executePlan([{type: 'verify', path: path.join(root, 'absent.app'), receipt: null}]))
            .rejects.toThrow(/complete package receipts are required/);
    });

    test('first-install custody observation includes retained runtimes omitted from the ordinary digest', () => {
        expect(inspectManagedCustody(userData).state).toBe('absent');
        expect(readSlot(installed).exists).toBe(false);
        mkdirSync(path.join(userData, 'brain/runtime/retained-generation'), {recursive: true});
        writeFileSync(path.join(userData, 'brain/runtime/retained-generation/generation.json'), '{"fixture":true}');
        expect(custodyDigest(userData)).toBeNull();
        expect(inspectManagedCustody(userData)).toMatchObject({state: 'present', locations: expect.arrayContaining([
            {path: 'brain/runtime', kind: 'directory'}
        ])});
    });

    test('linked or unreadable managed paths cannot appear absent and observation creates nothing', () => {
        mkdirSync(userData);
        const before = readdirSync(userData);
        expect(inspectManagedCustody(userData).state).toBe('absent');
        expect(readdirSync(userData)).toEqual(before);
        symlinkSync(path.join(root, 'missing-brain'), path.join(userData, 'brain'));
        expect(inspectManagedCustody(userData).state).toBe('unknown');
        rmSync(path.join(userData, 'brain'));
        const probe = inspectManagedCustody(userData, {fileSystem: {
            ...fs,
            lstatSync(file) {
                if (file === path.join(userData, 'plane.json')) throw Object.assign(Error('fixture denied'), {code: 'EACCES'});
                return fs.lstatSync(file);
            }
        }});
        expect(probe.state).toBe('unknown');
        expect(readdirSync(userData)).toEqual(before);
    });

    test('production continuity never infers legacy from a missing capable-source journal', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const calls = [];
        const plan  = planInstall({...slots(), custodyDir: userData, running: [MAIN_EXE.replace(INSTALLED, installed)], flags: {quit: true, legacyMigration: true}});
        await expect(executePlan(plan.steps, {runFn: runFn(calls), continuityFn: prepareContinuity}))
            .rejects.toThrow(/generation-capable source has no admission journal/);
        expect(calls).toEqual([]);
        await expect(prepareInstallContinuity({sourceBundle: installed, destinationBundle: artifact, custodyDir: userData}, {
            inspectSupport: async () => ({kind: 'legacy'})
        })).rejects.toThrow(/explicit --legacy-migration/);
        mkdirSync(path.join(userData, 'brain/runtime/retained'), {recursive: true});
        await expect(prepareContinuity({sourceBundle: null, destinationBundle: artifact, custodyDir: userData}))
            .rejects.toThrow(/managed custody remains/);
        expect(readSlot(installed).receipt).toEqual(OLD);
    });

    test('a separate installer process excludes all path variants before staging cleanup', async () => {
        expect(DEFAULT_INSTALL_TRANSACTION_DIR).toBe(path.join(userInfo().homedir, 'Library', 'Application Support', 'neo-harness', 'installer'));
        writeBundle(artifact, NEW);
        mkdirSync(applications, {recursive: true});
        const alias = path.join(root, 'applications-alias');
        symlinkSync(applications, alias);
        const firstPlan = planInstall({...slots(), custodyDir: userData});
        const program   = `
            import fs from 'node:fs';
            const api = await import(process.argv[1]);
            const input = JSON.parse(process.argv[2]);
            try {
                await api.executePlan(input.steps, {
                    runningFn: () => [],
                    publishSlotsFn: () => null,
                    transactionFn: () => api.holdInstallTransaction({directory: input.transactionDirectory}),
                    continuityFn: step => api.prepareInstallContinuity(step, {inspectSupport: async () => ({kind:'generation'})}),
                    runFn(command, args) { if(command !== 'ditto') throw Error('unexpected child command'); fs.cpSync(args[0],args[1],{recursive:true}); },
                    materializeFn: async () => {
                        process.send({phase:'holding'});
                        await new Promise(resolve => process.once('message',resolve));
                        return {directory:input.transactionDirectory};
                    }
                });
                process.disconnect();
            } catch(error) { process.send({error:error.message}); process.exitCode=1; process.disconnect(); }
        `;
        const child = spawn(process.execPath, ['--input-type=module', '-e', program,
            new URL('../../../../harness/install.mjs', import.meta.url).href,
            JSON.stringify({steps: firstPlan.steps, transactionDirectory: transactionDirectory()})], {env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
        const exited = once(child, 'exit');
        let   stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk });
        try {
            expect((await once(child, 'message'))[0]).toEqual({phase: 'holding'});
            expect(readSlot(`${installed}.installing`).receipt).toEqual(NEW);
            for (const installedPath of [installed, path.join(alias, `${APP_NAME}.app`), path.join(root, 'different-app', `${APP_NAME}.app`)]) {
                const calls = [];
                const plan  = planInstall({...slots(), installed: readSlot(installedPath),
                    parked: readSlot(`${installedPath}.restoring`), custodyDir: path.join(root, 'other-userData')});
                await expect(executePlan(plan.steps, {transactionFn, continuityFn: prepareContinuity, runFn: runFn(calls)}))
                    .rejects.toThrow(/lease .*held/);
                expect(calls).toEqual([]);
                expect(readSlot(`${installed}.installing`).receipt).toEqual(NEW);
            }
            child.send('continue');
            expect((await exited)[0], stderr).toBe(0);
            expect(readSlot(installed).receipt).toEqual(NEW);
            expect(transactionFn().release()).toBe(true);
            await expect(executePlan(firstPlan.steps, {transactionFn, continuityFn: prepareContinuity, runFn: runFn([])}))
                .rejects.toThrow(/planned package slot changed/);
        } finally {
            if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
        }
    });

    test('first-install exclusion leaves no synthetic handoff and tolerates only structural retry residue', async () => {
        writeBundle(artifact, NEW);
        const plan  = planInstall({...slots(), custodyDir: userData, flags: {open: true}}), calls = [];
        const first = (await prepareContinuity(plan.steps[0])).hold();
        expect(first.evidence).toBeNull();
        expect(() => openIssuer()).toThrow();
        first.release();
        await executePlan(plan.steps, {continuityFn: prepareContinuity,
            runFn: runFn(calls), materializeFn: async () => ({directory: root})});
        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readLaunchAdmissionJournal({directory: admissionDirectory()})).toBeNull();
        expect(readdirSync(admissionDirectory())).toEqual([]);
        expect(calls.map(row => row.command)).toEqual(['ditto', 'open']);
    });

    test('first-install eligibility is rechecked under exclusion and refuses unknown Fleet records', async () => {
        writeBundle(artifact, NEW);
        const prepared = await prepareContinuity(planInstall({...slots(), custodyDir: userData}).steps[0]);
        mkdirSync(custody, {recursive: true});
        writeFileSync(path.join(custody, 'registry.json'), '{}');
        expect(() => prepared.hold()).toThrow(/managed Fleet custody/);
        expect(readSlot(installed).exists).toBe(false);
        expect(fs.existsSync(path.join(admissionDirectory(), 'issuer.lock'))).toBe(false);
        rmSync(path.join(custody, 'registry.json'));
        writeFileSync(path.join(admissionDirectory(), 'unclassified-record'), '{}');
        expect(() => prepared.hold()).toThrow(/unknown admission custody/);
        expect(fs.existsSync(path.join(admissionDirectory(), 'unclassified-record'))).toBe(true);
    });

    test('recognized legacy migration requires explicit intent and preserves custody without issuing a handoff', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        writeCustody();
        const before       = custodyDigest(userData), calls = [];
        const continuityFn = step => prepareInstallContinuity(step, {inspectSupport: async ({bundlePath}) => ({kind: bundlePath === installed ? 'legacy' : 'generation'})});
        await expect(executePlan(planInstall({...slots(), custodyDir: userData}).steps, {continuityFn, runFn: runFn(calls)})).rejects.toThrow(/--legacy-migration/);
        expect(calls).toEqual([]);
        const options = parseInstallArgs(['--legacy-migration']);
        expect(options.legacyMigration).toBe(true);
        expect(options.unknown).toEqual([]);
        const plan = planInstall({...slots(), custodyDir: userData, flags: {legacyMigration: true}});
        expect(plan.warnings.join(' ')).toContain('discontinuous');
        await executePlan(plan.steps, {continuityFn, runFn: runFn(calls), materializeFn: async () => ({directory: root})});
        expect(readSlot(installed).receipt).toEqual(NEW);
        expect(readLaunchAdmissionJournal({directory: admissionDirectory()})).toBeNull();
        // Exclusion adds an empty structural directory; the original custody bytes stay untouched.
        rmSync(admissionDirectory(), {recursive: true});
        expect(custodyDigest(userData)).toBe(before);
    });

    test('legacy rollback requires sealed revocations and preserves the journal and retained roots', async () => {
        writeBundle(installed, NEW);
        writeBundle(rollback, OLD);
        const revoked = {version: 6, seats: [], generations: [{
            id                : 'g', agentId: 'seat', identity: 'seat-login', state: 'revoked', reason: 'stop-requested',
            reservedAt        : null, activatedAt: null, revokedAt: null, definitionHash: 'a'.repeat(64), runtime: null,
            credentialBindings: {}, residentBindings: {},
            servers           : [{key: 'memory-core', grantId: 'grant', state: 'revoked', reason: 'stop-requested', capabilityHash: 'b'.repeat(64)}]
        }]};
        expect(isAdmissionSnapshot(revoked)).toBe(true);
        const first = openIssuer();
        first.handoff(revoked);
        const bytes = fs.readFileSync(path.join(admissionDirectory(), 'issuer.json'), 'utf8');
        mkdirSync(path.join(userData, 'brain/runtime/retained'), {recursive: true});
        const plan         = planInstall({...slots(), custodyDir: userData, mode: 'restore', flags: {legacyMigration: true}});
        const continuityFn = step => prepareInstallContinuity(step, {inspectSupport: async ({bundlePath}) => ({kind: bundlePath === rollback ? 'legacy' : 'generation'})});
        try {
            await executePlan(plan.steps, {continuityFn, runFn: runFn([]), materializeFn: async () => ({directory: root}),
                recoveryFn     : async () => { throw Error('legacy must not claim codec compatibility') },
                verifyRuntimeFn: async () => ({directory: root})});
            expect(readSlot(installed).receipt).toEqual(OLD);
            expect(fs.readFileSync(path.join(admissionDirectory(), 'issuer.json'), 'utf8')).toBe(bytes);
            expect(fs.existsSync(path.join(userData, 'brain/runtime/retained'))).toBe(true);
        } finally { first.close() }
    });

    test('legacy rollback accepts only terminal original Starts with resolved ownership and cleanup', async () => {
        writeBundle(installed, NEW);
        writeBundle(rollback, OLD);
        const id    = 'a'.repeat(64), directory = `/runtime/${id}`;
        const start = {version: 2, agentId: 'seat', identity: 'seat-login', harnessType: 'codex-desktop',
            pid              : 42, pidStartedAt: 'Wed Oct 14 10:00:00 2026', startedAt: '2026-10-14T08:00:00Z',
            cwd              : '/managed/seat/repo', instanceHome: '/managed/seat/profile', launchCommand: '/apps/harness',
            launchInterpreter: null, profileArg: null, leaseRequired: true,
            runtime          : {id, directory, runtimeRoot: `${directory}/host.runtime/organism`,
                executable: `${directory}/host.runtime/node`, payloadDigest: 'b'.repeat(64)},
            planSha256     : 'c'.repeat(64), profile: null, admissionGeneration: null,
            bridgeAuthority: {version: 1, source: 'registry-file', registryRoot: '/registry', publicKeySha256: 'd'.repeat(64)}, targets: []};
        const binding = planInstall({...slots(), custodyDir: userData, mode: 'restore', flags: {legacyMigration: true}}).steps[0];
        for (const [state, ownershipUnresolved, cleanupUnresolved, accepted] of [
            ['running', false, false, false], ['stopping', false, false, false], ['failed', false, false, false],
            ['unavailable', false, false, false], ['stopped', true, false, false], ['exited', false, true, false],
            ['stopped', false, false, true], ['exited', false, false, true]
        ]) {
            const value = {version: 6, generations: [], seats: [{start, state, ownershipUnresolved, cleanupUnresolved}]};
            expect(isAdmissionSnapshot(value)).toBe(true);
            const issuer = openIssuer();
            issuer.handoff(value);
            try {
                const prepared = await prepareInstallContinuity(binding,
                    {inspectSupport: async ({bundlePath}) => ({kind: bundlePath === rollback ? 'legacy' : 'generation'})});
                if (accepted) prepared.hold().release();
                else expect(() => prepared.hold()).toThrow(/terminal original Starts/);
                expect(readLaunchAdmissionJournal({directory: admissionDirectory()}).state.snapshot).toEqual(value);
            } finally { issuer.close() }
        }
    });

    test('a sealed but active grant cannot enter legacy rollback', async () => {
        writeBundle(installed, NEW);
        writeBundle(rollback, OLD);
        const active = {version: 6, seats: [], generations: [{
            id                : 'g', agentId: 'seat', identity: 'seat-login', state: 'active', reason: null,
            reservedAt        : null, activatedAt: null, revokedAt: null, definitionHash: 'a'.repeat(64), runtime: null,
            credentialBindings: {}, residentBindings: {}, servers: []
        }]};
        const first = openIssuer(), calls = [];
        first.handoff(active);
        const plan = planInstall({...slots(), custodyDir: userData, mode: 'restore', flags: {legacyMigration: true}});
        try {
            await expect(executePlan(plan.steps, {runFn: runFn(calls), continuityFn: step => prepareInstallContinuity(step,
                {inspectSupport: async ({bundlePath}) => ({kind: bundlePath === rollback ? 'legacy' : 'generation'})})}))
                .rejects.toThrow(/terminal original Starts and revoked grants/);
            expect(calls).toEqual([]);
            expect(readSlot(installed).receipt).toEqual(NEW);
        } finally { first.close() }
    });

    test('an update holds the original issuer through copy and async probes, then releases before open', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const first = openIssuer(), calls = [], events = [];
        let successor;
        const candidate = {directory: path.join(root, 'fixture-runtime'), id: 'fixture-runtime'};
        const plan      = planInstall({...slots(), custodyDir: userData,
            running: [path.join(installed, 'Contents/MacOS', APP_NAME)], flags: {quit: true, open: true}});
        try {
            const result = await executePlan(plan.steps, {
                transactionFn,
                continuityFn: prepareContinuity,
                runFn       : runFn(calls, {
                    osascript: () => { events.push('quit'); expect(transactionFn).toThrow(/held/); first.handoff(snapshot) },
                    ditto    : () => { events.push('copy'); expect(() => openIssuer()).toThrow() },
                    open     : () => { events.push('open'); expect(transactionFn().release()).toBe(true); successor = openIssuer(); expect(successor.previous.handoffProved).toBe(true) }
                }),
                materializeFn: async () => {
                    events.push('materialize');
                    expect(() => openIssuer()).toThrow();
                    await Promise.resolve();
                    return candidate;
                },
                recoveryFn: async (destination, captured, {validateSnapshot}) => {
                    events.push('compatibility');
                    expect(destination).toEqual(candidate);
                    expect(captured).toEqual(snapshot);
                    expect(validateSnapshot(captured)).toBe(true);
                    expect(readLaunchAdmissionJournal({directory: admissionDirectory()}).state.snapshot).toEqual(snapshot);
                    expect(() => openIssuer()).toThrow();
                },
                verifyRuntimeFn: async () => { events.push('integrity'); expect(() => openIssuer()).toThrow(); return {...candidate} }
            });
            expect(events).toEqual(['quit', 'copy', 'materialize', 'compatibility', 'integrity', 'open']);
            expect(result.custody.before).toBe(result.custody.after);
            expect(readSlot(installed).receipt).toEqual(NEW);
            expect(readSlot(rollback).receipt).toEqual(OLD);
        } finally { successor?.close(); first.close() }
    });

    for (const liveIssuer of [false, true]) {
        test(`Quit with ${liveIssuer ? 'the issuer still live' : 'a successor issuer'} refuses before staging`, async () => {
            writeBundle(installed, OLD);
            writeBundle(artifact, NEW);
            const first = openIssuer(), calls = [];
            let successor;
            const plan = planInstall({...slots(), custodyDir: userData,
                running: [path.join(installed, 'Contents/MacOS', APP_NAME)], flags: {quit: true, open: true}});
            try {
                await expect(executePlan(plan.steps, {transactionFn, continuityFn: prepareContinuity, runFn: runFn(calls, {
                    osascript: () => {
                        if (liveIssuer) return;
                        first.handoff(snapshot);
                        successor = openIssuer();
                        successor.handoff(snapshot);
                    }
                })})).rejects.toThrow(liveIssuer ? /held/ : /issuer-changed/);
                expect(calls.map(row => row.command), 'the unchanged bundle it quit is opened again').toEqual(['osascript', 'open']);
                expect(readSlot(installed).receipt).toEqual(OLD);
                expect(readSlot(`${installed}.installing`).exists).toBe(false);
            } finally { successor?.close(); first.close() }
        });
    }

    test('an update after an unclean exit completes without recovery; the successor crosses the old record stale', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const first = openIssuer(), calls = [], candidate = {directory: path.join(root, 'fixture-runtime'), id: 'fixture-runtime'};
        let successor;
        const plan = planInstall({...slots(), custodyDir: userData,
            running: [path.join(installed, 'Contents/MacOS', APP_NAME)], flags: {quit: true, open: true}});
        try {
            const result = await executePlan(plan.steps, {
                transactionFn,
                continuityFn   : prepareContinuity,
                runFn          : runFn(calls, {
                    osascript: () => first.close(),
                    ditto    : () => expect(() => openIssuer()).toThrow(),
                    open     : () => { successor = openIssuer() }
                }),
                materializeFn  : async () => candidate,
                recoveryFn     : async () => { throw Error('an unclean record carries no recovery authority') },
                verifyRuntimeFn: async () => ({...candidate})
            });
            expect(successor.previous).toMatchObject({handoffProved: false, reason: 'unclean-issuer-exit', snapshot});
            expect(result.custody.before).toBe(result.custody.after);
            expect(readSlot(installed).receipt).toEqual(NEW);
            expect(readSlot(rollback).receipt).toEqual(OLD);
        } finally { successor?.close(); first.close() }
    });

    for (const failure of ['materialize', 'compatibility', 'integrity', 'handoff']) {
        test(`${failure} failure leaves installed slots intact and releases update exclusion`, async () => {
            writeBundle(installed, OLD);
            writeBundle(artifact, NEW);
            const first = openIssuer(), calls = [], candidate = {directory: path.join(root, 'fixture-runtime')};
            first.handoff(snapshot);
            const before = fs.readFileSync(path.join(admissionDirectory(), 'fence.json'), 'utf8');
            try {
                await expect(executePlan(planInstall({...slots(), custodyDir: userData, flags: {open: true}}).steps, {
                    continuityFn : prepareContinuity, runFn: runFn(calls),
                    materializeFn: async () => { if (failure === 'materialize') throw Error('fixture materialize'); return candidate },
                    recoveryFn   : async () => {
                        if (failure === 'compatibility') throw Error('fixture compatibility');
                        if (failure === 'handoff') {
                            const file   = path.join(admissionDirectory(), 'issuer.json');
                            const record = JSON.parse(fs.readFileSync(file, 'utf8'));
                            writeFileSync(file, JSON.stringify({...record, phase: 'active', handoff: null}));
                        }
                    },
                    verifyRuntimeFn: async () => failure === 'integrity' ? {...candidate, id: 'changed'} : candidate
                })).rejects.toThrow(failure === 'handoff' ? /handoff-changed/ : failure === 'integrity' ? /runtime changed/ : /fixture/);
                expect(calls.some(row => row.command === 'open')).toBe(false);
                expect(readSlot(installed).receipt).toEqual(OLD);
                expect(readSlot(rollback).exists).toBe(false);
                expect(fs.readFileSync(path.join(admissionDirectory(), 'fence.json'), 'utf8')).toBe(before);
                const successor = openIssuer();
                expect(successor.previous.handoffProved).toBe(failure !== 'handoff');
                successor.close();
            } finally { first.close() }
        });
    }

    test('unproved release prevents app launch even after a successful swap', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const first = openIssuer(), calls = [];
        first.handoff(snapshot);
        let held;
        try {
            await expect(executePlan(planInstall({...slots(), custodyDir: userData, flags: {open: true}}).steps, {
                continuityFn: async step => {
                    const prepared = await prepareContinuity(step);
                    return {hold() {
                        held = prepared.hold();
                        return {...held, release: () => { throw Error('fixture update-release-unproved') }};
                    }};
                },
                transactionFn,
                runFn     : runFn(calls), materializeFn: async () => ({directory: root}),
                recoveryFn: async () => {}, verifyRuntimeFn: async () => ({directory: root})
            })).rejects.toThrow(/update-release-unproved/);
            expect(readSlot(installed).receipt).toEqual(NEW);
            expect(calls.some(row => row.command === 'open')).toBe(false);
            expect(() => openIssuer()).toThrow();
            expect(transactionFn().release()).toBe(true);
        } finally { held?.release(); first.close() }
    });

    test('failed package-lock release suppresses launch while still releasing the issuer guard', async () => {
        writeBundle(installed, OLD);
        writeBundle(artifact, NEW);
        const first = openIssuer(), calls = [];
        first.handoff(snapshot);
        let held;
        try {
            await expect(executePlan(planInstall({...slots(), custodyDir: userData, flags: {open: true}}).steps, {
                continuityFn: prepareContinuity,
                transactionFn() { held = transactionFn(); return {...held, release: () => { throw Error('fixture package release unproved') }} },
                runFn     : runFn(calls), materializeFn: async () => ({directory: root}),
                recoveryFn: async () => {}, verifyRuntimeFn: async () => ({directory: root})
            })).rejects.toThrow(/package release unproved/);
            expect(calls.some(row => row.command === 'open')).toBe(false);
            expect(readSlot(installed).receipt).toEqual(NEW);
            expect(transactionFn).toThrow(/held/);
            const successor = openIssuer();
            expect(successor.previous.handoffProved).toBe(true);
            successor.close();
        } finally { held?.release(); first.close() }
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
