import Button              from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container           from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GraphSceneWells     from '../../../store/GraphSceneWells.mjs';
import ObservatoryWellList from './ObservatoryWellList.mjs';

/**
 * @summary The Observatory's Wells section: every well the canvas labels, the largest first, under a head that counts
 * them. The pane hands the section the scene's wells through {@link #sync}. A row the viewer clicks, or the keys land
 * on, is reported as `wellSelect`, and the pane turns the camera to it; the head reports `sectionHeadClick`, as every
 * section's head does.
 * @class AgentOS.view.fleet.goldenpath.ObservatoryWellsContainer
 * @extends Neo.container.Base
 */
class ObservatoryWellsContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryWellsContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryWellsContainer',
        /**
         * @member {String} ntype='fm-observatory-wells'
         * @protected
         */
        ntype: 'fm-observatory-wells',
        /**
         * @member {String[]} baseCls=['fm-observatory-wells']
         */
        baseCls: ['fm-observatory-wells'],
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The head, then the wells.
         * @member {Object[]} items
         */
        items: [{
            module   : Button,
            cls      : ['fm-observatory-side-title', 'fm-observatory-section-head'],
            flex     : 'none',
            reference: 'observatory-wells-title',
            text     : 'Wells',
            ui       : 'ghost'
        }, {
            module   : ObservatoryWellList,
            flex     : 1,
            reference: 'observatory-well-list'
        }]
    }

    /**
     * The listed wells, one record each, by their hub's id.
     * @member {AgentOS.store.GraphSceneWells|null} wellStore=null
     */
    wellStore = null

    /**
     * The store exists before the items take it.
     * @param {Object} config
     */
    construct(config) {
        this.wellStore = Neo.create(GraphSceneWells);
        super.construct(config)
    }

    /**
     * The list takes its store and reports its rows; the head reports its clicks.
     */
    onConstructed() {
        super.onConstructed();

        const me = this, list = me.getReference('observatory-well-list');

        list.store = me.wellStore;
        list.on('itemClick', me.onWellClick, me);
        me.getReference('observatory-wells-title').set({handler: 'onSectionHeadClick', handlerScope: me})
    }

    /**
     * The store goes after the list that renders it.
     * @param {...*} args
     */
    destroy(...args) {
        const {wellStore} = this;

        super.destroy(...args);
        wellStore?.destroy()
    }

    /**
     * @summary The head was clicked: the pane opens the section.
     */
    onSectionHeadClick() {
        this.fire('sectionHeadClick', {section: 'wells'})
    }

    /**
     * @summary A row was clicked, or the keys landed on it: the pane turns the camera to that well.
     * @param {Object} data
     * @param {AgentOS.model.GraphSceneWell} data.record
     */
    onWellClick({record}) {
        record && this.fire('wellSelect', {id: record.id})
    }

    /**
     * @summary Lists a scene's wells, the largest first, each `full` once the strategic walk's cap stopped it, and
     * counts them in the head.
     * @param {Object} scene A {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene} scene
     * @param {Number|null} scene.wellCap The strategic walk's cap, `null` for density wells
     * @param {Object[]} scene.wells `{id, label, size}` per well, largest first
     */
    sync({wellCap, wells}) {
        const {wellStore} = this;

        wellStore.clear();
        wells.length && wellStore.add(wells.map(({id, label, size}) => ({id, label, size, full: wellCap !== null && size >= wellCap})));

        this.getReference('observatory-wells-title').text = wells.length ? `Wells · ${wells.length}` : 'Wells'
    }
}

export default Neo.setupClass(ObservatoryWellsContainer);
