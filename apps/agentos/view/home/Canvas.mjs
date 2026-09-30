import SharedCanvas from '../../../../node_modules/neo.mjs/src/app/SharedCanvas.mjs';

/**
 * @summary The App Worker half of Home's field: an offscreen canvas handed to the canvas worker's
 * {@link AgentOS.canvas.Home} renderer. It draws nothing itself: it forwards the team the roster read answers, whether
 * the field is still, the surface size and the pointer, which the Home view hands on from its whole surface so the
 * field answers the pointer over the hero's lines too. Both inputs are reactive configs, and each crosses to the
 * worker alone; a canvas that becomes ready receives both.
 *
 * Stillness is the motion vocabulary's own verdict: `--motion-base` collapses to `0ms` under
 * `prefers-reduced-motion: reduce` (`resources/scss/_motion.scss`), and the canvas reads it from its node each time
 * it mounts. Every mount starts still, and a read that fails or answers nothing keeps it still.
 *
 * @class AgentOS.view.home.Canvas
 * @extends Neo.app.SharedCanvas
 */
class Canvas extends SharedCanvas {
    static config = {
        /**
         * @member {String} className='AgentOS.view.home.Canvas'
         * @protected
         */
        className: 'AgentOS.view.home.Canvas',
        /**
         * @member {String} ntype='fm-home-canvas'
         * @protected
         */
        ntype: 'fm-home-canvas',
        /**
         * @member {String[]} cls=['fm-home-canvas']
         */
        cls: ['fm-home-canvas'],
        /**
         * @member {String} rendererClassName='AgentOS.canvas.Home'
         */
        rendererClassName: 'AgentOS.canvas.Home',
        /**
         * The canvas worker imports renderers relative to the engine package (`../../<path>` from `src/worker/`),
         * so a workspace app climbs out of `node_modules/neo.mjs` first.
         * @member {String} rendererImportPath='../../apps/agentos/canvas/Home.mjs'
         */
        rendererImportPath: '../../apps/agentos/canvas/Home.mjs',
        /**
         * The ids of the components the field stays out of: the hero's lines, which the Home view names.
         * @member {String[]} quietIds=[]
         */
        quietIds: [],
        /**
         * Whether the field is still: `true` until the current mount's read of the motion vocabulary says the host
         * allows motion. Every unmount returns it to `true`, so a new mount never inherits the last one's answer.
         * @member {Boolean} still_=true
         * @reactive
         */
        still_: true,
        /**
         * The team the roster read answers, `{total, up}`, or `null` while it has not answered live.
         * @member {Object|null} team_=null
         * @reactive
         */
        team_: null
    }

    /**
     * Counts the motion reads, so that only the latest read of the current mount may answer.
     * @member {Number} motionRead=0
     * @protected
     */
    motionRead = 0
    /**
     * Counts the quiet measurements, so that only the latest one may answer.
     * @member {Number} quietRead=0
     * @protected
     */
    quietRead = 0

    /**
     * Triggered after the isCanvasReady config got changed: a ready canvas receives both inputs.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetIsCanvasReady(value, oldValue) {
        const me = this;

        super.afterSetIsCanvasReady(value, oldValue);

        if (value && me.renderer) {
            me.renderer.setMotion({still: me.still, windowId: me.windowId});
            me.renderer.setTeam({team: me.team, windowId: me.windowId})
        }
    }

    /**
     * Triggered after the mounted config got changed: every mount reads the host's motion preference again, and
     * every unmount returns the field to still and outdates a read still in flight.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    async afterSetMounted(value, oldValue) {
        const me = this;

        if (!value) {
            me.motionRead++;
            me.still = true
        }

        await super.afterSetMounted(value, oldValue);
        value && me.readMotion()
    }

    /**
     * Triggered after the still config got changed.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetStill(value, oldValue) {
        const me = this;

        me.isCanvasReady && me.renderer?.setMotion({still: value, windowId: me.windowId})
    }

    /**
     * Triggered after the team config got changed.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetTeam(value, oldValue) {
        const me = this;

        me.isCanvasReady && me.renderer?.setTeam({team: value, windowId: me.windowId})
    }

    /**
     * @summary The renderer's statistics, as the specs read them; `null` before the canvas is ready.
     * @returns {Promise<Object|null>} `{frames, marks, motes, size, still, theme}`
     */
    async readStats() {
        const me = this;

        return me.isCanvasReady && me.renderer ? me.renderer.getStats({windowId: me.windowId}) : null
    }

    /**
     * @summary Measures the quiet components one frame after the call, so a line the Home view just changed has its
     * new box, and hands the renderer their rects relative to the canvas. Only the latest measurement answers.
     * @returns {Promise<void>}
     */
    async measureQuiet() {
        const me = this, read = ++me.quietRead;

        await me.timeout(30);

        if (read !== me.quietRead || !me.isCanvasReady || !me.canvasRect || !me.quietIds.length || me.isDestroyed) {
            return
        }

        const rects = await me.getDomRect(me.quietIds), {x, y} = me.canvasRect;

        if (read === me.quietRead && me.isCanvasReady && !me.isDestroyed) {
            me.renderer.setQuiet({
                rects   : (rects || []).filter(Boolean).map(rect => ({height: rect.height, width: rect.width, x: rect.x - x, y: rect.y - y})),
                windowId: me.windowId
            })
        }
    }

    /**
     * @summary Reads `--motion-base` from the canvas's node through its own window: `0ms`, the reduced-motion
     * collapse, keeps the field still, and so does a read that fails or answers nothing. Only the latest read of the
     * current mount answers: a newer read or an unmount outdates it, so a late answer never moves a later mount.
     * @returns {Promise<void>}
     */
    async readMotion() {
        const me = this, read = ++me.motionRead;

        let value = '';

        try {
            const styles = await Neo.main.DomAccess.getComputedStyle({id: me.id, style: '--motion-base', windowId: me.windowId});

            value = styles?.['--motion-base']?.trim() ?? ''
        } catch {}

        if (read === me.motionRead && me.mounted && !me.isDestroyed) {
            me.still = !value || parseFloat(value) === 0
        }
    }

    /**
     * @summary Measures the node's viewport rect on every report. The Home view hands the pointer on in client
     * coordinates, and a ResizeObserver report's contentRect has its origin at 0,0, which would offset every
     * pointer by the canvas's place in the window.
     * @param {Object|null} [rect] Not used: the node is measured
     * @returns {Promise<void>}
     */
    async updateSize(rect) {
        await super.updateSize(null);
        this.measureQuiet()
    }
}

export default Neo.setupClass(Canvas);
