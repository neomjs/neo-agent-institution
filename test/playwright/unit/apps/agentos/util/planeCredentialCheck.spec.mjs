import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'PlaneCredentialCheckTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import PlaneCredentialCheck from '../../../../../../apps/agentos/util/PlaneCredentialCheck.mjs';

/**
 * @summary The cockpit asks the shell about the launched PAT once per failed roster-read episode, and a
 * read that answers again ends the episode and clears the answer.
 */
test.describe('AgentOS.util.PlaneCredentialCheck', () => {
    let calls, originalMain;

    /**
     * @summary The liveness owner's surface this helper touches: its episode flag and its provider.
     */
    function makeOwner() {
        const data = {};

        return {
            component        : {getStateProvider: () => ({setData: (key, value) => { data[key] = value }}), windowId: 7},
            data,
            isDestroyed      : false,
            planeCheckEpisode: false
        }
    }

    function shellAnswers(reply) {
        globalThis.Neo.main = {addon: {ShellPlane: {verifyPlane: args => { calls.push(args); return reply }}}}
    }

    test.beforeEach(() => {
        calls        = [];
        originalMain = globalThis.Neo.main
    });

    test.afterEach(() => {
        globalThis.Neo.main = originalMain
    });

    test('asks once per failed roster-read episode and publishes the shell\'s answer', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-credential-refused'}));

        await PlaneCredentialCheck.ask(owner, 'failed-upstream');
        await PlaneCredentialCheck.ask(owner, 'refused');

        expect(calls).toEqual([{windowId: 7}]);
        expect(owner.data.planeCause).toBe('plane-credential-refused')
    });

    test('a read that answers ends the episode and clears the cause, so the next failure asks again', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-identity-changed'}));

        await PlaneCredentialCheck.ask(owner, 'failed-upstream');
        PlaneCredentialCheck.settle(owner);

        expect(owner.data.planeCause).toBe(null);
        expect(owner.planeCheckEpisode).toBe(false);

        await PlaneCredentialCheck.ask(owner, 'failed-upstream');

        expect(calls.length).toBe(2)
    });

    test('only an upstream failure or a refusal asks: a timeout or a lost transport is not the credential', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-credential-refused'}));

        for (const state of ['timeout', 'unreachable', null, undefined]) {
            await PlaneCredentialCheck.ask(owner, state)
        }

        expect(calls).toEqual([]);
        expect(owner.data).toEqual({})
    });

    test('an answer that lands after a read recovered is dropped', async () => {
        const owner = makeOwner();
        let release;

        shellAnswers(new Promise(resolve => { release = resolve }));

        const asking = PlaneCredentialCheck.ask(owner, 'failed-upstream');

        PlaneCredentialCheck.settle(owner);
        release({cause: 'plane-credential-refused'});
        await asking;

        expect(owner.data.planeCause).toBe(null)
    });

    test('without a shell, or with an answer that is not a cause, nothing is named', async () => {
        const owner = makeOwner();

        globalThis.Neo.main = undefined;
        await PlaneCredentialCheck.ask(owner, 'failed-upstream');

        expect(owner.data.planeCause).toBe(null);

        const other = makeOwner();

        shellAnswers(Promise.reject(new Error('no-shell')));
        await PlaneCredentialCheck.ask(other, 'failed-upstream');

        expect(other.data.planeCause).toBe(null)
    })
});
