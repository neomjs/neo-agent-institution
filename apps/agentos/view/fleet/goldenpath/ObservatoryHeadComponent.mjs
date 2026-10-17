import Component from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';

/**
 * The gesture hint the hover slot shows while the pointer rests on no node.
 * @type {String}
 */
const HOVER_HINT = 'drag orbits · wheel zooms · click selects';

/**
 * @summary The Observatory's head: the view's title, the node under the pointer, and the read's line, which opens
 * with the team's sentence ({@link AgentOS.util.ObservatoryBrief#line}) and keeps the renderer's counts behind a
 * `Details` disclosure. The attention item is a link that selects its node (`attentionSelect`). Whether Details is
 * open is session view state, held here and never persisted. The owning
 * {@link AgentOS.view.fleet.goldenpath.ObservatoryContainer} writes every fact; this head renders them.
 * @class AgentOS.view.fleet.goldenpath.ObservatoryHeadComponent
 * @extends Neo.component.Base
 */
class ObservatoryHeadComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryHeadComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryHeadComponent',
        /**
         * @member {String} ntype='fm-observatory-head'
         * @protected
         */
        ntype: 'fm-observatory-head',
        /**
         * @member {String[]} baseCls=['fm-observatory-head']
         */
        baseCls: ['fm-observatory-head'],
        /**
         * The read's first line, `{attention, lead, tail}` ({@link AgentOS.util.ObservatoryBrief#line}).
         * @member {Object|null} brief_=null
         * @reactive
         */
        brief_: null,
        /**
         * The read's complete words: the renderer's counts and the overlays' words, revealed by `Details`. The
         * disclosure shows only while they say more than the line.
         * @member {String|null} details_=null
         * @reactive
         */
        details_: null,
        /**
         * Whether Details is open: session view state.
         * @member {Boolean} detailsOpen_=false
         * @reactive
         */
        detailsOpen_: false,
        /**
         * The node under the pointer, as one line; `null` shows the gesture hint.
         * @member {String|null} hover_=null
         * @reactive
         */
        hover_: null,
        /**
         * The view's title and the geography it drew.
         * @member {String} title_='Observatory'
         * @reactive
         */
        title_: 'Observatory',
        /**
         * @member {Object} vdom
         */
        vdom: {cn: [
            {tag: 'span', cls: ['fm-observatory-title']},
            {tag: 'span', cls: ['fm-observatory-hover', 'is-hint']},
            {tag: 'span', cls: ['fm-observatory-currency']},
            {tag: 'button', type: 'button', cls: ['fm-observatory-details-toggle'], 'aria-expanded': 'false', text: 'Details'},
            {tag: 'span', cls: ['fm-observatory-details'], hidden: true}
        ]}
    }

    /**
     * @summary Wires the two links and renders whatever was set before construction.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const me = this;

        me.addDomListeners([
            {click: me.onAttentionClick, delegate: '.fm-observatory-attention', scope: me},
            {click: me.onDetailsClick,   delegate: '.fm-observatory-details-toggle', scope: me}
        ]);
        me.applyHead()
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetBrief(value, oldValue) {
        this.isConstructed && this.applyHead()
    }

    /**
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetDetails(value, oldValue) {
        this.isConstructed && this.applyHead()
    }

    /**
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetDetailsOpen(value, oldValue) {
        this.isConstructed && this.applyHead()
    }

    /**
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetHover(value, oldValue) {
        this.isConstructed && this.applyHead()
    }

    /**
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetTitle(value, oldValue) {
        this.isConstructed && this.applyHead()
    }

    /**
     * @summary The attention item was clicked: its node is asked for.
     * @protected
     */
    onAttentionClick() {
        const id = this.brief?.attention?.id;

        id && this.fire('attentionSelect', {id})
    }

    /**
     * @summary The disclosure was clicked: Details opens or folds.
     * @protected
     */
    onDetailsClick() {
        this.detailsOpen = !this.detailsOpen
    }

    /**
     * @summary Writes the facts into the head's five slots in one update.
     * @protected
     */
    applyHead() {
        const
            me                                         = this,
            [title, hover, line, toggle, details]      = me.vdom.cn,
            {attention = null, lead = '', tail = null} = me.brief ?? {},
            more                                       = Boolean(me.details) && me.details !== lead,
            open                                       = me.detailsOpen && more;

        title.text = me.title;

        Object.assign(hover, {cls: ['fm-observatory-hover', ...(me.hover ? [] : ['is-hint'])], text: me.hover ?? HOVER_HINT});

        line.cn = [
            {tag: 'span', text: lead},
            ...(attention ? [{tag: 'span', text: ' · attention: '}, {tag: 'button', type: 'button', cls: ['fm-observatory-attention'], title: attention.title, text: attention.text}] : []),
            ...(tail ? [{tag: 'span', text: ` · ${tail}`}] : [])
        ];

        Object.assign(toggle, {'aria-expanded': String(open), removeDom: !more});
        // folded, the counts stay in the DOM, hidden: their words remain readable to a test or a screen reader's find
        Object.assign(details, {hidden: open ? null : true, text: me.details ?? ''});

        me.update()
    }
}

export default Neo.setupClass(ObservatoryHeadComponent);
