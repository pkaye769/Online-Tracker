# Deploy to Render (Blueprint)

## Prerequisites
- GitHub repo: `https://github.com/pkaye769/Online-Tracker`
- Discord bot secrets ready:
  - `DISCORD_TOKEN`
  - `DISCORD_CLIENT_ID`
  - `DISCORD_GUILD_ID`

## One‑Click Blueprint Deploy
1. Go to Render dashboard.
2. Click **New** → **Blueprint**.
3. Select repo: `pkaye769/Online-Tracker`.
4. Render detects `render.yaml` and creates:
   - `online-tracker-web` (Web Service)
   - `online-tracker-bot` (Background Worker)
5. In Render → **Environment** for the worker, add secrets:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
6. Click **Apply** / **Deploy**.

## After Deploy
- Open the web service URL shown by Render.
- The bot will connect automatically using the web URL via `API_BASE_URL`.

## Notes
- Do **not** commit `.env` with secrets.
- If you rotate your Discord token, update it in Render.
