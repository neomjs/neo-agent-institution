import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * A repository slug as GitHub spells it: `owner/name`. A name of `.` or `..` is a path step the browser resolves
 * away, not a repository.
 * @type {RegExp}
 */
const ORIGIN = /^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/;

/**
 * A session id as Memory Core mints it.
 * @type {RegExp}
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @summary Where a graph node's evidence lives: the vocabulary the Observatory's Open action reads. A canonical
 * GitHub work item opens on GitHub, a session or its summary opens that session's Memories drill, and any other
 * node has no source view.
 *
 * A source is read from the node's identity alone, and only where the identity vouches for it. The scene's ids
 * are `origin#id` ({@link AgentOS.util.GraphSceneEnvelope}): the origin is the repository the node came from and
 * the local id is the graph's own. The kind and the local id must agree (an `ISSUE` whose local id is
 * `issue-<number>`), so a non-canonical identity such as `ISSUE:<number>`, which the graph also holds, has no
 * source: a link the graph cannot vouch for renders exactly like a real one. Once the scene carries a source
 * column of its own, {@link #sourceOf} reads that instead.
 *
 * Every vocabulary is a config, so `Neo.overwrites` or a subclass extends it.
 * @class AgentOS.util.GraphNodeSource
 * @extends Neo.core.Base
 * @singleton
 */
class GraphNodeSource extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.GraphNodeSource'
         * @protected
         */
        className: 'AgentOS.util.GraphNodeSource',
        /**
         * The work-item kinds GitHub holds, by node kind: the local id's prefix before `-<number>`, and the path
         * segment the item's page lives under in its repository.
         * @member {Object} github
         */
        github: {
            DISCUSSION  : {local: 'discussion', path: 'discussions'},
            ISSUE       : {local: 'issue',      path: 'issues'},
            PULL_REQUEST: {local: 'pr',         path: 'pull'}
        },
        /**
         * @member {String} githubUrl='https://github.com'
         */
        githubUrl: 'https://github.com',
        /**
         * The session-scoped kinds, by node kind: the local id's prefix before the session id, which the Memories
         * drill reads.
         * @member {Object} sessions={SESSION: 'session:', SESSION_SUMMARY: 'summary_'}
         */
        sessions: {SESSION: 'session:', SESSION_SUMMARY: 'summary_'},
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true
    }

    /**
     * @summary The source of one scene node: its GitHub page, its session, or `null` where its identity vouches
     * for neither. A kind counts only as a vocabulary's own entry, never as a key every object inherits.
     * @param {Object|null} node A scene node, `{id, kind}`
     * @returns {{type: 'github', url: String}|{type: 'session', sessionId: String}|null}
     */
    sourceOf(node) {
        const
            me     = this,
            kind   = node?.kind,
            id     = typeof node?.id === 'string' ? node.id : '',
            hash   = id.indexOf('#'),
            origin = id.slice(0, hash),
            local  = id.slice(hash + 1),
            github = Object.hasOwn(me.github, kind)   ? me.github[kind]   : null,
            prefix = Object.hasOwn(me.sessions, kind) ? me.sessions[kind] : null;

        if (hash < 1 || !ORIGIN.test(origin)) {
            return null
        }

        if (github) {
            const number = local.startsWith(`${github.local}-`) ? local.slice(github.local.length + 1) : '';

            return /^[1-9]\d*$/.test(number) ? {type: 'github', url: `${me.githubUrl}/${origin}/${github.path}/${number}`} : null
        }

        if (prefix && local.startsWith(prefix) && UUID.test(local.slice(prefix.length))) {
            return {type: 'session', sessionId: local.slice(prefix.length)}
        }

        return null
    }
}

export default Neo.setupClass(GraphNodeSource);
