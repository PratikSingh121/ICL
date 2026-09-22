# Architecture

ICL is a two-workspace MERN application. The React client presents league, auction, admin, and chatbot experiences. The Express service owns authentication, data access, auction validation, real-time events, exports, and integrations. MongoDB is the shared source of truth.

```text
Browser (React + Tailwind + Recharts)
       │ REST                         │ Socket.io
       ▼                              ▼
Express API ── authentication/RBAC ── auction room + timer
       │
       ├── MongoDB (league, auction, cache, settings)
       ├── Groq chat completion (optional)
       ├── local intent fallback
       ├── CricHeroes scheduled adapter
       └── PDF/CSV report generation
```

## Trust boundaries

- The browser is untrusted. It may propose a bid, but it cannot authorize a role, select another manager's team, debit a purse, or decide a winner.
- JWT claims are verified by the API. Authorization is checked again at each protected operation.
- Groq and MongoDB credentials exist only in the server environment.
- CricHeroes content is treated as external input. Sync writes cached source fields; manual overrides remain separate and win when data is read.

## Auction consistency

Bid acceptance is a server-side state transition. The mutation condition includes the current auction/player state, expected leading amount, open timer, valid increment, and available team purse. A conditional MongoDB update means only one of two simultaneous requests can advance the same bid state. Follow-up events are emitted only after the database accepts the transition.

Sale finalization must be idempotent: the player assignment, purse deduction, squad update, and auction closure may happen only once. Socket.io is a delivery mechanism, not the source of truth; reconnecting clients fetch the current state from REST before rejoining live events.

## Chat request flow

1. Apply per-user/IP rate limiting and normalize the question for the short-lived cache key.
2. Query the MongoDB records relevant to the question.
3. If a Groq key is configured, pass a bounded context snapshot to the OpenAI-compatible chat completion endpoint.
4. On timeout, 429, 5xx, invalid response, or network failure, run the local regex intent matcher and query MongoDB for the matching answer.
5. Return the answer with a mode indicator so the client can show `Basic mode` for fallback responses.

The same MongoDB representation backs pages and chat answers, regardless of whether a field came from admin entry, the scorer, or CricHeroes.

## Data source precedence

```text
manual override > cached scorer/CricHeroes value > schema default
```

CricHeroes synchronization runs on a schedule or controlled admin action. Public page reads never run in the user request path. Failure records an error while retaining the previous payload and `lastUpdatedAt` value.

## Deployment topology

Vercel serves static frontend assets. Render runs the long-lived Node process needed for Socket.io and cron. MongoDB Atlas persists shared data. For horizontal scale, add a Redis Socket.io adapter, shared cache/rate-limiter, and ensure exactly one scheduler instance runs each sync job.
