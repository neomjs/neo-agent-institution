import Base                from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import SeatCredential      from './SeatCredential.mjs';
import SeatDependencies    from './SeatDependencies.mjs';
import SeatGitIdentity     from './SeatGitIdentity.mjs';
import SeatLaunchAdmission from './SeatLaunchAdmission.mjs';
import SeatModel           from './SeatModel.mjs';
import SeatSessionFolder   from './SeatSessionFolder.mjs';

/**
 * @summary Pure resolver for `AgentOS.view.fleet.roster.card.Container`'s `control-status` row and
 * restart tooltip, keeping one priority ladder across Start round-trips, session-folder checks, model
 * refusals, credential refusals / 7-day token expiry warnings, unplanned exits, launch admission,
 * and dependency preparation.
 *
 * Extracted along the card's status-row responsibility seam so `roster/card/Container.mjs` stays focused
 * on card rendering well below the 1,000-line app file budget.
 *
 * @class AgentOS.util.CardControlStatus
 * @extends Neo.core.Base
 */
class CardControlStatus extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.CardControlStatus'
         * @protected
         */
        className: 'AgentOS.util.CardControlStatus'
    }

    /**
     * @summary Compute the roster card's `control-status` presentation and admission aging target.
     * @param {Object}      input
     * @param {Object}      input.record
     * @param {String}      input.recordState
     * @param {Object}      input.resolved
     * @param {Object}      input.sources
     * @param {String|null} input.rosterState
     * @param {Boolean}     input.disabled
     * @param {String|null} input.pendingAction
     * @param {Object|null} input.controlReason
     * @param {Object|null} input.preparation
     * @param {String|null} input.cancel
     * @param {Object|null} input.exitLine
     * @param {Number}      input.now
     * @returns {{admissionUntil: Number|null, restartTitle: String|null, live: Boolean, cls: String[], hidden: Boolean, text: String, title: String|null}}
     */
    static resolve({
        record,
        recordState,
        resolved,
        sources,
        rosterState,
        disabled,
        pendingAction,
        controlReason,
        preparation,
        cancel,
        exitLine,
        now
    }) {
        // The status row narrates the Start: the round-trip while it is live or refused, then whether
        // the session it launched opened in the seat's own folder (a desktop seat cannot be launched
        // into one), and last whether it prepared the working checkout. A confirmed wrong folder
        // outranks even a live round-trip, because a live seat in the wrong folder is the failure
        // itself; "not opened yet" and "unknown" sit below one, which a live seat contradicts.
        const
            wrongFolder        = record.sessionFolder?.state === 'wrong',
            sessionLine        = wrongFolder || !(pendingAction || controlReason || preparation)
                ? SeatSessionFolder.cardLine(record.sessionFolder)
                : null,
            // a start the Fleet refused for the declared model says so in the design read's words: the
            // recorded cause, shown only while this cockpit's own last outcome is that same refusal
            modelRefusal       = !pendingAction && !preparation && !wrongFolder
                ? SeatModel.refusal(record.seatModel, controlReason)
                : null,
            // a refused or already-expired token blocks GitHub work or Start, so it keeps its rank beside
            // Start refusals; a token that is still valid within the 7-day warning window yields to the
            // seat's current unplanned-exit and launch-admission state (riding `title` when displaced)
            credentialStart    = !pendingAction && !preparation && !wrongFolder && !modelRefusal &&
                SeatCredential.isStartCredentialRefusal(controlReason)
                ? SeatCredential.cardLine(record, {now})
                : null,
            credentialPassive  = !pendingAction && !preparation && !wrongFolder && !controlReason
                ? SeatCredential.cardLine(record, {now})
                : null,
            credentialBlocking = credentialPassive && credentialPassive.kind !== 'token-expiring'
                ? credentialPassive
                : null,
            credentialExpiring = credentialPassive?.kind === 'token-expiring'
                ? credentialPassive
                : null,
            admissionLine      = recordState !== 'off' && !(pendingAction || controlReason || wrongFolder || modelRefusal || credentialBlocking)
                ? SeatLaunchAdmission.cardLine(record.launchAdmission, {
                    now,
                    canRestart : !disabled && recordState !== 'off',
                    mcpSettings: record.mcpSettings,
                    rosterState,
                    runtime    : sources.runtime
                })
                : null,
            // the quietest exception: a running seat whose working checkout the last start did not prepare
            // has no verified skills. Running is the state the card shows, so a seat it reads offline says
            // nothing; opening the session folder is the first-launch step, so it speaks first
            skillsLine         = resolved.state !== 'off' &&
                !(pendingAction || controlReason || wrongFolder || modelRefusal || credentialPassive || admissionLine || sessionLine)
                ? SeatDependencies.cardLine(record.dependencyOutcomes, record.repoSlug)
                : null,
            winningCredential  = credentialStart ?? credentialBlocking ?? (!exitLine && !admissionLine ? credentialExpiring : null),
            live               = Boolean(
                pendingAction || controlReason || preparation || sessionLine || modelRefusal ||
                credentialPassive || admissionLine || skillsLine || exitLine
            ),
            // the runtime-source gating is already shown by the disabled controls + the source strip
            // ("RUN not nominal"), so the status line never duplicates it; pending takes visual priority
            // over a prior reason so a new attempt never shows a stale rejection, and a timeout reads as
            // an unfinished "…" (retry stays open), not a resolved "⚠", while a preparing Start refines both
            text               = wrongFolder
                ? sessionLine.text
                : cancel
                    ? cancel === 'sent' ? 'canceling start…' : 'canceling start… no answer yet'
                    : preparation
                        ? `${pendingAction === 'restart' ? 'restart' : 'start'}… ${preparation.text}`
                        : pendingAction
                            ? `${pendingAction}…`
                            : modelRefusal
                                ? modelRefusal.text
                                : credentialStart
                                    ? credentialStart.text
                                    : !controlReason
                                        ? credentialBlocking?.text ?? exitLine?.text ?? admissionLine?.text ?? credentialExpiring?.text ?? sessionLine?.text ?? skillsLine?.text ?? ''
                                        : controlReason.kind === 'timeout'
                                            ? `${controlReason.action}… no answer yet`
                                            : controlReason.kind === 'cleanup'
                                                ? `⚠ cleanup: ${controlReason.reason} — Start re-checks it`
                                                : `⚠ ${controlReason.kind}: ${controlReason.reason}`,
            timeoutTitle       = !wrongFolder && !pendingAction && !preparation && !modelRefusal && controlReason?.kind === 'timeout'
                ? `${text}. The outcome is unknown until the Fleet answers.`
                : null,
            // the last start's commit identity, when it needs repair, rides beside a refusal as its own
            // observation: the wire carries no refusal code, so it never stands in as the cause
            identityNote       = controlReason && !pendingAction && SeatGitIdentity.needsRepair(record.gitIdentity)
                ? ` · The last start's commit identity: ${SeatGitIdentity.describe(record.gitIdentity)} Repair it in Detail › Configuration.`
                : '',
            displacedExpiry    = !controlReason && !credentialBlocking && (exitLine || admissionLine) && credentialExpiring
                ? ` · ${credentialExpiring.title}`
                : '',
            // the one-line status ellipsizes (CSS); the title is the receipt carrying the full words, and
            // a preparing Start names each checkout's live row there
            title              = timeoutTitle || (cancel
                ? cancel === 'sent'
                    ? 'Cancel requested: the Fleet stops the installs and does not launch the seat.'
                    : 'Cancel requested, and the Fleet has not answered yet while the Start still prepares. Its answer settles the card.'
                : preparation
                    ? preparation.title
                    : modelRefusal
                        ? modelRefusal.title + identityNote
                        : credentialStart
                            ? credentialStart.title + identityNote
                            : (!controlReason ? credentialBlocking?.title : null) ??
                              (!controlReason && exitLine ? exitLine.title + displacedExpiry : null) ??
                              (admissionLine ? admissionLine.title + displacedExpiry : null) ??
                              (!controlReason ? credentialExpiring?.title : null) ??
                              sessionLine?.title ??
                              skillsLine?.title ??
                              (text ? text + identityNote : null)),
            cls                = [
                'fm-card-control-status',
                ...(sessionLine ? [`is-session-${record.sessionFolder.state}`] : []),
                ...(modelRefusal ? ['is-model-refused'] : []),
                ...(winningCredential ? [`is-credential-${winningCredential.state}`] : []),
                ...(exitLine && !controlReason && !wrongFolder && !modelRefusal && !credentialBlocking ? [`is-exit-${exitLine.state}`] : [])
            ];

        return {
            admissionUntil: admissionLine?.until ?? null,
            restartTitle  : admissionLine?.restart ? admissionLine.title : null,
            live,
            cls,
            hidden        : !live,
            text,
            title
        }
    }
}

export default Neo.setupClass(CardControlStatus);
