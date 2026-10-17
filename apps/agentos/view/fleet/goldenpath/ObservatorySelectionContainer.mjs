import Button                  from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container               from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GraphNodeSource         from '../../../util/GraphNodeSource.mjs';
import ObservatoryRelationList from './ObservatoryRelationList.mjs';
import ViewerTime              from '../../../util/ViewerTime.mjs';

/**
 * What the section says while nothing is selected and no clearing is news.
 * @type {String}
 */
const HINT = 'No node selected';

/**
 * @summary The Observatory's selected node: what it is and where its evidence lives, one step
 * away. The label leads, then the kind; then what the scene carries about the node — its state as the last
 * ingestion stored it, who authored it, is assigned to it or holds it as a memory, when it last changed, and its
 * rank while the current route holds it. Nothing the scene does not carry is shown as known.
 *
 * The Open action follows the node's source ({@link AgentOS.util.GraphNodeSource}): a work item opens its GitHub
 * page, a session its Memories drill (the section fires `sessionOpen`, the pane routes it), and any other node
 * says that its kind has no source view. The qualified id stays behind the Copy action, in a read-only field the
 * panel never shows. Clear fires `selectionClear` for the pane to drop the selection. The relations, grouped by
 * type and direction, reach the node's neighbours.
 *
 * The pane owns the facts and the relation store; this section only renders them.
 * @class AgentOS.view.fleet.goldenpath.ObservatorySelectionContainer
 * @extends Neo.container.Base
 */
class ObservatorySelectionContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatorySelectionContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatorySelectionContainer',
        /**
         * @member {String} ntype='fm-observatory-selection'
         * @protected
         */
        ntype: 'fm-observatory-selection',
        /**
         * @member {String[]} baseCls=['fm-observatory-selected']
         */
        baseCls: ['fm-observatory-selected'],
        /**
         * The selected node as the pane reads it from the scene, or `null` while nothing is selected:
         * `{id, label, kind, state, authoredBy, assignedTo, memoryOf, lastActivityAt, rank, relations,
         * relationsListed, source}`, `null` for each fact the scene does not carry.
         * @member {Object|null} facts_=null
         * @reactive
         */
        facts_: null,
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * Why the selection last cleared itself, said while nothing is selected.
         * @member {String|null} note_=null
         * @reactive
         */
        note_: null,
        /**
         * The title, the head (label and kind), the facts, the actions with the id they copy, and the relations.
         * @member {Object[]} items
         */
        items: [{
            module   : Button,
            cls      : ['fm-observatory-side-title', 'fm-observatory-section-head'],
            flex     : 'none',
            reference: 'selected-section-head',
            text     : 'Selected node',
            ui       : 'ghost'
        }, {
            ntype    : 'component',
            cls      : ['fm-observatory-selected-head'],
            flex     : 'none',
            reference: 'selected-head',
            vdom     : {cn: [
                {tag: 'span', cls: ['fm-observatory-selected-label', 'is-hint'], text: HINT},
                {tag: 'span', cls: ['fm-observatory-selected-kind'], removeDom: true}
            ]}
        }, {
            ntype    : 'component',
            cls      : ['fm-observatory-selected-facts'],
            flex     : 'none',
            hidden   : true,
            reference: 'selected-facts'
        }, {
            ntype    : 'container',
            cls      : ['fm-pane-actions', 'fm-observatory-selected-actions'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'selected-actions',
            items    : [{
                module   : Button,
                flex     : 'none',
                reference: 'selected-open',
                text     : 'Open',
                ui       : 'ghost'
            }, {
                ntype    : 'component',
                cls      : ['fm-observatory-selected-no-source'],
                flex     : 'none',
                reference: 'selected-no-source'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'selected-copy',
                text     : 'Copy id',
                tooltip  : 'Copy the node\'s qualified id',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'selected-clear',
                text     : 'Clear',
                tooltip  : 'Clear the selection, so the scene takes its own colours again (Escape)',
                ui       : 'ghost'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-observatory-selected-id'],
            flex     : 'none',
            hidden   : true,
            reference: 'selected-id',
            vdom     : {tag: 'input', 'aria-label': 'Qualified id', readonly: true, tabIndex: -1, type: 'text', value: ''}
        }, {
            ntype    : 'component',
            cls      : ['fm-observatory-side-title'],
            flex     : 'none',
            hidden   : true,
            reference: 'observatory-relations-title',
            text     : 'Relations'
        }, {
            module   : ObservatoryRelationList,
            flex     : 1,
            reference: 'observatory-relations'
        }]
    }

    /**
     * @summary The selected node as the scene has it, for this section: the qualified id, a label other than the id,
     * the kind, the state, attribution and last activity the read carries (each `null` where it does not), the rank
     * while the current route holds the node, its relations in the read and how many of them list, and its source
     * ({@link AgentOS.util.GraphNodeSource#sourceOf}). `null` while nothing is selected.
     * @param {Object} pane The Observatory pane's state
     * @param {Number} pane.listBudget
     * @param {Object} pane.scene
     * @param {String|null} pane.selectedId
     * @returns {Object|null}
     */
    static factsOf({listBudget, scene, selectedId}) {
        const index = selectedId && Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1;

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
     * The actions report their clicks to the section.
     */
    onConstructed() {
        super.onConstructed();

        const me = this;

        me.getReference('selected-clear').set({handler: 'onClearClick', handlerScope: me});
        me.getReference('selected-copy') .set({handler: 'onCopyClick',  handlerScope: me});
        me.getReference('selected-open') .set({handler: 'onOpenClick',  handlerScope: me});
        me.getReference('selected-section-head').set({handler: 'onSectionHeadClick', handlerScope: me});
        me.render()
    }

    /**
     * @summary The section's head was clicked: `sectionHeadClick` asks the pane to open this section, which
     * collapses the others to their heads.
     */
    onSectionHeadClick() {
        this.fire('sectionHeadClick', {section: 'selected'})
    }

    /**
     * @summary The Clear action fires `selectionClear`, which the pane routes: the selection belongs to it.
     */
    onClearClick() {
        this.fire('selectionClear')
    }

    /**
     * Triggered after the facts config got changed: the section shows the new selection.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetFacts(value, oldValue) {
        oldValue !== undefined && this.render()
    }

    /**
     * Triggered after the note config got changed: an empty section says why.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetNote(value, oldValue) {
        oldValue !== undefined && this.render()
    }

    /**
     * @summary The facts line: each fact the scene carries about the node, in reading order.
     * @param {Object} facts
     * @returns {String[]}
     * @protected
     */
    factLines(facts) {
        const {assignedTo, authoredBy, lastActivityAt, memoryOf, rank, state} = facts;

        return [
            state          && `${state.toLowerCase()}, as last ingested`,
            authoredBy     && `authored by ${authoredBy}`,
            assignedTo?.length && `assigned to ${assignedTo.join(', ')}`,
            memoryOf       && `memory of ${memoryOf}`,
            Number.isFinite(lastActivityAt) && `last activity ${ViewerTime.formatViewerTime(lastActivityAt)?.text ?? 'at an unreadable time'}`,
            rank           && `Golden Path rank ${rank}`
        ].filter(Boolean)
    }

    /**
     * @summary The Copy action: the id field's text goes to the clipboard, through the main thread's selection.
     * The selection takes the focus into a field nobody sees, so the focus returns to the action.
     * @param {Object} data The click; `detail` is 0 where the keyboard pressed the action
     */
    async onCopyClick(data) {
        const me = this, copy = me.getReference('selected-copy'), field = me.getReference('selected-id'), {windowId} = me;

        if (me.facts) {
            await Neo.main.DomAccess.selectNode({id: field.id, windowId});
            await Neo.main.DomAccess.execCommand({command: 'copy', windowId});
            copy.focus(copy.id, false, true, data?.detail ? 'pointer' : 'keyboard')
        }
    }

    /**
     * @summary The Open action of a session fires `sessionOpen`, which the pane routes. A GitHub page opens as the
     * link it is.
     */
    onOpenClick() {
        const {facts} = this;

        facts?.source?.type === 'session' && this.fire('sessionOpen', {id: facts.id, sessionId: facts.source.sessionId, title: facts.label})
    }

    /**
     * @summary Writes the section from the facts: the head, the facts line, the source action or why there is
     * none, the id, and the relations' title. Without a selection only the head speaks.
     * @protected
     */
    render() {
        const
            me        = this,
            {facts}   = me,
            head      = me.getReference('selected-head'),
            [label, kind] = head.vdom.cn,
            source    = facts?.source ?? null,
            open      = me.getReference('selected-open'),
            noSource  = me.getReference('selected-no-source'),
            title     = me.getReference('observatory-relations-title');

        ['selected-facts', 'selected-actions', 'selected-id', 'observatory-relations-title'].forEach(reference => {
            me.getReference(reference).hidden = !facts
        });

        label.text = facts ? facts.label ?? 'unnamed' : me.note ?? HINT;
        label.cls  = ['fm-observatory-selected-label', ...(facts ? [] : [me.note ? 'is-empty' : 'is-hint'])];
        kind.text  = facts?.kind ?? 'kind unspecified';
        kind.removeDom = !facts;
        head.update();

        if (!facts) {
            // the parts' own hide updates (depth 2) left them in the DOM when a new read cleared the selection; a
            // full-depth update of the section removes them, and costs little with the relations already emptied
            me.updateDepth = -1;
            me.update();
            return
        }

        me.getReference('selected-facts').text = me.factLines(facts).join(' · ') || 'the read carries nothing more about this node';

        open.set({
            hidden : !source,
            text   : source?.type === 'github' ? 'Open on GitHub' : 'Open in Memories',
            tooltip: source?.type === 'github' ? source.url : source ? 'Open this session\'s turns in the Memories pane' : null,
            url    : source?.type === 'github' ? source.url : null
        });

        noSource.hidden = !!source;
        noSource.text   = `No source view for ${facts.kind ?? 'this kind'}`;

        const field = me.getReference('selected-id');

        field.vdom.value = facts.id;
        field.update();

        const {relations, relationsListed} = facts, count = value => value.toLocaleString('en-US');

        title.text = !relations ? 'Relations · none in this read'
            : `Relations · ${count(relations)}${relationsListed < relations ? ` · the first ${count(relationsListed)} listed` : ''}`
    }
}

export default Neo.setupClass(ObservatorySelectionContainer);
