# Row 2's state walkthrough

The script for row 2 of the FM v1 ROADMAP ("truthful state and recovery guidance"). It provokes
each state the cockpit can be in, reads every surface against [the state census](CockpitStateCensus.md),
and records one receipt per state. The census says what each surface claims to show; this page
says how to make it show it.

It runs in two halves:
- **The fixture half** runs on any checkout, in one e2e spec, before an operator slot is spent.
- **The operator's slot** runs on the installed candidate, for what only the installed shell or
  the team's plane can provoke.

## The candidate and its receipt

Every receipt names what it ran on:
- **Installed:** the `Neo Harness.app` of the day's cut, with its receipt at
  `Contents/Resources/organism/organism-build-info.json` (Brain revision, Engine pin, `stagedAt`).
- **Fixture:** an Institution checkout, plus a Brain checkout at the pin its `package.json` names
  for `neo-agent-brain`. The Brain checkout needs its `ai/config.mjs`, which `npm ci` writes. The
  spec stamps both revisions into each receipt.

## The six provocations

| State | Fixture half: the spec's step | Installed candidate | Who |
|---|---|---|---|
| cold | The cockpit mounts on its fail-closed bridge, and nothing has answered. | The first seconds of a launch, before the plane answers. | Fixture: any peer. Installed: the slot. |
| unreachable | The bridge is re-pointed at a loopback port nothing listens on: the transport half of an instance switch. | The instance switcher's menu switches to an instance that does not answer. | Fixture: any peer. The menu's own switch: the slot. |
| live | The bridge is re-pointed back at the answering Fleet server. | The switcher switches back to the reachable instance. | Both. |
| stale | The Fleet server stops after answering, and the liveness timer reads the loss. | The plane stops after a live read. That is row 5's provocation (#424): its receipt is reused here, never run twice. | Fixture: any peer. The plane: row 5's slot. |
| one source failing | The PR/lane source reads a missing corpus while the A2A source answers (#263's case). | One source of the activity feed down on the team's plane. | Fixture: any peer. Live plane: the slot. |
| degraded | The shell's lifecycle answer (`degraded` with a cause) arrives through the cockpit's `applyBrainHealth`. A browser has no lifecycle owner. | A Brain daemon stopped on the installed candidate; the tray shows it. | The real fault: the slot. |

## The fixture half

`test/playwright/e2e/agentos/CockpitStateWalkthroughNL.spec.mjs` walks the six states in that
order on one mounted cockpit against a real Fleet server, the way `devFleetServer` composes it. In
each state it reads every census surface on the cockpit page:
- the spine banner (its kind, pill and sentence);
- the instance switcher's label;
- the roster's title, marker and empty-state button;
- the activity feed's head, sources line and empty note.

The words must equal the state's census cell, so a word that changes on either side fails the
spec until the census and the spec move together. Each state's words are attached to the run as
`receipt-<state>.json`.

```bash
NEO_AGENTOS_RUNTIME_ROOT=/absolute/path/to/neo-agent-brain npm run test-e2e -- agentos/CockpitStateWalkthroughNL --workers=1
```

## What only the slot reads

- Home's live field, in its own view.
- The query-time panes: memories, tasks, the Observatory and wake routes.
- The Agent Detail panes, the Connect card and Accounts.
- The plane-probe lines (`plane here`, `plane refused`, `pat refused`, `not a plane`,
  `plane unreachable`), which only the shell's plane probe produces.
- The tray, and a real daemon fault.

## Recording a receipt

For each state, a receipt on #479 carries:
- the candidate's receipt, or the fixture's two revisions;
- the provocation;
- the words on every census surface.

Two kinds of disagreement come out of this:
- **Pin lag:** a word that differs from the census because the candidate lags `dev`. It stays a
  finding of that kind until the cell is re-read at the candidate's revision.
- **A gap:** a cell that disagrees at the same revision. It becomes a gap leaf under #477, filed
  with its receipt as the Context.
