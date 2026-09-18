import path            from 'node:path';
import {fileURLToPath} from 'node:url';
import baseConfig, {discoverExternalBrainSpecs} from './playwright.config.e2e.mjs';

const e2eRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e');

if (!path.isAbsolute(process.env.NEO_AGENTOS_RUNTIME_ROOT || '')) {
    throw new Error('The Neural Link battery needs NEO_AGENTOS_RUNTIME_ROOT: an absolute path to a neo-agent-brain checkout.')
}

/**
 * @summary The Neural Link battery: exactly the e2e specs that request the Brain whitebox fixture.
 * The base config owns the rule — a spec joins by naming `neuralLink` — and ignores those specs
 * while no runtime root is bound; this config runs them and nothing else. A spec's file name
 * decides nothing, so a spec cannot fall between the two runs.
 */
export default {
    ...baseConfig,
    testMatch: discoverExternalBrainSpecs(e2eRoot)
};
