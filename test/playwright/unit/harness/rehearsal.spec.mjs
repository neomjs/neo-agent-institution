import {expect, test} from '@playwright/test';
import crypto         from 'node:crypto';
import fs             from 'node:fs';
import os             from 'node:os';
import path           from 'node:path';
import {
    INSTALLED_APP,
    RECEIPT_SUFFIX,
    readOrganismIdentity,
    resolveReceiptPath,
    resolveRehearsal,
    resolveStandInRuntime,
    writeReceipt
} from '../../../../harness/rehearsal.mjs';

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

    test('the rehearsal acts only in the fixture-plane arm, and names why it refuses anywhere else', () => {
        expect(resolveRehearsal({env: {}, smokePlaneMode: true}), 'unset').toEqual({rehearsal: false, refusal: null});
        expect(resolveRehearsal({env: {NEO_HARNESS_REHEARSAL: '1'}, smokePlaneMode: true})).toEqual({rehearsal: true, refusal: null});

        const refused = resolveRehearsal({env: {NEO_HARNESS_REHEARSAL: '1'}, smokePlaneMode: false});

        expect(refused.rehearsal).toBe(false);
        expect(refused.refusal).toContain('NEO_HARNESS_SMOKE_PLANE=1');
        expect(refused.refusal).toContain('organism running here')
    });

    test('the stand-in runs on the pinned or PATH Node that answers, and refuses without one', () => {
        expect(resolveStandInRuntime({env: {NEO_HARNESS_NODE_BIN: process.execPath}})).toEqual({runtime: process.execPath, refusal: null});
        expect(resolveStandInRuntime({env: {PATH: path.dirname(process.execPath)}}).runtime).toMatch(/node$/);

        const silent = path.join(root, 'node');
        fs.writeFileSync(silent, '#!/bin/sh\nexit 1\n', {mode: 0o755});

        expect(resolveStandInRuntime({env: {NEO_HARNESS_NODE_BIN: silent}}).refusal).toContain(`'${silent}', which did not answer`);
        expect(resolveStandInRuntime({env: {PATH: root + '-absent'}}).refusal).toContain('found none')
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
    })
});
