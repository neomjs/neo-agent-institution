import Component from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';

/**
 * @summary The per-viewer wake-push telltale — MY push lane's health, a different axis from the
 * spine banner (fleet transport) and the per-agent telltales (each resident's route). Always
 * rendered, quietly: live is one token wide, and a degraded push carries the consumer's reason
 * verbatim.
 *
 * Presentation-thin, same contract as the banner sibling: the chip fully derives on
 * {@link AgentOS.view.fleet.cockpit.StateProvider}'s `viewerWakeTelltale` formula (the stamped
 * `viewerWake` truths INCLUDING the bounded signal window), and the chrome slot binds the ENGINE
 * configs. The one local behavior: the drill-free detail (`title`) and the aria line re-pull from
 * the same formula on every text beat — the stamp cadence that moves the text is the cadence that
 * moves them.
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
         * @member {String} role='status'
         */
        role: 'status',
        /**
         * @member {String} text='wake: not started'
         * @reactive
         */
        text: 'wake: not started'
    }

    /**
     * Triggered after the text config got changed — carry the formula's `title` + `ariaLabel`
     * along in the same beat (they move on the same stamp cadence the text moves on).
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetText(value, oldValue) {
        super.afterSetText?.(value, oldValue);

        const provider = this.getStateProvider?.();

        if (provider) {
            this.vdom.title         = provider.getData('viewerWakeTelltale.title');
            this.vdom['aria-label'] = provider.getData('viewerWakeTelltale.ariaLabel');
            this.mounted && this.update()
        }
    }
}

export default Neo.setupClass(ViewerWakeTelltaleComponent);
