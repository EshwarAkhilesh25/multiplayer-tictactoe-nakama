# Lila Tic-Tac-Toe — Multiplayer Arena

A real-time, multiplayer Tic-Tac-Toe game built with **React + TypeScript** on the frontend and **Nakama** (open-source game server) on the backend. Supports Classic and Timed game modes, a global leaderboard, persistent player stats, and concurrent match sessions.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Setup & Installation](#setup--installation)
4. [API & Server Configuration](#api--server-configuration)
5. [Deployment Process](#deployment-process)
6. [Live Deployment](#-live-deployment)
7. [How to Test Multiplayer Functionality](#how-to-test-multiplayer-functionality)
8. [Design Decisions](#design-decisions)
9. [Feature Summary](#feature-summary)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Browser Clients                  │
│              React + TypeScript (Port 3000)         │
│   LobbyPage ──► GamePage ──► LoginPage              │
│   nakama-js SDK (WebSocket + HTTP RPC)              │
└────────────────────┬────────────────────────────────┘
                     │  HTTP :7350  /  WS :7350
┌────────────────────▼────────────────────────────────┐
│              Nakama Game Server :7350               │
│         Authoritative Match Handler (JS)            │
│    ┌──────────────────────────────────────────┐     │
│    │  main.js  (JavaScript runtime module)    │     │
│    │  • matchInit       – initialise state    │     │
│    │  • matchJoinAttempt– validate join       │     │
│    │  • matchLoop       – tick game logic     │     │
│    │  • matchLeave      – forfeit / cleanup   │     │
│    │  • matchTerminate  – end match           │     │
│    │  RPC endpoints:                          │     │
│    │    create_match / list_matches           │     │
│    │    get_leaderboard / get_player_stats    │     │
│    └──────────────────────────────────────────┘     │
└────────────────────┬────────────────────────────────┘
                     │  SQL
┌────────────────────▼────────────────────────────────┐
│           PostgreSQL 12  (Port 5432)                │
│   Persists: accounts, storage objects, leaderboard  │
└─────────────────────────────────────────────────────┘
```

### Key Data Flows

| Action          | Flow                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| Login           | Frontend → `client.authenticateCustom(customId, true, username)` → Nakama → JWT session |
| Create match    | Frontend RPC `create_match` → `nk.matchCreate()` → match ID returned                    |
| Join match      | Frontend `sock.joinMatch(id)` → `matchJoinAttempt` validates capacity                   |
| Make move       | Frontend `sock.sendMatchState(opcode=1, move)` → `matchLoop` validates & broadcasts     |
| Game over       | `matchLoop` detects win/draw → broadcasts opcode 3 → frontend shows result              |
| Opponent leaves | `matchLeave` fires → broadcasts opcode 4 (forfeit) → winner declared                    |
| Leaderboard     | Frontend RPC `get_leaderboard` → `nk.leaderboardRecordsList()` → top 10                 |

---

## Prerequisites

| Tool           | Version | Purpose                  |
| -------------- | ------- | ------------------------ |
| Node.js        | ≥ 16    | Frontend dev server      |
| npm            | ≥ 8     | Package management       |
| Docker Desktop | ≥ 4     | Runs Nakama + PostgreSQL |
| Docker Compose | ≥ 2     | Orchestrates containers  |

---

## Setup & Installation

### 1. Clone / Extract the project

```bash
cd "C:\Users\eshwar akhilesh\Downloads\Assigment2\Assigment2\lila-tictactoe"
```

### 2. Start the Backend (Nakama + PostgreSQL)

```bash
cd nakama-backend

# First run – pulls images and runs DB migrations automatically
docker-compose up -d

# Check both containers are running
docker-compose ps
```

Expected output:

```
NAME       STATUS    PORTS
nakama     running   0.0.0.0:7349-7351->7349-7351/tcp
postgres   running   0.0.0.0:5432->5432/tcp
```

Wait ~10 seconds for Nakama to finish migrations before starting the frontend.

### 3. Start the Frontend

```bash
cd ../frontend
npm install
npm start
```

The app opens at **http://localhost:3000**

### 4. Verify Backend Health

```
http://localhost:7351/healthcheck
```

Should return `{}` with HTTP 200.

---

## API & Server Configuration

### Nakama Server

| Setting               | Value                    |
| --------------------- | ------------------------ |
| HTTP API port         | `7350`                   |
| Console (admin UI)    | `http://localhost:7351`  |
| gRPC port             | `7349`                   |
| Server key            | `defaultkey`             |
| Session expiry        | `7200` seconds (2 hours) |
| JS runtime entrypoint | `modules/main.js`        |
| Log level             | `DEBUG`                  |

### PostgreSQL

| Setting  | Value       |
| -------- | ----------- |
| Host     | `localhost` |
| Port     | `5432`      |
| Database | `nakama`    |
| Password | `localdb`   |

### Authentication (`src/pages/LoginPage.tsx`)

Uses `authenticateCustom` with the username as the internal key:

```typescript
const customId = trimmedUsername.padEnd(6, "_"); // Nakama requires 6-128 bytes
const session = await client.authenticateCustom(
  customId,
  true,
  trimmedUsername,
);
```

| Parameter  | Value                     | Purpose                              |
| ---------- | ------------------------- | ------------------------------------ |
| `customId` | `username.padEnd(6, "_")` | Internal unique key (min 6 bytes)    |
| `create`   | `true`                    | Creates account on first login       |
| `username` | Raw username              | Display name in game and leaderboard |

This ensures the same username always maps to the same account from any device or browser.

### Frontend Client (`src/utils/nakamaClient.ts`)

```typescript
const client = new Client("defaultkey", "localhost", "7350", false);
```

To point at a remote server, change `localhost` and `7350` to your server's address and port. Set the last argument to `true` to use SSL.

### Registered RPC Endpoints

| RPC ID              | Description                                | Payload                              |
| ------------------- | ------------------------------------------ | ------------------------------------ |
| `create_match`      | Creates a new authoritative match          | `{ gameMode: "classic" \| "timed" }` |
| `list_matches`      | Lists open + in-progress matches           | `{ gameMode: "classic" \| "timed" }` |
| `get_leaderboard`   | Top 10 global rankings with real usernames | `{}`                                 |
| `get_player_stats`  | Current user's stats                       | `{}`                                 |
| `reset_leaderboard` | Clear all leaderboard records (admin)      | `{}`                                 |

### WebSocket Opcodes

| Opcode | Direction       | Meaning                                             |
| ------ | --------------- | --------------------------------------------------- |
| `1`    | Server → Client | `match_start` – game begins with initial state      |
| `2`    | Server → Client | `state_update` – board updated, turn changed        |
| `3`    | Server → Client | `game_over` – win or draw                           |
| `4`    | Server → Client | `player_left` – opponent forfeited by disconnecting |
| `5`    | Server → Client | `timeout` – timed mode: player ran out of time      |
| `99`   | Server → Client | `error` – invalid move or other error               |
| `1`    | Client → Server | Player move: `{ position: 0-8 }`                    |

### Match Labels

| Label             | Meaning                         |
| ----------------- | ------------------------------- |
| `waiting_classic` | Classic match, 1 player waiting |
| `playing_classic` | Classic match, 2 players active |
| `waiting_timed`   | Timed match, 1 player waiting   |
| `playing_timed`   | Timed match, 2 players active   |
| `finished`        | Match ended – hidden from lobby |

### Scoring (Leaderboard)

**Important**: Leaderboard uses `increment` operator - only points earned per game are sent

| Result | Points Added | Implementation                                                       |
| ------ | ------------ | -------------------------------------------------------------------- |
| Win    | +3           | `nk.leaderboardRecordWrite("tictactoe_global", userId, username, 3)` |
| Draw   | +1           | `nk.leaderboardRecordWrite("tictactoe_global", userId, username, 1)` |
| Loss   | 0            | No leaderboard write (losses tracked in storage only)                |

**Note**: With increment operator, Nakama automatically accumulates the total score. We send only the points earned in each game, not the cumulative total.

---

## Deployment Process

### Cloud Deployment (Production)

**Backend — Google Cloud Platform (GCP)**

- VM: e2-small (2 vCPU, 2GB RAM), Ubuntu 22.04, us-central1
- Nakama + PostgreSQL running via Docker Compose
- Ports 7349, 7350, 7351 open via GCP Firewall
- Direct endpoint: http://136.111.140.22:7350
- Admin console: http://136.111.140.22:7351

**Frontend — Vercel**

- Connected to GitHub repo, auto-deploys on every push
- Game URL: https://multiplayer-tictactoe-nakama.vercel.app

### Local Development (default)

```bash
# Backend
cd nakama-backend
docker-compose up -d

# Frontend
cd ../frontend
npm start
```

### Production Build

```bash
cd frontend
npm run build
# Serve the build/ folder with any static host (Nginx, Netlify, Vercel, etc.)
```

### Updating Backend Logic

The Nakama JS runtime reloads the module on restart:

```bash
# Edit nakama-backend/modules/main.js, then:
cd nakama-backend
docker-compose restart nakama
```

---

## 🚀 Live Deployment

|                  | URL                                                              |
| ---------------- | ---------------------------------------------------------------- |
| 🎮 Game          | https://multiplayer-tictactoe-nakama.vercel.app                  |
| ⚙️ Nakama Server | http://136.111.140.22:7350                                       |
| 🖥️ Admin Console | http://136.111.140.22:7351                                       |
| 📁 Source Code   | https://github.com/EshwarAkhilesh25/multiplayer-tictactoe-nakama |

---

## Troubleshooting

### Common Issues

| Issue                          | Solution                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| **Login fails with 409 error** | Database has old accounts. Run `docker-compose down -v && docker-compose up -d` to wipe data |
| **"Failed to fetch"**          | Nakama backend not running. Check `docker-compose ps` and restart if needed                  |
| **CORS errors**                | Ensure frontend is on allowed port (3000/3001) or use browser CORS extension for development |
| **Match not found**            | Match IDs are case-sensitive. Copy the full ID from the lobby                                |

### Debug Commands

```bash
# Check Nakama logs
docker-compose logs nakama -f

# Check database connection
docker-compose exec nakama /nakama/nakama --config . --database.address postgres:localdb@postgres:5432/nakama

# Reset everything (WARNING: deletes all data)
docker-compose down -v && docker-compose up -d
```

Check logs to confirm no JS errors:

```bash
docker-compose logs -f nakama
```

### Environment Variables for Remote Deployment

Update `frontend/src/utils/nakamaClient.ts`:

```typescript
const SERVER_HOST = process.env.REACT_APP_NAKAMA_HOST || "localhost";
const SERVER_PORT = process.env.REACT_APP_NAKAMA_PORT || "7350";
const USE_SSL = process.env.REACT_APP_NAKAMA_SSL === "true";

const client = new Client("defaultkey", SERVER_HOST, SERVER_PORT, USE_SSL);
```

Then set environment variables at build time:

```bash
REACT_APP_NAKAMA_HOST=your-server.com \
REACT_APP_NAKAMA_PORT=7350 \
REACT_APP_NAKAMA_SSL=true \
npm run build
```

### Docker Commands Reference

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Restart only Nakama (after editing main.js)
docker-compose restart nakama

# View Nakama logs in real time
docker-compose logs -f nakama

# Remove all containers + volumes (full reset)
docker-compose down -v
```

---

## How to Test Multiplayer Functionality

### Manual Testing — Two Browser Windows

1. Open **http://localhost:3000** in **Window A** (normal)
2. Open **http://localhost:3000** in **Window B** (Incognito / different browser)

#### Test: Classic Game — Full Round Trip

| Step | Window A                                            | Window B                                               |
| ---- | --------------------------------------------------- | ------------------------------------------------------ |
| 1    | Login as `playerA`                                  | Login as `playerB`                                     |
| 2    | Select **Classic Mode**, click **Create New Match** | —                                                      |
| 3    | Copy the Match ID from the popup                    | —                                                      |
| 4    | —                                                   | Paste Match ID in **Join by ID** field, click **Join** |
| 5    | Both navigate to Game Arena                         | —                                                      |
| 6    | Click any empty cell (your turn)                    | See board update in real time                          |
| 7    | Play until win / draw                               | —                                                      |
| 8    | Both see result + **Back to Lobby** button          | —                                                      |

#### Test: Open Games List (Classic vs Timed isolation)

| Step | Action                                                   | Expected                       |
| ---- | -------------------------------------------------------- | ------------------------------ |
| 1    | A creates a **Timed** match, B views **Classic** lobby   | Timed match NOT visible to B   |
| 2    | A creates a **Classic** match, B views **Classic** lobby | Match appears as "Players 0/2" |
| 3    | A joins the Classic match                                | Match shows "Players 1/2"      |
| 4    | B clicks **Join Match**                                  | Both in game ✅                |

#### Test: Room Full Warning (3rd Player)

| Step | Action                                  | Expected                                |
| ---- | --------------------------------------- | --------------------------------------- |
| 1    | A and B both join the same match        | Match label → `playing_classic`         |
| 2    | Open Window C (3rd player)              | Open Games shows **🔒 Room Full** badge |
| 3    | C clicks the **Room Full** button       | Warning: _"This room is already full"_  |
| 4    | C pastes A's Match ID in **Join by ID** | Same warning shown                      |

#### Test: Forfeit / Opponent Left

| Step | Action                                  | Expected                            |
| ---- | --------------------------------------- | ----------------------------------- |
| 1    | A and B are playing                     | Both in game arena                  |
| 2    | B closes the tab                        | A sees **"You Win by Forfeit! 🏆"** |
| 3    | Timer (if timed mode) stops immediately | —                                   |
| 4    | **Back to Lobby** button appears        | A returns to lobby ✅               |
| 5    | Match no longer in Open Games list      | Label = `finished`                  |

#### Test: Timed Mode — Turn Timeout

| Step | Action                          | Expected                        |
| ---- | ------------------------------- | ------------------------------- |
| 1    | Both players join a Timed match | 30-second countdown visible     |
| 2    | Active player does NOT move     | Countdown reaches 0             |
| 3    | Server auto-forfeits (opcode 5) | Other player wins, result shown |

#### Test: Leaderboard & Stats

| Step | Action                                   | Expected                                       |
| ---- | ---------------------------------------- | ---------------------------------------------- |
| 1    | Play and win a match                     | Stats card shows +1 Win, +3 pts on leaderboard |
| 2    | Lose a match                             | +1 Loss, streak resets to 0                    |
| 3    | Draw                                     | +1 Draw, +1 leaderboard point                  |
| 4    | Check **🏆 Global Leaderboard** in lobby | Top 10 players sorted by score                 |

### Concurrent Sessions Test

1. Open 4 browser windows (2 pairs)
2. Pair 1 (A+B): start a Classic match
3. Pair 2 (C+D): start a separate Classic match simultaneously
4. Moves in one match do **not** appear in the other — confirming isolation ✅

### Nakama Admin Console

Monitor matches, players, and storage in real time:

```
http://localhost:7351
Username: admin
Password: password
```

- **Matches** tab — see active match IDs, labels, player counts
- **Storage** tab → collection `stats`, key `player_stats` — inspect persisted stats
- **Leaderboard** tab — verify `tictactoe_global` scores

---

## Design Decisions

### Authoritative Server-Side Match Logic

All game state (board, turn order, win detection) lives on the Nakama server in `main.js`. Clients only send move intents; the server validates and broadcasts the canonical state. This prevents cheating and desync.

### Match Label System

Matches carry a string label (`waiting_classic`, `playing_classic`, etc.) updated via `dispatcher.matchLabelUpdate()`. The lobby filters by exact label match rather than relying on Nakama's built-in label filter (which uses prefix matching, causing false positives). This ensures Classic and Timed queues are strictly isolated.

### Polling + WebSocket Hybrid

- **Open Games list** polls the `list_matches` RPC every **2 seconds** — lightweight HTTP, no persistent socket needed in lobby
- **Waiting room detection** uses polling to check when opponent joins (no presence socket to avoid interference)
- **In-game state** uses a **persistent WebSocket** (Nakama socket) for low-latency move/broadcast — no polling in game
- **Leaderboard** polls every **30 seconds** (infrequent, non-critical data)

### Stats Persistence via Nakama Storage

Player stats (wins, losses, draws, streak, best streak) are stored in Nakama's built-in key-value storage engine (`collection: "stats"`, `key: "player_stats"`), backed by PostgreSQL. This survives server restarts and is accessible from any client session.

### Forfeit vs Disconnect Detection

`matchLeave` fires immediately when a socket closes. During a `playing` match, the server checks remaining connected presences, awards a win to the survivor via **opcode 4** (`player_left`), and updates the label to `finished`. This is distinct from opcode 3 (normal game_over) so the winner's UI can show "You Win by Forfeit!" specifically.

### Reconnection Support

On login, the frontend checks `localStorage` for a stored `activeMatch_<userId>`. If found, it attempts `sock.joinMatch(storedMatchId)` before showing the lobby. The backend's `matchJoinAttempt` allows rejoins for known players (`mState.players[userId]` already set), preventing duplicate presence errors.

---

## Feature Summary

| Feature                          | Status | Implementation                                                      |
| -------------------------------- | ------ | ------------------------------------------------------------------- |
| Real-time multiplayer            | ✅     | Nakama WebSocket authoritative matches                              |
| Concurrent game sessions         | ✅     | Each match is fully isolated state                                  |
| Classic game mode                | ✅     | No time limit, strategic play                                       |
| Timed game mode (30s/turn)       | ✅     | `matchLoop` tick-based countdown                                    |
| Auto-forfeit on timeout          | ✅     | Opcode 5 broadcast, stats updated                                   |
| Classic/Timed lobby separation   | ✅     | Label-based exact-match filtering                                   |
| Full room warning for 3rd player | ✅     | Label `playing_*` blocks join                                       |
| Forfeit on disconnect            | ✅     | `matchLeave` → opcode 4 → win awarded                               |
| Global leaderboard               | ✅     | `tictactoe_global` Nakama leaderboard with real username resolution |
| Persistent player stats          | ✅     | Nakama storage, wins/losses/streaks                                 |
| Reconnection on refresh          | ✅     | `localStorage` match ID recovery                                    |
| Match cleanup (finished)         | ✅     | Label `finished`, hidden from lobby                                 |
| Leaderboard admin reset          | ✅     | `reset_leaderboard` RPC for maintenance                             |

---

## Documentation

- **[LEADERBOARD_LOGIC.md](./LEADERBOARD_LOGIC.md)** - Detailed technical implementation of the leaderboard system, scoring algorithm, and username resolution strategy
