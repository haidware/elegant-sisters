# Membergram

Membergram is a multi-group family-tree and photo-catalogue website. Visitors choose a group, view its landing page and family tree, browse member photo catalogues, and scan personal QR codes. An authenticated admin can create groups and member profiles and upload original image files without cropping or recompressing them.

## Set up the app

1. Install dependencies with `npm install`.
2. In the Supabase SQL Editor for your project, run [`supabase/schema.sql`](./supabase/schema.sql).
3. Disable public sign-ups in Supabase Authentication if only invited administrators should have access.
4. The schema adds the existing Supabase Auth user `436c0916-231d-4c13-a8bc-5eec89ae88ee` to the admin allow-list. For another admin, add their Auth UUID in the SQL Editor:

   ```sql
   insert into public.admin_users (user_id)
   values ('AUTH_USER_UUID');
   ```

5. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_ANON_KEY` to the project's Supabase anon/publishable key. The project URL is already filled in. The anon key is intended for browser use; never put a `service_role` key in this app.
6. Start the website with `npm run dev`. Sign in at `/admin` to create groups, then add members and their images to each group.

The database schema enables row-level security. Public visitors can only read published groups, their published member profiles, and their photos; only UUIDs added to `admin_users` can change group/member data or upload to the public `member-photos` bucket.

## Original photo handling

Uploads are stored as the original file bytes in Supabase Storage; the site does not resize, crop, filter, or recompress them. The 50 MB per-file bucket limit is configurable in `supabase/schema.sql` and the Supabase dashboard. The tree and catalogue use `object-fit: contain` so the full image remains visible.

The selected group's family-tree export makes a PNG or an A3 landscape PDF with a personal QR code beneath each member. Each QR code points to `/groups/<group-slug>/members/<member-slug>` on the current site origin, so the public website must be deployed to a URL before printed codes can be scanned by others.

## Commands

- `npm run dev` — local development server
- `npm run build` — TypeScript check and production build
- `npm run lint` — Oxlint
- `npm run preview` — preview the production build
- `npm start` — serve the production build on `PORT` (Railway)
