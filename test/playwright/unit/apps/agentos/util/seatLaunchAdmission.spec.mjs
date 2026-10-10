import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'SeatLaunchAdmissionTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import SeatLaunchAdmission from '../../../../../../apps/agentos/util/SeatLaunchAdmission.mjs';

const {LAUNCH_STARTUP_BUDGET_MS} = SeatLaunchAdmission;

/**
 * @summary The seat card's words for one launch-admission snapshot: a credential the Fleet refused, a
 * proof the plane did not answer while the seat's launcher retries, the same once it gave up — and
 * nothing for a code the card does not know.
 */
test.describe('AgentOS.util.SeatLaunchAdmission', () => {
    const
        live     = {rosterState: 'live', runtime: {state: 'wired', confidence: 'observed'}},
        at       = '2026-10-10T11:30:20.000Z',
        now      = Date.parse(at) + 5000,
        snapshot = recent => ({
            state: 'active', reason: null, generation: 'generation-a', since: '2026-10-10T11:30:00.000Z',
            servers: [{key: 'memory-core', state: 'active', reason: null}], recent
        }),
        entry    = (code, reason, when = at) => ({at: when, server: 'memory-core', outcome: 'refused', code, reason});

    test('a proof the plane did not answer reads as waiting: the credential named, the issuer\'s diagnostic printed as it is, no restart while the launcher still retries (#655 AC-1)', () => {
        const line = SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane endpoint unreachable')]), {...live, canRestart: true, now});

        expect(line).toEqual({
            restart: false,
            text   : 'New Memory Core connection waiting',
            title  : "The tool credential proof for Memory Core went unanswered (plane endpoint unreachable). The seat's launcher retries on its own for about a minute. Existing tools may still work."
        });
    });

    test('an entry older than the launcher\'s budget reads as not made, with the restart hint only when the lifecycle controls allow one (#655 AC-1)', () => {
        const
            old   = snapshot([entry('proof-unavailable', 'plane endpoint unreachable')]),
            later = Date.parse(at) + LAUNCH_STARTUP_BUDGET_MS;

        expect(SeatLaunchAdmission.cardLine(old, {...live, canRestart: true, now: later})).toEqual({
            restart: true,
            text   : 'New Memory Core connection not made',
            title  : "The tool credential proof for Memory Core went unanswered (plane endpoint unreachable), and the seat's launcher gave up after about a minute. Existing tools may still work. Restart this seat to try the connection again."
        });

        const noRestart = SeatLaunchAdmission.cardLine(old, {...live, canRestart: false, now: later});

        expect(noRestart.restart).toBe(false);
        expect(noRestart.title).not.toContain('Restart this seat');
        expect(SeatLaunchAdmission.cardLine(old, {...live, canRestart: true, now: later - 1}).text).toBe('New Memory Core connection waiting');
    });

    test('a proof-unavailable entry whose reason is the credential\'s kind names that credential and prints no diagnostic; a credential code keeps its refused words and its kind (#655 AC-1, AC-2)', () => {
        const named = SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane-bearer')]), {...live, now});

        expect(named.text).toBe('New Memory Core connection waiting');
        expect(named.title).toMatch(/^The seat's plane credential proof for Memory Core went unanswered\. /);
        expect(named.title).not.toMatch(/plane-bearer|\(/);

        const refused = SeatLaunchAdmission.cardLine(snapshot([entry('credential-unproven', 'seat-pat')]), {...live, now});

        expect(refused).toEqual({
            restart: false,
            text   : 'New Memory Core connection refused',
            title  : "The seat's repository credential could not be verified for Memory Core. Existing tools may still work. Credential repair is not available in this cockpit; restarting will not repair it."
        });
        expect(SeatLaunchAdmission.cardLine(snapshot([entry('credential-missing', 'plane-bearer')]), {...live, now}).title).toContain("The seat's plane credential is missing for Memory Core");
    });

    test('a code the card does not word falls through to the server line; a later admitted entry on the same server clears a waiting one; a stale or unobserved roster says nothing (#655 AC-2)', () => {
        expect(SeatLaunchAdmission.cardLine(snapshot([entry('pending-timeout', null)]), {...live, now})).toBeNull();
        expect(SeatLaunchAdmission.cardLine(snapshot([
            entry('proof-unavailable', 'plane endpoint unreachable'),
            {at: '2026-10-10T11:30:40.000Z', server: 'memory-core', outcome: 'admitted', code: null, reason: null}
        ]), {...live, now: Date.parse(at) + 30000})).toBeNull();
        expect(SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane endpoint unreachable')]), {rosterState: 'stale', runtime: live.runtime, now})).toBeNull();
    });
});
