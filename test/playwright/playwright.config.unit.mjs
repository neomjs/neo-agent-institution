import {defineConfig}  from '@playwright/test';
import path            from 'node:path';
import {fileURLToPath} from 'node:url';

const
    filename                 = fileURLToPath(import.meta.url),
    dirname                  = path.dirname(filename),
    isCI                     = Boolean(process.env.CI),
    hasAgentOsRuntimeBinding = path.isAbsolute(process.env.NEO_AGENTOS_RUNTIME_ROOT || '');

process.env.UNIT_TEST_MODE = 'true';

/**
 * @summary Specs that explicitly exercise a separately installed Brain runtime.
 * @type {RegExp[]}
 */
export const crossRepoBrainTestIgnore = [
    /[\\/]harness[\\/](brain|fleetCapability)\.spec\.mjs$/,
    /[\\/]apps[\\/]agentos[\\/]config[\\/]fleetVocabularyParity\.spec\.mjs$/,
    /[\\/]apps[\\/]agentos[\\/]fleet[\\/](connectionProfiles|fleetTransport\.integration|fleetWakeStreamConsumer(?:\.live)?)\.spec\.mjs$/,
    /[\\/]apps[\\/]agentos[\\/]view[\\/]fleet[\\/](mailbox[\\/]operatorSeatConflationParity|util[\\/]kindRegistry)\.spec\.mjs$/
];

const reporter = [['json', {outputFile: path.join(dirname, 'test-results/unit/test-results.json')}]];

isCI && reporter.unshift(['github']);

export default defineConfig({
    testDir         : path.join(dirname, 'unit'),
    outputDir       : path.join(dirname, 'test-results/unit'),
    fullyParallel   : true,
    failOnFlakyTests: isCI,
    forbidOnly      : isCI,
    reporter,
    retries         : isCI ? 2 : 0,
    workers         : isCI ? 4 : undefined,
    use             : {trace: 'on-first-retry'},
    projects        : [{
        name      : 'unit-institution',
        testIgnore: hasAgentOsRuntimeBinding ? [] : crossRepoBrainTestIgnore
    }]
});
