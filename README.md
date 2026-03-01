# Skywatch

An intelligence-style study platform built for RAF applicants, recruits, and enthusiasts. Stay current on RAF news, aircraft, ranks, bases, and doctrine. Test your recall through gamified knowledge checks and climb the Intelligence Corps rank ladder.

---

## Features

- **Intelligence Briefs** — categorised RAF articles with keyword highlighting and an interactive target-dossier system
- **Knowledge Check Games** — quiz, Order of Battle, Who's That Aircraft, and Flashcard Recall game modes
- **Rank Progression** — earn Aircoins through games and daily logins to climb the rank ladder
- **Subscription Tiers** — Free, Trial, Silver, and Gold tiers via Stripe
- **Google OAuth + Email Auth** — secure sign-in with JWT httpOnly cookies
- **Admin Panel** — user management, problem reports, app stats, and configurable game settings

---

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Frontend  | React 19 + Vite 7                       |
| Backend   | Node.js + Express 4                     |
| Database  | MongoDB Atlas (Mongoose 8)              |
| Auth      | JWT (httpOnly cookies) + Google OAuth   |
| Payments  | Stripe                                  |

---

## Project Structure

```
Skywatch/
├── backend/              # Express API server
│   ├── models/           # Mongoose schemas (17 models)
│   ├── routes/           # auth, briefs, games, admin, users
│   ├── middleware/       # JWT auth middleware
│   ├── server.js
│   ├── .env.example      # Backend env template (commit this)
│   └── package.json
├── src/                  # React frontend
│   ├── components/       # Navbar, Footer, modals, game components
│   ├── pages/            # Dashboard, Intel Feed, Profile, Login, Welcome, Rankings, …
│   ├── context/          # AuthContext (global user state)
│   ├── data/             # Mock data for development
│   └── App.jsx / App.css
├── public/
│   └── sounds/           # intel_brief_opened.mp3, target_locked.mp3, out_of_ammo.mp3
├── .env.example          # Frontend env template (commit this)
└── APPLICATION_INFO/     # Project spec documents (gitignored)
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [MongoDB Atlas](https://www.mongodb.com/atlas) account (free tier works)
- A [Google Cloud](https://console.cloud.google.com) project with OAuth 2.0 credentials

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

**.env** (frontend — project root):

```bash
cp .env.example .env
```

```env
VITE_API_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

**backend/.env** (backend):

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
```

> Both `.env` files are in `.gitignore` and will never be committed to git.
> Only commit the `.env.example` template files.

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

Place these MP3 files in `public/sounds/` for the full experience:

| File | Trigger |
|---|---|
| `intel_brief_opened.mp3` | Opening an intelligence brief |
| `target_locked.mp3` | Clicking a highlighted keyword |
| `out_of_ammo.mp3` | Clicking a keyword with no ammo remaining |

---

## Admin Access

The account `osmightymanos@hotmail.co.uk` is automatically granted admin rights on first sign-in (email or Google). Admin users see an **Admin** link in the navbar.

---

## Subscription Tiers

| Tier   | Categories available          | Games | Keyword ammo |
|--------|-------------------------------|-------|--------------|
| Free   | Free categories               | ✗     | 0            |
| Trial  | Free categories               | ✓     | 3            |
| Silver | Free categories               | ✓     | 3            |
| Gold   | All categories                | ✓     | 10           |

Trial duration and ammo amounts are configurable from the Admin panel.

---

## Development Notes

- **Mock data** — `src/data/mockData.js` provides sample briefs and ranks for UI development until the backend is wired up
- **Auth** — `AuthContext` exposes `user`, `setUser`, `logout`, and `loading` globally; pages that need auth state import `useAuth()`
- **Stripe** — fields are on the User schema and ready; payment flow is not yet implemented
