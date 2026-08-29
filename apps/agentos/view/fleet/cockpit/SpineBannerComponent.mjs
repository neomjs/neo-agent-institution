import Component from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';

/**
 * @summary The per-spine honesty pill — names WHY a surface shows sample/last-known data
 * (cold/degraded); a fully live spine renders nothing (zero nominal pixels).
 *
 * Presentation-thin by design: the full verdict derives on
 * {@link AgentOS.view.fleet.cockpit.StateProvider}'s `spineBanner` derived data, and the chrome
 * slot binds its leaves — `text` (the STATUS WORD: chrome labels are never sentences), `cls`,
 * `hidden`, plus the two attribute channels: `bannerTitle` (the full honesty sentence, one hover
 * away) and `bannerAriaLabel` (the sentence's screen-reader mirror — the title attribute alone is
 * unreachable to most readers). Each channel is first-class and independently reactive; none
 * rides another as a change proxy (the same discipline the wake telltale pinned).
 *
 * `text`, never `html`: the sentence interpolates RETAINED TRANSPORT STRINGS (the adapter's own
 * `capability.reason`, arriving over the fleet wire), and `html` is an innerHTML sink — hostile
 * markup in a reason would execute.
 *
 * @class AgentOS.view.fleet.cockpit.SpineBannerComponent
 * @extends Neo.component.Base
 */
class SpineBannerComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.SpineBannerComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.SpineBannerComponent',
        /**
         * @member {String} ntype='fm-spine-banner'
         * @protected
         */
        ntype: 'fm-spine-banner',
        /**
         * @member {String[]} baseCls=['fm-spine-banner']
         */
        baseCls: ['fm-spine-banner'],
        /**
         * The pill's screen-reader sentence, bound from the derivation — independently reactive.
         * @member {String|null} bannerAriaLabel_=null
         * @reactive
         */
        bannerAriaLabel_: null,
        /**
         * The full honesty sentence (`title` attribute) — the drill-free detail, bound from the
         * derivation; never proxied through the visible status word.
         * @member {String|null} bannerTitle_=null
         * @reactive
         */
        bannerTitle_: null,
        /**
         * Visible by default: the pre-verdict state IS the cold state (the formula's first
         * computation confirms it; a fully live spine is what hides the pill).
         * @member {Boolean} hidden=false
         * @reactive
         */
        hidden: false,
        /**
         * @member {String} role='status'
         */
        role: 'status'
    }

    /**
     * Triggered after the bannerAriaLabel config got changed.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetBannerAriaLabel(value, oldValue) {
        this.syncAttribute('aria-label', value, oldValue)
    }

    /**
     * Triggered after the bannerTitle config got changed.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetBannerTitle(value, oldValue) {
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

export default Neo.setupClass(SpineBannerComponent);
