import {test, expect}                          from '@playwright/test';
import fs                                      from 'node:fs';
import os                                      from 'node:os';
import path                                    from 'node:path';
import {lintPublicDocs, stripFencedCodeBlocks} from '../../../../buildScripts/lintPublicDocs.mjs';

/**
 * @summary Builds an isolated spoke fixture under `os.tmpdir()` for targeted public-docs lint verification.
 * @param {Object} [overrides={}]
 * @returns {String}
 */
function createFixture({
    guideBody          = '# Cockpit Tour\n\nSee [Introduction](./Introduction.md) and `apps/agentos/view/home/MainContainer.mjs` by `@neo-opus-grace`.\n',
    extraTreeLeaf      = false,
    extraManifestEntry = false,
    includeAdrInTree   = false,
    mountIdOverride    = null,
    routeOverride      = null
} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'institution-public-docs-'));

    fs.mkdirSync(path.join(root, 'docs'), {recursive: true});
    fs.mkdirSync(path.join(root, 'learn/agentos/decisions'), {recursive: true});

    fs.writeFileSync(path.join(root, 'learn/Introduction.md'), '# Introduction\n');
    fs.writeFileSync(path.join(root, 'learn/CockpitTour.md'), guideBody);
    fs.writeFileSync(path.join(root, 'learn/agentos/decisions/0020-agent-harness-concept.md'), '# ADR 0020\n');

    const treeData = [
        {name: 'Introduction',     parentId: null, id: 'Introduction'},
        {name: 'Tour the cockpit', parentId: null, id: 'CockpitTour'}
    ];

    if (extraTreeLeaf) {
        fs.writeFileSync(path.join(root, 'learn/Extra.md'), '# Extra\n');
        treeData.push({name: 'Extra', parentId: null, id: 'Extra'})
    }

    const entries = [
        {file: 'learn/Introduction.md', route: '/learn/institution/Introduction'},
        {file: 'learn/CockpitTour.md',  route: routeOverride || '/learn/institution/CockpitTour'}
    ];

    if (extraManifestEntry) {
        fs.writeFileSync(path.join(root, 'learn/Unlisted.md'), '# Unlisted\n');
        entries.push({file: 'learn/Unlisted.md', route: '/learn/institution/Unlisted'})
    }

    if (includeAdrInTree) {
        treeData.push({name: 'ADR 0020', parentId: null, id: 'agentos/decisions/0020-agent-harness-concept'});
        entries.push({
            file : 'learn/agentos/decisions/0020-agent-harness-concept.md',
            route: '/learn/institution/agentos/decisions/0020-agent-harness-concept'
        })
    }

    fs.writeFileSync(path.join(root, 'learn/tree.json'), JSON.stringify({data: treeData}, null, 2));
    fs.writeFileSync(path.join(root, 'docs/public-manifest.json'), JSON.stringify({
        schema   : 'public-manifest.v1',
        spoke    : 'neomjs/neo-agent-institution',
        treeFile : 'learn/tree.json',
        treeMount: {parentId: 'AgentInterfaces', id: mountIdOverride || 'institution', name: 'Agent Institution'},
        entries
    }, null, 4));

    return root
}

test.describe('buildScripts/lintPublicDocs', () => {
    test('the live neomjs/neo-agent-institution manifest admits all 7 product guides at /learn/institution/* and excludes the 5 ADRs', () => {
        const result = lintPublicDocs();

        expect(result.entryCount).toBe(7);
        expect(result.routes).toEqual([
            '/learn/institution/README',
            '/learn/institution/Introduction',
            '/learn/institution/CockpitTour',
            '/learn/institution/CockpitStateCensus',
            '/learn/institution/CockpitStateWalkthrough',
            '/learn/institution/RunningTheInstitution',
            '/learn/institution/TheNativeVessel'
        ]);
        expect(result.routes.some(route => route.includes('decisions'))).toBe(false)
    });

    test('passes clean prose containing repo-relative view/home/* paths, /Users/<you>/ placeholders, and public @neo-* handles', () => {
        const root = createFixture({
            guideBody: [
                '# Cockpit Tour',
                '',
                'Clone into `/Users/<you>/workspace/neo-agent-institution` and inspect `apps/agentos/view/home/MainContainer.mjs`.',
                'Reviewed by `@neo-gemini-julia` and `@neo-opus-grace`. See [Introduction](./Introduction.md).'
            ].join('\n')
        });

        try {
            expect(lintPublicDocs({root}).entryCount).toBe(2)
        } finally {
            fs.rmSync(root, {recursive: true, force: true})
        }
    });

    test('rejects real Unix/macOS and Windows host filesystem paths including file:// URLs', () => {
        const unixRoot    = createFixture({
            guideBody: '# Leak\n\nLoaded from `/Users/alice/.neo-ai/neo-agent-institution/learn/Introduction.md`.\n'
        });
        const fileUrlRoot = createFixture({
            guideBody: '# Leak\n\nScreenshot at `file:///Users/alice/x/shot.png`.\n'
        });
        const winRoot     = createFixture({
            guideBody: '# Leak\n\nLoaded from `C:\\Users\\alice\\neo-agent-institution\\learn\\Introduction.md`.\n'
        });

        try {
            expect(() => lintPublicDocs({root: unixRoot})).toThrow(/forbidden host filesystem path "\/Users\/alice\//);
            expect(() => lintPublicDocs({root: fileUrlRoot})).toThrow(/forbidden host filesystem path "\/Users\/alice\/x\/shot\.png"/);
            expect(() => lintPublicDocs({root: winRoot})).toThrow(/forbidden Windows host filesystem path/)
        } finally {
            fs.rmSync(unixRoot, {recursive: true, force: true});
            fs.rmSync(fileUrlRoot, {recursive: true, force: true});
            fs.rmSync(winRoot, {recursive: true, force: true})
        }
    });

    test('rejects private repository references and ADR leakage', () => {
        for (const repo of ['neomjs/business', 'neomjs/neo-stage', 'neomjs/neo-pro']) {
            const root = createFixture({
                guideBody: `# Leak\n\nSee ${repo}#42 for internal notes.\n`
            });
            try {
                expect(() => lintPublicDocs({root})).toThrow(/forbidden private-repository reference/)
            } finally {
                fs.rmSync(root, {recursive: true, force: true})
            }
        }

        const adrRoot = createFixture({includeAdrInTree: true});
        try {
            expect(() => lintPublicDocs({root: adrRoot})).toThrow(/excluded internal record/)
        } finally {
            fs.rmSync(adrRoot, {recursive: true, force: true})
        }
    });

    test('rejects manifest/tree drift, wrong route prefixes, and broken relative Markdown links outside fences', () => {
        const extraLeafRoot   = createFixture({extraTreeLeaf: true});
        const extraEntryRoot  = createFixture({extraManifestEntry: true});
        const mountDriftRoot  = createFixture({mountIdOverride: 'other-spoke'});
        const badPrefixRoot   = createFixture({routeOverride: '/learn/agentos/CockpitTour'});
        const fencedRoot      = createFixture({guideBody: '# Cockpit Tour\n\n```markdown\n[Example](./DoesNotExist.md)\n```\nInline `[Code](./DoesNotExist.md)` stays inert.\n'});
        const brokenLinkRoot  = createFixture({guideBody: '# Cockpit Tour\n\nSee [Missing](./DoesNotExist.md#top) for details.\n'});
        const unlistedAdrLink = createFixture({guideBody: '# Cockpit Tour\n\nSee [ADR 0020](agentos/decisions/0020-agent-harness-concept.md).\n'});
        const repoOutsideLink = createFixture({guideBody: '# Cockpit Tour\n\nSee [Sketch](../apps/agentos/design/sketch.html).\n'});

        try {
            expect(() => lintPublicDocs({root: extraLeafRoot})).toThrow(/leaf "learn\/Extra\.md" is missing/);
            expect(() => lintPublicDocs({root: extraEntryRoot})).toThrow(/"learn\/Unlisted\.md" is not a leaf/);
            expect(() => lintPublicDocs({root: mountDriftRoot})).toThrow(/invalid route/);
            expect(() => lintPublicDocs({root: badPrefixRoot})).toThrow(/invalid route/);
            expect(stripFencedCodeBlocks('a\n```js\nb\n```\nc')).toBe('a\n\n\n\nc');
            expect(lintPublicDocs({root: fencedRoot}).entryCount).toBe(2);
            expect(() => lintPublicDocs({root: brokenLinkRoot})).toThrow(/broken relative Markdown link "\.\/DoesNotExist\.md"/);
            expect(() => lintPublicDocs({root: unlistedAdrLink})).toThrow(/broken relative Markdown link "agentos\/decisions\/0020-agent-harness-concept\.md"/);
            expect(() => lintPublicDocs({root: repoOutsideLink})).toThrow(/broken relative Markdown link "\.\.\/apps\/agentos\/design\/sketch\.html"/)
        } finally {
            for (const dir of [extraLeafRoot, extraEntryRoot, mountDriftRoot, badPrefixRoot, fencedRoot, brokenLinkRoot, unlistedAdrLink, repoOutsideLink]) {
                fs.rmSync(dir, {recursive: true, force: true})
            }
        }
    })
});
