# The cockpit's state census

What every Fleet Manager surface renders in each state the product can be in, as shipped — the
state word, the reason it gives, the next step it names — with the file and symbol that own each
sentence. Row 2 of the FM v1 ROADMAP ("truthful state and recovery guidance") reads against this
matrix on the installed candidate: the walkthrough provokes the states, this page says what the
product claims to show. A disagreement between the two is a finding either way — a pin lag, or a
cell that is wrong.

**Read at `dev` `ce90152` (2026-10-03).** Cells are anchored by file and the exported symbol,
method or literal that owns the sentence — greppable at any later revision — never by line
number. A cell quoted here is the shipped string; `<…>` marks a value the surface fills at run
time. Re-read the anchor before trusting a cell on a newer `dev`.

## The rule a cell is judged by

A state word alone is not truth. A cell is **complete** when the surface names the state, the
reason it is in that state (its own retained cause, never a sibling's), and the next step the
operator can take. A cell may honestly be `cannot enter` (the surface has no such state by
construction — a query-time pane has no `stale`) or `shows nothing` (the surface stays silent and
another surface carries the truth). A cell that renders a state word without its reason or a next
step is a **candidate gap**, listed at the end and filed only once the walkthrough confirms it on
the installed candidate.

## Where the words come from

| Producer | Vocabulary | Anchor |
|---|---|---|
| The spine banner's derivation | `cold · degraded · live` as skins; pills `fleet offline / starting / blocked / failed / connecting`, `fleet degraded`, `feed partial`, `feed pending`, `agent os degraded / stopped`, `plane here / refused`, `pat refused`, `account changed`, `not a plane`, `plane unreachable`; connection words `connecting / refused / unreachable / timed out / failed` | `apps/agentos/util/SpineBanner.mjs` — `deriveSpineBanner`, `connectionVerdict`, `coldFallbackFor`, `PLANE_REFUSALS` |
| The plane's refusal sentences | `The plane refused that PAT.` · `No plane answered at that address.` · `That address is not a Neo plane.` · `The plane accepted that PAT but named no identity for it.` | `apps/agentos/util/PlaneVerdict.mjs` — `sentences` |
| The deployment-state projection | `ok · stale · unavailable` (the System view's picture) | `apps/agentos/util/DeploymentStateRead.mjs` — `pictureStates` |
| The instance switcher's words | `connected · degraded · not connected · switching` | `apps/agentos/view/fleet/instances/SwitcherButton.mjs` — `INSTANCE_STATE_WORDS` |
| Each feed owner's adapter state | roster and activity: `cold · live · stale` (+ `partial` for activity); query-time panes: `unobserved · wired · unavailable` (+ `denied · empty` for the mailbox) | the owning Container's `adapterState_` / envelope (below) |

The truth model behind them (#15, ADR 0041): an answered cause is retained and withdrawn on both
loss transitions; a wired surface keeps its stale/live semantics; a reason belongs to a surface,
never to the spine.

## The matrix

Columns are the six provocations of #477's terminal predicate. "Unreachable" is the plane or
Fleet transport not answering; "one source failing" is #263's case — the activity feed's composite
with one of its sources down while the others answer.

### Spine banner — `apps/agentos/view/fleet/cockpit/SpineBannerComponent.mjs` rendering `SpineBanner.deriveSpineBanner`

| State | Rendered |
|---|---|
| cold | Retained cause: pill `fleet offline`, sentence `Fleet data unavailable · <reason>`. Connection observed: pill `fleet connecting / refused / unreachable / timed out / failed`, sentence `Roster <read in progress / request refused / connection unavailable / read timed out / request reported an upstream failure> — no fleet data yet · <reason>`. Silence: the transport picks the line — `fleet offline` · `Fleet server offline — start it from the neo-agent-brain checkout` (plain browser); `fleet starting` · `Fleet transport starting — the cockpit connects automatically`; `fleet blocked` · `another fleet server holds port <port> — quit it, then Reconnect · <reason>`; `fleet failed` · `Fleet transport failed to start · <error>`; `fleet connecting` · `Fleet transport ready — cockpit loading · use Reconnect if this persists`. Plane causes outrank all of these: `plane here` · `A plane already runs on this machine — connect this shell to it`; `plane refused` · `The plane refused this shell — connect it again`; `pat refused` · `The plane refused that PAT. Connect again with a current one.`; `account changed`; `not a plane` · `… Connect to the plane's own address.`; each with the `connect-plane` action (`coldFallbackFor`, `PLANE_REFUSALS`). **Next step: present in every transport and plane line.** |
| live | Hidden — `{hidden: true, kind: 'live'}`; the spine shows no pill. |
| stale | Pill `fleet degraded`, sentence `Fleet feed degraded — showing last-known data · <reason>`; with a connection observation on the deciding surface: `fleet <connection word>` · `Roster <sentence> — showing last-known data`. **No next step**: "showing last-known data" states what is shown, not what to do. |
| degraded (daemon fault) | Pill `agent os degraded` or `agent os stopped`, sentence `Agent OS <degraded/stopped> — showing the cockpit over a partial organism · <reason>`, fallback `· check the tray state and the daemon log` (`DAEMON_FAULT_STATES`). The fallback names where to look; a retained reason replaces it and then **no next step is named**. |
| unreachable | Through the connection observation: `fleet unreachable` · `Roster connection unavailable — no fleet data yet` (cold grid) or `— showing last-known data` (stale grid); **no next step**. Through the plane probe: `plane unreachable` · `No plane answered at that address. Bring that plane back, or connect to another.` with `connect-plane` — complete. |
| one source failing | Pill `feed partial`, sentence `Activity feed partial — some sources unavailable · <reason>`. A cold stream over a live grid: `feed pending` · `Activity feed pending — roster is live · <reason>`. **No next step.** |

### Instance switcher — `apps/agentos/view/fleet/instances/SwitcherButton.mjs` (`updateSwitcher`, `INSTANCE_STATE_WORDS`)

| State | Rendered |
|---|---|
| cold / unreachable | Dot + label; title and `aria-label` `<label> — not connected` (`off`). Word only: **no reason, no next step** in the button; the menu lists the other instances. |
| live | `<label> — connected` (`ok`). |
| stale | `cannot enter` — the switcher has no stale word; staleness is the feeds'. |
| degraded | `<label> — degraded` (`limited`). Word only. |
| switching | `<label> — switching` (`starting`). |
| one source failing | `cannot enter`. |

### Home's live field — `apps/agentos/view/home/Container.mjs` (`teamLine`, `updateField`)

| State | Rendered |
|---|---|
| cold | Lead `No word from the team yet` (quiet class); plane line `Plane not connected` (hidden only when the instance is `ok`). First run (`shellPlaneConfigured === false`): the lede and the `Connect a plane` door instead of the field. **Reason: none. Next step: only on first run.** |
| live | Lead `<up> of <total> agents up` or `No agents yet`; plane line hidden. |
| stale | Lead `Lost touch with the team` (any non-live adapter state or a `degradedReason`); **no reason shown, no next step** — Home sends the operator to the cockpit doors, which stay visible. |
| degraded | Same `Lost touch with the team` when `gridDegradedReason` is set; the plane line `Plane degraded` when the instance is `limited`. The reason is held (`degradedReason`) and **not rendered**. |
| unreachable | Lead `No word from the team yet` or `Lost touch with the team` by adapter state; plane line `Plane not connected`. No reason, no next step. |
| one source failing | `shows nothing` — Home reads the roster only. |

### Roster — `apps/agentos/view/fleet/roster/Container.mjs` (`applyAdapterState`, the `fleet-stale` marker, presence chip), `roster/Controller.mjs` (`syncEmptyCta`)

| State | Rendered |
|---|---|
| cold | Head marker `not answered yet`, head class `is-cold`; title `Fleet · 0 agents`; the empty CTA stays hidden (a cold roster makes no empty claim). **Reason: none — by design the spine banner knows why. Next step: none here.** |
| live | Marker empty; `Fleet · <N> agents`. An answered empty roster shows the CTA `Add your first agent` (`syncEmptyCta`: hidden when `total > 0` or cold). |
| stale | Marker `stale — reconnecting` over the last-known cards (never a blanked grid). Reason: none; next step: implied by "reconnecting". |
| degraded (presence axis) | Header chip `presence unobservable · <reason>`, `aria-label` `Presence: unobservable. <reason>.`; every card's presence band vanishes (absence of signal, never a verdict). **Next step: none.** |
| unreachable | Rendered as cold or stale by adapter state; the connection word lives on the banner. |
| one source failing | `cannot enter` — one source. |

### Activity feed — `apps/agentos/view/fleet/activity/Container.mjs` (`updateHead`, `empty-note`, `describeActivityCounts`)

| State | Rendered |
|---|---|
| cold | Head state `not answered yet`; the empty note hidden (no answer is not an empty answer). No reason, no next step. |
| live | Head `● streaming` with `· quiet since <…>` when the newest event is old (`describeQuietSince`); an answered empty feed shows `no activity yet`; sources line `sources · <counts>`; retention line from `describeActivityRetention`. |
| stale | Head `stale — reconnecting` when rows are retained, else `unavailable` with the note `Activity unavailable`. **No reason, no next step.** |
| degraded | `cannot enter` as its own word — a daemon fault reaches the banner, not the feed. |
| unreachable | As cold or stale by adapter state. |
| one source failing | Head `partial — some sources unavailable`; the sources line carries the per-source counts (the reason by enumeration); rows from the answering sources stay (#263). **Next step: none.** |

### Mailbox — `apps/agentos/view/fleet/mailbox/Container.mjs` (`honestState`, the honest-state line)

| State | Rendered |
|---|---|
| cold (unobserved) | `Mailbox feed not wired` (the default case — rendered until a snapshot lands). No next step. |
| live | Rows; an answered empty inbox `No active messages for <subject>`; an admission denial `Access denied: <viewer> holds no read grant for <subject>'s inbox` (reason complete; next step none — request access is the action it does not name). |
| stale | `cannot enter` — query-time; a torn payload reads as unobserved, never as rows. |
| degraded | `Mailbox unavailable: <reason>` (fallback `source unavailable`). Reason complete; **next step: none**. |
| unreachable | Reaches the pane as `degraded` (capability) or stays unobserved. |
| one source failing | `cannot enter`. |

### Memories — `apps/agentos/view/fleet/memories/Container.mjs` (the meta line in the summaries render)

| State | Rendered |
|---|---|
| cold (unobserved) | `Memories not observed yet`; without a selection `Select an agent card in the roster to read their recent sessions.` (next step named); pending `Reading <agent>…`. |
| live | `<target> · <n> of <total> sessions · captured <stamp>`; `session summaries · query-time · not authority`; `Refresh` button. |
| stale | `cannot enter` — query-time, stamped. |
| degraded | `Memories unavailable · <reason>` (fallback `unknown reason`). **Next step: the `Refresh` button only.** |
| unreachable | As degraded. |
| one source failing | `cannot enter`. |

### Tasks — `apps/agentos/view/fleet/tasks/Container.mjs` (`SECTIONS`, the meta line, `unobservedQueueLine`)

| State | Rendered |
|---|---|
| cold (unobserved) | Meta `Tasks not observed yet`; each section's empty row `Tasks not answered yet.`; pill `cold`. |
| live | Pill `live`; sections with honest empties `Nothing in flight.` · `Nothing scheduled.` · `Nothing completed recently.`; an unreadable queue: `unobservedQueueLine` names what could not be read. |
| stale | `cannot enter` — query-time, stamped. |
| degraded | Pill `unavailable`; meta `Tasks unavailable · <reason>` (fallback `unknown reason`). **Next step: `Refresh` only.** |
| unreachable | As degraded (a transport fallback is an unavailable answer). |
| one source failing | The queue section alone reads `unobservedQueueLine` while the others answer — the pane's own partial. |

### Observatory — `apps/agentos/view/fleet/goldenpath/ObservatoryContainer.mjs` (`updateLine`) over `apps/agentos/util/GraphSceneEnvelope.mjs` (`describe`) and `apps/agentos/util/GoldenPathEnvelope.mjs`

| State | Rendered |
|---|---|
| cold (unobserved) | Head line `Unobserved`. No reason (none exists yet), no next step. |
| live | `Current · captured <stamp> · <n> nodes · <m> edges` (+ `<k> nodes not drawn` and `partial, budget <n> nodes / <m> edges / <k> KiB` when the read was cut, else `complete`); lens `lens · <n> nodes · <p> peers`; heat `heat · last <d> days · <k> unknown`. |
| stale | `cannot enter` as a word: a scene is stamped `captured <stamp>`; the route's expiry reads `route withheld · <reason>` beside it (Golden Path leaf: `Typed route · withheld · <reason> · last known good route, captured <stamp>`). |
| degraded | `Degraded · <reason> · <holds> · <partial, budget …>`; Golden Path leaf `Typed route · degraded · <reason>`; `Recommendation unavailable · <reason>`; `REM unavailable · <reason>`. Reasons complete; **next step: `Refresh` only.** |
| unreachable | `Unavailable · <reason>`; Golden Path `Typed route · unavailable · <reason>`. |
| one source failing | Per source: the route, REM and recommendation lines above each name their own failure while the scene draws. |

### Connect card (setup) — `apps/agentos/view/setup/ConnectContainer.mjs` (`reasonText`, `onConnect`)

| State | Rendered |
|---|---|
| cold | Status `Enter your GitHub or GitLab PAT in the window that opens.` after Connect. |
| live | `Connected. The shell restarts to attach.` |
| stale | `cannot enter`. |
| degraded | `cannot enter` — the card reports one attempt's verdict. |
| unreachable | `No plane answered at that address.` — **no next step** (the banner's version adds `Bring that plane back, or connect to another.`). |
| refusals | `The plane refused that PAT. Nothing was stored.` · `That address is not a Neo plane. Nothing was stored.` · `The plane accepted that PAT but named no identity for it. Nothing was stored.` · `This Mac cannot store the PAT encrypted, so nothing was stored.` · `Use an https address, or http on this machine (127.0.0.1 or localhost).` (next step named) · `Connecting a plane needs the installed Fleet Manager; in a browser, add the plane through the instance switcher.` (next step named) · `Canceled. Nothing was stored.` · fallback `The plane could not be attached.` |

### Agent Detail status panes — `apps/agentos/view/fleet/detail/Container.mjs` (the ledger rows)

| State | Rendered |
|---|---|
| cold (unobserved) | Every axis row reads `not reported` (`is-unobserved`), sources `<state>` with dashes as spaces; #391 records that the four panes have no live source today, so this is the shipped steady state. |
| live | `session <state>` · `status <participation>` · per axis the reported state (`on` / `none` fresh) · sources `wired · <confidence>`. |
| stale | Axis tone `is-stale` for a deviating state; freshness `fresh / stale / lost` from `observedAt` vs TTL when a feed is wired. |
| degraded | A reported `unknown` reads `is-unobserved`; reason in the row's title when the descriptor carries one. **Next step: none.** |
| unreachable | As unobserved. |
| one source failing | Per source row — the one that failed reads its state, the others `wired`. |

### Wake routes — `apps/agentos/view/fleet/wake/Container.mjs` (the meta line)

| State | Rendered |
|---|---|
| cold (unobserved) | `Wake routes not observed yet`; `Read routes` button (next step named). |
| live | `<n> seat routes · … · captured <stamp>`. |
| stale | `cannot enter` — query-time, stamped. |
| degraded | `<n> seat routes · silent axes: <reason> · captured <stamp>` — rows kept, every silent axis named. Next step: none. |
| unreachable | `Wake routes unavailable · <reason>` (fallback `unknown reason`). |
| one source failing | The degraded line above is exactly this case (one axis silent, the rest answered). |

### Accounts (configuration and Repositories cards) — `apps/agentos/view/accounts/Panel.mjs` (`setAgentConfigSaveStatus` and its Repositories twin) over `apps/agentos/util/ConfigIntentRoundTrip.mjs` (`runConfigIntent`, `runPlaneCredentialIntent`)

The cards show no feed state: they read the roster for their rows and render an ephemeral per-agent
save status with four states — `pending · accepted · rejected · superseded` — each with its sentence.

| State | Rendered |
|---|---|
| cold / unreachable | `cannot enter` as a feed word; an attempt against an unreachable registry ends `rejected` with `Could not save the configuration. Nothing was changed.` (the catch-all), or the Fleet's own reason. |
| live (an attempt) | `pending` `Saving configuration…` → `accepted` `Configuration saved.`; plane credential: `Waiting for the plane credential…` → `Plane credential stored.` |
| stale | `cannot enter` — a change from another surface reads `superseded` · `Superseded by a newer change from another surface.` (non-terminal, never latched). |
| degraded | `rejected` with the Fleet's reason when it names one; otherwise `Configuration response was invalid. Nothing was changed.` |
| refusals (by mode) | `Configuration is unavailable in dev-server mode. Nothing was changed.` · `This Fleet does not take plane credentials yet. Nothing was changed.` · `Set the plane credential from the installed Fleet Manager. Nothing was changed.` (next step named) · `The plane credential was not stored.` |
| one source failing | `cannot enter`. |

Every rejection says what did not change; only the installed-shell line names a next step.

## Candidate gaps (not filed — the walkthrough confirms them first)

Each is a cell reference and the word that is missing. Filing waits for #479's receipt on the
installed candidate.

1. **Banner · stale, degraded, unreachable (connection), one source failing — next step.** The pills name the state and the retained reason; none of these lines names an action. The cold and plane lines do (`start it`, `quit it, then Reconnect`, `use Reconnect`, `connect this shell to it`, `Connect again`). Candidate word: next step.
2. **Home · stale, degraded — reason.** `Lost touch with the team` covers both; the held `degradedReason` is not rendered and the plane line says only `Plane degraded`. Candidate word: reason.
3. **Instance switcher · degraded, not connected — reason, next step.** Word only in the title and `aria-label`.
4. **Roster · stale — reason.** `stale — reconnecting` names the state and implies the step; the retained cause stays on the banner. Whether a surface may defer its reason to the spine is the #15 question the walkthrough should answer by reading both at once.
5. **Activity · stale, partial — next step.** The head and the sources line give state and reason; nothing names an action.
6. **Mailbox · denied — next step.** `Access denied: <viewer> holds no read grant for <subject>'s inbox` names the reason and not the action (request access).
7. **Connect card · unreachable — next step.** `No plane answered at that address.` is shorter than the banner's `Bring that plane back, or connect to another.`
8. **Query-time panes (memories, tasks, Observatory, wake) · degraded / unavailable — next step.** Each names its reason; the only action is the `Refresh` / `Read routes` button, which is a retry, not guidance.
9. **Accounts · rejected — next step.** Every rejection ends `Nothing was changed.`; only `Set the plane credential from the installed Fleet Manager` names an action. The dev-server refusal, the invalid-response and the catch-all leave the operator with the fact and no step.
10. **Roster · scoped-empty** — `Add your first agent` for an answer of `0 agents shared with you` on a live plane is the one gap already filed by source: neomjs/neo#16824.

## Reading this page against the installed candidate

The candidate lags `dev` by its pins, so a sentence here may be newer than the one on screen.
Note the candidate's receipt (`Contents/Resources/organism/organism-build-info.json`) beside each
provocation; a word that differs from this page is a pin-lag finding, not a vocabulary gap, until
the same cell is re-read at the candidate's revision.
