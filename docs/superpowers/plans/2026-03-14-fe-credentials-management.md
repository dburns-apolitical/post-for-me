# Frontend Credentials Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the accounts page in the molars-admin-dashboard to manage credentials (add/edit/delete) per account with platform-specific forms for `instagram_direct` and `upload_post`.

**Architecture:** Modify the existing accounts page to simplify the account form (remove credential fields), add expandable credential rows below each account in the table, and inline credential add/edit forms with platform-specific fields.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Radix UI (Select, AlertDialog, Badge), Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-14-fe-credentials-management-design.md`

**Important:** All file paths are in the `molars-admin-dashboard` repo at `/Users/dec/development/molars-admin-dashboard`, NOT in the `post-for-me` repo.

---

## Chunk 1: Type Changes and Account Form Simplification

### Task 1: Update types

**Files:**
- Modify: `/Users/dec/development/molars-admin-dashboard/src/types/dashboard.ts`

- [ ] **Step 1: Add Platform and Credential types, update Account**

Add before the `Account` interface (before line 78):

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

Update the `Account` interface (lines 78-84) to:

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

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/dec/development/molars-admin-dashboard && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/types/dashboard.ts
git commit -m "feat: add Platform, Credential types and update Account interface"
```

---

### Task 2: Simplify the AccountForm component

**Files:**
- Modify: `/Users/dec/development/molars-admin-dashboard/src/pages/accounts.tsx`

- [ ] **Step 1: Simplify AccountFormData and the form**

Update the `AccountFormData` interface (lines 41-46) to:

```typescript
interface AccountFormData {
  name: string;
  gcs_bucket_name: string;
}
```

Update the `useState` initializer (lines 58-63) to:

```typescript
  const [formData, setFormData] = useState<AccountFormData>({
    name: account?.name ?? '',
    gcs_bucket_name: account?.gcs_bucket_name ?? '',
  });
```

Update the `handleSubmit` body (lines 74-81) to only send name and gcs_bucket_name:

```typescript
      const body: Record<string, string> = {
        name: formData.name,
        gcs_bucket_name: formData.gcs_bucket_name,
      };
```

Remove the `if (formData.ig_access_token)` block (lines 79-81).

Update the `isValid` check (lines 102-104) to:

```typescript
  const isValid = formData.name && formData.gcs_bucket_name;
```

Remove the IG Access Token and IG User ID form field `<div>` blocks (lines 126-147) from the JSX. Keep the Name and GCS Bucket Name fields.

- [ ] **Step 2: Update the table columns**

Replace the table header (lines 276-282) with:

```tsx
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">GCS Bucket</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
```

The first column is for the chevron toggle (added in the next task). Remove the IG User ID column.

Update the table body row (lines 285-311) — remove the IG User ID cell (line 288). Add an empty first cell as placeholder for the chevron (will be filled in Task 3):

```tsx
                  <TableRow key={account.id}>
                    <TableCell className="w-10"></TableCell>
                    <TableCell className="font-medium">{account.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{account.gcs_bucket_name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(account)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { setDeleteError(null); setDeletingAccount(account); }}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
```

- [ ] **Step 3: Update the page subtitle**

Change line 241 from:
```tsx
          <p className="text-muted-foreground">Manage Instagram accounts.</p>
```
To:
```tsx
          <p className="text-muted-foreground">Manage accounts and credentials.</p>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/dec/development/molars-admin-dashboard && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/pages/accounts.tsx
git commit -m "feat: simplify account form to name and gcs_bucket_name only"
```

---

## Chunk 2: Expandable Credential Rows and Inline Forms

### Task 3: Add expandable credential rows with chevron toggle

**Files:**
- Modify: `/Users/dec/development/molars-admin-dashboard/src/pages/accounts.tsx`

- [ ] **Step 1: Add new imports**

Update the lucide-react import (line 3) to include chevron icons:

```typescript
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
```

Add Badge import:

```typescript
import { Badge } from '@/components/ui/badge';
```

Add Credential and Platform type imports — update the existing import (line 30):

```typescript
import type { Account, Credential, Platform } from '@/types/dashboard';
```

- [ ] **Step 2: Add credential state variables**

In the `Accounts` component, after the existing state declarations (after line 183), add:

```typescript
  const [expandedAccountId, setExpandedAccountId] = useState<number | null>(null);
  const [addingCredentialForAccountId, setAddingCredentialForAccountId] = useState<number | null>(null);
  const [editingCredentialId, setEditingCredentialId] = useState<number | null>(null);
  const [deletingCredential, setDeletingCredential] = useState<Credential | null>(null);
  const [credentialFormData, setCredentialFormData] = useState<{
    platform: Platform | '';
    ig_access_token: string;
    ig_user_id: string;
    api_key: string;
    user: string;
  }>({ platform: '', ig_access_token: '', ig_user_id: '', api_key: '', user: '' });
  const [isSavingCredential, setIsSavingCredential] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
```

- [ ] **Step 3: Add credential helper functions**

Add after the state declarations:

```typescript
  const resetCredentialForm = () => {
    setAddingCredentialForAccountId(null);
    setEditingCredentialId(null);
    setCredentialFormData({ platform: '', ig_access_token: '', ig_user_id: '', api_key: '', user: '' });
    setCredentialError(null);
  };

  const platformLabel = (platform: Platform) => {
    switch (platform) {
      case 'instagram_direct': return 'Instagram Direct';
      case 'upload_post': return 'Upload Post';
      default: return platform;
    }
  };

  const isCredentialFormValid = () => {
    if (!credentialFormData.platform) return false;
    if (credentialFormData.platform === 'instagram_direct') {
      return credentialFormData.ig_access_token && credentialFormData.ig_user_id;
    }
    if (credentialFormData.platform === 'upload_post') {
      return credentialFormData.api_key && credentialFormData.user;
    }
    return false;
  };

  const handleSaveCredential = async (accountId: number, credentialId?: number) => {
    setIsSavingCredential(true);
    setCredentialError(null);

    try {
      const headers = await getAuthHeaders();
      let credentials: Record<string, string>;

      if (credentialFormData.platform === 'instagram_direct') {
        credentials = {
          ig_access_token: credentialFormData.ig_access_token,
          ig_user_id: credentialFormData.ig_user_id,
        };
      } else {
        credentials = {
          api_key: credentialFormData.api_key,
          user: credentialFormData.user,
        };
      }

      if (credentialId) {
        // Edit existing
        const res = await fetch(`${API_BASE_URL}/api/credentials/${credentialId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ credentials }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? 'Failed to update credential');
        }
      } else {
        // Add new
        const res = await fetch(`${API_BASE_URL}/api/accounts/${accountId}/credentials`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ platform: credentialFormData.platform, credentials }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? 'Failed to add credential');
        }
      }

      resetCredentialForm();
      refetch();
    } catch (err) {
      setCredentialError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSavingCredential(false);
    }
  };

  const handleDeleteCredential = async () => {
    if (!deletingCredential) return;
    setIsDeleting(true);
    setCredentialError(null);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/credentials/${deletingCredential.id}`, {
        method: 'DELETE',
        headers,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to delete credential');
      }

      setDeletingCredential(null);
      refetch();
    } catch (err) {
      setCredentialError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsDeleting(false);
    }
  };
```

- [ ] **Step 4: Update the table body with chevron and expandable rows**

Replace the `accounts.map` block in the TableBody with a React Fragment that renders each account row followed by a conditionally-rendered credential expansion row:

```tsx
                {accounts.map((account) => (
                  <React.Fragment key={account.id}>
                    <TableRow>
                      <TableCell className="w-10">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => {
                            setExpandedAccountId(expandedAccountId === account.id ? null : account.id);
                            resetCredentialForm();
                          }}
                        >
                          {expandedAccountId === account.id ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell className="hidden sm:table-cell">{account.gcs_bucket_name}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(account)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { setDeleteError(null); setDeletingAccount(account); }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {expandedAccountId === account.id && (
                      <TableRow>
                        <TableCell colSpan={4} className="bg-muted/30 p-4">
                          <div className="space-y-3">
                            <h4 className="text-sm font-medium">Credentials</h4>

                            {account.credentials.length === 0 && !addingCredentialForAccountId && (
                              <p className="text-sm text-muted-foreground">No credentials configured.</p>
                            )}

                            {account.credentials.map((cred) => (
                              editingCredentialId === cred.id ? (
                                /* Edit form for this credential */
                                <div key={cred.id} className="space-y-3 rounded-md border p-3">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">{platformLabel(cred.platform)}</Badge>
                                    <span className="text-xs text-muted-foreground">Editing</span>
                                  </div>

                                  {cred.platform === 'instagram_direct' && (
                                    <>
                                      <div className="space-y-1">
                                        <Label className="text-xs">IG Access Token</Label>
                                        <Input
                                          type="password"
                                          placeholder="Enter new access token"
                                          value={credentialFormData.ig_access_token}
                                          onChange={(e) => setCredentialFormData((d) => ({ ...d, ig_access_token: e.target.value }))}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">IG User ID</Label>
                                        <Input
                                          placeholder="Enter new user ID"
                                          value={credentialFormData.ig_user_id}
                                          onChange={(e) => setCredentialFormData((d) => ({ ...d, ig_user_id: e.target.value }))}
                                        />
                                      </div>
                                    </>
                                  )}

                                  {cred.platform === 'upload_post' && (
                                    <>
                                      <div className="space-y-1">
                                        <Label className="text-xs">API Key</Label>
                                        <Input
                                          type="password"
                                          placeholder="Enter new API key"
                                          value={credentialFormData.api_key}
                                          onChange={(e) => setCredentialFormData((d) => ({ ...d, api_key: e.target.value }))}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">User</Label>
                                        <Input
                                          placeholder="Enter new user"
                                          value={credentialFormData.user}
                                          onChange={(e) => setCredentialFormData((d) => ({ ...d, user: e.target.value }))}
                                        />
                                      </div>
                                    </>
                                  )}

                                  {credentialError && <p className="text-xs text-destructive">{credentialError}</p>}

                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      disabled={isSavingCredential || !isCredentialFormValid()}
                                      onClick={() => handleSaveCredential(account.id, cred.id)}
                                    >
                                      {isSavingCredential && <Loader2 className="mr-2 size-3 animate-spin" />}
                                      Save
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={resetCredentialForm} disabled={isSavingCredential}>
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                /* Display row for this credential */
                                <div key={cred.id} className="flex items-center justify-between rounded-md border p-3">
                                  <div className="flex items-center gap-3">
                                    <Badge variant={cred.platform === 'instagram_direct' ? 'default' : 'secondary'}>
                                      {platformLabel(cred.platform)}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {Object.entries(cred.credentials).map(([k, v]) => `${k}: ${v}`).join(', ')}
                                    </span>
                                  </div>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-7"
                                      onClick={() => {
                                        setEditingCredentialId(cred.id);
                                        setAddingCredentialForAccountId(null);
                                        setCredentialFormData({
                                          platform: cred.platform,
                                          ig_access_token: '',
                                          ig_user_id: '',
                                          api_key: '',
                                          user: '',
                                        });
                                        setCredentialError(null);
                                      }}
                                    >
                                      <Pencil className="size-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-7"
                                      onClick={() => {
                                        setCredentialError(null);
                                        setDeletingCredential(cred);
                                      }}
                                    >
                                      <Trash2 className="size-3" />
                                    </Button>
                                  </div>
                                </div>
                              )
                            ))}

                            {/* Add credential form */}
                            {addingCredentialForAccountId === account.id && (
                              <div className="space-y-3 rounded-md border p-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Platform</Label>
                                  <select
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    value={credentialFormData.platform}
                                    onChange={(e) => setCredentialFormData({
                                      platform: e.target.value as Platform | '',
                                      ig_access_token: '',
                                      ig_user_id: '',
                                      api_key: '',
                                      user: '',
                                    })}
                                  >
                                    <option value="">Select platform...</option>
                                    <option value="instagram_direct">Instagram Direct</option>
                                    <option value="upload_post">Upload Post</option>
                                  </select>
                                </div>

                                {credentialFormData.platform === 'instagram_direct' && (
                                  <>
                                    <div className="space-y-1">
                                      <Label className="text-xs">IG Access Token</Label>
                                      <Input
                                        type="password"
                                        placeholder="Enter access token"
                                        value={credentialFormData.ig_access_token}
                                        onChange={(e) => setCredentialFormData((d) => ({ ...d, ig_access_token: e.target.value }))}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">IG User ID</Label>
                                      <Input
                                        placeholder="Enter user ID"
                                        value={credentialFormData.ig_user_id}
                                        onChange={(e) => setCredentialFormData((d) => ({ ...d, ig_user_id: e.target.value }))}
                                      />
                                    </div>
                                  </>
                                )}

                                {credentialFormData.platform === 'upload_post' && (
                                  <>
                                    <div className="space-y-1">
                                      <Label className="text-xs">API Key</Label>
                                      <Input
                                        type="password"
                                        placeholder="Enter API key"
                                        value={credentialFormData.api_key}
                                        onChange={(e) => setCredentialFormData((d) => ({ ...d, api_key: e.target.value }))}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">User</Label>
                                      <Input
                                        placeholder="Enter user"
                                        value={credentialFormData.user}
                                        onChange={(e) => setCredentialFormData((d) => ({ ...d, user: e.target.value }))}
                                      />
                                    </div>
                                  </>
                                )}

                                {credentialError && <p className="text-xs text-destructive">{credentialError}</p>}

                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    disabled={isSavingCredential || !isCredentialFormValid()}
                                    onClick={() => handleSaveCredential(account.id)}
                                  >
                                    {isSavingCredential && <Loader2 className="mr-2 size-3 animate-spin" />}
                                    Save
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={resetCredentialForm} disabled={isSavingCredential}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Add credential button */}
                            {!addingCredentialForAccountId && !editingCredentialId && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setAddingCredentialForAccountId(account.id);
                                  setEditingCredentialId(null);
                                  setCredentialError(null);
                                }}
                              >
                                <Plus className="mr-1 size-3" />
                                Add Credential
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
```

Add React import at the top if not already present:
```typescript
import React, { useState } from 'react';
```

- [ ] **Step 5: Add credential delete AlertDialog**

Add a second `AlertDialog` after the existing account delete dialog (after line 354), before the closing `</div>`:

```tsx
      <AlertDialog
        open={!!deletingCredential}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingCredential(null);
            setCredentialError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this <strong>{deletingCredential ? platformLabel(deletingCredential.platform) : ''}</strong> credential? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {credentialError && (
            <p className="text-sm text-destructive">{credentialError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteCredential();
              }}
              disabled={isDeleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 6: Verify it compiles**

Run: `cd /Users/dec/development/molars-admin-dashboard && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
cd /Users/dec/development/molars-admin-dashboard
git add src/pages/accounts.tsx
git commit -m "feat: add expandable credential rows with inline add/edit/delete forms"
```
