# Membergram

Membergram is a multi-group family-tree and photo-catalogue website. Visitors choose a group, view its landing page and family tree, browse member photo catalogues, and scan personal QR codes. An authenticated admin can create groups and member profiles and upload original image files without cropping or recompressing them.

## Set up the app

1. Install dependencies with `npm install`.
2. In the Supabase SQL Editor for your project, run [`supabase/schema.sql`](./supabase/schema.sql).
3. Disable public sign-ups in Supabase Authentication if only invited administrators should have access.
4. The schema grants admin access only to the configured Supabase Auth user ID. Ensure that account exists in Authentication → Users in this same project before running the schema. To change the sole admin account, update the UUID seed at the end of `supabase/schema.sql`.

5. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_ANON_KEY` to the project's Supabase anon/publishable key. The project URL is already filled in. The anon key is intended for browser use; never put a `service_role` key in this app.
6. Start the website with `npm run dev`. The root URL (`/`) is the admin login. Use `/groups` to browse published groups; each group is available at `/<group-slug>`, with member catalogues at `/<group-slug>/<member-slug>`.

The database schema enables row-level security. Public visitors can only read published groups, their published member profiles, and their photos; only UUIDs added to `admin_users` can change group/member data or upload to the public `member-photos` bucket.

## Original photo handling

Uploads are stored as the original file bytes in Supabase Storage; the site does not resize, crop, filter, or recompress them. The 50 MB per-file bucket limit is configurable in `supabase/schema.sql` and the Supabase dashboard. The tree and catalogue use `object-fit: contain` so the full image remains visible.

The selected group's family-tree export makes a PNG or an A3 landscape PDF with a personal QR code beneath each member. Each QR code points to `/<group-slug>/<member-slug>` on the current site origin, so the public website must be deployed to a URL before printed codes can be scanned by others. Group slugs `admin`, `assets`, and `groups` are reserved.

## Commands

- `npm run dev` — local development server
- `npm run build` — TypeScript check and production build
- `npm run lint` — Oxlint
- `npm run preview` — preview the production build
- `npm start` — serve the production build on `PORT` (Railway)
