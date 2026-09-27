import Container              from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GraphSceneEnvelope     from '../../../util/GraphSceneEnvelope.mjs';
import ObservatoryCanvas      from './ObservatoryCanvas.mjs';
import ObservatorySceneLayout from '../../../util/ObservatorySceneLayout.mjs';
import ViewerTime             from '../../../util/ViewerTime.mjs';

/**
 * What the hover slot and the selection strip say while they have no node to name.
 * @type {Object}
 */
const HINTS = {hover: 'drag orbits · wheel zooms · click selects', selection: 'No node selected'};

/**
 * @summary The Observatory keeper-view — the bounded graph neighbourhood of the Golden Path's route as a
 * navigable 3D scene on the canvas worker. The head carries the read's line first (capability, capture,
 * holdings, completeness — {@link AgentOS.util.GraphSceneEnvelope#describe}) and the node under the pointer
 * beside it; the selection strip below names the selected node as the read has it. The pane binds the
 * shell's `graphSceneEnvelope` leaf, which the cockpit's graph read writes, derives the scene once
 * ({@link AgentOS.util.ObservatorySceneLayout#fromGraphScene}) and hands it to the canvas.
 *
 * Selection is one origin-qualified id, never a draw index: a click on a node selects it, a click on the
 * empty surface clears it, and a new read keeps it while the read still holds the id. A read that lost the id
 * clears the selection and the strip says why. Drag orbits, the wheel zooms.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryContainer
 * @extends Neo.container.Base
 */
class ObservatoryContainer extends Container {
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
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The head (title, the read's line, the hovered node) and the selection strip; the canvas joins them
         * in {@link #construct} where a canvas worker exists. The strip always holds its row, so a selection
         * never resizes the canvas.
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
            ntype    : 'component',
            cls      : ['fm-observatory-selection', 'is-empty', 'is-hint'],
            flex     : 'none',
            reference: 'observatory-selection',
            text     : HINTS.selection
        }],
        /**
         * The selected node's origin-qualified id, or `null`.
         * @member {String|null} selectedId_=null
         * @reactive
         */
        selectedId_: null
    }

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
     * Mounts the canvas only where a canvas worker exists: without one (a config without it; the unit
     * harness, whose stubs resolve the worker's readiness but never define `Neo.worker.Canvas`) the
     * engine's canvas boot throws, so the pane keeps its head and strip and no surface.
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        const me = this;

        if (Neo.config.useCanvasWorker && !Neo.config.unitTestMode) {
            me.add({
                module    : ObservatoryCanvas,
                flex      : 1,
                reference : 'observatory-canvas',
                scene     : me.scene,
                selectedId: me.selectedId,
                listeners : {nodeHover: me.onNodeHover, nodeSelect: me.onNodeSelect, scope: me}
            })
        }
    }

    /**
     * The head and the strip exist from here on; an envelope in the config landed before them.
     */
    onConstructed() {
        super.onConstructed();
        this.updateLine();
        this.updateSelection()
    }

    /**
     * Triggered after the envelope config got changed: the scene is derived again, the read's line and the
     * canvas follow, and a selection the new read no longer holds clears with its reason.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetEnvelope(value, oldValue) {
        const
            me           = this,
            {selectedId} = me,
            // the bound value is the provider's tracking proxy; the layout reads plain data and the worker
            // message carries plain data
            scene        = ObservatorySceneLayout.fromGraphScene(value ? JSON.parse(JSON.stringify(value)) : null);

        me.scene = scene;
        me.updateLine();

        if (selectedId && !Object.hasOwn(scene.index, selectedId)) {
            // an unobserved leaf is a retired read (another instance's): the id did not leave a read, no read is held
            me.selectionNote = scene.currency === 'unobserved' ? null : `Selection cleared · ${selectedId} is not in ${scene.snapshotId ? `snapshot ${scene.snapshotId}` : 'this read'}`;
            me.selectedId    = null
        }

        me.getReference('observatory-canvas')?.set({scene, selectedId: me.selectedId});
        me.updateSelection()
    }

    /**
     * Triggered after the selectedId config got changed: the canvas inks it and the strip names it.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetSelectedId(value, oldValue) {
        const me = this;

        me.getReference('observatory-canvas')?.set({selectedId: value});
        me.updateSelection()
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
     * @summary The canvas reports a selecting click: its node becomes the selection, or the empty surface
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
     * @summary Writes the read's line into the head, with the capture instant in the viewer's own clock, the
     * way the Golden Path text pane stamps it.
     * @protected
     */
    updateLine() {
        const head = this.getReference('observatory-head');

        if (head) {
            head.vdom.cn[1].text = GraphSceneEnvelope.describe(this.envelope, at => ViewerTime.formatViewerTime(at)?.text ?? null).text;
            head.update()
        }
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
