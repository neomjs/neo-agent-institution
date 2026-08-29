import {setup} from '../../../../../../setup.mjs';

const appName = 'FleetMailboxRowTest';

setup({
    neoConfig: {
        allowVdomUpdatesInTests: true,
        unitTestMode           : true,
        useDomApiRenderer      : true
    },
    appConfig: {
        name: appName
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

/**
 * The designed mailbox row grammar, pinned at the cell layer (the merged #36/#38 sketch is the
 * scored spec): status renders as dot + weight (two channels), the exception strip is T2
 * exception-only (a direct/normal/plain/read message renders zero chips and NO strip node), the
 * thread toggle is a native button with aria-expanded, ages are viewer-local with the exact ISO
 * on `title`, and a pool recycle (assigning a new record to the SAME instance) re-renders in place.
 */
test.describe('Fleet mailbox RowComponent — the sketch\'s row grammar from one record', () => {
    let RowComponent;

    const baseRecord = {
        messageId     : 'MESSAGE:1',
        subject       : '[review-requested][Brain PR #207]',
        from          : '@neo-gpt-emmy',
        recipientClass: 'agent',
        priority      : null,
        status        : 'read',
        taskState     : null,
        partOfThread  : null,
        relatedTickets: null,
        sentAt        : '2026-08-28T15:54:27.998Z'
    };

    const makeRow = (fields = {}, config = {}) =>
        Neo.create(RowComponent, {appName, rowData: {...baseRecord, ...fields}, ...config});

    const nodeBy = (row, cls) => {
        const walk = nodes => {
            for (const node of nodes || []) {
                if (node.cls?.includes(cls)) return node;
                const hit = walk(node.cn);
                if (hit) return hit
            }
            return null
        };
        return walk(row.vdom.cn)
    };

    test.beforeAll(async () => {
        RowComponent = (await import('../../../../../../../../apps/agentos/view/fleet/mailbox/RowComponent.mjs')).default
    });

    test('the full exception row: unread weight channel, every deviation chip, ticket tail, ISO receipt', () => {
        const row = makeRow({
            status        : 'unread',
            priority      : 'high',
            taskState     : 'Submitted',
            recipientClass: 'broadcast',
            relatedTickets: [196, 198, 210]
        });

        expect(row.cls).toContain('is-unread');
        expect(nodeBy(row, 'fm-mail-udot').title).toBeTruthy();
        expect(nodeBy(row, 'fm-mail-smark').text).toBe('em');
        expect(nodeBy(row, 'fm-mail-sender').text).toBe('@neo-gpt-emmy');
        expect(nodeBy(row, 'fm-mail-subject').text).toBe('[review-requested][Brain PR #207]');

        const strip = nodeBy(row, 'fm-mail-xstrip');
        expect(strip.cn.map(node => node.text)).toEqual(['high', 'task · Submitted', 'broadcast', '#196 · #198 +1']);

        const age = nodeBy(row, 'fm-mail-age');
        expect(age.text).toMatch(/\d{2}:\d{2}/);
        expect(age.title).toBe('2026-08-28T15:54:27.998Z');

        row.destroy()
    });

    test('the zero-exception row earns zero chips — the strip node itself is absent', () => {
        const row = makeRow();

        expect(row.cls).not.toContain('is-unread');
        expect(nodeBy(row, 'fm-mail-xstrip')).toBeNull();
        expect(nodeBy(row, 'fm-mail-udot').title).toBeFalsy();

        row.destroy()
    });

    test('retracted: strike class + the named word replace the ticket tail', () => {
        const row = makeRow({status: 'retracted', relatedTickets: [17835]});

        expect(row.cls).toContain('status-retracted');
        expect(nodeBy(row, 'fm-mail-tickets').text).toBe('retracted');

        row.destroy()
    });

    test('a collapsed thread head renders the native toggle with its count and aria state', () => {
        // the facts ride ON the record (the grid stamps them — the record version is what
        // survives the pooled cell's short-circuit)
        const row = makeRow({partOfThread: 'T1', threadFacts: {isHead: true, collapsed: true, hiddenCount: 3, inThread: false}});

        const toggle = nodeBy(row, 'fm-mail-thread-toggle');
        expect(toggle.tag).toBe('button');
        expect(toggle.text).toBe('+3 earlier');
        expect(toggle['aria-expanded']).toBe('false');

        row.rowData = {...row.rowData, threadFacts: {isHead: true, collapsed: false, hiddenCount: 3, inThread: false}};

        const expanded = nodeBy(row, 'fm-mail-thread-toggle');
        expect(expanded.text).toBe('collapse thread');
        expect(expanded['aria-expanded']).toBe('true');

        row.destroy()
    });

    test('a thread member indents on the rail and renders no toggle', () => {
        const row = makeRow({partOfThread: 'T1', threadFacts: {isHead: false, collapsed: false, hiddenCount: 3, inThread: true}});

        expect(row.cls).toContain('is-in-thread');
        expect(nodeBy(row, 'fm-mail-thread-toggle')).toBeNull();

        row.destroy()
    });

    test('the pool recycle contract: a new record on the SAME instance re-renders every channel', () => {
        const row = makeRow({status: 'unread', priority: 'high'});

        expect(row.cls).toContain('is-unread');

        row.rowData = {...baseRecord, from: '@neo-opus-vega', subject: '[assignment triage DONE]'};

        expect(row.cls).not.toContain('is-unread');
        expect(nodeBy(row, 'fm-mail-smark').text).toBe('ve');
        expect(nodeBy(row, 'fm-mail-subject').text).toBe('[assignment triage DONE]');
        expect(nodeBy(row, 'fm-mail-xstrip')).toBeNull();

        row.destroy()
    });

    test('hostile content renders as text-only leaves — no node anywhere carries html', () => {
        // layer 2 of the mailbox double defense (layer 1, the record String convert, is pinned in
        // container.spec.mjs): whatever string reaches this cell renders as escaped text, never markup
        const row = makeRow({subject: 'deploy <img src=x onerror=alert(1)> done', from: '@evil<script>'});

        const walk = node => {
            if (!node || typeof node !== 'object') return;
            expect(node.html).toBe(undefined);
            (node.cn || []).forEach(walk)
        };
        walk(row.vdom);

        expect(nodeBy(row, 'fm-mail-subject').text).toBe('deploy <img src=x onerror=alert(1)> done');

        row.destroy()
    });

    test('the monogram derivation is deterministic over handle shapes', () => {
        expect(RowComponent.monogram('@neo-gpt-emmy')).toBe('em');
        expect(RowComponent.monogram('@neo-opus-vega')).toBe('ve');
        expect(RowComponent.monogram('@tobiu')).toBe('to');
        expect(RowComponent.monogram('@neo-gpt')).toBe('gp')
    });
});
