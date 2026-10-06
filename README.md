# Park Log

My national parks, ranked, with a tier list, passport stamps, hikes, and notes. It runs as a website and installs on a phone like an app.

## What's in this folder

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app itself |
| `config.js` | Where your two Supabase values go (Step 3) |
| `park-log-data.json` | Your 33 parks, 82 stamps, and still-to-go list. Loaded the first time you sign in |
| `supabase-setup.sql` | Creates the table that stores your data (Step 2) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make it installable on your phone and let it open without signal |

## Part A: Put it on GitHub Pages

1. Create a new repository (for example `park-log`) and upload everything in this folder, keeping the `icons` folder.
2. In the repository, go to **Settings > Pages**, set the source to your main branch and the root folder, and save.
3. After a minute your site is live at `https://YOUR-USERNAME.github.io/park-log/`.

It works right away in "this device only" mode, with a note at the top saying Supabase isn't connected. That's expected until Part B is done.

## Part B: Connect Supabase so your data saves to your account

**Step 1. Create a project.** Sign up at supabase.com, click **New project**, name it `park-log`, set a database password (save it somewhere), pick the region closest to you, and create it. It takes a couple of minutes to finish setting up.

**Step 2. Create the table.** In the left sidebar open **SQL Editor**, click **New query**, paste in all of `supabase-setup.sql`, and click **Run**. You should see "Success. No rows returned."

**Step 3. Copy your keys into `config.js`.** Go to **Project Settings > API** (on newer dashboards, **API Keys**). Copy the **Project URL** and the **publishable** key (older projects call it the **anon public** key). Paste them into `config.js` in place of the `YOUR-...` placeholders, then commit the change on GitHub. Never paste the **secret** or **service_role** key anywhere in this project.

**Step 4. Point sign-in emails at your site.** Go to **Authentication > URL Configuration** and set **Site URL** to your GitHub Pages address from Part A. This makes the confirmation email link back to your app.

**Step 5. Create your account.** Open your site, tap **First time here? Create your account**, and sign up with your email and a password. Click the confirmation link Supabase emails you, then come back and sign in. On that first sign-in, your parks and stamps load in and save to your account.

**Step 6. Lock it to just you.** Go to **Authentication > Sign In / Providers** (on some dashboards, **Authentication > Settings**) and turn off **Allow new users to sign up**. Your data was already private to your account; this also stops anyone else from making an account on your app.

## Part C: Install it on your phone

- **iPhone:** open the site in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the **⋮** menu, then **Install app** or **Add to Home screen**.

Then open Park Log from the new icon and sign in there once. On iPhone, the home-screen app keeps its own sign-in separate from Safari, so you need to sign in inside the app even if you already did in the browser.

## Updating the app later

When you change any file, also open `sw.js` and bump the version at the top (for example `parklog-v1` to `parklog-v2`). Phones pick up the new version the second time you open the app after the update.

## Backups

The footer has **Download a backup** (saves everything as a `.json` file) and **Restore a backup**. It's worth downloading one now and then.
