import Provider from '../../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import Viewport from '../../../../../../../../apps/agentos/view/Viewport.mjs';

/**
 * @summary A provider shaped like the Viewport's: the shell-level truths a cockpit resolves through
 * its parent chain (the roster surface's, `instanceState`) and the roster store it fills. Both come
 * from `Viewport.config.stateProvider` itself, so this fixture moves when the shell does. A spec
 * passes it as the cockpit provider's `parent`.
 * @param {Object} [data] Leaf overrides over the Viewport's defaults
 * @returns {Neo.state.Provider}
 */
export function createShellProvider(data = {}) {
    const {data: shellData, stores} = Viewport.config.stateProvider;

    return Neo.create(Provider, {
        data  : {...Neo.clone(shellData, true), ...data},
        stores: {fleetRoster: {...stores.fleetRoster}}
    })
}
