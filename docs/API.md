# API reference

The REST base URL is `/api`. JSON endpoints return JSON unless the route is explicitly an export. Protected routes use a bearer token:

```http
Authorization: Bearer <JWT>
Content-Type: application/json
```

An error response has a non-2xx status and a JSON `message`. Validation/conflict responses commonly use 400 or 409, authentication uses 401, authorization uses 403, and missing records use 404.

## Health and authentication

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Service health and server time |
| POST | `/auth/login` | Public | Exchange email/password for a JWT and user object |
| GET | `/auth/me` | Signed in | Read the current user |
| POST | `/auth/users` | Admin | Create a user and assign a role/team |

Login example:

```json
{
  "email": "admin@icl.test",
  "password": "ChangeMe123!"
}
```

Roles are `admin`, `auctioneer`, `manager`, and `viewer`. Managers are bound to their assigned team for bidding and receipt access.

## Public league data

| Method | Path | Notes |
|---|---|---|
| GET | `/public/home` | Live matches, fixtures, points, cap leaders, and sync freshness |
| GET | `/teams` | All teams |
| GET | `/teams/:id` | Team and squad |
| GET | `/players` | Supports `q`, `role`, `category`, `state`, and `team` filters |
| GET | `/players/:id` | Player detail |
| GET | `/matches` | Optional `status=upcoming|live|completed` |
| GET | `/matches/:id` | Scorecard plus ordered ball records |
| GET | `/gallery` | Newest gallery items first |
| GET | `/tournament` | Latest tournament rules and format |

## Auction

Read routes are public so the league site and projector can stay synchronized.

| Method | Path | Access | Body/purpose |
|---|---|---|---|
| GET | `/auction/current` | Public | Latest auction state, bids, teams, and server time |
| GET | `/auction/:id` | Public | One auction state |
| GET | `/auction/:id/history` | Public | Ordered audit events |
| GET | `/auction/:id/analytics` | Public | Spend/player aggregates |
| POST | `/auction/:id/bid` | Admin/Auctioneer/Manager | `{ "teamId": "...", "amount": 10500 }` |
| POST | `/auction/:id/actions/start` | Admin/Auctioneer | `{ "playerId": "...", "timerSeconds": 30 }` |
| POST | `/auction/:id/actions/sold` | Admin/Auctioneer | Finalize the leader |
| POST | `/auction/:id/actions/unsold` | Admin/Auctioneer | Close without a buyer |
| POST | `/auction/:id/actions/skip` | Admin/Auctioneer | Skip current player |
| POST | `/auction/:id/actions/pause` | Admin/Auctioneer | Freeze countdown |
| POST | `/auction/:id/actions/resume` | Admin/Auctioneer | Resume countdown |
| POST | `/auction/:id/actions/undo` | Admin/Auctioneer | Undo latest accepted bid |
| POST | `/auction/:id/actions/reauction` | Admin/Auctioneer | `{ "playerId": "...", "timerSeconds": 30 }` |
| GET | `/auction/:id/export.csv` | Admin/Auctioneer | Download auction report |
| GET | `/auction/:id/export.pdf` | Admin/Auctioneer | Download post-auction PDF report |
| GET | `/auction/:id/receipt/:teamId.pdf` | Admin/Auctioneer/own Manager | Download team receipt |

The client should render a 409 response as a stale/invalid bid and immediately refresh auction state. It must not assume a displayed bid was accepted until the server responds successfully.

## Chatbot

`POST /chatbot` is limited to 20 requests per minute per client address. Send either `message` or `question`, up to 500 characters:

```json
{ "message": "Aaj ka next match kaunsa hai?" }
```

```json
{ "answer": "Next match: ...", "mode": "ai" }
```

`mode` is `basic` when the local database-backed regex fallback answered. The frontend uses it to display the Basic mode badge. Identical normalized questions are cached briefly on the API process.

## Administration and scorer

Every `/admin/*` route requires an authenticated user whose current database role is `admin`. The API re-checks the user on each request; hiding the admin link in the client is not the security boundary.

Teams, players, matches, tournaments, and gallery items support paginated administration. List responses use:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pages": 1
}
```

The common resource routes are:

```text
GET    /admin/:collection
GET    /admin/:collection/:id
POST   /admin/:collection
PATCH  /admin/:collection/:id
DELETE /admin/:collection/:id
```

`collection` is one of `teams`, `players`, `matches`, `gallery`, or `tournaments`. Deletes return `{ "deleted": true, "id": "..." }` and are rejected with 409 when they would break protected league or auction references.

Additional CMS operations:

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/admin/overview` | Admin | CMS counts and readiness data |
| POST | `/admin/players/import-csv` | Admin | Validate and import up to 500 players |
| GET/POST | `/admin/users` | Admin | List or create role-controlled users |
| GET/PATCH/DELETE | `/admin/users/:id` | Admin | Read, edit, or delete a user with last-admin protections |
| GET/POST | `/admin/auctions` | Admin | List or create draft auctions |
| GET | `/admin/auctions/:id` | Admin | Read populated auction setup/state |
| PATCH | `/admin/auctions/:id/config` | Admin | Update paused/draft timer, increment, name, and round |
| PUT | `/admin/auctions/:id/queue` | Admin | Replace queue with `{ "playerIds": [] }` |
| POST/DELETE | `/admin/auctions/:id/queue/:playerId` | Admin | Add/remove one queued player |
| POST | `/admin/auctions/:id/actions/next` | Admin | Start and remove the first queued player |
| GET | `/admin/cricheroes` | Admin | Read toggle and cached sync health |
| PATCH | `/admin/cricheroes` | Admin | `{ "enabled": true }` toggles scheduled sync |
| POST | `/admin/cricheroes/sync` | Admin | Force a controlled sync immediately |
| POST | `/scorer/matches/:id/balls` | Admin/Auctioneer | Store a delivery and increment innings score |

Player CSV accepts `text/csv` directly or JSON `{ "csv": "..." }`. Required headings are `name`, `role`, and `basePrice`; optional headings include category, rating, photo, styles, statistics, and CricHeroes identifiers. Quoted commas, escaped quotes, CRLF/LF, and quoted multiline fields are supported. Existing names are skipped case-insensitively and the response reports `imported` and `skipped` counts.

The compatibility aliases `/admin/settings/cricheroes` and `/admin/sync/cricheroes` remain available. Manual override fields are stored separately from cached source data. Each Team, Player, Match, and Tournament can store `cricheroesId`, `cricheroesUrl`, source metadata, and `lastSyncedAt`. Media uses validated HTTP(S) URLs rather than local upload storage so Render/Vercel deployments remain stateless. CricHeroes fetching accepts only exact `cricheroes.com` hosts and does not follow redirects.

## Socket.io events

Connect to the API origin. Authentication is optional for public viewing; signed-in clients send `{ auth: { token } }`. Emit `auction:join` with an auction id to join its room.

Server events include:

- `auction:state`: authoritative populated auction snapshot
- `timer:tick`: remaining seconds, phase, and server time
- `bid:new`: accepted bid
- `player:sold`, `player:unsold`, `player:skipped`: player outcome
- `notification`: user-facing bid or sale notification

After reconnecting, fetch `/auction/:id` before relying on subsequent socket events.
