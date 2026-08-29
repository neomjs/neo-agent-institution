import Component from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';

/**
 * @summary The per-viewer wake-push telltale — MY push lane's health, a different axis from the
 * spine banner (fleet transport) and the per-agent telltales (each resident's route). Always
 * rendered, quietly: live is one token wide, and a degraded push carries the consumer's reason
 * verbatim.
 *
 * Presentation-thin: the chip fully derives on
 * {@link AgentOS.view.fleet.cockpit.StateProvider}'s `viewerWakeTelltale` derived data, and the
 * chrome slot binds every channel as its own first-class reactive config — `text`, `cls`,
 * `chipTitle`, `chipAriaLabel`. Title and aria are INDEPENDENTLY reactive on purpose: the drill
 * detail can move while the visible text stays byte-identical (a catch-up state change under a
 * stable "wake: live"), so no channel may ride another as its change proxy.
 *
 * `text`, never `html`: the chip interpolates the consumer's reason strings, which arrive over
 * the wire; data, not markup.
 *
 * @class AgentOS.view.fleet.cockpit.ViewerWakeTelltaleComponent
 * @extends Neo.component.Base
 */
class ViewerWakeTelltaleComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.ViewerWakeTelltaleComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.ViewerWakeTelltaleComponent',
        /**
         * @member {String} ntype='fm-viewer-wake-telltale'
         * @protected
         */
        ntype: 'fm-viewer-wake-telltale',
        /**
         * @member {String[]} baseCls=['fm-viewer-wake']
         */
        baseCls: ['fm-viewer-wake'],
        /**
         * The chip's screen-reader line, bound from the derivation — independently reactive.
         * @member {String|null} chipAriaLabel_=null
         * @reactive
         */
        chipAriaLabel_: null,
        /**
         * The drill-free detail (`title` attribute), bound from the derivation — independently
         * reactive (never proxied through the visible text).
         * @member {String|null} chipTitle_=null
         * @reactive
         */
        chipTitle_: null,
        /**
         * @member {String} role='status'
         */
        role: 'status',
        /**
         * The pre-derivation status word — the stream really is off until someone starts it.
         * @member {String} text='wake off'
         * @reactive
         */
        text: 'wake off'
    }

    /**
     * Triggered after the chipAriaLabel config got changed.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetChipAriaLabel(value, oldValue) {
        this.syncAttribute('aria-label', value, oldValue)
    }

    /**
     * Triggered after the chipTitle config got changed.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetChipTitle(value, oldValue) {
        this.syncAttribute('title', value, oldValue)
    }

    /**
     * @summary Mirror one bound attribute channel onto the vdom root — flushed on its OWN change
     * beat (each channel is first-class; none rides another as a change proxy).
     * @param {String} attribute
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    syncAttribute(attribute, value, oldValue) {
        const me = this;

        me.vdom[attribute] = value || null;
        oldValue !== undefined && me.mounted && me.update()
    }
}

export default Neo.setupClass(ViewerWakeTelltaleComponent);
