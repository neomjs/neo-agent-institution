import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'SeatGitIdentityTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import SeatGitIdentity from '../../../../../../apps/agentos/util/SeatGitIdentity.mjs';

/**
 * @summary The cockpit's one reading of a seat's commit identity: the Fleet's answer read, worded,
 * and repaired by a declaration, never with a caught message on the way.
 */
test.describe('AgentOS.util.SeatGitIdentity (#524)', () => {
    test('each state reads as one line, the Fleet\'s reason included once', () => {
        expect(SeatGitIdentity.describe({state: 'derived', name: 'Ada', email: 'ada@example.com'}))
            .toBe('Commits as Ada <ada@example.com> · from its account');
        expect(SeatGitIdentity.describe({state: 'declared', name: 'Ada', email: 'ada@example.com'}))
            .toBe('Commits as Ada <ada@example.com> · declared');
        expect(SeatGitIdentity.describe({state: 'missing', reason: 'its forge account offers no email this PAT can read'}))
            .toBe('No commit identity: its forge account offers no email this PAT can read.');
        expect(SeatGitIdentity.describe({state: 'mismatch', reason: "its PAT belongs to the forge account 'other', not to the seat's 'ada'"}))
            .toBe("Not its own account: its PAT belongs to the forge account 'other', not to the seat's 'ada'.");
        // a reason that ends its own sentence is not given a second stop
        expect(SeatGitIdentity.describe({state: 'unknown', reason: 'no PAT is stored for it.'}))
            .toBe('Identity not yet read: no PAT is stored for it.');
        expect(SeatGitIdentity.describe({state: 'unknown'})).toBe('Identity not yet read.');
        expect(SeatGitIdentity.describe(null)).toBe('Identity not yet read.')
    });

    test('only missing, mismatch and unknown ask the operator for something', () => {
        expect(['missing', 'mismatch', 'unknown'].every(state => SeatGitIdentity.needsRepair({state}))).toBe(true);
        expect(['derived', 'declared'].some(state => SeatGitIdentity.needsRepair({state}))).toBe(false);
        expect(SeatGitIdentity.needsRepair(null)).toBe(false)
    });

    test('a read passes the Fleet\'s answer through, and any failure is unknown in fixed words', async () => {
        const answer = {state: 'mismatch', found: 'other', reason: "its PAT belongs to the forge account 'other', not to the seat's 'ada'"};
        const asked  = [];

        expect(await SeatGitIdentity.read({fleetSeatGitIdentity: async params => {
            asked.push(params);
            return answer
        }}, 'ada')).toEqual(answer);
        expect(asked).toEqual([{id: 'ada'}]);

        expect(await SeatGitIdentity.read(null, 'ada'))
            .toEqual({state: 'unknown', reason: 'this fleet does not report commit identities'});
        expect(await SeatGitIdentity.read({fleetSeatGitIdentity: async () => ({status: 'ok'})}, 'ada'))
            .toEqual({state: 'unknown', reason: 'the fleet answered without one'});

        // a caught message never becomes the reason: it is not a surface the DOM may carry
        const thrown = await SeatGitIdentity.read({fleetSeatGitIdentity: async () => {
            throw new Error('fleet: request transport failed at /Users/someone/secret/path')
        }}, 'ada');

        expect(thrown).toEqual({state: 'unknown', reason: 'the fleet could not be reached'})
    });

    test('a declaration crosses as one trimmed pair, and a half pair never reaches the bridge', async () => {
        const intents = [];
        const bridge  = {configureAgent: async intent => {
            intents.push(intent);
            return {status: 'accepted', agent: {id: 'ada', gitName: intent.gitName, gitEmail: intent.gitEmail}}
        }};

        expect(SeatGitIdentity.pairOf({gitName: ' Ada ', gitEmail: ' ada@example.com '}))
            .toEqual({gitName: 'Ada', gitEmail: 'ada@example.com'});
        expect(SeatGitIdentity.pairOf({gitName: 'Ada', gitEmail: '  '})).toBeNull();

        expect(await SeatGitIdentity.declare(bridge, 'ada', {gitName: 'Ada'}))
            .toEqual({state: 'rejected', reason: 'Name and email are both required.'});
        expect(intents).toEqual([]);

        expect(await SeatGitIdentity.declare(bridge, 'ada', {gitName: ' Ada ', gitEmail: 'ada@example.com'})).toEqual({
            state     : 'accepted',
            reason    : '',
            definition: {id: 'ada', gitName: 'Ada', gitEmail: 'ada@example.com'}
        });
        expect(intents).toEqual([{id: 'ada', gitName: 'Ada', gitEmail: 'ada@example.com'}])
    });

    test('a refused declaration keeps the Fleet\'s reason; an absent or failing bridge saves nothing', async () => {
        const pair = {gitName: 'Ada', gitEmail: 'not-an-email'};

        expect(await SeatGitIdentity.declare({configureAgent: async () => ({status: 'rejected', reason: 'gitEmail is not an email address'})}, 'ada', pair))
            .toEqual({state: 'rejected', reason: 'gitEmail is not an email address'});
        expect(await SeatGitIdentity.declare(null, 'ada', pair))
            .toEqual({state: 'rejected', reason: 'The fleet is not running. Start it, then declare the identity.'});
        expect(await SeatGitIdentity.declare({configureAgent: async () => {throw new Error('boom')}}, 'ada', pair))
            .toEqual({state: 'rejected', reason: 'Could not reach the fleet. Nothing was saved.'})
    })
});
