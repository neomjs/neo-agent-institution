import {test, expect} from '@playwright/test';
import {
    SEAT_RENAME_CHANNELS,
    SEAT_RENAME_SCRIPT,
    computeRenamePlanFingerprint,
    createSeatRenameBroker,
    createSeatRenameRuntime,
    isValidSeatId
} from '../../../../harness/seatRenameBroker.mjs';

test.describe('harness/seatRenameBroker (#760)', () => {
    const
        trustedEvent   = {senderFrame: {url: 'http://127.0.0.1:8080/apps/agentos/index.html'}},
        untrustedEvent = {senderFrame: {url: 'https://evil.example/'}},
        samplePlan     = (overrides = {}) => ({
            id          : 'neo-gemini-pro',
            to          : 'neo-gemini-julia',
            seatHome    : '/Users/op/.neo-ai/agents/neo-gemini-pro',
            destination : '/Users/op/.neo-ai/agents/neo-gemini-julia',
            materialized: true,
            state       : 'copy',
            ...overrides
        });

    test('validates seat segment ids and rejects untrusted senders or non-packaged shells', async () => {
        expect(isValidSeatId('neo-gemini-julia')).toBe(true);
        expect(isValidSeatId('bad/id')).toBe(false);
        expect(isValidSeatId('..')).toBe(false);

        const broker = createSeatRenameBroker({
            packaged       : false,
            isTrustedSender: event => event === trustedEvent,
            runStep        : async () => ({state: 'planned', plan: samplePlan()})
        });

        await expect(broker.plan(untrustedEvent, {id: 'a', to: 'b'})).rejects.toThrow('seat-rename: untrusted sender');
        expect(() => broker.apply(untrustedEvent, {id: 'a', to: 'b', fingerprint: '0'.repeat(64)})).toThrow('seat-rename: untrusted sender');

        expect(await broker.plan(trustedEvent, {id: 'a', to: 'b'})).toEqual({
            state : 'refused',
            code  : 'not-packaged',
            reason: 'seat rename requires the packaged shell'
        })
    });

    test('plan returns Brain renameSeat dry-run facts without shell-side derivation and computes a 64-hex SHA-256 fingerprint', async () => {
        expect(SEAT_RENAME_SCRIPT).not.toContain('claudeSlug');
        expect(SEAT_RENAME_SCRIPT).not.toContain('retired-seats');
        expect(SEAT_RENAME_SCRIPT).toContain('renameSeat({registry, tenants: FleetTenantService, id, to, moveId: moveId || null, dryRun})');

        const
            basePlan = samplePlan(),
            broker   = createSeatRenameBroker({
                packaged       : true,
                isTrustedSender: () => true,
                runStep        : async ({step, id, to}) => {
                    expect(step).toBe('plan');
                    expect({id, to}).toEqual({id: 'neo-gemini-pro', to: 'neo-gemini-julia'});
                    return {state: 'planned', plan: basePlan}
                }
            }),
            result = await broker.plan(trustedEvent, {id: 'neo-gemini-pro', to: 'neo-gemini-julia'});

        expect(result.state).toBe('planned');
        expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(result.fingerprint).toBe(computeRenamePlanFingerprint(basePlan));
        expect(result.plan).toEqual({
            id          : 'neo-gemini-pro',
            to          : 'neo-gemini-julia',
            seatHome    : '/Users/op/.neo-ai/agents/neo-gemini-pro',
            destination : '/Users/op/.neo-ai/agents/neo-gemini-julia',
            materialized: true,
            state       : 'copy',
            fingerprint : result.fingerprint
        })
    });

    test('refuses plan when seat is still running or ids are invalid/identical', async () => {
        const broker = createSeatRenameBroker({
            packaged       : true,
            isTrustedSender: () => true,
            runStep        : async () => ({
                state : 'refused',
                reason: "seat 'neo-gemini-pro' may still be running: pid 4242 is alive",
                plan  : {id: 'neo-gemini-pro', to: 'neo-gemini-julia'}
            })
        });

        expect(await broker.plan(trustedEvent, {id: 'neo-gemini-pro', to: 'neo-gemini-pro'})).toMatchObject({
            state: 'refused',
            code : 'same-seat-id'
        });

        expect(await broker.plan(trustedEvent, {id: 'neo-gemini-pro', to: 'bad/name'})).toMatchObject({
            state: 'refused',
            code : 'invalid-seat-id'
        });

        expect(await broker.plan(trustedEvent, {id: 'neo-gemini-pro', to: 'neo-gemini-julia'})).toEqual({
            state : 'refused',
            code  : 'plan-refused',
            stage : 'plan',
            reason: "seat 'neo-gemini-pro' may still be running: pid 4242 is alive",
            plan  : {id: 'neo-gemini-pro', to: 'neo-gemini-julia'}
        })
    });

    test('apply verifies fingerprint, quiesces the Fleet child around the apply step, and returns renamed outcome', async () => {
        const
            events   = [],
            basePlan = samplePlan(),
            broker   = createSeatRenameBroker({
                packaged       : true,
                isTrustedSender: () => true,
                quiesceFleet   : async work => {
                    events.push('fleet:stop');
                    try {
                        return await work()
                    } finally {
                        events.push('fleet:restart')
                    }
                },
                runStep        : async ({step, id, to, moveId}) => {
                    events.push(`step:${step}`);
                    if (step === 'plan') {
                        return {state: 'planned', plan: basePlan}
                    }
                    expect(moveId).toBeTruthy();
                    return {
                        state: 'renamed',
                        agent: {id: to, displayName: 'Julia', harnessType: 'antigravity'},
                        plan : {
                            ...basePlan,
                            id,
                            to,
                            state          : 'copy',
                            sessions       : {project: '/Users/op/.gemini/projects/neo-gemini-julia'},
                            retiredSeatHome: '/Users/op/.neo-ai/retired-seats/neo-gemini-pro.pre-rename-20261020'
                        }
                    }
                }
            }),
            planned = await broker.plan(trustedEvent, {id: 'neo-gemini-pro', to: 'neo-gemini-julia'});

        events.length = 0;

        const badFp = await broker.apply(trustedEvent, {
            id         : 'neo-gemini-pro',
            to         : 'neo-gemini-julia',
            fingerprint: 'a'.repeat(64)
        });
        expect(badFp).toMatchObject({
            state: 'refused',
            code : 'plan-changed',
            stage: 'verify-plan'
        });
        expect(events).toEqual(['step:plan']);

        events.length = 0;

        const applied = await broker.apply(trustedEvent, {
            id         : 'neo-gemini-pro',
            to         : 'neo-gemini-julia',
            fingerprint: planned.fingerprint
        });

        expect(applied.state).toBe('renamed');
        expect(applied.agent).toEqual({id: 'neo-gemini-julia', displayName: 'Julia', harnessType: 'antigravity'});
        expect(applied.plan.sessions).toEqual({project: '/Users/op/.gemini/projects/neo-gemini-julia'});
        expect(applied.plan.retiredSeatHome).toBe('/Users/op/.neo-ai/retired-seats/neo-gemini-pro.pre-rename-20261020');
        expect(events).toEqual(['step:plan', 'fleet:stop', 'step:apply', 'fleet:restart'])
    });

    test('apply preserves refusal stage and restarts Fleet child even when apply step refuses', async () => {
        const
            events   = [],
            basePlan = samplePlan(),
            fp       = computeRenamePlanFingerprint(basePlan),
            broker   = createSeatRenameBroker({
                packaged       : true,
                isTrustedSender: () => true,
                quiesceFleet   : async work => {
                    events.push('fleet:stop');
                    try {
                        return await work()
                    } finally {
                        events.push('fleet:restart')
                    }
                },
                runStep        : async ({step}) => {
                    if (step === 'plan') return {state: 'planned', plan: basePlan};
                    return {
                        state : 'refused',
                        code  : 'copy-failed',
                        stage : 'publish-copy',
                        reason: 'staging folder already exists',
                        plan  : basePlan
                    }
                }
            }),
            outcome = await broker.apply(trustedEvent, {
                id         : 'neo-gemini-pro',
                to         : 'neo-gemini-julia',
                fingerprint: fp
            });

        expect(outcome).toMatchObject({
            state : 'refused',
            code  : 'copy-failed',
            stage : 'publish-copy',
            reason: 'staging folder already exists'
        });
        expect(events).toEqual(['fleet:stop', 'fleet:restart']);
        expect(SEAT_RENAME_CHANNELS).toEqual({
            apply: 'shell-seat-rename-apply',
            plan : 'shell-seat-rename-plan'
        })
    });

    test('createSeatRenameRuntime binds repoRoot and userData into runBrainScript', async () => {
        let captured = null;
        const runtime = createSeatRenameRuntime({
            repoRoot : '/opt/brain',
            userData : '/tmp/nonexistent-userdata-760',
            execPath : '/opt/Electron',
            runScript: async args => {
                captured = args;
                return {state: 'planned', plan: samplePlan()}
            }
        });

        await runtime.runStep({step: 'plan', id: 'neo-gemini-pro', to: 'neo-gemini-julia'});
        expect(captured.repoRoot).toBe('/opt/brain');
        expect(captured.env.NEO_HARNESS_SEAT_RENAME_STEP).toBe('plan');
        expect(captured.env.NEO_HARNESS_SEAT_RENAME_ID).toBe('neo-gemini-pro');
        expect(captured.env.NEO_HARNESS_SEAT_RENAME_TO).toBe('neo-gemini-julia')
    })
});
