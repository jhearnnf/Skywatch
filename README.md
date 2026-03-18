# Skywatch

An intelligence-style study platform built for RAF applicants, recruits, and enthusiasts. Stay current on RAF news, aircraft, ranks, bases, and doctrine. Test your recall through gamified knowledge checks and climb the rank ladder.

---

## Features

- **Intelligence Briefs** — categorised RAF articles with keyword highlighting and interactive keyword definitions
- **Knowledge Check Games** — Quiz, Battle of Order, Who's That Aircraft, and Flashcard Recall game modes
- **Level & Rank Progression** — earn Aircoins through games and daily logins to level up and climb the RAF rank ladder
- **Subscription Tiers** — Free, Trial, Silver, and Gold tiers via Stripe
- **Google OAuth + Email Auth** — secure sign-in with JWT httpOnly cookies
- **Admin Panel** — AI-assisted brief generation, user management, problem reports, app stats, and configurable game settings
- **Cloud Image Storage** — brief images stored and served via Cloudinary

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 7 + Tailwind CSS v4 |
| Routing | React Router v7 |
| Animations | Framer Motion |
| Backend | Node.js + Express 4 |
| Database | MongoDB Atlas (Mongoose 8) |
| Auth | JWT (httpOnly cookies) + Google OAuth (GIS) |
| Payments | Stripe |
| Images | Cloudinary |
| AI | OpenRouter (GPT-4o-mini) |
| Email | Resend |

---

## Project Structure

```
Skywatch/
├── backend/
│   ├── models/           # Mongoose schemas (18 models)
│   ├── routes/           # auth, briefs, games, admin, users
│   ├── middleware/       # JWT auth middleware
│   ├── utils/            # cloudinary, email, awardCoins, subscription helpers
│   ├── scripts/          # one-off maintenance scripts
│   ├── __tests__/        # Jest integration tests
│   ├── app.js            # Express app (no server.listen)
│   ├── server.js         # DB connect + server start
│   ├── .env.example      # Backend env template
│   └── package.json
├── src/
│   ├── components/       # Layout, notifications, tutorial, UpgradePrompt
│   ├── pages/v2/         # All active pages (Home, Learn, BriefReader, Play, Profile, …)
│   ├── context/          # AuthContext, AppSettingsContext, AppTutorialContext
│   ├── utils/            # subscription helpers
│   ├── data/             # mockData.js (levels, leaderboard, categories)
│   └── main.jsx / main.css
├── public/
│   └── sounds/           # MP3 files for UI sound effects
├── .env.example          # Frontend env template
└── APPLICATION_INFO/     # Project spec documents (gitignored)
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- [MongoDB Atlas](https://www.mongodb.com/atlas) account (free tier works)
- [Google Cloud](https://console.cloud.google.com) project with OAuth 2.0 credentials
- [Cloudinary](https://cloudinary.com) account (free tier works)
- [OpenRouter](https://openrouter.ai) API key (for AI brief generation in admin)

---

### 1. Install dependencies

```bash
# Frontend
npm install

# Backend
cd backend && npm install && cd ..
```

---

### 2. Configure environment variables

**Frontend — `.env` (project root):**

```bash
cp .env.example .env
```

```env
VITE_API_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

**Backend — `backend/.env`:**

```bash
cp backend/.env.example backend/.env
```

```env
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/skywatch
JWT_SECRET=a_long_random_secret_string
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=your_google_client_id
CLIENT_URL=http://localhost:5173
NODE_ENV=development
OPENROUTER_KEY=your_openrouter_api_key
RESEND_API_KEY=your_resend_api_key
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

> Both `.env` files are gitignored and will never be committed. Only the `.env.example` templates are committed.

---

### 3. Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add `http://localhost:5173` to **Authorised JavaScript origins**
4. Copy the Client ID to both `.env` files (`VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`)

---

### 4. Run

```bash
# Terminal 1 — backend (port 5000)
cd backend && npm run dev

# Terminal 2 — frontend (port 5173)
npm run dev
```

Open http://localhost:5173

---

### 5. Sound files

Place these MP3 files in `public/sounds/` for the full audio experience:

| File | Trigger |
|---|---|
| `intel_brief_opened.mp3` | Opening an intelligence brief |
| `target_locked.mp3` | Clicking a highlighted keyword |
| `target_locked_keyword.mp3` | Keyword interaction |
| `stand_down.mp3` | Closing a keyword sheet |
| `coin.mp3` | Earning Aircoins |
| `level_up.mp3` | Level up |
| `rank_promotion.mp3` | RAF rank promotion |
| `quiz_complete_win.mp3` | Passing a quiz |
| `quiz_complete_lose.mp3` | Failing a quiz |
| `battle_of_order_won.mp3` | Winning Battle of Order |
| `battle_of_order_lost.mp3` | Losing Battle of Order |
| `battle_of_order_selection.mp3` | Making a selection in Battle of Order |
| `fire.mp3` | Firing in a game |
| `out_of_ammo_1/2/3.mp3` | Clicking a keyword with no ammo |

---

## Running Tests

```bash
# Frontend (Vitest)
npm test

# Backend (Jest — requires MongoDB connection)
cd backend && npm test
```

---

## Admin Access

The account `osmightymanos@hotmail.co.uk` is automatically granted admin rights on first sign-in. Admin users see an **Admin** link in the navigation. The admin panel includes:

- AI-assisted brief creation (GPT-4o-mini via OpenRouter + Wikipedia images via Cloudinary)
- User management and subscription tier overrides
- Problem report review
- App settings (ammo amounts, trial duration, free/silver categories)
- Game data management

---

## Subscription Tiers

| Tier | Categories | Games | Keyword ammo |
|---|---|---|---|
| Free | Free categories only | No | 0 |
| Trial | Free categories | Yes | 3 (configurable) |
| Silver | Free + Silver categories | Yes | 3 (configurable) |
| Gold | All categories | Yes | 10 (configurable) |

Tier amounts and trial duration are configurable from the Admin panel → Settings.

---

## Development Notes

- **Active pages** are in `src/pages/v2/` — this is the only pages directory in use
- **Routing** uses React Router v7 (`BrowserRouter`) — no custom state-based router
- **Auth state** — `AuthContext` exposes `user`, `setUser`, `logout`, `loading`, and `API`; import via `useAuth()`
- **Levels** — seeded automatically on server start via `Level.seedLevels()`; 10 levels with Aircoin thresholds
- **Images** — all brief images are stored on Cloudinary; the `Media` model stores both `mediaUrl` (Cloudinary URL) and `cloudinaryPublicId` for deletion
- **Stripe** — fields are on the User schema and payment routes exist; full checkout flow not yet wired to a live Stripe account
