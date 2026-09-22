# Deployment guide

The supported production layout is a Vercel frontend, a Render web service, and MongoDB Atlas. The browser never receives the MongoDB, JWT, or Groq secrets.

## 1. MongoDB Atlas

1. Create a cluster and an application database user.
2. Add the Render service to Atlas network access. During a short demo you can allow access from anywhere, but a restricted address range is safer for a long-running deployment.
3. Copy the driver URI and include the database name, for example `mongodb+srv://USER:PASSWORD@CLUSTER/icl`.

## 2. Render API

The repository includes [`render.yaml`](../render.yaml). Create a Render Blueprint from the repository, or configure an equivalent Node web service manually:

- Build command: `npm install`
- Start command: `npm start -w server`
- Health check: `/api/health`
- Node version: 20 (see [`.nvmrc`](../.nvmrc))

Set the following secrets in the Render dashboard:

- `MONGODB_URI`: MongoDB Atlas connection string
- `JWT_SECRET`: a long, randomly generated value
- `CLIENT_URL`: the final Vercel origin, without a trailing slash
- `GROQ_API_KEY`: optional; when absent or unavailable the chatbot uses Basic mode

The optional CricHeroes sync is disabled by default. To enable it, set `CRICHEROES_SYNC_ENABLED=true`, add public CricHeroes URLs to league records through admin data, and adjust `CRICHEROES_SYNC_CRON` if needed. It is a scheduled cache refresh, not a request-time scraper.

After the first deploy, open `https://YOUR-RENDER-HOST/api/health`. Run the seed command once from a Render shell if demo content is required:

```bash
npm run seed -w server
```

Change the seeded password before using the application beyond a local demo.

## 3. Vercel frontend

Create a Vercel project with `client` as its root directory. Use the Vite preset and set:

```dotenv
VITE_API_URL=https://YOUR-RENDER-HOST
VITE_SOCKET_URL=https://YOUR-RENDER-HOST
```

Deploy, then update `CLIENT_URL` on Render to the exact Vercel origin and restart the API. This allows REST and Socket.io CORS requests from the frontend.

## 4. Production checks

- The health endpoint returns HTTP 200.
- The public home page loads league data from Render.
- An admin can sign in and protected endpoints reject an unauthenticated request.
- Two team-manager browsers see the same auction player, bid and timer.
- A bid larger than the purse is rejected and balances remain unchanged.
- The chatbot answers from live MongoDB data. Removing the Groq key shows `Basic mode` and still answers supported intents.
- A failed CricHeroes refresh leaves the previous cached data visible with its last-updated time.
- Reloading a nested frontend route does not return a Vercel 404.

## Scaling notes

One Render instance is sufficient for a college-league demo. Multiple API instances require a shared Socket.io adapter (typically Redis), shared rate-limit/cache state, and single-leader scheduling for the CricHeroes job. MongoDB remains the source of truth for auction state and atomic bid validation.

## Rollback

Roll back the Vercel and Render deployments independently from their dashboards. Do not roll back MongoDB by deleting current collections. Restore from an Atlas snapshot if a data rollback is genuinely required, and pause the auction while restoring.
