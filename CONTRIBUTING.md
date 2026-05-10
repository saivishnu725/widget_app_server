# Contributing

This document covers the conventions, workflow, and architecture decisions you need to understand before contributing to the Widget App Server.

---

## Development Setup

You need Docker and Docker Compose. Nothing else runs on the host machine.

```bash
git clone <repository-url>
cd widget_app_server
cp .env.example .env
docker compose up -d --build
```

The dev server runs with `ts-node-dev` and hot-reloads on file changes. The source is bind-mounted into the container, so you edit files locally and the container picks them up immediately.

Verify the stack is healthy:

```bash
docker ps                              # 3 containers: app, postgres, redis
docker exec widget_app_node npm test   # 43 tests, all passing
```

---

## Branch Strategy

- `main` is the stable, deployable branch. Never push directly.
- Create feature branches from `main` with a descriptive name: `feat/widget-history`, `fix/rate-limit-bypass`, `refactor/lua-script`.
- Open a pull request. CI must pass before merging.

---

## Code Conventions

### TypeScript

- Strict mode is enabled. Do not use `any` unless absolutely necessary and document why.
- Use `async/await` everywhere. No raw `.then()` chains.
- Controller functions return `Promise<void>` and send responses via `res.json()` or `res.status().json()`. Never return the response object.
- Use explicit type annotations on function signatures. Rely on inference for local variables.

### Naming

- Files: `camelCase.ts` for source, `camelCase.test.ts` for tests.
- Database columns: `snake_case`, matching the Prisma schema.
- Redis keys: `widget:{id}:state`, `widget:{id}:activeUsers`, `widget:{id}:lastModifiedBy`, `widget:{id}:lastModifiedAt`.
- Socket events: `snake_case` (`toggle_widget`, `state_changed`, `toggle_error`).

### Error Handling

- Controllers catch errors at the top level and return a generic `500` with `{ error: 'Internal server error' }`. Never leak stack traces.
- Socket handlers catch errors inside the event callback and emit `toggle_error` to the requesting client only.
- Async audit log writes (state log inserts) use `.catch()` to prevent unhandled rejections from crashing the process.

---

## Architecture

### Request Flow

REST requests pass through: `express-rate-limit` -> `helmet` -> `cors` -> `express.json()` -> route -> `authenticate` middleware -> controller -> Prisma/Redis -> response.

WebSocket connections pass through: Socket.io `use()` middleware (JWT verification) -> `connection` handler -> per-event handlers (`subscribe_widgets`, `toggle_widget`).

### State Management

Widget state lives in Redis, not PostgreSQL. PostgreSQL stores the durable schema (users, widgets, audit logs). Redis stores the ephemeral but latency-critical state:

- `widget:{id}:state` -- `ON` or `OFF`.
- `widget:{id}:activeUsers` -- Redis SET of user IDs currently keeping the widget ON.
- `widget:{id}:lastModifiedBy` -- UUID of the last user who changed state.
- `widget:{id}:lastModifiedAt` -- ISO timestamp of the last change.

A sync service (`syncService.ts`) runs on a 5-minute interval and reconciles Redis state into the PostgreSQL `WidgetStateLog` table for durability.

### The Lua Script

All toggle operations go through a single Lua script evaluated atomically by Redis. This is the core invariant of the system and the most sensitive piece of code. If you need to modify it:

1. Understand that Lua scripts in Redis are single-threaded and block all other operations for their duration. Keep them fast.
2. The script uses `SISMEMBER`, `SADD`, `SREM`, and `SCARD` on the active users SET. The widget is ON if the set is non-empty and OFF if it is empty.
3. Every change to the Lua script must be accompanied by updated tests in `redisService.test.ts` and `load.test.ts`.

---

## Testing

All tests are integration tests that run against real PostgreSQL and Redis instances inside Docker. There are no mocks for data stores.

### Running Tests

```bash
docker exec widget_app_node npm test                          # full suite
docker exec widget_app_node npm test src/tests/socket.test.ts # single file
```

### Writing Tests

- Each test file manages its own setup and teardown. Register test users in `beforeAll`, clean them up in `afterAll`.
- Always call `await prisma.$disconnect()` and `await redisClient.quit()` in `afterAll` to prevent Jest from hanging.
- Socket tests are sequential (each test depends on state from the previous one). If you add a new socket test, place it in the correct position in the flow.
- When testing broadcasts, be aware that events from a previous test may still be queued. Drain stale events with a short timeout before asserting on the next one.

### Test Coverage

| File                   | Scope                                                    |
| ---------------------- | -------------------------------------------------------- |
| `auth.test.ts`         | Registration, login, duplicate emails, missing fields.   |
| `widget.test.ts`       | CRUD, ownership, sharing, REST state fallback.           |
| `redisService.test.ts` | Lua script: multi-user ON, STILL_ON, NOT_ACTIVE, etc.    |
| `socket.test.ts`       | Full WebSocket lifecycle with two authenticated clients. |
| `load.test.ts`         | 100 concurrent toggles verifying Lua atomicity.          |

---

## Adding a New Feature

### New REST Endpoint

1. Add the controller function in the appropriate file under `src/controllers/`.
2. Add the route in `src/routes/`. Apply `authenticate` middleware if the route requires auth.
3. Register the router in `src/app.ts` if it is a new route group.
4. Write integration tests using Supertest in `src/tests/`.
5. Run the full suite and confirm nothing regresses.

### New Socket Event

1. Add the handler inside the `io.on('connection')` block in `src/sockets/socketManager.ts`.
2. If the event modifies state, use atomic Redis operations or extend the Lua script.
3. Add tests in `socket.test.ts` that connect real `socket.io-client` instances.

### Schema Changes

1. Modify `prisma/schema.prisma`.
2. Run `docker exec widget_app_node npx prisma db push` to apply locally.
3. Update any affected controllers, services, and tests.
4. The dev container auto-runs `prisma generate` and `prisma db push` on startup, so other contributors will pick up your changes automatically.

---

## Commit Messages

Use conventional commits:

```
feat: add widget history endpoint
fix: prevent duplicate active set entries on reconnect
refactor: extract toggle validation into middleware
test: add concurrency test for 200 simultaneous users
docs: update API reference with new share endpoint
```

Keep the subject line under 72 characters. Use the body for context if the change is non-obvious.

---

## Pull Request Checklist

Before requesting review:

- [ ] All 43+ tests pass (`docker exec widget_app_node npm test`).
- [ ] TypeScript compiles cleanly (`docker exec widget_app_node npm run build`).
- [ ] New endpoints or events have corresponding tests.
- [ ] No `console.log` left in production code paths (use the structured logger).
- [ ] Redis key names follow the `widget:{id}:*` convention.
- [ ] Commit history is clean and messages follow the convention above.
