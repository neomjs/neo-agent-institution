/**
 * @summary The tests' Home driver: loaded into the App worker through `Neo.worker.App.loadModule`, it lands
 * `shellPlaneConfigured` the way the ViewportController publishes it at boot (`setData`, whose closest-owner
 * walk reaches the Viewport provider's key), so a browser run can put Home in front of a packaged shell
 * without a plane. `instanceState` is not landed: the cockpit's formula owns it and rewrites it on its next
 * tick, so specs reach its states through the cockpit (a cold boot, a landed fleet).
 * Query: `shellPlaneConfigured=false`, anything else lands `null`.
 */
const home = Neo.manager.Component.findFirst('ntype', 'fm-home-view');

if (!home) {
    throw new Error('homeState driver: no fm-home-view is mounted')
}

home.getStateProvider().setData({
    shellPlaneConfigured: new URL(import.meta.url).searchParams.get('shellPlaneConfigured') === 'false' ? false : null
});
