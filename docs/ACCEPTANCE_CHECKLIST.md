# ICL acceptance checklist

Use this checklist before calling the demo or deployment complete. Items marked optional are not required for the core experience.

## League website

- [ ] Home shows live score, fixtures, points, Orange Cap, and Purple Cap data.
- [ ] Points rows include P, W, L, NRR, and Pts.
- [ ] Teams, player profiles, match scorecards, gallery, and rules/format have usable responsive views.
- [ ] Match, team, and player pages show CricHeroes deep links when a URL exists.
- [ ] Mobile navigation and primary tables remain usable at 360 px width.

## Authentication and authorization

- [ ] JWT login works for admin, auctioneer, team manager, and viewer roles.
- [ ] Server middleware, rather than UI visibility alone, protects privileged operations.
- [ ] A manager can act only for their assigned team.
- [ ] Passwords are hashed and no secrets appear in frontend source or responses.

## Admin CMS

- [ ] `/admin` redirects anonymous users to login and refuses every non-admin role.
- [ ] Server middleware protects every admin list, create, edit, delete, import, queue, user, and sync route.
- [ ] Admin can manage teams, players, fixtures/scores, gallery, rules/format, auction setup/queue, and user roles.
- [ ] Match forms select existing teams and prevent a team from playing itself, including partial edits.
- [ ] User management lists existing users and supports create, role/team edit, password reset, and safe delete.
- [ ] The final admin cannot be deleted or demoted; an admin cannot accidentally delete their own account.
- [ ] Referenced teams, players, matches, tournaments, and audit records cannot be orphaned by deletion.
- [ ] Auction configuration uses its dedicated endpoint and cannot directly overwrite live bid state.
- [ ] Successful deletes return a JSON confirmation and update the UI without a response-parsing error.
- [ ] CSV handles BOM, CRLF/LF, quoted commas/quotes/newlines, blank rows, invalid numbers/enums/URLs, duplicates, and the 500-row limit.
- [ ] Import reports created, skipped, and failed rows clearly; no client-only validation is trusted by the server.
- [ ] CSV exports neutralize cells beginning with `=`, `+`, `-`, or `@` before spreadsheet use.
- [ ] CricHeroes controls load current persisted status and use the canonical admin endpoints.
- [ ] CMS tables, dialogs, and navigation remain usable on mobile and have clear empty/loading/error states.

## Live auction

- [ ] Search/filter and player category/base-price fields work.
- [ ] The auctioneer can start, pause/resume, skip, sell/unsell, re-auction, and undo the last bid.
- [ ] Timer, once/twice phases, current bid, bidder, and history sync through Socket.io.
- [ ] Minimum amount, increment, purse, self-bid, timer, sold-state, and duplicate-bid checks run on the server.
- [ ] Competing bids are resolved with a conditional atomic database update.
- [ ] SOLD updates the team purse and squad exactly once.
- [ ] Squad limit, role counts, and wicketkeeper count are visible.
- [ ] Projector mode and one-tap mobile bidding are usable.
- [ ] Auction history, analytics, CSV export, receipt PDF, and post-auction report work.
- [ ] AI price prediction is clearly labelled optional if not enabled.

## Chatbot

- [ ] Widget appears on every page and supports English, Hindi, and Hinglish.
- [ ] Groq requests originate only from the backend.
- [ ] MongoDB context includes standings, fixtures, leaders, price, purse, and auction state as relevant.
- [ ] Timeout, 429, 5xx, and other Groq failures switch to the regex fallback.
- [ ] All required fallback intents return database-backed templated answers.
- [ ] Unknown questions list supported topics.
- [ ] Per-user rate limiting and repeated-question caching work.
- [ ] The UI shows `Basic mode` only when the fallback produced the answer.

## Data sources

- [ ] Manual admin entry, built-in scorer, and CricHeroes use one adapter contract.
- [ ] Team, Player, Match, and Tournament store `cricheroesId` and `cricheroesUrl`.
- [ ] CricHeroes runs on a schedule, reads public pages only, and saves cache metadata.
- [ ] Admin can enable/disable sync and trigger a controlled refresh.
- [ ] Sync failure serves last-known data and its timestamp.
- [ ] Manual overrides win over synchronized fields.
- [ ] League pages and chatbot read the same MongoDB representation.

## Deployment and resilience

- [ ] `npm run build` succeeds from the repository root.
- [ ] The server starts with production environment values and `/api/health` returns 200.
- [ ] Vercel SPA routing, Render CORS, Socket.io transport, and Atlas connectivity are verified.
- [ ] Environment files are ignored; only `.env.example` files are committed.
- [ ] Empty, loading, error, offline, and reconnecting states are understandable.
