import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'MemoriesReadingSurfaceTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import MemoriesPane   from '../../../../../../../../apps/agentos/view/fleet/memories/Container.mjs';

/**
 * @summary Prose of an exact length, with word breaks and no ellipsis anywhere in it.
 * @param {Number} length
 * @param {String} [seed='word']
 * @returns {String}
 */
function prose(length, seed = 'word') {
    let text = '', i = 0;

    while (text.length < length) {
        text += `${text ? ' ' : ''}${seed}${i++}`
    }

    return text.slice(0, length)
}

const
    LONG_SUMMARY = prose(3000, 'summary'),
    TURN         = {id: 't1', sessionId: 's1-session', timestamp: '2026-08-02T20:00:00.000Z', miniSummary: null, prompt: prose(900, 'prompt'), thought: prose(2400, 'thought'), response: prose(4000, 'response'), agentIdentity: '@neo-opus-grace', amountToolCalls: 7};

/**
 * @summary One session-summary row.
 * @param {String} id
 * @param {Object} [overrides]
 * @returns {Object}
 */
function row(id, overrides = {}) {
    return {id, sessionId: `${id}-session`, timestamp: '2026-08-02T20:00:00.000Z', title: `Title ${id}`, summary: `Summary ${id}`, category: 'analysis', memoryCount: 3, quality: 90, impact: 40, sourceAgentIdentities: ['@neo-opus-grace'], ...overrides}
}

/**
 * @summary A pane reading `@neo-opus-grace`'s three summaries, the first one long.
 * @returns {{pane: Object, summaryGrid: Object, turnGrid: Object, reader: Object, intents: Object[]}}
 */
function readyPane() {
    const
        intents = [],
        pane    = Neo.create(MemoriesPane, {
            listeners: {sessionDetailRequest: ({source, ...params}) => intents.push(params)}
        });

    pane.activeAgent = '@neo-opus-grace';
    pane.snapshot    = {
        capability: {state: 'wired', capturedAt: '2026-08-03T09:00:00.000Z'},
        target    : '@neo-opus-grace',
        page      : {offset: 0, limit: 20},
        sessions  : [row('s1', {summary: LONG_SUMMARY}), row('s2'), row('s3', {summary: 42})],
        count     : 3,
        total     : 3
    };

    return {
        pane,
        intents,
        reader     : pane.getReference('memories-reader'),
        summaryGrid: pane.getReference('memories-summary-grid'),
        turnGrid   : pane.getReference('memories-turn-grid')
    }
}

/**
 * @summary Every text leaf under a vdom node, in order.
 * @param {Object} node
 * @returns {String[]}
 */
function texts(node) {
    return [node.text, ...(node.cn || []).flatMap(texts)].filter(text => typeof text === 'string' && text)
}

/**
 * @summary The nodes under a vdom node that carry one class.
 * @param {Object} node
 * @param {String} cls
 * @returns {Object[]}
 */
function nodesWith(node, cls) {
    return [...node.cls?.includes(cls) ? [node] : [], ...(node.cn || []).flatMap(child => nodesWith(child, cls))]
}

/**
 * @summary The engine's own row click on one register, the way the RowModel receives it.
 * @param {Object} grid
 * @param {Number} index
 */
function click(grid, index) {
    grid.view.selectionModel.onRowClick({record: grid.store.getAt(index)})
}

test.describe('MemoriesPane — reading a memory whole (#506)', () => {
    test('a selected summary reads whole beside its rail; selecting it again returns the list', () => {
        const {pane, reader, summaryGrid} = readyPane();

        // idle: the reader names the act, the list keeps its cards
        expect(reader.hidden).toBe(false);
        expect(texts(reader.vdom)).toContain('Select a session summary to read it in full.');
        expect(pane.cls).not.toContain('is-reading');
        expect(summaryGrid.rail).toBe(false);

        click(summaryGrid, 0);

        const read = texts(reader.vdom);

        expect(read).toContain(LONG_SUMMARY);   // all 3,000 characters, one node
        expect(read.some(text => text.includes('…'))).toBe(false);
        expect(read).toContain('Title s1');
        expect(nodesWith(reader.vdom, 'fm-memories-read-turns')).toHaveLength(1);
        expect(pane.cls).toContain('is-reading');
        expect(summaryGrid.rail).toBe(true);
        expect(summaryGrid.rowHeight).toBe(84);
        expect(pane.getReference('memories-splitter').hidden).toBe(false);

        click(summaryGrid, 0);

        expect(texts(reader.vdom)).toContain('Select a session summary to read it in full.');
        expect(summaryGrid.rail).toBe(false);
        expect(summaryGrid.rowHeight).toBe(132);
        expect(pane.getReference('memories-splitter').hidden).toBe(true)
    });

    test('a selected turn reads as prompt, thought and response, whole, with a copy action each', () => {
        const {pane, reader, summaryGrid, turnGrid} = readyPane();

        pane.openSession({sessionId: 's1-session', title: 'Title s1'});
        pane.drillSnapshot = {capability: {state: 'wired'}, sessionId: 's1-session', page: {offset: 0}, turns: [TURN], total: 1};

        expect(texts(reader.vdom)).toContain('Select a turn to read it in full.');

        click(turnGrid, 0);

        expect(nodesWith(reader.vdom, 'fm-memories-read-label').map(node => node.text)).toEqual(['Prompt', 'Thought', 'Response']);
        expect(nodesWith(reader.vdom, 'fm-memories-read-text').map(node => node.text)).toEqual([TURN.prompt, TURN.thought, TURN.response]);
        expect(nodesWith(reader.vdom, 'fm-memories-read-copy').map(node => node['aria-label'])).toEqual(['Copy the prompt', 'Copy the thought', 'Copy the response']);
        expect(turnGrid.rail).toBe(true);
        expect(summaryGrid.rail).toBe(false)
    });

    test('↑/↓ move the reading with the selection; Escape closes it and clears the selection', () => {
        const {pane, reader, summaryGrid} = readyPane(),
              model                       = summaryGrid.view.selectionModel;

        click(summaryGrid, 0);
        model.onNavKeyRow(1);

        expect(texts(reader.vdom)).toContain('Summary s2');
        expect(texts(reader.vdom)).not.toContain(LONG_SUMMARY);

        model.onNavKeyRow(-1);
        expect(texts(reader.vdom)).toContain(LONG_SUMMARY);

        pane.onEscape();

        expect(model.selectedRows).toEqual([]);
        expect(texts(reader.vdom)).toContain('Select a session summary to read it in full.');
        expect(summaryGrid.rail).toBe(false)
    });

    test('show all reads every loaded record whole, in list order; Escape leaves it before anything else', () => {
        const {pane, reader, summaryGrid} = readyPane(),
              button                      = pane.getReference('memories-show-all');

        expect(button.hidden).toBe(false);

        pane.onShowAllClick();

        expect(nodesWith(reader.vdom, 'fm-memories-read-title').map(node => node.text)).toEqual(['Title s1', 'Title s2', 'Title s3']);
        expect(texts(reader.vdom)).toContain(LONG_SUMMARY);
        expect(summaryGrid.rail).toBe(true);
        expect(button.pressed).toBe(true);
        expect(button.text).toBe('One at a time');

        click(summaryGrid, 1);
        pane.onEscape();   // show all goes first; the selection stays

        expect(pane.showAll).toBe(false);
        expect(texts(reader.vdom)).toContain('Summary s2');

        pane.onEscape();
        expect(texts(reader.vdom)).toContain('Select a session summary to read it in full.')
    });

    test('a field the plane did not return as a string is named with the record id, and offers no copy', () => {
        const {pane, reader, summaryGrid, turnGrid} = readyPane();

        click(summaryGrid, 2);   // s3's summary arrived as a number; the model's convert made it null
        expect(texts(reader.vdom)).toContain('The plane returned no summary text · summary s3');

        pane.openSession({sessionId: 's3-session', title: 'Title s3'});
        pane.drillSnapshot = {capability: {state: 'wired'}, sessionId: 's3-session', page: {offset: 0}, turns: [{...TURN, id: 't9', sessionId: 's3-session', thought: null}], total: 1};
        click(turnGrid, 0);

        expect(texts(reader.vdom)).toContain('The plane returned no thought for this turn · turn t9');
        expect(nodesWith(reader.vdom, 'fm-memories-read-copy')).toHaveLength(2)
    });

    test('the reader\'s Read the turns opens that session; a target switch drops the reading', () => {
        const {pane, intents, reader, summaryGrid} = readyPane();

        click(summaryGrid, 0);
        reader.fire('drillRequest', {record: reader.reading.records[0]});

        expect(intents).toEqual([{sessionId: 's1-session', title: 'Title s1'}]);
        expect(pane.drillSession).toEqual({sessionId: 's1-session', title: 'Title s1'});

        pane.onDrillBackClick();
        expect(texts(reader.vdom)).toContain(LONG_SUMMARY);   // the summary is still read on return

        pane.activeAgent = '@neo-opus-ada';

        expect(pane.readSummaryId).toBe(null);
        expect(summaryGrid.view.selectionModel.selectedRows).toEqual([]);
        expect(reader.hidden).toBe(true)
    });
});
