import {setup} from '../../../../setup.mjs';

setup({
    appConfig: {
        name: 'GraphNodeSourceTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import GraphNodeSource from '../../../../../../apps/agentos/util/GraphNodeSource.mjs';

const uuid = '019fe5e8-b963-7e93-8762-c8e4af16bdec';

/**
 * @summary A node's source is read from its identity, and only where the kind and the local id agree: every
 * id shape the live scene holds (Brain dev@83c0e09, 2026-09-29) either names its page or session, or has none.
 */
test.describe('AgentOS.util.GraphNodeSource', () => {
    test('a canonical work item opens its page in the repository its identity names', () => {
        expect(GraphNodeSource.sourceOf({id: 'neomjs/neo#issue-18985', kind: 'ISSUE'}))
            .toEqual({type: 'github', url: 'https://github.com/neomjs/neo/issues/18985'});
        expect(GraphNodeSource.sourceOf({id: 'neomjs/neo#pr-19313', kind: 'PULL_REQUEST'}))
            .toEqual({type: 'github', url: 'https://github.com/neomjs/neo/pull/19313'});
        expect(GraphNodeSource.sourceOf({id: 'neomjs/neo#discussion-19317', kind: 'DISCUSSION'}))
            .toEqual({type: 'github', url: 'https://github.com/neomjs/neo/discussions/19317'});
        expect(GraphNodeSource.sourceOf({id: 'neomjs/neo-agent-brain#issue-603', kind: 'ISSUE'}))
            .toEqual({type: 'github', url: 'https://github.com/neomjs/neo-agent-brain/issues/603'})
    });

    test('an identity that does not vouch for a page has none: no link is guessed', () => {
        [
            {id: 'neomjs/neo#ISSUE:18874',   kind: 'ISSUE'},        // non-canonical, 2,273 in the scene
            {id: 'ISSUE:#10023',             kind: 'ISSUE'},        // never origin-qualified, 769
            {id: 'neomjs/neo#ISSUE:PR_123',  kind: 'ISSUE'},
            {id: 'neomjs/neo#pr-19313',      kind: 'ISSUE'},        // the kind and the local id disagree
            {id: 'neomjs/neo#issue-0',       kind: 'ISSUE'},
            {id: 'neomjs/neo#issue-007',     kind: 'ISSUE'},
            {id: 'neomjs/neo#issue-12a',     kind: 'ISSUE'},
            {id: 'neo#issue-12',             kind: 'ISSUE'},        // an origin GitHub cannot resolve
            {id: '#issue-12',                kind: 'ISSUE'}
        ].forEach(node => expect(GraphNodeSource.sourceOf(node), node.id).toBeNull())
    });

    test('a session and its summary open the session the Memories drill reads', () => {
        expect(GraphNodeSource.sourceOf({id: `neomjs/neo#session:${uuid}`, kind: 'SESSION'}))
            .toEqual({type: 'session', sessionId: uuid});
        expect(GraphNodeSource.sourceOf({id: `neomjs/neo#summary_${uuid}`, kind: 'SESSION_SUMMARY'}))
            .toEqual({type: 'session', sessionId: uuid});

        [
            {id: 'neomjs/neo#session:audit_212',    kind: 'SESSION'},  // no session id, 5,350 in the scene
            {id: 'SESSION:S01',                     kind: 'SESSION'},
            {id: `neomjs/neo#summary_${uuid}`,      kind: 'SESSION'},  // the kind and the prefix disagree
            {id: `neomjs/neo#memory:${uuid}`,       kind: 'MEMORY'}    // a memory names itself, not its session
        ].forEach(node => expect(GraphNodeSource.sourceOf(node), node.id).toBeNull())
    });

    test('every other kind has no source view, and no node is not a node', () => {
        [
            {id: 'neomjs/neo#observatory',                                  kind: 'CONCEPT'},
            {id: `neomjs/neo#MESSAGE:${uuid}`,                              kind: 'MESSAGE'},
            {id: 'neomjs/neo#file-src/Neo.mjs',                             kind: 'FILE'},
            {id: 'neomjs/neo#GAP:KB_GAP-06d1b9de',                          kind: 'KB_GAP'},
            {id: 'neomjs/neo#issue-18985'}
        ].forEach(node => expect(GraphNodeSource.sourceOf(node), node.id).toBeNull());

        expect(GraphNodeSource.sourceOf(null)).toBeNull();
        expect(GraphNodeSource.sourceOf({kind: 'ISSUE'})).toBeNull()
    })
});
