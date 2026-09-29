import Button                  from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container               from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GoldenPathEnvelope      from '../../../util/GoldenPathEnvelope.mjs';
import GraphSceneEnvelope      from '../../../util/GraphSceneEnvelope.mjs';
import GraphSceneNodes         from '../../../store/GraphSceneNodes.mjs';
import GraphSceneRelations     from '../../../store/GraphSceneRelations.mjs';
import ObservatoryCanvas       from './ObservatoryCanvas.mjs';
import ObservatoryNodeList     from './ObservatoryNodeList.mjs';
import ObservatoryRelationList from './ObservatoryRelationList.mjs';
import ObservatorySceneLayout  from '../../../util/ObservatorySceneLayout.mjs';
import ViewerTime              from '../../../util/ViewerTime.mjs';

/**
 * What the hover slot and the selection strip say while they have no node to name.
 * @type {Object}
 */
const HINTS = {hover: 'drag orbits · wheel zooms · click selects', selection: 'No node selected'};

/**
 * @summary The Observatory keeper-view — the graph read in its wells, as a navigable 3D scene on the canvas
 * worker and as two lists beside it, with the Golden Path's route as an overlay the Route toggle draws or
 * leaves out. The {@link #geography} is strategic wells by default, the Brain's strategic anchors drawing the rest
 * around them, and density wells on a read that carries no anchor; mail stays out of the scene until the Mail
 * toggle brings it in, and the nodes in no
 * well sit in an outer halo the Halo toggle hides. The head carries the read's line first (capability, capture,
 * holdings, what the view hid, completeness — {@link AgentOS.util.GraphSceneEnvelope#describe}) and the node
 * under the pointer beside it; the selection strip below names the selected node as the read has it. The pane binds the shell's `graphSceneEnvelope` leaf,
 * which the cockpit's graph read writes, derives the scene once
 * ({@link AgentOS.util.ObservatorySceneLayout#fromGraphScene}) and hands it to the canvas and the lists. The
 * Golden Path leaf only qualifies the line: its route's admission is not the graph read's to report, so a
 * withheld route is named beside the graph read's own words.
 *
 * The lists stay at a human scale: up to {@link #listBudget} nodes, the route's seeds first, and the selected
 * node always; the relations of the selected node under the same budget. A title says when a list holds less
 * than the read, and the relations reach the rest.
 *
 * Selection is one origin-qualified id, never a draw index, and every path reaches the same one: a click on a
 * node, a row of the node list (the arrow keys move it), a row of the selected node's relations (which moves
 * to the node at the other end) and the shell's `graphSelectionId` leaf. A
 * click on the empty surface clears it, and a new read keeps it while the read still holds the id; a read that
 * lost the id clears the selection and the strip says why. Without a canvas worker the lists are the whole view.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryContainer
 * @extends Neo.container.Base
 */
class ObservatoryContainer extends Container {
    /**
     * Valid values for {@link #geography}.
     * @member {String[]} geographies=['communities', 'density', 'strategic']
     * @protected
     * @static
     */
    static geographies = ['communities', 'density', 'strategic']

    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryContainer',
        /**
         * @member {String} ntype='fm-observatory-pane'
         * @protected
         */
        ntype: 'fm-observatory-pane',
        /**
         * @member {String[]} baseCls=['fm-observatory-pane']
         */
        baseCls: ['fm-observatory-pane'],
        /**
         * The `fleetGraphScene` envelope, bound from the Viewport provider's `graphSceneEnvelope` leaf.
         * @member {Object|null} envelope_=null
         * @reactive
         */
        envelope_: null,
        /**
         * How the scene places its nodes: `strategic` (wells around the Brain's strategic anchors, each held to a
         * cap), `density` (wells around the read's most connected nodes) or `communities` (the topology's Louvain
         * communities). A read without an anchor lays `strategic` out as `density`, and the scene's own `geography`
         * names what was drawn. Switching moves the nodes and keeps the selection.
         * @member {String} geography_='strategic'
         * @reactive
         */
        geography_: 'strategic',
        /**
         * Whether the nodes in no well (no edge, or no path to a hub) are drawn in an outer halo; the Halo toggle
         * flips it, and the line counts them either way.
         * @member {Boolean} halo_=true
         * @reactive
         */
        halo_: true,
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The head (title, the read's line, the hovered node), the strip (the selection, then the Mail, Halo and
         * Route toggles, so the read's line keeps the head's whole width) and the body: the side panel with the
         * node list and the selected node's relations, which the canvas joins in {@link #onConstructed} where a
         * canvas worker exists. The strip always holds its row, so a selection never resizes the canvas.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-observatory-head'],
            flex     : 'none',
            reference: 'observatory-head',
            vdom     : {cn: [
                {tag: 'span', cls: ['fm-observatory-title'],    text: 'Golden Path · observatory'},
                {tag: 'span', cls: ['fm-observatory-currency'], text: GraphSceneEnvelope.describe(null).text},
                {tag: 'span', cls: ['fm-observatory-hover', 'is-hint'], text: HINTS.hover}
            ]}
        }, {
            ntype : 'container',
            cls   : ['fm-observatory-strip'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype    : 'component',
                cls      : ['fm-observatory-selection', 'is-empty', 'is-hint'],
                flex     : 1,
                reference: 'observatory-selection',
                text     : HINTS.selection
            }, {
                module   : Button,
                cls      : ['fm-observatory-toggle', 'fm-observatory-mail'],
                flex     : 'none',
                pressed  : false,
                reference: 'mail-toggle',
                text     : 'Mail',
                tooltip  : 'Draw agent messages and their relations in the graph',
                ui       : 'ghost'
            }, {
                module   : Button,
                cls      : ['fm-observatory-toggle', 'fm-observatory-halo'],
                flex     : 'none',
                pressed  : true,
                reference: 'halo-toggle',
                text     : 'Halo',
                tooltip  : 'Draw the nodes in no well (no edge, or no path to a hub) in an outer halo',
                ui       : 'ghost'
            }, {
                module   : Button,
                cls      : ['fm-observatory-toggle', 'fm-observatory-route'],
                flex     : 'none',
                pressed  : true,
                reference: 'route-toggle',
                text     : 'Route',
                tooltip  : 'Draw the Golden Path route over the graph',
                ui       : 'ghost'
            }]
        }, {
            ntype    : 'container',
            cls      : ['fm-observatory-body'],
            flex     : 1,
            layout   : {ntype: 'hbox', align: 'stretch'},
            reference: 'observatory-body',
            items    : [{
                ntype    : 'container',
                cls      : ['fm-observatory-side'],
                flex     : 'none',
                layout   : {ntype: 'vbox', align: 'stretch'},
                reference: 'observatory-side',
                items    : [{
                    ntype    : 'component',
                    cls      : ['fm-observatory-side-title'],
                    flex     : 'none',
                    reference: 'observatory-nodes-title',
                    text     : 'Nodes'
                }, {
                    module   : ObservatoryNodeList,
                    flex     : 1,
                    reference: 'observatory-nodes'
                }, {
                    ntype    : 'component',
                    cls      : ['fm-observatory-side-title'],
                    flex     : 'none',
                    reference: 'observatory-relations-title',
                    text     : 'Relations of the selected node'
                }, {
                    module   : ObservatoryRelationList,
                    flex     : 1,
                    reference: 'observatory-relations'
                }]
            }]
        }],
        /**
         * Whether mail (agent messages, their broadcast sentinels and the relations routing them) stays in the
         * scene; the Mail toggle flips it, and the line counts what it hides.
         * @member {Boolean} mail_=false
         * @reactive
         */
        mail_: false,
        /**
         * The `fleetGoldenPath` envelope, bound from the Viewport provider's `goldenPathEnvelope` leaf. Only its
         * currency is read: a withheld route qualifies the line.
         * @member {Object|null} routeEnvelope_=null
         * @reactive
         */
        routeEnvelope_: null,
        /**
         * Whether the route is drawn over the graph; the Route toggle flips it.
         * @member {Boolean} routeOverlay_=true
         * @reactive
         */
        routeOverlay_: true,
        /**
         * The selected node's origin-qualified id, or `null`. The Viewport binds it both ways to the shared
         * `graphSelectionId` leaf.
         * @member {String|null} selectedId_=null
         * @reactive
         */
        selectedId_: null
    }

    /**
     * The most rows either list holds: a read up to it lists whole, a larger one lists the route's seeds first
     * and then by id, and the relations reach the rest.
     * @member {Number} listBudget=500
     */
    listBudget = 500
    /**
     * The id of the one node-list row beyond the budget: the selection, while the listed nodes lack it.
     * @member {String|null} extraId=null
     */
    extraId = null

    /**
     * The nodes of the current scene, one record each, in the layout's order.
     * @member {AgentOS.store.GraphSceneNodes|null} nodeStore=null
     */
    nodeStore = null
    /**
     * Each node's relations in the current read, by layout index.
     * @member {Uint32Array|null} relationCounts=null
     */
    relationCounts = null
    /**
     * The relations of the selected node.
     * @member {AgentOS.store.GraphSceneRelations|null} relationStore=null
     */
    relationStore = null
    /**
     * The scene of the current envelope, as the layout derived it.
     * @member {Object} scene
     */
    scene = ObservatorySceneLayout.fromGraphScene(null)
    /**
     * Why the selection last cleared itself, until the next selection or click.
     * @member {String|null} selectionNote=null
     */
    selectionNote = null

    /**
     * The projection stores exist before the configs apply, so an envelope in the config fills them.
     * @param {Object} config
     */
    construct(config) {
        const me = this;

        me.nodeStore     = Neo.create(GraphSceneNodes);
        me.relationStore = Neo.create(GraphSceneRelations);

        super.construct(config)
    }

    /**
     * The items exist from here on: the lists take their stores and report their choices, the canvas joins
     * the body where a canvas worker exists — without one (a config without it; the unit harness, whose stubs
     * resolve the worker's readiness but never define `Neo.worker.Canvas`) the engine's canvas boot throws, so
     * the lists take the whole body — and an envelope in the config reaches the head, the strip and the lists.
     */
    onConstructed() {
        super.onConstructed();

        const
            me        = this,
            nodes     = me.getReference('observatory-nodes'),
            relations = me.getReference('observatory-relations');

        nodes.store     = me.nodeStore;
        relations.store = me.relationStore;
        nodes    .on('select', me.onNodeListSelect,     me);
        relations.on('select', me.onRelationListSelect, me);
        me.getReference('halo-toggle') .set({handler: 'onHaloToggleClick',  handlerScope: me});
        me.getReference('mail-toggle') .set({handler: 'onMailToggleClick',  handlerScope: me});
        me.getReference('route-toggle').set({handler: 'onRouteToggleClick', handlerScope: me});

        if (Neo.config.useCanvasWorker && !Neo.config.unitTestMode) {
            me.getReference('observatory-body').insert(0, {
                module      : ObservatoryCanvas,
                flex        : 1,
                reference   : 'observatory-canvas',
                routeOverlay: me.routeOverlay,
                scene       : me.scene,
                selectedId  : me.selectedId,
                listeners   : {nodeHover: me.onNodeHover, nodeSelect: me.onNodeSelect, scope: me}
            })
        } else {
            me.getReference('observatory-side').flex = 1
        }

        me.updateLine();
        me.updateToggles();
        me.fillNodeList();
        me.syncLists();
        me.updateSelection()
    }

    /**
     * The stores go after the lists that render them.
     * @param {...*} args
     */
    destroy(...args) {
        const {nodeStore, relationStore} = this;

        super.destroy(...args);
        nodeStore?.destroy();
        relationStore?.destroy()
    }

    /**
     * Triggered after the envelope config got changed: the scene is derived again from the new read.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetEnvelope(value, oldValue) {
        this.applyScene(this.layOut(value), 'read')
    }

    /**
     * Triggered after the geography config got changed: the same read is laid out again, and the selection stays
     * with its node. The first value is the one the envelope's layout already read.
     * @param {String} value
     * @param {String|undefined} oldValue
     * @protected
     */
    afterSetGeography(value, oldValue) {
        oldValue !== undefined && this.applyScene(this.layOut(this.envelope), 'view')
    }

    /**
     * Triggered after the halo config got changed: the nodes in no well join or leave the scene, and the toggle
     * says which.
     * @param {Boolean} value
     * @param {Boolean|undefined} oldValue
     * @protected
     */
    afterSetHalo(value, oldValue) {
        if (oldValue !== undefined) {
            this.applyScene(this.layOut(this.envelope), 'view');
            this.updateToggles()
        }
    }

    /**
     * Triggered after the mail config got changed: mail joins or leaves the scene, and the toggle says which.
     * @param {Boolean} value
     * @param {Boolean|undefined} oldValue
     * @protected
     */
    afterSetMail(value, oldValue) {
        if (oldValue !== undefined) {
            this.applyScene(this.layOut(this.envelope), 'view');
            this.updateToggles()
        }
    }

    /**
     * Triggered after the routeEnvelope config got changed: the line follows the route's currency.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRouteEnvelope(value, oldValue) {
        this.updateLine()
    }

    /**
     * Triggered after the routeOverlay config got changed: the canvas draws or drops the route, and the toggle
     * says which. Nothing moves.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetRouteOverlay(value, oldValue) {
        this.getReference('observatory-canvas')?.set({routeOverlay: value});
        this.updateToggles()
    }

    /**
     * Triggered after the selectedId config got changed: the canvas inks it, the lists follow and the strip
     * names it.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetSelectedId(value, oldValue) {
        const me = this;

        me.getReference('observatory-canvas')?.set({selectedId: value});
        me.syncLists();
        me.updateSelection()
    }

    /**
     * @summary Hands a freshly laid-out scene to the head, the canvas and the lists. A selection the scene no
     * longer holds clears with its reason: a new read that lost the id says so, a view that hides it says that.
     * @param {Object} scene A {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene} scene
     * @param {String} cause `read` when a new read replaced the scene, `view` when a toggle or the geography did
     * @protected
     */
    applyScene(scene, cause) {
        const me = this, {selectedId} = me;

        me.scene = scene;
        me.updateLine();

        if (selectedId && !Object.hasOwn(scene.index, selectedId)) {
            // an unobserved leaf is a retired read (another instance's): the id did not leave a read, no read is held
            me.selectionNote = cause === 'view'
                ? `Selection cleared · ${selectedId} is hidden in this view`
                : scene.currency === 'unobserved' ? null : `Selection cleared · ${selectedId} is not in ${scene.snapshotId ? `snapshot ${scene.snapshotId}` : 'this read'}`;
            me.selectedId = null
        }

        me.getReference('observatory-canvas')?.set({scene, selectedId: me.selectedId});
        me.fillNodeList();
        me.syncLists();
        me.updateSelection()
    }

    /**
     * Triggered before the geography config gets changed: only a known geography applies.
     * @param {String} value
     * @param {String} oldValue
     * @returns {String|undefined}
     * @protected
     */
    beforeSetGeography(value, oldValue) {
        return this.beforeSetEnumValue(value, oldValue, 'geography', ObservatoryContainer.geographies)
    }

    /**
     * @summary The selected node as the read has it: its label, kind, qualified id and route rank, and its
     * relations counted by type, where a relation the feed left untyped counts as `unspecified`. `null` while
     * nothing is selected.
     * @returns {String|null}
     */
    describeSelection() {
        const
            {scene, selectedId} = this,
            index = selectedId && Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1;

        if (index < 0) {
            return null
        }

        const
            node   = scene.nodes[index],
            types  = scene.edges.flatMap((pair, edge) => pair.includes(index) ? [scene.edgeTypes[edge] ?? 'unspecified'] : []),
            counts = [...new Set(types)].sort().map(type => `${types.filter(entry => entry === type).length} ${type}`);

        return [
            'Selected',
            node.label !== node.id && node.label,
            node.kind ?? 'kind unspecified',
            node.id,
            node.rank && `rank ${node.rank}`,
            types.length ? `${types.length} relation${types.length === 1 ? '' : 's'} (${counts.join(', ')})` : 'no relations in this read'
        ].filter(Boolean).join(' · ')
    }

    /**
     * @summary Fills the node list from the current scene: the whole read up to {@link #listBudget}, else the
     * budget's first nodes in the layout's order, the route's seeds leading. The title says when the list holds
     * less than the read.
     * @protected
     */
    fillNodeList() {
        const
            me                             = this,
            {listBudget, nodeStore, scene} = me,
            counts                         = new Uint32Array(scene.nodes.length),
            listed                         = scene.nodes.slice(0, listBudget),
            title                          = me.getReference('observatory-nodes-title');

        scene.edges.forEach(([from, to]) => {
            counts[from]++;
            from !== to && counts[to]++
        });

        me.relationCounts = counts;
        me.extraId        = null;
        nodeStore.clear();
        listed.length && nodeStore.add(listed.map(node => me.rowOf(node)));

        if (title) {
            title.text = scene.nodes.length > listed.length
                ? `Nodes · ${listed.length.toLocaleString('en-US')} of ${scene.nodes.length.toLocaleString('en-US')} · relations reach the rest`
                : 'Nodes'
        }
    }

    /**
     * @summary The scene of a read as this view places it: its geography, and mail and the halo as the toggles
     * have them.
     * @param {Object|null} envelope The bound envelope
     * @returns {Object} A {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene} scene
     * @protected
     */
    layOut(envelope) {
        const {geography, halo, mail} = this;

        // the bound value is the provider's tracking proxy; the layout reads the plain projection
        return ObservatorySceneLayout.fromGraphScene(GraphSceneEnvelope.plain(envelope), {geography, halo, mail})
    }

    /**
     * @summary The Halo toggle was clicked: the nodes in no well join or leave the scene.
     */
    onHaloToggleClick() {
        this.halo = !this.halo
    }

    /**
     * @summary The Mail toggle was clicked: mail joins or leaves the scene.
     */
    onMailToggleClick() {
        this.mail = !this.mail
    }

    /**
     * @summary A row of the node list became selected — by a click or by the arrow keys.
     * @param {Object} data
     * @param {Object[]} data.records
     */
    onNodeListSelect({records}) {
        const id = records?.[0]?.id;

        id && id !== this.selectedId && this.onNodeSelect({node: {id}})
    }

    /**
     * @summary Names the node under the pointer in the head — its label, kind, and its route rank or its
     * distance from the route — and returns the gesture hint when the pointer rests on no node.
     * @param {Object} data
     * @param {Object|null} data.node
     */
    onNodeHover({node}) {
        const head = this.getReference('observatory-head'), slot = head?.vdom.cn[2];

        if (slot) {
            slot.text = node ? [
                node.label ?? node.id,
                node.kind,
                node.hop === 0 ? `rank ${node.rank}` : node.hop === null ? 'no edge to the route in this read' : `${node.hop} hop${node.hop === 1 ? '' : 's'} from the route`
            ].filter(Boolean).join(' · ') : HINTS.hover;
            slot.cls = ['fm-observatory-hover', ...(node ? [] : ['is-hint'])];
            head.update()
        }
    }

    /**
     * @summary A choice of a node — a canvas click, a list row — becomes the selection, or the empty surface
     * clears it. Either way the last automatic clearing is no longer news. Only an id the current read holds
     * can be selected: an answer about a replaced read changes nothing, and its clearing reason stays.
     * @param {Object} data
     * @param {Object|null} data.node
     */
    onNodeSelect({node}) {
        const me = this, id = node?.id ?? null;

        if (id && !Object.hasOwn(me.scene.index, id)) {
            return
        }

        me.selectionNote = null;
        me.selectedId    = id;
        me.updateSelection()
    }

    /**
     * @summary A relation row was chosen: the selection moves to the node at its other end.
     * @param {Object} data
     * @param {Object[]} data.records
     */
    onRelationListSelect({records}) {
        const otherId = records?.[0]?.otherId;

        otherId && this.onNodeSelect({node: {id: otherId}})
    }

    /**
     * @summary The Route toggle was clicked: the overlay flips.
     */
    onRouteToggleClick() {
        this.routeOverlay = !this.routeOverlay
    }

    /**
     * @summary A node of the current scene as a node-list row, with its relations in the read.
     * @param {Object} node A layout node
     * @returns {Object}
     * @protected
     */
    rowOf({hop, id, kind, label, rank}) {
        return {hop, id, kind, label, rank, relations: this.relationCounts?.[this.scene.index[id]] ?? 0}
    }

    /**
     * @summary Puts the node list's selection on the selected node — a node beyond the list's budget joins it
     * — and fills the relation list with that node's relations, seen from it, up to {@link #listBudget}. A
     * reloaded node list has lost its selection, so it is placed again.
     * @protected
     */
    syncLists() {
        const
            me                                         = this,
            {listBudget, nodeStore, scene, selectedId} = me,
            nodes                                      = me.getReference('observatory-nodes'),
            title                                      = me.getReference('observatory-relations-title'),
            index                                      = selectedId && Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1,
            relations                                  = index < 0 ? [] : scene.edges.flatMap((pair, edge) => {
                if (!pair.includes(index)) {
                    return []
                }

                const other = scene.nodes[pair[0] === index ? pair[1] : pair[0]];

                return [{direction: pair[0] === index ? 'out' : 'in', otherId: other.id, otherKind: other.kind, otherLabel: other.label, type: scene.edgeTypes[edge]}]
            });

        // one row beyond the budget at most: the selection, while the listed nodes lack it
        if (me.extraId && me.extraId !== selectedId) {
            nodeStore.remove(me.extraId);
            me.extraId = null
        }

        if (index >= 0 && !nodeStore.get(selectedId)) {
            nodeStore.add(me.rowOf(scene.nodes[index]));
            me.extraId = selectedId
        }

        me.relationStore.clear();
        relations.length && me.relationStore.add(relations.slice(0, listBudget).map((relation, position) => ({...relation, position})));

        if (title) {
            title.text = relations.length > listBudget
                ? `Relations of the selected node · ${listBudget.toLocaleString('en-US')} of ${relations.length.toLocaleString('en-US')}`
                : 'Relations of the selected node'
        }

        const record = index < 0 ? null : nodeStore.get(selectedId);

        if (nodes?.selectionModel) {
            nodes.selectionModel.deselectAll(true);
            record && nodes.selectItem(record)
        }
    }

    /**
     * @summary Writes the read's line into the head, with the capture instant in the viewer's own clock, the
     * way the Golden Path text pane stamps it, and a withheld route named beside it.
     * @protected
     */
    updateLine() {
        const
            me    = this,
            head  = me.getReference('observatory-head'),
            route = me.routeEnvelope,
            // the line counts what the layout drew, names what the view hid, and what the read carried beyond it
            drawn = me.scene && {nodes: me.scene.nodes.length, edges: me.scene.edges.length, halo: me.scene.halo, hidden: me.scene.hidden};

        if (head) {
            head.vdom.cn[1].text = [
                GraphSceneEnvelope.describe(me.envelope, at => ViewerTime.formatViewerTime(at)?.text ?? null, drawn).text,
                GoldenPathEnvelope.currency(route) === 'withheld' && `route withheld · ${GoldenPathEnvelope.withheldReason(route)}`
            ].filter(Boolean).join(' · ');
            head.update()
        }
    }

    /**
     * @summary The strip's toggles show their state: Mail pressed while mail is drawn, Halo while the halo is,
     * Route while the route is, for the eye and for assistive technology alike.
     * @protected
     */
    updateToggles() {
        const me = this;

        [['mail-toggle', me.mail], ['halo-toggle', me.halo], ['route-toggle', me.routeOverlay]].forEach(([reference, pressed]) => {
            const toggle = me.getReference(reference);

            if (toggle) {
                toggle.pressed               = pressed;
                toggle.vdom['aria-pressed'] = String(pressed);
                toggle.update()
            }
        })
    }

    /**
     * @summary Writes the selection strip: the selected node, else why the selection cleared, else the hint.
     * @protected
     */
    updateSelection() {
        const
            me     = this,
            strip  = me.getReference('observatory-selection'),
            detail = me.describeSelection();

        if (strip) {
            strip.text = detail ?? me.selectionNote ?? HINTS.selection;
            strip.toggleCls('is-empty', !detail);
            // the note names an id, whose case is part of it
            strip.toggleCls('is-hint', !detail && !me.selectionNote)
        }
    }
}

export default Neo.setupClass(ObservatoryContainer);
