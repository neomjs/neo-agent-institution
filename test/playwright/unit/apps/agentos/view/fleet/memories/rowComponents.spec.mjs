import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetMemoriesRowTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        unitTestMode           : true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

/**
 * The memories registers' row grammar, pinned at the cell layer (the merged #37/#38 sketch is
 * the scored spec): the summary card's head/meta/attribution/body anatomy with the DERIVED
 * provenance chip and the native drill-open button, the band eyebrow as stamped-fact-only
 * rendering, the turn row's miniSummary-title law (Brain #210 fallback), T5 viewer-local ages
 * with the exact ISO on `title`, and the pool-recycle contract (a new bag on the SAME instance
 * re-renders every channel). All layers escape text — hostile strings never become markup.
 */
test.describe('Fleet memories SummaryRow + TurnRow — the sketch\'s row grammar from one bag', () => {
    let SummaryRow, TurnRow;

    const baseSummary = {
        bandFacts            : null,
        category             : 'analysis',
        memoryCount          : 4,
        quality              : 90,
        sessionId            : '41859592-b7ee-4bce-bee3-f25644d9003b',
        sourceAgentIdentities: [],
        summary              : 'The mailbox surface renders through a real buffered grid.',
        target               : '@neo-fable-clio',
        timestamp            : '2026-08-28T15:54:27.998Z',
        title                : 'Mailbox grid conversion'
    };

    const baseTurn = {
        agentIdentity  : '@neo-fable-clio',
        amountToolCalls: 12,
        miniSummary    : null,
        prompt         : 'continue the lane',
        response       : 'The one data path landed; every battery is green.',
        timestamp      : '2026-08-28T15:54:27.998Z'
    };

    const nodeBy = (row, cls) => {
        const walk = nodes => {
            for (const node of nodes || []) {
                if (node.cls?.includes(cls)) return node;
                const hit = walk(node.cn);
                if (hit) return hit
            }
            return null
        };
        return walk(row.vdom.cn)
    };

    test.beforeAll(async () => {
        SummaryRow = (await import('../../../../../../../../apps/agentos/view/fleet/memories/SummaryRow.mjs')).default;
        TurnRow    = (await import('../../../../../../../../apps/agentos/view/fleet/memories/TurnRow.mjs')).default
    });

    test('the summary card: head anatomy, DERIVED chip, native open button, T5 meta, body', () => {
        const row = Neo.create(SummaryRow, {appName, rowData: {...baseSummary}});

        expect(nodeBy(row, 'fm-memories-card-title').text).toBe('Mailbox grid conversion');
        expect(nodeBy(row, 'fm-memories-provenance').cls).toContain('is-derived');

        const open = nodeBy(row, 'fm-memories-card-open');
        expect(open.tag).toBe('button');
        expect(open['aria-label']).toContain('41859592');

        const meta = nodeBy(row, 'fm-memories-card-meta');
        expect(meta.text).toContain('session 41859592');
        expect(meta.text).toContain('analysis');
        expect(meta.text).toContain('4 memories');
        expect(meta.text).toContain('quality 90');
        expect(meta.title).toBe('2026-08-28T15:54:27.998Z');

        expect(nodeBy(row, 'fm-memories-card-body').text).toBe('The mailbox surface renders through a real buffered grid.');
        // the band SLOT exists on every cell (height-norm — no per-card extra line); off a band
        // boundary it renders empty
        expect(nodeBy(row, 'fm-memories-band').text).toBe('');

        row.destroy()
    });

    test('the band eyebrow renders ONLY from a stamped fact; co-authors exclude the target; null prose is NAMED', () => {
        const row = Neo.create(SummaryRow, {appName, rowData: {
            ...baseSummary,
            bandFacts            : {label: 'yesterday'},
            sourceAgentIdentities: ['@neo-fable-clio', '@neo-gpt-emmy'],
            title                : null,
            summary              : null
        }});

        expect(nodeBy(row, 'fm-memories-band').text).toBe('yesterday');
        // attribution rides the ONE meta line (height-norm), ahead of the counters
        expect(nodeBy(row, 'fm-memories-card-meta').text).toContain('with @neo-gpt-emmy');
        expect(nodeBy(row, 'fm-memories-card-attribution')).toBeNull();
        expect(nodeBy(row, 'fm-memories-card-title').text).toBe('Title unavailable for this session.');
        expect(nodeBy(row, 'fm-memories-card-body').text).toBe('Summary unavailable for this session.');

        row.destroy()
    });

    test('the pool recycle contract: a new bag on the SAME instance re-renders every channel', () => {
        const row = Neo.create(SummaryRow, {appName, rowData: {...baseSummary, bandFacts: {label: 'today'}}});

        expect(nodeBy(row, 'fm-memories-band').text).toBe('today');

        row.rowData = {...baseSummary, sessionId: 'feedbeef-0000-4000-8000-000000000000', title: 'A different session'};

        expect(nodeBy(row, 'fm-memories-band').text).toBe('');
        expect(nodeBy(row, 'fm-memories-card-title').text).toBe('A different session');
        expect(nodeBy(row, 'fm-memories-card-meta').text).toContain('session feedbeef');

        row.destroy()
    });

    test('the turn row without miniSummary: bounded response head IS the line, prompt secondary, T5 meta', () => {
        const row = Neo.create(TurnRow, {appName, rowData: {...baseTurn}});

        const meta = nodeBy(row, 'fm-memories-turn-meta');
        expect(meta.text).toContain('@neo-fable-clio');
        expect(meta.text).toContain('12 tool calls');
        expect(meta.title).toBe('2026-08-28T15:54:27.998Z');

        expect(nodeBy(row, 'fm-memories-turn-title')).toBeNull();
        expect(nodeBy(row, 'fm-memories-turn-response').text).toBe('The one data path landed; every battery is green.');
        expect(nodeBy(row, 'fm-memories-turn-prompt').text).toBe('prompt · continue the lane');

        row.destroy()
    });

    test('the turn row WITH miniSummary: the tweet-size title takes the line, response drops to prose (the #210 forward contract)', () => {
        const row = Neo.create(TurnRow, {appName, rowData: {
            ...baseTurn,
            miniSummary: 'One data path lands; batteries green.'
        }});

        expect(nodeBy(row, 'fm-memories-turn-title').text).toBe('One data path lands; batteries green.');
        expect(nodeBy(row, 'fm-memories-turn-response').text).toBe('The one data path landed; every battery is green.');

        row.destroy()
    });

    test('prose bounds are presentation with an honest ellipsis; absent prose is NAMED', () => {
        const long = 'x'.repeat(700);
        const row  = Neo.create(TurnRow, {appName, rowData: {...baseTurn, response: long, prompt: null}});

        const response = nodeBy(row, 'fm-memories-turn-response').text;
        expect(response.length).toBe(601);
        expect(response.endsWith('…')).toBe(true);
        expect(nodeBy(row, 'fm-memories-turn-prompt')).toBeNull();

        row.rowData = {...baseTurn, response: null, prompt: null};
        expect(nodeBy(row, 'fm-memories-turn-response').text).toBe('Response unavailable for this turn.');

        row.destroy()
    });

    test('hostile content renders as text-only leaves on BOTH rows — no node anywhere carries html', () => {
        const hostile = 'deploy <img src=x onerror=alert(1)> done';
        const walk    = node => {
            if (!node || typeof node !== 'object') return;
            expect(node.html).toBe(undefined);
            (node.cn || []).forEach(walk)
        };

        const card = Neo.create(SummaryRow, {appName, rowData: {...baseSummary, title: hostile, summary: hostile}});
        walk(card.vdom);
        expect(nodeBy(card, 'fm-memories-card-title').text).toBe(hostile);
        card.destroy();

        const turnRow = Neo.create(TurnRow, {appName, rowData: {...baseTurn, response: hostile, miniSummary: hostile, prompt: hostile}});
        walk(turnRow.vdom);
        expect(nodeBy(turnRow, 'fm-memories-turn-title').text).toBe(hostile);
        turnRow.destroy()
    });
});
