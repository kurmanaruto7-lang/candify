# Candify — Proxy V2

A fast, polished web proxy. The browsing interface is the product: open the site and you
land straight on a new-tab page with the URL bar ready — no launch button, no extra click.
Under the hood it uses Ultraviolet (service-worker proxy) + bare-mux/epoxy over a Wisp
backend.

## Run it

```bash
npm install
npm start                 # http://localhost:3000
```

Open `http://localhost:3000` and start browsing. Everything runs from this one server:
the app, the proxy (`/wisp/`), the owner API (`/api/*`), and the owner dashboard (`/admin`).

### Owner dashboard

Set a password in the environment to enable `/admin`:

```bash
OWNER_PASSWORD="your-strong-password" npm start
```

The password is read from the environment and compared server-side (scrypt, timing-safe).
It is never written into the code or sent to the browser. Without `OWNER_PASSWORD`, the
dashboard shows "owner login not configured" and the rest of the site works normally.

The dashboard gives you: live status, traffic per minute, system/build info, an activity
log, and configuration you can change without editing source — **site name, announcement
banner, maintenance mode, maintenance message, and feature toggles** (history, favorites,
quick launch, about:blank cloak). Maintenance mode shows a maintenance page and genuinely
pauses the proxy for everyone except you.

## Deploy

**One host (simplest).** Put the whole folder on any Node 18+ host (a VM, Render, Railway,
Koyeb…) and run `npm start` with `OWNER_PASSWORD` set. One URL serves everything.
See [DEPLOY-VM.md](DEPLOY-VM.md) for an always-on, free Oracle Cloud setup with HTTPS.

**Static front-end + backend (e.g. Firebase + a tunnel/VM).** The front-end is static
files; the proxy needs the Node backend.

```bash
node build.js wss://YOUR-BACKEND/wisp/   # writes ./dist pointing at your backend
# upload the contents of ./dist to your static host (Firebase, Azure, S3, …)
```

`node build.js static` builds a no-backend copy that shows sites in iframes only (many
sites refuse this). The owner dashboard lives on the backend origin (`/admin`).

## Privacy (honest)

Candify routes the page you open through the proxy, so the destination sees the proxy
rather than your network directly, and it strips headers that block framing. It does **not**
make you anonymous — your network and the proxy host can still see traffic. History and
favorites are stored only in your own browser (local storage); the backend does not log the
sites you visit.

## Files

- `server.js` — HTTP + static + S3 mirror + Wisp proxy + owner API (status/config/auth/log)
- `public/index.html` — the proxy app (auto-start, tabs, omnibox, history, favorites, settings)
- `public/admin.html` — owner login + dashboard (loaded only when you open `/admin`)
- `public/sw.js`, `public/uv.config.js` — Ultraviolet service worker + config
- `build.js` — builds `./dist` for static hosting
- `admin-config.json`, `admin-log.json`, `vault.json` — runtime data, git-ignored, never committed
