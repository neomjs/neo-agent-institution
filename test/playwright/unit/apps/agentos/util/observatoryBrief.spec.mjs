import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'ObservatoryBriefTest'
    }
});

import {test, expect}         from '@playwright/test';
import Neo                    from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core              from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import ObservatoryBrief       from '../../../../../../apps/agentos/util/ObservatoryBrief.mjs';
import ObservatorySceneLayout from '../../../../../../apps/agentos/util/ObservatorySceneLayout.mjs';

const
    NOW   = Date.parse('2026-10-09T05:00:00.000Z'),
    HOUR  = 3600000,
    DAY   = 24 * HOUR,
    STAMP = () => '04:50',
    q     = id => `neomjs/neo#${id}`;

/**
 * @summary A current read of the team's work, as the Brain's bounded read answers it.
 * @param {Object[]} nodes
 * @param {Object} [envelope] Fields replacing the fixture envelope's
 * @returns {Object}
 */
function read(nodes, envelope = {}) {
    return {
        capability: {state: 'current', reason: null},
        capturedAt: '2026-10-09T04:50:00.000Z',
        scene     : {route: [], nodes, edges: [], completeness: 'complete', counts: {nodes: nodes.length, edges: 0, seeds: 0}},
        snapshotId: 'snap-1',
        ...envelope
    }
}

/**
 * Around the 3-day window: pull requests merged inside and outside it and one closed unmerged, open issues fresh,
 * recent and stale, a message and a concept.
 * @type {Object[]}
 */
const TEAM = [
    {id: q('pr-12'),     label: 'merged yesterday',                 kind: 'PULL_REQUEST', state: 'MERGED', lastActivityAt: NOW - DAY},
    {id: q('pr-13'),     label: 'merged last week',                 kind: 'PULL_REQUEST', state: 'MERGED', lastActivityAt: NOW - 7 * DAY},
    {id: q('pr-14'),     label: 'closed unmerged',                  kind: 'PULL_REQUEST', state: 'CLOSED', lastActivityAt: NOW - HOUR},
    {id: q('issue-599'), label: 'The Mailbox lists open questions', kind: 'ISSUE',        state: 'OPEN',   lastActivityAt: NOW - HOUR},
    {id: q('issue-600'), label: 'open this week',                   kind: 'ISSUE',        state: 'OPEN',   lastActivityAt: NOW - 2 * DAY},
    {id: q('issue-601'), label: 'stale open issue',                 kind: 'ISSUE',        state: 'OPEN',   lastActivityAt: NOW - 30 * DAY},
    {id: q('message-1'), label: 'a message',                        kind: 'MESSAGE',                       lastActivityAt: NOW},
    {id: q('concept-1'), label: 'a concept',                        kind: 'CONCEPT'}
];

const sceneOf = envelope => ObservatorySceneLayout.fromGraphScene(envelope, {geography: 'communities', mail: true});

/**
 * @summary The Observatory head's first line: what the team did within the attention window, before any engine
 * count; zero classes silent, a read without times saying so, and a read that is not current keeping its words.
 */
test.describe('AgentOS.util.ObservatoryBrief — the team\'s sentence over a current read', () => {
    test('counts the pull requests merged and the open work in motion within the window, and names the hottest named work item', () => {
        expect(ObservatoryBrief.of(sceneOf(read(TEAM)), NOW)).toEqual({
            attention: {id: q('issue-599'), label: 'The Mailbox lists open questions', number: 599},
            inMotion : 2,
            merged   : 1,
            timed    : true,
            unknown  : 0
        })
    });

    test('a time on another node never makes untimed work read as a zero: it is unknown, beside what the read can time', () => {
        const
            untimed = {id: q('issue-700'), label: 'untimed open issue', kind: 'ISSUE', state: 'OPEN'},
            file    = {id: q('file-1'),    label: 'a file',             kind: 'FILE',  lastActivityAt: NOW - HOUR},
            lead    = nodes => ObservatoryBrief.line(read(nodes), sceneOf(read(nodes)), {formatStamp: STAMP, now: NOW}).lead;

        expect(ObservatoryBrief.of(sceneOf(read([untimed, file])), NOW)).toMatchObject({inMotion: 0, merged: 0, timed: true, unknown: 1});
        expect(lead([untimed, file])).toBe('captured 04:50 · last 3 days: 1 unknown');
        expect(lead([TEAM[0], untimed, file])).toBe('captured 04:50 · last 3 days: 1 merged · 1 unknown');
        expect(lead([{id: q('issue-701'), label: 'state omitted', kind: 'ISSUE', lastActivityAt: NOW - HOUR}, {id: q('issue-702'), label: 'state omitted, long ago', kind: 'ISSUE', lastActivityAt: NOW - 30 * DAY}]),
            'a recent item without its state is unknown; one outside the window could not count either way').toBe('captured 04:50 · last 3 days: 1 unknown');

        // the controls: the same work all timed and stale, and none of the read timed
        expect(lead([TEAM[1], TEAM[5], file])).toBe('captured 04:50 · last 3 days: nothing moved');
        expect(lead([untimed, {id: q('file-2'), label: 'an untimed file', kind: 'FILE'}])).toBe('captured 04:50 · this read carries no activity times')
    });

    test('the line: the capture stamp, the window\'s counts, the attention item with its number and title, then completeness', () => {
        expect(ObservatoryBrief.line(read(TEAM), sceneOf(read(TEAM)), {formatStamp: STAMP, now: NOW})).toEqual({
            attention: {id: q('issue-599'), text: '#599 · The Mailbox lists open questions', title: 'The Mailbox lists open questions'},
            lead     : 'captured 04:50 · last 3 days: 1 merged · 2 in motion',
            tail     : 'complete'
        })
    });

    test('a class with nothing to count stays silent, a window where nothing moved says so, and a cold read names no attention', () => {
        const
            openOnly = read([TEAM[3]]),
            stale    = read([TEAM[1], TEAM[5]]),
            memory   = read([{id: q('memory-1'), label: 'a memory', kind: 'AGENT_MEMORY', lastActivityAt: NOW - HOUR}]);

        expect(ObservatoryBrief.line(openOnly, sceneOf(openOnly), {formatStamp: STAMP, now: NOW}).lead).toBe('captured 04:50 · last 3 days: 1 in motion');
        expect(ObservatoryBrief.line(stale, sceneOf(stale), {formatStamp: STAMP, now: NOW})).toMatchObject({attention: null, lead: 'captured 04:50 · last 3 days: nothing moved'});
        expect(ObservatoryBrief.line(memory, sceneOf(memory), {formatStamp: STAMP, now: NOW}).attention, 'a work event without a GitHub number keeps its title alone')
            .toEqual({id: q('memory-1'), text: 'a memory', title: 'a memory'})
    });

    test('a read without activity times says so instead of a zero, and names no attention', () => {
        const timeless = read(TEAM.map(({lastActivityAt, ...node}) => node));

        expect(ObservatoryBrief.of(sceneOf(timeless), NOW)).toMatchObject({attention: null, timed: false});
        expect(ObservatoryBrief.line(timeless, sceneOf(timeless), {formatStamp: STAMP, now: NOW})).toEqual({
            attention: null,
            lead     : 'captured 04:50 · this read carries no activity times',
            tail     : 'complete'
        })
    });

    test('a read that is not current, or holds no node, keeps the envelope\'s own words', () => {
        const unavailable = {capability: {state: 'unavailable', reason: 'route-read-failed'}, scene: null};

        expect(ObservatoryBrief.line(unavailable, sceneOf(unavailable))).toEqual({attention: null, lead: 'Unavailable · route-read-failed', tail: null});
        expect(ObservatoryBrief.line(read([]), sceneOf(read([])), {formatStamp: STAMP}).lead).toBe('Current · captured 04:50 · no nodes · complete')
    });
});
