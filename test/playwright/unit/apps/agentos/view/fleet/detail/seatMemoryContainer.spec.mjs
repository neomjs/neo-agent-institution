import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetSeatMemoryContainerTest';

setup({
    neoConfig: {
        unitTestMode: true
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import Instance       from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';

/**
 * @summary The Seat group's Memory row: a seat added before Add Agent asked can still take its memory consent here,
 * from the same discovery and the same list as Add. The row changes nothing itself; it fires a candidate read or a
 * consent and shows what its owner sets back.
 */
test.describe('AgentOS.view.fleet.detail.SeatMemoryContainer (#572)', () => {
    let SeatMemoryContainer;

    const
        ada        = {id: 'ada', memoryImport: null},
        source     = '/Users/ada/.claude/projects/-Users-Shared-github-neomjs-neo/memory',
        candidates = {state: 'candidates', candidates: [
            {family: 'claude', source, name: 'github-neomjs-neo', notes: 918, lastChanged: '2026-10-05T09:30:00Z'},
            {family: 'claude', source: '/Users/ada/.claude/projects/-Users-Shared-claude-neomjs-neo/memory', name: 'claude-neomjs-neo', notes: 40, lastChanged: null}
        ]},
        text    = (row, reference) => row.getReference(reference).text,
        hidden  = (row, reference) => row.getReference(reference).hidden,
        offered = row => row.getReference('memory-list').store.items.map(record => record.source),
        status  = row => {
            const component = row.getReference('memory-status');

            return [component.text, component.cls.find(cls => cls.startsWith('is-'))]
        },
        fired   = row => {
            const events = [];

            row.on({
                declareSeatMemory: data => events.push(['declare', data.memoryImport]),
                readSeatMemory   : ()   => events.push(['read'])
            });

            return events
        };

    test.beforeAll(async () => {
        SeatMemoryContainer = (await import('../../../../../../../../apps/agentos/view/fleet/detail/SeatMemoryContainer.mjs')).default
    });

    test('AC-3: the line says what the definition records, never what the seat\'s home holds or that an import ran', () => {
        const
            row   = Neo.create(SeatMemoryContainer, {appName, seat: ada}),
            lines = [];

        // a seat with no choice recorded may already hold memory: the row neither empties nor clears it in words
        lines.push(text(row, 'memory-line'));
        expect(lines[0]).toBe('no import choice recorded');
        expect([hidden(row, 'memory-change'), text(row, 'memory-change')]).toEqual([false, 'Choose']);

        row.seat = {id: 'ada', memoryImport: 'none'};
        lines.push(text(row, 'memory-line'));
        expect(lines[1]).toBe('recorded: import no memory');
        expect(text(row, 'memory-change')).toBe('Change');

        row.seat = {id: 'ada', memoryImport: source};
        lines.push(text(row, 'memory-line'));
        expect(lines[2]).toBe(`recorded: import the memory at ${source}`);

        for (const line of lines) {
            expect(line, line).not.toMatch(/empty|clear|continues|opens/i)
        }

        row.seat = null;
        expect(hidden(row, 'memory-change')).toBe(true);

        row.destroy()
    });

    test('AC-1: Choose asks for the candidates, says so while it reads, then offers Add\'s list and sends the choice once', () => {
        const
            row    = Neo.create(SeatMemoryContainer, {appName, seat: ada}),
            events = fired(row);

        row.onChangeClick();
        expect(events).toEqual([['read']]);

        row.discovery = {state: 'reading'};
        expect(hidden(row, 'memory-offer')).toBe(true);
        expect(status(row)).toEqual(['Looking for existing memory…', 'is-pending']);

        row.discovery = candidates;
        expect(hidden(row, 'memory-offer')).toBe(false);
        expect(text(row, 'memory-lead')).toBe('Continue one of these agents\' memory?');
        expect(offered(row)).toEqual([source, candidates.candidates[1].source, 'none']);
        expect(hidden(row, 'memory-note')).toBe(false);
        expect(hidden(row, 'memory-retry')).toBe(true);
        // several candidates wait for the operator: a wrong memory is an identity error, never guessed
        expect(row.choice).toBeNull();

        row.onSaveClick();
        expect(status(row)[1]).toBe('is-rejected');
        expect(events).toEqual([['read']]);

        row.onCandidateClick({record: row.getReference('memory-list').store.get(source)});
        row.onSaveClick();
        expect(events).toEqual([['read'], ['declare', source]]);
        expect(text(row, 'memory-change')).toBe('Close');

        row.destroy()
    });

    test('AC-1: the other answers — none, unavailable, offline — each leave the honest choice and nothing more', () => {
        const
            row    = Neo.create(SeatMemoryContainer, {appName, seat: ada, editing: true}),
            events = fired(row);

        // no other agent's memory on this machine: importing none is the one choice, and Save records it
        row.discovery = {state: 'none'};
        expect(text(row, 'memory-lead')).toBe('No other agent\'s memory is on this machine, so there is nothing to import.');
        expect(hidden(row, 'memory-list')).toBe(true);
        row.onSaveClick();
        expect(events).toEqual([['declare', 'none']]);

        // a check that could not answer offers only the empty row, chosen explicitly, and Retry
        row.discovery = {state: 'unavailable', reason: 'the Agent OS did not answer', detail: null};
        expect(text(row, 'memory-lead')).toBe('Could not check for existing memory — the Agent OS did not answer.');
        expect(offered(row)).toEqual(['none']);
        expect(hidden(row, 'memory-retry')).toBe(false);
        expect(row.getReference('memory-offer').cls).toContain('is-unavailable');
        row.onSaveClick();
        expect(status(row)).toEqual(['Existing memory could not be checked. Retry, or choose Start with empty memory.', 'is-rejected']);

        row.onRetryClick();
        expect(events.at(-1)).toEqual(['read']);

        // no fleet: nothing can be chosen, Save is off, Retry asks again
        row.discovery = {state: 'offline', reason: 'Could not reach the fleet.'};
        expect(text(row, 'memory-lead')).toBe('Could not reach the fleet.');
        expect(row.getReference('memory-save').disabled).toBe(true);
        expect(hidden(row, 'memory-retry')).toBe(false);

        row.destroy()
    });

    test('AC-1: Change preselects the recorded consent where the answer still offers it', () => {
        const row = Neo.create(SeatMemoryContainer, {appName, seat: {id: 'ada', memoryImport: source}, editing: true});

        row.discovery = candidates;
        expect(row.choice).toBe(source);

        row.destroy()
    });

    test('AC-4: a refusal shows in the row in the Fleet\'s words, and the choice stays open to correct', () => {
        const
            row    = Neo.create(SeatMemoryContainer, {appName, seat: ada, editing: true, discovery: candidates}),
            reason = 'configureAgent: memoryImport must name a folder the Fleet offered.';

        row.status = {state: 'pending', reason: ''};
        expect(row.getReference('memory-save').disabled).toBe(true);

        row.status = {state: 'rejected', reason};
        expect(status(row)).toEqual([reason, 'is-rejected']);
        expect(hidden(row, 'memory-offer')).toBe(false);
        expect(row.getReference('memory-save').disabled).toBe(false);
        expect(text(row, 'memory-line')).toBe('no import choice recorded');

        row.destroy()
    });

    test('AC-3: a seat whose choice the Fleet closed is offered it no more, and the Fleet\'s reason stays on the row', () => {
        const
            row    = Neo.create(SeatMemoryContainer, {appName, seat: {id: 'ada', memoryImport: 'none'}}),
            reason = 'A seat\'s memory import is chosen before its first Start, and \'ada\' already holds its memory.';

        row.set({closed: true, status: {state: 'rejected', reason}});

        expect(hidden(row, 'memory-change')).toBe(true);
        expect(hidden(row, 'memory-offer')).toBe(true);
        expect(text(row, 'memory-line')).toBe('recorded: import no memory');
        expect(status(row)).toEqual([reason, 'is-rejected']);

        row.destroy()
    });

    test('Details names the chosen candidate\'s folder before Save, so two that read alike are told apart; the empty row and a closed choice detail nothing', () => {
        const
            twins = {state: 'candidates', candidates: [
                {family: 'codex', source: '/fixture/.codex/memories', name: 'codex', notes: 12, lastChanged: '2026-10-05T09:30:00Z'},
                {family: 'codex', source: '/fixture/.codex-instances/codex/memories', name: 'codex', notes: 12, lastChanged: '2026-10-05T09:30:00Z'}
            ]},
            row     = Neo.create(SeatMemoryContainer, {appName, seat: ada, editing: true}),
            details = () => [hidden(row, 'memory-details'), row.getReference('memory-details').vdom.cn[1].text],
            pick    = source => row.onCandidateClick({record: row.getReference('memory-list').store.get(source)});

        row.discovery = twins;
        // several candidates wait for a choice, so nothing is detailed yet
        expect(details()).toEqual([true, '']);

        for (const {source} of twins.candidates) {
            pick(source);
            expect(details(), source).toEqual([false, source]);
        }

        pick('none');
        expect(details()).toEqual([true, '']);

        // a check that could not answer details the producer's own words
        row.discovery = {state: 'unavailable', reason: 'the Agent OS did not answer', detail: 'memory discovery: EACCES on /fixture/.codex'};
        expect(details()).toEqual([false, 'memory discovery: EACCES on /fixture/.codex']);

        row.discovery = twins;
        pick(twins.candidates[1].source);
        row.editing = false;
        expect(details()[0]).toBe(true);

        row.destroy()
    });

    test('another seat closes the choice and clears what belonged to the last one', () => {
        const row = Neo.create(SeatMemoryContainer, {appName, seat: ada, editing: true, discovery: candidates, closed: true, status: {state: 'rejected', reason: 'no'}});

        row.seat = {id: 'grace', memoryImport: null};

        expect([row.editing, row.discovery, row.closed, row.status.state]).toEqual([false, null, false, 'idle']);
        expect(hidden(row, 'memory-offer')).toBe(true);
        expect(text(row, 'memory-change')).toBe('Choose');

        row.destroy()
    })
});
