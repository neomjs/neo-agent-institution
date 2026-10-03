import {loadAgentOsModule} from '../../fixtures.mjs';
import fs                  from 'node:fs';
import os                  from 'node:os';
import path                from 'node:path';
import {fileURLToPath}       from 'node:url';

const [
    {generateLocalBearerToken},
    {default: RequestContextService},
    {default: FleetManager},
    {default: FleetRegistryService},
    {createFleetWireResponse, FLEET_WIRE_RESPONSE_STATES}
] = await Promise.all([
    loadAgentOsModule('ai/mcp/server/shared/helpers/localBearer.mjs'),
    loadAgentOsModule('ai/mcp/server/shared/services/RequestContextService.mjs'),
    loadAgentOsModule('ai/services/fleet/FleetManager.mjs'),
    loadAgentOsModule('ai/services/fleet/FleetRegistryService.mjs'),
    import('neo-agent-brain/fleet-contract')
]);

const
    E2E_MANAGED_ROOT   = fs.mkdtempSync(path.join(os.tmpdir(), 'institution-fleet-e2e-')),
    // the synced issue tree the PR/lane slot reads in every real-producer spec
    FIXTURE_ISSUES_DIR = fileURLToPath(new URL('../../fixtures/issues', import.meta.url));

// The Brain service deliberately has no cwd fallback. Cross-repository tests inject their
// disposable target root through the same composition seam as a real launcher, and the registry
// records each new seat's home under that same root, or the start refuses a "moved" seat.
FleetManager.managedRoot        = E2E_MANAGED_ROOT;
FleetRegistryService.agentsRoot = E2E_MANAGED_ROOT;
process.once('exit', () => fs.rmSync(E2E_MANAGED_ROOT, {force: true, recursive: true}));

/**
 * @summary The authenticated Fleet e2e harness — the test-side composition of the ingress trust
 * boundary, shared by every agentos e2e spec that runs a loopback Fleet bridge.
 *
 * Shape of every migrated spec: construct the recording/real server with
 * {@link authenticatedFleetOptions} (fresh process bearer, stub viewer, the REAL
 * `RequestContextService` as the per-request identity boundary), boot the app (which installs the
 * FAIL-CLOSED bridge — the correct unlaunched default), then {@link wireAuthenticatedFleetBridge}
 * through the App-Worker realm via the product injector (`ViewportController.wireFleetBridge` —
 * the same seam the Neural Link and the Electron main use), and finally
 * {@link reloadRoster} so passive boot-time loads that raced the injection re-read against the
 * live bridge (`FleetCockpit.loadRoster` is idempotent + fail-closed by contract).
 */

/**
 * @summary The stub viewer every e2e server stamps — a bound identity shape without graph coupling
 * (the launch contract's graph verification is `devFleetServer`'s concern, unit-tested there).
 * @type {Object}
 */
export const E2E_FLEET_VIEWER = Object.freeze({
    userId             : 'e2e-operator',
    username           : 'E2E Operator',
    agentIdentityNodeId: '@e2e-operator'
});

/**
 * @summary Creates the canonical successful Fleet wire envelope for a spec-owned dispatcher.
 * @param {*} result
 * @returns {Object}
 */
export function fleetE2ESuccess(result) {
    return createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.ok, {result})
}

/**
 * @summary Creates a bounded operation-failure Fleet wire envelope for a spec-owned dispatcher.
 * @param {String} error
 * @returns {Object}
 */
export function fleetE2EFailure(error) {
    return createFleetWireResponse(FLEET_WIRE_RESPONSE_STATES.operationFailed, {error})
}

/**
 * @summary Builds the authenticated option set for `startFleetBridgeServer` in e2e specs.
 * @param {Object} [overrides] Spec-owned options (dispatch, port, …) — spread last, so a spec can
 *     override anything except by omission.
 * @returns {Object} Options carrying a fresh canonical bearer, the stub viewer, and the real
 *     request-context runner.
 */
export function authenticatedFleetOptions(overrides = {}) {
    // The exact-Origin policy must admit THIS run's dev-server origin — which moves with
    // NEO_E2E_PORT (the same knob the e2e config uses to dodge a foreign server on 8080).
    // Wrong-origin refusal is the boundary working; the harness names the truth instead.
    const e2ePort = Number(process.env.NEO_E2E_PORT) || 8080;

    return {
        port          : 0,
        bearerToken   : generateLocalBearerToken(),
        viewerContext : E2E_FLEET_VIEWER,
        runInContext  : (context, fn) => RequestContextService.run(context, fn),
        allowedOrigins: [`http://localhost:${e2ePort}`, `http://127.0.0.1:${e2ePort}`],
        ...overrides
    }
}

/**
 * @summary Injects the process bearer through the App-Worker realm via the product injector.
 *
 * Page-side init scripts cannot reach the worker's global, so this is THE delivery path — the
 * exact one the Neural Link (dev) and the Electron main (product) use. Boot stays fail-closed;
 * this call flips the bridge live.
 *
 * @param {Object} options
 * @param {Object} options.app         The `neuralLink.connectToApp('AgentOS')` handle.
 * @param {String} options.fleetUrl    The loopback fleet endpoint the server bound.
 * @param {String} options.bearerToken The server's process bearer.
 * @param {String} [options.mcAuthorization] The viewer's class-3 MC mint arming the per-viewer
 *     wake stream — a DISTINCT credential from the class-1 bearer by contract (`installFleetBridge`
 *     refuses a byte-identical pair). Omitted = the honest not-armed state.
 * @returns {Promise<void>}
 */
export async function wireAuthenticatedFleetBridge({app, fleetUrl, bearerToken, mcAuthorization}) {
    const [viewport] = await app.queryComponent({className: 'AgentOS.view.Viewport'}, ['id']);

    if (!viewport?.properties?.id) {
        throw new Error('authenticatedFleetHarness: no mounted AgentOS.view.Viewport — is the app booted?')
    }

    const state        = await app.getComponent(viewport.properties.id, ['controller.id']),
          controllerId = state?.['controller.id'];

    if (!controllerId) {
        throw new Error('authenticatedFleetHarness: the Viewport exposes no controller.id — injector unreachable')
    }

    const ack = await app.callMethod(controllerId, 'wireFleetBridge', [{
        url: fleetUrl,
        bearerToken,
        ...(mcAuthorization ? {mcAuthorization} : {})
    }]);

    // The injector acks with literal true; anything else means the call silently no-oped in the
    // worker (stale module, missing method, swallowed throw) — fail LOUD here, not at a downstream
    // roster assertion that can only say "7 sample cards".
    if (ack !== true) {
        throw new Error(`authenticatedFleetHarness: wireFleetBridge did not ack (got ${JSON.stringify(ack)}) — the bearer never reached the worker realm`)
    }
}

/**
 * @summary Re-reads the roster against the (now live) bridge — the observe half after injection.
 *
 * Passive boot-time loads consume the fail-closed bridge before the injection can land; keeper
 * views do not re-mount on route toggles. The cockpit controller's `loadRoster` is the ONE
 * sanctioned re-poll path (idempotent + fail-closed), so the harness calls it through the
 * component's `controller.` path rather than inventing a refresh.
 *
 * @param {Object} app The `neuralLink.connectToApp('AgentOS')` handle.
 * @returns {Promise<void>} Resolves once the re-read settled; a missing cockpit resolves silently
 *     (specs that never mount the fleet view have nothing to re-read).
 */
export async function reloadRoster(app) {
    const [cockpit] = await app.queryComponent({className: 'AgentOS.view.fleet.cockpit.Container'}, ['id']);

    if (cockpit?.properties?.id) {
        await app.callMethod(cockpit.properties.id, 'controller.loadRoster')
    }
}

/**
 * @summary Composes the real activity producer onto `FleetControlBridge` with the slot readers
 * `devFleetServer` injects: the A2A slot over a bound `listMessages`, the PR/lane slot over a synced
 * issue tree. A transport that answers through it is the production producer, never a stub behind a
 * socket. Re-wiring replaces the source, which is how a spec makes one slot fail.
 * @param {Object} [options]
 * @param {Function} [options.listMessages] The A2A slot's reader; an honest empty inbox by default.
 * @param {String} [options.issuesDir] The PR/lane slot's corpus; the fixture tree by default.
 * @returns {Promise<void>}
 */
export async function wireRealFleetSources({listMessages = async () => [], issuesDir = FIXTURE_ISSUES_DIR} = {}) {
    // the Neo namespace devFleetServer's entry performs, so the bridge singletons construct
    await import('../../../../node_modules/neo.mjs/src/Neo.mjs');
    await import('../../../../node_modules/neo.mjs/src/core/_export.mjs');
    await import('../../../../node_modules/neo.mjs/src/manager/Instance.mjs');

    const {wireFleetActivityReadSource} = await loadAgentOsModule('ai/services/fleet/wireFleetActivityReadSource.mjs');

    wireFleetActivityReadSource({issuesDir, listMessages})
}

/**
 * @summary Starts the authenticated Fleet bridge on the real dispatch path, so `fleetRoster` and
 * `fleetActivity` resolve through `FleetControlBridge`. Restarting with the captured `port` and
 * `bearerToken` re-listens at the endpoint the browser bridge already targets. Closing ends open
 * connections too, so an event stream cannot postpone the transport's death.
 * @param {Object} [options]
 * @param {Number} [options.port=0] 0 binds an ephemeral port.
 * @param {String} [options.bearerToken] Reused across a restart.
 * @returns {Promise<{bearerToken: String, port: Number, endpoint: String, close: Function}>}
 */
export async function startRealFleetServer({port = 0, bearerToken} = {}) {
    const
        {startFleetBridgeServer} = await loadAgentOsModule('ai/services/fleet/fleetBridgeServer.mjs'),
        options                  = authenticatedFleetOptions(bearerToken ? {port, bearerToken} : {port}),
        server                   = await startFleetBridgeServer(options),
        boundPort                = server.address().port;

    return {
        bearerToken: options.bearerToken,
        port       : boundPort,
        endpoint   : `http://127.0.0.1:${boundPort}/fleet`,
        close      : () => new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections()
        })
    }
}
