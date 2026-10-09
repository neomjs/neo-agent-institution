import Button                 from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container              from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import ObservatorySceneLayout from '../../../util/ObservatorySceneLayout.mjs';

/**
 * @summary The head of the Observatory's Nodes section: the title with how much of the read the list holds and the
 * toggle between the list's two orders on the chrome line, and beneath them the order in words, in the detail role.
 * The title fires `sectionHeadClick` and the toggle `orderChange`; the pane owns both choices and writes back
 * {@link #order} and {@link #counts}. A collapsed section keeps only the chrome line (`ObservatoryContainer.scss`).
 * @class AgentOS.view.fleet.goldenpath.ObservatoryNodesHeadContainer
 * @extends Neo.container.Base
 */
class ObservatoryNodesHeadContainer extends Container {
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
         * How much of the read the list holds, `{listed, total}`; `null` until a read lands.
         * @member {Object|null} counts_=null
         * @reactive
         */
        counts_: null,
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
         * The chrome line (the title, then the order's toggle), then the order in words.
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
            ntype    : 'component',
            cls      : ['fm-observatory-nodes-caption'],
            flex     : 'none',
            hidden   : true,
            reference: 'observatory-nodes-caption'
        }]
    }

    /**
     * @summary The order in words: what leads, and, where the list holds less than the read, that relations reach
     * the rest.
     * @param {'changed'|'relations'} order
     * @param {Object|null} counts `{listed, total}`
     * @returns {String}
     */
    static captionOf(order, counts) {
        const days = ObservatorySceneLayout.attention.windowMs / 86400000;

        return [
            order === 'relations' ? 'by relations · most related first' : `changed in the last ${days} day${days === 1 ? '' : 's'} first · then by activity`,
            counts?.total > counts?.listed && 'relations reach the rest'
        ].filter(Boolean).join(' · ')
    }

    /**
     * @summary The title: the section's word, and how much of the read the list holds when it holds less.
     * @param {Object|null} counts `{listed, total}`
     * @returns {String}
     */
    static titleOf(counts) {
        const count = value => value.toLocaleString('en-US');

        return counts?.total > counts?.listed ? `Nodes · ${count(counts.listed)} of ${count(counts.total)}` : 'Nodes'
    }

    /**
     * The title asks the pane to open the section, the toggle to flip the order.
     */
    onConstructed() {
        super.onConstructed();

        const me = this;

        me.getReference('observatory-nodes-title').set({handler: () => me.fire('sectionHeadClick', {section: 'nodes'}), handlerScope: me});
        me.getReference('observatory-nodes-order').set({handler: () => me.fire('orderChange', {order: me.order === 'relations' ? 'changed' : 'relations'}), handlerScope: me});
        me.applyHead()
    }

    /**
     * Triggered after the counts config got changed: the title and the words follow.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetCounts(value, oldValue) {
        oldValue !== undefined && this.applyHead()
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
     * @summary Writes the title, the toggle's pressed state for the eye and for assistive technology, and the order
     * in words, which a list without nodes does not need.
     * @protected
     */
    applyHead() {
        const me = this, {counts, order} = me, toggle = me.getReference('observatory-nodes-order');

        me.getReference('observatory-nodes-title').text = ObservatoryNodesHeadContainer.titleOf(counts);
        me.getReference('observatory-nodes-caption').set({hidden: !counts?.total, text: ObservatoryNodesHeadContainer.captionOf(order, counts)});

        toggle.pressed               = order === 'relations';
        toggle.vdom['aria-pressed'] = String(toggle.pressed);
        toggle.update()
    }
}

export default Neo.setupClass(ObservatoryNodesHeadContainer);
