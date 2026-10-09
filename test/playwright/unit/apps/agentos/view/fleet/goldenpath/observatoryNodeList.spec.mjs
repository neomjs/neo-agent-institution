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

import {expect, test}      from '@playwright/test';
import Neo                 from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core           from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import ObservatoryNodeList from '../../../../../../../../apps/agentos/view/fleet/goldenpath/ObservatoryNodeList.mjs';

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

    test('the title names the order, and how much of the read the list holds', () => {
        expect(ObservatoryNodeList.titleOf({by: 'changed', listed: 7, total: 7})).toBe('Nodes · changed in the last 3 days first · then by activity');
        expect(ObservatoryNodeList.titleOf({by: 'relations', listed: 150, total: 1981})).toBe('Nodes · by relations · 150 of 1,981 · relations reach the rest');
    });
});
