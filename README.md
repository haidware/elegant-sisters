# Membergram

Membergram is a multi-group family-tree and photo-catalogue website. Visitors choose a group, view its landing page and family tree, browse member photo and video catalogues, and scan personal QR codes. The sole administrator signs in with Railway-configured superuser credentials and can create groups and member profiles with a separate tree portrait, up to 10 catalogue photos, and one video.

## Set up the app

1. Install dependencies with `npm install`.
2. In the Supabase SQL Editor for your project, run the latest [`supabase/schema.sql`](./supabase/schema.sql). Re-run it after schema updates to add new database fields.
3. In Railway, configure `SUPER_USER_NAME` and `SUPER_USER_PASS_KEY` with the sole admin login credentials. Add `SUPABASE_SERVICE_ROLE_KEY` from the Supabase project's API settings. The server uses `SUPABASE_URL` if set, otherwise the existing `VITE_SUPABASE_URL`. These are server-only secrets: never prefix them with `VITE_` or expose them in client code. The service role key is required for authenticated admin operations and must remain private.
4. Copy `.env.example` to `.env.local` and set the Supabase anon key and server-only values for local development. The example already contains the project URL. The anon key is public; do not use the service role key in the browser.
5. To develop locally, start the API with `npm run dev:api` in one terminal and the website with `npm run dev` in another. The root URL (`/`) is the admin login. Use `/groups` to browse published groups; each group is available at `/<group-slug>`, with member catalogues at `/<group-slug>/<member-slug>`.

The database schema enables row-level security and grants browser clients read access only to published groups, members, and catalogue media. Admin writes go through the Railway server, which authenticates the Railway superuser credentials and uses the server-only Supabase service role key.

## Member media

The tree portrait is uploaded separately from the member's catalogue. Catalogue uploads support up to 10 images (50 MB each) and one video up to 3 minutes (50 MB). New members stay hidden until the selected media finishes uploading. Files are stored as their original bytes; images are not resized, cropped, filtered, or recompressed. The Supabase bucket limit is 50 MB per file and is configured in `supabase/schema.sql`; the Supabase project must allow that limit. The tree and catalogue use `object-fit: contain` so the full image remains visible, and catalogue media can be expanded for viewing.

The public family tree and shared poster arrange each member's static tree portrait, rank, name, and role in centered tiers around the group's name. A member's separate portrait upload is used for this tree layout.

The selected group's family-tree export makes a PNG or an A3 landscape PDF with a personal QR code beneath each member. Each QR code points to `/<group-slug>/<member-slug>` on the current site origin, so the public website must be deployed to a URL before printed codes can be scanned by others. Group slugs `admin`, `assets`, and `groups` are reserved.

## Group size and tree ranks

When creating a group, enter its planned number of members. For existing groups, update the planned size in the admin form. Assign each member a unique tree rank from 1 through that total; the next unused rank is suggested automatically. Ranks determine the member order and number shown in the public tree, preview poster, and downloadable image/PDF. The admin member list shows progress against the planned group size.

## Group links and QR codes

Each group's public page is available at `/<group-slug>`. The admin dashboard lists each group's full URL and generates a downloadable QR code for that URL; scanning it opens the group's tree and uploaded member catalogues. Links and QR codes use the current site origin, so production codes should be downloaded from the deployed site.

## Commands

- `npm run dev` — local development server
- `npm run build` — TypeScript check and production build
- `npm run lint` — Oxlint
- `npm run preview` — preview the production build
- `npm start` — serve the production build on `PORT` (Railway)
