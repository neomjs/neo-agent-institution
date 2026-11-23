import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'SeatCredentialUtilTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import SeatCredential from '../../../../../../apps/agentos/util/SeatCredential.mjs';

/**
 * @summary Unit contract for `AgentOS.util.SeatCredential` (#902): stopped-vs-running gate,
 * `getAgent(id).planeCredential` classification + failed-read fallback, shell-only replacement
 * round-trip, Fix-3 next-step rules, and 7-day `tokenExpiresAt` expiry evaluation.
 */
test.describe('AgentOS.util.SeatCredential (#902)', () => {
    const NOW = Date.parse('2026-11-23T12:00:00.000Z');

    test('AC-2: availability allows replacement only when stopped and names cause seat-running otherwise', () => {
        expect(SeatCredential.availability({agentId: 'clio', state: 'off'})).toEqual({
            canReplace: true,
            cause     : null,
            reason    : null
        });

        for (const state of ['ok', 'idle', 'wedged', 'limited']) {
            const verdict = SeatCredential.availability({agentId: 'clio', state});
            expect(verdict.canReplace, state).toBe(false);
            expect(verdict.cause, state).toBe('seat-running');
            expect(verdict.reason, state).toContain('seat-running')
        }

        const starting = SeatCredential.availability({agentId: 'clio', state: 'off', pendingAction: 'start'});
        expect(starting.canReplace).toBe(false);
        expect(starting.cause).toBe('seat-running');

        expect(SeatCredential.availability(null)).toEqual({canReplace: false, cause: null, reason: null})
    });

    test('AC-3: readPlaneCredential drives scope choice only for same-as-forge and distinct; none, unreadable, and failed reads use GitHub only', async () => {
        const same = await SeatCredential.readPlaneCredential({getAgent: async () => ({id: 'clio', planeCredential: 'same-as-forge'})}, 'clio');
        expect(same).toMatchObject({
            planeCredential: 'same-as-forge',
            failed         : false,
            needsChoice    : true,
            autoScope      : null
        });
        expect(same.note).toContain('same token today');

        const distinct = await SeatCredential.readPlaneCredential({getAgent: async () => ({id: 'clio', planeCredential: 'distinct'})}, 'clio');
        expect(distinct).toMatchObject({
            planeCredential: 'distinct',
            failed         : false,
            needsChoice    : true,
            autoScope      : null
        });
        expect(distinct.note).toContain('different token today');
        expect(distinct.note).toContain('overwrite');

        const none = await SeatCredential.readPlaneCredential({getAgent: async () => ({id: 'clio', planeCredential: 'none'})}, 'clio');
        expect(none).toEqual({
            planeCredential: 'none',
            failed         : false,
            needsChoice    : false,
            autoScope      : 'forge',
            reason         : null,
            note           : null
        });

        const unreadable = await SeatCredential.readPlaneCredential({getAgent: async () => ({id: 'clio', planeCredential: 'unreadable'})}, 'clio');
        expect(unreadable).toMatchObject({
            planeCredential: 'unreadable',
            failed         : false,
            needsChoice    : false,
            autoScope      : 'forge'
        });
        expect(unreadable.note).toContain('Agent OS choice is unavailable');

        const thrown = await SeatCredential.readPlaneCredential({
            getAgent: async () => { throw new Error('plane keyring locked — token: ghp_secret123') }
        }, 'clio');
        expect(thrown).toMatchObject({
            planeCredential: 'unreadable',
            failed         : true,
            needsChoice    : false,
            autoScope      : 'forge',
            reason         : 'plane keyring locked — [redacted]'
        });
        expect(thrown.note).toContain('plane keyring locked — [redacted]');
        expect(thrown.note).not.toContain('ghp_secret123');

        const missingVerb = await SeatCredential.readPlaneCredential({}, 'clio');
        expect(missingVerb).toMatchObject({
            planeCredential: 'unreadable',
            failed         : true,
            needsChoice    : false,
            autoScope      : 'forge'
        });
        expect(missingVerb.note).toContain('this Fleet cannot read the seat definition')
    });

    test('replace requires shell credentialIngress, forwards only {id, scope}, and normalizes receipts', async () => {
        const calls = [];
        const bridge = {
            credentialIngress: 'shell',
            replaceSeatCredential: async payload => {
                calls.push(payload);
                return {
                    status : 'replaced',
                    id     : payload.id,
                    scope  : payload.scope,
                    receipt: {scope: payload.scope, nextStep: 'start-agent', coherent: true, incomplete: false}
                }
            }
        };

        const ok = await SeatCredential.replace(bridge, {id: 'clio', scope: 'forge-and-bound-plane', credential: 'ghp_must_not_cross'});
        expect(calls).toEqual([{id: 'clio', scope: 'forge-and-bound-plane'}]);
        expect(ok).toMatchObject({ok: true, status: 'replaced', scope: 'forge-and-bound-plane'});

        const nonShell = await SeatCredential.replace({replaceSeatCredential: async () => ({status: 'replaced'})}, {id: 'clio', scope: 'forge'});
        expect(nonShell.ok).toBe(false);
        expect(nonShell.reason).toContain('installed Fleet Manager')
    });

    test('AC-4: nextStep matches all three Fix-3 cases and returns null for other refusals', () => {
        const startForgeRefused = SeatCredential.nextStep({
            controlReason: {
                action           : 'start',
                kind             : 'rejected',
                reason           : "agent 'clio' has no GitHub PAT stored; store one before starting it.",
                credentialRefusal: {surface: 'forge', verdict: 'refused', cause: 'indeterminate'}
            }
        });
        expect(startForgeRefused).toEqual({
            kind       : 'start-refused',
            actionLabel: 'Replace token',
            retryScope : null,
            reason     : "agent 'clio' has no GitHub PAT stored; store one before starting it."
        });

        const startIncomplete = SeatCredential.nextStep({
            controlReason: {
                action: 'start',
                kind  : 'rejected',
                code  : 'FLEET_SEAT_CREDENTIAL_REPLACEMENT_INCOMPLETE',
                reason: "agent 'clio' has an incomplete credential replacement across its forge and plane stores; re-run replaceSeatCredential to reconcile it before starting."
            }
        });
        expect(startIncomplete).toMatchObject({
            kind       : 'start-refused',
            actionLabel: 'Replace token',
            retryScope : null
        });

        const openWorkRefused = SeatCredential.nextStep({
            openWorkCredentialRefusal: {
                surface: 'forge',
                verdict: 'refused',
                cause  : 'insufficient-capability',
                reason : 'token lacks read:org'
            }
        });
        expect(openWorkRefused).toEqual({
            kind       : 'open-work-refused',
            actionLabel: 'Replace token',
            retryScope : null,
            reason     : 'token lacks read:org'
        });

        const incompleteReceipt = SeatCredential.nextStep({}, {
            receipt: {nextStep: 'replace-seat-credential', scope: 'forge-and-bound-plane'},
            reason : 'seat plane credential could not be persisted'
        });
        expect(incompleteReceipt).toEqual({
            kind       : 'incomplete-receipt',
            actionLabel: 'Replace token',
            retryScope : 'forge-and-bound-plane',
            reason     : 'seat plane credential could not be persisted'
        });

        // Non-matching refusals return null so today's text stands untouched
        expect(SeatCredential.nextStep({
            controlReason: {action: 'start', kind: 'rejected', reason: "agent 'vega' was released to its own harness."}
        })).toBeNull();
        expect(SeatCredential.nextStep({
            controlReason: {
                action           : 'start',
                kind             : 'rejected',
                reason           : 'plane bearer rejected',
                credentialRefusal: {surface: 'plane', verdict: 'refused'}
            }
        })).toBeNull();
        expect(SeatCredential.nextStep({
            openWorkCredentialRefusal: {surface: 'forge', verdict: 'unanswered'}
        })).toBeNull()
    });

    test('AC-5: describeExpiry and cardLine flag tokens expiring within 7 days with Replace token, and null shows nothing', () => {
        expect(SeatCredential.describeExpiry(null, NOW)).toBeNull();
        expect(SeatCredential.cardLine({agentId: 'clio', tokenExpiresAt: null}, {now: NOW})).toBeNull();

        const threeDays = new Date(NOW + 3 * 86_400_000).toISOString();
        const soon      = SeatCredential.describeExpiry(threeDays, NOW);
        expect(soon.expiringSoon).toBe(true);
        expect(soon.expired).toBe(false);
        expect(soon.detailText).toContain('in 3d');
        expect(soon.detailText).toContain('Replace token');
        expect(SeatCredential.cardLine({agentId: 'clio', tokenExpiresAt: threeDays}, {now: NOW})).toMatchObject({
            kind : 'token-expiring',
            state: 'expiring',
            text : '⚠ GitHub token expires in 3d · Replace token'
        });

        // Exact 7-day boundary flags; > 7 days shows in Detail without flagging on the cockpit card
        const exactSevenDays = new Date(NOW + 7 * 86_400_000).toISOString();
        expect(SeatCredential.describeExpiry(exactSevenDays, NOW).expiringSoon).toBe(true);

        const thirtyDays = new Date(NOW + 30 * 86_400_000).toISOString();
        const later      = SeatCredential.describeExpiry(thirtyDays, NOW);
        expect(later.expiringSoon).toBe(false);
        expect(later.detailText).toBe(`GitHub token expires ${thirtyDays}`);
        expect(SeatCredential.cardLine({agentId: 'clio', tokenExpiresAt: thirtyDays}, {now: NOW})).toBeNull();

        const alreadyExpired = new Date(NOW - 60_000).toISOString();
        expect(SeatCredential.cardLine({agentId: 'clio', tokenExpiresAt: alreadyExpired}, {now: NOW})).toMatchObject({
            kind : 'token-expiring',
            state: 'expiring',
            text : '⚠ GitHub token expired · Replace token'
        })
    });
});
