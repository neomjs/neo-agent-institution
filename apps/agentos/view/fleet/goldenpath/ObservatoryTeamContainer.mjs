import Button              from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container           from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GraphScenePeers     from '../../../store/GraphScenePeers.mjs';
import ObservatoryPeerList from './ObservatoryPeerList.mjs';

/**
 * @summary The Observatory's Team section: the team lens's peers as a list of checks under a head that counts the
 * team among them. It offers the team the read names ({@link #peerScope}), busiest first, or with All everyone the
 * read attributes nodes to; a checked peer is listed either way, so a check is never hidden, and an outsider leaves
 * Team with its check. A read that names no identity lists everyone and says so. Clear unchecks every peer.
 *
 * The pane owns the lens: it hands the section the scene's peers, each with its hue, and the checked identities in
 * check order through {@link #sync}, and the section reports the viewer's checks as `lensChange`.
 * @class AgentOS.view.fleet.goldenpath.ObservatoryTeamContainer
 * @extends Neo.container.Base
 */
class ObservatoryTeamContainer extends Container {
    /**
     * Valid values for {@link #peerScope}.
     * @member {String[]} peerScopes=['all', 'team']
     * @protected
     * @static
     */
    static peerScopes = ['all', 'team']

    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryTeamContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryTeamContainer',
        /**
         * @member {String} ntype='fm-observatory-team'
         * @protected
         */
        ntype: 'fm-observatory-team',
        /**
         * @member {String[]} baseCls=['fm-observatory-team']
         */
        baseCls: ['fm-observatory-team'],
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The head (the title, the lens's Clear, the scope's All), then the peers.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'container',
            cls      : ['fm-pane-actions', 'fm-observatory-peers-head'],
            flex     : 'none',
            layout   : {ntype: 'hbox', align: 'center'},
            reference: 'observatory-peers-head',
            items    : [{
                module   : Button,
                cls      : ['fm-observatory-side-title', 'fm-observatory-section-head'],
                flex     : 1,
                reference: 'observatory-peers-title',
                text     : 'Team',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                hidden   : true,
                reference: 'lens-clear',
                text     : 'Clear',
                tooltip  : 'Uncheck every peer, so the scene takes its own colours again',
                ui       : 'ghost'
            }, {
                module   : Button,
                flex     : 'none',
                reference: 'peer-scope-toggle',
                text     : 'All',
                ui       : 'ghost'
            }]
        }, {
            module   : ObservatoryPeerList,
            flex     : 1,
            reference: 'observatory-peers'
        }],
        /**
         * Who the list offers: `team`, the peers the read holds an identity for, or `all`, everyone the read
         * attributes nodes to. All flips it.
         * @member {String} peerScope_='team'
         * @reactive
         */
        peerScope_: 'team'
    }

    /**
     * The checked identities in check order, as the pane last handed them.
     * @member {String[]} lensPeers=[]
     */
    lensPeers = []
    /**
     * Whether the read names its team (holds an identity node), as the pane last said.
     * @member {Boolean} named=false
     */
    named = false
    /**
     * The scene's peers as the pane last handed them: `{id, nodes, team, hue}`, busiest first.
     * @member {Object[]} peers=[]
     */
    peers = []
    /**
     * The listed peers, one record each, by identity.
     * @member {AgentOS.store.GraphScenePeers|null} peerStore=null
     */
    peerStore = null
    /**
     * True while the list gets its checks back, so the restore is not read as the viewer's choice.
     * @member {Boolean} restoringPeers=false
     */
    restoringPeers = false

    /**
     * The store exists before the items take it.
     * @param {Object} config
     */
    construct(config) {
        this.peerStore = Neo.create(GraphScenePeers);
        super.construct(config)
    }

    /**
     * The list takes its store and reports its checks; the head's controls report their clicks.
     */
    onConstructed() {
        super.onConstructed();

        const me = this, list = me.getReference('observatory-peers');

        list.store = me.peerStore;
        list.selectionModel.on('selectionChange', me.onPeerSelectionChange, me);
        me.getReference('lens-clear')       .set({handler: 'onClearClick', handlerScope: me});
        me.getReference('peer-scope-toggle').set({handler: 'onAllClick',   handlerScope: me});
        me.getReference('observatory-peers-title').set({handler: 'onSectionHeadClick', handlerScope: me});
        me.syncHead()
    }

    /**
     * @summary The title was clicked: `sectionHeadClick` asks the pane to open the Team section, which collapses
     * the others to their heads.
     */
    onSectionHeadClick() {
        this.fire('sectionHeadClick', {section: 'team'})
    }

    /**
     * The store goes after the list that renders it.
     * @param {...*} args
     */
    destroy(...args) {
        const {peerStore} = this;

        super.destroy(...args);
        peerStore?.destroy()
    }

    /**
     * Triggered after the peerScope config got changed: the list offers the team or everyone.
     * @param {String} value
     * @param {String|undefined} oldValue
     * @protected
     */
    afterSetPeerScope(value, oldValue) {
        oldValue !== undefined && this.fill()
    }

    /**
     * Triggered before the peerScope config gets changed: only a known scope applies.
     * @param {String} value
     * @param {String} oldValue
     * @returns {String|undefined}
     * @protected
     */
    beforeSetPeerScope(value, oldValue) {
        return this.beforeSetEnumValue(value, oldValue, 'peerScope', ObservatoryTeamContainer.peerScopes)
    }

    /**
     * @summary Fills the list in {@link #peerScope}, puts the checks back and writes the head. The title counts the
     * team among the peers, says when the read names no team, and says when the read attributes no node, so an
     * empty list is never read as a lens without peers to offer.
     * @protected
     */
    fill() {
        const
            me             = this,
            {named, peers} = me,
            listed         = me.listed(),
            count          = value => value.toLocaleString('en-US'),
            title          = me.getReference('observatory-peers-title');

        me.peerStore.clear();
        listed.length && me.peerStore.add(listed.map(({hue, id, nodes}) => ({hue, id, nodes})));

        title.text = !peers.length ? 'Team · no peer in this read'
            : !named ? 'Team · unknown, all listed'
            : `Team · ${count(peers.filter(peer => peer.team).length)} of ${count(peers.length)}`;

        me.syncChecks();
        me.syncHead()
    }

    /**
     * @summary The peers the list offers in {@link #peerScope}: the team and whoever the lens holds, or everyone.
     * @returns {Object[]} `{id, nodes, team, hue}`, busiest first
     * @protected
     */
    listed() {
        const {lensPeers, named, peers} = this;

        return named && this.peerScope === 'team' ? peers.filter(peer => peer.team || lensPeers.includes(peer.id)) : peers
    }

    /**
     * @summary All was clicked: the list offers everyone, or the team again.
     */
    onAllClick() {
        this.peerScope = this.peerScope === 'all' ? 'team' : 'all'
    }

    /**
     * @summary Clear was clicked: every peer is unchecked, which the pane applies as its lens.
     */
    onClearClick() {
        this.fire('lensChange', {lensPeers: []})
    }

    /**
     * @summary The viewer checked or unchecked a peer, and the lens keeps its check order: an unchecked peer
     * leaves it, a checked one joins its end, and a checked peer the list does not show keeps its place. A
     * restore is no choice. The pane owns the lens, so the section reports the new one as `lensChange`.
     * @param {Object}   data
     * @param {String[]} data.selection The checked rows' ids
     */
    onPeerSelectionChange({selection}) {
        const me = this, list = me.getReference('observatory-peers');

        if (!me.restoringPeers && list) {
            const
                checked = new Set(selection.map(itemId => me.peerStore.get(list.getItemRecordId(itemId))?.id).filter(Boolean)),
                kept    = me.lensPeers.filter(id => checked.has(id) || !me.peerStore.get(id));

            me.fire('lensChange', {lensPeers: [...kept, ...[...checked].filter(id => !kept.includes(id))]})
        }
    }

    /**
     * @summary Takes the pane's lens and peers. A new scene refills the list, and so does a lens that changes who
     * is listed: an outsider Team holds only while it is checked. Any other lens change only recolours the listed
     * rows and puts the checks back, so the list keeps its rows, its focus and its scroll.
     * @param {Object}   data
     * @param {String[]} data.lensPeers The checked identities, in check order
     * @param {Boolean}  data.named     Whether the read holds an identity node
     * @param {Object[]} data.peers     `{id, nodes, team, hue}`, busiest first
     * @param {Boolean}  data.refill    `true` for a new scene
     */
    sync({lensPeers, named, peers, refill}) {
        const me = this;

        Object.assign(me, {lensPeers, named, peers});

        const listed = me.listed(), rows = me.peerStore.items;

        if (refill || listed.length !== rows.length || listed.some((peer, at) => peer.id !== rows[at].id)) {
            me.fill();
            return
        }

        const hues = new Map(peers.map(({hue, id}) => [id, hue]));

        me.peerStore.items.forEach(record => record.set({hue: hues.get(record.id) ?? record.hue}));
        me.syncChecks();
        me.syncHead()
    }

    /**
     * @summary Puts the list's checks on the listed peers the lens holds, without reading the restore as the
     * viewer's choice.
     * @protected
     */
    syncChecks() {
        const me = this, model = me.getReference('observatory-peers')?.selectionModel;

        if (model) {
            const records = me.lensPeers.map(id => me.peerStore.get(id)).filter(Boolean);

            me.restoringPeers = true;

            try {
                model.deselectAll(true);
                records.length && model.select(records)
            } finally {
                me.restoringPeers = false
            }
        }
    }

    /**
     * @summary Shows the head's state: All pressed while everyone is listed, for the eye and for assistive
     * technology as the View section's controls are, and disabled with its reason while the read names no team;
     * Clear only while the lens holds a peer.
     * @protected
     */
    syncHead() {
        const me = this, all = me.getReference('peer-scope-toggle'), pressed = !me.named || me.peerScope === 'all';

        all.set({
            disabled: !me.named,
            pressed,
            tooltip : me.named
                ? 'List everyone the read attributes nodes to, not only the team'
                : 'The read names no team, so everyone is listed'
        });
        all.vdom['aria-pressed'] = String(pressed);
        all.update();

        me.getReference('lens-clear').hidden = !me.lensPeers.length
    }
}

export default Neo.setupClass(ObservatoryTeamContainer);
