import Button                        from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container                     from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GoldenPathEnvelope            from '../../../util/GoldenPathEnvelope.mjs';
import GraphNodeSource               from '../../../util/GraphNodeSource.mjs';
import GraphSceneEnvelope            from '../../../util/GraphSceneEnvelope.mjs';
import GraphSceneNodes               from '../../../store/GraphSceneNodes.mjs';
import GraphSceneRelations           from '../../../store/GraphSceneRelations.mjs';
import ObservatoryCanvas             from './ObservatoryCanvas.mjs';
import ObservatoryNodeList           from './ObservatoryNodeList.mjs';
import ObservatorySceneLayout        from '../../../util/ObservatorySceneLayout.mjs';
import ObservatorySelectionContainer from './ObservatorySelectionContainer.mjs';
import ObservatoryTeamContainer      from './ObservatoryTeamContainer.mjs';
import ObservatoryViewContainer      from './ObservatoryViewContainer.mjs';
import ViewerTime                    from '../../../util/ViewerTime.mjs';
import {peerHues}                    from '../../../canvas/fmPalette.mjs';

/**
 * What the hover slot says while no node is under the pointer.
 * @type {String}
 */
const HOVER_HINT = 'drag orbits · wheel zooms · click selects';

/**
 * @summary The Observatory keeper-view — the graph read in its wells, as a navigable 3D scene on the canvas
 * worker beside a side panel that reads, top to bottom, the team, the view, the nodes and the selected node.
 * The {@link #geography} is strategic wells by default, the Brain's strategic anchors drawing the
 * rest around them, and density wells on a read that carries no anchor; mail stays out of the scene until the
 * View section brings it in, and the nodes in no well sit in an outer halo it can hide. The head carries the
 * read's line first (capability, capture, holdings, what the view hid, completeness —
 * {@link AgentOS.util.GraphSceneEnvelope#describe}) and the node under the pointer beside it. The pane binds the
 * shell's `graphSceneEnvelope` leaf, which the cockpit's graph read writes, derives the scene once
 * ({@link AgentOS.util.ObservatorySceneLayout#fromGraphScene}) and hands it to the canvas and the panel. The
 * Golden Path leaf only qualifies the line and the route's control: its route's admission is not the graph
 * read's to report, so a withheld route is named beside the graph read's own words.
 *
 * Two overlays draw over whatever geography is chosen, and neither moves a node. The team lens, at the top of the
 * side panel ({@link AgentOS.view.fleet.goldenpath.ObservatoryTeamContainer}), offers the team the read names,
 * busiest first, each peer in its own hue; checking peers draws their nodes in their hues, the union of them,
 * fades the rest, and names in the node list what each node is to its peer
 * ({@link AgentOS.util.ObservatorySceneLayout#roleOf}). Attention brightens what drew attention within the stated
 * window by a named event taxonomy ({@link AgentOS.util.ObservatorySceneLayout#heatOf}), and the line says how
 * much of it is unknown.
 *
 * A focus always has a way back: the Team head's Clear lifts the lens, the selected node's Clear drops the
 * selection, and Escape anywhere in the pane backs out one step, the selection first, then the lens.
 *
 * The selected node's section ({@link AgentOS.view.fleet.goldenpath.ObservatorySelectionContainer}) says what the scene
 * carries about the node and opens its source ({@link AgentOS.util.GraphNodeSource}): a work item's GitHub page,
 * or a session's Memories drill, which this pane hands to the shell as `sessionOpen`.
 *
 * The lists stay at a human scale: up to {@link #listBudget} nodes, the route's seeds first, and the selected
 * node always; the relations of the selected node under the same budget, grouped by type and direction. A title
 * says when a list holds less than the read, and the relations reach the rest.
 *
 * Selection is one origin-qualified id, never a draw index, and every path reaches the same one: a click on a
 * node, a row of the node list (the arrow keys move it), a row of the selected node's relations (which moves
 * to the node at the other end) and the shell's `graphSelectionId` leaf. A
 * click on the empty surface clears it, and a new read keeps it while the read still holds the id; a read that
 * lost the id clears the selection and the selected node's section says why. Without a canvas worker the side
 * panel is the whole view.
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
    /**
     * The side panel's sections that open to its remaining height; the View section always shows.
     * @member {String[]} sections=['nodes','selected','team']
     * @static
     */
    static sections = ['nodes', 'selected', 'team']

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
         * Whether the nodes in no well (no edge, or no path to a hub) are drawn in an outer halo; the View
         * section's Outside wells control flips it, and the line counts them either way.
         * @member {Boolean} halo_=true
         * @reactive
         */
        halo_: true,
        /**
         * Whether the heat overlay is drawn: what drew attention within the stated window brightens and grows, the
         * cold fades and the unknown greys. The View section's Attention control flips it; nothing moves.
         * @member {Boolean} heatOverlay_=false
         * @reactive
         */
        heatOverlay_: false,
        /**
         * Escape backs out of a focus: a key bubbles here from the lists and the controls.
         * @member {Object} keys={Escape: 'onEscape'}
         */
        keys: {Escape: 'onEscape'},
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The head (title, the read's line, the hovered node) and the body: the side panel with the team lens's
         * peers, the View section, the node list and the selected node's section, which the canvas joins in
         * {@link #onConstructed} where a canvas worker exists. A selection never resizes the canvas.
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
                {tag: 'span', cls: ['fm-observatory-hover', 'is-hint'], text: HOVER_HINT}
            ]}
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
                    module   : ObservatoryTeamContainer,
                    flex     : 'none',
                    reference: 'observatory-team'
                }, {
                    module   : ObservatoryViewContainer,
                    flex     : 'none',
                    reference: 'observatory-view-section'
                }, {
                    module   : Button,
                    cls      : ['fm-observatory-side-title', 'fm-observatory-section-head'],
                    flex     : 'none',
                    reference: 'observatory-nodes-title',
                    text     : 'Nodes',
                    ui       : 'ghost'
                }, {
                    module   : ObservatoryNodeList,
                    flex     : 1,
                    reference: 'observatory-nodes'
                }, {
                    module   : ObservatorySelectionContainer,
                    flex     : 1,
                    reference: 'observatory-selected'
                }]
            }]
        }],
        /**
         * Whether mail (agent messages, their broadcast sentinels and the relations routing them) stays in the
         * scene; the View section's Messages control flips it, and the line counts what it hides.
         * @member {Boolean} mail_=false
         * @reactive
         */
        mail_: false,
        /**
         * The identities the team lens shows, in the order they were checked: their nodes take their hues, a node two
         * of them share takes the first one's, and the rest fades. A peer a new read no longer lists stays checked
         * and matches nothing until it returns. Nothing moves.
         * @member {String[]} lensPeers_=[]
         * @reactive
         */
        lensPeers_: [],
        /**
         * The side panel's open section (`team`, `nodes` or `selected`): it takes the panel's remaining height and
         * the others collapse to their heads, each still naming its count. Selecting a node opens `selected`,
         * unless the viewer is browsing `nodes`: the list stays, and the collapsed Selected head line names the node.
         * @member {String} openSection_='team'
         * @reactive
         */
        openSection_: 'team',
        /**
         * The `fleetGoldenPath` envelope, bound from the Viewport provider's `goldenPathEnvelope` leaf. Only its
         * currency is read: a withheld route qualifies the line and reads unavailable in its control.
         * @member {Object|null} routeEnvelope_=null
         * @reactive
         */
        routeEnvelope_: null,
        /**
         * Whether the route is drawn over the graph; the View section's Golden Path control flips it.
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
     * The overlays last handed to the canvas, by the current scene's node indices ({@link #channels}).
     * @member {Object} overlays={heat: null, lens: null}
     */
    overlays = {heat: null, lens: null}
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
     * Whether the viewer has opened a section, by its head or a selection; until then a read opens Team only
     * when it lists peers, and Nodes otherwise, so no default opens an empty section.
     * @member {Boolean} sectionChosen=false
     */
    sectionChosen = false
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
     * The items exist from here on: the lists take their stores and report their choices, the Team section its
     * checks, the View section's controls and the selected node's actions theirs, the canvas joins the body where a
     * canvas worker exists — without one (a config without it; the unit harness, whose stubs resolve the worker's
     * readiness but never define `Neo.worker.Canvas`) the engine's canvas boot throws, so the side panel takes
     * the whole body — and an envelope in the config reaches the head and the panel.
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
        me.getReference('observatory-team').on('lensChange', ({lensPeers}) => me.lensPeers = lensPeers);
        me.getReference('observatory-selected').on({selectionClear: me.onSelectionClear, sessionOpen: me.onSessionOpen, scope: me});
        me.getReference('geography-density')  .set({handler: () => me.geography = 'density',   handlerScope: me});
        me.getReference('geography-strategic').set({handler: () => me.geography = 'strategic', handlerScope: me});
        me.getReference('halo-toggle')        .set({handler: 'onHaloToggleClick',  handlerScope: me});
        me.getReference('heat-toggle')        .set({handler: 'onHeatToggleClick',  handlerScope: me});
        me.getReference('mail-toggle')        .set({handler: 'onMailToggleClick',  handlerScope: me});
        me.getReference('route-toggle')       .set({handler: 'onRouteToggleClick', handlerScope: me});
        me.getReference('observatory-nodes-title').set({handler: () => me.chooseSection('nodes'), handlerScope: me});
        me.getReference('observatory-team').on('sectionHeadClick', ({section}) => me.chooseSection(section));
        me.getReference('observatory-selected').on('sectionHeadClick', ({section}) => me.chooseSection(section));
        me.syncSections();

        if (Neo.config.useCanvasWorker && !Neo.config.unitTestMode) {
            me.getReference('observatory-body').insert(0, {
                module      : ObservatoryCanvas,
                flex        : 1,
                reference   : 'observatory-canvas',
                routeOverlay: me.routeOverlay,
                scene       : me.scene,
                selectedId  : me.selectedId,
                ...me.channels(),
                listeners   : {nodeHover: me.onNodeHover, nodeSelect: me.onNodeSelect, scope: me}
            })
        } else {
            me.getReference('observatory-side').flex = 1
        }

        me.updateLine();
        me.updateView();
        me.syncTeam(true);
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
     * Triggered after the geography config got changed: the same read is laid out again, the selection stays
     * with its node, and the View section says which wells are drawn. The first value is the one the envelope's
     * layout already read.
     * @param {String} value
     * @param {String|undefined} oldValue
     * @protected
     */
    afterSetGeography(value, oldValue) {
        if (oldValue !== undefined) {
            this.applyScene(this.layOut(this.envelope), 'view');
            this.updateView()
        }
    }

    /**
     * Triggered after the halo config got changed: the nodes in no well join or leave the scene, and the View
     * section says which.
     * @param {Boolean} value
     * @param {Boolean|undefined} oldValue
     * @protected
     */
    afterSetHalo(value, oldValue) {
        if (oldValue !== undefined) {
            this.applyScene(this.layOut(this.envelope), 'view');
            this.updateView()
        }
    }

    /**
     * Triggered after the heatOverlay config got changed: the canvas draws or drops the heat, the View section
     * says which, and the line says what the heat could not read. Nothing moves.
     * @param {Boolean} value
     * @param {Boolean|undefined} oldValue
     * @protected
     */
    afterSetHeatOverlay(value, oldValue) {
        const me = this;

        if (oldValue !== undefined) {
            // read before the canvas, which a pane without a canvas worker lacks: the line counts the heat either way
            const {heat} = me.channels();

            me.getReference('observatory-canvas')?.set({heat});
            me.updateView();
            me.updateLine()
        }
    }

    /**
     * Triggered after the lensPeers config got changed: the canvas draws the checked peers' nodes in their hues,
     * the node list names what each node is to its peer, and the line counts the lens. Nothing moves.
     * @param {String[]} value
     * @param {String[]|undefined} oldValue
     * @protected
     */
    afterSetLensPeers(value, oldValue) {
        const me = this;

        if (oldValue !== undefined) {
            const {lens} = me.channels();

            me.getReference('observatory-canvas')?.set({lens});
            me.syncTeam(false);
            me.fillNodeList();
            me.syncLists();
            me.updateLine()
        }
    }

    /**
     * Triggered after the mail config got changed: mail joins or leaves the scene, and the View section says which.
     * @param {Boolean} value
     * @param {Boolean|undefined} oldValue
     * @protected
     */
    afterSetMail(value, oldValue) {
        if (oldValue !== undefined) {
            this.applyScene(this.layOut(this.envelope), 'view');
            this.updateView()
        }
    }

    /**
     * Triggered after the routeEnvelope config got changed: the line and the route's control follow the route's
     * currency.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRouteEnvelope(value, oldValue) {
        this.updateLine();
        this.updateView()
    }

    /**
     * Triggered after the routeOverlay config got changed: the canvas draws or drops the route, and the View
     * section says which. Nothing moves.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetRouteOverlay(value, oldValue) {
        this.getReference('observatory-canvas')?.set({routeOverlay: value});
        this.updateView()
    }

    /**
     * Triggered after the selectedId config got changed: the canvas inks it, the lists follow and the selected
     * node's section names it.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetSelectedId(value, oldValue) {
        const me = this;

        me.getReference('observatory-canvas')?.set({selectedId: value});
        me.syncLists();
        me.updateSelection();
        value && me.openSection !== 'nodes' && me.chooseSection('selected')
    }

    /**
     * Triggered after the openSection config got changed: the side panel opens that section.
     * @param {String} value
     * @param {String|undefined} oldValue
     * @protected
     */
    afterSetOpenSection(value, oldValue) {
        oldValue !== undefined && this.syncSections()
    }

    /**
     * @summary Hands a freshly laid-out scene to the head, the canvas and the lists. A selection the scene no
     * longer holds clears with its reason: a new read that lost the id says so, a view that hides it says that.
     * @param {Object} scene A {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene} scene
     * @param {String} cause `read` when a new read replaced the scene, `view` when the View section did
     * @protected
     */
    applyScene(scene, cause) {
        const me = this, {selectedId} = me;

        me.scene = scene;
        me.channels();
        me.updateLine();

        if (selectedId && !Object.hasOwn(scene.index, selectedId)) {
            // an unobserved leaf is a retired read (another instance's): the id did not leave a read, no read is held
            me.selectionNote = cause === 'view'
                ? `Selection cleared · ${selectedId} is hidden in this view`
                : scene.currency === 'unobserved' ? null : `Selection cleared · ${selectedId} is not in ${scene.snapshotId ? `snapshot ${scene.snapshotId}` : 'this read'}`;
            me.selectedId = null
        }

        // the overlays are indexed by the new scene's nodes, so they cross with it in one batch
        me.getReference('observatory-canvas')?.set({scene, selectedId: me.selectedId, ...me.overlays});
        me.syncTeam(true);
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
     * Triggered before the openSection config gets changed: only a known section opens.
     * @param {String} value
     * @param {String} oldValue
     * @returns {String|undefined}
     * @protected
     */
    beforeSetOpenSection(value, oldValue) {
        return this.beforeSetEnumValue(value, oldValue, 'openSection', ObservatoryContainer.sections)
    }

    /**
     * @summary The two overlays over the current scene, by its node indices, kept in {@link #overlays}: the heat
     * while Attention is on, and the lens with one hue per checked peer while a peer is checked; each `null`
     * otherwise.
     * @returns {{heat: Float32Array|null, lens: Object|null}}
     * @protected
     */
    channels() {
        const me = this, {heatOverlay, lensPeers, scene} = me, lens = ObservatorySceneLayout.lensOf(scene, lensPeers);

        return me.overlays = {
            heat: heatOverlay ? ObservatorySceneLayout.heatOf(scene) : null,
            lens: lens && {lens, hues: Float32Array.from(peerHues(lensPeers))}
        }
    }

    /**
     * @summary The selected node as the scene has it, for its section: the qualified id, a label other than the
     * id, the kind, the state, attribution and last activity the read carries (each `null` where it does not),
     * the rank while the current route holds the node, its relations in the read and how many of them list, and
     * its source ({@link AgentOS.util.GraphNodeSource#sourceOf}). `null` while nothing is selected.
     * @returns {Object|null}
     * @protected
     */
    factsOf() {
        const
            {listBudget, scene, selectedId} = this,
            index = selectedId && Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1;

        if (index < 0) {
            return null
        }

        const
            node      = scene.nodes[index],
            relations = scene.edges.reduce((sum, pair) => sum + (pair.includes(index) ? 1 : 0), 0);

        return {
            assignedTo     : node.assignedTo,
            authoredBy     : node.authoredBy,
            id             : node.id,
            kind           : node.kind ?? null,
            label          : node.label && node.label !== node.id ? node.label : null,
            lastActivityAt : node.lastActivityAt,
            memoryOf       : node.memoryOf,
            rank           : node.rank ?? null,
            relations,
            relationsListed: Math.min(relations, listBudget),
            source         : GraphNodeSource.sourceOf(node),
            state          : node.state
        }
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
     * @summary The hue a peer is drawn in: while checked, its place among the lens's hues, where a peer checked
     * before it may hold its own; otherwise its own place in the palette.
     * @param {String} identity
     * @returns {Number} Degrees
     * @protected
     */
    hueOf(identity) {
        const {lensPeers} = this, at = lensPeers.indexOf(identity);

        return at < 0 ? peerHues([identity])[0] : peerHues(lensPeers)[at]
    }

    /**
     * @summary The scene of a read as this view places it: its geography, and mail and the halo as the View
     * section has them.
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
     * @summary Escape in the pane backs out one step: a selection drops first, then the lens lifts, and with
     * neither nothing changes.
     */
    onEscape() {
        const me = this;

        if (me.selectedId) {
            me.onSelectionClear()
        } else if (me.lensPeers.length) {
            me.lensPeers = []
        }
    }

    /**
     * @summary Outside wells was clicked: the nodes in no well join or leave the scene.
     */
    onHaloToggleClick() {
        this.halo = !this.halo
    }

    /**
     * @summary Attention was clicked: the heat overlay flips.
     */
    onHeatToggleClick() {
        this.heatOverlay = !this.heatOverlay
    }

    /**
     * @summary Messages was clicked: mail joins or leaves the scene.
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
            ].filter(Boolean).join(' · ') : HOVER_HINT;
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
     * @summary Golden Path was clicked: the route overlay flips.
     */
    onRouteToggleClick() {
        this.routeOverlay = !this.routeOverlay
    }

    /**
     * @summary The selected node's Clear, or Escape: the selection drops, and the scene takes its own colours
     * again.
     */
    onSelectionClear() {
        this.selectedId && this.onNodeSelect({node: null})
    }

    /**
     * @summary The selected node's Open action named a session: the pane hands it to the shell as `sessionOpen`,
     * which opens that session's Memories drill in the cockpit.
     * @param {Object}      data
     * @param {String}      data.sessionId
     * @param {String|null} data.title The node's label, the drill's title
     */
    onSessionOpen({sessionId, title}) {
        this.fire('sessionOpen', {sessionId, title})
    }

    /**
     * @summary A node of the current scene as a node-list row, with its relations in the read and, under the
     * lens, what it is to its peer and that peer's hue.
     * @param {Object} node A layout node
     * @returns {Object}
     * @protected
     */
    rowOf(node) {
        const {hop, id, kind, label, rank} = node, lens = ObservatorySceneLayout.roleOf(node, this.lensPeers);

        return {
            hop, id, kind, label, rank,
            relations: this.relationCounts?.[this.scene.index[id]] ?? 0,
            role     : lens?.role ?? null,
            roleHue  : lens ? this.hueOf(lens.peer) : null
        }
    }

    /**
     * @summary Puts the node list's selection on the selected node — a node beyond the list's budget joins it
     * — and fills the relation list with that node's relations, seen from it, up to {@link #listBudget}: grouped
     * by type (an untyped one last) and direction (outgoing first), each group under a header that counts the
     * group in the whole read, and in the feed's order within a group. A reloaded node list has lost its
     * selection, so it is placed again.
     * @protected
     */
    syncLists() {
        const
            me                                         = this,
            {listBudget, nodeStore, scene, selectedId} = me,
            nodes                                      = me.getReference('observatory-nodes'),
            index                                      = selectedId && Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1,
            groupOf                                    = relation => `${relation.type ?? '￿'}\u0000${relation.direction === 'out' ? 0 : 1}`,
            counts                                     = new Map(),
            rows                                       = [],
            relations                                  = index < 0 ? [] : scene.edges.flatMap((pair, edge) => {
                if (!pair.includes(index)) {
                    return []
                }

                const other = scene.nodes[pair[0] === index ? pair[1] : pair[0]];

                return [{direction: pair[0] === index ? 'out' : 'in', otherId: other.id, otherKind: other.kind, otherLabel: other.label, type: scene.edgeTypes[edge] ?? null}]
            });

        relations.forEach(relation => counts.set(groupOf(relation), (counts.get(groupOf(relation)) ?? 0) + 1));

        // the budget cuts in the feed's order; a stable sort keeps that order within each group
        relations.slice(0, listBudget).sort((a, b) => groupOf(a) < groupOf(b) ? -1 : groupOf(a) > groupOf(b) ? 1 : 0).forEach((relation, at, listed) => {
            if (at === 0 || groupOf(listed[at - 1]) !== groupOf(relation)) {
                rows.push({count: counts.get(groupOf(relation)), direction: relation.direction, isHeader: true, type: relation.type})
            }

            rows.push(relation)
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
        rows.length && me.relationStore.add(rows.map((row, position) => ({...row, position})));

        const record = index < 0 ? null : nodeStore.get(selectedId);

        if (nodes?.selectionModel) {
            nodes.selectionModel.deselectAll(true);
            record && nodes.selectItem(record)
        }
    }

    /**
     * @summary The viewer opened a section, by its head or a selection: from now on a new read keeps it open.
     * @param {String} section One of {@link #sections}
     * @protected
     */
    chooseSection(section) {
        this.sectionChosen = true;
        this.openSection   = section
    }

    /**
     * @summary Opens {@link #openSection} to the side panel's remaining height and collapses the others to their
     * heads; a head is pressed and `aria-expanded` while its section is open. The View section is not a section: it always shows.
     * @protected
     */
    syncSections() {
        const me = this, {openSection} = me;

        [['team', 'observatory-team', 'observatory-peers-title'],
         ['nodes', 'observatory-nodes', 'observatory-nodes-title'],
         ['selected', 'observatory-selected', 'selected-section-head']].forEach(([section, body, head]) => {
            const isOpen = section === openSection, component = me.getReference(body), button = me.getReference(head);

            // the layout copied flex into the style when it placed the section, so a change must reach the style
            component.flex  = isOpen ? 1 : 'none';
            component.style = {...component.style, flex: isOpen ? '1 1 0%' : 'none'};
            component.toggleCls('is-collapsed', !isOpen);
            button.pressed               = isOpen;
            button.vdom['aria-expanded'] = String(isOpen);
            button.update()
        })
    }

    /**
     * @summary Hands the Team section the scene's peers, each in the hue it is drawn in, and the lens: a new
     * scene refills the list, a changed lens only recolours it and puts its checks back.
     * @param {Boolean} refill `true` for a new scene
     * @protected
     */
    syncTeam(refill) {
        const me = this, peers = ObservatorySceneLayout.peersOf(me.scene);

        me.getReference('observatory-team')?.sync({
            lensPeers: me.lensPeers,
            named    : me.scene.identities.length > 0,
            peers    : peers.map(peer => ({...peer, hue: me.hueOf(peer.id)})),
            refill
        });

        me.sectionChosen || (me.openSection = peers.length ? 'team' : 'nodes')
    }

    /**
     * @summary Writes the read's line into the head, with the capture instant in the viewer's own clock, the
     * way the Golden Path text pane stamps it, and a withheld route named beside it. The Golden Path leaf is the
     * pane's one source for the route's admission: it alone knows whether the route expired. Under the lens the
     * line counts its nodes and peers; under the heat it states the window and how many nodes it could not read.
     * @protected
     */
    updateLine() {
        const
            me             = this,
            head           = me.getReference('observatory-head'),
            route          = me.routeEnvelope,
            {scene}        = me,
            {heat, lens}   = me.overlays,
            plural         = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`,
            days           = ObservatorySceneLayout.attention.windowMs / 86400000,
            lensed         = lens ? lens.lens.reduce((sum, peer) => sum + (peer > 0 ? 1 : 0), 0) : 0,
            unknown        = heat ? heat.reduce((sum, value) => sum + (Number.isNaN(value) ? 1 : 0), 0) : 0,
            // the line counts what the layout drew, names what the view hid, and what the read carried beyond it
            drawn          = scene && {nodes: scene.nodes.length, edges: scene.edges.length, halo: scene.halo, hidden: scene.hidden, overCap: scene.overCap, wellCap: scene.wellCap};

        if (head) {
            head.vdom.cn[1].text = [
                GraphSceneEnvelope.describe(me.envelope, at => ViewerTime.formatViewerTime(at)?.text ?? null, drawn).text,
                GoldenPathEnvelope.currency(route) === 'withheld' && `route withheld · ${GoldenPathEnvelope.withheldReason(route)}`,
                lens && `lens · ${plural(lensed, 'node')} · ${plural(me.lensPeers.length, 'peer')}`,
                heat && `heat · last ${plural(days, 'day')}${unknown ? ` · ${unknown} unknown` : ''}`
            ].filter(Boolean).join(' · ');
            head.update()
        }
    }

    /**
     * @summary Hands the selected node's section its facts, or, without a selection, why it last cleared.
     * @protected
     */
    updateSelection() {
        this.getReference('observatory-selected')?.set({facts: this.factsOf(), note: this.selectionNote})
    }

    /**
     * @summary Hands the View section the pane's state: the geography, each overlay, the attention window, and
     * why the Golden Path read withholds the route while it does.
     * @protected
     */
    updateView() {
        const me = this, route = me.routeEnvelope;

        me.getReference('observatory-view-section')?.sync({
            geography    : me.geography,
            halo         : me.halo,
            heat         : me.heatOverlay,
            heatDays     : ObservatorySceneLayout.attention.windowMs / 86400000,
            mail         : me.mail,
            route        : me.routeOverlay,
            routeWithheld: GoldenPathEnvelope.currency(route) === 'withheld' ? GoldenPathEnvelope.withheldReason(route) || 'no reason given' : null
        })
    }
}

export default Neo.setupClass(ObservatoryContainer);
