# Security Specification & Threat Model — FreshVeggie Delivery

## 1. Data Invariants & Trust Boundaries
1. **Default Deny**: Any unmatched collection path is strictly denied (`match /{document=**} { allow read, write: if false; }`).
2. **Verified Identity**: All authenticated writes require `request.auth != null && (request.auth.token.email_verified == true || request.auth.token.phone_number != null)`.
3. **Admin Privilege Integrity**: Users cannot self-assign admin status in `/users/{userId}` or `/admins/{uid}`. Admin rights come exclusively from the bootstrapped verified admin email (`harshulsingh1999@gmail.com` with `email_verified == true`) or pre-existing `/admins/{uid}` documents created by an existing admin.
4. **Partner Approval Gate**: A newly registered delivery partner creates `/deliveryPartners/{uid}` with `isApproved == false`, `completedDeliveries == 0`, and `settledCash == 0`. Only an Admin can set `isApproved: true`. Unapproved partners cannot accept or update orders.
5. **PII Isolation**: Customer `/users/{userId}` documents (phone, email, addresses) are readable ONLY by the document owner (`uid == request.auth.uid`) or an Admin. Public delivery queue visibility uses `/dispatchFeed/{orderId}` which contains zero customer PII (no name, phone, userId, or street).
6. **Order & Dispatch Atomicity**: Order creation by an unblocked customer atomically writes both `/orders/{orderId}` and `/dispatchFeed/{orderId}` (`existsAfter` verified). Initial status MUST be `'placed'`, `assignedToUid` MUST be `""`, and timestamps MUST equal `request.time`.
7. **Terminal State Locking**: Once an order reaches `'delivered'` or `'cancelled'`, non-admins cannot mutate it. Once a complaint reaches `'resolved'`, it cannot be reopened or mutated except by admin override if needed.
8. **Query Enforcer (No Blanket Reads / Zero `get()` in `allow list`)**: Every `allow list` rule evaluates `resource.data` or auth token claims directly—zero `get()` or `exists()` lookups inside `allow list`.
9. **Ephemeral Live GPS Isolation (`/active_deliveries/{orderId}`)**: Only the owning customer, assigned approved partner, or admin may read live GPS coordinates. Only the assigned partner or admin may update coordinates, and the temporary doc is deleted atomically upon delivery/cancellation.
10. **Immutable Financial Ledger (`/walletLedger/{entryId}`)**: Ledger entries are append-only (`allow update: if false`), and partner credits require an atomic matching order delivery or `settledCash` batch increment.
11. **Admin-Only Schedule & Manual History Deletion (`/deliverySlots/{slotId}` & `/api/admin/orders/delete-history`)**: Only verified Admins can create, edit, pause, or delete delivery slot schedules, and historical order cleanup is strictly manual with zero automated deletion timers.

---

## 2. The "Dirty Dozen" Attack Payloads
1. **Self-Assigned Admin Shadow Field** (`/users/{uid}` create): Includes `"role": "admin"` or `"isAdmin": true` -> **DENIED** by strict `keys().hasOnly(...)`.
2. **Pre-Blocked Bypass on Registration** (`/users/{uid}` create): Customer creates profile with `"isBlocked": true` or updates own `"isBlocked": false` -> **DENIED** by `incoming().isBlocked == false` on create and `affectedKeys().hasOnly(['name', 'phone', 'addresses', 'updatedAt'])` on update.
3. **Unverified Email Spoofing** (Admin or User write): Token has admin email with `email_verified: false` and no verified phone -> **DENIED** by `isBootstrappedAdmin()` (`email_verified == true`) and `isVerifiedUser()`.
4. **PII Blanket Read Attempt** (`/users/{otherUid}` get or `/users` list): Authenticated non-admin attempts to read another customer's profile or list all users -> **DENIED**.
5. **Cross-User Order Spoofing** (`/orders/{orderId}` create): Attacker sets `userId: "victim_uid"` while authenticated as `"attacker_uid"` -> **DENIED** by `incoming().userId == request.auth.uid`.
6. **Partner Self-Approval Attack** (`/deliveryPartners/{uid}` create/update): Driver submits registration with `isApproved: true` or updates `isApproved` from `false` to `true` -> **DENIED**.
7. **Unassigned Order Theft by Non-Partner** (`/orders/{orderId}` update): Normal customer tries to assign an unassigned order to themselves (`assignedToUid: customerUid`) -> **DENIED** by `isApprovedPartner()` check.
8. **Delivered Order Tampering (Terminal State Bypass)** (`/orders/{orderId}` update): Driver tries to modify `total` or revert `status` from `'delivered'` back to `'placed'` -> **DENIED** by terminal state lock + `affectedKeys().hasOnly(...)`.
9. **Client Timestamp Forgery** (`/orders/{orderId}` or `/products/{id}` create): Payload passes backdated `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> **DENIED**.
10. **ID Poisoning / Resource Exhaustion** (`/products/{badId}`): Document ID has spaces/slashes or 1KB length, or `description` exceeds 1000 chars -> **DENIED** by `isValidId()` and `.size()` guards.
11. **Customer Deleting/Mutating Catalog Pricing** (`/products/{id}` update/delete): Customer attempts to set `pricePerKg: 1` -> **DENIED** by `isAdmin()`.
12. **Complaint Status & Victim Spoofing** (`/complaints/{id}` create): Attacker files complaint with `status: "resolved"` and `userId: "other_uid"` -> **DENIED** by `incoming().userId == request.auth.uid && incoming().status == 'open'`.
13. **Cross-Customer GPS Tracking Snoop** (`/active_deliveries/{orderId}` get): Unrelated `customerA` tries to read `customerB`'s live rider coordinates -> **DENIED**.
14. **Arbitrary Rider Wallet Credit Minting** (`/walletLedger/{entryId}` create/update): Rider attempts to create a ₹9999 `trip_credit` without a matching delivered order, or mutate an existing ledger entry -> **DENIED**.

