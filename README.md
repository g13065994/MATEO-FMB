# MATEO-FMB

MATEO-FMB is an original modular Facebook Messenger bot framework designed around one principle: features should never compromise runtime stability.

## Architecture

```text
                         MATEO-FMB
                             │
          ┌──────────────────┼────────────────────┐
          │                  │                    │
       RUNTIME            SERVICES             CONTROL
          │                  │                    │
   Recovery/queues       SQLite storage       Health
   Safety/backoff        JSON migration       Metrics
   Performance           Scheduler             Dashboard
   Stale-event guard     Backups               Diagnostics
   Graceful shutdown     AI memory             Plugins
          │                  │                    │
          └──────────────────┼────────────────────┘
                             │
                      Platform Adapter
                             │
                       NEXCA-based FCA
```

The platform implementation is isolated behind src/platform/MessengerAdapter.js. MATEO does not depend on FCA internals outside that boundary, so a future transport replacement can remain a contained adapter change.

## Platform adapter

MATEO-FMB uses the pinned @eryxenx/fca 1.1.9 adapter. The package currently documents NEXCA MQTT transport, automatic reconnect, stale-client protection, sessionGuard AppState protection, HTTP delivery fallback, optional Signal Protocol E2EE, and classic FCA-compatible API signatures.

MATEO deliberately disables the adapter's internal auto-reconnect so ConnectionManager remains the single owner of reconnect policy. This prevents competing retry loops.

AppState session protection is enabled by default through sessionGuard.

## Persistence

New deployments use SQLite through Node's built-in node:sqlite module. The storage layer preserves the existing db.data contract so command and manager code stays independent from the storage engine.

Legacy db.json data is automatically imported into SQLite on first startup when the configured SQLite database is empty. JSON remains available by setting storage.mode to json.

## Scheduler and recovery

Persistent reminders survive restarts:

    /remind 30m drink water
    /jobs
    /canceljob <job-id>

Completed scheduler jobs are retained only for a bounded period.

Local database snapshots are available through /backup, /backups and /restore. Restore is staged for the next startup instead of replacing a live database under active handlers.

## Plugins

External plugins live under plugins/<name>/ and declare command/event directories through manifest.json. Plugin discovery is isolated from the core loader, and plugins can be disabled by configuration.

## AI

The AI layer supports ordered provider fallback, GET or POST HTTP providers, environment-backed headers, bounded network execution, and persistent bounded per-thread conversational memory.

## Runtime resilience

The runtime includes bounded command/network concurrency, exponential reconnect backoff, stale connection-generation protection, safety classification, CPU/memory/event-loop/filesystem pressure monitoring, database health checks, graceful shutdown, and per-thread outgoing message pacing.

## Maintenance

    npm ci
    npm test
    npm run doctor
    npm run backup

Node.js 22+ is required. CI validates Node 22 and Node 24.

## Security

Never commit AppState, .env, runtime databases, scheduler state, AI memory, or private backups. The safety layer pauses automatic retries when authentication/checkpoint/restriction-like failures are detected; it does not attempt to bypass platform enforcement.

## Goal

The core is designed to remain stable for years while the platform adapter, plugins, storage adapter and AI providers can evolve independently.