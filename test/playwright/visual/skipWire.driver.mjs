/**
 * @summary The tests' Skip-verb driver: loaded into the App worker through `Neo.worker.App.loadModule`, it gives the
 * pane-facing Fleet registry bridge the `skipAgentDependencies` verb, answering one skipped Start, so the Repository
 * pane offers Skip. The pane reads the verb when it
 * renders, so a spec lands its roster after this driver. Every distinct URL executes once (module cache), so a spec
 * varies the `t` parameter per call.
 *
 * `?t=<n>`
 */
const agentOS = globalThis.AgentOS ??= {};

agentOS.fleet ??= {};
agentOS.fleet.registryBridge ??= {};
agentOS.fleet.registryBridge.skipAgentDependencies = async agentId => ({id: agentId, skippedStarts: 1});
