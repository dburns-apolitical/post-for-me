# Frontend Credentials Management Design

## Overview

Update the accounts page in the molars-admin-dashboard frontend to manage credentials per account. Replace the direct credential fields (`ig_access_token`, `ig_user_id`) on the account form with expandable credential rows below each account, supporting both `instagram_direct` and `upload_post` platform types via the new backend credentials API endpoints.

## Type Changes

Update `src/types/dashboard.ts`:

```typescript
export type Platform = 'instagram_direct' | 'upload_post';

export interface Credential {
    id: number;
    account_id: number;
    platform: Platform;
    credentials: Record<string, string>;
    created_at: string;
}
```

Update the `Account` interface to include the credentials array returned by `GET /api/accounts`:

```typescript
export interface Account {
    id: number;
    name: string;
    ig_access_token: string;
    ig_user_id: string;
    gcs_bucket_name: string;
    credentials: Credential[];
}
```

The legacy `ig_access_token` and `ig_user_id` fields remain on `Account` since the backend still returns them, but they are no longer shown or edited in the UI.

## Account Form Simplification

The account add/edit form is simplified from 4 fields to 2:

- `name` (required)
- `gcs_bucket_name` (required)

Remove `ig_access_token` and `ig_user_id` from the form entirely. Credentials are managed separately via the expandable credential rows.

The `AccountFormData` type simplifies to `{ name: string; gcs_bucket_name: string }`. The `handleSubmit` body for both create and edit must only send `{ name, gcs_bucket_name }`.

The table columns become: (chevron toggle), Name, GCS Bucket, Actions. Remove the IG User ID column.

## Expandable Credential Rows

Each account row in the table gets a chevron toggle button (`ChevronRight` when collapsed, `ChevronDown` when expanded, from `lucide-react`). When clicked, a second `<TableRow>` with a single `<TableCell colSpan={N}>` is conditionally rendered below the account row, containing the credential content. Only one account can be expanded at a time. The expanded section shows:

- **List of existing credentials** — each displayed as a row with:
  - Platform badge (`Instagram Direct` / `Upload Post`) using the existing `Badge` component
  - Masked credential values (as returned by the API)
  - Edit button (pencil icon)
  - Delete button (trash icon)
- **"Add Credential" button** at the bottom of the expanded section

When no credentials exist, show "No credentials configured" with the Add button.

Delete uses the existing `AlertDialog` confirmation pattern, consistent with account deletion.

## Inline Credential Forms

### Add Credential

When clicking "Add Credential":
- A form row appears at the bottom of the credentials list
- **Platform selector** — dropdown (`Select` component) with options: `instagram_direct`, `upload_post`
- **Platform-specific fields** appear based on selection:
  - `instagram_direct`: `ig_access_token` (password input), `ig_user_id` (text input)
  - `upload_post`: `api_key` (password input), `user` (text input)
- Save and Cancel buttons

### Edit Credential

When clicking Edit on an existing credential:
- The credential row transforms into the same form layout
- Platform is locked (displayed as text, not a dropdown — platform cannot be changed)
- Fields are empty (user enters new values to replace, since existing values are masked)
- Save and Cancel buttons

### Validation

- All fields required for the selected platform
- Save button disabled until all fields are filled

## API Calls

All API calls use the existing `fetch()` pattern with Neon auth JWT tokens.

- **Add**: `POST /api/accounts/:id/credentials` with body `{ platform, credentials: { ... } }`
- **Edit**: `PATCH /api/credentials/:id` with body `{ credentials: { ... } }`
- **Delete**: `DELETE /api/credentials/:id`
- **Refresh**: After any successful mutation, call `refetch()` from `AccountsContext` to refresh account data (which includes credentials)

No separate credential fetch needed — `GET /api/accounts` already returns credentials joined to each account.

## State Management

New component-level state in `accounts.tsx`:

- `expandedAccountId: number | null` — which account row is expanded
- `addingCredentialForAccountId: number | null` — which account has the add form open
- `editingCredentialId: number | null` — which credential is being edited
- `deletingCredential: Credential | null` — which credential is pending delete confirmation
- `credentialFormData` — form state for the add/edit credential form:
  ```typescript
  interface CredentialFormData {
      platform: Platform | '';
      ig_access_token: string;
      ig_user_id: string;
      api_key: string;
      user: string;
  }
  ```
  All fields present in state; only the relevant ones for the selected platform are shown and sent to the API.
- `isSavingCredential: boolean` — loading state for credential save operations
- `credentialError: string | null` — error message for credential mutations

## Files Changed

All changes in the `molars-admin-dashboard` repo:

- **Modify**: `src/types/dashboard.ts` — add `Platform`, `Credential` types, update `Account`
- **Modify**: `src/pages/accounts.tsx` — simplify account form, add expandable credential rows, inline credential forms, delete confirmation
