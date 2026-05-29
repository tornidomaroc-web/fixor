# Fixor local scan report

- Scanned path: `D:\RAGHAD JAD\Fixor\fixtures\real-shape\fastapi-saas`
- Total files scanned: 7
- Files with findings: 3
- Total findings: 5
- Severity breakdown: critical=5, high=0, medium=0

## app\routers\admin.py

### auth_bypass_risk — critical (confidence: high)

- File: `app\routers\admin.py`:14
- Description: The `/stats` route that triggered the review is properly guarded via `dependencies=[Depends(get_current_active_superuser)]`, but the sibling route `POST /users/{user_id}/role` — which performs a highly sensitive admin action (changing a user's role and potentially granting superuser privileges) — has NO authentication or authorization dependency. `CurrentUser` is injected as a parameter but is never used for any authorization decision in the handler body; it does not gate the action or verify the caller is a superuser.
- Why it matters: The `/stats` route that triggered the review is properly guarded via `dependencies=[Depends(get_current_active_superuser)]`, but the sibling route `POST /users/{user_id}/role` — which performs a highly sensitive admin action (changing a user's role and potentially granting superuser privileges) — has NO authentication or authorization dependency. `CurrentUser` is injected as a parameter but is never used for any authorization decision in the handler body; it does not gate the action or verify the caller is a superuser.
- Suggested fix: 

```

from app.auth import CurrentUser, get_current_active_superuser
from app.db import get_session
```

### idor_risk — critical (confidence: high)

- File: `app\routers\admin.py`:28
- Description: The `set_user_role` endpoint at `POST /users/{user_id}/role` is located in `admin.py` but — critically — has **no admin gate**: it only depends on `CurrentUser` (a generic authenticated-user dependency), not `get_current_active_superuser` (which is used on the `/stats` route above it). Any authenticated user can supply an arbitrary `user_id`, which flows directly into `session.get(User, user_id)` with no ownership filter and no post-fetch authorization check, allowing them to escalate any account's role to admin.
- Why it matters: The `set_user_role` endpoint at `POST /users/{user_id}/role` is located in `admin.py` but — critically — has **no admin gate**: it only depends on `CurrentUser` (a generic authenticated-user dependency), not `get_current_active_superuser` (which is used on the `/stats` route above it). Any authenticated user can supply an arbitrary `user_id`, which flows directly into `session.get(User, user_id)` with no ownership filter and no post-fetch authorization check, allowing them to escalate any account's role to admin.
- Suggested fix: 

```

@router.post("/users/{user_id}/role")
def set_user_role(
```

---

## app\routers\items.py

### idor_risk — critical (confidence: high)

- File: `app\routers\items.py`:30
- Description: The request-derived `item_id` flows directly into `session.get(Item, item_id)` with no ownership filter in the query and no post-fetch ownership check (e.g., `if item.owner_id != current_user.id`). The `Item` model has an `owner_id` field (evidenced by its use in `list_own_items`), confirming this is an owned resource, yet any authenticated user can read any item by guessing its ID.
- Why it matters: The request-derived `item_id` flows directly into `session.get(Item, item_id)` with no ownership filter in the query and no post-fetch ownership check (e.g., `if item.owner_id != current_user.id`). The `Item` model has an `owner_id` field (evidenced by its use in `list_own_items`), confirming this is an owned resource, yet any authenticated user can read any item by guessing its ID.
- Suggested fix: 

```


@router.get("/{item_id}")
```

---

## app\routers\users.py

### admin_check_risk — critical (confidence: high)

- File: `app\routers\users.py`:14
- Description: The `DELETE /{user_id}` route allows deletion of any arbitrary user by ID, but has no authentication dependency (no `CurrentUser`, no admin-suggesting `Depends`) and no inline admin/role check — any unauthenticated or non-admin caller can delete any user. Meanwhile, sibling routes (`/me` GET and PATCH) use `CurrentUser` for authentication, making this omission stand out as a missing admin gate on a clearly destructive, privileged operation.
- Why it matters: The `DELETE /{user_id}` route allows deletion of any arbitrary user by ID, but has no authentication dependency (no `CurrentUser`, no admin-suggesting `Depends`) and no inline admin/role check — any unauthenticated or non-admin caller can delete any user. Meanwhile, sibling routes (`/me` GET and PATCH) use `CurrentUser` for authentication, making this omission stand out as a missing admin gate on a clearly destructive, privileged operation.
- Suggested fix: 

```

from app.auth import CurrentUser
from app.db import get_session
```

### idor_risk — critical (confidence: high)

- File: `app\routers\users.py`:37
- Description: The request-derived `user_id` flows directly into `session.get(User, user_id)` with no ownership filter in the query and no post-fetch ownership check (e.g., comparing `user.id` to the authenticated `current_user.id`). The handler has no authentication dependency at all — `CurrentUser` is imported but not used as a parameter in `delete_user` — meaning any unauthenticated or authenticated caller can delete any user record by supplying an arbitrary `user_id`.
- Why it matters: The request-derived `user_id` flows directly into `session.get(User, user_id)` with no ownership filter in the query and no post-fetch ownership check (e.g., comparing `user.id` to the authenticated `current_user.id`). The handler has no authentication dependency at all — `CurrentUser` is imported but not used as a parameter in `delete_user` — meaning any unauthenticated or authenticated caller can delete any user record by supplying an arbitrary `user_id`.
- Suggested fix: 

```
    return current_user


```

---
