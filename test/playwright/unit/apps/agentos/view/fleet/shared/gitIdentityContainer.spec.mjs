import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetGitIdentityRowTest';

setup({
    neoConfig: {
        unitTestMode: true
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * @summary The one commit-identity row (#524, Clio's placement): inline in Add the declaration opens at
 * once for a failed derivation; in Detail every state sits behind one repair action. The row changes
 * nothing itself; it fires the typed pair or a retry, and shows the answer its owner sets back.
 */
test.describe('AgentOS.view.fleet.shared.GitIdentityContainer (#524)', () => {
    let GitIdentityContainer;

    const missing = {state: 'missing', name: 'Ada', reason: 'its forge account offers no email this PAT can read'};
    const parts   = row => ({
        fields: row.getReference('identity-fields'),
        line  : row.getReference('identity-line'),
        read  : row.getReference('identity-read'),
        repair: row.getReference('identity-repair'),
        status: row.getReference('identity-status')
    });

    test.beforeAll(async () => {
        GitIdentityContainer = (await import('../../../../../../../../apps/agentos/view/fleet/shared/GitIdentityContainer.mjs')).default
    });

    test('inline: a failed derivation opens the declaration at once, prefilled with what the Fleet knows', () => {
        const row = Neo.create(GitIdentityContainer, {appName, inline: true, identity: missing});
        const {fields, line, read, repair} = parts(row);

        expect(line.text).toBe('No commit identity: its forge account offers no email this PAT can read.');
        expect(fields.hidden).toBe(false);
        expect(repair.hidden).toBe(true);
        expect(read.hidden).toBe(true);
        expect(row.getReference('field-git-name').value).toBe('Ada');

        // a PAT answering for another account is repaired the same way
        row.identity = {state: 'mismatch', found: 'other', reason: "its PAT belongs to the forge account 'other', not to the seat's 'ada'"};
        expect(fields.hidden).toBe(false);

        row.destroy()
    });

    test('inline: a read that failed says "not yet read" with its reason and a retry, never success', () => {
        const fired = [];
        const row   = Neo.create(GitIdentityContainer, {appName, inline: true, identity: {state: 'unknown', reason: 'no PAT is stored for it'}});
        const {fields, line, read} = parts(row);

        row.on('readGitIdentity', () => fired.push('read'));

        expect(line.text).toBe('Identity not yet read: no PAT is stored for it.');
        expect(read.hidden).toBe(false);
        expect(fields.hidden).toBe(true);

        row.onReadClick();
        expect(fired).toEqual(['read']);

        row.destroy()
    });

    test('Detail: every state sits behind the one repair action, which toggles the declaration', () => {
        const row = Neo.create(GitIdentityContainer, {appName, identity: {state: 'derived', name: 'Ada', email: 'ada@example.com'}});
        const {fields, line, read, repair} = parts(row);

        expect(line.text).toBe('Commits as Ada <ada@example.com> · from its account');
        expect(repair.hidden).toBe(false);
        expect(repair.text).toBe('Change identity');
        expect(fields.hidden).toBe(true);
        expect(read.hidden).toBe(true);

        row.onRepairClick();
        expect(fields.hidden).toBe(false);
        expect(repair.text).toBe('Close');
        expect(row.getReference('field-git-email').value).toBe('ada@example.com');

        row.onRepairClick();
        expect(fields.hidden).toBe(true);

        // a state the operator must act on names the action that does it
        row.identity = missing;
        expect(repair.text).toBe('Declare identity');
        expect(read.hidden).toBe(true);
        // a read that failed has one action here too: read it again, never a declaration over it
        row.identity = {state: 'unknown', reason: 'the fleet could not be reached'};
        expect(read.hidden).toBe(false);
        expect(repair.hidden).toBe(true);

        row.destroy()
    });

    test('Save hands over the typed pair; a new answer closes the declaration and clears the feedback', () => {
        const fired = [];
        const row   = Neo.create(GitIdentityContainer, {appName, identity: missing});
        const {fields, status} = parts(row);

        row.on('declareGitIdentity', data => fired.push({gitEmail: data.gitEmail, gitName: data.gitName}));

        row.onRepairClick();
        row.getReference('field-git-email').value = 'ada@example.com';
        row.onSaveClick();
        expect(fired).toEqual([{gitEmail: 'ada@example.com', gitName: 'Ada'}]);

        row.status = {state: 'pending', reason: ''};
        expect(status.text).toBe('Saving…');
        expect(row.getReference('identity-save').disabled).toBe(true);

        row.status = {state: 'rejected', reason: 'gitEmail is not an email address'};
        expect(status.text).toBe('gitEmail is not an email address');
        expect(fields.hidden).toBe(false);

        row.identity = {state: 'declared', name: 'Ada', email: 'ada@example.com'};
        expect(fields.hidden).toBe(true);
        expect(row.status).toEqual({state: 'idle', reason: ''});

        row.destroy()
    })
});
