import Base         from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import SourceHealth from './SourceHealth.mjs';

/**
 * @summary The one mapping from a cockpit roster DTO row onto the `FleetAgent` record contract.
 *
 * Identity facts and launch-derived truths flow through tri-state (`null` = the row carried no
 * fact — never guessed), the runtime lifecycle maps onto the session-state vocabulary only when
 * the runtime source is usable ({@link AgentOS.util.SourceHealth}), and the lane claim fields pass
 * through from the roster DTO just like the other roster-owned facts.
 * The liveness controller delegates here; the row shape is the Brain's cockpit DTO assembler's.
 *
 * @class AgentOS.util.RosterRow
 * @extends Neo.core.Base
 */
class RosterRow extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.RosterRow'
         * @protected
         */
        className: 'AgentOS.util.RosterRow'
    }

    /**
     * @summary Map one assembler DTO row onto the FleetAgent record contract.
     * @param {Object} row One cockpit DTO row.
     * @returns {Object} FleetAgent record field values.
     */
    static mapRosterRow(row) {
        const sessionHealth = SourceHealth.mapFleetSessionHealth(row.lifecycle, row.sources);

        return {
            agentId    : row.id,
            authMode   : row.authMode ?? null,
            avatarUrl  : row.avatarUrl ?? null,
            displayName: row.displayName ?? null,
            // the resident's MAILBOX identity authority, preserved from the DTO — the registry id
            // is a Fleet key (`vega`), a mailbox subject is an AgentIdentity node id
            // (`@neo-opus-vega`); comparing the wrong kind would never match, or match the wrong
            // resident. `null` = no identity authority: an honest "cannot verify"
            githubUsername     : row.githubUsername ?? null,
            engineTag          : row.engineTag ?? null,
            family             : row.family ?? null,
            // the launch-side facts the card's clone-path line reads: the harness key as the
            // registry holds it, and the working repository the Fleet derived before any launch.
            // `repoStatus` is null on a row the repo producer did not cover — honest null, no line
            harnessType        : row.harnessType ?? null,
            repoSlug           : row.repoStatus?.repoSlug ?? null,
            repoPath           : row.repoStatus?.repoPath ?? null,
            // the last start's outcome per other repository, from the Fleet's launch record
            repoOutcomes       : row.repoOutcomes ?? null,
            // the commit identity the last start resolved, from the same record
            gitIdentity        : row.gitIdentity ?? null,
            launchable         : row.launchable ?? null,
            openLaneCount      : row.openLaneCount ?? null,
            laneLine           : row.laneLine ?? null,
            laneClaimedAt      : row.laneClaimedAt ?? null,
            lastActivityAt     : row.lastActivityAt ?? null,
            participationStatus: row.participationStatus ?? null,
            sources            : sessionHealth.sources,
            state              : sessionHealth.state,
            presence           : row.presence ?? null,
            throttle           : row.throttle ?? null,
            wake               : row.wake ?? null
        }
    }
}

export default Neo.setupClass(RosterRow);
