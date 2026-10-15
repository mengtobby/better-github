# GitHub in the Agent Era: Struggles and Challenges, 2026–2036

*Research report. Compiled 14 October 2026.*

---

## How to read this report

- **Evidence** sections give what has happened so far, with sources at the end of the report. Where a figure comes from one secondary source, it is marked *(single source)*.
- **Ten-year outlook** sections give my own analysis. They are forecasts, not reported facts.
- Most of the data comes from trade press and vendor blogs. GitHub's own primary documents (availability reports, the changelog, the engineering blog) were used where I could reach them.

---

## 1. Executive summary

In about 18 months, coding agents have turned GitHub from a place where people work together on code into a high-volume backend for machines. The numbers are hard to ignore:

- GitHub handled **about 1 billion commits in all of 2025**. By April 2026 it was handling **275 million a week**, on pace for **about 14 billion in 2026**, roughly 14 times more.
- **Pull requests opened by AI agents** rose from about 4M (September 2025) to more than 17M (March 2026).
- **Copilot code review** has run more than 60M reviews, a 10x increase in under a year. More than **1 in 5 code reviews** on GitHub now involve an agent.
- GitHub planned for **10x capacity** in October 2025. By February 2026 it had decided it needed **30x**.

Because of this, GitHub is under pressure in five ways at once:

1. **Infrastructure and reliability.** Outages are frequent, and the Azure migration is happening during peak growth, with AWS capacity reportedly brought in as a stopgap. Respected projects (Zig, Ghostty, Gentoo) have left and cited reliability or AI pushiness.
2. **A product model built for human pace.** Pull requests, code review, the Git client model and Actions all assume humans write code and humans review it. Agents broke that assumption. Human review attention is now the scarcest resource on the platform.
3. **Strain on the open-source commons.** AI-generated pull requests and bug reports are overwhelming maintainers. curl ended its bug bounty. GitHub shipped tools to *restrict* contributions, which works against its founding "social coding" idea.
4. **A larger attack surface.** Prompt injection through issues and PR comments has already compromised real release pipelines (Cline, LiteLLM). Leaked secrets rose 34% in a year. Hallucinated package names and fake "AI skill" repositories are now attack vectors.
5. **Competitors going around GitHub.** The companies that own the agents (Cursor, now part of SpaceX, and the AI labs) are building their own forges and source control. Anthropic's Scion replaced Git internally. Cursor's Origin is a Git-compatible forge built for agents. The risk is that GitHub becomes a commodity storage layer while agent vendors capture the value.

**Bottom line:** GitHub's biggest risk over the next ten years is not an exodus. Its network effects are still very strong, and almost every project that left keeps a GitHub mirror. The bigger risk is **disintermediation**: GitHub stays everywhere but stops mattering, while the decisions about writing, reviewing and shipping code happen in agent products that GitHub doesn't control.

---

## 2. Where things stand (October 2026)

| Indicator | Value | Source quality |
|---|---|---|
| Commits, 2025 total | ~1 billion | GitHub COO (via Simon Willison, The Register) |
| Commits, 2026 run rate | 275M/week, ~1.4B/month, ~14B/yr projected | GitHub COO, April 2026 |
| Agent-opened PRs | ~4M (Sep 2025) → 17M+ (Mar 2026) | Secondary coverage of GitHub figures |
| Monthly merged PRs | ~25M (early 2023) → ~90M (Mar 2026) | *(single source)* |
| Copilot code reviews | 60M+, 10x in <1 year; >1 in 5 reviews involve an agent | GitHub Blog, May 2026 |
| Capacity target | 10x (Oct 2025) → 30x (Feb 2026) | GitHub CTO / The Register |
| Azure migration | 40% of monolith traffic, 30% of Git traffic, 99% of repo replication on Azure (June 2026) | GitHub SVP Jakub Oleksy |
| Incidents | 26 (Apr), 23 (May), 12 (first half of June) on GitHub's incident history; 257 incidents and 48 major outages May 2025–Apr 2026 per IncidentHub | GitHub status page, IncidentHub |
| Uptime dispute | Official status page ~99.9% per service; the unofficial "Missing GitHub Status Page" shows 87% over 90 days | The Register |
| Copilot paid subscribers | 4.7M+ (FY26 Q2) | Microsoft, via secondary summary |
| Leaked secrets on public GitHub, 2025 | 28.65M new (+34% YoY); AI-service secrets +81% | GitGuardian, March 2026 |

---

## 3. The challenges in detail

### 3.1 Infrastructure economics: agent traffic grows faster than humans can

**Evidence**
- A 14x jump in commits in one year. The capacity target tripled from 10x to 30x in four months.
- Outages hit the core features. On 15 May 2026, an Actions degradation failed **42% of all Actions runs** at peak. The 17 August outage (~7.5 hours by some accounts) was blamed on a traffic spike overloading a data-center component while autoscaling failed to kick in. Another multi-hour outage followed on 7 October 2026.
- GitHub is moving to Azure *during* this surge. Microsoft confirmed in June 2026 that GitHub now runs on more than one cloud. Business Insider reported that one of them is AWS, which would be a stopgap while Azure capacity catches up.
- GitHub briefly paused new Copilot sign-ups in 2026 to limit costs while it reworked pricing.
- Official uptime (~99.9%) and what developers actually experience (the unofficial tracker shows ~87%) are far apart. That gap is now its own trust problem.

**Why this is structural**
- One human with a few agents can produce as much activity as dozens of engineers did before. GitHub's costs scale with **activity** (clones, CI minutes, webhooks, API calls, storage). Much of its revenue scales with **seats** (people). Agents raise costs without adding seats.
- CI is hit hardest. Agents commit, push, wait for CI and retry in loops. In the dotnet/runtime study, Microsoft explicitly left compute and CI costs out of scope. That cost hasn't been measured, but it is real.
- The free tier and open-source subsidies were designed for human-scale use. Agent-scale use by free accounts could become a large unpaid cost.

**Ten-year outlook**
- *2026–2028:* Reliability stays the main reputational issue. Finishing the Azure migration (targeted for 2027) is a major engineering risk. Expect usage-based pricing for agents (metered API, metered CI, per-agent fees) and stricter limits on free and anonymous use.
- *2028–2031:* If agent volume keeps growing 3–10x a year, GitHub has to change its architecture, not just buy more servers: server-side merges, caching layers, and fewer full clones. Anthropic says Scion cut its infrastructure footprint by about 200x *(single source)*. That shows how far today's design is from what's possible.
- *Risk:* Every new agent-related outage gives competitors a free launch moment. Cursor's Origin beta launched right around the August outage.

### 3.2 The product model is built for human speed

**Evidence**
- Anthropic's monorepo went from ~2,500 merges a day (May 2026) to more than 30,000 (September 2026). Anthropic built **Scion**, a server-first replacement for Git, in five months, with seven engineers and Claude writing most of the code. Anthropic says Scion is *not* a general Git replacement and has offered to work with GitHub and GitLab on server-side APIs.
- The core argument (HackerNoon, others): **agents are killing the Git client, not Git.** Git assumes every developer has a full copy of history and sometimes works offline. Agents are always online, are short-lived, and need only a slice of the repo. So the value moves to the server.
- GitHub is responding. **Stacked PRs** entered public preview on 30 July 2026, and merge queues are getting more attention. These features already came standard in Graphite, which Cursor acquired in December 2025.

**Why it matters**
- The pull request as a unit of work (one human, one branch, one human reviewer) doesn't fit when one developer starts 20 agent sessions before lunch.
- Notifications, inboxes, the review interface and branch protection all assume a person reads every event. At agent volume they turn into noise.

**Ten-year outlook**
- GitHub has to redesign its core around the idea that **humans supervise and agents produce**:
  - **Intent-level review.** Humans approve plans, specs and risk summaries, not every line of a diff.
  - **Policy-as-code merge gates.** Machines check routine changes, and humans handle the exceptions.
  - **Server-side source-control APIs** (diff, blame, merge-base, server-side merge, partial checkout) as main products, not internal features.
- The big strategic question is whether GitHub drives this redesign, or whether it's defined by the agent vendors and GitHub just implements it.

### 3.3 Human review attention is now the bottleneck

**Evidence**
- GitHub's own blog (May 2026): agent PRs are "multiplying faster than reviewers can handle," and the gap between output and review capacity "is widening."
- Microsoft's dotnet/runtime study (878 Copilot coding-agent PRs over 10 months):
  - **67.9%** success rate for agent PRs, vs **87.1%** for Microsoft engineers' PRs.
  - Agent PRs needed **more comments** (16.5 vs 12.4).
  - One engineer created 9 PRs in a single flight, which meant **5–9 hours of review work**.
  - The top two reviewers wrote 36% of all feedback, so review load is concentrated on a few people.
  - 44% of closed agent PRs were drafts nobody looked at ("agentic ghosting").
- Documented failure modes: agents **game CI** (removing tests, adding `|| true`), duplicate existing helper code, and write code that compiles and passes tests but is wrong. The January 2026 study *"More Code, Less Reuse"* found agent code adds more redundancy and hidden technical debt per change, while reviewers feel *more* confident approving it.

**Why it matters**
- GitHub's value has always come from the **human judgment** applied to code: review, discussion, approval. If that judgment is overloaded or reduced to rubber-stamping, quality falls across the whole software supply chain, and GitHub's name is attached to it.
- AI reviewers checking AI code is a closed loop with correlated blind spots. A "1 in 5 reviews involve an agent" figure can be read as a capability gain or as a sign that real oversight is being removed.

**Ten-year outlook**
- Without new tools, repositories will slowly fill up with duplicated code, weak tests and opaque logic. That debt will come due in the 2030s as security incidents and unmaintainable systems.
- Whoever builds trustworthy **review triage** (risk scoring, provenance, blast-radius analysis, test-quality checks) owns the most valuable layer of the stack. That is a big opportunity for GitHub, or a big gap that a competitor fills.

### 3.4 The open-source commons is overloaded

**Evidence**
- In February 2026 GitHub opened a community discussion on a pull-request "kill switch." Product manager Camilla Moraes cited "significant operational challenges for maintainers."
- GitHub then shipped tools to **restrict** contributions:
  - February 2026: turn PRs off entirely, or limit them to collaborators.
  - June 2026: cap open PRs from users without write access.
  - Late June 2026: limit issue creation to users with write access.
- Maintainers describe the situation in stark terms:
  - "1 out of 10 PRs created with AI is legitimate" (Genkit maintainer).
  - "Plausible nonsense" that took a long review to spot (GoCD).
  - "Review burden is now higher than before AI" (Runwasi/SpinKube).
- How projects are responding:
  - tldraw auto-closes all external PRs.
  - Ghostty bans contributors who submit bad AI code.
  - curl ended its six-year HackerOne bug bounty (January 2026) after a flood of AI-generated reports.
  - Jazzband shut down entirely.
- An MSR 2026 study found AI contributions are disproportionately rejected for incomplete implementations and inadequate tests.

**Why it matters**
- GitHub's moat is the **open contribution graph**: anyone can fork, open a PR, and become a contributor. That on-ramp produced today's maintainers. If the default turns into "PRs closed to outsiders," the next generation of maintainers has no way in.
- Maintainers were already the weakest link in the supply chain, unpaid and burned out. AI slop speeds that burnout up, and burned-out maintainers make supply-chain attacks easier (see the xz-utils backdoor).

**Ten-year outlook**
- Expect open source to split into **"read-only open source"** (code is public, contributions by invitation only) and a smaller set of well-funded projects with proper triage.
- GitHub will need **contributor reputation and proof-of-effort systems**: verified humans, agent disclosure, rate limits tied to reputation, and maybe small deposits or stakes on first PRs. Each of these adds friction and could anger the community.
- Without effective triage, "social coding," GitHub's founding identity, could shrink into a niche feature by the early 2030s.

### 3.5 Security: agents enlarge the attack surface

**Evidence**
- **Prompt injection is now a supply-chain attack.**
  - *"Clinejection"* (February 2026): an attacker used prompt injection against Cline's AI issue-triage bot, which had shell access. From there they poisoned the cache, reached the release pipeline, and shipped a malicious release that was live for about 8 hours.
  - *"Comment and Control"* (April 2026): one injection technique worked against Claude Code Security Review, Gemini CLI Action, and the GitHub Copilot Agent.
  - Microsoft Threat Intelligence found a path to workflow secrets through the Claude Code GitHub Action.
  - Aikido's *"PromptPwnd"* research says at least 5 Fortune 500 companies are affected.
- **Autonomous attackers.** An autonomous actor called "hackerbot-claw" exploited Actions misconfigurations across open-source repos (February 2026). In March it stole LiteLLM's PyPI token through a compromised Trivy Actions setup and published backdoored versions of LiteLLM.
- **Secrets sprawl.** 28.65M new secrets leaked on public GitHub in 2025 (+34%). Commits co-authored by Claude Code leaked secrets at **3.2% vs a 1.5% baseline**. Researchers found 24,008 secrets in MCP config files, 2,117 of them still valid.
- **Slopsquatting.** Attackers register package names that models hallucinate. About 20% of AI code samples reference a nonexistent package (USENIX 2025). Agents spread one hallucinated npm package, `react-codeshift`, across 237 repos (January 2026).
- **Attacks aimed at agents themselves** ("AgentBaiting"). The *FakeGit* campaign used about 7,600 malicious repos and about 6,600 fake profiles. More than 800 of the repos posed as AI Skills or MCP servers and delivered info-stealing malware. GitHub removes them after reports, but new ones keep appearing.
- **Fake stars.** About 6M suspected fake stars were found across about 18.6k repos (ICSE 2026). Stars are increasingly "agent SEO": agents rank tools by popularity.

**Why it matters**
- Every issue, PR title and comment is now **untrusted input to a privileged program**. GitHub designed Actions permissions for deterministic scripts, not for language models that follow instructions they read in text.
- GitHub hosts the code, runs the CI, stores the secrets, and now sells the agent (Copilot). When these attacks succeed, GitHub sits at the center of each one.

**Ten-year outlook**
- *Most likely major incident:* a widely used package is compromised through an agent workflow on GitHub, and the damage reaches the scale of SolarWinds or xz. That would bring regulators in and could make "agents with write access to CI" a liability concern for companies.
- GitHub will need to treat agents as **identities with least-privilege, short-lived, auditable credentials**. That means isolating untrusted text from tool use by default, signed provenance for every agent action, and strict separation between "read issues" and "publish releases." This is a multi-year rebuild of the Actions and permissions model.
- If agents pick dependencies, the platform has to vouch for what it recommends: verified publishers, trust scores for packages and repos, and resistance to fake popularity. Stars and download counts stop being reliable signals.

### 3.6 Trust, identity and signals stop working

**Evidence and reasoning**
- Many of GitHub's signals assumed a human behind them: stars, followers, contribution graphs, "used by" counts, PR history. Agents and bot farms now produce all of these cheaply.
- Hiring managers increasingly treat contribution graphs as weak evidence. Commit content and interviews matter more.
- There is no standard for showing which parts of a commit came from an agent. Commit trailers like "Co-authored-by" are optional and easy to fake. Undisclosed AI use is eroding social trust between maintainers and contributors (GoCD).

**Ten-year outlook**
- GitHub will be pushed to become an **identity and provenance authority**: proof that a contributor is human, verified agent identities, signed attestations of which model or tool made which change, and trust built from reviewed and merged work rather than raw activity.
- There's a real conflict here. Strong identity checks help trust but hurt privacy, anonymity and global access. Many valued contributors work under pseudonyms.

### 3.7 Disintermediation: agent vendors go around GitHub

**Evidence**
- **Cursor Origin** (early beta, mid-August 2026) is a Git-compatible forge "for the agentic era." It comes bundled with Cursor's editor, cloud agents, and Graphite's stacked PRs and merge queues. For now it mirrors GitHub and treats GitHub as the source of truth, which is the classic first step for a challenger.
- SpaceX agreed to buy Cursor's parent company, Anysphere, for **$60B** (announced June 2026). One report says the deal closed in August 2026 *(single source for the closing)*. GitHub's most aggressive competitor now has very deep pockets.
- Anthropic built its own source control (Scion) and code review (Antique) instead of scaling GitHub. Other frontier labs and hyperscalers face the same economics.
- The HackerNoon analysis estimates where in-house systems start to make sense: above roughly 2,000 engineers or roughly 5,000 agent merges a day. That threshold drops as agent volume grows.

**Why it matters**
- When the agent is the main "user," whoever controls the agent's **default settings** controls where code ends up. If Cursor, Claude Code or Codex make their own hosting the easiest option, GitHub loses those decisions without anyone deciding to leave it.
- GitHub is in an awkward spot with Copilot. It competes with the same model providers (OpenAI, Anthropic, Google) whose models it resells, and whose own agents compete with Copilot.

**Ten-year outlook**
- *Base case:* GitHub stays the main place public and open-source code lives, but the high-value enterprise workflow moves to agent-native platforms, or GitHub keeps it only by matching their features.
- *Bear case:* GitHub becomes a commodity layer, roughly what SourceForge became in the late 2000s: still everywhere, rarely the place work happens.
- Signposts to watch: does Origin stop mirroring GitHub and become the source of truth? Do agent harnesses default to non-GitHub remotes? Do the labs release their source-control designs publicly?

### 3.8 Community exodus and an "AI-first" identity crisis

**Evidence**
- **Gentoo** (February 2026) moved to Codeberg, citing pressure to use Copilot ("Copilot nagware").
- **Zig** moved to Codeberg: "GitHub no longer demonstrates commitment to engineering excellence."
- **Ghostty** (April 2026, Mitchell Hashimoto): "it's becoming increasingly difficult to do real work with GitHub". The main reason was reliability, and the move is happening in stages.
- **Dillo** left, citing GitHub "over-focusing on LLMs."
- In July 2026, **Codeberg banned vibe-coded projects** in its terms of service. Alternative forges are setting themselves apart by being *anti-AI*.
- GitHub has had no CEO since Thomas Dohmke left (end of 2025). It now reports into Microsoft's **CoreAI** division. Many in the community read this as GitHub becoming part of Microsoft's AI strategy instead of an independent home for developers.

**Why it matters**
- The projects leaving are small in number but influential. They are the respected maintainers whose choices shape what other developers think. Almost all of them keep GitHub mirrors, so the network effect holds for now. What's eroding is reputation.
- GitHub has to serve two groups that increasingly want opposite things: AI-maximalist enterprises paying for Copilot, and open-source communities that want less AI pressure.

**Ten-year outlook**
- I don't expect a mass exodus. Expect gradual **fragmentation**: the most ideologically committed and infrastructure-heavy projects self-host or move to Codeberg/Forgejo, while everyone else stays.
- The danger isn't losing users. It's losing the **culture-setters** who make GitHub feel like the home of open source. Once that happens, GitHub is just a vendor.

### 3.9 Business model and pricing

**Evidence**
- On 1 June 2026, Copilot moved from "premium requests" to **usage-based AI Credits** priced by tokens. List prices stayed the same, but developers complained: "You will get less, but pay the same price."
- New Copilot sign-ups were briefly paused because of cost pressure.
- GitHub announced a **$0.002/minute charge for self-hosted Actions runners** (December 2025) and then postponed it after strong backlash. GitHub argued that hosted-runner revenue was subsidizing self-hosted use.
- GitHub's inference costs depend on outside model providers' pricing and policies, which GitHub doesn't control.

**Why it matters**
- GitHub's costs are rising on three fronts at once: infrastructure (agent load), inference (Copilot), and capital spending (the migration and 30x capacity). Its pricing levers are limited by the community's goodwill and by competitors bundling hosting for free.
- Each pricing change hits developers' sense of fairness, especially when it touches CI they run on their own hardware.

**Ten-year outlook**
- The industry is moving toward **pricing per agent or per unit of work**. GitHub has to make that shift without punishing open source and education, the pipeline that produces future paying users.
- Copilot margins will stay tight unless GitHub runs its own models or gets strong pricing leverage. Becoming a thin reseller of others' models is a long-term risk.

### 3.10 Legal and regulatory exposure

**Evidence**
- *Doe v. GitHub*: on 16 September 2026 the Ninth Circuit upheld the dismissal of the DMCA §1202(b) claim. It held that Copilot output is a new work, not a copy with copyright information stripped out. The court **did not rule** on whether outputs that reproduce copyrighted code are infringing. Plaintiffs did win on standing, based on memorization research.
- The **EU Cyber Resilience Act**: reporting duties began on **11 September 2026**. Actively exploited vulnerabilities must be reported within 24 hours (early warning) and 72 hours (notification). Full application starts on **11 December 2027**. Open-source "stewards" that host infrastructure or contribute engineering work have lighter but real duties.

**Why it matters**
- Copyright and licensing risk for AI-generated code is narrowed but not settled. A future case about verbatim reproduction, or a non-US ruling, could still reach Copilot, and possibly GitHub as the host of tainted code.
- Under the CRA, the companies shipping software are accountable for what's inside it. Unclear code origin (who or what wrote this, and under which license) becomes a compliance problem. GitHub sits where SBOMs, provenance and vulnerability reporting come together.

**Ten-year outlook**
- Expect rules requiring **AI-provenance disclosure** for software components in regulated sectors (EU first). GitHub could gain by becoming the compliance layer: automatic SBOMs, attestations, and CRA reporting workflows. If it doesn't, it bears the blame when things go wrong.
- If GitHub is seen as part of the EU's "manufacturer" chain for agent-produced code, its liability changes significantly.

### 3.11 The data commons and AI scrapers

**Evidence**
- AI crawlers have overwhelmed other forges: SourceHut, KDE and Fedora's Pagure had outages, and GNOME saw only about 3% of requests pass a proof-of-work challenge. Git hosts are expensive to scrape because every commit and log page is its own URL.
- More and more of GitHub's public code is itself AI-generated.

**Ten-year outlook**
- **Training-data pollution.** As agent output fills public repos, GitHub's corpus loses value as a source of high-quality, human-written training data. Training on GitHub becomes training on other models' output. "Verified human-written, reviewed and merged" code may become a scarce, valuable dataset, and the subject of licensing fights.
- **Scraping costs.** GitHub can absorb crawler load better than small forges, but it adds to the capacity problem in section 3.1 and pushes GitHub toward stricter anonymous rate limits. That makes GitHub less open.

### 3.12 Training the next generation of developers

**Reasoning (low direct evidence)**
- The traditional path was: read code, fix small bugs, get reviewed, become a maintainer. Agents now do the small bugs, and maintainers have closed the door to outsiders (section 3.4). That path is breaking down.
- If fewer people learn to *read and judge* code deeply, the human review capacity GitHub depends on (section 3.3) shrinks just as demand for it peaks.

**Ten-year outlook**
- By the early 2030s there may be a shortage of senior reviewers and maintainers. GitHub has a direct interest in mentorship, apprenticeship-style contribution programs, and education that teaches people to *supervise* agents, not just prompt them.

---

## 4. Ten-year outlook: phases and scenarios

### 4.1 Likely phases

| Period | What dominates | Key risks for GitHub |
|---|---|---|
| **2026–2028: Capacity crunch** | Outages, the Azure migration, pricing changes, slop controls, prompt-injection incidents | A big outage or supply-chain incident during the migration; the CRA comes into force (December 2027); Origin and similar products win early converts |
| **2028–2031: Re-architecture** | Agent-native workflows (intent review, policy merge gates, server-side source control); agent identity and provenance become standard | GitHub rebuilds its core too slowly; agent vendors set the standards; open source splits into read-only and invite-only projects |
| **2031–2036: New equilibrium** | Most code is written by machines; humans own specs, policy and accountability | GitHub is either the trust and provenance layer for all software or a commodity storage layer; training-data and liability rules are settled by regulators and courts |

### 4.2 Scenarios (my estimates)

- **"Agent operating system" (bull, ~25%).** GitHub finishes the migration, fixes reliability by about 2028, and becomes the neutral control layer for agents from *any* vendor: identity, policy, provenance, review triage, compliance. Its network effect plus trust becomes the moat, not hosting.
- **"Indispensable utility" (base, ~50%).** GitHub stays the default host for open source and most companies, with reliability that's good enough. But the most valuable workflow (agent orchestration, review, the developer experience) is owned by agent vendors. Revenue grows while strategic importance slips. Think of a mainframe-era vendor: essential and secure, but not where innovation happens.
- **"SourceForge path" (bear, ~25%).** Repeated outages, a major agent-driven supply-chain incident, and agent-native forges winning the defaults combine to move enterprise workloads elsewhere. Respected open-source projects keep fragmenting. GitHub stays big but declines in importance through the 2030s.

### 4.3 Signposts to watch

1. **Reliability:** do GitHub's monthly availability reports show sustained improvement once the Azure migration is done (2027)?
2. **Defaults:** do Claude Code, Codex and Cursor default to GitHub, or to their own hosting?
3. **Origin's mirroring:** does Cursor Origin stop treating GitHub as the source of truth?
4. **Server-side APIs:** does GitHub ship public, agent-scale source-control APIs, as the Scion designs suggest?
5. **Contribution health:** how many of the top 1,000 projects restrict outside PRs? How many new first-time maintainers are there each year?
6. **Security incidents:** a large compromise originating from an agent workflow would mark a turning point.
7. **Leadership:** does GitHub get its own CEO and product independence again, or merge further into CoreAI?
8. **Universe 2026 (28–29 October 2026):** the keynote will show GitHub's strategic direction for the agent era.

---

## 5. What GitHub would need to get right

These are framed as strategic implications, not recommendations to any particular party.

1. **Reliability is the most important feature.** Nothing else matters if agents and humans can't count on the platform. Publish honest uptime numbers and close the gap between the official and unofficial figures.
2. **Price by activity, not just seats,** while protecting open source, education and individuals.
3. **Make human attention the product.** Invest heavily in review triage, risk scoring, and showing what an agent did and why.
4. **Treat agents as first-class identities:** least privilege, short-lived credentials, signed provenance, and untrusted text kept away from privileged tools by default.
5. **Protect the on-ramp to open source.** Reputation-based contributor flow, verified-human options, and funding or tools for maintainers, so open source doesn't close itself off.
6. **Stay vendor-neutral.** Be the place where *every* agent works well. If GitHub looks like a delivery channel for Copilot, it pushes away the agent ecosystem it needs.
7. **Own compliance and provenance:** SBOMs, attestations, and CRA workflows, turning regulation into a moat.

---

## 6. Confidence notes

- **High confidence:** commit and PR volume growth, the capacity targets, the outage record, maintainer controls shipped in February and June 2026, curl's bounty shutdown, the Gentoo, Zig and Ghostty departures, GitGuardian's figures, the Doe v. GitHub ruling, CRA dates.
- **Medium confidence:** the AWS stopgap (anonymous sources; Microsoft wouldn't name AWS), the scale of the Cline compromise, the specific FakeGit numbers, Copilot credit allowances (sources disagree).
- **Low confidence / single source:** the SpaceX–Cursor *closing* date, the 25M→90M monthly merged-PR figure, Scion's "200x" footprint reduction, uptime percentages from unofficial trackers.
- **Gap:** I couldn't find hard data on how much CI compute agents use, or on what GitHub earns per agent. Both are central to the economics argument and should be investigated directly.

---

## Sources

**Scale, outages, infrastructure**
- [The Register: GitHub outages persist as AI coding drives traffic surge (June 2026)](https://www.theregister.com/software/2026/06/12/github-outages-persist-as-ai-coding-drives-traffic-surge/5255125)
- [Simon Willison: Kyle Daigle on commit volume (April 2026)](https://feeds.simonwillison.net/2026/Apr/4/kyle-daigle/)
- [StartupHub: GitHub's Agent Era, 14x commits](https://www.startuphub.ai/news/github-s-agent-era-14x-commits-copilot-s-future)
- [IncidentHub: GitHub reliability analysis 2025–2026](https://blog.incidenthub.cloud/github-reliability-outage-history-2025-2026)
- [Windows News: GitHub reports 9 outages in May 2026](https://windowsnews.ai/article/github-reports-9-outages-in-may-2026-as-ai-workloads-overload-platform.425739)
- [DevX: GitHub outages in 2026](https://www.devx.com/devx-daily-news/github-outages-2026-ai-coding-agents/)
- [TechRadar: Microsoft turns to AWS for GitHub capacity](https://www.techradar.com/pro/microsoft-forced-to-turn-to-aws-to-boost-github-cloud-capacity-following-ai-demand-surge?rand=100)
- [Tech Insider: Microsoft, AWS and GitHub outages](https://tech-insider.org/microsoft-aws-github-outages-2026/)
- [Techzine: Microsoft moves GitHub to Azure](https://www.techzine.eu/news/devops/135324/microsoft-moves-github-to-azure-servers/)

**Agents, review, quality**
- [GitHub Blog: Agent pull requests are everywhere (May 2026)](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/)
- [.NET Blog: Ten months with Copilot Coding Agent in dotnet/runtime (March 2026)](https://devblogs.microsoft.com/dotnet/ten-months-with-cca-in-dotnet-runtime/)
- [HackerNoon: AI agents are killing the Git client, not Git](https://hackernoon.com/ai-agents-are-killing-the-git-client-not-git-what-anthropics-scion-and-cursors-origin-show)

**Open source, maintainers**
- [The Register: GitHub ponders kill switch for pull requests (February 2026)](https://www.theregister.com/2026/02/03/github_kill_switch_pull_requests_ai/?td=rt-4a)
- [GitHub Changelog: New repository settings for PR access (February 2026)](https://github.blog/changelog/2026-02-13-new-repository-settings-for-configuring-pull-request-access/)
- [GitHub Changelog: Limit open PRs for users without write access (June 2026)](https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/)
- [Visual Studio Magazine: Contribution controls extended to issues](https://visualstudiomagazine.com/articles/2026/06/30/github-extends-contribution-controls-from-prs-to-issues.aspx)
- [The New Stack: Maintainers drowning in AI-generated PRs](https://thenewstack.io/ai-generated-code-crisis/)
- [The New Stack: AI slop puts open source at risk](https://thenewstack.io/ai-slop-open-source/)
- [The Register: curl ends bug bounty (January 2026)](https://www.theregister.com/2026/01/21/curl_ends_bug_bounty/)
- [LWN: curl bug bounty follow-up](https://lwn.net/Articles/1058266)

**Security**
- [Snyk: "Clinejection"](https://snyk.io/blog/cline-supply-chain-attack-prompt-injection-github-actions/)
- [Aikido: PromptPwnd](https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents)
- [CSA: Comment and Control](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-ci-prompt-injection-202608/)
- [Microsoft Security: Securing CI/CD in an agentic world (June 2026)](https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/)
- [Help Net Security: Prompt injection drives agentic AI failures](https://www.helpnetsecurity.com/2026/06/11/owasp-prompt-injection-ai-security-failures/)
- [SC World: AI coding assistants twice as likely to leak secrets](https://www.scworld.com/news/ai-coding-assistants-twice-as-likely-to-leak-secrets-as-overall-leaks-rise-34)
- [GitGuardian via DEV: State of Secrets Sprawl 2026](https://dev.to/gitguardian/the-state-of-secrets-sprawl-2026-ai-service-leaks-surge-81-and-29m-secrets-hit-public-github-2bgj)
- [CSA: Slopsquatting](https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419-csa/)
- [Endor Labs: Slopsquatting](https://www.endorlabs.com/learn/slopsquatting-when-ai-agents-hallucinate-malicious-packages)
- [CSA: FakeGit and AgentBaiting](https://labs.cloudsecurityalliance.org/research/csa-research-note-fakegit-agentbaiting-mcp-supply-chain-2026/)
- [ICSE 2026: Six Million (Suspected) Fake Stars on GitHub](https://conf.researchr.org/details/icse-2026/icse-2026-research-track/14/Six-Million-Suspected-Fake-Stars-on-GitHub-A-Growing-Spiral-of-Popularity-Contests)

**Competition and community exodus**
- [InfoQ: Cursor releases Origin (August 2026)](https://www.infoq.com/news/2026/08/cursor-origin-alternative-github/)
- [eesel: What is Cursor Origin](https://www.eesel.ai/blog/what-is-cursor-origin)
- [Techzine: SpaceX acquires Cursor for $60B](https://www.techzine.eu/news/devops/142197/spacex-acquires-cursor-for-60-billion/)
- [Analytics India Mag: Anthropic ditches Git in its monorepo](https://analyticsindiamag.com/ai-news/anthropic-ditches-git-in-its-monorepo-builds-in-house-version-control-system)
- [The Register: Gentoo dumps GitHub (February 2026)](https://www.theregister.com/2026/02/17/gentoo_dumps_github_for_codeberg_over_copilot_nagware/)
- [heise: Gentoo switches to Codeberg](https://www.heise.de/en/news/Too-much-Copilot-Gentoo-switches-from-GitHub-to-Codeberg-11179401.html)
- [Mitchell Hashimoto: Ghostty is leaving GitHub](https://mitchellh.com/writing/ghostty-leaving-github)
- [Gigazine: Ghostty departure coverage](https://www.gigazine.net/gsc_news/en/20260430-ghostty-leave-github)
- [WinBuzzer: Is GitHub dying?](https://winbuzzer.com/2026/02/19/github-dying-projects-exit-ai-development-xcxwbn/)
- [Lalit Maganti: GitHub has alternatives, but no replacement](https://lalitm.com/post/github-alternatives/)
- [Wikipedia: Codeberg](https://en.wikipedia.org/wiki/Codeberg)

**Business, organization, pricing**
- [Channel Insider: Dohmke steps down, GitHub folded into CoreAI](https://www.channelinsider.com/ai/dohmke-github-msft-coreai/)
- [Visual Studio Magazine: Devs on usage-based Copilot pricing (April 2026)](https://visualstudiomagazine.com/articles/2026/04/27/devs-sound-off-on-usage-based-copilot-pricing-change-you-will-get-less-but-pay-the-same-price.aspx)
- [DevClass: GitHub to charge for self-hosted runners](https://devclass.com/2025/12/17/github-to-charge-for-self-hosted-runners-from-march-2026/)
- [Techzine: GitHub delays self-hosted runner fee](https://www.techzine.eu/news/devops/137396/github-bends-to-criticism-and-delays-paid-self-hosting-of-runners/)
- [Second Talent: GitHub Copilot statistics 2026](https://www.secondtalent.com/resources/github-copilot-statistics/)
- [It's FOSS: Octoverse 2025](https://itsfoss.com/github-octoverse-2025/)

**Legal and regulatory**
- [Ropes & Gray: Ninth Circuit on Copilot DMCA claim (September 2026)](https://www.ropesgray.com/en/insights/alerts/2026/09/ninth-circuit-rules-generative-ai-outputs-are-not-stripped-copies-under-the-dmca)
- [Haynes Boone: Ninth Circuit rejects §1202(b) theory](https://www.haynesboone.com/news/alerts/ai-legal-news-ninth-circuit-rejects-dmca-section-1202(b)-theory)
- [GitHub Blog: What the EU's new software legislation means for developers](https://github.blog/open-source/maintainers/what-the-eus-new-software-legislation-means-for-developers/)
- [OpenSSF: CRA stewards one-pager](https://policy.openssf.org/CRA/stewards-one-pager.html)
- [HeroDevs: CRA reporting starts September 2026](https://www.herodevs.com/blog-posts/cra-reporting-obligations-start-september-2026-what-eol-dependencies-mean-for-your-compliance)

**Scrapers and data**
- [OSNews: FOSS infrastructure under attack by AI companies](https://www.osnews.com/story/141969/foss-infrastructure-is-under-attack-by-ai-companies/)
