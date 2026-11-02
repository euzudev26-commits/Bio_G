# First administrator setup

The database and correction Edge Function are already deployed, but no Auth users have been created yet.

## 1. Create the initial Auth user

In Supabase Dashboard for project `qwjxoncytsiioexwllky`:

1. Open **Authentication → Users**.
2. Select **Add user**.
3. Create the administrator account using the company's intended email address and a strong temporary password.
4. Confirm that the user appears in the Auth users list.

## 2. Assign the trusted admin role

Open **SQL Editor** and run the following, replacing the email placeholder with the same address used in step 1:

```sql
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'admin')
where lower(email) = lower('REPLACE-WITH-ADMIN-EMAIL')
returning id, email, raw_app_meta_data;
```

Confirm exactly one row is returned and that `raw_app_meta_data` contains `"role": "admin"`.

This writes the trusted `app_metadata` claim. Do not use `raw_user_meta_data` / `user_metadata` for role authorization because users can edit their own user metadata.

## 3. Sign in

Copy `.env.example` to `.env.local`, run `npm install`, then `npm run dev`. Sign in with the administrator credentials created in step 1.

If the user was already signed in before the role was assigned, sign out and sign in again to refresh the JWT claim.

## Important

- Do not share the administrator password in a chat or commit it into the project.
- Do not expose a Supabase secret/service-role key in the browser.
- The employee onboarding UI is not yet implemented. Employee accounts require `app_metadata.role = 'employee'` and an employee row linked via `auth_user_id`.
