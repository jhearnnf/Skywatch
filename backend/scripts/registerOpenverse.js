#!/usr/bin/env node
//
// Register a free Openverse application key, for the Clipper music search.
//
// Why bother: Openverse serves anonymous requests but rate-limits them hard,
// and once the budget is spent it refuses outright with
// 401 {"detail":"Authentication credentials were not provided."}. A handful of
// searches is enough to hit that, which looks exactly like a broken feature.
// A registered key lifts the limit.
//
// This is deliberately a script you run rather than something the app does for
// you: it registers an application in your name, against your email address,
// and Openverse emails you a verification link. That is your decision to make,
// not a side effect of clicking Search.
//
// Usage:
//   node scripts/registerOpenverse.js you@example.com
//
// Then put the printed values in backend/.env and restart the backend:
//   OPENVERSE_CLIENT_ID=...
//   OPENVERSE_CLIENT_SECRET=...
//
// Openverse sends a verification email. Until you click it the key works at a
// reduced (but still much higher than anonymous) rate.

const REGISTER_URL = 'https://api.openverse.org/v1/auth_tokens/register/';

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/registerOpenverse.js you@example.com');
    process.exit(1);
  }

  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'SkyWatch/1.0 (educational-platform)' },
    body: JSON.stringify({
      name: `SkyWatch Clipper (${Date.now().toString(36)})`,
      description: 'Background music search for an educational short-form video tool. '
        + 'Read-only, filtered to CC0 and public-domain audio.',
      email,
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`Registration failed (${res.status}):`, JSON.stringify(body));
    // A duplicate name is the common one, and re-running fixes it because the
    // name carries a timestamp.
    process.exit(1);
  }

  console.log('Registered. Add these to backend/.env and restart the backend:\n');
  console.log(`OPENVERSE_CLIENT_ID=${body.client_id}`);
  console.log(`OPENVERSE_CLIENT_SECRET=${body.client_secret}`);
  console.log(`\n${body.msg || 'Check your email to verify the application.'}`);
}

main().catch(err => {
  console.error('Registration failed:', err.message);
  process.exit(1);
});
