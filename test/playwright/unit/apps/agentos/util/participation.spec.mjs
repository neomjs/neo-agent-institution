import {setup} from '../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'ParticipationTest'}
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Participation  from '../../../../../../apps/agentos/util/Participation.mjs';

/**
 * @summary The Participation group's command is an effect-bearing string even though the cockpit never runs it: a
 * copied command must carry exactly the identity the row names, and say where it reaches the graph it changes.
 */
test.describe('AgentOS.util.Participation — the one command that fits, and where it runs', () => {
    const
        attached = 'http://127.0.0.1:3102',
        benched  = login => ({githubUsername: login, participationStatus: 'operator_benched', participationRead: {state: 'read'}}),
        // an accepted command holds only shell-inert characters, so any POSIX shell splits it into exactly these words
        argvOf   = command => command.split(' ');

    test('a plain handle is one literal argument: the copied command tokenizes into exactly the intended identity', () => {
        for (const [login, identity] of [['neo-preview', '@neo-preview'], ['@neo-gpt-sophie', '@neo-gpt-sophie'], ['user.name_2', '@user.name_2']]) {
            const
                {command} = Participation.instructionOf(benched(login), attached),
                argv      = argvOf(command);

            expect(argv.filter(word => word === '--identity'), login).toHaveLength(1);
            expect(argv[argv.indexOf('--identity') + 1], login).toBe(identity);
            expect(argv.every(word => /^[A-Za-z0-9@./_=":<>-]+$/.test(word)), command).toBe(true)
        }
    });

    test('an identity that is not a plain handle gets no command to copy, never an escaped one: option injection, quotes, whitespace and shell metacharacters', () => {
        for (const login of ['agent-a --identity @agent-b', 'agent-a\'b', 'agent"a', 'agent a', 'agent;rm', '$(id)', '`id`', 'agent|x', 'agent&x', '-agent', '@', '']) {
            const instruction = Participation.instructionOf(benched(login), attached);

            expect(Participation.commandOf(benched(login)), login).toBeNull();
            expect(instruction, login).toEqual({command: null, place: login ? 'No command is offered: the seat\'s identity is not a plain handle.' : 'No command is offered: the seat names no identity.'})
        }
    });

    test('where it runs follows the plane the shell is attached to; with none named, no command is offered rather than a guessed place', () => {
        const record = benched('neo-preview');

        expect(Participation.instructionOf(record, attached).place).toBe('Run it on this machine, where the plane at 127.0.0.1:3102 runs its Memory Core (on a Docker plane, inside its container).');
        expect(Participation.instructionOf(record, 'https://plane.example.net:3102/mc').place).toBe('Run it on the plane host plane.example.net:3102, where its Memory Core runs (on a Docker plane, inside its container).');

        // the shell's own plan (no plane URL: it runs the Brain itself) and an unparseable base name no reachable graph
        for (const planeBase of [null, 'not a url']) {
            expect(Participation.instructionOf(record, planeBase), String(planeBase)).toEqual({command: null, place: 'No command is offered: this view cannot name where the plane\'s Memory Core runs.'})
        }

        // nothing to change, nothing to say
        expect(Participation.instructionOf({participationStatus: null, participationRead: {state: 'read'}}, attached)).toEqual({command: null, place: null})
    });

    test('one command per state: bench with a visible reason placeholder, activate, and show for an unread or other status', () => {
        const command = facts => Participation.commandOf({githubUsername: 'neo-preview', ...facts});

        expect(command({participationStatus: 'active'})).toBe('node ai/scripts/fleet/participation.mjs bench --identity @neo-preview --reason "<why>" --apply');
        expect(command({participationStatus: 'operator_benched'})).toBe('node ai/scripts/fleet/participation.mjs activate --identity @neo-preview --apply');
        expect(command({participationStatus: null, participationRead: {state: 'unread', reason: 'presence unreadable'}})).toBe('node ai/scripts/fleet/participation.mjs show --identity @neo-preview');
        expect(command({participationStatus: 'temporarily_unreachable'})).toBe('node ai/scripts/fleet/participation.mjs show --identity @neo-preview');
        expect(command({participationStatus: null, participationRead: {state: 'read'}})).toBeNull()
    })
});
