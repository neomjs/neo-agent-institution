import {expect, landFleetActivity, landFleetSample, readFleetMailboxReads, serveFleetMailbox, test} from '../../fixtures.mjs';

const
    ALL       = {memorySharing: 'team', scope: 'all'},
    BASE_TIME = Date.parse('2026-10-15T12:00:00.000Z');

/**
 * @summary One mailbox message as the stream's event: `index` 0 is the newest, a larger one older.
 * @param {String} label The population its subject names
 * @param {Number} index
 * @returns {Object}
 */
function message(label, index) {
    return {
        eventId   : `a2a:MESSAGE:${label}-${index}`,
        type      : 'a2a-activity',
        source    : 'memory-core:mailbox',
        agentId   : index % 2 ? 'neo-gpt' : 'neo-fable',
        confidence: 'observed',
        occurredAt: new Date(BASE_TIME - index * 1000).toISOString(),
        payload   : {
            from          : index % 2 ? 'neo-gpt' : 'neo-fable',
            messageId     : `MESSAGE:${label}-${index}`,
            priority      : 'normal',
            recipientClass: 'agent',
            relatedTickets: [],
            status        : 'read',
            subject       : `${label} message ${index}`,
            taskState     : null,
            to            : '@neo-opus-grace'
        }
    }
}

/**
 * @summary The operator's observer journey on the mounted cockpit, over the canonical observer
 * contract the landing serves: All A2A pages a population three pages deep through its continuation, a
 * message read beyond the first page opens read-only beside the list, involves me replaces the population,
 * including a message the global order holds beyond its first page, and the mailbox mode reads as before.
 *
 * @see apps/agentos/util/ActivityObserver.mjs
 * @see apps/agentos/view/fleet/activity/Container.mjs
 */
test.describe('AgentOS Fleet activity — All A2A and involves me', () => {
    test.setTimeout(120000);
    test.use({locale: 'en-US', timezoneId: 'America/New_York'});

    test('All A2A pages beyond its first page, a later message opens read-only, and involves me replaces it', async ({page}) => {
        const
            pageErrors = [],
            all        = Array.from({length: 120}, (_, index) => message('all', index)),
            // the viewer's own exchanges sit across the whole global order, the newest page's and the last one's
            involves   = all.filter((_, index) => index % 4 === 3),
            own        = Array.from({length: 60}, (_, index) => message('mailbox', index)),
            stream     = page.locator('.fm-activity-stream'),
            list       = stream.locator('.fm-activity-list'),
            retention  = stream.locator('.fm-stream-retention'),
            sources    = stream.locator('.fm-stream-sources'),
            detail     = stream.locator('.fm-mailbox-detail'),
            chip       = text => stream.locator('.fm-stream-mode-chip', {hasText: text}),
            // the subject ends the row: `all message 3` never matches `all message 31`
            row        = text => stream.locator('.fm-activity-row', {hasText: new RegExp(`${text}$`)}),
            toTheEnd   = async () => {
                const box = await list.boundingBox();

                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.wheel(0, 100000)
            };

        page.on('pageerror', error => pageErrors.push(error.message));

        await page.goto('/apps/agentos/index.html');
        await expect(stream).toBeVisible({timeout: 60000});
        await serveFleetMailbox(page, own, {all, 'involves-me': involves});
        await landFleetActivity(page, own.slice(0, 50));
        await expect(row('mailbox message 0')).toBeVisible();

        // the mailbox is the default; the chip asks, and the owner reads the observer population at once
        await expect(chip('mailbox')).toHaveClass(/neo-pressed|pressed/);
        await chip('all A2A').click();

        await expect(row('all message 0')).toBeVisible();
        await expect(row('mailbox message 0')).toHaveCount(0);
        await expect(sources).toHaveText('sources · all A2A · 120 total');
        await expect(retention).toHaveText('newest 50 · older on scroll');
        expect((await readFleetMailboxReads(page)).activity.at(-1)).toEqual({observer: ALL});

        // older pages follow the canonical continuation, to the population's end
        await toTheEnd();
        await expect(retention).toHaveText('newest 100 · older on scroll');
        await toTheEnd();
        await expect(retention).toHaveText('all 120 shown');

        const pages = (await readFleetMailboxReads(page)).activity.filter(read => read?.slots);

        expect(pages).toEqual([
            {limit: 50, observer: ALL, offset: 50, slots: ['a2a']},
            {limit: 50, observer: ALL, offset: 100, slots: ['a2a']}
        ]);

        // a message from the last page opens beside the list, read-only
        await toTheEnd();
        await row('all message 119').click();
        await expect(detail).toBeVisible();
        await expect(detail.locator('.fm-mailbox-detail-subject')).toHaveText('all message 119');
        await expect(detail.locator('.fm-mailbox-detail-body')).toHaveText('the words of all message 119');
        await expect(detail.locator('.fm-mailbox-detail-strip'), 'no reply, read or resolve on a peer exchange').toBeHidden();
        expect((await readFleetMailboxReads(page)).messages).toEqual([{messageId: 'MESSAGE:all-119', observer: ALL}]);

        // involves me is another population: the open message and every all-A2A row go
        await chip('involves me').click();
        await expect(detail).toBeHidden();
        await expect(sources).toHaveText('sources · involves me · 30 total');
        await expect(retention).toHaveText('all 30 shown');
        await expect(row('all message 3')).toBeVisible();
        await expect(row('all message 0')).toHaveCount(0);

        // a message the global order holds on its last page is in involves me's first one
        await toTheEnd();
        await expect(row('all message 119')).toBeVisible();

        // back to the mailbox: the ordinary read, as before
        await chip('mailbox').click();
        await expect(row('mailbox message 0')).toBeVisible();
        await expect(row('all message 3')).toHaveCount(0);
        await expect(sources).toHaveText('');
        expect((await readFleetMailboxReads(page)).activity.at(-1)).toBeNull();
        expect(pageErrors).toEqual([])
    });

    test('by keyboard: the rows are one Tab stop, arrows move the row focus, Enter opens the focused message, Escape closes it', async ({page}) => {
        const
            pageErrors = [],
            all        = Array.from({length: 12}, (_, index) => message('all', index)),
            own        = Array.from({length: 6}, (_, index) => message('mailbox', index)),
            stream     = page.locator('.fm-activity-stream'),
            detail     = stream.locator('.fm-mailbox-detail'),
            chip       = text => stream.locator('.fm-stream-mode-chip', {hasText: text}),
            item       = text => stream.locator('.fm-activity-list > .neo-list-item', {hasText: new RegExp(`${text}$`)}),
            // the subject of the row holding DOM focus; null outside every row
            focused    = () => page.evaluate(() => document.activeElement?.closest('.fm-activity-list > .neo-list-item')?.querySelector('.fm-ev-object')?.textContent ?? null);

        page.on('pageerror', error => pageErrors.push(error.message));

        await page.goto('/apps/agentos/index.html');
        await expect(stream).toBeVisible({timeout: 60000});
        await serveFleetMailbox(page, own, {all});
        await landFleetActivity(page, own);
        await expect(item('mailbox message 0')).toBeVisible();

        // a row's chips are not controls: nothing inside a row is a stop of its own
        await expect(stream.locator('.fm-activity-list > .neo-list-item :is(a, button, [tabindex])')).toHaveCount(0);

        // from the head's last chip, one Tab reaches the rows
        await chip('all A2A').click();
        await expect(item('all message 0')).toBeVisible();
        await page.keyboard.press('Tab');
        await expect.poll(focused, 'Tab enters the rows at the first').toBe('all message 0');

        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect.poll(focused, 'ArrowDown moves the row focus').toBe('all message 2');

        await page.keyboard.press('Enter');
        await expect(detail).toBeVisible();
        await expect(detail.locator('.fm-mailbox-detail-subject')).toHaveText('all message 2');
        await expect(item('all message 2')).toHaveAttribute('aria-selected', 'true');
        expect((await readFleetMailboxReads(page)).messages, 'one open, one body read').toEqual([{messageId: 'MESSAGE:all-2', observer: ALL}]);

        await page.keyboard.press('Escape');
        await expect(detail).toBeHidden();
        await expect(item('all message 2')).not.toHaveAttribute('aria-selected', 'true');
        expect(await focused(), 'Escape keeps the row focus').toBe('all message 2');

        await page.keyboard.press('Tab');
        await expect.poll(focused, 'Tab leaves the rows: they are one stop').toBeNull();

        // the mailbox opens nothing in the stream, by keyboard either
        await chip('mailbox').click();
        await item('mailbox message 1').click();
        await page.keyboard.press('Enter');
        await expect(item('mailbox message 1')).not.toHaveAttribute('aria-selected', 'true');
        await expect(detail).toBeHidden();
        expect((await readFleetMailboxReads(page)).messages).toEqual([{messageId: 'MESSAGE:all-2', observer: ALL}]);
        expect(pageErrors).toEqual([])
    });

    test('the open row wears a selected roster card\'s paint, its background and border, in both skins', async ({page}) => {
        const
            all    = Array.from({length: 4}, (_, index) => message('all', index)),
            own    = Array.from({length: 4}, (_, index) => message('mailbox', index)),
            stream = page.locator('.fm-activity-stream'),
            row    = text => stream.locator('.fm-activity-list > .neo-list-item > .fm-activity-row', {hasText: new RegExp(`${text}$`)}),
            card   = page.locator('.fm-fleet-cards > .neo-list-item[aria-selected="true"] > .fm-agent-card'),
            paint  = locator => locator.evaluate(el => {
                const style = getComputedStyle(el);

                return {background: style.backgroundColor, border: style.borderColor}
            });

        // the card eases into its selection paint; without motion both paints are final at once
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.goto('/apps/agentos/index.html');
        await expect(stream).toBeVisible({timeout: 60000});
        await landFleetSample(page, {activity: false});
        await serveFleetMailbox(page, own, {all});
        await landFleetActivity(page, own);

        await stream.locator('.fm-stream-mode-chip', {hasText: 'all A2A'}).click();
        await row('all message 1').click();
        await page.locator('.fm-fleet-cards > .neo-list-item').first().click();
        await expect(card).toHaveCount(1);
        await expect(stream.locator('.fm-activity-list > .neo-list-item[aria-selected="true"]'), 'a roster pick leaves the message open').toHaveText(/all message 1$/);

        for (const skin of ['dark', 'light']) {
            if (skin === 'light') {
                await page.locator('.agent-theme-button').focus();
                await page.keyboard.press('Enter');
                await expect(page.locator('.agent-os-viewport.neo-theme-neo-light')).toBeVisible()
            }

            await page.mouse.move(0, 0);

            expect(await paint(row('all message 1')), `${skin}: the open row wears the selected card's tint and border`).toEqual(await paint(card));
            expect(await paint(row('all message 2')), `${skin}: a closed row wears neither`).not.toEqual(await paint(card))
        }
    })
});
