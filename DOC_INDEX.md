<!-- This file is the compressed routing layer for repository documentation. -->
<!-- Read this first. Load only what you need for your task. -->
<!-- Full engineering map: /CLAUDE.md -->

# DOC_INDEX.md

## Repository Identity

**Project:** Strum
**Purpose:** Autonomous Raspberry Pi energy controller — polls a Solarman V5 inverter (Modbus TCP), controls Tuya smart plugs locally/cloud, runs scene automations, sends notifications, and serves a PWA.
**Stack:** Node.js 22, ES modules, zero npm dependencies (stdlib only), PWA frontend (vanilla JS)
**Architecture:** Modular monolith (single process, `index.js` + `lib/`)
**AI present:** no

---

## Read This First

For full architecture context and detailed loading guide:
→ `/CLAUDE.md`

---

## Documentation Domains

### Architecture
Authoritative files for system structure, flows, and data:

| File | Use for |
|------|--------|
| `/docs/architecture/SYSTEM_OVERVIEW.md` | Component map, architecture style, external deps, security model |
| `/docs/architecture/REPOSITORY_MAP.md` | Module ownership, file layout, change-risk checklist |
| `/docs/architecture/RUNTIME_FLOWS.md` | End-to-end execution traces, cadence, sequence diagrams |
| `/docs/architecture/DEPENDENCY_MAP.md` | Internal + external dependency graph, failure cascades |
| `/docs/architecture/DATA_CONTRACTS.md` | Schemas: config, devices, scenes, inverter, RRD, push, auth |

### General / Ops
| File | Use for |
|------|--------|
| `/README.md` | Setup, deployment, ops for the Pi |
| `/CHANGELOG.md` | Version history (newest at top, v0.7.6) |
| `/AGENTS.md` | Engineering conventions: Tuya protocol, web push, commands |

---

## Task Routing

Load in the order listed. Stop when you have enough context.

**Understanding the system for the first time:**
1. `/DOC_INDEX.md` ← you are here
2. `/CLAUDE.md`
3. `/docs/architecture/SYSTEM_OVERVIEW.md`

**Tracing a request or runtime behavior:**
1. `/CLAUDE.md` (Section: Core Runtime Flows)
2. `/docs/architecture/RUNTIME_FLOWS.md`
3. `/docs/architecture/DEPENDENCY_MAP.md` ← if the flow touches external services

**Working on Tuya local or Web Push:**
1. `/CLAUDE.md` (Section: High-Risk Areas)
2. `/AGENTS.md` (Tuya Local / Web Push sections)
3. `/docs/architecture/RUNTIME_FLOWS.md` ← affected flows
4. `/docs/architecture/DATA_CONTRACTS.md` ← device/push schemas

**Changing a data contract or schema:**
1. `/CLAUDE.md` (Section: High-Risk Areas)
2. `/docs/architecture/DATA_CONTRACTS.md`
3. `/docs/architecture/DEPENDENCY_MAP.md`

**Debugging a production failure:**
1. `/AGENTS.md` (commands, deploy) + `/CHANGELOG.md` (recent changes)
2. `/docs/architecture/RUNTIME_FLOWS.md` ← lifecycle / connection flows

**Modifying authentication or authorization:**
1. `/CLAUDE.md` (Section: High-Risk Areas)
2. `/docs/architecture/DATA_CONTRACTS.md#9-auth--csrf-rules`

**Changing an external integration:**
1. `/docs/architecture/DEPENDENCY_MAP.md`
2. `/docs/architecture/RUNTIME_FLOWS.md` ← for affected flows

**Local development or contribution:**
1. `/README.md`
2. `/AGENTS.md` (commands, tests)
3. `/docs/architecture/REPOSITORY_MAP.md` ← for the module you're working in

---

## High-Risk Areas

Load the listed docs before making changes to these zones.

| Zone | Why High Risk | Load Before Changing |
|------|-------------|---------------------|
| `lib/tuya-local.js` | Live hardware control, persistent sockets; owner verifies on-device after deploy | AGENTS.md (Tuya) + RUNTIME_FLOWS + SYSTEM_OVERVIEW |
| `lib/app-state.js` scene engine | Automations switch real loads; malformed scenes act on hardware | DATA_CONTRACTS (scenes) + DEPENDENCY_MAP |
| Auth/CSRF middleware | Shared across every `/api` mutation | DATA_CONTRACTS §9 |
| `lib/webpush.js` | RFC 8291 must be byte-exact; Apple rejects bad VAPID `sub` | AGENTS.md (Web Push) |
| Inverter register map | Wrong register = wrong live data fed to scenes | DATA_CONTRACTS §4 |

---

## Do Not Load Unless Directly Relevant

Avoid pulling these into context unless your task specifically requires them:

- `DESIGN_AUDIT.md`, `TOKEN_PROPOSAL.md`, `PALETTE_PROPOSAL.md` — historical design proposals, not active docs
- `scripts/` diagnostic tools — only when debugging Tuya discovery/testing
- `public/lib/` vendored assets (Chart.js, bootstrap-icons, fonts) — static, not source

---

## Documentation Rules (for AI assistants)

- DOC_INDEX.md is the compressed routing layer — do not add detail here
- CLAUDE.md is the engineering map — load it when you need architectural context
- Sub-documents are authoritative — load only the ones relevant to your task
- One canonical home per topic — never duplicate detail across files
- Load the minimum required documents for the task at hand
