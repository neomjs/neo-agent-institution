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
 * @summary The cockpit asks the shell about the launched PAT on a failed roster read, on a degraded presence
 * read (once per episode each) and on a periodic re-check; only the shell's answer names or clears the cause.
 */
test.describe('AgentOS.util.PlaneCredentialCheck', () => {
    let calls, originalMain;

    /**
     * @summary The liveness owner's surface this helper touches: its episode and question state, its
     * provider and the cockpit's re-check interval.
     * @param {Number} [planeCredentialRecheckInterval]
     */
    function makeOwner(planeCredentialRecheckInterval) {
        const data = {};

        return {
            component  : {getStateProvider: () => ({setData: (key, value) => { data[key] = value }}), planeCredentialRecheckInterval, windowId: 7},
            data,
            isDestroyed: false,
            planeCheck : null
        }
    }

    function shellAnswers(reply) {
        globalThis.Neo.main = {addon: {ShellPlane: {verifyPlane: args => { calls.push(args); return reply }}}}
    }

    function shellHolds() {
        const releases = [];

        globalThis.Neo.main = {addon: {ShellPlane: {verifyPlane: args => {
            calls.push(args);
            return new Promise(resolve => releases.push(resolve))
        }}}};

        return releases
    }

    /**
     * @summary Question A, a wired read, question B; B's answer lands first, then A's.
     * @param {Object} newer B's answer.
     * @param {Object} older A's answer.
     * @returns {Promise<String|null>} The published cause.
     */
    async function reenter(newer, older) {
        const owner = makeOwner(), releases = shellHolds();

        const first = PlaneCredentialCheck.ask(owner, 'failed-upstream');

        PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});

        const second = PlaneCredentialCheck.ask(owner, 'failed-upstream');

        releases[1](newer);
        await second;
        releases[0](older);
        await first;

        expect(calls.length).toBe(2);

        return owner.data.planeCause
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

    test('a degraded presence read asks once per episode, and a wired read ends the episode', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-credential-refused'}));

        await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});
        await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});

        expect(calls.length).toBe(1);
        expect(owner.data.planeCause).toBe('plane-credential-refused');

        await PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});

        expect(owner.planeCheck.episode).toBe(null);

        await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});

        expect(calls.length).toBe(2)
    });

    test('a wired read leaves a named cause to the shell: it proves the transport, never the credential', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-identity-changed'}));

        await PlaneCredentialCheck.ask(owner, 'failed-upstream');
        await PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});
        await PlaneCredentialCheck.observe(owner, null);

        expect(owner.data.planeCause).toBe('plane-identity-changed');
        expect(calls.length).toBe(1)
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

    test('an answer still lands when a wired read arrives while the shell is asked', async () => {
        const owner = makeOwner(), releases = shellHolds();

        const asking = PlaneCredentialCheck.ask(owner, 'failed-upstream');

        PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});
        releases[0]({cause: 'plane-credential-refused'});
        await asking;

        expect(owner.data.planeCause).toBe('plane-credential-refused')
    });

    test('only the latest question publishes: an older refusal landing last cannot undo the newer clear', async () => {
        expect(await reenter({cause: null}, {cause: 'plane-credential-refused'})).toBe(null)
    });

    test('only the latest question publishes: an older clear landing last cannot drop the newer refusal', async () => {
        expect(await reenter({cause: 'plane-credential-refused'}, {cause: null})).toBe('plane-credential-refused')
    });

    test('the periodic re-check asks once per interval and finds a remapped account while every read stays wired', async () => {
        const owner = makeOwner(1000);

        shellAnswers(Promise.resolve({cause: 'plane-identity-changed'}));

        await PlaneCredentialCheck.recheck(owner, 5000);
        await PlaneCredentialCheck.recheck(owner, 5500);

        expect(calls.length).toBe(1);
        expect(owner.data.planeCause).toBe('plane-identity-changed');

        await PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});
        await PlaneCredentialCheck.recheck(owner, 6000);

        expect(calls.length).toBe(2);
        expect(owner.data.planeCause).toBe('plane-identity-changed')
    });

    test('the re-check clears the cause once the shell says the credential holds', async () => {
        const owner = makeOwner(1000);

        shellAnswers(Promise.resolve({cause: 'plane-credential-refused'}));
        await PlaneCredentialCheck.recheck(owner, 1000);

        shellAnswers(Promise.resolve({cause: null}));
        await PlaneCredentialCheck.recheck(owner, 2000);

        expect(owner.data.planeCause).toBe(null)
    });

    test('without a positive interval the re-check never asks', async () => {
        shellAnswers(Promise.resolve({cause: 'plane-credential-refused'}));

        for (const interval of [undefined, 0, -1]) {
            await PlaneCredentialCheck.recheck(makeOwner(interval), 10_000_000)
        }

        expect(calls).toEqual([])
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
