import Base                   from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import GraphNodeSource        from './GraphNodeSource.mjs';
import GraphSceneEnvelope     from './GraphSceneEnvelope.mjs';
import ObservatorySceneLayout from './ObservatorySceneLayout.mjs';

/**
 * @summary The Observatory head's first line: the team's sentence over a current read, before any engine count.
 * Within the one attention window the heat overlay, the lens and the Nodes list share
 * ({@link AgentOS.util.ObservatorySceneLayout#attention}), it counts the pull requests that merged and the open work
 * in motion, and names where attention goes: the hottest named work item by
 * {@link AgentOS.util.ObservatorySceneLayout#heatOf}. A class with nothing to count stays silent, a read without
 * activity times says so instead of a zero, and a read that is not current keeps its own words
 * ({@link AgentOS.util.GraphSceneEnvelope#describe}). What the renderer drew is the head's Details, not this line.
 * @class AgentOS.util.ObservatoryBrief
 * @extends Neo.core.Base
 */
class ObservatoryBrief extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.ObservatoryBrief'
         * @protected
         */
        className: 'AgentOS.util.ObservatoryBrief'
    }

    /**
     * @summary What a scene says the team did within the attention window: the pull requests that merged, the open
     * work items active in it, the work either count could hold whose time or state the read omits, and the named
     * work item that drew the most attention. A node whose heat the overlay derives from its neighbours never leads.
     * @param {Object} scene An {@link AgentOS.util.ObservatorySceneLayout#fromGraphScene} scene
     * @param {Number} [now=Date.now()] Epoch ms
     * @returns {{attention: Object|null, inMotion: Number, merged: Number, timed: Boolean, unknown: Number}}
     *     `attention` is `{id, label, number}`; `timed` is false for a read that carries no activity time at all
     */
    static of(scene, now = Date.now()) {
        const
            {heatEvents, workStates} = ObservatorySceneLayout,
            {windowMs}               = ObservatorySceneLayout.attention,
            nodes                    = scene?.nodes ?? [],
            heat                     = ObservatorySceneLayout.heatOf(scene, now);

        let attention = -1, inMotion = 0, merged = 0, unknown = 0;

        nodes.forEach((node, index) => {
            const
                timed  = node.lastActivityAt !== null,
                recent = timed && now - node.lastActivityAt <= windowMs,
                merges = node.kind === 'PULL_REQUEST' && node.state === 'MERGED',
                // a work item's lifecycle, `unread` where the read omits its state or cannot interpret it
                state  = heatEvents[node.kind] === 'open' ? workStates[node.state] ?? 'unread' : null;

            // a count needs the item's own time and state: where the read omits either, the item is unknown, never a
            // zero, and a time on another node says nothing about it
            if (((merges || state === 'open') && !timed) || (state === 'unread' && (recent || !timed))) {
                unknown++
            } else if (merges && recent) {
                merged++
            } else if (state === 'open' && recent) {
                inMotion++
            }

            if (Object.hasOwn(heatEvents, node.kind) && heat[index] > 0 && (attention < 0 || heat[index] > heat[attention])) {
                attention = index
            }
        });

        const top = attention < 0 ? null : nodes[attention];

        return {
            attention: top && {id: top.id, label: top.label ?? top.id, number: GraphNodeSource.numberOf(top)},
            inMotion,
            merged,
            timed: nodes.some(node => node.lastActivityAt !== null),
            unknown
        }
    }

    /**
     * @summary The head's first line for a landed read, as `lead`, the attention item, then `tail`. A current read
     * says `captured 06:20 PM · last 3 days: 4 merged · 12 in motion`, with `· 2 unknown` for the work whose time or
     * state the read omits (the heat line's word), so `nothing moved` is said only of work the read can place. It names its
     * attention item (`#<number> · <title>`, the full title on the item's own title) and ends on its completeness;
     * any other read keeps {@link AgentOS.util.GraphSceneEnvelope#describe}'s words.
     * @param {Object|null} envelope A landed envelope
     * @param {Object|null} scene The scene the pane drew from it
     * @param {Object}   [options]
     * @param {Function} [options.formatStamp] `(isoString) → String|null`; the default is the UTC minute
     * @param {Number}   [options.now=Date.now()] Epoch ms
     * @returns {{attention: Object|null, lead: String, tail: String|null}} `attention` is `{id, text, title}`
     */
    static line(envelope, scene, {formatStamp = at => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')}Z`, now = Date.now()} = {}) {
        if (envelope?.capability?.state !== 'current' || !scene?.nodes?.length) {
            return {attention: null, lead: GraphSceneEnvelope.describe(envelope, formatStamp).text, tail: null}
        }

        const
            {attention, inMotion, merged, timed, unknown} = ObservatoryBrief.of(scene, now),
            days  = ObservatorySceneLayout.attention.windowMs / 86400000,
            at    = envelope.capturedAt,
            stamp = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? formatStamp(at) : null,
            moved = [merged > 0 && `${merged} merged`, inMotion > 0 && `${inMotion} in motion`, unknown > 0 && `${unknown} unknown`].filter(Boolean).join(' · ');

        return {
            attention: attention && {id: attention.id, text: [attention.number && `#${attention.number}`, attention.label].filter(Boolean).join(' · '), title: attention.label},
            lead     : [
                stamp && `captured ${stamp}`,
                timed ? `last ${days} day${days === 1 ? '' : 's'}: ${moved || 'nothing moved'}` : 'this read carries no activity times'
            ].filter(Boolean).join(' · '),
            tail     : GraphSceneEnvelope.completenessOf(envelope.scene)
        }
    }
}

export default Neo.setupClass(ObservatoryBrief);
