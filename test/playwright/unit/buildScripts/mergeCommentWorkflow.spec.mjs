import {test, expect}     from '@playwright/test';
import fs                 from 'node:fs';
import path               from 'node:path';
import {fileURLToPath}    from 'node:url';
import {load as loadYaml} from 'js-yaml';

const
    repoRoot     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    workflowPath = path.join(repoRoot, '.github/workflows/merge-comment.yml');

/**
 * @summary Loads and parses `.github/workflows/merge-comment.yml` alongside its raw YAML source.
 * @returns {{doc: Object, raw: String}}
 */
function readCallerWorkflow() {
    const raw = fs.readFileSync(workflowPath, 'utf8');
    return {doc: loadYaml(raw), raw}
}

/**
 * Pins the thin caller contract: the closed-pull-request trigger, the exact token scopes the called Engine job
 * needs, and a full 40-hex commit SHA ref, with the filter and the concurrency left to the called job.
 */
test.describe('merge-comment workflow caller contract', () => {
    test('declares the closed-pull-request trigger and exact token permissions', () => {
        const {doc} = readCallerWorkflow();

        expect(doc.name).toBe('Merge comment');
        expect(doc.on).toEqual({pull_request_target: {types: ['closed']}});
        expect(doc.permissions).toEqual({
            contents       : 'read',
            issues         : 'read',
            'pull-requests': 'write'
        });
    });

    test('delegates via a full 40-hex Engine SHA with no filter, concurrency, inputs, or steps of its own', () => {
        const
            {doc, raw} = readCallerWorkflow(),
            jobEntries = Object.entries(doc.jobs ?? {});

        expect(doc.concurrency).toBeUndefined();
        expect(jobEntries).toHaveLength(1);
        expect(jobEntries[0][0]).toBe('comment');

        const comment = jobEntries[0][1];
        expect(comment.if).toBeUndefined();
        expect(comment.concurrency).toBeUndefined();
        expect(comment.uses).toMatch(/^neomjs\/neo\/\.github\/workflows\/merge-comment\.yml@[0-9a-f]{40}$/);
        expect(comment.with).toBeUndefined();
        expect(comment.steps).toBeUndefined();
        expect(comment['runs-on']).toBeUndefined();
        expect(raw).not.toContain('actions/checkout');
    });
});
