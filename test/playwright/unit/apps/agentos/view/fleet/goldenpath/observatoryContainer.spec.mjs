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
import GoldenPathEnvelope from '../../../../../../../../apps/agentos/util/GoldenPathEnvelope.mjs';
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
    createPane     = (config = {}) => Neo.create(ObservatoryPane, {appName, ...config}),
    // the read's complete words, which the head keeps behind Details
    lineOf         = pane => pane.getReference('observatory-head').details,
    selectedOf     = pane => pane.getReference('observatory-selected'),
    // the selected node's label and kind as the section heads them, `null` for a part it leaves out
    headOf         = pane => selectedOf(pane).getReference('selected-head').vdom.cn.map(({removeDom, text}) => removeDom ? null : text),
    labelClsOf     = pane => selectedOf(pane).getReference('selected-head').vdom.cn[0].cls,
    factsOf        = pane => selectedOf(pane).getReference('selected-facts').text,
    relationsTitle = pane => pane.getReference('observatory-relations-title').text,
    rowsOf         = pane => pane.relationStore.items.filter(record => !record.isHeader),
    headersOf      = pane => pane.relationStore.items.filter(record => record.isHeader).map(({count, direction, type}) => [type, direction, count]);

test.describe('AgentOS.view.fleet.goldenpath.ObservatoryContainer — one canonical selection over the bounded read', () => {
    test('the head counts the edges the layout drew and names the read\'s others: an end the read lacks, an index pair, a repeat', () => {
        const pane = createPane();

        pane.envelope = graphRead();
        // the two nodes without an edge sit in the halo, drawn and counted
        expect(lineOf(pane), 'a read drawn whole').toMatch(/ · 7 nodes · 4 edges · 2 in the halo · complete$/);

        pane.envelope = graphRead({edges: [
            ...graphRead().scene.edges,
            {from: q('agent-grace'), to: q('issue-999'), type: 'authored'},
            {from: 0, to: 2},
            {from: q('agent-grace'), to: q('pr-101'), type: 'authored'}
        ]});
        expect(pane.scene.edges).toHaveLength(4);
        expect(lineOf(pane)).toMatch(/ · 7 nodes · 4 edges · 2 in the halo · 3 edges not drawn · complete$/);

        pane.destroy()
    });

    test('a cold pane reads unobserved, selects nothing and mounts no canvas without a canvas worker', () => {
        const pane = createPane();

        expect(lineOf(pane)).toBe('Unobserved');
        expect(pane.items.map(item => item.reference), 'the head and the body, no strip').toEqual(['observatory-head', 'observatory-body']);
        expect(pane.getReference('observatory-side').items.map(item => item.reference), 'the view, the team, the nodes, then the selected node')
            .toEqual(['observatory-view-section', 'observatory-team', 'observatory-nodes-head', 'observatory-nodes', 'observatory-selected']);
        expect(headOf(pane)).toEqual(['No node selected', null]);
        expect(labelClsOf(pane)).toContain('is-hint');
        expect(selectedOf(pane).getReference('selected-actions').hidden, 'no node, no action').toBe(true);
        expect(pane.getReference('observatory-canvas')).toBeFalsy();

        InstanceManager.get(pane.id) && pane.destroy()
    });

    test('a read lands as its line and its scene; a selected node reads its label and kind first, what the scene carries about it, and its relations counted by group', () => {
        const pane = createPane({envelope: graphRead()}), selected = selectedOf(pane);

        expect(lineOf(pane)).toMatch(/^Current · captured .+ · 7 nodes · 4 edges · 2 in the halo · complete$/);
        expect(pane.scene.nodes.map(node => node.id).slice(0, 3)).toEqual([q('pr-101'), q('issue-202'), q('issue-303')]);

        pane.onNodeSelect({node: {id: q('pr-101')}});

        expect(pane.selectedId).toBe(q('pr-101'));
        expect(headOf(pane)).toEqual(['first route item', 'pull']);
        expect(factsOf(pane), 'a read without state, attribution or time claims none').toBe('Golden Path rank 1');
        expect(selected.getReference('selected-id').vdom.value, 'the id sits in the field the Copy action copies').toBe(q('pr-101'));
        expect(headOf(pane), 'and never in the head').not.toContain(q('pr-101'));
        expect(relationsTitle(pane)).toBe('Relations · 2');
        expect(headersOf(pane)).toEqual([['authored', 'in', 1], ['mentions', 'out', 1]]);

        pane.onNodeSelect({node: {id: q('issue-404')}});
        expect(headersOf(pane)).toEqual([[null, 'in', 1]]);
        expect(pane.getReference('observatory-relations').createItemContent(pane.relationStore.getAt(0))[0].text, 'an untyped relation is unspecified, never a fabricated label').toBe('unspecified');

        pane.onNodeSelect({node: {id: q('issue-505')}});
        expect([factsOf(pane), relationsTitle(pane)]).toEqual(['the read carries nothing more about this node', 'Relations · none in this read']);

        pane.onNodeSelect({node: null});
        expect(pane.selectedId, 'a click on the empty surface clears').toBeNull();
        expect(headOf(pane)).toEqual(['No node selected', null]);

        pane.destroy()
    });

    test('the selection survives a shuffled read of the same snapshot and a refreshed read that still holds the id', () => {
        const pane = createPane({envelope: graphRead()});

        pane.onNodeSelect({node: {id: q('issue-202')}});

        const named = selectedOf(pane).facts;

        pane.envelope = graphRead({nodes: [...graphRead().scene.nodes].reverse(), edges: [...graphRead().scene.edges].reverse()});
        expect(pane.selectedId).toBe(q('issue-202'));
        expect(selectedOf(pane).facts).toEqual(named);

        pane.envelope = graphRead({completeness: 'truncated'}, {snapshotId: 'snap-8b21'});
        expect(pane.selectedId, 'a new snapshot that still holds the id keeps it').toBe(q('issue-202'));
        expect(lineOf(pane)).toMatch(/ · partial, budget 150 nodes \/ 300 edges \/ 32 KiB$/);

        pane.destroy()
    });

    test('the node list holds every node of the read in the layout\'s order with its relation count; without a canvas the lists are the whole body', () => {
        const pane = createPane({envelope: graphRead()});

        expect(pane.nodeStore.items.map(({hop, id, rank, relations}) => [id.replace('neomjs/neo#', ''), hop, rank, relations])).toEqual([
            ['pr-101',       0,    1,    2],
            ['issue-202',    0,    2,    1],
            ['issue-303',    0,    3,    0],
            ['agent-grace',  1,    null, 2],
            ['concept-dock', 1,    null, 2],
            ['issue-404',    2,    null, 1],
            ['issue-505',    null, null, 0]
        ]);
        expect(pane.getReference('observatory-side').flex).toBe(1);
        expect(pane.getReference('observatory-nodes').store).toBe(pane.nodeStore);

        pane.destroy()
    });

    test('a node row selects its node and lists its relations seen from it, grouped; a relation row moves the selection to its other end, a header nowhere', () => {
        const
            pane      = createPane({envelope: graphRead()}),
            relations = () => rowsOf(pane).map(({direction, otherId, otherLabel, type}) => [type, direction, otherId.replace('neomjs/neo#', ''), otherLabel]),
            row       = id => rowsOf(pane).find(record => record.otherId === q(id));

        pane.onNodeListSelect({records: [pane.nodeStore.get(q('pr-101'))]});

        expect(pane.selectedId).toBe(q('pr-101'));
        expect(relations(), 'by type, then direction, whatever the feed\'s order').toEqual([
            ['authored', 'in',  'agent-grace',  'Grace'],
            ['mentions', 'out', 'concept-dock', 'Dock']
        ]);

        pane.onRelationListSelect({records: [pane.relationStore.getAt(0)]});
        expect(pane.selectedId, 'a header moves nothing').toBe(q('pr-101'));

        pane.onRelationListSelect({records: [row('concept-dock')]});

        expect(pane.selectedId).toBe(q('concept-dock'));
        expect(relations(), 'an untyped relation keeps its absent type, and its group comes last').toEqual([
            ['mentions', 'in',  'pr-101',    'first route item'],
            [null,       'out', 'issue-404', 'two hops out']
        ]);

        pane.onNodeSelect({node: null});
        expect(pane.relationStore.getCount(), 'no selection, no relations').toBe(0);

        pane.destroy()
    });

    test('the lists keep to the budget: the route\'s seeds lead, the selection is always listed, and the titles say how many of how many', () => {
        const
            pane  = createPane(),
            ids   = () => pane.nodeStore.items.map(({id}) => id.replace('neomjs/neo#', '')),
            title = reference => pane.getReference(reference).text;

        pane.listBudget = 1;
        pane.envelope   = graphRead();

        expect(ids()).toEqual(['pr-101']);
        expect([title('observatory-nodes-title'), title('observatory-nodes-caption')]).toEqual(['Nodes · 1 of 7', 'changed in the last 3 days first · then by activity · relations reach the rest']);

        pane.onNodeSelect({node: {id: q('pr-101')}});
        expect(rowsOf(pane)).toHaveLength(1);
        expect(relationsTitle(pane)).toBe('Relations · 2 · the first 1 listed');

        // a relation reaches a node beyond the budget: it joins the list, selected
        pane.onRelationListSelect({records: [rowsOf(pane)[0]]});
        const list = pane.getReference('observatory-nodes');

        expect(ids()).toEqual(['pr-101', 'concept-dock']);
        expect(list.selectionModel.items).toEqual([list.getItemId(pane.nodeStore.get(q('concept-dock')))]);

        // further selections beyond the budget take that one extra row, never another
        pane.onNodeSelect({node: {id: q('issue-404')}});
        expect(ids()).toEqual(['pr-101', 'issue-404']);
        pane.onNodeSelect({node: {id: q('agent-grace')}});
        expect(ids()).toEqual(['pr-101', 'agent-grace']);
        expect(list.selectionModel.items).toEqual([list.getItemId(pane.nodeStore.get(q('agent-grace')))]);

        // a listed selection needs no extra row
        pane.onNodeSelect({node: {id: q('pr-101')}});
        expect(ids()).toEqual(['pr-101']);

        pane.listBudget = 500;
        pane.envelope   = graphRead({completeness: 'truncated'}, {snapshotId: 'snap-8b21'});
        expect(ids()).toHaveLength(7);
        expect([title('observatory-nodes-title'), title('observatory-nodes-caption')]).toEqual(['Nodes', 'changed in the last 3 days first · then by activity']);
        expect(relationsTitle(pane)).toBe('Relations · 2');

        pane.destroy()
    });

    test('the Nodes list orders the whole read before the budget cuts it, and its toggle reads by relations and back, keeping the selection listed', () => {
        const
            pane   = createPane(),
            toggle = pane.getReference('observatory-nodes-order'),
            ids    = () => pane.nodeStore.items.map(({id}) => id.replace('neomjs/neo#', '')),
            state  = () => [pane.getReference('observatory-nodes-title').text, pane.getReference('observatory-nodes-caption').text, toggle.pressed, toggle.vdom['aria-pressed']];

        // the ripple measures the rendered button, which the unit harness has none of
        toggle.useRippleEffect = false;

        pane.listBudget = 2;
        pane.envelope   = teamRead();

        expect(ids(), 'the newest change leads, though the layout places it sixth').toEqual(['issue-404', 'pr-101']);
        expect(state()).toEqual(['Nodes · 2 of 7', 'changed in the last 3 days first · then by activity · relations reach the rest', false, 'false']);

        toggle.onClick({});
        expect(ids()).toEqual(['pr-101', 'agent-grace']);
        expect(state()).toEqual(['Nodes · 2 of 7', 'by relations · most related first · relations reach the rest', true, 'true']);

        pane.onNodeSelect({node: {id: q('issue-404')}});
        expect(ids(), 'a selection the order leaves out takes the one extra row').toEqual(['pr-101', 'agent-grace', 'issue-404']);

        toggle.onClick({});
        expect(ids(), 'back to what changed, which lists the selection itself').toEqual(['issue-404', 'pr-101']);
        expect(pane.selectedId).toBe(q('issue-404'));
        expect(state()[2]).toBe(false);

        pane.destroy()
    });

    test('the route toggle draws or drops the route: the overlay flips, and the toggle reads pressed for the eye and for assistive technology', () => {
        const
            pane   = createPane({envelope: graphRead()}),
            toggle = pane.getReference('route-toggle'),
            state  = () => [pane.routeOverlay, toggle.pressed, toggle.vdom['aria-pressed']];

        // the ripple measures the rendered button, which the unit harness has none of
        toggle.useRippleEffect = false;

        expect(state()).toEqual([true, true, 'true']);

        toggle.onClick({});
        expect(state()).toEqual([false, false, 'false']);

        toggle.onClick({});
        expect(state()).toEqual([true, true, 'true']);

        pane.destroy()
    });

    test('mail stays out and the nodes in no well sit in the halo by default; the Mail and Halo toggles bring mail in and the halo out, and the line says what the view hid', () => {
        const
            pane    = createPane({envelope: graphRead({
                nodes: [...graphRead().scene.nodes, {id: q('message-1'), label: 'a message', kind: 'MESSAGE'}],
                edges: [...graphRead().scene.edges, {from: q('message-1'), to: q('concept-dock'), type: 'TAGGED_CONCEPT'}]
            })}),
            mail    = pane.getReference('mail-toggle'),
            halo    = pane.getReference('halo-toggle'),
            pressed = toggle => [toggle.pressed, toggle.vdom['aria-pressed']];

        mail.useRippleEffect = halo.useRippleEffect = false;

        expect(pane.geography, 'strategic wells by default').toBe('strategic');
        expect(pane.scene.geography, 'a read without an anchor draws density wells').toBe('density');
        expect([pressed(mail), pressed(halo)]).toEqual([[false, 'false'], [true, 'true']]);
        expect(lineOf(pane)).toMatch(/ · 7 nodes · 4 edges · 1 mail node hidden · 2 in the halo · complete$/);
        expect(Object.hasOwn(pane.scene.index, q('message-1'))).toBe(false);

        mail.onClick({});
        expect(pressed(mail)).toEqual([true, 'true']);
        expect(lineOf(pane), 'mail drawn: the message joins the well of the concept it names').toMatch(/ · 8 nodes · 5 edges · 2 in the halo · complete$/);

        mail.onClick({});
        pane.onNodeSelect({node: {id: q('issue-505')}});

        halo.onClick({});
        expect(pressed(halo)).toEqual([false, 'false']);
        expect(lineOf(pane), 'the halo hides its dust, never the route: seed issue-303 stays on the shell').toMatch(/ · 6 nodes · 4 edges · 1 mail node hidden · 1 in the halo · 1 halo node hidden · complete$/);
        expect(pane.selectedId, 'a node the view hides cannot stay selected').toBeNull();
        expect(headOf(pane)).toEqual([`Selection cleared · ${q('issue-505')} is hidden in this view`, null]);

        pane.destroy()
    });

    test('a geography switch lays the same read out again and keeps the selection with its node; an unknown geography changes nothing', () => {
        const pane = createPane({envelope: graphRead()});

        pane.onNodeSelect({node: {id: q('issue-404')}});

        const before = pane.scene.nodes.find(node => node.id === q('issue-404'));

        pane.geography = 'communities';
        expect(pane.scene.geography).toBe('communities');
        expect(pane.selectedId).toBe(q('issue-404'));
        expect(headOf(pane)).toEqual(['two hops out', 'issue']);
        expect(pane.scene.nodes.find(node => node.id === q('issue-404')), 'the node moved with its geography').not.toEqual(before);

        const errors = [], error = console.error;

        console.error = (...args) => errors.push(args[0]);
        pane.geography = 'constellations';
        console.error = error;

        expect(pane.geography).toBe('communities');
        expect(errors, 'the refusal is named').toEqual(['Supported values for geography are:']);

        pane.destroy()
    });

    test('a withheld Golden Path route is named beside the graph read\'s own words, and its control reads withheld without a hover', () => {
        const
            pane     = createPane({envelope: graphRead()}),
            control  = pane.getReference('route-toggle'),
            state    = () => [control.text, control.disabled, control.pressed],
            withheld = GoldenPathEnvelope.fromWire({
                capability: {state: 'wired', capturedAt: '2026-09-26T20:00:00.000Z'},
                admission : {admitted: false, fallback: 'last-known-good', reasonCode: 'freshness-sla-breached', requiredFacets: [], staleFacets: []},
                route     : {status: 'fresh', kind: 'computed-ranked', items: []}
            });

        pane.routeEnvelope = withheld;
        expect(lineOf(pane)).toMatch(/^Current · captured .+ · 7 nodes · 4 edges · 2 in the halo · complete · route withheld · freshness-sla-breached$/);
        expect(state(), 'the route the graph read carries still draws, and the control still drops it').toEqual(['Route · withheld', false, true]);
        expect(control.tooltip.text, 'the reason sits in the detail').toMatch(/\(freshness-sla-breached\)/);

        pane.routeEnvelope = GoldenPathEnvelope.fromWire({...withheld, admission: {...withheld.admission, admitted: true, fallback: 'current', reasonCode: 'current'}});
        expect(lineOf(pane)).toMatch(/ · complete$/);
        expect(state()).toEqual(['Route', false, true]);

        pane.destroy()
    });

    test('a read that lost the selected id clears the selection and says why, until the next selection', () => {
        const pane = createPane({envelope: graphRead()});

        pane.onNodeSelect({node: {id: q('issue-505')}});

        const scene = graphRead().scene;

        pane.envelope = graphRead({nodes: scene.nodes.filter(node => node.id !== q('issue-505'))}, {snapshotId: 'snap-9c40'});

        expect(pane.selectedId).toBeNull();
        expect(headOf(pane)[0]).toBe('Selection cleared · neomjs/neo#issue-505 is not in snapshot snap-9c40');
        expect(['selected-facts', 'selected-actions', 'selected-id', 'observatory-relations-title'].map(reference => selectedOf(pane).getReference(reference).vdom.removeDom), 'only the head speaks')
            .toEqual([true, true, true, true]);
        expect(labelClsOf(pane)).toContain('is-empty');
        expect(labelClsOf(pane), 'the note names an id and keeps its case').not.toContain('is-hint');

        pane.onNodeSelect({node: {id: q('pr-101')}});
        pane.envelope = GraphSceneEnvelope.fromWire({capability: {state: 'unavailable', reason: 'route-read-failed'}});

        expect(lineOf(pane)).toBe('Unavailable · route-read-failed');
        expect(pane.scene.empty).toBe(true);
        expect(headOf(pane)[0], 'a read without a snapshot names none').toBe('Selection cleared · neomjs/neo#pr-101 is not in this read');

        pane.onNodeSelect({node: null});
        expect(headOf(pane)[0], 'a click retires the note').toBe('No node selected');

        pane.destroy()
    });

    test('a pick that answers after its read was replaced cannot select an id the current read does not hold', () => {
        const pane  = createPane({envelope: graphRead()}),
              scene = graphRead().scene;

        pane.onNodeSelect({node: {id: q('issue-505')}});
        pane.envelope = graphRead({nodes: scene.nodes.filter(node => node.id !== q('issue-505'))}, {snapshotId: 'snap-9c40'});

        // the canvas's pick for the old read resolves only now
        pane.onNodeSelect({node: {id: q('issue-505')}});

        expect(pane.selectedId).toBeNull();
        expect(headOf(pane)[0], 'the clearing reason stays').toBe('Selection cleared · neomjs/neo#issue-505 is not in snapshot snap-9c40');

        pane.onNodeSelect({node: {id: q('pr-101')}});
        expect(pane.selectedId, 'an id the read holds still selects').toBe(q('pr-101'));

        pane.destroy()
    });

    test('a retired read (another instance\'s) clears the selection without claiming the id left a read', () => {
        const pane = createPane({envelope: graphRead()});

        pane.onNodeSelect({node: {id: q('pr-101')}});
        pane.envelope = GraphSceneEnvelope.blank();

        expect(lineOf(pane)).toBe('Unobserved');
        expect(pane.selectedId).toBeNull();
        expect(headOf(pane)).toEqual(['No node selected', null]);

        pane.destroy()
    });

    test('the View section names each control by its question and presses the wells drawn; the geography control switches them and keeps the selection', () => {
        const
            pane      = createPane({envelope: graphRead()}),
            control   = reference => pane.getReference(reference),
            pressed   = () => ['geography-strategic', 'geography-density', 'heat-toggle', 'route-toggle', 'mail-toggle', 'halo-toggle'].map(reference => control(reference).pressed),
            texts     = ['geography-strategic', 'geography-density', 'heat-toggle', 'route-toggle', 'mail-toggle', 'halo-toggle'].map(reference => control(reference).text);

        ['geography-density', 'geography-strategic'].forEach(reference => control(reference).useRippleEffect = false);

        // the fixture carries no roadmap anchor, so the pressed Roadmap says it drew hub wells instead
        expect(texts).toEqual(['Roadmap · no anchors', 'Hubs', 'Attention', 'Route', 'Messages', 'Outside wells']);
        expect(control('geography-strategic').tooltip.text).toMatch(/no roadmap anchors/);
        expect(pressed(), 'the strategic wells, the route and the halo, by default').toEqual([true, false, false, true, false, true]);
        expect(control('heat-toggle').tooltip.text, 'the attention window is stated').toMatch(/in the last 3 days/);

        pane.onNodeSelect({node: {id: q('issue-404')}});
        control('geography-density').onClick({});

        expect([pane.geography, pane.scene.geography, pane.selectedId]).toEqual(['density', 'density', q('issue-404')]);
        expect(pressed().slice(0, 2)).toEqual([false, true]);
        expect(control('geography-strategic').text, 'unpressed, Roadmap promises nothing').toBe('Roadmap');

        control('geography-strategic').onClick({});
        expect([pane.geography, pressed().slice(0, 2)]).toEqual(['strategic', [true, false]]);

        pane.envelope = graphRead({nodes: graphRead().scene.nodes.map(node => node.id === q('concept-dock') ? {...node, gravityWell: true, strategicWeight: 1} : node)});
        expect(control('geography-strategic').text, 'a read with an anchor draws roadmap wells, and the control drops the note').toBe('Roadmap');

        pane.destroy()
    });

    test('the head opens with the team\'s sentence, keeps the counts behind Details, and its attention item selects its node', () => {
        const pane = createPane({envelope: teamRead()}), head = pane.getReference('observatory-head');

        expect(head.brief).toMatchObject({attention: {id: q('pr-101'), text: '#101 · first route item', title: 'first route item'}, tail: 'complete'});
        expect(head.brief.lead, 'the open issue without its time and the fresh one without its state are unknown').toMatch(/^captured .+ · last 3 days: 1 in motion · 2 unknown$/);
        expect(head.details, 'the renderer\'s counts wait behind Details').toMatch(/^Current · captured .+ · 7 nodes · 4 edges/);
        expect([head.detailsOpen, head.vdom.cn[4].hidden], 'folded by default').toEqual([false, true]);

        head.onDetailsClick();
        expect([head.detailsOpen, head.vdom.cn[4].hidden, head.vdom.cn[3]['aria-expanded']]).toEqual([true, null, 'true']);

        head.onAttentionClick();
        expect(pane.selectedId, 'the attention item is a way in').toBe(q('pr-101'));

        pane.envelope = GraphSceneEnvelope.fromWire({capability: {state: 'unavailable', reason: 'route-read-failed'}});
        expect([head.brief.lead, head.brief.attention, head.details]).toEqual(['Unavailable · route-read-failed', null, 'Unavailable · route-read-failed']);
        expect(head.vdom.cn[3].removeDom, 'nothing more to disclose, no disclosure').toBe(true);

        pane.destroy()
    });

    test('the head names the view and the geography the scene drew; no surface here calls itself the Golden Path', () => {
        const
            titleOf  = pane => pane.getReference('observatory-head').title,
            anchored = graphRead({nodes: graphRead().scene.nodes.map(node => node.id === q('concept-dock') ? {...node, gravityWell: true, strategicWeight: 1} : node)}),
            cold     = createPane(),
            pane     = createPane({envelope: anchored});

        expect(titleOf(cold), 'nothing drawn, no geography named').toBe('Observatory');
        expect(titleOf(pane)).toBe('Observatory · Roadmap wells');

        pane.geography = 'density';
        expect(titleOf(pane), 'the title follows a switch').toBe('Observatory · Hub wells');

        pane.set({envelope: graphRead(), geography: 'strategic'});
        expect(titleOf(pane), 'a read without an anchor draws hub wells, and the title says so').toBe('Observatory · Hub wells');

        const named = [titleOf(pane), ...['geography-strategic', 'geography-density', 'heat-toggle', 'route-toggle', 'mail-toggle', 'halo-toggle'].map(reference => pane.getReference(reference).text)];

        expect(named.filter(text => text.includes('Golden Path')), 'the Golden Path is the dock pane, never a name here').toEqual([]);

        InstanceManager.get(cold.id) && cold.destroy();
        pane.destroy()
    });

    test('the selected node opens its source: a canonical work item its GitHub page, a session its Memories drill through the shell; any other kind says it has none', () => {
        const
            session = 'neomjs/neo#session:019fe5e8-b963-7e93-8762-c8e4af16bdec',
            pane    = createPane({envelope: teamRead({}, {scene: {
                ...teamRead().scene,
                nodes: [...teamRead().scene.nodes, {id: session, label: 'a session', kind: 'SESSION'}]
            }})}),
            open    = () => pane.getReference('selected-open'),
            opened  = [];

        pane.on('sessionOpen', data => opened.push(data));

        pane.onNodeSelect({node: {id: q('pr-101')}});
        expect(factsOf(pane), 'what the read carries, and nothing it does not').toMatch(/^open, as last ingested · authored by @tobiu · assigned to @neo-opus-vega · last activity .+ · Golden Path rank 1$/);
        expect([open().hidden, open().text, open().url]).toEqual([false, 'Open on GitHub', 'https://github.com/neomjs/neo/pull/101']);

        pane.onNodeSelect({node: {id: session}});
        expect([open().hidden, open().text, open().url]).toEqual([false, 'Open in Memories', null]);

        selectedOf(pane).onOpenClick();
        expect(opened, 'the pane hands the session to the shell').toMatchObject([{sessionId: '019fe5e8-b963-7e93-8762-c8e4af16bdec', title: 'a session'}]);

        pane.onNodeSelect({node: {id: q('concept-dock')}});
        expect([open().hidden, pane.getReference('selected-no-source').hidden, pane.getReference('selected-no-source').text])
            .toEqual([true, false, 'No source view for concept']);

        selectedOf(pane).onOpenClick();
        expect(opened, 'a node without a source opens nothing').toHaveLength(1);

        pane.destroy()
    });
});

/**
 * @summary {@link graphRead} with the Brain's attribution, state and recency: the operator authored the first
 * route item, an open PR Vega is assigned and changed an hour ago; Vega authored the second, open and untouched
 * for thirty days; the operator's third is closed; Eos authored an issue whose state the read omits; the issue no
 * seed reaches has no activity time. The operator and Eos share their own place in the palette.
 * @param {Object} [nodes] Fields replacing a fixture node's, by short id
 * @param {Object} [envelope] Fields replacing the fixture envelope's
 * @param {String[]} [identities] The logins the read holds an identity node for, its team
 * @returns {Object}
 */
function teamRead(nodes = {}, envelope = {}, identities = []) {
    const
        now  = Date.now(),
        hour = 3600000,
        team = {
            'pr-101'   : {kind: 'PULL_REQUEST', authoredBy: '@tobiu',         assignedTo: ['@neo-opus-vega'], state: 'OPEN',   lastActivityAt: now - hour},
            'issue-202': {kind: 'ISSUE',        authoredBy: '@neo-opus-vega', assignedTo: [],                 state: 'OPEN',   lastActivityAt: now - 30 * 24 * hour},
            'issue-303': {kind: 'ISSUE',        authoredBy: '@tobiu',         assignedTo: [],                 state: 'CLOSED', lastActivityAt: now - 2 * hour},
            'issue-404': {kind: 'ISSUE',        authoredBy: '@neo-preview',   assignedTo: [],                                  lastActivityAt: now},
            'issue-505': {kind: 'ISSUE',                                                                      state: 'OPEN'}
        };

    return graphRead({nodes: [
        ...graphRead().scene.nodes.map(node => {
            const id = node.id.replace('neomjs/neo#', '');

            return {...node, ...team[id], ...nodes[id]}
        }),
        ...identities.map(login => ({id: q(login), label: login, kind: 'AgentIdentity'}))
    ]}, envelope)
}

test.describe('AgentOS.view.fleet.goldenpath.ObservatoryContainer — the team lens and the heat over the same places', () => {
    const
        peerList = pane => pane.getReference('observatory-peers'),
        team     = pane => pane.getReference('observatory-team'),
        click    = (pane, id) => peerList(pane).selectionModel.onListClick({currentTarget: peerList(pane).getItemId(team(pane).peerStore.get(id))}),
        checked  = pane => peerList(pane).selectionModel.items.map(itemId => team(pane).peerStore.get(peerList(pane).getItemRecordId(itemId)).id),
        hue      = (pane, id) => team(pane).peerStore.get(id).hue,
        roles    = pane => pane.nodeStore.items.filter(row => row.role).map(({id, role, roleHue}) => [id.replace('neomjs/neo#', ''), role, roleHue]);

    test('the Team list holds the peers the read attributes nodes to; checked, their union draws in hues of their own, each row names what its node is to its peer, the line counts the lens', () => {
        const pane = createPane({envelope: graphRead()}), title = () => pane.getReference('observatory-peers-title').text;

        expect([team(pane).peerStore.getCount(), title()], 'a read without attribution says so').toEqual([0, 'Team · no peer in this read']);

        pane.envelope = teamRead({}, {snapshotId: 'snap-8b21'});
        expect(title(), 'a read without identity nodes cannot name its team').toBe('Team · unknown, all listed');
        expect(team(pane).peerStore.items.map(({id, nodes}) => [id, nodes]), 'busiest first').toEqual([['@neo-opus-vega', 2], ['@tobiu', 2], ['@neo-preview', 1]]);
        expect(hue(pane, '@neo-preview'), 'unchecked, each shows its own place, and these two share one').toBe(hue(pane, '@tobiu'));
        expect([pane.lensPeers, pane.overlays.lens, roles(pane)]).toEqual([[], null, []]);
        expect(lineOf(pane)).not.toMatch(/lens/);

        click(pane, '@neo-opus-vega');
        expect(pane.lensPeers).toEqual(['@neo-opus-vega']);
        expect(roles(pane), 'an assignment untouched for thirty days is history, never current work').toEqual([
            ['pr-101',    'assigned · changed recently', hue(pane, '@neo-opus-vega')],
            ['issue-202', 'authored',                    hue(pane, '@neo-opus-vega')]
        ]);
        expect(lineOf(pane)).toMatch(/ · lens · 2 nodes · 1 peer$/);

        click(pane, '@tobiu');
        click(pane, '@neo-preview');
        expect(pane.lensPeers, 'in check order').toEqual(['@neo-opus-vega', '@tobiu', '@neo-preview']);
        expect(hue(pane, '@neo-preview'), 'checked together, the two take hues of their own').not.toBe(hue(pane, '@tobiu'));
        expect(Array.from(pane.overlays.lens.hues), 'the swatches are the hues the canvas draws').toEqual(pane.lensPeers.map(id => hue(pane, id)));
        expect(roles(pane).find(([id]) => id === 'pr-101'), 'a node two checked peers share is the first-checked one\'s').toEqual(['pr-101', 'assigned · changed recently', hue(pane, '@neo-opus-vega')]);
        expect(lineOf(pane)).toMatch(/ · lens · 4 nodes · 3 peers$/);

        click(pane, '@neo-opus-vega');
        expect(pane.lensPeers, 'a second click unchecks').toEqual(['@tobiu', '@neo-preview']);
        expect(roles(pane).find(([id]) => id === 'pr-101')).toEqual(['pr-101', 'authored · changed recently', hue(pane, '@tobiu')]);

        pane.destroy()
    });

    test('a new read keeps the lens: its peers are checked again without the restore reading as a choice, and a peer it no longer lists keeps its place in the check order', () => {
        const pane = createPane({envelope: teamRead()});

        click(pane, '@neo-preview');
        click(pane, '@tobiu');

        pane.envelope = teamRead({'issue-404': {authoredBy: null}}, {snapshotId: 'snap-8b21'});
        expect(pane.lensPeers, 'Eos left the read, not the lens').toEqual(['@neo-preview', '@tobiu']);
        expect(checked(pane)).toEqual(['@tobiu']);
        expect(lineOf(pane)).toMatch(/ · lens · 2 nodes · 2 peers$/);

        click(pane, '@neo-opus-vega');
        expect(pane.lensPeers, 'the absent peer keeps its place').toEqual(['@neo-preview', '@tobiu', '@neo-opus-vega']);

        pane.envelope = teamRead({}, {snapshotId: 'snap-9c32'});
        expect(checked(pane)).toEqual(['@neo-preview', '@tobiu', '@neo-opus-vega']);
        expect(pane.overlays.lens.lens[pane.scene.index[q('issue-404')]], 'Eos\'s issue is Eos\'s again').toBe(1);
        expect(hue(pane, '@neo-preview'), 'checked first, Eos holds the place the two share').toBe(pane.overlays.lens.hues[0]);
        expect(hue(pane, '@tobiu')).not.toBe(hue(pane, '@neo-preview'));

        pane.destroy()
    });

    test('Team offers the team the read names, busiest first; All offers everyone; a checked outsider stays listed; a read without identity nodes lists everyone and says so', () => {
        const
            outside = {'issue-505': {authoredBy: '@Outsider'}},
            pane    = createPane({envelope: teamRead(outside, {}, ['@neo-opus-vega', '@neo-preview', '@tobiu'])}),
            toggle  = pane.getReference('peer-scope-toggle'),
            title   = () => pane.getReference('observatory-peers-title').text,
            listed  = () => team(pane).peerStore.items.map(({id, nodes}) => [id, nodes]),
            state   = () => [title(), team(pane).peerScope, toggle.pressed, toggle.vdom['aria-pressed'], toggle.disabled];

        // the ripple measures the rendered button, which the unit harness has none of
        toggle.useRippleEffect = false;

        expect(listed(), 'the team, busiest first; the outsider is not offered').toEqual([['@neo-opus-vega', 2], ['@tobiu', 2], ['@neo-preview', 1]]);
        expect(state()).toEqual(['Team · 3 of 4', 'team', false, 'false', false]);

        toggle.onClick({});
        expect(listed(), 'everyone; an upper-case handle no longer leads by code unit').toEqual([['@neo-opus-vega', 2], ['@tobiu', 2], ['@Outsider', 1], ['@neo-preview', 1]]);
        expect(state(), 'the title counts the team either way').toEqual(['Team · 3 of 4', 'all', true, 'true', false]);

        click(pane, '@Outsider');
        toggle.onClick({});
        expect(listed(), 'a checked outsider stays listed, so its check is never hidden').toHaveLength(4);
        expect([checked(pane), pane.lensPeers]).toEqual([['@Outsider'], ['@Outsider']]);

        pane.envelope = teamRead(outside, {snapshotId: 'snap-8b21'});
        expect(listed()).toHaveLength(4);
        expect(state(), 'without identity nodes the team is unknown, and All cannot narrow it').toEqual(['Team · unknown, all listed', 'team', true, 'true', true]);

        pane.destroy()
    });

    test('a read of 161 peers opens Team on the 13 it names; All lists every one, and the team scope returns to the 13', () => {
        const
            logins = Array.from({length: 161}, (_, i) => `@peer-${String(i).padStart(3, '0')}`),
            pane   = createPane({envelope: graphRead({
                route : [],
                nodes : [
                    ...logins.map((login, i) => ({id: q(`issue-${9000 + i}`), label: `issue ${i}`, kind: 'issue', authoredBy: login})),
                    ...logins.slice(0, 13).map(login => ({id: q(login), label: login, kind: 'AgentIdentity'}))
                ],
                edges : [],
                counts: {nodes: 174, edges: 0, seeds: 0},
                budget: {maxNodes: 500, maxEdges: 300, maxBytes: 65536}
            })}),
            toggle = pane.getReference('peer-scope-toggle');

        // the ripple measures the rendered button, which the unit harness has none of
        toggle.useRippleEffect = false;

        expect([pane.openSection, team(pane).peerStore.getCount(), pane.getReference('observatory-peers-title').text]).toEqual(['team', 13, 'Team · 13 of 161']);

        toggle.onClick({});
        expect(team(pane).peerStore.getCount(), 'All lists every peer').toBe(161);

        toggle.onClick({});
        expect(team(pane).peerStore.getCount(), 'the team scope returns to the team').toBe(13);

        pane.destroy()
    });

    test('an outsider Team holds only while it is checked: unchecking it or clearing the lens takes its row out, and a team member\'s check keeps the rows as they are', () => {
        const
            outside = {'issue-505': {authoredBy: '@Outsider'}},
            pane    = createPane({envelope: teamRead(outside, {}, ['@neo-opus-vega', '@neo-preview', '@tobiu'])}),
            toggle  = pane.getReference('peer-scope-toggle'),
            clear   = pane.getReference('lens-clear'),
            ids     = () => team(pane).peerStore.items.map(({id}) => id),
            members = ['@neo-opus-vega', '@tobiu', '@neo-preview'],
            retain  = () => {
                toggle.onClick({});
                click(pane, '@Outsider');
                toggle.onClick({});
                expect(ids(), 'checked, the outsider is listed in Team').toEqual(['@neo-opus-vega', '@tobiu', '@Outsider', '@neo-preview'])
            };

        // the ripple measures the rendered button, which the unit harness has none of
        toggle.useRippleEffect = clear.useRippleEffect = false;

        retain();
        click(pane, '@Outsider');
        expect([pane.lensPeers, ids()], 'unchecked, it leaves').toEqual([[], members]);

        retain();
        clear.onClick({});
        expect([pane.lensPeers, ids()], 'cleared, it leaves').toEqual([[], members]);

        // a member's check changes the colours, never the rows: the list keeps its records, so its focus and scroll
        const rows = team(pane).peerStore.items.slice();

        click(pane, '@tobiu');
        click(pane, '@neo-opus-vega');
        expect(pane.lensPeers, 'in check order').toEqual(['@tobiu', '@neo-opus-vega']);
        expect(team(pane).peerStore.items.every((record, at) => record === rows[at]), 'the same records, no refill').toBe(true);

        pane.destroy()
    });

    test('a focus has a way back: the Team head\'s Clear lifts the lens, the selected node\'s Clear drops the selection, and Escape backs out one step at a time', () => {
        const
            pane     = createPane({envelope: teamRead()}),
            clear    = pane.getReference('lens-clear'),
            unselect = selectedOf(pane).getReference('selected-clear'),
            escape   = () => pane.keys.onKeyDown({key: 'Escape'});

        clear.useRippleEffect = unselect.useRippleEffect = false;

        expect(clear.hidden, 'no lens, nothing to clear').toBe(true);
        click(pane, '@tobiu');
        click(pane, '@neo-opus-vega');
        expect(clear.hidden).toBe(false);

        clear.onClick({});
        expect([pane.lensPeers, pane.overlays.lens, checked(pane), clear.hidden]).toEqual([[], null, [], true]);
        expect(lineOf(pane)).not.toMatch(/lens/);

        pane.selectedId = q('issue-202');
        unselect.onClick({});
        expect([pane.selectedId, headOf(pane)]).toEqual([null, ['No node selected', null]]);

        click(pane, '@tobiu');
        pane.selectedId = q('issue-202');
        escape();
        expect([pane.selectedId, pane.lensPeers], 'the selection first').toEqual([null, ['@tobiu']]);
        escape();
        expect([pane.lensPeers, checked(pane)], 'then the lens').toEqual([[], []]);
        escape();
        expect([pane.selectedId, pane.lensPeers], 'with neither, nothing changes').toEqual([null, []]);

        pane.destroy()
    });

    test('the Heat toggle draws the heat over the same places, and the line states the window and what the heat cannot read', () => {
        const
            pane   = createPane({envelope: teamRead()}),
            toggle = pane.getReference('heat-toggle'),
            places = () => pane.scene.nodes.map(({id, x, y, z}) => [id, x, y, z]),
            before = places(),
            state  = () => [pane.heatOverlay, toggle.pressed, toggle.vdom['aria-pressed'], pane.overlays.heat?.length ?? null];

        // the ripple measures the rendered button, which the unit harness has none of
        toggle.useRippleEffect = false;

        expect(state()).toEqual([false, false, 'false', null]);
        expect(lineOf(pane)).not.toMatch(/heat/);

        toggle.onClick({});
        expect(state()).toEqual([true, true, 'true', 7]);
        expect(lineOf(pane), 'a state the read omits and a missing time are unknown').toMatch(/ · heat · last 3 days · 2 unknown$/);
        expect(places()).toEqual(before);

        pane.envelope = teamRead({'issue-202': {state: 'ON_HOLD'}}, {snapshotId: 'snap-7d11'});
        expect(lineOf(pane), 'a state the heat cannot interpret joins the unknown count, never the cold').toMatch(/ · heat · last 3 days · 3 unknown$/);

        pane.envelope = graphRead({}, {snapshotId: 'snap-8b21'});
        expect(lineOf(pane), 'a read without activity times is unknown throughout').toMatch(/ · heat · last 3 days · 7 unknown$/);

        toggle.onClick({});
        expect(state()).toEqual([false, false, 'false', null]);
        expect(lineOf(pane)).not.toMatch(/heat/);

        pane.destroy()
    });
});

test.describe('AgentOS.view.fleet.goldenpath.ObservatoryContainer — the side panel opens one section to its height', () => {
    const
        // each section's flex and collapse, and whether its head reads expanded for assistive technology
        sectionsOf = pane => Object.fromEntries([
            ['team',     pane.getReference('observatory-team'),  pane.getReference('observatory-peers-title')],
            ['nodes',    pane.getReference('observatory-nodes'), pane.getReference('observatory-nodes-title')],
            ['selected', selectedOf(pane),                       selectedOf(pane).getReference('selected-section-head')]
        ].map(([name, section, head]) => [name, [section.flex, section.cls.includes('is-collapsed'), head.vdom['aria-expanded']]])),
        clickHead  = button => {
            // the ripple measures the rendered button, which the unit harness has none of
            button.useRippleEffect = false;
            button.onClick({})
        };

    test('a read with peers opens Team, a read without opens Nodes, so no default opens an empty section', () => {
        const peerless = createPane({envelope: graphRead()});

        expect(peerless.openSection).toBe('nodes');
        peerless.destroy()
    });

    test('Team opens first; a head opens its section and collapses the others to their heads; an unknown section changes nothing', () => {
        const pane = createPane({envelope: teamRead()});

        expect(sectionsOf(pane)).toEqual({team: [1, false, 'true'], nodes: ['none', true, 'false'], selected: ['none', true, 'false']});

        clickHead(pane.getReference('observatory-nodes-title'));
        expect(sectionsOf(pane)).toEqual({team: ['none', true, 'false'], nodes: [1, false, 'true'], selected: ['none', true, 'false']});

        clickHead(selectedOf(pane).getReference('selected-section-head'));
        expect(pane.openSection).toBe('selected');

        clickHead(pane.getReference('observatory-peers-title'));
        expect(pane.openSection).toBe('team');

        pane.openSection = 'view';
        expect(sectionsOf(pane)).toEqual({team: [1, false, 'true'], nodes: ['none', true, 'false'], selected: ['none', true, 'false']});

        pane.destroy()
    });

    test('View is static: whichever section opens, it never collapses', () => {
        const pane = createPane({envelope: teamRead()}),
              view = pane.getReference('observatory-view-section');

        ['nodes', 'selected', 'team'].forEach(section => {
            pane.openSection = section;
            expect(view.cls).not.toContain('is-collapsed')
        });

        pane.destroy()
    });

    test('a collapsed head still names its count, and selecting a node opens the Selected section with its whole title', () => {
        const pane = createPane({envelope: teamRead()});

        expect(pane.getReference('observatory-nodes-title').text).toMatch(/^Nodes/);
        expect(pane.getReference('observatory-peers-title').text).toMatch(/^Team · /);

        pane.selectedId = q('issue-202');
        expect(pane.openSection).toBe('selected');
        expect(headOf(pane)[0]).toBe('second route item');

        // clearing the selection leaves the open section where the viewer is
        pane.selectedId = null;
        expect(pane.openSection).toBe('selected');

        // a viewer browsing the node list keeps it: the keys walk the rows while the Selected head line names the node
        pane.openSection = 'nodes';
        pane.selectedId  = q('issue-303');
        expect(pane.openSection).toBe('nodes');
        expect(headOf(pane)[0]).toBe('third route item');

        pane.destroy()
    });
});
