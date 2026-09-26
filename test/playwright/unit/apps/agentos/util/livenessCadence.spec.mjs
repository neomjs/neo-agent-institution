import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'LivenessCadenceTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import LivenessCadence             from '../../../../../../apps/agentos/util/LivenessCadence.mjs';
import {ROSTER_CROSSING_WINDOW_MS} from '../../../../../../harness/adapterWitness.mjs';

/**
 * @summary The cadence's contract: every read comes due on its own interval, a due read is
 * rescheduled whether or not it launches, and it launches unless its unsettled wires fill the cap.
 */
test.describe('AgentOS.util.LivenessCadence', () => {
    const
        intervals = LivenessCadence.DEFAULT_INTERVALS,
        idle      = () => 0;

    test('a fresh schedule puts every read one interval out: the mount reads have just run', () => {
        const dueAt = LivenessCadence.create(1000, intervals);

        expect(Object.keys(dueAt)).toEqual(Object.keys(LivenessCadence.READS));
        Object.keys(dueAt).forEach(key => expect(dueAt[key]).toBe(1000 + intervals[key]))
    });

    test('a read launches only once it is due, and then comes due one interval later', () => {
        let dueAt = LivenessCadence.create(0, intervals);

        const early = LivenessCadence.plan(dueAt, {cap: 2, inFlight: idle, intervals, now: 59999});

        expect(early.launch).toEqual([]);
        expect(early.dueAt).toEqual(dueAt);

        const minute = LivenessCadence.plan(dueAt, {cap: 2, inFlight: idle, intervals, now: 60000});

        expect(minute.launch).toEqual(['activity', 'roster']);
        expect(minute.dueAt.roster).toBe(120000);
        expect(minute.dueAt.tasks, 'a read not yet due keeps its turn').toBe(120000);

        dueAt = minute.dueAt;

        expect(LivenessCadence.plan(dueAt, {cap: 2, inFlight: idle, intervals, now: 120000}).launch)
            .toEqual(['activity', 'roster', 'brainHealth', 'tasks', 'deploymentState'])
    });

    test('a due read whose wires fill the cap does not launch, and still waits a whole interval', () => {
        const {launch, dueAt: next} = LivenessCadence.plan(LivenessCadence.create(0, intervals), {
            cap     : 2,
            inFlight: key => key === 'roster' ? 2 : 0,
            intervals,
            now     : 60000
        });

        expect(launch).toEqual(['activity']);
        expect(next.roster).toBe(120000)
    });

    test('a hung wire below the cap does not suppress the probe that would notice recovery', () => {
        const {launch} = LivenessCadence.plan(LivenessCadence.create(0, intervals), {
            cap     : 2,
            inFlight: key => key === 'roster' ? 1 : 0,
            intervals,
            now     : 60000
        });

        expect(launch).toContain('roster')
    });

    test('ten minutes of 15 s passes at the default cadence launch 35 reads, where one shared tick launched 200', () => {
        let dueAt    = LivenessCadence.create(0, intervals),
            launched = 0;

        for (let now = 15000; now <= 600000; now += 15000) {
            const pass = LivenessCadence.plan(dueAt, {cap: 2, inFlight: idle, intervals, now});

            launched += pass.launch.length;
            dueAt     = pass.dueAt
        }

        expect(launched).toBe(10 + 10 + 5 + 5 + 5)
    });

    test('the next roster read lands inside the window the packaged smoke waits after a popup closes', () => {
        // A roster read comes due one interval after the last and launches on the first pass after
        // that: a popup that closes just after a launch sees the next one at most interval + pass later.
        expect(intervals.roster + LivenessCadence.DEFAULT_PASS).toBeLessThanOrEqual(ROSTER_CROSSING_WINDOW_MS)
    })
});
