/**
 * @summary The tests' System driver: loaded into the App worker through `Neo.worker.App.loadModule`, it lands the
 * `picture` query (a JSON `deploymentState` picture in the wire shape the cockpit's read owner writes) on that
 * same provider key, stamped with the System view's bound profile so the view does not treat it as another
 * instance's. A browser run renders populated plane cards and their honest head line without a plane. Every
 * distinct URL executes once (module cache), so a spec varies `t` per call. Query: `picture=<JSON>&t=<n>`.
 */
const view = Neo.manager.Component.findFirst('className', 'AgentOS.view.system.Container');

if (!view) {
    throw new Error('systemPlanes driver: no System view is mounted')
}

view.getStateProvider().setData({
    deploymentState: {
        ...JSON.parse(new URL(import.meta.url).searchParams.get('picture')),
        profileId: view.boundProfileId ?? null
    }
});
