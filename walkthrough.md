# Security Summary

**Reviewed Files**: 14 (`server.ts`, `server/cloudStack.ts`, `firestore.rules`, `firestore.rules.test.ts`, `vite.config.ts`, `index.html`, `public/manifest.json`, `src/App.tsx`, `src/lib/apiClient.ts`, `src/lib/utils.ts`, `src/lib/imageUtils.ts`, `src/context/AuthContext.tsx`, `src/context/StoreContext.tsx`, `src/pages/Coupons.tsx`)
**Issues Resolved**: 2

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Uploaded Media Type Spoofing | `server.ts` | 282 | `/api/media/upload` trusted client `mimeType` headers without checking the decoded binary file signature, allowing non-image text/HTML payloads to be saved with image extensions. | Medium | Fixed | Added server-side binary signature verification requiring valid PNG (`89 50 4E 47`), JPEG (`FF D8 FF`), or WebP (`RIFF....WEBP`) magic bytes before persisting uploads. |
| Unused Build-Time Secret Macro | `vite.config.ts` | 110 | Vite's `define` config referenced `GEMINI_API_KEY` at bundle build time even though `@google/genai` is unused in client code. | Low | Fixed | Removed `loadEnv` and the `define` entry for `process.env.GEMINI_API_KEY` so client bundles never reference server secret keys. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Database Security Rules | `firestore.rules` | Default-deny fallback with strict schema validation (`hasAll`/`hasOnly`), verified-user checks, terminal order state locking, PII isolation, and server timestamp enforcement (`npx eslint firestore.rules` passes cleanly). |
| Admin API Authorization | `server.ts`, `server/cloudStack.ts` | Every `/api/admin/*` route runs `requireAdmin` which verifies Firebase ID tokens via Identity Toolkit REST lookup and confirms verified owner email or `/admins/{uid}` membership (unauthenticated/forged tokens return `401`). |
| Path Traversal & Unknown Routes | `server.ts` | `/uploads` uses `express.static` with explicit `404` catch-alls for missing files and `/api/*`; raw traversal probes (`/uploads/../package.json`, `/uploads/%2e%2e/package.json`) return `404`. |
| Production Client Bundle Secrets | `dist/assets/*.js` | Scanned all built JavaScript bundles and confirmed zero backend credentials (`SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_TOKEN`, `R2_SECRET_ACCESS_KEY`, `GEMINI_API_KEY`) appear in client output. |

## PoC Verification

### 1. Uploaded Media Binary Signature Validation

#### Summary
| Field | Value |
|---|---|
| Issue Type | Uploaded File Content Mismatch |
| Impact | Medium |
| Affected File | `server.ts:282-304` |
| Test Scenario | `POST /api/media/upload` with `mimeType: "image/png"` and base64-encoded `<html>not really a png</html>` payload |

#### How It Was Fixed
Added explicit header byte inspection for PNG (`0x89 0x50 0x4E 0x47`), JPEG (`0xFF 0xD8 0xFF`), and WebP (`RIFF` + `WEBP`) on decoded buffers before calling `cloud.uploadMediaObject`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | JSON body arrives at `POST /api/media/upload` in `server.ts:255` | Parsed with 1 MB Express limit |
| 2 | Base64 payload decodes into `buffer` and passes size check (`server.ts:275-280`) | Enters signature check |
| 3 | `isPng`, `isJpg`, `isWebp` checks inspect leading magic bytes at `server.ts:282-304` | Mismatch returns HTTP `400` JSON error; nothing written to disk or R2 |

#### Conclusion
**Fix Verified** - Forged non-image payloads claiming `image/png`, `image/jpeg`, or `image/webp` are rejected with HTTP `400` before storage, while valid PNG/JPEG/WebP images succeed with HTTP `201`.

### 2. Build-Time Client Macro Exposure Removal

#### Summary
| Field | Value |
|---|---|
| Issue Type | Client Bundle Environment Macro Exposure |
| Impact | Low |
| Affected File | `vite.config.ts:4-112` |
| Test Scenario | Production Vite build inspected across all generated `dist/assets/*.js` bundles |

#### How It Was Fixed
Removed `loadEnv` and the `define: { 'process.env.GEMINI_API_KEY': ... }` injection from `vite.config.ts`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `vite build` evaluates `vite.config.ts` | No `GEMINI_API_KEY` macro defined |
| 2 | Client assets compile to `dist/assets/*.js` | Zero references to backend secret variable names |

#### Conclusion
**Fix Verified** - Private server environment variables remain strictly isolated to Node.js backend execution on `server.ts` and `server/cloudStack.ts`.
