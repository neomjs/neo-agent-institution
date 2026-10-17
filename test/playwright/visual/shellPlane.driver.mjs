/**
 * @summary The tests' shell-plane driver: loaded into the App worker through `Neo.worker.App.loadModule`, it sets the
 * root state.Provider's `shellPlaneBase` the way the shell's status does, so every view bound to the plane renders
 * attached (or, with no `base`, on the shell's own plan). Every distinct URL executes once (module cache), so a spec
 * varies the `t` parameter per call.
 *
 * `?base=<url>&t=<n>`
 */
const
    base     = new URL(import.meta.url).searchParams.get('base') || null,
    viewport = Neo.manager.Component.find('className', 'AgentOS.view.Viewport').find(component => component.mounted);

if (!viewport) {
    throw new Error('shellPlane driver: no AgentOS.view.Viewport is mounted')
}

viewport.getStateProvider().setData({shellPlaneBase: base});
