# MATEO-FMB

MATEO-FMB is an original modular Facebook Messenger bot framework designed around one principle: **features should never compromise runtime stability**.

## Architecture

```text
                         MATEO-FMB
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
       RUNTIME            FEATURES           CONTROL
          │                  │                  │
    Performance          Commands           Dashboard*
    Resource             Media              Metrics*
    Governor             AI                 Config
    Safety               Economy             Logs
    Recovery             Groups              Health
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                       Stable Runtime
```

\* The control-plane API is intentionally separated from bot feature code so a future dashboard can consume the same runtime state without becoming part of the command engine.

## Runtime

The runtime layer provides:

- centralized configuration and state;
- connection lifecycle and bounded reconnect handling;
- event dispatching through a centralized event bus;
- command registration, permissions and cooldowns;
- host-aware CPU and memory pressure monitoring;
- **bounded command concurrency and bounded command queues** enforced on the live message path;
- bounded network concurrency and optional byte-budget waiting for runtime-managed network work;
- inbound/outbound network accounting;
- cache and queue pressure controls;
- event-loop and filesystem pressure monitoring;
- safety detection for connection/authentication failures;
- structured safety error codes with message-text classification only as a compatibility fallback;
- recovery telemetry and graceful shutdown;
- health/status reporting;
- configurable 2–3 second per-thread outgoing message pacing by default.

Performance profiles are available through `/performance low`, `medium`, `normal`, `high`, and `max`. The governor deliberately does not assume that all RAM, CPU or disk reported by a desktop/server belongs to the bot.

## Features

Commands are independently loaded from `src/cmds/` and events from `src/events/`. The command context exposes stable services such as database, groups, users, moderation, AI, formatting, safety, performance and recovery.

Feature modules should remain replaceable and should use the runtime services instead of creating their own competing schedulers, resource pools or configuration systems.

## Data and persistence

The default persistence layer is a small JSON database intended for a single bot process and modest workloads. It is deliberately simple for v1 and can be replaced behind the database service boundary later; the project does **not** claim horizontal database scalability in this release.

Runtime database/state files are local deployment artifacts and must not be committed. AppState and `.env` are also local secrets/configuration and must never be committed.

## FCA compatibility

MATEO-FMB pins `ws3-fca` to **3.5.2** instead of using a floating version. This is intentional: Messenger/FCA-compatible forks can change callback behavior and event semantics between releases. Pinning makes deployments reproducible and keeps the adapter contract stable for v1. Upgrade the pinned version only after validating connection, event, messaging and shutdown behavior.

## Control plane

The application exposes structured status through the health server. Runtime status includes connection state, command/user/group counts, safety state, recovery state and performance telemetry. This provides the foundation for a dashboard and operational tooling without coupling a web UI to the bot's internals.

## Configuration

`settings.json` contains non-secret defaults. Environment variables can override deployment-sensitive values. Runtime configuration can be persisted through `ConfigManager` when an operational setting is intentionally changed.

Never commit AppState, `.env`, logs, database files containing private runtime data, or generated state.

## Setup

1. Install dependencies with `npm install`.
2. Provide Facebook AppState locally through `appstate.json` or `MATEO_APPSTATE_FILE`.
3. Configure `settings.json` and environment variables.
4. Start with `npm start`.
5. Run `npm test` before deploying changes.

## Design goals

MATEO-FMB is not built around a single giant command file. The target is a resilient runtime with modular feature and control layers, so additional commands, media providers, AI integrations, economy systems and group features can be added without destabilizing the process.


## 2027–2029 foundation

MATEO-FMB now isolates the Messenger transport behind a platform adapter. The current adapter is @eryxenx/fca 1.1.9, using its NEXCA MQTT transport and sessionGuard while MATEO keeps reconnect ownership in ConnectionManager.

Persistence now defaults to SQLite through Node's built-in node:sqlite, with automatic migration from the legacy db.json format. JSON remains available as a compatibility mode.

Persistent scheduling is available through /remind, /jobs and /canceljob. Local database snapshots can be created with /backup or npm run backup; /restore stages a restore for the next startup.

Plugins are manifest-based and may provide command and event directories under plugins/. AI now supports ordered provider fallback plus bounded per-thread memory.

Runtime status includes platform capabilities, database health, scheduler state, plugin state, recovery information and performance telemetry.

Maintenance baseline:

    npm ci
    npm test
    npm run doctor

Node.js 22+ is required. CI validates Node 22 and Node 24.

Never commit AppState, .env, runtime databases, scheduler state, AI memory or backups containing private runtime data.