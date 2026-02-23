# Online Tracker Web UI

Fresh starter for a Tibia intelligence tool with:
- Discord slash commands: `/alt`, `/guild`, `/traded-when`
- Web dashboard with styled UI and quick search
- API endpoints for alt correlation, guild lookup, and traded history
- Live source adapters with local sample fallback
- Online tracker for logout->login transition alts

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
copy .env.example .env
```

3. Run API + dashboard:
```bash
npm run dev
```

4. In another terminal, run Discord bot:
```bash
npm run bot
```

## API Endpoints
- `GET /api/search/alt?q=<character>`
- `GET /api/search/guild?q=<guild>`
- `GET /api/search/traded?character=<name>`
- `GET /api/sources`
- `GET /api/tracker/status`
- `POST /api/tracker/start`
- `POST /api/tracker/stop`
- `GET /api/tracker/alternates?character=<name>&windowSeconds=180&minPairs=3&includeClashes=false`

## Tracker Workflow
1. Start tracker manually:
```bash
curl -X POST http://localhost:3000/api/tracker/start -H "Content-Type: application/json" -d "{\"worlds\":[\"Nefera\"],\"intervalMs\":60000}"
```
2. Let it run to collect login/logout transitions.
3. Search `/alt` in dashboard or call `/api/search/alt?q=<character>`.

Stored tracker data:
- `data/online-tracker.json`

## Live Sources
Configured in `src/services/providers.js`:
- `https://tibiadata.com/` (via `https://api.tibiadata.com/v4`) for live profile/member pools and news feed
- `https://www.exevopan.com/` homepage parsing for current auction character signals
- `https://www.tibia.com/news/?subtopic=latestnews` parsing for trade-related news references
- `guildstats.eu` character page scraping for transfer signals (default enabled)

## Notes
- `/alt` is probabilistic confidence scoring, not identity proof.
- Tracker matching follows `online-tracker-main` style adjacency logic:
  - counts adjacency in both directions (main logout->other login and reverse)
  - can filter out overlaps/clashes
- If live sources fail or are blocked, results fall back to local sample and stored tracker data.
