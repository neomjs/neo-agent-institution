import Button                 from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container              from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import ObservatoryNodeList    from './ObservatoryNodeList.mjs';
import ObservatorySceneLayout from '../../../util/ObservatorySceneLayout.mjs';
import Select                 from '../../../../../node_modules/neo.mjs/src/form/field/Select.mjs';
import TextField              from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';

/**
 * @summary The head of the Observatory's Nodes section: the title with how much of the read matches or is listed and
 * the toggle between the list's two orders on the chrome line, the label/id and kind filter row beneath it, and the
 * order or match summary in the detail role (with `Clear filter` on no match). Typing buffers outside the keystroke
 * (`emitFilterChange`, 120 ms trailing) and flushes synchronously on `ArrowDown` into the rows (`listEnter`), clear,
 * or kind selection. A collapsed section keeps only the chrome line (`ObservatoryContainer.scss`).
 * @class AgentOS.view.fleet.goldenpath.ObservatoryNodesHeadContainer
 * @extends Neo.container.Base
 */
class ObservatoryNodesHeadContainer extends Container {
    static delayable = {
        emitFilterChange: {type: 'buffer', timer: 120}
    }

    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryNodesHeadContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryNodesHeadContainer',
        /**
         * @member {String} ntype='fm-observatory-nodes-head'
         * @protected
         */
        ntype: 'fm-observatory-nodes-head',
        /**
         * @member {String[]} baseCls=['fm-observatory-nodes-head']
         */
        baseCls: ['fm-observatory-nodes-head'],
        /**
         * How much of the read the list holds, `{listed, matched, total}`; `null` until a read lands.
         * @member {Object|null} counts_=null
         * @reactive
         */
        counts_: null,
        /**
         * Active filter `{query, kind}` or `null`, owned by {@link AgentOS.view.fleet.goldenpath.ObservatoryContainer}.
         * @member {Object|null} filter_=null
         * @reactive
         */
        filter_: null,
        /**
         * Distinct node kinds offered in the kind select.
         * @member {String[]} kinds_=[]
         * @reactive
         */
        kinds_: [],
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The list's order ({@link AgentOS.view.fleet.goldenpath.ObservatoryNodeList#orderOf}); the toggle reads
         * pressed for `relations`.
         * @member {'changed'|'relations'} order_='changed'
         * @reactive
         */
        order_: 'changed',
        /**
         * The chrome line (the title, then the order's toggle), the filter controls, then the order or match words.
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-pane-actions', 'fm-observatory-nodes-row'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                module   : Button,
                cls      : ['fm-observatory-side-title', 'fm-observatory-section-head'],
                flex     : 1,
                keys     : {Down: (data, button) => button.up('fm-observatory-nodes-head')?.onDownIntoList()},
                reference: 'observatory-nodes-title',
                text     : 'Nodes',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'observatory-nodes-order',
                text     : 'by relations',
                tooltip  : 'Read the nodes with the most relations first',
                ui       : 'ghost'
            }]
        }, {
            ntype    : 'container',
            cls      : ['fm-observatory-nodes-filter'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'hbox', align: 'center'},
            reference: 'observatory-nodes-filter-row',
            items    : [{
                module         : TextField,
                clearable      : true,
                flex           : 1,
                hideLabel      : true,
                keys           : {Down: (data, field) => field.up('fm-observatory-nodes-head')?.onDownIntoList()},
                labelText      : 'Filter nodes by label or id',
                placeholderText: 'Filter label or id',
                reference      : 'observatory-nodes-query'
            }, {
                module         : Select,
                customizable   : false,
                flex           : 'none',
                hideLabel      : true,
                labelText      : 'Node kind',
                options        : [],
                placeholderText: 'All kinds',
                reference      : 'observatory-nodes-kind',
                showErrorTexts : false
            }]
        }, {
            ntype    : 'container',
            cls      : ['fm-observatory-nodes-detail'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'hbox', align: 'center'},
            reference: 'observatory-nodes-detail',
            items    : [{
                ntype    : 'component',
                cls      : ['fm-observatory-nodes-caption'],
                flex     : 1,
                reference: 'observatory-nodes-caption'
            }, {
                module   : Button,
                cls      : ['fm-observatory-nodes-clear'],
                flex     : 'none',
                hidden   : true,
                reference: 'observatory-nodes-filter-clear',
                text     : 'Clear filter',
                ui       : 'ghost'
            }]
        }]
    }

    /**
     * True while typed input awaits {@link #emitFilterChange}'s trailing buffer timer.
     * @member {Boolean} pendingFilter=false
     * @protected
     */
    pendingFilter = false
    /**
     * Guards programmatic field writes against re-emitting `filterChange`.
     * @member {Boolean} syncingFilter=false
     * @protected
     */
    syncingFilter = false

    /**
     * @summary The line beneath the controls: with an empty filter, today's order sentence; with an active filter,
     * what matched (`matching “…”` / `kind …`), `first N listed` only when matches exceed the budget, or why nothing
     * matched.
     * @param {'changed'|'relations'} order
     * @param {Object|null} counts `{listed, matched, total}`
     * @param {Object|null} [filter=null] `{query, kind}`
     * @returns {String}
     */
    static captionOf(order, counts, filter = null) {
        const {active, kind, query} = ObservatoryNodeList.normalizeFilter(filter);

        if (!active) {
            const days = ObservatorySceneLayout.attention.windowMs / 86400000;

            return [
                order === 'relations' ? 'by relations · most related first' : `changed in the last ${days} day${days === 1 ? '' : 's'} first · then by activity`,
                counts?.total > counts?.listed && 'relations reach the rest'
            ].filter(Boolean).join(' · ')
        }

        const
            listed  = counts?.listed ?? 0,
            matched = counts?.matched ?? listed,
            count   = value => value.toLocaleString('en-US');

        if (matched === 0) {
            if (query && kind) {
                return `No ${kind} nodes match “${query}”`
            }

            return query ? `No nodes match “${query}”` : `No ${kind} nodes in this read`
        }

        return [
            query && `matching “${query}”`,
            kind && `kind ${kind}`,
            matched > listed && `first ${count(listed)} listed`
        ].filter(Boolean).join(' · ')
    }

    /**
     * @summary The title: when filtered, `Nodes · <matched> of <total>`; when unfiltered, `Nodes · <listed> of <total>`
     * only while the list holds less than the read, and `Nodes` otherwise.
     * @param {Object|null} counts `{listed, matched, total}`
     * @param {Object|null} [filter=null] `{query, kind}`
     * @returns {String}
     */
    static titleOf(counts, filter = null) {
        if (!counts?.total) {
            return 'Nodes'
        }

        const count = value => value.toLocaleString('en-US');

        if (ObservatoryNodeList.hasFilter(filter)) {
            return `Nodes · ${count(counts.matched ?? counts.listed ?? 0)} of ${count(counts.total)}`
        }

        return counts.total > counts.listed ? `Nodes · ${count(counts.listed)} of ${count(counts.total)}` : 'Nodes'
    }

    /**
     * Wires the title, the order toggle, the buffered query field, the kind select, and `Clear filter`.
     */
    onConstructed() {
        super.onConstructed();

        const
            me         = this,
            queryField = me.getReference('observatory-nodes-query'),
            kindField  = me.getReference('observatory-nodes-kind');

        queryField.changeInputElKey('aria-label', 'Filter nodes by label or id');
        queryField.on({clear: me.flushFilter, userChange: me.onQueryUserChange, scope: me});
        kindField .on({userChange: me.flushFilter, scope: me});

        me.getReference('observatory-nodes-title')       .set({handler: () => me.fire('sectionHeadClick', {section: 'nodes'}), handlerScope: me});
        me.getReference('observatory-nodes-order')       .set({handler: () => me.fire('orderChange', {order: me.order === 'relations' ? 'changed' : 'relations'}), handlerScope: me});
        me.getReference('observatory-nodes-filter-clear').set({handler: () => me.onClearFilterClick(), handlerScope: me});
        me.applyHead()
    }

    /**
     * Triggered after the counts config got changed: the title, controls and detail line follow.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetCounts(value, oldValue) {
        oldValue !== undefined && this.applyHead()
    }

    /**
     * Triggered after the filter config got changed: syncs the inputs when driven externally and updates the head.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetFilter(value, oldValue) {
        if (oldValue === undefined) {
            return
        }

        const
            me         = this,
            queryField = me.getReference('observatory-nodes-query'),
            kindField  = me.getReference('observatory-nodes-kind'),
            nextQuery  = value?.query || null,
            nextKind   = value?.kind || null;

        me.syncingFilter = true;
        queryField && !me.pendingFilter && queryField.value !== nextQuery && (queryField.value = nextQuery);
        kindField  && kindField.value !== nextKind && (kindField.value = nextKind);
        me.syncingFilter = false;

        me.applyHead()
    }

    /**
     * Triggered after the kinds config got changed: refreshes the kind select's options only when the set changed.
     * @param {String[]} value
     * @param {String[]} oldValue
     * @protected
     */
    afterSetKinds(value, oldValue) {
        if (oldValue === undefined) {
            return
        }

        const
            kindField = this.getReference('observatory-nodes-kind'),
            next      = Array.isArray(value) ? value : [],
            prev      = Array.isArray(oldValue) ? oldValue : [];

        if (kindField && (next.length !== prev.length || next.some((item, i) => item !== prev[i]))) {
            kindField.options = next
        }
    }

    /**
     * Triggered after the order config got changed: the toggle and the words follow.
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetOrder(value, oldValue) {
        oldValue !== undefined && this.applyHead()
    }

    /**
     * @summary Writes the title, the filter row's visibility, the toggle's pressed state, the detail caption, and
     * `Clear filter` on a zero-match state.
     * @protected
     */
    applyHead() {
        const
            me           = this,
            {counts, filter, order} = me,
            hasFilter    = ObservatoryNodeList.hasFilter(filter),
            showControls = Boolean(counts?.total || hasFilter),
            noMatch      = hasFilter && Boolean(counts?.total) && (counts.matched ?? counts.listed ?? 0) === 0,
            toggle       = me.getReference('observatory-nodes-order');

        me.getReference('observatory-nodes-title')       .text   = ObservatoryNodesHeadContainer.titleOf(counts, filter);
        me.getReference('observatory-nodes-filter-row')  .hidden = !showControls;
        me.getReference('observatory-nodes-detail')      .hidden = !showControls;
        me.getReference('observatory-nodes-caption')     .set({hidden: !showControls, text: ObservatoryNodesHeadContainer.captionOf(order, counts, filter)});
        me.getReference('observatory-nodes-filter-clear').hidden = !noMatch;

        toggle.pressed               = order === 'relations';
        toggle.vdom['aria-pressed'] = String(toggle.pressed);
        toggle.update()
    }

    /**
     * @summary Buffered emission of `filterChange` after typing settles.
     */
    emitFilterChange() {
        this.pendingFilter = false;
        this.fire('filterChange', {filter: this.readFilter()})
    }

    /**
     * @summary Cancels any pending buffer timer and emits `filterChange` synchronously.
     */
    flushFilter() {
        if (this.syncingFilter) {
            return
        }

        this.emitFilterChange.cancel?.();
        this.pendingFilter = false;
        this.fire('filterChange', {filter: this.readFilter()})
    }

    /**
     * @summary `Clear filter` resets both inputs and restores the unfiltered budgeted list immediately.
     */
    onClearFilterClick() {
        const me = this;

        me.emitFilterChange.cancel?.();
        me.pendingFilter = false;
        me.syncingFilter = true;
        me.getReference('observatory-nodes-query').value = null;
        me.getReference('observatory-nodes-kind') .value = null;
        me.syncingFilter = false;
        me.fire('filterChange', {filter: null})
    }

    /**
     * @summary `ArrowDown` on the title or query field flushes any pending typed query before entering row `0`.
     */
    onDownIntoList() {
        this.pendingFilter && this.flushFilter();
        this.fire('listEnter')
    }

    /**
     * @summary Buffers non-empty typing outside the keystroke; flushes immediately when cleared to empty.
     * @param {Object} data
     * @param {String|null} data.value
     */
    onQueryUserChange({value}) {
        if (this.syncingFilter) {
            return
        }

        if (value) {
            this.pendingFilter = true;
            this.emitFilterChange()
        } else {
            this.flushFilter()
        }
    }

    /**
     * @summary Reads `{kind, query}` from the controls, returning `null` when both are empty.
     * @returns {Object|null}
     */
    readFilter() {
        const
            query = this.getReference('observatory-nodes-query')?.value ?? '',
            kind  = this.getReference('observatory-nodes-kind')?.value ?? null;

        return ObservatoryNodeList.hasFilter({kind, query}) ? {kind, query} : null
    }
}

export default Neo.setupClass(ObservatoryNodesHeadContainer);
