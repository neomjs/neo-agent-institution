import {test, expect} from '@playwright/test';

const
    // both paths resolve from the App worker's own file (`node_modules/neo.mjs/src/worker/`)
    LIST  = '../../../../apps/agentos/view/system/List.mjs',
    STORE = '../../../../apps/agentos/store/DeploymentServices.mjs',
    // the installed picture's words at their longest: a recovery class that carries the diagnosis
    // line past 240 characters, a long class, and a compose id the label map does not know
    recoveryClass = 'sustained-memory-saturation: the container stayed above its class threshold across three ' +
        'consecutive observation windows while restart churn stayed under its baseline, so the orchestrator ' +
        'recommends one supervised restart',
    base = {
        status        : 'available', observedAgeMs: 12000, memoryDisposition: 'below', memoryThreshold: 85,
        sampleCount   : 120, churnBaseline: 'available', churnDetecting: false, diagnosisStatus: 'healthy'
    },
    rows = [
        {...base, serviceKey: 'chroma',       serviceClass: 'vector-store'},
        {...base, serviceKey: 'kb-server',    serviceClass: 'knowledge-base'},
        {...base, serviceKey: 'mc-server',    serviceClass: 'stateful-memory-core-with-sqlite-holder-and-embedding-drain',
            status: 'degraded', memoryDisposition: 'at-cap', churnDetecting: true, diagnosisStatus: 'recommend',
            memoryReason: 'heap observation unavailable: the container reports no cgroup memory limit, so no ratio is computed',
            recoveryClass, confidence: 0.92, actionClass: 'supervised-restart'},
        {...base, serviceKey: 'fleet-server', serviceClass: 'fleet-control'},
        {...base, serviceKey: 'neo-agent-os-embedding-gateway-sidecar-canonical-plane-01', serviceClass: 'sidecar'}
    ],
    // 290: one column · 1328 and 1432: the System list at the operator's 1400 and 1504 px windows · 1600: wide
    WIDTHS = [290, 1328, 1432, 1600];

let listId = null, storeId = null;

/**
 * @summary The System view's plane cards read in full at the list's real widths (#508): the REAL
 * list and its cards in a browser, because only layout can show text escaping a card. The engine's
 * `.neo-list-item` is single-line (`white-space: nowrap`), and a service card is that item, so every
 * head span and the diagnosis paragraph inherited it and ran past the card edge on the installed
 * build. Each arm mounts the list at one width and asserts the list's own width first (a viewport
 * is not a pane width), then that no card, head line, diagnosis line or descendant passes its card,
 * and finally the room rule: a column of at least 360 px when the list is that wide, one column below.
 */
test.describe('AgentOS.view.system.List — plane cards read in full', () => {
    test.beforeEach(async ({page}) => {
        await page.setViewportSize({width: 1700, height: 1300});
        await page.goto('test/playwright/component/apps/empty-viewport/index.html');
        await page.waitForSelector('#component-test-viewport', {state: 'attached'});

        const loaded = await page.evaluate(modulePath => Neo.worker.App.loadModule({path: modulePath}), STORE);

        if (!loaded.success) {
            throw new Error(`DeploymentServices load failed: ${loaded.error?.message ?? loaded.error}`)
        }
    });

    test.afterEach(async ({page}) => {
        // the list never owns its store (the System container does), so each goes on its own
        for (const id of [listId, storeId]) {
            id && await page.evaluate(instanceId => Neo.worker.App.destroyNeoInstance(instanceId), id)
        }

        listId = storeId = null
    });

    for (const width of WIDTHS) {
        test(`at a ${width} px list every card reads whole`, async ({page}, testInfo) => {
            storeId = `seam-plane-cards-store-${width}`;

            const result = await page.evaluate(config => Neo.worker.App.createNeoInstance(config), {
                importPath: LIST,
                ntype     : 'fm-plane-list',
                parentId  : 'component-test-viewport',
                width,
                height    : 1200,
                store     : {className: 'AgentOS.store.DeploymentServices', id: storeId, data: rows}
            });

            expect(result.success, `list creation: ${result.error?.message ?? ''}`).toBe(true);
            listId = result.id;

            await expect(page.locator('.fm-plane-card')).toHaveCount(rows.length, {timeout: 30000});
            await page.evaluate(() => document.fonts.ready);

            const read = await page.evaluate(() => {
                const list = document.querySelector('.fm-plane-list');

                return {
                    listWidth: list.getBoundingClientRect().width,
                    cards    : [...list.querySelectorAll('.fm-plane-card')].map(card => {
                        const rect  = card.getBoundingClientRect(),
                              head  = card.querySelector('.fm-plane-head'),
                              facts = card.querySelector('.fm-plane-facts'),
                              diag  = card.querySelector('.fm-plane-diag');

                        const style    = getComputedStyle(card),
                              children = [...card.children].map(el => el.getBoundingClientRect()),
                              frame    = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
                                  .reduce((sum, key) => sum + parseFloat(style[key]), 0);

                        return {
                            key     : card.querySelector('.fm-plane-key').textContent,
                            left    : Math.round(rect.left),
                            top     : Math.round(rect.top),
                            // the card's height beyond its content box; the row's tallest card has none
                            cardSlack: Math.round(rect.height - frame -
                                (Math.max(...children.map(r => r.bottom)) - Math.min(...children.map(r => r.top)))),
                            width   : rect.width,
                            card    : card.scrollWidth - card.clientWidth,
                            head    : head.scrollWidth - head.clientWidth,
                            diag    : diag.scrollWidth - diag.clientWidth,
                            diagText: diag.textContent.length,
                            // a block taller than its own lines means the row was stretched over empty space
                            slack   : Math.max(...[head, facts].map(block => {
                                const lines = [...block.children].map(el => el.getBoundingClientRect());
                                return Math.round(block.getBoundingClientRect().height -
                                    (Math.max(...lines.map(r => r.bottom)) - Math.min(...lines.map(r => r.top))))
                            })),
                            // every descendant stays inside its card (half a pixel for subpixel rounding)
                            escaped : [...card.querySelectorAll('*')]
                                .filter(el => el.getBoundingClientRect().right > rect.right + 0.5)
                                .map(el => el.className || el.tagName)
                        }
                    })
                }
            });

            // the receipt: the capture plus every measured width, kept with the run whether it passes or fails
            await testInfo.attach(`system-cards-${width}px`, {
                body       : await page.locator('.fm-plane-list').screenshot(),
                contentType: 'image/png'
            });
            await testInfo.attach(`system-cards-${width}px.json`, {
                body       : JSON.stringify(read, null, 2),
                contentType: 'application/json'
            });

            expect(Math.round(read.listWidth), 'the list is mounted at the width under test').toBe(width);
            expect(Math.max(...read.cards.map(card => card.diagText)), 'the long diagnosis is on a card').toBeGreaterThan(240);

            for (const card of read.cards) {
                expect(card.card, `${card.key}: the card scrolls nothing sideways`).toBeLessThanOrEqual(0);
                expect(card.head, `${card.key}: the head line wraps instead of overflowing`).toBeLessThanOrEqual(0);
                expect(card.diag, `${card.key}: the diagnosis wraps instead of overflowing`).toBeLessThanOrEqual(0);
                expect(card.escaped, `${card.key}: no descendant passes the card's right edge`).toEqual([]);
                expect(card.slack, `${card.key}: the card's height follows its content`).toBeLessThanOrEqual(4)
            }

            // a row is as tall as its tallest card's content, never stretched over the list's free height
            for (const top of new Set(read.cards.map(card => card.top))) {
                const row = read.cards.filter(card => card.top === top);
                expect(Math.min(...row.map(card => card.cardSlack)), `the row at ${top} px is as tall as its content`).toBeLessThanOrEqual(4)
            }

            const columns = new Set(read.cards.map(card => card.left)).size;

            if (width < 360) {
                expect(columns, 'a narrow list is one column').toBe(1)
            } else {
                for (const card of read.cards) {
                    expect(card.width, `${card.key}: a column is at least 360 px`).toBeGreaterThanOrEqual(360)
                }
            }
        })
    }
});
