# Widget App Server

A real-time backend for managing shared, toggleable widgets between users. Built on Node.js, Express, Socket.io, PostgreSQL, and Redis.

The core mechanic is a **multi-user active set toggle**: any user with access can turn a widget ON, and it stays ON as long as at least one user keeps it active. The widget only turns OFF when every active user has individually turned it off. All state operations are handled atomically through Redis Lua scripts, eliminating race conditions entirely.

---

## Tech Stack

- **Runtime:** Node.js 18, TypeScript
- **HTTP:** Express 4, Helmet, CORS, express-rate-limit
- **Real-time:** Socket.io 4 (JWT-authenticated WebSockets)
- **Database:** PostgreSQL 14 via Prisma ORM
- **Cache/State:** Redis 7 (Lua scripts for atomic operations, SETs for active user tracking)
- **Auth:** bcrypt + JWT
- **Observability:** Prometheus (`prom-client`), Sentry
- **Testing:** Jest, Supertest, socket.io-client
- **Infra:** Docker Compose, GitHub Actions CI/CD

---

## Getting Started

### Prerequisites

- Docker and Docker Compose installed on your machine.
- Git.

### 1. Clone and configure

```bash
git clone <repository-url>
cd widget_app_server
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET`. The defaults work for local development.

### 2. Start the stack

```bash
docker compose up -d --build
```

This brings up three containers: the Node.js application on port `3000`, PostgreSQL on `5432`, and Redis on `6379`. On first boot, Prisma automatically pushes the schema to the database.

### 3. Verify

```bash
curl http://localhost:3000
# Widget App Server API
```

---

## Database Schema

PostgreSQL holds three tables managed by Prisma:

- **`User`** -- id (UUID), email (unique), password_hash, name, timestamps.
- **`Widget`** -- id (UUID), owner_id (FK to User), name, emoji, shared_user_ids (UUID[]), timestamps.
- **`WidgetStateLog`** -- id (UUID), widget_id (FK), new_state, changed_by (FK), changed_at. Audit trail for every state transition.

---

## API Reference

All endpoints except auth require a `Authorization: Bearer <token>` header.

### Authentication

| Method | Path             | Description                         |
| ------ | ---------------- | ----------------------------------- |
| POST   | `/auth/register` | Register a new user. Returns a JWT. |
| POST   | `/auth/login`    | Authenticate. Returns a JWT.        |

### Widget CRUD

| Method | Path                     | Description                                                |
| ------ | ------------------------ | ---------------------------------------------------------- |
| GET    | `/api/widgets`           | List all widgets the user owns or is shared on.            |
| POST   | `/api/widgets`           | Create a new widget. Body: `{ name, emoji }`.              |
| PUT    | `/api/widgets/:id`       | Update name/emoji. Owner only.                             |
| DELETE | `/api/widgets/:id`       | Delete a widget and clean up Redis state. Owner only.      |
| PUT    | `/api/widgets/:id/share` | Add/remove shared users. Body: `{ action, targetUserId }`. |
| GET    | `/api/widgets/:id/state` | REST fallback to read current state from Redis.            |

### Observability

| Method | Path       | Description                  |
| ------ | ---------- | ---------------------------- |
| GET    | `/metrics` | Prometheus metrics endpoint. |

---

## WebSocket Events

Clients connect to the Socket.io server at `ws://localhost:3000` with `{ auth: { token } }`.

### Client to Server

| Event               | Payload                                    | Description                                              |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `subscribe_widgets` | `string[]` (array of widget IDs)           | Join rooms for the given widgets. Returns initial state. |
| `toggle_widget`     | `{ widgetId, targetState: 'ON' \| 'OFF' }` | Toggle a widget. Enforces active-set rules atomically.   |

### Server to Client

| Event           | Payload                                                            | Description                                      |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| `state_changed` | `{ widgetId, state, lastModifiedBy, lastModifiedAt, activeUsers }` | Broadcast to all subscribers when state changes. |
| `toggle_error`  | `{ widgetId, message }`                                            | Sent only to the requesting client on failure.   |

### Toggle Result Codes

| Code             | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `SUCCESS`        | State changed. ON if user activated; OFF if last user deactivated. |
| `STILL_ON`       | User deactivated, but other users keep the widget ON.              |
| `ALREADY_ACTIVE` | User is already in the active set.                                 |
| `NOT_ACTIVE`     | User tried to turn OFF without having turned ON.                   |

---

## How the Active Set Toggle Works

Traditional toggles use a single owner. This system uses a **Redis SET** to track every user who has turned the widget ON:

1. **User A turns ON** -- `SADD` user A to the set. State becomes `ON`. Result: `SUCCESS`.
2. **User B turns ON** -- `SADD` user B to the set. State remains `ON`. Result: `SUCCESS`.
3. **User A turns OFF** -- `SREM` user A. Set still has user B. State remains `ON`. Result: `STILL_ON`.
4. **User B turns OFF** -- `SREM` user B. Set is now empty. State becomes `OFF`. Result: `SUCCESS`.

The entire read-check-write cycle runs inside a single Lua script, guaranteeing atomicity even under heavy concurrent load. This has been verified with 100 simultaneous toggle tests.

---

## Rate Limiting

- **REST API:** 100 requests per 15-minute window per IP via `express-rate-limit`.
- **WebSockets:** 10 toggles per second per user, enforced via Redis counters. Excess requests are silently dropped.

---

## Testing

Tests run against a live PostgreSQL and Redis instance inside Docker.

```bash
docker exec widget_app_node npm test
```

The suite includes 43 tests across 5 files:

- **auth.test.ts** -- Registration, login, JWT validation.
- **widget.test.ts** -- Full REST CRUD, ownership enforcement, sharing.
- **redisService.test.ts** -- Lua script unit tests for every toggle scenario.
- **socket.test.ts** -- End-to-end WebSocket flow with two authenticated clients.
- **load.test.ts** -- Concurrency: 100 simultaneous toggles verifying atomicity.

---

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step instructions on deploying to a home server or any Docker-capable host.

A multi-stage `Dockerfile` is included that produces a slim production image containing only compiled JS and production dependencies. A `docker-compose.prod.yml` is provided for one-command deployments.

---

## CI/CD

GitHub Actions runs on every push and PR to `main`:

1. Spins up ephemeral Postgres and Redis service containers.
2. Installs dependencies, generates Prisma client, pushes schema.
3. Runs the full test suite.
4. Builds TypeScript and the Docker image.

See `.github/workflows/ci.yml`.

---

## License

This project is licensed under the **GNU General Public License v2.0**.
