# Studio Cloud (V2) — accounts, cloud projects, working together

Studio Cloud adds sign-in (email link or Google), cloud-saved projects, sharing by email
(can edit / can view) and live updates when a collaborator saves. It runs on a **free
Supabase project** — no server of our own and no monthly cost on the free plan.

What goes to the cloud: the project itself (layers, keyframes, text, settings — usually a
few KB). What stays on each device: imported video, audio and images. A collaborator sees
a placeholder for media until they import the same file. This keeps the free plan's
storage untouched.

Try it without any setup: **Cloud → Try the demo (this browser only)**. The demo keeps
everything in this browser; two tabs can sign in as two people to try sharing.

## One-time setup (about 10 minutes)

The app is published at `https://asifkhan1308.github.io/asifkhan1308/app/` (GitHub Pages).
Use your own address below if it differs.

1. **Create the project.** Sign in at [supabase.com](https://supabase.com) → *New project*
   (Free plan). Name it `kaatchat`, region **South Asia (Mumbai)**, any database password.
2. **Create the tables.** Supabase → *SQL Editor* → *New query* → paste the whole of
   [`supabase/migrations/20261023000000_studio_cloud.sql`](../supabase/migrations/20261023000000_studio_cloud.sql)
   → *Run*. (Safe to run again.)
3. **Allow the app's address.** Supabase → *Authentication* → *URL Configuration*:
   - *Site URL*: `https://asifkhan1308.github.io/asifkhan1308/app/`
   - *Redirect URLs*: add `https://asifkhan1308.github.io/asifkhan1308/app/**`
     (and `http://localhost:5173/**` for local development).
   Email-link sign-in is on by default.
4. **Google sign-in (optional).**
   - [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services* → *OAuth consent screen*:
     External, app name *Kaatchat*, your email → save.
   - *Credentials* → *Create credentials* → *OAuth client ID* → *Web application*.
     *Authorized redirect URI*: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (shown in Supabase → *Authentication* → *Providers* → *Google*).
   - Copy the client ID and secret into Supabase → *Authentication* → *Providers* → *Google* → enable → save.
5. **Connect the app.** Supabase → *Project Settings* → *API*: copy the **Project URL** and
   the **publishable key** (`sb_publishable_…`, or the legacy *anon* key). Never use the
   *secret* / *service_role* key — the app refuses it.
   - For everyone: GitHub → repository → *Settings* → *Secrets and variables* → *Actions* →
     *Variables* → add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, then re-run the
     *Kaatchat Pages* workflow. The published app is connected from then on.
   - Or just for you, right away: open Studio → **Cloud** → paste both → *Connect*.

## Using it

- **Cloud** (top bar) → sign in → **Save to cloud**. A ● on the button means the open
  project is in the cloud; **⌘S** then saves to the cloud (and keeps a local copy).
- **Share**: in the Cloud dialog, enter an email and choose *Can edit* or *Can view*. They
  sign in with that email and find it under *Cloud projects*.
- **Live**: when someone saves, everyone with the project open gets it — instantly if they
  have no unsaved changes, otherwise a banner offers *Load theirs*.
- **Who's here**: the top bar shows who else has the same cloud project open right now.
- **Conflicts**: if someone saved after you opened the project, your save is refused (nothing
  is lost) and you choose *Load theirs* or *Overwrite with mine*.

## Security

- Access is enforced by the database (row-level security), not by the app: people only
  ever see projects they own or that were shared with their email; viewers can't save;
  only owners can share or delete. Save times and authors are stamped by the server.
- The project URL and publishable key are public by design; they can only do what the
  policies allow.
- Projects are limited to 2 MB of JSON.
- "Who's here" uses a Realtime presence channel named by the project's random id; it shares only
  the email of people who have that project open.

## Free plan limits worth knowing

- 50,000 monthly active users, 500 MB database (thousands of projects).
- A free project **pauses after 7 days without any activity**; open the Supabase dashboard
  and press *Restore* (data is kept). Any sign-in or save counts as activity.
- Supabase's built-in email sender is rate-limited (a few sign-in emails per hour). For more,
  add your own SMTP (e.g. a free Resend or Brevo account) under *Authentication* → *Emails*.

## Not in V2 yet

- Media sync between devices (would need paid storage).
- Simultaneous editing of the same layer with live cursors: saves are shared live, edits merge
  at the project level (last save wins after the conflict prompt).
