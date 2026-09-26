import {expect, test}   from '@playwright/test';
import {readFileSync}   from 'node:fs';
import path             from 'node:path';
import {fileURLToPath}  from 'node:url';

import {sampleActivity, sampleRoster}  from '../../../../fixture/fleetSample.mjs';
import {sampleActivity as appActivity} from '../../../../../../apps/agentos/config/fleetSampleData.mjs';

const appRosterPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../apps/agentos/resources/data/fleetRoster.json');

/**
 * @summary The tests' sample fleet equals the seed the app still ships — so moving the specs onto
 * the fixture moves no card and no event. This arm retires with the app's seed.
 */
test.describe('test fixture — the sample fleet mirrors the app seed it replaces', () => {
    test('the eleven roster rows equal the app JSON, in order', () => {
        const appRows = JSON.parse(readFileSync(appRosterPath, 'utf8')).data;

        expect(sampleRoster).toEqual(appRows);
        expect(sampleRoster.map(row => row.agentId)).toEqual(appRows.map(row => row.agentId))
    });

    test('the six activity events equal the app module', () => {
        expect(sampleActivity).toEqual(appActivity)
    });
});
