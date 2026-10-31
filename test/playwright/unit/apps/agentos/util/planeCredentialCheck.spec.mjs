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
import SpineBanner          from '../../../../../../apps/agentos/util/SpineBanner.mjs';
import LivenessCadence      from '../../../../../../apps/agentos/util/LivenessCadence.mjs';

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
     * @summary Question A from a failed read, then question B from the wired read that ends its episode;
     * B's answer lands first, then A's.
     * @param {Object} newer B's answer.
     * @param {Object} older A's answer.
     * @returns {Promise<String|null>} The published cause.
     */
    async function supersede(newer, older) {
        const owner = makeOwner(), releases = shellHolds();

        const
            first  = PlaneCredentialCheck.ask(owner, 'failed-upstream'),
            second = PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});

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

    test('a degraded presence read asks once per episode, and a wired read ends it with one more ask', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-credential-refused'}));

        await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});
        await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});

        expect(calls.length).toBe(1);
        expect(owner.data.planeCause).toBe('plane-credential-refused');

        await PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});
        await PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});

        expect(owner.planeCheck.episode).toBe(null);
        expect(calls.length).toBe(2);

        await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});

        expect(calls.length).toBe(3)
    });

    test('a restored PAT clears on the ask that ends its episode, not on the next re-check', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-credential-refused'}));
        await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});

        shellAnswers(Promise.resolve({cause: null}));
        await PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});

        expect(owner.data.planeCause).toBe(null);
        expect(calls.length).toBe(2)
    });

    test('a wired read leaves a named cause to the shell: it proves the transport, never the credential', async () => {
        const owner = makeOwner();

        shellAnswers(Promise.resolve({cause: 'plane-identity-changed'}));

        await PlaneCredentialCheck.ask(owner, 'failed-upstream');
        await PlaneCredentialCheck.observe(owner, {presence: {state: 'wired'}});
        await PlaneCredentialCheck.observe(owner, null);

        expect(owner.data.planeCause).toBe('plane-identity-changed');
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

    test('only the latest question publishes: an older refusal landing last cannot undo the newer clear', async () => {
        expect(await supersede({cause: null}, {cause: 'plane-credential-refused'})).toBe(null)
    });

    test('only the latest question publishes: an older clear landing last cannot drop the newer refusal', async () => {
        expect(await supersede({cause: 'plane-credential-refused'}, {cause: null})).toBe('plane-credential-refused')
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
    });

    test('worst-case off-grid alignment against the 300 s plane PAT cache reaches "pat refused" within the 360 s (6 min) bound (#845)', async () => {
        const
            planeCacheTtlMs = 300_000,
            recheckInterval = LivenessCadence.DEFAULT_RECHECK,
            passInterval    = LivenessCadence.DEFAULT_PASS,
            documentedBound = planeCacheTtlMs + recheckInterval + passInterval,
            owner           = makeOwner(recheckInterval),
            originalNow     = Date.now;

        expect(recheckInterval).toBe(45_000);
        expect(passInterval).toBe(15_000);
        expect(documentedBound).toBe(360_000);

        let clock          = 0,
            revokedAtGitHub = false,
            cacheExpiresAt = planeCacheTtlMs;

        Date.now = () => clock;
        globalThis.Neo.main = {
            addon: {
                ShellPlane: {
                    verifyPlane: args => {
                        calls.push({at: clock, ...args});
                        if (clock < cacheExpiresAt) {
                            return Promise.resolve({cause: null})
                        }
                        return Promise.resolve({cause: revokedAtGitHub ? 'plane-credential-refused' : null})
                    }
                }
            }
        };

        try {
            // Revoked immediately after the plane cached a valid verification at t = 0 (expires at t = 300_000 ms)
            clock = 1;
            revokedAtGitHub = true;
            const revokedAt = clock;

            // Off-grid episode ask at t = 299_999 ms (1 ms before the 300 s plane cache expires).
            // Even if presence stays degraded afterwards, observe() will not ask again for the open episode; recheck() must.
            const episodeAskAt = planeCacheTtlMs - 1;
            clock = episodeAskAt;
            await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});
            expect(owner.data.planeCause, '1 ms before plane cache expiry, the cached admission still holds').toBe(null);

            // Adverse liveness-pass phase: ticks at 314_998 + 15_000*n so the tick at 344_998 falls 1 ms before
            // the 45_000 ms re-check comes due (at 344_999), forcing detection onto the next 15_000 ms pass (359_998).
            const firstTickAfterAsk = episodeAskAt + passInterval - 1;
            let detectedAt = null;
            for (let tick = firstTickAfterAsk; tick <= 600_000; tick += passInterval) {
                clock = tick;
                await PlaneCredentialCheck.observe(owner, {presence: {state: 'degraded'}});
                await PlaneCredentialCheck.recheck(owner, clock);

                const banner = SpineBanner.deriveSpineBanner({plane: {cause: owner.data.planeCause}});
                if (banner?.text === 'pat refused') {
                    detectedAt = clock;
                    break
                }
            }

            expect(calls.map(call => call.at)).toEqual([299_999, 359_998]);
            expect(detectedAt).toBe(359_998);
            expect(detectedAt - revokedAt).toBeLessThanOrEqual(documentedBound)
        } finally {
            Date.now = originalNow
        }
    })
});
