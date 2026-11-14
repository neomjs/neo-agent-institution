import {setup} from '../../../../../../setup.mjs';

const appName = 'ObservatoryNodeListTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: false,
        unitTestMode           : true,
        useDomApiRenderer      : false
    },
    appConfig: {
        name             : appName,
        isMounted        : () => true,
        vnodeInitialising: false
    }
});

import {expect, test}                from '@playwright/test';
import Neo                           from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core                     from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import ObservatoryNodeList           from '../../../../../../../../apps/agentos/view/fleet/goldenpath/ObservatoryNodeList.mjs';
import ObservatoryNodesHeadContainer from '../../../../../../../../apps/agentos/view/fleet/goldenpath/ObservatoryNodesHeadContainer.mjs';

const
    NOW   = Date.parse('2026-10-09T06:00:00.000Z'),
    HOUR  = 3600000,
    DAY   = 24 * HOUR,
    // a scene in the layout's order, the route's seed first: the seed untouched for ten days, a discussion outside
    // the window, a message and a file that changed within it, a PR merged this morning, a moved issue, an issue
    // without an activity time
    SCENE = {nodes: [
        {id: 'route-seed',     kind: 'ISSUE',        state: 'OPEN',   lastActivityAt: NOW - 10 * DAY},
        {id: 'old-discussion', kind: 'DISCUSSION',   state: 'OPEN',   lastActivityAt: NOW - 5 * DAY},
        {id: 'message',        kind: 'MESSAGE',                       lastActivityAt: NOW},
        {id: 'file',           kind: 'FILE',                          lastActivityAt: NOW - HOUR},
        {id: 'merged-pr',      kind: 'PULL_REQUEST', state: 'MERGED', lastActivityAt: NOW - 2 * HOUR},
        {id: 'moved-issue',    kind: 'ISSUE',        state: 'OPEN',   lastActivityAt: NOW - 3 * HOUR},
        {id: 'no-time',        kind: 'ISSUE',        state: 'OPEN',   lastActivityAt: null}
    ]},
    RELATIONS = [0, 3, 1, 1, 2, 0, 3],
    idsOf     = (scene, order) => order.map(index => scene.nodes[index].id);

test.describe('AgentOS.view.fleet.goldenpath.ObservatoryNodeList — the order the Nodes list reads in, and its name', () => {
    test('by default the work that changed within the window leads, newest first and a merged PR among it; a message or a file never leads on a change alone', () => {
        expect(idsOf(SCENE, ObservatoryNodeList.orderOf(SCENE, 'changed', RELATIONS, NOW)))
            .toEqual(['merged-pr', 'moved-issue', 'message', 'file', 'old-discussion', 'route-seed', 'no-time']);
    });

    test('a read without activity times keeps the scene\'s order, the route\'s seeds first', () => {
        const scene = {nodes: SCENE.nodes.map(node => ({...node, lastActivityAt: null}))};

        expect(ObservatoryNodeList.orderOf(scene, 'changed', RELATIONS, NOW)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    test('by relations the most related lead, ties in the scene\'s order', () => {
        expect(idsOf(SCENE, ObservatoryNodeList.orderOf(SCENE, 'relations', RELATIONS, NOW)))
            .toEqual(['old-discussion', 'no-time', 'merged-pr', 'message', 'file', 'route-seed', 'moved-issue']);
    });

    test('the head\'s chrome line says how much of the read the list holds, the line beneath it what leads', () => {
        const head = ObservatoryNodesHeadContainer;

        expect([head.titleOf({listed: 7, total: 7}), head.captionOf('changed', {listed: 7, total: 7})])
            .toEqual(['Nodes', 'changed in the last 3 days first · then by activity']);
        expect([head.titleOf({listed: 150, total: 1981}), head.captionOf('relations', {listed: 150, total: 1981})])
            .toEqual(['Nodes · 150 of 1,981', 'by relations · most related first · relations reach the rest']);
    });

    test('filtering by label/id substring and by kind narrows the scene projection, intersects both, preserves reading order, and equals today\'s result when empty (#958 AC-2, AC-5)', () => {
        const
            labeledScene = {nodes: [
                {id: 'neomjs/neo#issue-101',                                     label: 'Sunset protocol handover',        kind: 'ISSUE',           state: 'OPEN',   lastActivityAt: NOW - 10 * DAY},
                {id: 'neomjs/neo#discussion-202',                                label: 'Observatory zoom ladder',         kind: 'DISCUSSION',      state: 'OPEN',   lastActivityAt: NOW - 5 * DAY},
                {id: 'neomjs/neo#pr-303',                                        label: 'Sunset rotation card line',       kind: 'PULL_REQUEST',    state: 'MERGED', lastActivityAt: NOW - 2 * HOUR},
                {id: 'neomjs/neo#summary_96e284fc-e256-4ab7-9745-0eadea5b1a5c',  label: 'Nightshift sunset walkthrough',   kind: 'SESSION_SUMMARY',                  lastActivityAt: NOW - 4 * DAY},
                {id: 'neomjs/neo#issue-404',                                     label: 'Store canonical key',             kind: 'ISSUE',           state: 'OPEN',   lastActivityAt: NOW - 3 * HOUR}
            ]},
            rels = [1, 5, 2, 4, 0],
            head = ObservatoryNodesHeadContainer;

        // Empty filter equals today's exact orderOf result
        const emptyChanged = ObservatoryNodeList.projectOf(labeledScene, 'changed', rels, null, 500, NOW);
        expect(emptyChanged.indices).toEqual(ObservatoryNodeList.orderOf(labeledScene, 'changed', rels, NOW));
        expect([emptyChanged.matched, emptyChanged.total]).toEqual([5, 5]);

        // Label substring narrows case-insensitively and preserves both orders ('changed' and 'relations')
        const byQueryChanged = ObservatoryNodeList.projectOf(labeledScene, 'changed', rels, {query: 'SUNSET'}, 500, NOW);
        expect(idsOf(labeledScene, byQueryChanged.indices)).toEqual([
            'neomjs/neo#pr-303',
            'neomjs/neo#summary_96e284fc-e256-4ab7-9745-0eadea5b1a5c',
            'neomjs/neo#issue-101'
        ]);
        expect([byQueryChanged.matched, byQueryChanged.total]).toEqual([3, 5]);

        const byQueryRelations = ObservatoryNodeList.projectOf(labeledScene, 'relations', rels, {query: 'sunset'}, 500, NOW);
        expect(idsOf(labeledScene, byQueryRelations.indices)).toEqual([
            'neomjs/neo#summary_96e284fc-e256-4ab7-9745-0eadea5b1a5c',
            'neomjs/neo#pr-303',
            'neomjs/neo#issue-101'
        ]);

        // Matching by node id works as well (e.g. session uuid prefix)
        const byId = ObservatoryNodeList.projectOf(labeledScene, 'changed', rels, {query: '96e284fc'}, 500, NOW);
        expect(idsOf(labeledScene, byId.indices)).toEqual(['neomjs/neo#summary_96e284fc-e256-4ab7-9745-0eadea5b1a5c']);

        // Kind filter alone narrows to that kind in reading order
        const byKind = ObservatoryNodeList.projectOf(labeledScene, 'changed', rels, {kind: 'ISSUE'}, 500, NOW);
        expect(idsOf(labeledScene, byKind.indices)).toEqual(['neomjs/neo#issue-404', 'neomjs/neo#issue-101']);

        // Substring + kind intersect, and budget cuts after ordering while preserving matched count
        const intersected = ObservatoryNodeList.projectOf(labeledScene, 'changed', rels, {query: 'sunset', kind: 'ISSUE'}, 500, NOW);
        expect(idsOf(labeledScene, intersected.indices)).toEqual(['neomjs/neo#issue-101']);
        expect([intersected.matched, intersected.total]).toEqual([1, 5]);

        const budgeted = ObservatoryNodeList.projectOf(labeledScene, 'changed', rels, {query: 'sunset'}, 2, NOW);
        expect([budgeted.indices.length, budgeted.matched, budgeted.total]).toEqual([2, 3, 5]);

        // AC-5 + Clio Condition 3: one count in the head; detail line names the match, adds 'first N listed' only over budget, and names no-match
        expect([
            head.titleOf({listed: 3, matched: 3, total: 60}, {query: 'sunset'}),
            head.captionOf('changed', {listed: 3, matched: 3, total: 60}, {query: 'sunset'})
        ]).toEqual(['Nodes · 3 of 60', 'matching “sunset”']);

        expect([
            head.titleOf({listed: 500, matched: 820, total: 141255}, {query: 'sunset', kind: 'SESSION_SUMMARY'}),
            head.captionOf('changed', {listed: 500, matched: 820, total: 141255}, {query: 'sunset', kind: 'SESSION_SUMMARY'})
        ]).toEqual(['Nodes · 820 of 141,255', 'matching “sunset” · kind SESSION_SUMMARY · first 500 listed']);

        expect([
            head.titleOf({listed: 0, matched: 0, total: 60}, {query: 'zebra'}),
            head.captionOf('changed', {listed: 0, matched: 0, total: 60}, {query: 'zebra'})
        ]).toEqual(['Nodes · 0 of 60', 'No nodes match “zebra”']);

        expect(ObservatoryNodeList.kindsOf(labeledScene)).toEqual(['DISCUSSION', 'ISSUE', 'PULL_REQUEST', 'SESSION_SUMMARY']);
    });

    test('filtering a 150,000-node scene answers inside a 100 ms budget (#958 AC-3)', () => {
        const
            total     = 150_000,
            kinds     = ['ISSUE', 'PULL_REQUEST', 'FILE', 'CONCEPT', 'MESSAGE', 'DISCUSSION'],
            nodes     = new Array(total),
            relations = new Uint32Array(total);

        for (let i = 0; i < total; i++) {
            nodes[i] = {
                id            : i === 142_321
                    ? 'neomjs/neo#summary_96e284fc-e256-4ab7-9745-0eadea5b1a5c'
                    : `neomjs/neo#node-${i}`,
                label         : i === 142_321
                    ? 'Session sunset handover walkthrough'
                    : i % 500 === 0 ? `Sunset note ${i}` : `Graph item ${i}`,
                kind          : i === 142_321 ? 'SESSION_SUMMARY' : kinds[i % kinds.length],
                state         : 'OPEN',
                lastActivityAt: NOW - (i % 10) * DAY
            };
            relations[i] = i % 17;
        }

        const
            largeScene = {nodes},
            t0         = performance.now(),
            byText     = ObservatoryNodeList.projectOf(largeScene, 'changed', relations, {query: 'sunset'}, 500, NOW),
            elapsedMs  = performance.now() - t0;

        expect(byText.matched).toBe(301);
        expect(byText.indices.length).toBe(301);
        expect(byText.indices).toContain(142_321);
        expect(elapsedMs, `150k-node filter completed in ${elapsedMs.toFixed(2)}ms (budget < 100ms)`).toBeLessThan(100);
    });
});
