# Push notifications — FCM (Android) + APNs (iOS)

**Status: implemented end to end, wired to every in-app notification fan-out, credential-gated.**
Without credentials the system is a logged no-op: in-app inbox, real-time socket
delivery and badges keep working exactly as before. With credentials, every
`notifyUsers(...)` call also fans out a push to each registered device.

---

## 1. What exists

### Backend (`backend/src/modules/notifications/`)

| File | What it is |
| --- | --- |
| `push-token.model.ts` | `PushToken` collection — one row per (device, app install). Fields: `userId`, `token` (unique), `platform` (`ANDROID` \| `IOS`), `deviceId`, `deviceName`, `appVersion`, `lastSeenAt`. Not tenant-scoped, not soft-deleted. |
| `push-token.routes.ts` | `userPushTokenRouter` at `/api/v1/user/push-tokens`: `POST /` (register/refresh, idempotent upsert by token), `POST /remove` (scoped to caller), `GET /health` (transport status, no secrets). All four roles may register. |
| `push.service.ts` | `sendPushToUsers(userIds, {title, body, data})`. FCM HTTP v1 (OAuth2 service-account JWT, cached) + APNs HTTP/2 (ES256 `.p8` JWT). Purges unregistered tokens. Never throws into the caller. |
| `notify.service.ts` | `notifyUsers` now calls `sendPushToUsers(...)` after the inbox insert. Every existing call site (visitors, deliveries, approvals, panics, chat, complaints, …) therefore fans out automatically. |
| `notification.routes.ts` | In-app inbox + unread count (unchanged). The same `Notification` documents drive both inbox and push. |

### Environment (`.env`)

```ini
# --- Option A: discrete service account values ---
FCM_PROJECT_ID=your-firebase-project-id
FCM_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-firebase-project-id.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"

# --- Option B: whole service account JSON as one string ---
FCM_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}

# --- Optional: iOS direct APNs (preferred when set) ---
APNS_TEAM_ID=YOUR_APPLE_TEAM_ID
APNS_KEY_ID=YOUR_APNS_KEY_ID
APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----\n"
APNS_BUNDLE_ID=com.habitoliving.habito
APNS_USE_SANDBOX=true        # false for App Store / TestFlight builds
PUSH_STRICT=false            # true → throw on misconfigured push (fail fast)
```

`FCM_SERVICE_ACCOUNT_JSON` overrides the discrete FCM values when both are set.
Private keys may be pasted with literal `\n` newlines — the env parser converts
them. Never commit any of these values.

### Mobile client (`habitoliving/`)

| Piece | Where |
| --- | --- |
| `PushService` (singleton, `ChangeNotifier`) | `lib/services/push_service.dart` — FCM init, permission prompt, Android channels (`habito_general`, `habito_emergency`), token register/remove, `enable()`/`disable()`, `ChangeNotifier` so the settings switch reacts. |
| Token API client | `lib/services/api/files_api.dart` → `PushTokenApi.register / remove / health` against the routes above. |
| Routing on tap | `NotificationRouter.open(context, data)` (`lib/services/notification_router.dart`) resolves `data['route']` (e.g. `/invoices/678…` or `/complaints`) to a screen or a shell tab; falls back to the inbox. Tap handler is registered in `HabitoApp` (`lib/app.dart`) against a `navigatorKey`. |
| Settings switch | `lib/screens/settings_screen.dart` → notification toggle → `PushService.enable/disable`. |
| Auth gate | `lib/screens/auth_gate.dart` — push is initialised before routing; registering happens only once authenticated. |

Android manifest already declares `INTERNET`, `CAMERA` and photo read permissions;
`android/app/build.gradle.kts` applies `com.google.gms.google-services` **only if**
`android/app/google-services.json` exists, so the build never fails for lack of it.

---

## 2. One-time setup — Firebase (Android + iOS via FCM)

1. Firebase console → project **habito-living** (or create one) → add an
   **Android app** with package name `com.habitoliving.habito`.
2. Download `google-services.json`, drop it at
   `habitoliving/android/app/google-services.json`. That is the whole Android
   credential — nothing else is needed on the device side.
3. For iOS-via-FCM (simplest, no APNs direct):
   - Add an **iOS app** in the same Firebase project with bundle ID
     `com.habitoliving.habito`; download `GoogleService-Info.plist`.
   - Drop it at `habitoliving/ios/Runner/GoogleService-Info.plist`.
   - In Firebase → Project settings → Cloud Messaging → **Apple app configuration**,
     upload the APNs Auth Key (`.p8`) — see §3. Until this is done, iOS pushes
     silently fail while everything else works.
4. Service account for the backend: Firebase → Project settings → Service
   accounts → **Generate new private key**. Put the JSON contents in
   `FCM_SERVICE_ACCOUNT_JSON` (or the three discrete values).
5. Restart the backend. `GET /api/v1/user/push-tokens/health` (as any signed-in
   user) should report `fcmEnabled: true`.

## 3. One-time setup — APNs direct (optional, recommended for production iOS)

1. Apple Developer → Identifiers → register `com.habitoliving.habito`.
2. Apple Developer → Keys → **App Store Connect**/push key → create an **APNs Auth Key** → download the `.p8` file (shown once).
3. Note the **Key ID** and your **Team ID**.
4. Put them in the backend `.env` (`APNS_*` above). `APNS_USE_SANDBOX=true` for
   Xcode/dev installs; `false` for release.
5. `GET /api/v1/user/push-tokens/health` should report `apnsEnabled: true`
   and `iosVia: "apns"`.

> If both FCM and APNs are configured, iOS goes direct APNs (`iosVia: "apns"`),
> Android goes FCM. If only FCM is configured, both go through FCM (requires the
> APNs key uploaded in step 3 of §2).

## 4. Payload contract

The backend sends:

```json
{
  "notification": { "title": "Visitor at your door", "body": "…" },
  "data": { "type": "VISITOR", "route": "/visitors/abc123", "entityId": "abc123" }
}
```

`data` is always a string map. The client reads `route` (falling back to
`link`/`deeplink`), strips a leading role segment (`/user/...`), and routes:
exact-match handlers per role (registered by each shell via
`NotificationRouter.register(...)`), then shell tab sections (`invoices →
Payments tab`, `alerts → Alerts tab`), then the notifications inbox as the
universal fallback. Unknown routes never crash — they land in the inbox.

Suggested route names (already routed in the app): `/invoices`, `/payments`,
`/visitors`, `/complaints`, `/notices`, `/deliveries`, `/bookings`, `/amenities`,
`/marketplace`, `/property`, `/chat`, `/vehicles`, `/documents`, `/emergency`,
`/settings`.

## 5. Verification checklist

- [ ] `GET /api/v1/user/push-tokens/health` → `{ fcmEnabled: true, apnsEnabled: false|true, iosVia: … }`.
- [ ] Sign in on a real device or emulator; Settings → Notifications toggle shows "on".
- [ ] Backend log shows `push_tokens_purged` = 0 and no `push_disabled` warning.
- [ ] Trigger a notification (e.g. guard registers a visitor for your flat) → push arrives in <5 s.
- [ ] Kill the app → push arrives with sound; tap → opens the right screen.
- [ ] Disable notifications in Settings → device row removed (`POST /user/push-tokens/remove`) → no further push.
- [ ] Sign out → same removal call; sign in as another user on the same device → token re-pointed at the new user.

## 6. Failure behaviour (deliberate)

- Unregistered/dead tokens are deleted (`PushToken.deleteMany`) — no retry storms.
- Push failures are logged (`push_partial_failure`) and never fail the request
  or the inbox write that triggered them.
- Strict mode (`PUSH_STRICT=true`) is reserved for future use; nothing currently throws.
- No credentials → `push_disabled` logged once per process; everything else identical.
