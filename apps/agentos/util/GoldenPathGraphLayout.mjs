import Base               from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import GoldenPathEnvelope from './GoldenPathEnvelope.mjs';

/**
 * @module apps/agentos/util/GoldenPathGraphLayout
 * @summary Pure layout for the Golden Path graph pane: turns the landed `fleetGoldenPath` envelope
 * (the shell's `goldenPathEnvelope` leaf, {@link AgentOS.util.GoldenPathEnvelope}) into nodes and
 * edges a canvas-worker renderer only draws. The route's items form a ranked spine along one axis
 * with their weight taken from the producer's score; each item's citations hang below it as
 * satellites, and a citation several items share is placed once, between the items that cite it,
 * with an edge to each — those shared citations are the graph. Nothing here ranks, merges or caches:
 * rank order and scores are the producer's, positions are the only derived facts, and the same
 * envelope yields the same picture on every run.
 *
 * The currency is the cockpit's one reading ({@link AgentOS.util.GoldenPathEnvelope#currency}): a
 * `current` route draws in the signal, a `withheld` one — the last known good route, the admission
 * contract's fallback — draws dim, and `degraded`, `unavailable` and `unobserved` draw nothing; the
 * currency line above the canvas says why.
 */

/**
 * Geometry of the picture, in CSS pixels of the canvas surface.
 * @type {Object}
 */
const GEOMETRY = {
    citationRadius: 5,
    citationSpread: 22,
    citationY     : 0.74,
    itemRadiusMax : 18,
    itemRadiusMin : 8,
    padding       : 40,
    spineY        : 0.38
};

/**
 * Static Golden Path graph layout utilities.
 * @class AgentOS.util.GoldenPathGraphLayout
 * @extends Neo.core.Base
 */
class GoldenPathGraphLayout extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.GoldenPathGraphLayout'
         * @protected
         */
        className: 'AgentOS.util.GoldenPathGraphLayout'
    }

    /**
     * @summary The currency line the pane shows above the graph: the cockpit's currency word first,
     * then the producer's own reason, or the route's capture instant and its item count. Pure; the
     * envelope's fields pass through untouched. The instant goes through `formatStamp` (the pane
     * passes the viewer's clock; the default is the UTC minute) and is left out when the value is
     * unparseable or the formatter has nothing to say.
     * @param {Object|null} envelope The landed envelope.
     * @param {Function} [formatStamp] `(isoString) → String|null`
     * @returns {{currency: String, text: String}}
     */
    static describeCurrency(envelope, formatStamp = at => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')}Z`) {
        const
            currency = GoldenPathEnvelope.currency(envelope),
            route    = GoldenPathEnvelope.routeOf(envelope),
            count    = route && Array.isArray(route.items) ? route.items.length : 0,
            items    = `${count} item${count === 1 ? '' : 's'}`,
            stamp    = at => {
                const text = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? formatStamp(at) : null;

                return text ? `captured ${text}` : null
            },
            reason   = envelope?.capability?.reason ?? null,
            // one composer per currency word, evaluated only for the word at hand: the withheld
            // reason reads the admission, which a blank or missing envelope does not carry
            parts    = {
                unobserved : () => ['Unobserved'],
                unavailable: () => ['Unavailable', reason],
                degraded   : () => ['Degraded', reason],
                withheld   : () => ['Withheld', GoldenPathEnvelope.withheldReason(envelope), 'last known good route', stamp(route.capturedAt), items],
                current    : () => ['Current', stamp(route.capturedAt), items]
            }[currency]();

        return {currency, text: parts.filter(Boolean).join(' · ')}
    }

    /**
     * @summary Lays the route out for a surface of the given size.
     *
     * Items sit on the spine in rank order (rank 1 leftmost), their radius scaled between the
     * geometry's minimum and maximum by the producer's score against the route's best score; a
     * missing score takes the minimum. Citations sit on the citation line: one node per distinct
     * citation label, placed at the mean x of the items citing it, so a shared citation lands between
     * its items; several citations of one item fan out around the item's x in label order. Edges run
     * from each item to each of its citations. Node and edge order is deterministic (rank, then id).
     * Only a current or withheld route is drawn; `kind: 'none'` is an honest empty picture.
     *
     * @param {Object|null} envelope The landed envelope.
     * @param {Object} surface
     * @param {Number} surface.width The canvas width in CSS pixels.
     * @param {Number} surface.height The canvas height in CSS pixels.
     * @returns {{currency: String, empty: Boolean, nodes: Object[], edges: Object[], width: Number, height: Number}}
     *     `nodes[]` = `{id, kind: 'item'|'citation', x, y, r, label, rank, score}`; `edges[]` = `{from, to}` by node id.
     */
    static layout(envelope, {width, height}) {
        const
            currency = GoldenPathEnvelope.currency(envelope),
            route    = GoldenPathEnvelope.routeOf(envelope),
            drawn    = currency === 'current' || currency === 'withheld',
            items    = !drawn || route.kind === 'none'
                ? []
                : [...(Array.isArray(route.items) ? route.items : [])]
                    .filter(item => item && typeof item.id === 'string')
                    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || String(a.id).localeCompare(String(b.id)));

        if (!items.length) {
            return {currency, empty: true, nodes: [], edges: [], width, height}
        }

        const
            {citationRadius, citationSpread, citationY, itemRadiusMax, itemRadiusMin, padding, spineY} = GEOMETRY,
            scores    = items.map(item => typeof item.score === 'number' ? item.score : null).filter(score => score !== null),
            bestScore = scores.length ? Math.max(...scores) : null,
            spacing   = items.length > 1 ? (width - 2 * padding) / (items.length - 1) : 0,
            itemNodes = items.map((item, index) => {
                const
                    score = typeof item.score === 'number' ? item.score : null,
                    ratio = score === null || !bestScore || bestScore <= 0 ? 0 : Math.max(0, Math.min(1, score / bestScore));

                return {
                    id   : item.id,
                    kind : 'item',
                    x    : items.length > 1 ? padding + index * spacing : width / 2,
                    y    : height * spineY,
                    r    : itemRadiusMin + ratio * (itemRadiusMax - itemRadiusMin),
                    label: item.title,
                    // the producer's rank or nothing — a position is not a rank
                    rank : Number.isInteger(item.rank) ? item.rank : null,
                    score
                }
            }),
            citedBy   = new Map();

        // one citation node per distinct label; remember which items cite it, in spine order
        items.forEach((item, index) => {
            (Array.isArray(item.citations) ? item.citations : []).forEach(citation => {
                const id = GoldenPathEnvelope.citationLabel(citation);

                if (id) {
                    citedBy.has(id) || citedBy.set(id, []);
                    citedBy.get(id).includes(index) || citedBy.get(id).push(index)
                }
            })
        });

        const
            citationIds   = [...citedBy.keys()].sort(),
            // citations that belong to ONE item fan out around it; shared ones sit between their items
            citationNodes = citationIds.map(id => {
                const
                    indices = citedBy.get(id),
                    meanX   = indices.reduce((sum, index) => sum + itemNodes[index].x, 0) / indices.length;

                let x = meanX;

                if (indices.length === 1) {
                    const
                        index = indices[0],
                        own   = citationIds.filter(other => citedBy.get(other).length === 1 && citedBy.get(other)[0] === index),
                        slot  = own.indexOf(id),
                        count = own.length;

                    x = meanX + (slot - (count - 1) / 2) * citationSpread
                }

                return {id, kind: 'citation', x, y: height * citationY, r: citationRadius, label: id, rank: null, score: null}
            }),
            edges = [];

        items.forEach((item, index) => {
            citationIds
                .filter(id => citedBy.get(id).includes(index))
                .forEach(id => edges.push({from: item.id, to: id}))
        });

        return {currency, empty: false, nodes: [...itemNodes, ...citationNodes], edges, width, height}
    }
}

export default Neo.setupClass(GoldenPathGraphLayout);
export {GEOMETRY};
