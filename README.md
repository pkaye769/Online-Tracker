# Online tracker

This project now includes:
- Core Scala Online Tracker code (`altfinder`, `tracker`, `common`)
- Web UI + API + Discord slash-command bot in `web-ui`

## Run Discord bot + Web UI

1. Open `web-ui/.env` and set:
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`

2. Start both services:
```bat
start-web-ui-and-bot.bat
```

3. Open:
- Web UI: `http://localhost:3000`

## Manual start (optional)

From `web-ui`:
```bat
npm run dev
```

In another terminal:
```bat
npm run bot
```
