import {test, expect} from '@playwright/test';
import {ORG_DEPENDENCIES, installedRevision} from '../../../../buildScripts/resolveOrgDev.mjs';

/**
 * The org dependencies resolve at `dev`, and the revision installed for each is read back from npm's own record.
 * Importing the module must run no install: this suite completing without one is that witness.
 */
test.describe('resolveOrgDev — the Brain and the Engine at dev, and the revision npm installed', () => {
    const lockOf = resolved => ({packages: {'node_modules/neo.mjs': {resolved, version: '13.1.0'}}});

    test('both org dependencies track dev', () => {
        expect(ORG_DEPENDENCIES).toEqual({
            'neo-agent-brain': 'github:neomjs/neo-agent-brain#dev',
            'neo.mjs'        : 'github:neomjs/neo#dev'
        })
    });

    test('the installed revision is the commit after # in the resolved git URL', () => {
        expect(installedRevision(lockOf('git+ssh://git@github.com/neomjs/neo.git#7aae7c3166b7fc35ace2550763681791bb84e7f4'), 'neo.mjs'))
            .toBe('7aae7c3166b7fc35ace2550763681791bb84e7f4')
    });

    test('an absent package, a registry tarball and no install at all name no revision', () => {
        expect(installedRevision(lockOf('git+ssh://git@github.com/neomjs/neo.git#abc'), 'neo-agent-brain')).toBeNull();
        expect(installedRevision(lockOf('https://registry.npmjs.org/neo.mjs/-/neo.mjs-13.1.0.tgz'), 'neo.mjs')).toBeNull();
        expect(installedRevision(null, 'neo.mjs')).toBeNull()
    })
});
