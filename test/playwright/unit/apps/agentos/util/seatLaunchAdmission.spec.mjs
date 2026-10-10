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
 * run of proofs the plane did not answer while the launcher's budget runs, the same once the run is
 * older than the budget — and nothing for a code the card does not know.
 */
test.describe('AgentOS.util.SeatLaunchAdmission', () => {
    const
        live     = {rosterState: 'live', runtime: {state: 'wired', confidence: 'observed'}},
        at       = '2026-10-10T11:30:20.000Z',
        start    = Date.parse(at),
        now      = start + 5000,
        snapshot = recent => ({
            state: 'active', reason: null, generation: 'generation-a', since: '2026-10-10T11:30:00.000Z',
            servers: [{key: 'memory-core', state: 'active', reason: null}], recent
        }),
        entry    = (code, reason, when = at) => ({at: when, server: 'memory-core', outcome: 'refused', code, reason}),
        later    = (ms, code = 'proof-unavailable', reason = 'plane endpoint unreachable') => entry(code, reason, new Date(start + ms).toISOString()),
        admitted = ms => ({at: new Date(start + ms).toISOString(), server: 'memory-core', outcome: 'admitted', code: null, reason: null});

    test('a proof the plane did not answer reads as waiting: the credential named, the issuer\'s diagnostic printed as it is, no restart, and the instant the words change (#655 AC-1)', () => {
        const line = SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane endpoint unreachable')]), {...live, canRestart: true, now});

        expect(line).toEqual({
            restart: false,
            until  : start + LAUNCH_STARTUP_BUDGET_MS,
            text   : 'New Memory Core connection waiting',
            title  : "The tool credential proof for Memory Core went unanswered (plane endpoint unreachable). The seat's launcher retries an unanswered proof for about a minute after it starts. Existing tools may still work."
        });
    });

    test('a run older than the launcher\'s budget reads as not admitted, with the restart hint only when the lifecycle controls allow one (#655 AC-1)', () => {
        const
            old   = snapshot([entry('proof-unavailable', 'plane endpoint unreachable')]),
            budget = start + LAUNCH_STARTUP_BUDGET_MS;

        expect(SeatLaunchAdmission.cardLine(old, {...live, canRestart: true, now: budget})).toEqual({
            restart: true,
            text   : 'New Memory Core connection not admitted',
            title  : "The tool credential proof for Memory Core went unanswered (plane endpoint unreachable) for longer than the seat's launcher retries, about a minute, so it no longer retries this connection. Existing tools may still work. Restart this seat to try the connection again."
        });

        const noRestart = SeatLaunchAdmission.cardLine(old, {...live, canRestart: false, now: budget});

        expect(noRestart.restart).toBe(false);
        expect(noRestart.title).not.toContain('Restart this seat');
        expect(SeatLaunchAdmission.cardLine(old, {...live, canRestart: true, now: budget - 1}).text).toBe('New Memory Core connection waiting');
    });

    test('the budget dates from the run\'s first unanswered proof, not its latest answer; an admitted entry ends a run and the next one starts its own (#655 AC-1)', () => {
        const run = snapshot([later(0), later(30_000), later(59_000)]);

        // the latest answer is a second old, the run a minute: past the budget
        expect(SeatLaunchAdmission.cardLine(run, {...live, canRestart: true, now: start + 60_000}).text).toBe('New Memory Core connection not admitted');
        expect(SeatLaunchAdmission.cardLine(run, {...live, now: start + 59_500})).toMatchObject({
            text : 'New Memory Core connection waiting',
            until: start + LAUNCH_STARTUP_BUDGET_MS
        });

        const broken = snapshot([later(0), admitted(30_000), later(40_000), later(59_000)]);

        expect(SeatLaunchAdmission.cardLine(broken, {...live, canRestart: true, now: start + 60_000})).toMatchObject({
            text : 'New Memory Core connection waiting',
            until: start + 40_000 + LAUNCH_STARTUP_BUDGET_MS
        });
    });

    test('a reason outside the contract\'s public diagnostics is omitted; the plane\'s readiness status is one of them; a credential kind names the credential and prints no diagnostic (#655 AC-1)', () => {
        const unknown = SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'UNRECOGNIZED_PROBE_SENTINEL')]), {...live, now});

        expect(unknown.text).toBe('New Memory Core connection waiting');
        expect(unknown.title).toMatch(/^The tool credential proof for Memory Core went unanswered\. /);
        expect(unknown.title).not.toMatch(/UNRECOGNIZED|\(/);

        expect(SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane MCP readiness failed (503)')]), {...live, now}).title)
            .toContain('went unanswered (plane MCP readiness failed (503)).');

        const named = SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane-bearer')]), {...live, now});

        expect(named.text).toBe('New Memory Core connection waiting');
        expect(named.title).toMatch(/^The seat's plane credential proof for Memory Core went unanswered\. /);
        expect(named.title).not.toMatch(/plane-bearer|\(/);
    });

    test('a credential code keeps its refused words and its kind (#655 AC-2)', () => {
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
        expect(SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane endpoint unreachable'), admitted(20_000)]), {...live, now: start + 30_000})).toBeNull();
        expect(SeatLaunchAdmission.cardLine(snapshot([entry('proof-unavailable', 'plane endpoint unreachable')]), {rosterState: 'stale', runtime: live.runtime, now})).toBeNull();
    });
});
