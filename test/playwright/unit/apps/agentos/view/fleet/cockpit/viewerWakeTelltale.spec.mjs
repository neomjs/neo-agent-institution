import {setup} from '../../../../../../setup.mjs';

setup({
    appConfig: {
        name: 'ViewerWakeTelltaleTest'
    }
});

import {test, expect} from '@playwright/test';
import Neo            from '../../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core      from '../../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';

import ViewerWakeTelltale from '../../../../../../../../apps/agentos/util/ViewerWakeTelltale.mjs';

/**
 * The per-viewer wake-push telltale derivation. The load-bearing properties: the
 * consumer's vocabulary passes through VERBATIM (`alive: true` is the only positive state, every
 * reason string renders unedited), the catch-up axis keeps its three states apart with `null` as
 * honest absence, and state never travels by hue alone — the text always carries the message.
 */
test.describe('viewerWakeTelltale — the quiet chrome readout of MY push lane', () => {
    const NOW = 1_000_000;

    test('armed and live with a fresh signal: visible, one quiet token plus the relative receipt age', () => {
        const {ariaLabel, cls, hidden, text, title} = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed  : true,
            stream : {alive: true, reason: 'composed wake stream connected · armed for this viewer', capturedAt: NOW},
            catchUp: {state: 'fresh', at: NOW - 5_000, pending: 3},
            signals: [{kind: 'wake/digest', emittedAt: '2026-08-16T19:00:00.000Z', receivedAt: NOW - 12_000}],
            nowMs  : NOW
        });

        expect(hidden).toBe(false);
        expect(text).toBe('wake live · 12s ago');
        expect(cls).toEqual(['fm-viewer-wake', 'fm-viewer-wake-live']);
        expect(ariaLabel).toBe('Viewer wake push: wake live · 12s ago');
        expect(title).toContain('wake push live — composed wake stream connected · armed for this viewer');
        expect(title).toContain('catch-up: fresh (3 pending drained) · 5s ago');
        expect(title).toContain('last signals: wake/digest · 12s ago')
    });

    test('armed and live with no signals yet: visible, the token stands alone and the title says so honestly', () => {
        const {hidden, text, title} = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed : true,
            stream: {alive: true, reason: 'composed wake stream connected · armed for this viewer', capturedAt: NOW},
            nowMs : NOW
        });

        expect(hidden).toBe(false);
        expect(text).toBe('wake live');
        expect(title).toContain('no signals observed on this stream');
        expect(title).toContain('catch-up: no observation')
    });

    test('armed and down: visible wake off with the absence-of-signal reason verbatim on title and aria', () => {
        const reason = 'wake stream disconnected (stream refused: HTTP 401) — poll remains the truth lane';

        const {ariaLabel, cls, hidden, text, title} = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed : true,
            stream: {alive: 'unknown', reason, capturedAt: NOW},
            nowMs : NOW
        });

        expect(hidden).toBe(false);
        expect(text).toBe('wake off');
        expect(title).toContain(`wake push unavailable — ${reason}`);
        expect(ariaLabel).toBe(`Viewer wake push: wake off — ${reason}`);
        expect(cls).toEqual(['fm-viewer-wake', 'fm-viewer-wake-degraded'])
    });

    test('not armed: hidden even when the SSE socket is connected or was previously alive, with reason preserved', () => {
        const reason = 'composed wake stream connected · not armed for this viewer (missing class-3 mint)';

        const connectedUnarmed = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed    : false,
            everAlive: true,
            stream   : {alive: true, reason, capturedAt: NOW},
            nowMs    : NOW
        });

        expect(connectedUnarmed.hidden).toBe(true);
        expect(connectedUnarmed.text).toBe('wake off');
        expect(connectedUnarmed.cls).toEqual(['fm-viewer-wake', 'fm-viewer-wake-degraded']);
        expect(connectedUnarmed.title).toContain(`wake push unavailable — ${reason}`);

        const notWired = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed : false,
            stream: {alive: 'unknown', reason: 'wake push not wired — this composition carries no direct-browser wake capability', capturedAt: NOW},
            nowMs : NOW
        });

        expect(notWired.hidden).toBe(true);
        expect(notWired.text).toBe('wake off');
        expect(notWired.title).toContain('wake push unavailable — wake push not wired')
    });

    test('session-alive retention: unconfirmed stream stays hidden when cold, but renders wake off after a live session drops', () => {
        const stream = {alive: 'unknown', reason: 'wake stream disconnected — poll remains the truth lane', capturedAt: NOW};

        const cold = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed    : null,
            everAlive: false,
            stream,
            nowMs    : NOW
        });

        expect(cold.hidden).toBe(true);

        const droppedAfterLive = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed    : null,
            everAlive: true,
            stream,
            nowMs    : NOW
        });

        expect(droppedAfterLive.hidden).toBe(false);
        expect(droppedAfterLive.text).toBe('wake off');
        expect(droppedAfterLive.cls).toEqual(['fm-viewer-wake', 'fm-viewer-wake-degraded']);
        expect(droppedAfterLive.title).toContain('wake push unavailable — wake stream disconnected')
    });

    test('catch-up keeps failed ≠ empty apart, and absence is absence', () => {
        const stream = {alive: true, reason: 'composed wake stream connected · armed for this viewer', capturedAt: NOW};

        expect(ViewerWakeTelltale.describeViewerWakeTelltale({armed: true, stream, catchUp: {state: 'failed', at: NOW - 1_000, pending: null}, nowMs: NOW}).title)
            .toContain('catch-up: failed · 1s ago');
        expect(ViewerWakeTelltale.describeViewerWakeTelltale({armed: true, stream, catchUp: {state: 'empty', at: NOW - 2_000, pending: 0}, nowMs: NOW}).title)
            .toContain('catch-up: empty · 2s ago');
        expect(ViewerWakeTelltale.describeViewerWakeTelltale({armed: true, stream, catchUp: null, nowMs: NOW}).title)
            .toContain('catch-up: no observation')
    });

    test('no stream observation at all stays hidden and inside the closed vocabulary', () => {
        const {ariaLabel, cls, hidden, text} = ViewerWakeTelltale.describeViewerWakeTelltale({nowMs: NOW});

        expect(hidden).toBe(true);
        expect(text).toBe('wake off');
        expect(ariaLabel).toBe('Viewer wake push: wake off — no stream observation');
        expect(cls).toEqual(['fm-viewer-wake', 'fm-viewer-wake-degraded'])
    });

    test('the title carries at most five signals — the feed is the archive bound, the title is the glance bound', () => {
        const signals = [1, 2, 3, 4, 5, 6, 7].map(n => ({kind: `wake/k${n}`, receivedAt: NOW - n * 1000}));

        const {title} = ViewerWakeTelltale.describeViewerWakeTelltale({
            armed : true,
            stream: {alive: true, reason: 'composed wake stream connected', capturedAt: NOW},
            signals,
            nowMs : NOW
        });

        expect(title).toContain('wake/k5');
        expect(title).not.toContain('wake/k6')
    })
});
