# Kaatchat website

Static, self-contained marketing site: `index.html`, `site.css`, `site.js`, bundled fonts, real screenshots. No build step, no external requests.

Deploy the folder to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages). Keep it separate from the editor (e.g. `kaatchat.com` for the site, `app.kaatchat.com` for the editor).

Two settings, both in `config.js` / `release.json`:

- `appUrl`: the deployed web editor. Empty → the “Open the web app” buttons stay hidden.
- `release.json`: `windowsUrl`, `sha256`, `size`, `signed` of the GitHub Release installer. Empty → the download button stays hidden and the page explains where releases come from.

Screenshots in `assets/` are captured from the real app.
