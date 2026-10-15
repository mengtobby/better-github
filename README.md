# better-github (working name)

An agent-native, Git-compatible code forge for a world where most code is written by agents and supervised by people.

- **Why:** [docs/research/github-agent-era-report.md](docs/research/github-agent-era-report.md)
- **What:** [docs/PRD.md](docs/PRD.md)
- **How:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [decision records](docs/adr/)
- **Roadmap and status:** [docs/TASKS.md](docs/TASKS.md)

## Requirements

- Node ≥ 20.12
- git ≥ 2.38 on `PATH`

## Develop

```sh
npm install
npm run typecheck
npm run lint
npm run test:coverage
npm run dev        # starts the server (available after Phase 1)
```
