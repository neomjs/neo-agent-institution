import fs              from 'node:fs';
import path            from 'node:path';
import process         from 'node:process';
import {fileURLToPath} from 'node:url';

/**
 * @module buildScripts.lintPublicDocs
 * @summary Validates `docs/public-manifest.json` against `learn/tree.json`, excludes ADR/operational directories,
 * and enforces public-publish hygiene across every manifest-admitted Markdown guide.
 */

const
    __filename       = fileURLToPath(import.meta.url),
    REPO_ROOT        = path.resolve(path.dirname(__filename), '..'),
    EXPECTED_SCHEMA  = 'public-manifest.v1',
    EXPECTED_SPOKE   = 'neomjs/neo-agent-institution',
    EXCLUDED_SUBDIRS = ['learn/agentos/decisions/', 'learn/agentos/measurements/', 'learn/agentos/incidents/'],
    UNIX_HOST_PATH_RE = /(?:^|[\s`'"(=:]|file:\/\/)(\/(?:Users|home)\/(?![<{]|(?:you|user|username)(?:\/|\b))[A-Za-z0-9._-]+\/[^\s`'")>\]]*)/gm,
    WIN_HOST_PATH_RE  = /(?:^|[\s`'"(=:]|file:\/\/\/?)([A-Za-z]:[\\/]Users[\\/](?![<{]|(?:you|user|username)(?:[\\/]|\b))[A-Za-z0-9._-]+[\\/][^\s`'")>\]]*)/gm,
    PRIVATE_REPO_RE   = /\bneomjs\/(?:business|neo-stage|neo-pro)\b/gi,
    REL_LINK_RE       = /\[(?:[^\[\]]|\[[^\]]*\])*\]\(([^)\s]+)\)/g,
    INLINE_CODE_RE    = /`[^`\n]+`/g,
    FENCE_RE          = /^ {0,3}(`{3,}|~{3,})/;

/**
 * @summary Strips fenced Markdown code blocks while preserving line numbers for diagnostics.
 * @param {String} markdown
 * @returns {String}
 */
export function stripFencedCodeBlocks(markdown) {
    const
        lines = String(markdown).split('\n'),
        out   = [];

    let fence = null;

    for (const rawLine of lines) {
        const
            line  = rawLine.replace(/\r$/, ''),
            match = FENCE_RE.exec(line);

        if (fence) {
            if (match && match[1][0] === fence[0] && match[1].length >= fence.length) {
                fence = null
            }
            out.push('');
            continue
        }

        if (match) {
            fence = match[1];
            out.push('');
            continue
        }

        out.push(line)
    }

    return out.join('\n')
}

function lineAt(text, index) {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) {
        if (text[i] === '\n') line++
    }
    return line
}

/**
 * @summary Validates `docs/public-manifest.json`, `learn/tree.json`, and all admitted Markdown files under `root`.
 * @param {Object} [options={}]
 * @returns {{entryCount: Number, routes: String[]}}
 */
export function lintPublicDocs({
    root            = REPO_ROOT,
    manifestRelPath = 'docs/public-manifest.json',
    routePrefix     = null,
    expectedSpoke   = EXPECTED_SPOKE
} = {}) {
    const
        errors       = [],
        manifestPath = path.resolve(root, manifestRelPath);

    if (!fs.existsSync(manifestPath)) {
        throw new Error(`[public-docs] Missing manifest: ${manifestRelPath}`)
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
        throw new Error(`[public-docs] Invalid JSON in ${manifestRelPath}: ${err.message}`)
    }

    if (manifest?.schema !== EXPECTED_SCHEMA) {
        errors.push(`schema must be "${EXPECTED_SCHEMA}" (got ${JSON.stringify(manifest?.schema)})`)
    }
    if (manifest?.spoke !== expectedSpoke) {
        errors.push(`spoke must be "${expectedSpoke}" (got ${JSON.stringify(manifest?.spoke)})`)
    }
    if (typeof manifest?.treeFile !== 'string' || !manifest.treeFile.trim()) {
        errors.push('treeFile must be a non-empty relative path')
    }
    if (
        !manifest?.treeMount ||
        typeof manifest.treeMount.id !== 'string' ||
        !manifest.treeMount.id.trim() ||
        manifest.treeMount.id.startsWith('/') ||
        manifest.treeMount.id.endsWith('/') ||
        manifest.treeMount.id.includes('..') ||
        typeof manifest.treeMount.name !== 'string'
    ) {
        errors.push('treeMount must declare normalized string id and name fields')
    }
    if (!Array.isArray(manifest?.entries) || manifest.entries.length === 0) {
        errors.push('entries must be a non-empty array')
    }

    if (errors.length > 0) {
        throw new Error(`[public-docs] ${manifestRelPath} failed header validation:\n  - ${errors.join('\n  - ')}`)
    }

    const effectivePrefix = routePrefix ?? `/learn/${manifest.treeMount.id}/`;

    const treePath = path.resolve(root, manifest.treeFile);
    if (!fs.existsSync(treePath)) {
        throw new Error(`[public-docs] Missing treeFile declared by manifest: ${manifest.treeFile}`)
    }

    const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
    if (!Array.isArray(tree?.data)) {
        throw new Error(`[public-docs] ${manifest.treeFile} must contain a top-level "data" array`)
    }

    const
        learnRoot      = path.resolve(root, 'learn'),
        treeLeafByFile = new Map();

    for (const node of tree.data) {
        if (node.isLeaf !== false) {
            const relFile = `learn/${node.id}.md`;
            treeLeafByFile.set(relFile, node.id)
        }
    }

    const
        seenFiles        = new Set(),
        seenRoutes       = new Set(),
        admittedAbsFiles = new Set();

    for (const entry of manifest.entries) {
        if (entry && typeof entry.file === 'string' && !entry.file.includes('..') && entry.file.startsWith('learn/') && entry.file.endsWith('.md')) {
            const absCandidate = path.resolve(root, entry.file);
            if (absCandidate.startsWith(learnRoot + path.sep) && fs.existsSync(absCandidate) && fs.statSync(absCandidate).isFile()) {
                admittedAbsFiles.add(absCandidate)
            }
        }
    }

    for (const [index, entry] of manifest.entries.entries()) {
        const label = `entries[${index}]`;

        if (!entry || typeof entry.file !== 'string' || typeof entry.route !== 'string') {
            errors.push(`${label}: each entry requires string "file" and "route"`);
            continue
        }

        const normalizedFile = path.posix.normalize(entry.file);
        if (normalizedFile !== entry.file || !entry.file.startsWith('learn/') || !entry.file.endsWith('.md') || entry.file.includes('..')) {
            errors.push(`${label}: invalid file path "${entry.file}" (must be normalized "learn/<path>.md")`);
            continue
        }

        if (EXCLUDED_SUBDIRS.some(prefix => entry.file.startsWith(prefix))) {
            errors.push(`${label}: excluded internal record "${entry.file}" cannot be published`)
        }

        if (seenFiles.has(entry.file)) {
            errors.push(`${label}: duplicate file "${entry.file}"`)
        }
        seenFiles.add(entry.file);

        if (!entry.route.startsWith(effectivePrefix) || entry.route.endsWith('/') || entry.route.endsWith('.md') || entry.route.includes('..')) {
            errors.push(`${label}: invalid route "${entry.route}" (must start with "${effectivePrefix}" without trailing "/" or ".md")`)
        }

        const expectedId = treeLeafByFile.get(entry.file);
        if (expectedId && entry.route !== `${effectivePrefix}${expectedId}`) {
            errors.push(`${label}: route "${entry.route}" does not match expected spoke route "${effectivePrefix}${expectedId}"`)
        }

        if (seenRoutes.has(entry.route)) {
            errors.push(`${label}: duplicate route "${entry.route}"`)
        }
        seenRoutes.add(entry.route);

        const absFile = path.resolve(root, entry.file);
        if (!absFile.startsWith(learnRoot + path.sep) || !fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
            errors.push(`${label}: missing Markdown file "${entry.file}"`);
            continue
        }

        const
            rawMarkdown = fs.readFileSync(absFile, 'utf-8'),
            proseOnly   = stripFencedCodeBlocks(rawMarkdown);

        for (const [regex, kind] of [
            [UNIX_HOST_PATH_RE, 'host filesystem path'],
            [WIN_HOST_PATH_RE,  'Windows host filesystem path']
        ]) {
            regex.lastIndex = 0;
            for (const match of rawMarkdown.matchAll(regex)) {
                const
                    token = match[1],
                    line  = lineAt(rawMarkdown, match.index + match[0].indexOf(token));
                errors.push(`${entry.file}:${line}: forbidden ${kind} "${token}"`)
            }
        }

        PRIVATE_REPO_RE.lastIndex = 0;
        for (const match of rawMarkdown.matchAll(PRIVATE_REPO_RE)) {
            const line = lineAt(rawMarkdown, match.index);
            errors.push(`${entry.file}:${line}: forbidden private-repository reference "${match[0]}"`)
        }

        const linkScanText = proseOnly.replace(INLINE_CODE_RE, match => ' '.repeat(match.length));

        REL_LINK_RE.lastIndex = 0;
        for (const match of linkScanText.matchAll(REL_LINK_RE)) {
            const
                rawTarget = match[1],
                target    = rawTarget.split(/[?#]/)[0];

            if (!target || /^(?:https?:|mailto:)/i.test(rawTarget) || rawTarget.startsWith('#') || rawTarget.startsWith('/')) continue;

            const
                resolvedExact = path.resolve(path.dirname(absFile), target),
                resolvedMd    = target.endsWith('.md') ? resolvedExact : path.resolve(path.dirname(absFile), `${target}.md`);

            if (!admittedAbsFiles.has(resolvedExact) && !admittedAbsFiles.has(resolvedMd)) {
                const line = lineAt(linkScanText, match.index);
                errors.push(`${entry.file}:${line}: broken relative Markdown link "${target}" (must resolve to a manifest-admitted guide)`)
            }
        }
    }

    for (const relFile of treeLeafByFile.keys()) {
        if (!seenFiles.has(relFile)) {
            errors.push(`${manifest.treeFile}: leaf "${relFile}" is missing from ${manifestRelPath}`)
        }
    }

    for (const relFile of seenFiles) {
        if (!treeLeafByFile.has(relFile)) {
            errors.push(`${manifestRelPath}: "${relFile}" is not a leaf in ${manifest.treeFile}`)
        }
    }

    if (errors.length > 0) {
        throw new Error(`[public-docs] Validation failed (${errors.length} issue(s)):\n  - ${errors.join('\n  - ')}`)
    }

    return {
        entryCount: manifest.entries.length,
        routes    : [...seenRoutes]
    }
}

const isMainModule = (() => {
    if (!process.argv[1]) return false;
    try {
        return fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)
    } catch {
        return path.resolve(process.argv[1]) === __filename
    }
})();

if (isMainModule) {
    try {
        const {entryCount} = lintPublicDocs();
        console.log(`[public-docs] OK — verified ${entryCount} manifest-listed guides against learn/tree.json.`)
    } catch (err) {
        console.error(err.message);
        process.exit(1)
    }
}
