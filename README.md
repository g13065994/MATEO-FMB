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

## Mateo control plane integration

MATEO-FMB is a native client of the Mateo control plane hosted by the companion g13065994/mateobots project. The bot never talks directly to Supabase or Vercel internals; it only uses the versioned FMB API contract.

### Connect an installation

1. Sign in to the Mateo web dashboard.
2. Create/register an FMB installation and copy the one-time Bot Key.
3. Put the Bot Key in MATEO_BOT_KEY on the bot host.
4. Set MATEO_API_BASE_URL to the deployed Mateo API. The default is https://api.mateobot.vercel.app.
5. For automatic verified updates, pin MATEO_SIGNING_PUBLIC_KEY to Mateo's Ed25519 public key.
6. Start MATEO-FMB.

At startup the client performs the Mateo challenge/session exchange, keeps the short-lived session token in memory, sends sanitized heartbeats, and checks the configured release channel for updates. Bot Keys are never logged, sent in URLs, or persisted by the client.

### Signed update lifecycle

Git tags are tested by GitHub Actions, packaged as an immutable tarball, hashed with SHA-256, signed with Ed25519 and uploaded to the private Mateo release bucket. Mateo filters releases by Node/OS/architecture/adapter/database compatibility and deterministic rollout percentage, then returns a five-minute signed download URL.

FMB verifies the pinned signing key, manifest hash, signature and artifact hash before staging. A pre-update database backup is created, a code backup is retained, the bot shuts down gracefully, the helper activates the new files, starts the new process and keeps the previous code available for rollback if activation fails.

Mateo API failures are fail-open for runtime continuity. The configured 168-hour offline grace is recorded as policy context and does not act as a remote kill switch.

### Mateo environment

```text
MATEO_API_BASE_URL=https://api.mateobot.vercel.app
MATEO_API_VERSION=v1
MATEO_BOT_KEY=
MATEO_INSTALLATION_ID=
MATEO_UPDATE_CHANNEL=stable
MATEO_HEARTBEAT_INTERVAL_MS=300000
MATEO_UPDATE_CHECK_INTERVAL_MS=21600000
MATEO_AUTO_UPDATE=true
MATEO_OFFLINE_GRACE_HOURS=168
MATEO_SIGNING_PUBLIC_KEY=
```

The real Bot Key and signing private key belong in deployment/GitHub secret storage only. Never commit them to Git.
