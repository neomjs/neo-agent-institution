export {
    expect,
    loadAgentOsModule,
    loadNeuralLinkModules,
    test
} from '../../node_modules/neo.mjs/test/playwright/fixtures.mjs';

/**
 * @summary What an arm that closes a window on purpose names with `workerErrors.expect`: the components
 * leaving with that window still address it (addon teardown, a grid's size pass), and the engine reports each
 * send as an App Worker error — its typed dead-port sentence, or the main thread finding no worker under the
 * window's uuid. Only windows are uuid-named: a missing `data` or `vdom` worker still fails the arm, as does
 * every other error. Delete with its callers once the engine's unhandled-rejection boundary disposes of a
 * departed window's sends itself.
 * @type {RegExp}
 */
export const departedWindowSends = /^App Worker: Error: (?:worker\.Base#promiseMessage: no live port for destination "[0-9a-f-]{36}" \([^)]*\) — a window closed\?|Target worker '[0-9a-f-]{36}' does not exist\.)/;
