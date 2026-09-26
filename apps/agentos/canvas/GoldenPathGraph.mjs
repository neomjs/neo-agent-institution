import Base                  from '../../../node_modules/neo.mjs/src/canvas/Base.mjs';
import GoldenPathGraphLayout from '../util/GoldenPathGraphLayout.mjs';
import {PALETTES}            from './fmPalette.mjs';

/**
 * The type roles the graph writes with — the §04 ladder's body and micro roles, on the stacks
 * the tokens resolve to (a worker has no font token to bind).
 * @type {Object}
 */
const FONTS = {
    label: '11px ui-sans-serif, system-ui, sans-serif',
    micro: '10px ui-monospace, SFMono-Regular, Menlo, monospace',
    rank : '600 11px ui-sans-serif, system-ui, sans-serif'
};

/**
 * @summary The Golden Path graph renderer — runs on the canvas worker and only draws. The App
 * Worker hands it the `fleetGoldenPath` envelope; the pure layout turns that into nodes and edges
 * for the current surface; this class paints them in the theme's ink and answers a hover with the
 * item's title, rank and score. Nothing is ranked, merged or animated here: one frame per change
 * (envelope, size, theme, pointer), no loop.
 *
 * The picture's tone is the cockpit's currency: a current route draws its spine in the signal, a
 * withheld one — the last known good route — in dim ink, and degraded, unavailable or unobserved
 * states draw nothing but leave the surface clean — the currency line above the canvas says why.
 *
 * @class AgentOS.canvas.GoldenPathGraph
 * @extends Neo.canvas.Base
 * @singleton
 */
class GoldenPathGraph extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.canvas.GoldenPathGraph'
         * @protected
         */
        className: 'AgentOS.canvas.GoldenPathGraph',
        /**
         * Remote method access — the base's lifecycle set plus the one data entry.
         * @member {Object} remote
         * @protected
         */
        remote: {
            app: [
                'clearGraph',
                'initGraph',
                'pause',
                'resume',
                'setEnvelope',
                'setTheme',
                'updateMouseState',
                'updateSize'
            ]
        },
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true
    }

    /**
     * The last envelope the App Worker handed over; `null` draws the empty surface.
     * @member {Object|null} envelope=null
     */
    envelope = null
    /**
     * The layout for the current envelope and surface, or `null` before the canvas is sized.
     * @member {Object|null} layout=null
     */
    layout = null

    /**
     * @summary Forgets the envelope and the layout with the canvas.
     */
    clearGraph() {
        super.clearGraph();
        this.envelope = null;
        this.layout   = null
    }

    /**
     * @summary Paints one frame: edges, then citations, then the spine, then the hover label.
     * Clears to transparent so the pane's ground shows through.
     * @protected
     */
    draw() {
        const
            me           = this,
            {context, layout} = me;

        if (!context || !me.canvasSize) {
            return
        }

        const
            {width, height} = me.canvasSize,
            palette         = PALETTES[me.theme] || PALETTES.dark;

        context.clearRect(0, 0, width, height);

        if (!layout || layout.empty) {
            return
        }

        const
            dim    = layout.currency !== 'current',
            byId   = new Map(layout.nodes.map(node => [node.id, node])),
            hover  = me.hoveredItem();

        // edges: citation lines, soft, under everything
        context.lineWidth   = 1;
        context.strokeStyle = palette.lineSoft;

        layout.edges.forEach(({from, to}) => {
            const a = byId.get(from), b = byId.get(to);

            if (a && b) {
                context.beginPath();
                context.moveTo(a.x, a.y);
                context.lineTo(b.x, b.y);
                context.stroke()
            }
        });

        // the spine's connective line, so rank order reads as a path
        const items = layout.nodes.filter(node => node.kind === 'item');

        if (items.length > 1) {
            context.strokeStyle = palette.line;
            context.beginPath();
            context.moveTo(items[0].x, items[0].y);
            items.slice(1).forEach(node => context.lineTo(node.x, node.y));
            context.stroke()
        }

        // citations: small quiet marks with their id below
        context.font         = FONTS.micro;
        context.textAlign    = 'center';
        context.textBaseline = 'top';

        layout.nodes.filter(node => node.kind === 'citation').forEach(node => {
            context.beginPath();
            context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
            context.fillStyle   = palette.panel2;
            context.strokeStyle = palette.line;
            context.fill();
            context.stroke();
            context.fillStyle = palette.inkDim;
            context.fillText(node.label, node.x, node.y + node.r + 4)
        });

        // items: weighted circles on the spine, the rank inside, the title above
        items.forEach(node => {
            const lead = node.rank === 1;

            context.beginPath();
            context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
            context.fillStyle   = dim ? palette.panel2 : (lead ? palette.signal : palette.panel);
            context.strokeStyle = dim ? palette.inkDim : palette.signal;
            context.lineWidth   = node === hover ? 3 : 2;
            context.fill();
            context.stroke();

            // the producer's rank inside the circle; none given, none drawn
            if (node.rank !== null) {
                context.font         = FONTS.rank;
                context.textAlign    = 'center';
                context.textBaseline = 'middle';
                context.fillStyle    = dim ? palette.inkDim : (lead ? palette.panel : palette.ink);
                context.fillText(String(node.rank), node.x, node.y)
            }

            context.font         = FONTS.label;
            context.textBaseline = 'bottom';
            context.fillStyle    = dim ? palette.inkDim : palette.ink;

            const
                title = me.fitLabel(context, node.label, me.labelWidth(items, node)),
                half  = context.measureText(title).width / 2;

            // a title centred on an edge item would leave the surface: keep it inside, 4 px in
            context.fillText(title, Math.max(half + 4, Math.min(width - half - 4, node.x)), node.y - node.r - 6)
        });

        hover && me.drawHover(context, hover, palette, width)
    }

    /**
     * @summary The hover label: the item's whole title with its rank and score, in a panel above the pointer.
     * @param {OffscreenCanvasRenderingContext2D} context
     * @param {Object} node The hovered item node.
     * @param {Object} palette
     * @param {Number} width The surface width, to keep the label on it.
     * @protected
     */
    drawHover(context, node, palette, width) {
        const
            text = `${node.label} · rank ${node.rank}${typeof node.score === 'number' ? ` · score ${node.score}` : ''}`,
            pad  = 8;

        context.font = FONTS.label;

        const
            w = Math.min(context.measureText(text).width + pad * 2, width - 8),
            h = 24,
            x = Math.max(4, Math.min(width - w - 4, node.x - w / 2)),
            // clear of the item's own title line (bottom at r + 6 above the node, one label tall)
            y = Math.max(4, node.y - node.r - 48);

        context.fillStyle   = palette.panel;
        context.strokeStyle = palette.line;
        context.lineWidth   = 1;
        context.beginPath();
        context.roundRect ? context.roundRect(x, y, w, h, 4) : context.rect(x, y, w, h);
        context.fill();
        context.stroke();

        context.fillStyle    = palette.ink;
        context.textAlign    = 'left';
        context.textBaseline = 'middle';
        context.fillText(this.fitLabel(context, text, w - pad * 2), x + pad, y + h / 2)
    }

    /**
     * @summary Truncates a label with an ellipsis to the width it may take.
     * @param {OffscreenCanvasRenderingContext2D} context
     * @param {String} text
     * @param {Number} maxWidth
     * @returns {String}
     * @protected
     */
    fitLabel(context, text, maxWidth) {
        if (context.measureText(text).width <= maxWidth) {
            return text
        }

        let end = text.length;

        while (end > 1 && context.measureText(`${text.slice(0, end)}…`).width > maxWidth) {
            end--
        }

        return `${text.slice(0, end)}…`
    }

    /**
     * @summary The item node under the pointer, if any: the first whose circle (plus a small grace
     * band) contains the last reported position.
     * @returns {Object|null}
     * @protected
     */
    hoveredItem() {
        const {layout, mouse} = this;

        if (!layout || layout.empty || mouse.x < 0) {
            return null
        }

        return layout.nodes.find(node => node.kind === 'item' && Math.hypot(node.x - mouse.x, node.y - mouse.y) <= node.r + 4) || null
    }

    /**
     * @summary The width one item's title may take: the spine spacing minus a gutter, or half the
     * surface for a lone item.
     * @param {Object[]} items The spine's item nodes in order.
     * @param {Object} node
     * @returns {Number}
     * @protected
     */
    labelWidth(items, node) {
        const spacing = items.length > 1 ? Math.abs(items[1].x - items[0].x) : this.canvasSize.width / 2;

        return Math.max(40, spacing - 12)
    }

    /**
     * @summary Recomputes the layout for the current envelope and surface through the pure module.
     * @protected
     */
    relayout() {
        const me = this;

        me.layout = me.canvasSize ? GoldenPathGraphLayout.layout(me.envelope, {width: me.canvasSize.width, height: me.canvasSize.height}) : null
    }

    /**
     * @summary The base's frame entry: one frame, no loop.
     */
    render() {
        this.draw()
    }

    /**
     * @summary Remote entry: the App Worker hands over the `fleetGoldenPath` envelope (or `null`).
     * @param {Object} data
     * @param {Object|null} data.envelope
     * @param {String} [data.windowId]
     */
    setEnvelope({envelope}) {
        const me = this;

        me.envelope = envelope ?? null;
        me.relayout();
        me.draw()
    }

    /**
     * @summary Pointer reports redraw for the hover label; the base keeps the state.
     * @param {Object} data
     */
    updateMouseState(data) {
        super.updateMouseState(data);
        this.draw()
    }

    /**
     * @summary Size and theme changes re-lay the picture out on the new surface.
     * @param {Number} width
     * @param {Number} height
     */
    updateResources(width, height) {
        this.relayout();
        this.draw()
    }
}

export default Neo.setupClass(GoldenPathGraph);
