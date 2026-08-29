import Component from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';

/**
 * @summary The per-spine honesty line — names WHY a surface shows sample/last-known data
 * (cold/degraded); a fully live spine renders nothing (zero nominal pixels).
 *
 * Presentation-thin BY NECESSITY and by design: the full verdict derives on
 * {@link AgentOS.view.fleet.cockpit.StateProvider}'s `spineBanner` formula, and the chrome slot
 * binds the ENGINE configs (`text`, `cls`, `hidden`) — custom-config binds never receive their
 * effects at this engine head (verified live 2026-08-29), and engine-config binds are all this
 * component needs. The one local behavior: the full sentence rides the `title` attribute as the
 * drill-free detail (the visible line may ellipsis under bar pressure).
 *
 * `text`, never `html`: the line interpolates RETAINED TRANSPORT STRINGS (the adapter's own
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
         * Visible by default: the pre-verdict state IS the cold state (the formula's first
         * computation confirms it; a fully live spine is what hides the line).
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
     * Triggered after the text config got changed — mirror the full sentence onto `title` (the
     * drill-free detail; the visible line may truncate) in the SAME beat.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetText(value, oldValue) {
        super.afterSetText?.(value, oldValue);

        this.vdom.title = value || null;
        this.mounted && this.update()
    }
}

export default Neo.setupClass(SpineBannerComponent);
