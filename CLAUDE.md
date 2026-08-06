# CLAUDE.md

เอกสารนี้สรุปสถาปัตยกรรมและการตัดสินใจทางเทคนิคของโปรเจกต์นี้ สำหรับ Claude Code (หรือผู้พัฒนา)
ที่จะเข้ามาทำงานต่อในอนาคต อ่านไฟล์นี้ก่อนแก้ไขโค้ด เพื่อเข้าใจว่าทำไมโค้ดถึงถูกออกแบบแบบนี้

## ภาพรวมโปรเจกต์

โปรเจกต์ตัวอย่างเพื่อการเรียนรู้ (learning example) ของระบบ Login ที่มี:

- **RBAC** (Role-Based Access Control) 3 role: `admin`, `manager`, `user`
- **บังคับ 2FA (TOTP) กับทุก user** — ไม่มี path ใดในระบบที่ทำให้ login สำเร็จได้โดยไม่ผ่าน 2FA
- ระบบบริหารจัดการ user (สร้าง/แก้ role/ปิดใช้งาน/reset password/reset 2FA) โดย admin
- รันทั้งหมดผ่าน Docker Compose (PostgreSQL + Express backend + Svelte frontend)

Stack: **Svelte 4 + Vite** (frontend) / **Node.js + Express** (backend) / **PostgreSQL 16** (database)

ดู [README.md](README.md) สำหรับคำอธิบายขั้นตอนการทำงานแบบละเอียด (ใช้เป็นแหล่งเรียนรู้) และวิธีรัน

## สถาปัตยกรรม

```
docker-compose.yml
├── postgres   (postgres:16-alpine, มี healthcheck)
├── backend    (Node 20-alpine, Express, รันด้วย nodemon)
└── frontend   (Node 20-alpine, Vite dev server)
```

- Frontend คุยกับ backend ผ่าน **Vite dev server proxy** (`/api/*` → `http://backend:4000`) เท่านั้น
  ไม่มี CORS cross-origin จริง เพราะ browser เห็นแค่ origin เดียวคือ `localhost:5173` — คุกกี้ (cookie)
  จึงเป็น same-origin เสมอ ไม่ต้องพึ่ง `SameSite=None` หรือตั้งค่า CORS ที่ซับซ้อน
- `backend/src` และ `frontend/src` mount เป็น volume เข้า container เพื่อให้แก้โค้ดแล้วเห็นผลทันที
  (`nodemon` ฝั่ง backend ตั้ง `legacyWatch: true` ใน `nodemon.json` เพราะ file-change events ผ่าน
  bind mount บน Windows/Docker Desktop มักไม่ trigger inotify ตามปกติ ต้องใช้ polling)
- Backend รอ Postgres พร้อมด้วยสองชั้น: `depends_on: condition: service_healthy` ใน compose
  และ retry-with-backoff ใน `src/db/migrate.js` (กันเคส race condition ตอน container เพิ่ง start)
- ตัวแปรลับของฐานข้อมูล (`POSTGRES_USER/PASSWORD/DB`) อยู่ใน root `.env` เท่านั้น แล้ว
  `docker-compose.yml` forward ค่าเดียวกันเข้า backend ผ่าน `environment:` (override
  `backend/.env`) เพื่อไม่ให้ต้อง sync รหัสผ่านฐานข้อมูลไว้สองที่

## การไหลของ 2FA (สำคัญที่สุด — อ่านก่อนแก้ auth)

Login **ไม่มีทางสำเร็จได้จากรหัสผ่านอย่างเดียว** ทุก request ที่ผ่านรหัสผ่านถูกต้องจะได้ "pre-auth
token" (JWT อายุสั้น 5 นาที เก็บใน httpOnly cookie ชื่อ `pre_auth_token`, เซ็นด้วย secret คนละตัว
จาก access/refresh token) ที่ระบุ stage ไว้ใน payload:

1. **`stage: 'setup'`** — ถ้า `users.totp_enabled = false` (ยังไม่เคยตั้ง 2FA)
   → frontend พาไปหน้า `/2fa/setup` → เรียก `POST /api/auth/2fa/setup` (ต้องมี pre-auth cookie
   stage `setup`) → generate TOTP secret ใหม่ทุกครั้ง เก็บแบบเข้ารหัสไว้ก่อน (ยังไม่ enable) →
   คืน QR code + secret ให้ผู้ใช้สแกน → ผู้ใช้กรอกโค้ด 6 หลัก ยืนยันที่
   `POST /api/auth/2fa/setup/confirm` → ถ้าถูก: enable TOTP, generate backup codes 10 ชุด, ออก
   session เต็ม (access + refresh cookie) ทันที
2. **`stage: 'verify'`** — ถ้าตั้ง 2FA ไว้แล้ว → frontend พาไปหน้า `/2fa/verify` → กรอกโค้ด TOTP
   หรือ backup code ที่ `POST /api/auth/2fa/verify` → สำเร็จจึงออก session เต็ม

**Admin ไม่มีทางปิด 2FA ให้ user คนไหนได้** มีแต่ "reset" (`POST /api/admin/users/:id/reset-2fa`)
ซึ่งล้าง `totp_secret_enc`/`totp_enabled` กลับไปเป็นค่าว่าง — แปลว่า login ครั้งต่อไปของ user
คนนั้นจะตกไปที่ stage `setup` ใหม่ทั้งหมด (บังคับตั้งใหม่ ไม่ใช่ทางลัดข้าม 2FA)

ดูรายละเอียด sequence diagram ทั้งหมดใน [README.md](README.md#ขั้นตอนการทำงานของ-2fa)

## Token/Cookie ที่ใช้ (ทั้งหมดเป็น httpOnly, SameSite=Lax)

| Cookie | Secret env var | อายุ | ใช้ทำอะไร |
|---|---|---|---|
| `pre_auth_token` | `PRE_AUTH_TOKEN_SECRET` | 5 นาที (`PRE_AUTH_TOKEN_TTL`) | คั่นระหว่างผ่านรหัสผ่านแล้วกับผ่าน 2FA แล้ว เรียก API อื่นไม่ได้เลย |
| `access_token` | `ACCESS_TOKEN_SECRET` | 15 นาที (`ACCESS_TOKEN_TTL`) | ใช้เรียก API ที่ต้อง login |
| `refresh_token` | `REFRESH_TOKEN_SECRET` | 7 วัน (`REFRESH_TOKEN_TTL`) | ขอ access token ใหม่ผ่าน `/api/auth/refresh`, hash (SHA-256) เก็บใน DB เพื่อ revoke ได้ |

ใช้ secret **คนละตัวกัน 3 ตัว** โดยตั้งใจ — ป้องกัน token ประเภทหนึ่งถูกใช้ปลอมเป็นอีกประเภทได้ถ้าหลุด

`refresh_token` มีการ **rotate ทุกครั้งที่ใช้** (ตัวเก่าถูก revoke, ออกตัวใหม่ทันที) ถ้ามีคน
เอา refresh token ที่ revoke ไปแล้วมาใช้ซ้ำ (สัญญาณว่าโดนขโมย token) ระบบจะ revoke session
ทั้งหมดของ user คนนั้นทันที (`revokeAllForUser` ใน `token.service.js`)

## ทำไม hash บางอย่าง แต่เข้ารหัส (encrypt) บางอย่าง

| ข้อมูล | วิธีเก็บ | เหตุผล |
|---|---|---|
| รหัสผ่านผู้ใช้ | bcrypt hash (`utils/password.js`) | ไม่ต้องใช้ค่าจริงอีกเลย เทียบด้วย bcrypt.compare ได้ |
| Backup codes | bcrypt hash (`utils/backupCodes.js`) | เป็น secret ที่ low-entropy เหมือนรหัสผ่าน ใช้ครั้งเดียวทิ้ง เทียบอย่างเดียวพอ |
| TOTP secret | AES-256-GCM encrypt (`utils/crypto.js`) | **ต้อง decrypt กลับมาค่าจริงได้** เพื่อเอาไปคำนวณโค้ด TOTP รอบต่อไป จะ hash แบบ one-way ไม่ได้ |
| Refresh token | SHA-256 hash (`token.service.js`) | เป็น token ที่ entropy สูงมากอยู่แล้ว (สุ่มจาก JWT) ไม่ต้องพึ่ง bcrypt ที่ตั้งใจให้ช้า แค่ทนพอสำหรับ compare |

`TOTP_ENCRYPTION_KEY` (32 bytes / 64 hex chars) ต้องถูกตั้งเองผ่าน `.env` — ไม่มี default เพราะถ้า
default ถูก commit เข้า repo จะทำให้ TOTP secret ทุกอันในฐานข้อมูล decrypt ได้จากคนนอก

## RBAC

Permission map แบบ centralised อยู่ที่ [backend/src/config/permissions.js](backend/src/config/permissions.js)

```js
PERMISSIONS = {
  'users:read':  ['admin', 'manager'],
  'users:write': ['admin'],
  'audit:read':  ['admin'],
}
```

Middleware `requirePermission(permission)` ([backend/src/middleware/rbac.middleware.js](backend/src/middleware/rbac.middleware.js))
เช็ค role ของ `req.user` กับ map นี้ — เพิ่ม permission หรือ role ใหม่แก้ที่ไฟล์นี้ไฟล์เดียว ไม่ต้อง
ไล่แก้ทุก route

Route ฝั่ง admin (`/api/admin/*`) ทุกตัวผ่าน `requireAuth` ก่อนเสมอ (ต้อง login และ 2FA แล้ว) แล้วค่อย
เช็ค permission เพิ่ม — เพราะฉะนั้น `manager` เข้าดูรายชื่อ user ได้ (`users:read`) แต่แก้ role/สร้าง/
reset อะไรไม่ได้เลย (`users:write` เฉพาะ admin)

Admin แก้ role/สถานะของ**ตัวเอง**ให้หลุดจาก admin หรือ disable ตัวเองไม่ได้ (กันล็อกตัวเองออกจากระบบ)
ดู guard ใน [backend/src/controllers/admin.controller.js](backend/src/controllers/admin.controller.js) `patchUser`

## ความปลอดภัยอื่น ๆ ที่ implement ไว้

- **Account lockout**: ผิดรหัสผ่านติดกัน `LOGIN_MAX_ATTEMPTS` ครั้ง (default 5) → lock
  `LOGIN_LOCK_MINUTES` นาที (default 15) นับจาก `users.failed_login_attempts`/`locked_until`
- **Admin reset password ก็ปลดล็อกด้วย** (`resetFailedLogins` ถูกเรียกใน `postResetPassword`) —
  ไม่งั้น user ที่โดนล็อกแล้ว admin ช่วยรีเซ็ตรหัสให้ ก็ยัง login ไม่ได้จนกว่าจะครบเวลา ซึ่งขัด
  กับเจตนาของฟีเจอร์ "แอดมินช่วยกู้บัญชี"
- **Rate limit** login (`express-rate-limit`, 20 req / 15 นาที ต่อ IP) และ 2FA verify/setup-confirm
  (10 req / 5 นาที ต่อ IP) แยกกัน — 2FA endpoint เข้มกว่าเพราะโค้ด 6 หลักมีช่องให้เดา
- Error message ตอน login ผิด เป็นข้อความเดียวกันไม่ว่าจะ "ไม่มี email นี้" หรือ "รหัสผ่านผิด"
  (ป้องกัน user enumeration)
- `helmet()` ตั้ง security headers เริ่มต้น, `trust proxy` เปิดไว้เผื่อรันหลัง reverse proxy จริง

## โครงสร้างไฟล์ backend

```
backend/src/
├── config/       env.js (zod validate ตัวแปรแวดล้อม, fail fast ถ้าขาด), db.js (pg Pool), permissions.js
├── db/           migrations/001_init.sql, migrate.js (runner + wait-for-db), seed.js (bootstrap admin)
├── middleware/   auth (access/pre-auth cookie verify), rbac (permission check), rateLimit, error
├── validators/   schemas.js (zod schema ของทุก request body)
├── services/     user/token/twofa/audit — business logic + DB queries ทั้งหมดอยู่ที่นี่
├── controllers/  auth.controller.js, admin.controller.js — บาง แค่ประกอบ service + ตอบ HTTP
└── routes/       auth.routes.js, admin.routes.js
```

Controllers ไม่คุย DB ตรง ๆ — เรียกผ่าน services เท่านั้น ถ้าจะเพิ่ม endpoint ใหม่ ควรเพิ่มฟังก์ชันใน
service ที่เกี่ยวข้องก่อน แล้ว controller ค่อยเรียกใช้

## โครงสร้างไฟล์ frontend

```
frontend/src/
├── lib/
│   ├── api.js              fetch wrapper เดียวสำหรับทั้งแอป (credentials: 'include' เสมอ)
│   ├── guards.js            authGuard / adminGuard / userManagementReadGuard สำหรับ route
│   └── stores/
│       ├── auth.js          session state (เรียก GET /auth/me ตอน app mount)
│       └── backupCodes.js   เก็บ backup codes ชั่วคราวในหน่วยความจำ (ไม่ persist) ระหว่างเปลี่ยนหน้า
├── pages/                   1 ไฟล์ต่อ 1 หน้า route
├── components/Navbar.svelte
└── App.svelte                ประกาศ route table ทั้งหมด (ใช้ svelte-spa-router + wrap() สำหรับ guard)
```

Routing ใช้ `svelte-spa-router` (hash-based, `#/...`) — ไม่ใช่ SvelteKit เพราะโปรเจกต์นี้ไม่ต้องการ
SSR หรือ file-based routing แค่ SPA ล้วน ๆ ก็พอกับ scope นี้

## คำสั่งที่ใช้บ่อย

```bash
# ครั้งแรก: สร้างไฟล์ .env จาก .env.example (ที่ root, backend/, frontend/) แล้วตั้ง secret เอง
docker compose up -d --build      # build + start ทุก service
docker compose logs -f backend    # ดู log backend (migration/seed จะรันตอน start อัตโนมัติ)
docker compose down                # หยุด (เก็บ data ไว้)
docker compose down -v             # หยุด + ลบ volume postgres (รีเซ็ตฐานข้อมูลทั้งหมด)
```

ไม่มี migration/seed command ที่ต้องรันแยกมือ — `backend/src/server.js` เรียก `runMigrations()`
แล้ว `seedAdmin()` ก่อน `app.listen()` ทุกครั้งที่ container start (idempotent ทั้งคู่)

## สิ่งที่ตั้งใจไม่ทำ (scope ที่ตัดออกเพื่อความง่าย)

- ไม่มี public self-registration — เจตนาให้เป็นระบบปิดที่ admin สร้าง user ให้เท่านั้น
  (`ระบบบริหารจัดการ user` ตามที่ระบุ requirement)
- ไม่มี "remember this device" / trusted device สำหรับข้าม 2FA — ตั้งใจให้ 2FA บังคับทุกครั้งที่ login
  แบบเข้มที่สุด ตรงตาม requirement "Force ทุก User"
- ไม่มี SMS/email OTP เป็น fallback (มีแต่ backup codes) — ลดความซับซ้อนของการต่อ third-party service
  ในตัวอย่างเพื่อการเรียนรู้
- Rate limiter ใช้ in-memory store ของ `express-rate-limit` (ไม่ผ่าน Redis) — พอสำหรับ instance เดียว
  ถ้าจะ scale เป็นหลาย instance ต้องเปลี่ยนไปใช้ shared store

## การทดสอบที่ทำไปแล้ว

Build และรันผ่าน `docker compose` จริงบน Docker Desktop แล้วทดสอบผ่าน `curl` ครบทุก flow หลัก:
login → forced setup (QR/secret → TOTP confirm) → backup codes ออกให้ 10 ชุด → session cookie →
`/auth/me` → change password → admin create user (`manager`/`user`) → RBAC ปฏิเสธ `user` ที่เรียก
`/admin/users` (403) → account lockout หลังผิดรหัส 5 ครั้ง → admin reset password ปลดล็อกได้ → login
ด้วย backup code สำเร็จและใช้ซ้ำไม่ได้ → refresh token rotation → logout แล้ว `/auth/me` เป็น 401
ทุก Svelte component ยืนยันแล้วว่า compile ผ่าน Vite ได้ไม่มี error (`curl` แต่ละไฟล์ได้ HTTP 200)
