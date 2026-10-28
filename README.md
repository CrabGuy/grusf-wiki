# GRUSF Wiki

Private wiki of the **Gruppo Universitari San Frediano**: how to host events, what to check before
organising one, the kinds of events we run, and the minutes of our meetings (_verbali_).

It replaces our old DokuWiki with a modern UI (Material Design 3, [Rosé Pine Dawn](https://rosepinetheme.com/)
palette) while **keeping the data in DokuWiki's own format**, so the old content can be imported as-is and
exported back at any time.

- **Frontend**: SvelteKit 3 + Svelte 5, built as a static single-page app and hosted on GitHub Pages.
- **Backend**: Supabase only (serverless): Auth, Postgres, Storage and Edge Functions.
- **Code** is public (MIT). **Content and users** live only in the private Supabase project.

## Features

- Login with **username + password**; no public sign-up.
- Two roles: **members** read and edit everything; **admins** can also manage accounts.
- **Meeting minutes first**: "Scrivi il verbale di oggi" creates a ready-made page
  (`verbali:YYYY-MM-DD`) with the previous meeting's attendees and open to-dos already filled in.
  If the minutes for today already exist, the same button reopens them.
- Editor with toolbar, live preview, automatic list continuation, Tab indent, Ctrl+S / Ctrl+B / Ctrl+I / Ctrl+K,
  **paste or drag images** to upload them, local draft autosave, and edit-conflict detection.
- Full DokuWiki syntax rendering (headings, tables with col/rowspan, lists, links, media, footnotes, code,
  `<note>` boxes...).
- Full-text search (Italian stemming), instant title search (Ctrl+K or `/`), namespace index, recent changes,
  page history with diff and one-click restore.
- Admin page: type names (one per line) and get accounts with readable passwords like `gatto-luna-pane-42`,
  plus a ready-to-paste WhatsApp message for each person. Reset passwords and promote admins in one click.

## How it works

```
Browser (static SvelteKit app on GitHub Pages)
   │  Supabase JS client, user JWT
   ├── Auth ............ username → `<username>@users.grusf.wiki` synthetic e-mail, password
   ├── Postgres ........ profiles (role), pages (index + full-text search), page_changes
   ├── Storage `wiki` .. private bucket = a DokuWiki data/ folder:
   │                       pages/<ns>/<page>.txt     current text
   │                       attic/<ns>/<page>.<rev>.txt.gz   every revision
   │                       meta/<ns>/<page>.changes  DokuWiki changelog
   │                       media/<ns>/<file>         images and attachments
   └── Edge Functions
         wiki  ......... saves a page: writes pages/ + attic/ + meta/ and updates the index
         admin ......... create/reset/delete users, change roles, rebuild the index
```

Security model:

- Every table and the bucket have **Row Level Security**: anonymous visitors can read nothing.
- Logged-in members can read everything and upload media; page writes go through the `wiki` function so
  history is never lost.
- User management uses the service key **inside the edge function only**, after checking the caller is an admin.
- The publishable key in the website is public by design. The secret key stays in your `.env`
  (git-ignored) and in Supabase.

## Set up from scratch

Requirements: Node 22.18+ and a free [Supabase](https://supabase.com) account. Everything else is installed by `npm install`
(including the Supabase CLI).

```bash
git clone https://github.com/<you>/grusf-wiki && cd grusf-wiki
npm install

# 1. Supabase project (or create it from the dashboard)
npx supabase login
npx supabase orgs list
npx supabase projects create grusf-wiki --org-id <org-id> --region eu-central-1 --db-password '<strong password>'
npx supabase link --project-ref <project-ref>

# 2. Database, storage bucket, policies, edge functions, auth settings (sign-ups disabled)
npm run deploy:backend
npm run config:push

# 3. Keys -> .env  (copy .env.example)
npx supabase projects api-keys --project-ref <project-ref>

# 4. First administrator (prints the password)
npm run create-admin -- mario.rossi "Mario Rossi"

# 5. Optional: load the sample content
npm run import:sample

# 6. Run locally
npm run dev
```

### Publish on GitHub Pages

1. Push the repository to GitHub.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
4. Every push to `main` rebuilds the site (`.github/workflows/deploy.yml`).
5. In `supabase/config.toml`, set `site_url` to your Pages URL and run `npm run config:push`.

Optional: to deploy migrations and functions automatically on push, add the variable `SUPABASE_PROJECT_REF`
and the secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` (`.github/workflows/supabase.yml`).

## Importing the real DokuWiki data

Copy the old DokuWiki folder (the one with `data/` and `conf/`) to your PC, then:

```bash
npm run import -- path/to/dokuwiki --dry-run   # just count the files
npm run import -- path/to/dokuwiki             # upload pages, media, history; rebuild the index
npm run import -- path/to/dokuwiki --users     # ...and create accounts from conf/users.auth.php
```

- Pages, media, old revisions (`attic/`) and changelogs (`meta/*.changes`) keep their exact DokuWiki paths.
- With `--users`, bcrypt passwords (the DokuWiki default) are kept, so people log in with their old password.
  Members of the `admin` group become admins. Accounts with older hash formats get a new password, printed at the end.
- Already uploaded files to the bucket by hand (Supabase dashboard → Storage)? Use **Utenti → Ricostruisci l'indice**.

`sample-data/dokuwiki/` shows the expected layout. Its content is made up.

## Backup / export

```bash
npm run export            # -> backup/<date>/data/  (a plain DokuWiki data folder)
```

`backup/` is git-ignored. The content never goes into the repository.

## Development

```bash
npm run dev        # http://localhost:5173
npm run check      # type check
npm run build      # static build in build/
```

| Path | What |
| --- | --- |
| `src/lib/dokuwiki.ts` | DokuWiki markup → safe HTML renderer |
| `src/lib/wiki.svelte.ts` | data access, page index, meeting template |
| `src/lib/components/Editor.svelte` | the editor |
| `src/routes/` | pages: `w/` view, `edit/`, `history/`, `verbali/`, `admin/`, ... |
| `src/app.css` | Material 3 tokens mapped to Rosé Pine Dawn |
| `supabase/migrations/` | schema, RLS policies, storage bucket, search function |
| `supabase/functions/` | `wiki` and `admin` edge functions, shared DokuWiki core |
| `scripts/` | `import`, `export`, `create-admin` |
| `sample-data/dokuwiki/` | example DokuWiki installation (fake content) |

To change texts (e.g. the meeting template), see `meetingTemplate()` in `src/lib/wiki.svelte.ts`.
