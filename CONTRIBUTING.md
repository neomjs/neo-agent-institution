# Neo.mjs Agent Institution Contributing Guide
We are very excited that you are interested in contributing to Neo.mjs Agent Institution (the Fleet Manager).<br>
No worries, you don't need to be a guru, ninja or rockstar to support the project.

## Which starting point is yours?

Three different things get called "getting started", and picking the wrong one costs an evening:

* **Exploring what the cockpit does and how its views work?** Start with the [Institution guides](learn/README.md) and
  [`ROADMAP.md`](ROADMAP.md) for a tour of the cockpit, its data states, and the native vessel.
* **Building an app *with* the Neo.mjs UI Engine or changing the Engine itself?** See [`neomjs/neo`](https://github.com/neomjs/neo)
  and its [Contributing Guide](https://github.com/neomjs/neo/blob/dev/CONTRIBUTING.md).
* **Changing Agent Institution *itself* — fixing a bug in `apps/agentos/` or `src/`, updating styles in `resources/scss/`,
  working on the Electron shell in `harness/`, or adding a test?** That is this page, and the loop below is the whole of it.

## Set up Agent Institution from a clone

You need **Node.js 24 or newer** and Git. Ordinary contributors can install, run the browser cockpit, and execute the
isolated test suites without a Brain checkout, Docker, API keys, or Neo maintainer credentials:

```bash
git clone https://github.com/neomjs/neo-agent-institution.git   # or your fork
cd neo-agent-institution
npm install
npm run server-start
```

Webpack prints the selected loopback origin. Open the Agent Institution route on that origin:

```text
http://localhost:<reported-port>/apps/agentos/index.html
```

The browser cockpit boots without a Brain checkout, showing its unanswered state until a Fleet transport answers and the
first-agent call to action when an empty registry connects.

**Your own JavaScript never needs a build** — Neo.mjs runs your edits as native ES modules, so you change a file and
reload. That does not extend to **SCSS**: styles under `resources/scss/` compile into `dist/development/css`, so run
`npm run build-themes` after a `.scss` change, or keep `npm run watch-themes` going while you work on one. App file
sizes are guarded by `npm run check-app-file-sizes`.

Running the isolated test suites:

```bash
npm run test-unit         # unit tests — no browser needed at all
```

Every test command takes a path, so you can run just the area you touched:
`npm run test-unit -- test/playwright/unit/apps/agentos/view/fleet/cockpit/startPlan.spec.mjs`.

The browser suites need real browsers, and **they do not need the same one**:

```bash
npx playwright install          # Playwright's own browsers (~1 GB)
npm run test-components         # component tests — uses Playwright's bundled Chromium
npm run test-visual             # visual regression suite (guarded by npm run check-visual-baselines)

npx playwright install chrome   # only if you do not already have Google Chrome
npm run test-e2e                # application E2E — uses your system Google Chrome
```

`test-e2e` is pinned to `channel: 'chrome'` locally, so it launches the Google Chrome installed on your machine rather
than Playwright's Chromium — `npx playwright install` alone does not provide it. When a local `neo-agent-brain` checkout
is available, you can also run the full cross-repository Neural Link witness tier:

```bash
NEO_AGENTOS_RUNTIME_ROOT=/absolute/path/to/neo-agent-brain npm run test-e2e:nl
```

If you are fixing a unit test, you need none of the browser installs.

⚠️ **Run the `npm run test-*` scripts, not `npx playwright test` directly.** There is no Playwright config at the
repository root — each tier above has its own under `test/playwright/`, and the npm scripts pass it with `-c`. Without
one, Playwright collects every tier's specs at once outside the environment their own config provides, and the bare
command exits 1 having run no test.

One thing `npm install` (`postinstall`: `neo-agent-skills-materialize`) prints when it scrolls past:
`neo-agent-skills: materialized N link(s)`. That is our [`neo-agent-skills`](https://github.com/neomjs/neo-agent-skills)
package linking itself into `.agents/skills` and `.claude/skills`. It needs nothing from you, and it never copies
private credentials into your checkout.

If any command above does not behave as described, that is a bug in this guide — please open an issue.

## What you can do to help:

### 1. Spread the Word

Neo.mjs thrives on community engagement. One of the most impactful ways to contribute is to help grow our community and share the project with others.

1.  **Star the repository:** This helps with visibility on GitHub.
2.  **Tell your friends and colleagues:** Share your experience with Neo.mjs and Agent Institution.
3.  **Engage on social media:** Write blog posts or share content on platforms like LinkedIn, X (formerly Twitter), and Facebook.
4.  **Represent Neo.mjs:** Interested in giving a talk or a workshop at a developer conference? We'd love to support you. Just reach out!
5.  **Uphold our values:** Please stick to our <a href="https://github.com/neomjs/neo/blob/dev/.github/CODE_OF_CONDUCT.md">Code of Conduct</a> in all interactions.

### 2. Use the issues tracker
1. In case you got an idea for a new feature
2. In case you find a bug
    1. Ideally, you create a new breaking test inside `test/playwright/`.
    This saves a lot of time and ensures the bug will stay fixed once the ticket is resolved.
3. Please like or comment on current tickets.
    This is a great help to figure out which tickets are the most important ones for the community.

### 3. Contribute to the Agent Institution code base

**What we are working on now.** <a href="ROADMAP.md">`ROADMAP.md`</a> says what ships in Agent Institution v1 and why,
and the <a href="README.md#the-organization-map">organization map</a> shows how this repository fits alongside the
[`neomjs/neo`](https://github.com/neomjs/neo) UI Engine, [`neomjs/neo-agent-brain`](https://github.com/neomjs/neo-agent-brain),
and [`neomjs/neo-agent-skills`](https://github.com/neomjs/neo-agent-skills). Refer to the
<a href="learn/README.md">Institution guides</a> and <a href="harness/README.md">`harness/README.md`</a> to understand
how the cockpit and Electron vessel are structured.

1. **Looking for somewhere to start?** For a first PR, take an issue labelled <a href="../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22">good first issue</a>:
   comment on one to claim it (see 3). No approval round needed; they are already approved.
   **After your first merged PR**, move on to <a href="../../issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22">help wanted</a>
   or an unassigned issue on the board, the same way. Good first issues stay reserved for first-time
   contributors, so there is always a way in for the next person.
2. For anything else, please ***always*** create a new issue inside our <a href="../../issues">Issues Tracker</a> first and wait for approval.
   This ensures that your idea fits the scope of the project and makes it less likely to get a rejected PR.
   We will do our best to reply to new tickets within 7d max. In case we don't, feel free to bump the ticket.
3. **Claim before you start.** To work on an existing ticket, comment there; we assign the first person who asks.
   An automatic reply tells you whether you are first in line. If you are, the ticket is yours: start right away,
   and a maintainer confirms the assignment. You can open a PR without being assigned, but we merge the first
   approve-worthy PR for a ticket, so if someone else holds it or gets there first, your work may not land. An
   assignment is what protects your time.
   To keep the project moving, if a ticket is assigned and we do not receive any feedback from the assignee (e.g. via a comment) within 7 days, the ticket may get re-assigned to make it available for other contributors.
4. Please make sure that pull requests are always related to an issue inside our <a href="../../issues">Issues Tracker</a>.
5. Please create PRs for the `dev` branch, not for `main`.
6. Please do not copy code from other frameworks / libraries.
    1. Adding new npm packages => dependencies / devDependencies is fine, in case there are no licensing conflicts.
7. Never commit tokens, `.env` values, or generated seat configuration.

### 4. Contributions from AI Agents & Autonomous Entities

We actively welcome contributions from artificial intelligence, LLMs, and autonomous agent swarms. Agent Institution is
built on Neo.mjs — making the application readable by humans, and **both readable and writable by machines**.

**For Human Operators of AI Agents:**
1. **Transparency:** If you use an AI agent to generate a Pull Request or formulate an issue, please briefly mention which model or agent framework was used (e.g., "Generated by Gemini 3.1 Pro," "Automated via Claude").
2. **Accountability:** You remain responsible for the code your agent submits. Please review generated PRs for architectural consistency and ensure they follow our <a href="https://github.com/neomjs/neo/blob/dev/.github/CODING_GUIDELINES.md">Coding Guidelines</a>.
3. **Setup:** Your agent needs nothing beyond the clone above — our skills package is already linked by `npm install`.

**For Autonomous Agents (If you are reading this):**
1. **Start here:** you need nothing private — no account, container, or model provider. Run:
   ```bash
   npx -p neo-agent-skills neo-agent-skills-agents-md --repo neo-agent-institution --audience contributor
   ```
   for what an outside agent should know first; the maintainer instruction layer is written for this project's own standing maintainer seats.
2. **JSON-First Multi-Thread UI:** Neo.mjs components are defined via JSON VDOM blueprints running inside an application worker, not JSX or HTML templates. State lives on `Neo.state.Provider` / `Neo.data.Store`, and styles live in `resources/scss/`.
3. **Skills & Neural Link:** `npm install` materializes `.agents/skills/` (including `unit-test`, `whitebox-e2e`, and `pull-request`), and the Neural Link MCP bridge (`neo-agent-brain:ai/mcp/server/neural-link/`) lets you inspect and drive the live scene graph directly.

<br><br>
Copyright (c) 2015 - today, <a href="https://www.linkedin.com/in/tobiasuhlig/">Tobias Uhlig</a>
