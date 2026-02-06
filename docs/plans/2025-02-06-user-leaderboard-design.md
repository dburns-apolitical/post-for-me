# User Leaderboard Design

## Overview

Track which dashboard user posted each reel and expose leaderboard data via the stats endpoint.

## Database Schema

### New table: `user_posts`

```sql
CREATE TABLE user_posts (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    user_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(post_id)
);

CREATE INDEX idx_user_posts_user_id ON user_posts(user_id);
```

- `user_id` references `neon_auth.user(id)` (UUID from JWT)
- `user_name` denormalized from JWT `name` field for fast queries
- One user per post (UNIQUE constraint)
- CASCADE delete when post is deleted

## API Changes

### GET /api/stats

**New response fields:**

```typescript
{
  // ... existing fields

  userLeaderboard: [
    { name: "Molars", posts: 45 },
    { name: "John", posts: 32 }
  ],

  userViewsPerVideo: [
    { name: "Molars", viewsPerVideo: 12500 },
    { name: "John", viewsPerVideo: 9800 }
  ]
}
```

**Queries:**

```sql
-- userLeaderboard
SELECT user_name as name, COUNT(*) as posts
FROM user_posts up
JOIN posts p ON up.post_id = p.id
WHERE ($1::int IS NULL OR p.account_id = $1)
GROUP BY user_name
ORDER BY posts DESC

-- userViewsPerVideo
SELECT up.user_name as name, ROUND(AVG(p.views)) as viewsPerVideo
FROM user_posts up
JOIN posts p ON up.post_id = p.id
WHERE p.views IS NOT NULL
  AND ($1::int IS NULL OR p.account_id = $1)
GROUP BY up.user_name
ORDER BY viewsPerVideo DESC
```

## Implementation Details

### Auth Changes

Add `userName` to `validateAuth` return type:

```typescript
interface AuthResult {
  authenticated: boolean;
  isAdmin: boolean;
  method: 'jwt' | 'password';
  userId?: string;
  userName?: string;  // NEW - from JWT 'name' field
}
```

### Post-Reel Flow

After `markPostSuccess`, if JWT auth was used:

```typescript
if (authResult.method === 'jwt' && authResult.userId && authResult.userName) {
    await db.createUserPost(post.id, authResult.userId, authResult.userName);
}
```

### New DatabaseService Method

```typescript
async createUserPost(postId: number, userId: string, userName: string): Promise<void> {
    await this.sql`
        INSERT INTO user_posts (post_id, user_id, user_name)
        VALUES (${postId}, ${userId}, ${userName})
    `;
}
```

## Edge Cases

- **Historical posts:** No `user_posts` entries - won't appear on leaderboard
- **Password auth posts:** No user to track - skip `user_posts` insert
- **User name changes:** Old posts keep the name at time of posting
- **Deleted posts:** CASCADE removes `user_posts` row

## Types

```typescript
interface UserLeaderboardEntry {
    name: string;
    posts: number;
}

interface UserViewsEntry {
    name: string;
    viewsPerVideo: number;
}
```
