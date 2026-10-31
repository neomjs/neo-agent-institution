import Base           from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import FleetAdmission from './FleetAdmission.mjs';

/**
 * @module apps/agentos/util/SpineAction
 * @summary What the spine banner's one button does, by its verdict's `action`
 * ({@link AgentOS.util.SpineBanner}) — lifted beside the cockpit's controller the way
 * `PlaneCredentialCheck` is beside the liveness owner.
 *
 * `dismiss-outage` clears the recovered plane-outage note (`planeOutageNote`) without re-polling.
 * `connect-plane` opens the plane card, which lives with the viewport: a credential, or a plane already
 * running beside the shell, needs it. `retry-plane` asks the shell to run a boot the plane refused for a
 * reason that is not the credential's again, with its stored record (no PAT prompt, no relaunch), and
 * then re-drives every liveness seam: Brain health shows the boot `starting` until it settles, and the
 * Fleet reads join the new boot. A retry the shell refuses changes nothing, so the same reads show the
 * truth that stands. Every other verdict reconnects the fleet.
 */
class SpineAction extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.SpineAction'
         * @protected
         */
        className: 'AgentOS.util.SpineAction'
    }

    /**
     * @summary Runs the banner's current action.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit's controller.
     * @returns {Promise<void>}
     */
    static async run(owner) {
        const
            provider = owner.component.getStateProvider(),
            action   = provider?.getData('spineBanner')?.action;

        if (action === 'dismiss-outage') {
            provider.setData({planeOutageNote: FleetAdmission.blankOutageNote()});
            return
        }

        if (action === 'connect-plane') {
            owner.getParent()?.showPlaneSetup?.()
        } else {
            Boolean(provider?.getData('planeOutageNote')?.recoveredAt) &&
                provider?.setData?.({planeOutageNote: FleetAdmission.blankOutageNote()});

            action === 'retry-plane' &&
                await Promise.resolve(Neo.main?.addon?.ShellPlane?.retryPlane({windowId: owner.component.windowId})).catch(() => null);

            owner.isDestroyed || owner.reconnectFleet()
        }
    }
}

export default Neo.setupClass(SpineAction);
