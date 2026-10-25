# Priminfo Pro

Compare Swiss basic health insurance (KVG / LAMal) premiums for 2027 and find the franchise (deductible) that is cheapest for *your* expected medical bills.

**Live:** https://swiss-insurance-compare.vercel.app

Priminfo Pro is an independent hobby project and is not affiliated with the Swiss Federal Office of Public Health (FOPH / BAG). All premiums are fetched live from the official calculator [priminfo.admin.ch](https://www.priminfo.admin.ch) and shown unaltered; the FOPH also publishes the same figures as open data on [opendata.swiss](https://opendata.swiss). Results are for guidance only and are not insurance advice.

## What it does

- Ranks every plan available at your postcode by net monthly premium or by total annual cost (premium + franchise + 10 % co-pay).
- Draws, per plan, the break-even curve between franchise levels for a given amount of medical bills.
- Shows the full premium matrix across all franchise levels and the 5-year premium history per insurer.
- Saves profiles for family members and totals them per insurer.
- English, German and Chinese UI. Shareable URLs. No accounts, no tracking; profiles stay in your browser.

## Running it

No dependencies: the backend is Python standard library only, the frontend is plain ES modules with no build step.

```sh
python3 server.py                  # http://127.0.0.1:8765
python3 -m unittest                # backend tests, offline, against the snapshots in tests/fixtures/
node --test 'tests/js/*.test.mjs'  # frontend unit tests (Node >= 22)
```

Browser tests live in `tests/e2e/` and need `playwright-core`; [AGENTS.md](AGENTS.md) explains how to run them. Production runs on Vercel: `vercel.json` routes `/api/*` to `api/index.py` and everything else to `static/`.

## How this repo is built: with coding agents

Every commit in this repository so far was written by an AI coding agent (Claude Code, across many sessions, sometimes several in parallel). The working notes are published on purpose, so you can see how that goes in practice:

- [`AGENTS.md`](AGENTS.md) is the brief every agent reads first: how to run things, the project's conventions, and the rule that each session must leave a record.
- [`.agents/docs/`](.agents/docs/) holds those records, one per session (`yymmdd-session-*.md`): the goal, what was done with commit hashes, the key decisions and why (marked "用户选" when the human decided), and what is left open. [`261025-architecture-review.md`](.agents/docs/261025-architecture-review.md) is the P0/P1/P2 review that set the order of work.
- Commits made by an agent end with `#vibe #claude`.

The notes are in Chinese, the language the maintainer uses with the agents.

## License

[MIT](LICENSE). The self-hosted fonts Fraunces and IBM Plex Sans are distributed under the SIL Open Font License; see `static/fonts/`.
