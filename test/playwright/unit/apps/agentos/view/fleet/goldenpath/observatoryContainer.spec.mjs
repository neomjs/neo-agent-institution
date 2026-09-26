import {setup} from '../../../../../../setup.mjs';

const appName = 'ObservatoryPaneTest';

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

import {expect, test}     from '@playwright/test';
import Neo                from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core          from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import InstanceManager    from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import GraphSceneEnvelope from '../../../../../../../../apps/agentos/util/GraphSceneEnvelope.mjs';
import ObservatoryPane    from '../../../../../../../../apps/agentos/view/fleet/goldenpath/ObservatoryContainer.mjs';

const q = id => `neomjs/neo#${id}`;

/**
 * @summary A `fleetGraphScene` read landed the way the Viewport leaf holds it: three seeds, a shared agent,
 * a concept two hops out, one node no seed reaches; one relation left untyped by the feed.
 * @param {Object} [scene] Fields replacing the fixture scene's
 * @param {Object} [envelope] Fields replacing the fixture envelope's
 * @returns {Object}
 */
function graphRead(scene = {}, envelope = {}) {
    return GraphSceneEnvelope.fromWire({
        capability: {state: 'current', reason: null},
        scene     : {
            route: [q('pr-101'), q('issue-202'), q('issue-303')],
            nodes: [
                {id: q('agent-grace'),  label: 'Grace',             kind: 'agent'},
                {id: q('concept-dock'), label: 'Dock',              kind: 'concept'},
                {id: q('issue-202'),    label: 'second route item', kind: 'issue'},
                {id: q('issue-303'),    label: 'third route item',  kind: 'issue'},
                {id: q('issue-404'),    label: 'two hops out',      kind: 'issue'},
                {id: q('issue-505'),    label: 'no seed reaches',   kind: 'issue'},
                {id: q('pr-101'),       label: 'first route item',  kind: 'pull'}
            ],
            edges: [
                {from: q('agent-grace'),  to: q('issue-202'), type: 'authored'},
                {from: q('agent-grace'),  to: q('pr-101'),    type: 'authored'},
                {from: q('concept-dock'), to: q('issue-404')},
                {from: q('pr-101'),       to: q('concept-dock'), type: 'mentions'}
            ],
            counts      : {nodes: 7, edges: 4, seeds: 3},
            budget      : {maxNodes: 150, maxEdges: 300, maxBytes: 32768},
            completeness: 'complete',
            ...scene
        },
        snapshotId: 'snap-7f3a',
        capturedAt: '2026-09-26T20:00:00.000Z',
        ...envelope
    })
}

const
    createPane = (config = {}) => Neo.create(ObservatoryPane, {appName, ...config}),
    lineOf     = pane => pane.getReference('observatory-head').vdom.cn[1].text,
    stripOf    = pane => pane.getReference('observatory-selection');

test.describe('AgentOS.view.fleet.goldenpath.ObservatoryContainer — one canonical selection over the bounded read', () => {
    test('a cold pane reads unobserved, selects nothing and mounts no canvas without a canvas worker', () => {
        const pane = createPane();

        expect(lineOf(pane)).toBe('Unobserved');
        expect(stripOf(pane).text).toBe('No node selected');
        expect(stripOf(pane).cls).toEqual(expect.arrayContaining(['is-empty', 'is-hint']));
        expect(pane.getReference('observatory-canvas')).toBeFalsy();

        InstanceManager.get(pane.id) && pane.destroy()
    });

    test('a read lands as its line and its scene; a selected node is named with its kind, qualified id, rank and typed relations', () => {
        const pane = createPane({envelope: graphRead()});

        expect(lineOf(pane)).toMatch(/^Current · captured .+ · 7 nodes · 4 edges · complete$/);
        expect(pane.scene.nodes.map(node => node.id).slice(0, 3)).toEqual([q('pr-101'), q('issue-202'), q('issue-303')]);

        pane.onNodeSelect({node: {id: q('pr-101')}});

        expect(pane.selectedId).toBe(q('pr-101'));
        expect(stripOf(pane).text).toBe('Selected · first route item · pull · neomjs/neo#pr-101 · rank 1 · 2 relations (1 authored, 1 mentions)');
        expect(stripOf(pane).cls).not.toContain('is-empty');

        pane.onNodeSelect({node: {id: q('issue-404')}});
        expect(stripOf(pane).text, 'an untyped relation is unspecified, never a fabricated label').toBe('Selected · two hops out · issue · neomjs/neo#issue-404 · 1 relation (1 unspecified)');

        pane.onNodeSelect({node: {id: q('issue-505')}});
        expect(stripOf(pane).text).toBe('Selected · no seed reaches · issue · neomjs/neo#issue-505 · no relations in this read');

        pane.onNodeSelect({node: null});
        expect(pane.selectedId, 'a click on the empty surface clears').toBeNull();
        expect(stripOf(pane).text).toBe('No node selected');

        pane.destroy()
    });

    test('the selection survives a shuffled read of the same snapshot and a refreshed read that still holds the id', () => {
        const pane = createPane({envelope: graphRead()});

        pane.onNodeSelect({node: {id: q('issue-202')}});

        const named = stripOf(pane).text;

        pane.envelope = graphRead({nodes: [...graphRead().scene.nodes].reverse(), edges: [...graphRead().scene.edges].reverse()});
        expect(pane.selectedId).toBe(q('issue-202'));
        expect(stripOf(pane).text).toBe(named);

        pane.envelope = graphRead({completeness: 'truncated'}, {snapshotId: 'snap-8b21'});
        expect(pane.selectedId, 'a new snapshot that still holds the id keeps it').toBe(q('issue-202'));
        expect(lineOf(pane)).toMatch(/ · partial, budget 150 nodes \/ 300 edges \/ 32 KiB$/);

        pane.destroy()
    });

    test('a read that lost the selected id clears the selection and says why, until the next selection', () => {
        const pane = createPane({envelope: graphRead()});

        pane.onNodeSelect({node: {id: q('issue-505')}});

        const scene = graphRead().scene;

        pane.envelope = graphRead({nodes: scene.nodes.filter(node => node.id !== q('issue-505'))}, {snapshotId: 'snap-9c40'});

        expect(pane.selectedId).toBeNull();
        expect(stripOf(pane).text).toBe('Selection cleared · neomjs/neo#issue-505 is not in snapshot snap-9c40');
        expect(stripOf(pane).cls).toContain('is-empty');
        expect(stripOf(pane).cls, 'the note names an id and keeps its case').not.toContain('is-hint');

        pane.onNodeSelect({node: {id: q('pr-101')}});
        pane.envelope = GraphSceneEnvelope.fromWire({capability: {state: 'unavailable', reason: 'route-read-failed'}});

        expect(lineOf(pane)).toBe('Unavailable · route-read-failed');
        expect(pane.scene.empty).toBe(true);
        expect(stripOf(pane).text, 'a read without a snapshot names none').toBe('Selection cleared · neomjs/neo#pr-101 is not in this read');

        pane.onNodeSelect({node: null});
        expect(stripOf(pane).text, 'a click retires the note').toBe('No node selected');

        pane.destroy()
    });
});
