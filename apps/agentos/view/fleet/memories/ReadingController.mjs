import ComponentController from '../../../../../node_modules/neo.mjs/src/controller/Component.mjs';

/**
 * The Memories view's reading orchestration: which record the reader shows, and how the open
 * register makes room for it.
 *
 * @summary Owns the reading state the pane's registers feed — the selected summary, the selected
 * turn, the rail's width — and writes the reader, the rail and the splitter from it in one pass
 * ({@link #syncReader}), which the {@link AgentOS.view.fleet.memories.Container pane} calls for the
 * open register whenever its zones change. Reading is a selection: the grids relay the engine
 * RowModel's select / deselect, ↑/↓ arrive the same way, and Escape (or the reader's back
 * breadcrumb, the narrow regime's way out) leaves *show all* first, then closes the reading.
 * While *show all* reads the register as one document, the rail's selection follows the reader's
 * scroll. The records arrive whole on the wire, so nothing here fetches.
 *
 * @class AgentOS.view.fleet.memories.ReadingController
 * @extends Neo.controller.Component
 */
class ReadingController extends ComponentController {
    /**
     * The scroll follow measures the reader's articles over the main thread; one pass per frame
     * window is enough to keep the rail honest.
     * @member {Object} delayable
     * @protected
     * @static
     */
    static delayable = {
        followScroll: {type: 'throttle', timer: 120}
    }

    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.ReadingController'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.ReadingController'
    }

    /**
     * The summary the reader shows — its record id in the summary Store, or null.
     * @member {String|null} readSummaryId=null
     */
    readSummaryId = null
    /**
     * The turn the reader shows while a drill is open — its record id, or null.
     * @member {String|null} readTurnId=null
     */
    readTurnId = null
    /**
     * The rail's width while the pane reads; a splitter drag replaces it for the session.
     * @member {String} railWidth='340px'
     */
    railWidth = '340px'

    /**
     * @summary Wire the registers' selection relays and the reader's intents once the pane exists.
     */
    onComponentConstructed() {
        const
            me          = this,
            {component} = me,
            reader      = component.getReference('memories-reader');

        component.getReference('memories-summary-grid').on({
            recordDeselect: me.onRecordDeselect,
            recordSelect  : me.onSummarySelect,
            scope         : me
        });
        component.getReference('memories-turn-grid').on({
            recordDeselect: me.onRecordDeselect,
            recordSelect  : me.onTurnSelect,
            scope         : me
        });
        reader.on({
            backRequest : me.onEscape,
            drillRequest: me.onReaderDrill,
            scope       : me
        });
        reader.addDomListeners({scroll: me.onReaderScroll, scope: me})
    }

    /**
     * @summary The id key of the open register: turns while a drill is open, summaries otherwise.
     * @returns {String} `readTurnId` or `readSummaryId`
     */
    get idKey() {
        return this.component.drillSession ? 'readTurnId' : 'readSummaryId'
    }

    /**
     * @summary The open register's grid.
     * @returns {AgentOS.view.fleet.memories.RowsGrid}
     */
    get grid() {
        return this.component.getReference(this.component.drillSession ? 'memories-turn-grid' : 'memories-summary-grid')
    }

    /**
     * @summary Drop one register's reading without relaying it — the pane calls this when that
     * register's corpus is replaced (a target switch, a drill opened or left).
     * @param {String} kind `summary` or `turn`
     */
    clearReading(kind) {
        const turn = kind === 'turn';

        this.component.getReference(turn ? 'memories-turn-grid' : 'memories-summary-grid').clearSelection();
        this[turn ? 'readTurnId' : 'readSummaryId'] = null
    }

    /**
     * @summary One owner for the reading surface, called by the pane's `syncZones` for the open
     * register: the reader shows beside rows only, the selected record whole (or every loaded
     * record under *show all*), and the nothing-selected sentence otherwise. While it reads, the
     * register is its rail and the splitter is live. A selection whose record left the Store (a
     * refresh, a switch) is dropped, never rendered from a stale bag.
     * @param {Boolean} rows Whether the open register renders rows
     */
    syncReader(rows) {
        const
            me            = this,
            {component}   = me,
            drill         = Boolean(component.drillSession),
            {grid, idKey} = me,
            record        = rows && me[idKey] !== null ? grid.store.get(me[idKey]) : null,
            showAll       = rows && component.showAll,
            reading       = showAll || Boolean(record),
            reader        = component.getReference('memories-reader');

        if (me[idKey] !== null && !record) {
            me[idKey] = null
        }

        reader.hidden = !rows;
        component.getReference('memories-splitter').hidden = !reading;
        component.toggleCls('is-reading', reading);
        me.sizeList(reading);
        component.getReference('memories-summary-grid').rail = reading && !drill;
        component.getReference('memories-turn-grid').rail    = reading && drill;

        component.getReference('memories-show-all').set({
            hidden : !rows,
            pressed: showAll,
            text   : component.showAll ? 'One at a time' : 'Show all'
        });

        reader.reading = {
            backText : drill ? 'Turns' : 'Summaries',
            kind     : drill ? 'turn' : 'summary',
            records  : showAll ? grid.extractBags() : record ? [grid.recordBag(record)] : [],
            emptyText: drill ? 'Select a turn to read it in full.' : 'Select a session summary to read it in full.'
        }
    }

    /**
     * @summary Size the list column for the mode: a rail of {@link #railWidth} while the pane reads
     * (the width the operator last dragged the splitter to, once there is one), its share of the
     * body otherwise. The splitter and this method write the same `wrapperStyle` keys; the narrow
     * regime's container query overrides both.
     * @param {Boolean} reading
     * @protected
     */
    sizeList(reading) {
        const
            me                     = this,
            list                   = me.component.getReference('memories-list'),
            {flex, width, ...rest} = list.wrapperStyle || {};

        if (reading) {
            list.wrapperStyle = {...rest, flex: 'none', width: width ?? me.railWidth}
        } else {
            width && (me.railWidth = width);
            list.wrapperStyle = {...rest, flex: '2 1 0%'}
        }
    }

    /**
     * @summary A summary row was selected (click or ↑/↓): read it.
     * @param {Object} data
     * @param {Neo.data.Model} data.record
     */
    onSummarySelect({record}) {
        this.onRecordSelect('readSummaryId', record)
    }

    /**
     * @summary A turn row was selected: read it.
     * @param {Object} data
     * @param {Neo.data.Model} data.record
     */
    onTurnSelect({record}) {
        this.onRecordSelect('readTurnId', record)
    }

    /**
     * @summary The shared half of both selects; under *show all* the selected record is brought
     * into view instead of re-rendering the document.
     * @param {String}         idKey  `readSummaryId` or `readTurnId`
     * @param {Neo.data.Model} record
     * @protected
     */
    onRecordSelect(idKey, record) {
        const me = this;

        me[idKey] = record.id;
        me.component.syncZones();
        me.component.showAll && me.component.getReference('memories-reader').scrollToRecord(record.id)
    }

    /**
     * @summary The selected row was clicked again: the reading closes.
     */
    onRecordDeselect() {
        this[this.idKey] = null;
        this.component.syncZones()
    }

    /**
     * @summary Escape (and the reader's back breadcrumb) leaves *show all* first, then closes the
     * reading; the list keeps its place. Focus decides who hears Escape first: inside the dock's
     * header it restores a maximized node before this pane sees the key.
     */
    onEscape() {
        const
            me          = this,
            {component} = me;

        if (component.showAll) {
            component.showAll = false
        } else if (me[me.idKey] !== null) {
            me.grid.clearSelection();
            me.onRecordDeselect()
        }
    }

    /** @summary Toggle *show all*. */
    onShowAllClick() {
        this.component.showAll = !this.component.showAll
    }

    /**
     * @summary The reader's *Read the turns*: open the summary's session, as its card's button does.
     * @param {Object} data
     * @param {Object} data.record The summary's bag
     */
    onReaderDrill({record}) {
        this.component.openSession({sessionId: record.sessionId, title: record.title})
    }

    /**
     * @summary The reader scrolled: under *show all*, let the rail follow ({@link #followScroll}).
     * @param {Object} data The scroll event; `scrollTop` is the reader's
     * @protected
     */
    onReaderScroll(data) {
        this.component.showAll && this.followScroll(data.scrollTop)
    }

    /**
     * @summary Measure which record the reader is showing and follow it in the rail: the first
     * article still reaching below the viewport's top third — or, once the document is scrolled to
     * its end, the last one, which may never reach the top. Throttled via {@link #delayable}; one
     * main-thread measure of every article per pass.
     * @param {Number} scrollTop The reader's scroll offset
     * @returns {Promise<void>}
     * @protected
     */
    async followScroll(scrollTop) {
        const
            me                  = this,
            reader              = me.component.getReference('memories-reader'),
            ids                 = (reader.reading?.records || []).map(bag => bag.id),
            [view, ...articles] = await Neo.main.DomAccess.getBoundingClientRect({
                id      : [reader.id, ...ids.map(id => reader.partId(id, 'article'))],
                windowId: reader.windowId
            }),
            atEnd               = scrollTop > 0 && articles.at(-1)?.bottom <= view.bottom + 1,
            index               = atEnd ? articles.length - 1 : articles.findIndex(rect => rect?.bottom > view.top + view.height / 3);

        index > -1 && me.component.showAll && me.followRecord(ids[index])
    }

    /**
     * @summary Mark one record as the read one in the rail without re-rendering the reader: the
     * selection moves silently and the rail scrolls just enough to show it.
     * @param {String} recordId
     */
    followRecord(recordId) {
        const
            me            = this,
            {grid, idKey} = me,
            {store}       = grid,
            from          = Math.max(store.indexOf(store.get(me[idKey])), 0),
            to            = store.indexOf(store.get(recordId));

        if (to < 0 || me[idKey] === recordId) {
            return
        }

        me[idKey] = recordId;
        grid.view.selectionModel.selectRow(recordId);
        grid.body.scrollByRows(from, to - from)
    }
}

export default Neo.setupClass(ReadingController);
