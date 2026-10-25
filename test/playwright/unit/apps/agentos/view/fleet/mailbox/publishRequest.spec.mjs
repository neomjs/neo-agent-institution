import {setup} from '../../../../../../setup.mjs';

setup({
    neoConfig: {unitTestMode: true},
    appConfig: {name: 'PublishRequestGateUnitTest'}
});

import {test, expect}          from '@playwright/test';
import Neo                     from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core               from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import InstanceManager         from '../../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import DetailContainer         from '../../../../../../../../apps/agentos/view/fleet/mailbox/DetailContainer.mjs';
import OperatorInbox           from '../../../../../../../../apps/agentos/util/OperatorInbox.mjs';
import PublishRequestComponent from '../../../../../../../../apps/agentos/view/fleet/mailbox/PublishRequestComponent.mjs';
import PublishSwitch           from '../../../../../../../../apps/agentos/util/PublishSwitch.mjs';
import PublishSwitchComponent  from '../../../../../../../../apps/agentos/view/fleet/detail/PublishSwitchComponent.mjs';

/**
 * Helper to collect all text strings in a VDOM subtree.
 * @param {Object} node
 * @returns {String}
 */
function textOfVdom(node) {
    if (!node || typeof node !== 'object' || node.removeDom) return '';
    const own = typeof node.text === 'string' ? node.text : '';
    const children = Array.isArray(node.cn) ? node.cn.map(textOfVdom).filter(Boolean).join(' ') : '';
    return [own, children].filter(Boolean).join(' ')
}

/**
 * Helper to find the first VDOM node whose `cls` array includes `clsName`.
 * @param {Object} node
 * @param {String} clsName
 * @returns {Object|null}
 */
function findByCls(node, clsName) {
    if (!node || typeof node !== 'object' || node.removeDom) return null;
    if (Array.isArray(node.cls) && node.cls.includes(clsName)) return node;
    for (const child of node.cn || []) {
        const hit = findByCls(child, clsName);
        if (hit) return hit
    }
    return null
}

test.describe('Operator inbox publish request card & gate switch (Institution #673)', () => {
    const samplePayload = {
        schemaVersion: 1,
        channel      : 'x',
        account      : '@neomjs',
        format       : 'post',
        text         : 'Walk a second road across the graph.',
        media        : [{
            uri     : 'file:///tmp/diagram.png',
            mimeType: 'image/png',
            sha256  : 'a'.repeat(64),
            verified: true
        }],
        inReplyTo : '189001234567890',
        hypothesis: 'Developers respond to verifiable architectural receipts.'
    };

    const sampleDigest = OperatorInbox.computeRevisionDigest(samplePayload);

    test('AC-1: renders channel, account, format, text, verified/unverified media, reply target, hypothesis, digest, attestation, and switch chip; missing fields read as absent', () => {
        const card = Neo.create(PublishRequestComponent, {
            switchState: 'auto-approve after a cross-family review attestation',
            message    : {
                messageId      : 'MESSAGE:pub-1',
                from           : '@neo-gemini-maryam',
                inReplyToText  : 'How does the Fleet gate outbound posts?',
                requestPublish : samplePayload,
                revision       : {
                    revisionNumber: 1,
                    revisionDigest: sampleDigest,
                    payload       : samplePayload,
                    attestation   : {
                        reviewer      : '@neo-opus-grace',
                        family        : 'claude',
                        revisionNumber: 1,
                        revisionDigest: sampleDigest
                    },
                    approval: {
                        approvedBy    : '@tobiu',
                        revisionNumber: 1,
                        revisionDigest: sampleDigest
                    }
                },
                publication: {
                    state: 'queued'
                },
                task: {
                    state   : 'InputRequired',
                    assignee: '@tobiu'
                }
            }
        });

        const fullText = textOfVdom(card.vdom);
        expect(fullText).toContain('x · @neomjs · post');
        expect(fullText).toContain('Walk a second road across the graph.');
        expect(fullText).toContain('in reply to “How does the Fleet gate outbound posts?” (189001234567890)');
        expect(fullText).toContain(`rev 1 · ${sampleDigest.slice(0, 8)}`);
        expect(fullText).toContain('@neo-opus-grace · claude · attests rev 1');
        expect(fullText).toContain('auto-approve after a cross-family review attestation');
        expect(fullText).toContain('approved by @tobiu · rev 1');
        expect(fullText).toContain('Hypothesis: Developers respond to verifiable architectural receipts.');
        expect(findByCls(card.vdom, 'fm-publish-media-thumb')).not.toBeNull();

        // Missing fields read as absent, never placeholder values; remote media never renders an <img>
        card.set({
            message: {
                messageId     : 'MESSAGE:pub-2',
                from          : '@neo-gemini-maryam',
                requestPublish: {
                    schemaVersion: 1,
                    channel      : 'linkedin',
                    account      : 'neomjs-org',
                    format       : 'article',
                    text         : 'Minimal post with unverified remote media.',
                    media        : [{
                        uri     : 'https://example.com/remote.png',
                        mimeType: 'image/png',
                        sha256  : 'b'.repeat(64),
                        verified: true
                    }],
                    inReplyTo : null,
                    hypothesis: ''
                },
                task: {state: 'InputRequired', assignee: '@tobiu'}
            }
        });

        const sparseText = textOfVdom(card.vdom);
        expect(sparseText).toContain('linkedin · neomjs-org · article');
        expect(sparseText).toContain('no reply target');
        expect(sparseText).toContain('no cross-family attestation');
        expect(sparseText).toContain('no hypothesis');
        expect(sparseText).toContain('waiting for a cross-family attestation — or your approval');
        expect(sparseText).toContain('https://example.com/remote.png · image/png · unverified');
        expect(findByCls(card.vdom, 'fm-publish-media-thumb')).toBeNull();

        card.destroy()
    });

    test('AC-2: Approve sends displayed revision digest; Edit creates rev N+1 with new digest and clears approval and attestation; Drop requires reason and sends Rejected', () => {
        const events = [];
        const card   = Neo.create(PublishRequestComponent, {
            message: {
                messageId     : 'MESSAGE:pub-edit-1',
                from          : '@neo-gemini-maryam',
                requestPublish: samplePayload,
                revision      : {
                    revisionNumber: 1,
                    revisionDigest: sampleDigest,
                    payload       : samplePayload,
                    attestation   : {
                        reviewer      : '@neo-opus-grace',
                        family        : 'claude',
                        revisionNumber: 1,
                        revisionDigest: sampleDigest
                    },
                    approval: {
                        approvedBy    : '@tobiu',
                        revisionNumber: 1,
                        revisionDigest: sampleDigest
                    }
                },
                task: {state: 'InputRequired', assignee: '@tobiu'}
            }
        });

        card.on({
            approvePublishRequest: data => events.push({type: 'approve', ...data}),
            editPublishRequest   : data => events.push({type: 'edit', ...data}),
            dropPublishRequest   : data => events.push({type: 'drop', ...data})
        });

        // 1. Approve rev 1 sends the displayed revision digest
        card.onApproveClick();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type          : 'approve',
            messageId     : 'MESSAGE:pub-edit-1',
            revisionNumber: 1,
            revisionDigest: sampleDigest
        });

        // 2. Edit text & remove media -> creates rev 2 with new digest and clears approval and attestation
        const editResult = card.applyEdit({
            text : 'Edited post text for revision 2.',
            media: []
        });

        expect(editResult.revisionNumber).toBe(2);
        expect(editResult.revisionDigest).not.toBe(sampleDigest);

        const modelAfterEdit = card.resolveModel();
        expect(modelAfterEdit.revisionNumber).toBe(2);
        expect(modelAfterEdit.revisionDigest).toBe(editResult.revisionDigest);
        expect(modelAfterEdit.approval).toBeNull();
        expect(modelAfterEdit.attestation).toBeNull();

        const postEditText = textOfVdom(card.vdom);
        expect(postEditText).toContain(`rev 2 · ${editResult.revisionDigest.slice(0, 8)}`);
        expect(postEditText).toContain('no cross-family attestation');
        expect(postEditText).not.toContain('approved by @tobiu');
        expect(postEditText).toContain('new revision 2 — attestation and approval cleared');
        expect(postEditText).toContain('no media');

        // Second click on Approve now sends rev 2's digest
        card.onApproveClick();
        expect(events.at(-1)).toMatchObject({
            type          : 'approve',
            messageId     : 'MESSAGE:pub-edit-1',
            revisionNumber: 2,
            revisionDigest: editResult.revisionDigest
        });

        // 3. Drop requires a reason and sends Rejected
        expect(card.submitDrop('   ')).toBe(false);
        expect(textOfVdom(card.vdom)).toContain('A reason is required to drop a publish request.');

        expect(card.submitDrop('Out of release scope')).toBe(true);
        expect(events.at(-1)).toMatchObject({
            type                : 'drop',
            messageId           : 'MESSAGE:pub-edit-1',
            expectedCurrentState: 'InputRequired',
            newState            : 'Rejected',
            reason              : 'Out of release scope'
        });

        card.destroy()
    });

    test('AC-3: generic Resolve is hidden and inert on requestPublish Tasks; read/reply set no publication state; outcome line renders all 5 states', () => {
        const detail = Neo.create(DetailContainer, {
            entry         : 'operator',
            viewerIdentity: '@tobiu',
            row           : {
                messageId: 'MESSAGE:pub-3',
                from     : '@neo-gemini-maryam',
                to       : '@tobiu',
                subject  : '[publish] X post',
                status   : 'unread',
                sentAt   : '2026-10-25T05:00:00.000Z',
                task     : {state: 'InputRequired', assignee: '@tobiu'}
            },
            read: {
                messageId: 'MESSAGE:pub-3',
                state    : 'ok',
                message  : {
                    messageId     : 'MESSAGE:pub-3',
                    from          : '@neo-gemini-maryam',
                    body          : 'Please review outbound X post.',
                    requestPublish: samplePayload,
                    task          : {state: 'InputRequired', assignee: '@tobiu'}
                }
            }
        });

        const resolveEvents = [];
        detail.on('resolveRequest', data => resolveEvents.push(data));

        expect(detail.isPublishRequest).toBe(true);
        expect(detail.canResolve()).toBe(false);
        expect(detail.getReference('detail-resolve').hidden).toBe(true);
        expect(detail.getReference('publish-card').hidden).toBe(false);

        // Even a direct programmatic call to onResolveClick() fires no resolveRequest
        detail.onResolveClick();
        expect(resolveEvents).toHaveLength(0);

        // Mark read and reply leave publication state untouched (`queued`, no receipt)
        detail.onMarkReadClick();
        detail.onReplyClick();
        const card = detail.getReference('publish-card');
        expect(card.resolveModel().publicationState).toBe('queued');
        expect(findByCls(card.vdom, 'fm-publish-receipt-link')).toBeNull();

        // Generic Task Completed without publication.state='published' + providerId renders no receipt
        detail.read = {
            messageId: 'MESSAGE:pub-3',
            state    : 'ok',
            message  : {
                messageId     : 'MESSAGE:pub-3',
                from          : '@neo-gemini-maryam',
                requestPublish: samplePayload,
                task          : {state: 'Completed', assignee: '@tobiu'}
            }
        };
        expect(card.resolveModel().publicationState).toBe('queued');
        expect(findByCls(card.vdom, 'fm-publish-receipt-link')).toBeNull();

        // Outcome line renders each of the 5 publication states
        for (const [state, extra, expectedText] of [
            ['queued',     {},                                                       'queued'],
            ['publishing', {reservedAt: '2026-10-25T05:01:00.000Z'},                 'publishing'],
            ['unresolved', {reason: 'process crashed after reservation'},            'unresolved — process crashed after reservation'],
            ['published',  {providerId: '1890099999', readbackAt: '2026-10-25T05:02:00.000Z'}, '1890099999'],
            ['refused',    {refusalReason: 'attestation-missing'},                   'refused — attestation-missing']
        ]) {
            card.message = {
                messageId     : 'MESSAGE:pub-3',
                from          : '@neo-gemini-maryam',
                requestPublish: samplePayload,
                publication   : {state, ...extra},
                task          : {state: 'InputRequired', assignee: '@tobiu'}
            };
            expect(textOfVdom(card.vdom), state).toContain(expectedText);
            if (state === 'published') {
                const link = findByCls(card.vdom, 'fm-publish-receipt-link');
                expect(link).not.toBeNull();
                expect(link.href).toBe('https://x.com/neomjs/status/1890099999')
            }
        }

        detail.destroy()
    });

    test('AC-4 (unit): PublishSwitchComponent renders 4 states per channel, audit & proposal lines, one-click downgrade, confirmed promote with reason + expectedFrom, and rejects set() mutation', () => {
        const writeCalls = [],
              readCalls  = [],
              view       = Neo.create(PublishSwitchComponent, {
                  record: {agentId: 'neo-gemini-maryam', githubUsername: 'neo-gemini-maryam'}
              });

        view.on({
            setPublishSwitch   : data => writeCalls.push(data),
            readPublishSwitches: data => readCalls.push(data)
        });

        view.applyFleetSwitches({
            peer    : '@neo-gemini-maryam',
            channels: {
                x: {
                    state: 'approve the batch',
                    audit: [{
                        who   : '@tobiu',
                        when  : '2026-10-25T04:00:00.000Z',
                        from  : 'approve each',
                        to    : 'approve the batch',
                        reason: ' trusted release notes thread '
                    }],
                    proposal: {
                        by           : '@neo-gemini-maryam',
                        when         : '2026-10-25T04:30:00.000Z',
                        proposedState: 'auto-approve after a cross-family review attestation',
                        reason       : '10 consecutive clean X posts'
                    }
                },
                linkedin: {
                    state   : 'approve each',
                    audit   : [],
                    proposal: null
                }
            }
        });

        const initialText = textOfVdom(view.vdom);
        expect(initialText).toContain('Publishing');
        expect(initialText).toContain('@tobiu');
        expect(initialText).toContain('approve each → approve the batch');
        expect(initialText).toContain('proposed by @neo-gemini-maryam');
        expect(initialText).toContain('10 consecutive clean X posts');

        // 1. One-click downgrade (`approve the batch` -> `approve each`) fires immediately
        view.selectChannelState('x', 'approve each');
        expect(writeCalls).toHaveLength(1);
        expect(writeCalls[0]).toMatchObject({
            peer        : '@neo-gemini-maryam',
            channel     : 'x',
            to          : 'approve each',
            expectedFrom: 'approve the batch',
            reason      : 'operator downgrade'
        });

        // 2. Promote (`approve the batch` -> `auto-approve`) opens inline confirmation and requires a reason
        view.selectChannelState('x', 'auto-approve');
        expect(writeCalls).toHaveLength(1);
        expect(textOfVdom(view.vdom)).toContain('Promote x: approve the batch → auto-approve');

        // Confirm without reason refuses locally without calling setPublishSwitch
        view.onConfirmPromoteClick({path: [{cls: ['fm-publish-switch-promote-confirm'], data: {channel: 'x'}}]});
        expect(writeCalls).toHaveLength(1);
        expect(textOfVdom(view.vdom)).toContain('Promote requires a reason.');

        // Supply reason and confirm -> fires setPublishSwitch with expectedFrom + reason
        view.onPromoteReasonInput({
            path : [{cls: ['fm-publish-switch-promote-reason'], data: {channel: 'x'}}],
            value: 'Verified release campaign'
        });
        view.onConfirmPromoteClick({path: [{cls: ['fm-publish-switch-promote-confirm'], data: {channel: 'x'}}]});
        expect(writeCalls).toHaveLength(2);
        expect(writeCalls[1]).toMatchObject({
            peer        : '@neo-gemini-maryam',
            channel     : 'x',
            to          : 'auto-approve',
            expectedFrom: 'approve the batch',
            reason      : 'Verified release campaign'
        });

        // 3. Direct property write (`set_instance_properties` equivalent) never writes to Fleet and triggers re-read
        view.set({
            xState  : 'auto-approve',
            switches: {x: {state: 'auto-approve'}, linkedin: {state: 'auto-approve'}}
        });
        expect(writeCalls, 'no setPublishSwitch call on direct property mutation').toHaveLength(2);
        expect(readCalls).toMatchObject([{peer: '@neo-gemini-maryam'}]);
        expect(view.xState).toBe('approve the batch');
        expect(view.linkedinState).toBe('approve each');

        view.destroy()
    });
});
