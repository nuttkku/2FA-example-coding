# CLAUDE.md

เอกสารนี้สรุปสถาปัตยกรรมและการตัดสินใจทางเทคนิคของโปรเจกต์นี้ สำหรับ Claude Code (หรือผู้พัฒนา)
ที่จะเข้ามาทำงานต่อในอนาคต อ่านไฟล์นี้ก่อนแก้ไขโค้ด เพื่อเข้าใจว่าทำไมโค้ดถึงถูกออกแบบแบบนี้

> ## ⚠️ ก่อนแก้ไข/เพิ่ม feature ใด ๆ
> 1. **อ่าน [CI-CD.md](CI-CD.md) ก่อนเริ่มงานทุกครั้ง** — มีขั้นตอนที่ CI บังคับตรวจ (npm audit, Semgrep,
>    docker build, Trivy image scan, smoke test) และคำสั่งรันเหมือน CI บนเครื่องตัวเองก่อน push
> 2. แก้โค้ดแล้ว **สแกนความปลอดภัยอีกรอบก่อน commit** — อย่างน้อยรัน Semgrep ตามคำสั่งใน CI-CD.md
>    (`docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep scan --config p/security-audit
>    --config p/secrets --config p/javascript --config p/nodejsscan --exclude node_modules
>    --exclude "*.md" /src`) แล้วพิจารณา finding ทุกอันอย่างจริงจังก่อนตัดสินว่าเป็น false positive
> 3. ถ้า flow ใหม่กระทบ login/2FA/RBAC ให้เพิ่ม assertion ใน [scripts/smoke-test.sh](scripts/smoke-test.sh)
>    ด้วย ไม่ใช่แค่ทดสอบมือแล้วปล่อยผ่าน — สคริปต์นี้คือ regression test ตัวเดียวที่ CI มี
> 4. **อัปเดตไฟล์นี้ (CLAUDE.md)** ด้วยการตัดสินใจ/เหตุผลใหม่ที่เกิดขึ้น และอัปเดต [README.md](README.md)
>    ถ้ากระทบสิ่งที่ผู้ใช้เห็น (ขั้นตอนติดตั้ง/ตัวแปร env/API/flow) แล้ว commit + push เสมอ — นี่คือ
>    ข้อตกลงถาวรของโปรเจกต์นี้ ไม่ต้องรอให้สั่งซ้ำทุกครั้ง

## ภาพรวมโปรเจกต์

โปรเจกต์ตัวอย่างเพื่อการเรียนรู้ (learning example) ของระบบ Login ที่มี:

- **RBAC** (Role-Based Access Control) 3 role: `admin`, `manager`, `user`
- **บังคับ 2FA (TOTP) กับทุก user ไม่ว่าจะ login ด้วยวิธีไหน** — ไม่มี path ใดในระบบที่ทำให้ login
  สำเร็จได้โดยไม่ผ่าน 2FA รวมถึง login ผ่าน SSO ด้วย
- ระบบบริหารจัดการ user (สร้าง/แก้ role/ปิดใช้งาน/reset password/reset 2FA) โดย admin
- **SSO**: Facebook Login (OAuth 2.0), LINE Login (OIDC), Keycloak (OIDC), และ generic OIDC
  provider ใด ๆ — ทุกตัวเป็น optional เปิด/ปิดผ่าน `.env`
- รันทั้งหมดผ่าน Docker Compose (PostgreSQL + Express backend + Svelte frontend) มีทั้งแบบมี Keycloak
  ในตัว (`docker-compose.keycloak.yml` เป็น addon) และแบบไม่มี (`docker-compose.yml` เพียวๆ)

Stack: **Svelte 5 + Vite 8** (frontend) / **Node.js + Express** (backend) / **PostgreSQL 16** (database)

ดู [README.md](README.md) สำหรับคำอธิบายขั้นตอนการทำงานแบบละเอียด (ใช้เป็นแหล่งเรียนรู้) และวิธีรัน,
ดู [CI-CD.md](CI-CD.md) สำหรับกระบวนการพัฒนา/ตรวจสอบอัตโนมัติ, ดู [CREDIT.md](CREDIT.md) สำหรับรายชื่อ
open-source software/บริการที่ใช้ในโปรเจกต์

## สถาปัตยกรรม

```
docker-compose.yml
├── postgres   (postgres:16-alpine, มี healthcheck)
├── backend    (Node 20-alpine, Express, รันด้วย nodemon)
└── frontend   (Node 20-alpine, Vite dev server)

docker-compose.keycloak.yml   (addon - รันคู่กับไฟล์บนเสมอ ไม่รันเดี่ยว)
├── keycloak   (quay.io/keycloak/keycloak, --import-realm จาก keycloak/realm-export.json)
└── backend    (override: เพิ่ม env ให้เปิด KEYCLOAK_ENABLED และชี้ไปที่ keycloak service)
```

รันแบบมี Keycloak: `docker compose -f docker-compose.yml -f docker-compose.keycloak.yml up -d --build`

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

**โค้ด TOTP ใช้ได้ครั้งเดียว** — `verifyTotpCode(userId, secret, code)` ใน `twofa.service.js` หา
time-step ของโค้ดด้วย `checkDelta()` แล้ว `claimTotpStep()` (conditional `UPDATE ... WHERE
totp_last_used_step < $step`) ต้องสำเร็จด้วยถึงจะนับว่าถูก — `authenticator.check()` เฉย ๆ ของ otplib เป็น
stateless รับโค้ดเดิมซ้ำได้ตลอดช่วง window ±1 step (~90 วินาที) `totp_last_used_step` ถูกล้างทุกครั้งที่สร้าง
secret ใหม่ (`setTotpSecretPending`) และตอน admin reset 2FA

**2FA lockout ต่อบัญชี แยกจาก password lockout** (`failed_2fa_attempts`/`twofa_locked_until`, migration
`003_twofa_hardening.sql`, ค่า `TWOFA_MAX_ATTEMPTS`/`TWOFA_LOCK_MINUTES`) — rate limit ต่อ IP อย่างเดียว
ไม่พอ เพราะคนที่ได้รหัสผ่านไปแล้วกระจายการเดาโค้ดไปหลาย IP ได้ ตั้งใจ**ไม่ใช้ counter เดียวกับ password
lockout** เพราะจะทำให้คนที่แค่รู้ email ของ user SSO ยิงรหัสผิดจนล็อก 2FA ของเหยื่อได้ (ช่อง DoS เดียวกับที่
ตั้งใจไม่เช็ค lockout กับ SSO ด้านล่าง) และ**ห้าม reset counter นี้ตอน password login สำเร็จ** (`resetFailedLogins`
ไม่แตะ) ไม่งั้นคนที่มีรหัสผ่านแค่ login ใหม่ก็ได้โควตาเดาใหม่ — reset เฉพาะเมื่อ 2FA สำเร็จ หรือ admin reset
password/2FA ส่วน `loadPreAuthUser()` ใน `auth.controller.js` เช็คซ้ำทุกครั้งที่ใช้ pre-auth cookie ว่า user
ยังอยู่, ไม่ถูก disable, และ 2FA ไม่ถูกล็อก (pre-auth cookie อายุ 5 นาที สถานะอาจเปลี่ยนระหว่างนั้น)

`twoFaLimiter` ตั้ง `skipSuccessfulRequests: true` — นับเฉพาะครั้งที่ผิด เพราะจุดประสงค์คือจำกัดการเดา

**Admin ไม่มีทางปิด 2FA ให้ user คนไหนได้** มีแต่ "reset" (`POST /api/admin/users/:id/reset-2fa`)
ซึ่งล้าง `totp_secret_enc`/`totp_enabled` กลับไปเป็นค่าว่าง — แปลว่า login ครั้งต่อไปของ user
คนนั้นจะตกไปที่ stage `setup` ใหม่ทั้งหมด (บังคับตั้งใหม่ ไม่ใช่ทางลัดข้าม 2FA)

ดูรายละเอียด sequence diagram ทั้งหมดใน [README.md](README.md#-ขั้นตอนการทำงานของ-2fa)

## SSO / OIDC (Facebook, LINE, Keycloak, generic OIDC)

**หลักการเดียวกับ password login ทุกอย่าง**: SSO callback ที่สำเร็จจะไม่ออก session เต็มตรง ๆ
มันแค่ทำให้ระบบรู้ว่า "นี่คือ user คนไหน" แล้วเรียก `issuePreAuthCookie(res, user.id, stage)` **ตัวเดียวกัน**
กับที่ password login เรียก — จากนั้น flow ที่เหลือ (setup/verify 2FA) คือโค้ดชุดเดียวกันทั้งหมด ไม่มี
โค้ดพิเศษแยกสำหรับ user ที่มาจาก SSO เลย ดู [backend/src/controllers/sso.controller.js](backend/src/controllers/sso.controller.js)
ท้ายฟังก์ชัน `handleCallback`

### โครงสร้างไฟล์ (backend)

```
backend/src/
├── config/identityProviders.js     registry: อ่าน env ของแต่ละ provider, disable แบบ soft-fail
│                                    ถ้า enable แต่ config ไม่ครบ (ไม่ทำให้ทั้ง app boot ไม่ขึ้น)
├── services/
│   ├── oidcClient.service.js       ใช้ร่วมกันทั้ง Keycloak/LINE/generic OIDC (openid-client v6)
│   ├── facebook.service.js         OAuth 2.0 ล้วน เขียนมือด้วย fetch (Facebook ไม่มี OIDC discovery)
│   └── sso.service.js              dispatch ตาม provider.type + findOrCreateUserFromIdentity()
├── controllers/sso.controller.js   GET /providers, GET /:provider/start, GET /:provider/callback
└── routes/sso.routes.js
```

- **Facebook ≠ OIDC** ไม่มี `id_token`/discovery document เลย ต้องเขียน 3 HTTP call มือ (authorize
  dialog → exchange code → `/me` profile) จึงแยกเป็น service ของตัวเอง ส่วน **LINE, Keycloak, และ OIDC
  ทั่วไปทั้งหมด OIDC-compliant จริง** ใช้ `oidcClient.service.js` ตัวเดียวกัน ต่างกันแค่ค่า config
  (issuer/scope) ที่มาจาก `identityProviders.js`
- ใช้ [openid-client](https://github.com/panva/openid-client) v6 (functional API, `discovery()` +
  `authorizationCodeGrant()`) ไม่เขียน JWT/JWKS validation เองเพราะเสี่ยงพลาดง่ายเกินไป (signature
  verification, `nonce`/`state`/`iss` check ทั้งหมดปล่อยให้ library ทำ)
- **PKCE ใช้กับทุก OIDC provider เสมอ** (code_verifier/code_challenge) ไม่ใช่แค่ตอนไม่มี client secret —
  ปลอดภัยกว่าโดยไม่มี cost เพิ่ม Facebook ไม่รองรับ PKCE แบบเดียวกัน จึงใช้ `state` (CSRF) + confidential
  client secret exchange ฝั่ง server แทน (มาตรฐานของ Facebook Login สำหรับ web app แบบ server-side)

### CSRF/state ระหว่าง redirect ไป IdP แล้วกลับมา

Cookie `sso_state` (เซ็นด้วย `SSO_STATE_SECRET`, อายุ 10 นาที) เก็บ `{provider, state, nonce,
codeVerifier}` ไว้ตอน `GET /:provider/start` แล้วเช็คกลับตอน `GET /:provider/callback` — `SameSite=Lax`
ใช้งานได้ปกติเพราะการ redirect กลับจาก IdP เป็น top-level navigation (ไม่ใช่ cross-site subresource
request ที่ Lax จะบล็อก)

### ปัญหา internal vs public URL ตอนรัน Keycloak ใน docker-compose (สำคัญ ถ้าจะแก้ provider อื่นที่มีลักษณะคล้ายกัน)

Backend เข้าถึง Keycloak ผ่าน docker network (`http://keycloak:8080`) แต่ browser ต้อง redirect ไปที่
`http://localhost:8080` (host-mapped port) — endpoint ที่ browser ใช้ (`authorization_endpoint`,
`end_session_endpoint`) กับที่ backend ใช้เอง (`token_endpoint`, `jwks_uri`, `userinfo_endpoint`) จึง
**ต้องเป็นคนละ origin กัน** ทำ 2 เรื่องใน `oidcClient.service.js`'s `getConfig()`:

1. Discovery ทำผ่าน internal URL (`provider.issuer`) เสมอ — backend ต้อง resolve host นี้ได้
2. ถ้ามี `provider.publicIssuer` ตั้งไว้ (เฉพาะ Keycloak addon) จะ rewrite field `issuer`,
   `authorization_endpoint`, `end_session_endpoint` ในค่า metadata ที่ discover มาให้เป็น public origin
   ก่อนสร้าง `Configuration` ใหม่ — **ต้อง rewrite `issuer` ด้วย ไม่ใช่แค่ endpoint** เพราะ Keycloak
   รายงาน `iss` (ทั้งใน callback param ตาม RFC 9207 และใน `id_token` claim) ตาม origin ที่ browser ใช้
   จริงตอน authorize ไม่ใช่ตาม origin ที่ตอน discovery ถูกเรียก — ถ้าไม่ rewrite `issuer` ด้วย
   `openid-client` จะ reject callback ด้วย `unexpected "iss" response parameter value` (เจอ bug นี้จริง
   ตอนพัฒนา ดูหัวข้อผลการสแกนด้านล่าง)
3. **`redirect_uri` ที่ส่งไป token exchange ต้องสร้างจาก `env.FRONTEND_ORIGIN` เสมอ ห้ามใช้
   `req.protocol`/`req.get('host')`** — เพราะ request ที่ backend เห็นถูก Vite proxy (`changeOrigin:
   true`) เปลี่ยน Host header เป็น `backend:4000` ไปแล้ว ถ้าเอาไปสร้าง `redirect_uri` จะไม่ตรงกับตัวที่
   ใช้ตอน authorize request จริง (ที่ browser เห็นคือ `localhost:5173`) แล้ว provider จะ reject ด้วย
   `invalid_grant: Incorrect redirect_uri` (เจอ bug นี้จริงเช่นกัน)

### การ match/สร้าง user จาก external identity (`sso.service.js`)

ลำดับการตัดสินใจใน `findOrCreateUserFromIdentity()`:

1. มี `oauth_identities` row ที่ตรง `(provider, providerUserId)` อยู่แล้ว → คืน user เดิม
2. Email ที่ provider ส่งมา **verified** และตรงกับ user ที่มีอยู่ → link identity เข้ากับ user เดิม
   (เพิ่ม row ใน `oauth_identities`) **เฉพาะกรณี verified เท่านั้น** — email ที่ยังไม่ verified อาจเป็น
   ของคนอื่นที่ไม่ได้เป็นเจ้าของ address นั้นจริง ถ้า auto-link ให้จะกลายเป็นช่องให้ยึด account คนอื่นได้
3. Email ตรงกับ user ที่มีอยู่ แต่**ไม่ verified** → ไม่ link (เหตุผลข้อ 2) **และไม่เอา email นั้นมาใช้ซ้ำ
   กับ user ใหม่ด้วย** (จะชน `UNIQUE` constraint) → ตกไปใช้ placeholder แทน
4. ไม่มี user ให้ link เลย → สร้างใหม่ ถ้า provider ส่ง email มาและไม่ชนกับใคร ใช้ email จริงได้เลย
   (ไม่ต้องรอ verified เพราะเป็น account ใหม่ ไม่มี account เดิมให้ยึด) ถ้าไม่มี email เลย (เช่น LINE ที่
   ไม่ได้รับสิทธิ์ email permission) ใช้ placeholder รูปแบบ `<provider>.<providerUserId>@sso.local`

User ที่สร้างจาก SSO: `password_hash = NULL`, `role = 'user'`, `must_change_password = FALSE` —
`users.password_hash` เปลี่ยนเป็น nullable แล้ว (migration `002_add_sso.sql`) เพราะ account กลุ่มนี้ไม่มี
รหัสผ่าน local ให้ตั้งแต่แรก (`/auth/me` คืน field `hasPassword` ให้ frontend ซ่อนปุ่ม "เปลี่ยนรหัสผ่าน")

**Admin disable account ต้องบล็อกทุกช่องทาง login รวม SSO ด้วย** — เช็ค `user.status === 'disabled'`
ใน `sso.controller.js`'s `handleCallback` ก่อนออก pre-auth cookie (ไม่ใช่แค่ path password login) ไม่งั้น
admin disable ไปแล้ว user ที่ link ไว้กับ Keycloak/Facebook/LINE ยัง login กลับเข้ามาได้อยู่

**บัญชี lockout (`failed_login_attempts`/`locked_until`) ตั้งใจไม่เอามาเช็คกับ SSO login** — เพราะ
attacker รู้แค่ email ของเหยื่อก็ยิง `/api/auth/login` ผิดรหัส 5 ครั้งเพื่อ lock ได้โดยไม่ต้องรู้อะไรเพิ่ม
ถ้า SSO ก็ถูกบล็อกด้วย จะกลายเป็นเปิดช่องให้ DoS ผู้ใช้ SSO ได้ง่าย ๆ จากแค่รู้ email เขา — ต่างจาก
`status: disabled` ที่เป็นการกระทำของ admin โดยตรง ไม่ใช่สิ่งที่ attacker ข้างนอกกระตุ้นให้เกิดได้เอง

## Token/Cookie ที่ใช้ (ทั้งหมดเป็น httpOnly, SameSite=Lax)

| Cookie | Secret env var | อายุ | ใช้ทำอะไร |
|---|---|---|---|
| `pre_auth_token` | `PRE_AUTH_TOKEN_SECRET` | 5 นาที (`PRE_AUTH_TOKEN_TTL`) | คั่นระหว่างผ่านรหัสผ่านแล้วกับผ่าน 2FA แล้ว เรียก API อื่นไม่ได้เลย |
| `access_token` | `ACCESS_TOKEN_SECRET` | 15 นาที (`ACCESS_TOKEN_TTL`) | ใช้เรียก API ที่ต้อง login |
| `refresh_token` | `REFRESH_TOKEN_SECRET` | 7 วัน (`REFRESH_TOKEN_TTL`) | ขอ access token ใหม่ผ่าน `/api/auth/refresh`, hash (SHA-256) เก็บใน DB เพื่อ revoke ได้ |
| `sso_state` | `SSO_STATE_SECRET` | 10 นาที | CSRF state + OIDC nonce + PKCE code_verifier ระหว่าง redirect ไป IdP แล้วกลับมา |

ใช้ secret **คนละตัวกันทุก cookie** โดยตั้งใจ — ป้องกัน token ประเภทหนึ่งถูกใช้ปลอมเป็นอีกประเภทได้ถ้าหลุด
`jwt.sign`/`jwt.verify` ทุกที่ pin `algorithm: 'HS256'` ตรง ๆ ไม่พึ่ง default inference ของ library

`refresh_token` มีการ **rotate ทุกครั้งที่ใช้** (ตัวเก่าถูก revoke + ตั้ง `replaced_by` เป็น jti ตัวใหม่,
ออกตัวใหม่ทันที) ถ้ามีคนเอา refresh token ที่**ถูก rotate ไปแล้ว**มาใช้ซ้ำ (สัญญาณว่าโดนขโมย token) ระบบจะ
revoke session ทั้งหมดของ user คนนั้นทันที (`revokeAllForUser` ใน `token.service.js`) — **เฉพาะตัวที่
`replaced_by` มีค่าเท่านั้น** token ที่ถูก revoke เพราะ logout/เปลี่ยนรหัสผ่าน/admin แค่ตอบ 401 เฉย ๆ
(เจอจริงตอนเขียน smoke test: ถ้านับทุก token ที่ revoke เป็น "ถูกขโมย" เครื่องเก่าที่ยัง refresh อยู่จะลาก
session ใหม่ที่เพิ่งได้จากการเปลี่ยนรหัสผ่านให้หลุดไปด้วย) การ revoke ตอน rotate ใช้ conditional `UPDATE
... WHERE revoked_at IS NULL` แล้วเช็ค `rowCount` — request ที่ยิงพร้อมกันด้วย token เดียวกันจะสำเร็จได้
แค่ตัวเดียว ตัวที่แพ้ถือเป็น reuse

`change-password` revoke refresh token ทุกตัวของ user แล้วออก session ใหม่ให้เครื่องที่เปลี่ยน (`issueFullSession`)
— การเปลี่ยนรหัสผ่านมักเป็นการตอบสนองต่อการสงสัยว่าบัญชีหลุด session เก่าจึงไม่ควรอยู่ต่อ (access token
เดิมที่ออกไปแล้วยังใช้ได้จนหมดอายุ 15 นาที เพราะเป็น stateless JWT — ข้อจำกัดที่รู้อยู่แล้ว)

## ทำไม hash บางอย่าง แต่เข้ารหัส (encrypt) บางอย่าง

| ข้อมูล | วิธีเก็บ | เหตุผล |
|---|---|---|
| รหัสผ่านผู้ใช้ | bcrypt hash (`utils/password.js`) | ไม่ต้องใช้ค่าจริงอีกเลย เทียบด้วย bcrypt.compare ได้ |
| Backup codes | bcrypt hash (`utils/backupCodes.js`) | เป็น secret ที่ low-entropy เหมือนรหัสผ่าน ใช้ครั้งเดียวทิ้ง เทียบอย่างเดียวพอ |
| TOTP secret | AES-256-GCM encrypt (`utils/crypto.js`) | **ต้อง decrypt กลับมาค่าจริงได้** เพื่อเอาไปคำนวณโค้ด TOTP รอบต่อไป จะ hash แบบ one-way ไม่ได้ |
| Refresh token | SHA-256 hash (`token.service.js`) | เป็น token ที่ entropy สูงมากอยู่แล้ว (สุ่มจาก JWT) ไม่ต้องพึ่ง bcrypt ที่ตั้งใจให้ช้า แค่ทนพอสำหรับ compare |

`TOTP_ENCRYPTION_KEY` (32 bytes / 64 hex chars) ต้องถูกตั้งเองผ่าน `.env` — ไม่มี default เพราะถ้า
default ถูก commit เข้า repo จะทำให้ TOTP secret ทุกอันในฐานข้อมูล decrypt ได้จากคนนอก

`crypto.createCipheriv`/`createDecipheriv` ใน `utils/crypto.js` pin `authTagLength: 16` ตรง ๆ
(ไม่พึ่ง default ของ Node) แล้ว `decryptSecret` เช็คความยาว auth tag ที่อ่านมาก่อน `setAuthTag` — กัน
truncated-tag forgery attack ที่ auth tag สั้นกว่าที่ควรทำให้ปลอม ciphertext ได้ง่ายขึ้น (Semgrep เจอจริง
ตอน scan รอบแรก ดูหัวข้อผลการสแกนด้านล่าง)

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
— `:id` ทุก route ผ่าน `parseUserId()` (zod `uuid()` แล้ว `toLowerCase()`) ก่อนเสมอ: id ที่ไม่ใช่ UUID ได้ 404
แทน 500 จาก Postgres และ guard ข้างบนเทียบ string ตรง ๆ ถ้าไม่ normalize ตัวพิมพ์ admin จะส่ง id ตัวเองแบบ
ตัวพิมพ์ใหญ่ (Postgres รับได้) เพื่อเลี่ยง guard นี้ได้

## ความปลอดภัยอื่น ๆ ที่ implement ไว้

- **Account lockout**: ผิดรหัสผ่านติดกัน `LOGIN_MAX_ATTEMPTS` ครั้ง (default 5) → lock
  `LOGIN_LOCK_MINUTES` นาที (default 15) นับจาก `users.failed_login_attempts`/`locked_until`
- **Admin reset password ก็ปลดล็อกด้วย** (`resetFailedLogins` ถูกเรียกใน `postResetPassword`) —
  ไม่งั้น user ที่โดนล็อกแล้ว admin ช่วยรีเซ็ตรหัสให้ ก็ยัง login ไม่ได้จนกว่าจะครบเวลา ซึ่งขัด
  กับเจตนาของฟีเจอร์ "แอดมินช่วยกู้บัญชี"
- **Rate limit** login (`express-rate-limit`, 20 req / 15 นาที ต่อ IP) และ 2FA verify/setup-confirm
  (10 req / 5 นาที ต่อ IP) แยกกัน — 2FA endpoint เข้มกว่าเพราะโค้ด 6 หลักมีช่องให้เดา
- Error message ตอน login ผิด เป็นข้อความเดียวกันไม่ว่าจะ "ไม่มี email นี้" หรือ "รหัสผ่านผิด"
  (ป้องกัน user enumeration) — **timing ก็ต้องเหมือนกันด้วย** ไม่ใช่แค่ข้อความ: `login` controller เรียก
  `bcrypt.compare` ทุกครั้งไม่ว่า user จะมีจริงหรือไม่ (เทียบกับ `DUMMY_PASSWORD_HASH` คงที่ถ้าไม่มี
  user/ไม่มีรหัสผ่าน local) กัน timing attack ที่เดา email ที่มีอยู่จริงจากความช้าของ response
- `helmet()` ตั้ง security headers เริ่มต้น
- `TRUST_PROXY` **ปิดเป็น `false` โดย default** (ไม่ใช่เปิดไว้เผื่อ) เพราะ docker-compose นี้ไม่มี
  reverse proxy จริงอยู่หน้า backend — เปิดทิ้งไว้โดยไม่มี proxy จริงจะทำให้ client ปลอม
  `X-Forwarded-For` header เพื่อปลอม `req.ip` ได้ ซึ่งจะไปเจาะ rate limiter/account lockout/audit log
  ทั้งหมดที่พึ่ง `req.ip` อยู่ ต้องตั้งเป็นจำนวน hop เอง (เช่น `"1"`) เฉพาะตอนที่มี reverse proxy จริง
  หน้า backend เท่านั้น
- Container ทั้ง backend และ frontend รันเป็น **non-root user `node`** (`USER node` ใน Dockerfile,
  หลังจาก `chown -R node:node /app`) ไม่ใช่ root ตาม default ของ base image

## โครงสร้างไฟล์ backend

```
backend/src/
├── config/       env.js (zod validate ตัวแปรแวดล้อมหลัก, fail fast ถ้าขาด), db.js (pg Pool),
│                 permissions.js (RBAC map), identityProviders.js (SSO registry, soft-fail)
├── db/           migrations/001_init.sql, 002_add_sso.sql, migrate.js (runner + wait-for-db),
│                 seed.js (bootstrap admin)
├── middleware/   auth (access/pre-auth cookie verify), rbac (permission check), rateLimit, error
├── validators/   schemas.js (zod schema ของทุก request body)
├── services/     user/token/twofa/audit + oidcClient/facebook/sso (SSO) — business logic ทั้งหมด
├── controllers/  auth.controller.js, admin.controller.js, sso.controller.js — บาง แค่ประกอบ
│                 service + ตอบ HTTP
└── routes/       auth.routes.js, admin.routes.js, sso.routes.js
```

Controllers ไม่คุย DB ตรง ๆ — เรียกผ่าน services เท่านั้น ถ้าจะเพิ่ม endpoint ใหม่ ควรเพิ่มฟังก์ชันใน
service ที่เกี่ยวข้องก่อน แล้ว controller ค่อยเรียกใช้

## โครงสร้างไฟล์ frontend

```
frontend/src/
├── lib/
│   ├── api.js              fetch wrapper เดียวสำหรับทั้งแอป (credentials: 'include' เสมอ)
│   ├── guards.js            authGuard / adminGuard / userManagementReadGuard สำหรับ route
│   ├── events.js            preventDefault()/self() แทน event modifier ของ Svelte 4
│   └── stores/
│       ├── auth.js          session state (เรียก GET /auth/me ตอน app mount)
│       └── backupCodes.js   เก็บ backup codes ชั่วคราวในหน่วยความจำ (ไม่ persist) ระหว่างเปลี่ยนหน้า
├── pages/                   1 ไฟล์ต่อ 1 หน้า route
├── components/Navbar.svelte
└── App.svelte                ประกาศ route table ทั้งหมด (ใช้ svelte-spa-router + wrap() สำหรับ guard)
```

Routing ใช้ `svelte-spa-router` (hash-based, `#/...`) — ไม่ใช่ SvelteKit เพราะโปรเจกต์นี้ไม่ต้องการ
SSR หรือ file-based routing แค่ SPA ล้วน ๆ ก็พอกับ scope นี้

`Login.svelte` เรียก `GET /api/auth/sso/providers` ตอน mount เพื่อวาดปุ่ม SSO เฉพาะ provider ที่ backend
enable ไว้จริง (ไม่ hardcode รายชื่อ provider ไว้ฝั่ง frontend) ปุ่มพวกนี้เป็น `<a href>` ธรรมดา (ไม่ใช่
`fetch`) เพราะต้องเป็น browser navigation จริงให้ redirect chain ไป IdP แล้วกลับมาทำงานได้

## คำสั่งที่ใช้บ่อย

```bash
# ครั้งแรก: สร้าง .env ทั้งหมดพร้อม secret สุ่มให้อัตโนมัติ (หรือจะ cp .env.example ทีละไฟล์เองก็ได้)
bash scripts/generate-secrets.sh

docker compose up -d --build      # build + start (ไม่มี Keycloak)
docker compose -f docker-compose.yml -f docker-compose.keycloak.yml up -d --build   # มี Keycloak
docker compose logs -f backend    # ดู log backend (migration/seed จะรันตอน start อัตโนมัติ)
docker compose down                # หยุด (เก็บ data ไว้) - ถ้ารันแบบมี Keycloak ต้องใส่ -f สองไฟล์เหมือนกัน
docker compose down -v             # หยุด + ลบ volume postgres (รีเซ็ตฐานข้อมูลทั้งหมด)

bash scripts/smoke-test.sh         # ยิง API จริงทดสอบ flow หลักทั้งหมด (ต้อง up -d ไว้ก่อน)
```

ไม่มี migration/seed command ที่ต้องรันแยกมือ — `backend/src/server.js` เรียก `runMigrations()`
แล้ว `seedAdmin()` + `seedTestUser()` ก่อน `app.listen()` ทุกครั้งที่ container start (idempotent ทั้งคู่)

`seedTestUser()` ([backend/src/db/seed.js](backend/src/db/seed.js)) สร้างบัญชี role `user` เพิ่มจาก
`TEST_USER_EMAIL`/`TEST_USER_PASSWORD` (default: `user@example.com` / `UserTest123`) — เพื่อให้มีบัญชี
ทั้ง 2 สิทธิ์ (`admin` จาก `seedAdmin()`, `user` จากตัวนี้) พร้อมทดสอบ RBAC ได้ทันทีโดยไม่ต้องสร้างมือก่อน
ต่างจาก `ADMIN_EMAIL`/`ADMIN_PASSWORD` ที่**ไม่มี default** (บังคับตั้งเอง) ตัวนี้มี default เพราะเป็นแค่
ความสะดวกสำหรับทดสอบ ไม่ใช่ขั้นตอน bootstrap ที่จำเป็น และตั้งใจ**ไม่บังคับเปลี่ยนรหัสผ่าน**
(`must_change_password: FALSE`) เพื่อให้ login ทดสอบได้ทันทีไม่มี friction เพิ่ม — แต่ยังต้องผ่าน 2FA
setup บังคับเหมือนบัญชีอื่นทุกบัญชี (ไม่มีทางลัดตรงนี้ ต่อให้เป็นบัญชีทดสอบก็ตาม)

**บัญชีนี้ auto-seed เฉพาะเมื่อ `NODE_ENV !== 'production'`** — `seedTestUser()` เช็ค `isProduction`
เป็นเงื่อนไขแรกแล้ว return ทันทีถ้าเป็น production ไม่แตะฐานข้อมูลเลย เจตนาคือไม่ให้บัญชีทดสอบที่มี
รหัสผ่าน default หลุดเข้าไปอยู่ในฐานข้อมูลจริงโดยที่ไม่มีใครรู้ตัว (ต่างจาก `ADMIN_EMAIL`/`ADMIN_PASSWORD`
ที่ต้อง seed เสมอไม่ว่า environment ไหน เพราะเป็น bootstrap ที่จำเป็นต่อการใช้งานระบบ — ไม่มีทาง "ข้าม"
ได้เหมือนบัญชีทดสอบ) เพราะฉะนั้นถ้า deploy ด้วย `NODE_ENV=production` บัญชีนี้จะไม่ถูกสร้างเลยตั้งแต่ต้น
ไม่ต้องมาลบทีหลัง

## สิ่งที่ตั้งใจไม่ทำ (scope ที่ตัดออกเพื่อความง่าย)

- **ไม่มี public self-registration ด้วยรหัสผ่าน** — เจตนาให้เป็นระบบปิดที่ admin สร้าง user ด้วยรหัสผ่าน
  ให้เท่านั้น (`ระบบบริหารจัดการ user` ตามที่ระบุ requirement) **แต่ SSO เป็นข้อยกเว้นที่ตั้งใจ**: login
  ผ่าน Facebook/LINE/Keycloak/OIDC ครั้งแรกจะสร้าง account ให้อัตโนมัติ (self-service) เพราะ IdP ภายนอก
  เป็นคนยืนยันตัวตนแทนแล้ว — ยังคงต้องผ่าน 2FA บังคับเหมือน user ทุกคน ไม่ใช่ทางลัด
- ไม่มี "remember this device" / trusted device สำหรับข้าม 2FA — ตั้งใจให้ 2FA บังคับทุกครั้งที่ login
  แบบเข้มที่สุด ตรงตาม requirement "Force ทุก User" (รวม login ผ่าน SSO ด้วย)
- ไม่มี SMS/email OTP เป็น fallback (มีแต่ backup codes) — ลดความซับซ้อนของการต่อ third-party service
  ในตัวอย่างเพื่อการเรียนรู้
- Rate limiter ใช้ in-memory store ของ `express-rate-limit` (ไม่ผ่าน Redis) — พอสำหรับ instance เดียว
  ถ้าจะ scale เป็นหลาย instance ต้องเปลี่ยนไปใช้ shared store
- **Account lockout ไม่ครอบคลุม SSO login** (ดูเหตุผลเต็มในหัวข้อ SSO ด้านบน) — ตั้งใจ ไม่ใช่ช่องโหว่ที่ลืมปิด
- CI (`ci.yml`) รันแค่ variant ไม่มี Keycloak — ไม่ได้ตัดทิ้งเพราะมองว่า Keycloak flow ไม่สำคัญ แต่เพราะ
  ต้อง mock ฟอร์ม login ของ Keycloak ถึงจะ automate ได้ (ดู [CI-CD.md](CI-CD.md))

## ผลการสแกนความปลอดภัย

สแกนรอบแรก 2 รอบตามที่ requirement กำหนด (รอบ 1 ก่อนเพิ่ม SSO, รอบ 2 หลังเพิ่ม SSO) ด้วย `npm audit` +
[Semgrep](https://semgrep.dev) (`p/security-audit`, `p/secrets`, `p/javascript`, `p/nodejsscan`)
ผ่าน Docker image `semgrep/semgrep` (ไม่ต้องติดตั้งอะไรบนเครื่อง) ร่วมกับ manual review — คำสั่งเต็มอยู่ที่
[CI-CD.md](CI-CD.md#รันเหมือน-ci-บนเครื่องตัวเอง-ก่อน-push)

### รอบ 1 (ก่อนเพิ่ม SSO) — แก้แล้วทุกจุด

| จุดที่เจอ | เครื่องมือที่เจอ | การแก้ |
|---|---|---|
| `createCipheriv`/`createDecipheriv` (AES-256-GCM) ไม่ pin `authTagLength` | Semgrep (`gcm-no-tag-length`) | pin `authTagLength: 16` ทั้ง encrypt/decrypt + เช็คความยาว tag ก่อน `setAuthTag` |
| ทั้ง 2 Dockerfile ไม่ประกาศ `USER` (รันเป็น root) | Semgrep (`dockerfile.security.missing-user`) | เพิ่ม `chown -R node:node /app` + `USER node` |
| Login timing leak: ข้าม `bcrypt.compare` ถ้าไม่เจอ user ทำให้ตอบเร็วกว่า user ที่มีจริงแต่รหัสผ่านผิด | Manual review | เรียก `bcrypt.compare` เสมอ เทียบกับ `DUMMY_PASSWORD_HASH` ถ้าไม่มี user/ไม่มีรหัสผ่าน |
| `trust proxy` เปิดไว้ตลอด (`1`) ทั้งที่ไม่มี reverse proxy จริงหน้า backend | Manual review | เปลี่ยนเป็น `TRUST_PROXY` env var, default `false`, ให้ตั้งเป็นจำนวน hop เองเฉพาะตอนมี proxy จริง |
| `jwt.verify` ไม่ pin `algorithms` (พึ่ง default inference ของ library) | Manual review | pin `algorithms: ['HS256']` ทุกจุดที่ verify, `algorithm: 'HS256'` ตอน sign |
| Password field ไม่มี max length (bcrypt truncate เกิน 72 bytes แบบไม่มีใครรู้) | Manual review | เพิ่ม `.max(128)` ทุก schema ที่รับรหัสผ่าน/รหัสผ่านเดิม |
| Vite dev server เปิด CORS แบบ allow-all โดย default (`server.cors` default `true`) | `npm audit` (esbuild GHSA-67mh-4wv8-2f99, ทางอ้อม) | ตั้ง `server.cors: false` ใน `vite.config.js` — app นี้ไม่ต้องพึ่ง cross-origin request ถึง dev server เลย |

**Finding ที่ปล่อยผ่านโดยตั้งใจ** (`npm audit` ฝั่ง frontend — **แก้แล้วในรอบ 4** ด้วยการย้ายเป็น Svelte 5 +
Vite 8 ย่อหน้านี้เก็บไว้เป็นประวัติ): Svelte SSR XSS advisories (หลายตัว) กับ
esbuild dev-server CORS advisory ยังเจออยู่ในทุก patch ของ svelte@4.x/vite@5.x/esbuild@0.21.x ที่มี
(ไม่มี non-breaking patch ที่แก้ได้ — ต้อง major upgrade เป็น Svelte 5 + Vite 6+ ซึ่งเปลี่ยน reactivity
model ทั้งหมด นอกสโคปของงานนี้) ตรวจแล้วว่า **ไม่มี code path ที่ exploit ได้จริงในแอปนี้**: ไม่มีการเรียก
SSR (`svelte/server`) และไม่มีการใช้ `{@html ...}` ที่ไหนเลย (grep ยืนยันแล้ว) — SSR-XSS advisories ทั้งหมด
ต้องมี SSR ถึงจะ exploit ได้ ส่วน esbuild CORS advisory เฉพาะ `esbuild.serve()` ที่แอปนี้ไม่ได้เรียกตรง ๆ
(Vite ใช้ esbuild เป็น library ไม่ใช่ spawn server ของมันเอง) บันทึกไว้เป็นแนวทางต่อยอดใน README แทน

### รอบ 2 (หลังเพิ่ม SSO) — แก้แล้วทุกจุด

| จุดที่เจอ | เครื่องมือที่เจอ | การแก้ |
|---|---|---|
| Login ด้วย email ที่ตรงกับ user เดิมแต่ **ไม่ verified** จาก provider จะเอา email นั้นไปสร้าง user ใหม่ซ้ำ → ชน `UNIQUE` constraint ที่ DB (500 error) | Manual review + reproduce จริงด้วย Keycloak test user | แยก "ควร link ไหม" (ต้อง verified) ออกจาก "ควรใช้ email จริงกับ user ใหม่ไหม" (ใช้ได้ถ้าไม่ชนใคร) ดู `findOrCreateUserFromIdentity` |
| Admin สั่ง disable account แล้ว user ที่ link ไว้กับ Keycloak/Facebook/LINE ยัง login ผ่าน SSO เข้ามาได้อยู่ (เช็ค `status` แค่ path password login) | Manual review + reproduce จริง | เพิ่มเช็ค `user.status === 'disabled'` ใน `sso.controller.js`'s `handleCallback` ก่อนออก pre-auth cookie |
| Redirect ไป Keycloak's authorization_endpoint ใช้ internal host (`keycloak:8080`) ที่ browser resolve ไม่ได้ | เจอตอนรัน end-to-end จริงกับ Keycloak (ไม่ใช่ scanner) | internal/public issuer split ใน `oidcClient.service.js` (ดูหัวข้อ SSO ด้านบน) |
| `iss` callback parameter/`id_token` claim ไม่ตรงกับ configured issuer หลัง rewrite แค่ endpoint (ไม่ได้ rewrite `issuer` เอง) | เจอตอนรัน end-to-end จริงกับ Keycloak | เพิ่ม `issuer` เข้าไปใน field ที่ rewrite เป็น public origin ด้วย |
| Token exchange ล้มเหลวด้วย `invalid_grant: Incorrect redirect_uri` เพราะสร้าง `redirect_uri` จาก `req.get('host')` ที่ถูก Vite proxy เปลี่ยนเป็น `backend:4000` | เจอตอนรัน end-to-end จริงกับ Keycloak | สร้าง `redirect_uri`/`currentUrl` จาก `env.FRONTEND_ORIGIN` เสมอ ไม่ใช่จาก request object |

**False positive ที่ตรวจแล้วไม่ใช่ปัญหา**: Semgrep เจอ `DUMMY_PASSWORD_HASH` ใน `utils/password.js` เป็น
"hardcoded secret"/"bcrypt hash detected" — ค่านี้ไม่ใช่ credential จริง เป็น hash คงที่ที่ตั้งใจ hardcode
ไว้เพื่อให้ timing ของ `bcrypt.compare` เท่ากันทุก path (ดูหัวข้อ timing attack ด้านบน) เปิดเผยค่านี้ไม่ทำให้
ใครเข้าระบบได้ เพราะไม่ผูกกับ user จริงคนไหนเลย

### รอบ 3 (เพิ่ม Trivy image scanning เข้า CI) — แก้แล้วทุกจุดที่แก้ได้จริง

| จุดที่เจอ | เครื่องมือที่เจอ | การแก้ |
|---|---|---|
| `libssl3`/`libcrypto3` (OpenSSL) ของ Alpine base image เก่ากว่า patch ล่าสุด (`CVE-2026-45447`) | Trivy | เพิ่ม `RUN apk update && apk upgrade --no-cache` ในทั้ง 2 Dockerfile ให้ดึง OS package security patch ล่าสุดตอน build เสมอ |

**False positive ที่ตรวจแล้วไม่ใช่ปัญหา** (ยืนยันด้วยการเปิดเข้าไปดูใน image จริง ไม่ใช่เดา):

- npm CLI มี dependency ของตัวเอง (`tar`, `glob`, `minimatch`, `cross-spawn`, `sigstore`, ...) อยู่ใต้
  `/usr/local/lib/node_modules/npm/node_modules/` — เป็นของ npm ใช้ตอนติดตั้ง package เท่านั้น ไม่ใช่
  ของแอปเรา (แอปอยู่ที่ `/app/node_modules`) และไม่ถูกเรียกใช้ตอน container รันจริง (`npm run dev`
  แค่ spawn nodemon ไม่แตะ path การติดตั้ง/แตกไฟล์ที่ CVE พวกนี้อยู่) → ตัดออกจากการสแกนด้วย
  `--skip-dirs` ใน `ci.yml` แทนการ ignore เป็นราย CVE เพราะ base image จะมี CVE ใหม่ในกลุ่มนี้โผล่มา
  เรื่อย ๆ ทุกครั้งที่อัปเดต
- *(สองข้อด้านล่างเป็นประวัติ — exclusion ทั้งคู่ถูกลบออกแล้วในรอบ 4 เพราะ Vite 8 ไม่ใช้ esbuild และแก้ CVE
  ของ vite แล้ว)*
- `esbuild` (dependency ของ Vite) เป็น binary compile จาก Go — Trivy อ่าน Go stdlib module ที่ฝังอยู่
  ในตัว binary ได้ เจอ CVE ของ `net`/`net/http`/`net/mail` ของ Go ทั้งที่ esbuild ใช้แค่แปลงไฟล์ source
  ของเราเองในเครื่อง ไม่เปิด network service ที่ exercise code path พวกนั้นเลย → ตัดออกด้วย
  `--skip-files` เฉพาะ path ของ binary นั้น
- `vite` (dependency จริงของเรา) มี `CVE-2026-53571` (`server.fs.deny` bypass ผ่าน Windows alternate
  path) — exploit ต้องอาศัย Vite dev server รันบน Windows filesystem แต่ container นี้รันบน Linux
  เสมอไม่ว่า host จะเป็น OS ไหน จึงไม่มี code path ที่ exploit ได้จริงในการรันแบบนี้ (แก้ตรงจริง ๆ ต้อง
  major upgrade เป็น Vite 6+ ซึ่งต้องใช้ Svelte 5 — ติด constraint เดียวกับ esbuild/Svelte SSR ที่บันทึก
  ไว้ในรอบ 1) → บันทึกไว้ใน `frontend/.trivyignore` พร้อมเหตุผลกำกับ ไม่ใช่ปล่อย
  เงียบ ๆ

### รอบ 4 (Snyk + manual review ของโค้ดล่าสุด) — แก้แล้วทุกจุดที่แก้ได้จริง

Snyk เชื่อมกับ repo ผ่าน GitHub integration (ผลมาจาก PR ที่ Snyk เปิด #1–#4) — Snyk CLI กับ Semgrep registry
รันใน sandbox ตอนพัฒนารอบนี้ไม่ได้เพราะ network policy บล็อก จึงใช้ผลจาก PR ของ Snyk + log ของ CI run ล่าสุด
แทน แล้วยืนยันว่า `// nosemgrep` กดทับได้จริงด้วย semgrep ในเครื่อง + rule จำลอง

| จุดที่เจอ | เครื่องมือที่เจอ | การแก้ |
|---|---|---|
| `qs` (ผ่าน express/body-parser) DoS 2 ตัว (`SNYK-JS-QS-19432017`, `-19432019`) | Snyk (PR #1 เสนอ Express 5, Merge Risk: High) | แก้ก่อนด้วย `express@4.22.3` (ดึง `qs@6.16.0` ที่แก้แล้ว, non-breaking) แล้วย้ายเป็น Express 5 ใน commit แยกหลังทดสอบครบ (ดูด้านล่าง) |
| `morgan` log injection ผ่าน `:remote-user` (`SNYK-JS-MORGAN-19432128`) | Snyk (PR #4) | `morgan@^1.12.0` |
| `proxy-addr` IP spoofing ผ่าน IPv4-mapped IPv6 (critical), `brace-expansion` DoS | `npm audit` | `npm audit fix` (non-breaking) |
| `braces` DoS ผ่าน `nodemon` → `chokidar@3` — ไม่มีเวอร์ชันแก้ของ `braces` เลย | `npm audit` | `overrides: { chokidar: ^4 }` ใน `backend/package.json` (chokidar 4 ไม่ใช้ `braces`) + ต้องตั้ง `pollingInterval` ใน `nodemon.json` (nodemon ส่ง `interval: undefined` ให้ chokidar 4 ตอน `legacyWatch` แล้ว crash) — ทดสอบแล้วว่าแก้ไฟล์แล้ว nodemon restart ปกติ |
| `nanoid`, `source-map-js` DoS (frontend) | `npm audit` + Trivy (CI แดงอยู่) | `npm audit fix` (non-breaking) |
| `openid-client`/`pg` ตามหลัง patch ล่าสุด (ไม่มี CVE) | Snyk (PR #2, #3) | อัปเดตไปพร้อมกัน |
| Semgrep `good_helmet_checks` 6 ตัว — rule ประเภท "good" ที่รายงานว่า helmet **ตั้ง** header ให้แล้ว แต่ถูกนับเป็น blocking ภายใต้ `--error` (CI แดงอยู่) | Semgrep | `// nosemgrep` บรรทัดเดียวก่อน `app.use(helmet())` พร้อมเหตุผล |
| `DUMMY_PASSWORD_HASH` — false positive ที่บันทึกไว้ตั้งแต่รอบ 2 แต่ยังทำ CI แดงอยู่ | Semgrep | `// nosemgrep` บรรทัดเดียวพร้อมเหตุผล |
| โค้ด TOTP ใช้ซ้ำได้ภายใน ~90 วินาที (replay) | Manual review | จำ time-step ล่าสุด (`totp_last_used_step`) ดูหัวข้อการไหลของ 2FA |
| ไม่มี lockout ต่อบัญชีสำหรับโค้ด 2FA — มีแต่ rate limit ต่อ IP | Manual review | `failed_2fa_attempts`/`twofa_locked_until` แยกจาก password lockout |
| `verify`/`setup/confirm` ไม่เช็คว่า user ถูก disable ไประหว่างอายุ pre-auth cookie และ crash (500) ถ้า user ถูกลบ | Manual review | `loadPreAuthUser()` |
| Backup code / refresh token rotation มี race (SELECT แล้ว UPDATE แยกกัน) — request พร้อมกันใช้ของชิ้นเดียวกันได้ 2 ครั้ง | Manual review | conditional `UPDATE ... WHERE used_at/revoked_at IS NULL` + เช็ค `rowCount` (ทดสอบยิงพร้อมกันแล้ว: ผ่านแค่ตัวเดียว) |
| เปลี่ยนรหัสผ่านแล้ว refresh token ของเครื่องอื่นยังใช้ต่อได้ | Manual review | `revokeAllForUser` + ออก session ใหม่ให้เครื่องนี้ |
| `/refresh` ออก access token ให้ user ที่ถูก disable/ลบไปแล้ว (crash 500 ถ้าถูกลบ) | Manual review | เช็ค user ก่อนออก token, ถ้า disabled revoke ทั้งหมด |
| `/change-password` ไม่มี rate limit (ใช้ session ที่ขโมยมาเดารหัสเดิมได้ไม่จำกัด) | Manual review | ใส่ `loginLimiter` |
| `:id` ของ admin route ไม่ validate — id ผิดรูปได้ 500, id ตัวพิมพ์ใหญ่เลี่ยง guard ห้ามลด role ตัวเองได้ | Manual review | `parseUserId()` (zod uuid + lowercase) |
| SSO callback log `req.query.error` ดิบ ๆ → log injection (CR/LF) | Manual review | `sanitizeProviderError()` เหลือแค่ `[\w.-]`, ยาวไม่เกิน 64 |

**Frontend ย้ายเป็น Svelte 5 + Vite 8 + `@sveltejs/vite-plugin-svelte` 7 + `svelte-spa-router` 5** — advisory
ที่เหลือทั้งหมดฝั่ง frontend (Svelte SSR/DOM-clobbering XSS, esbuild dev-server CORS, `vite` `server.fs.deny`
bypass ระดับ high ที่ทำ CI แดงอยู่บน `main`) ไม่มี patch ใน Svelte 4/Vite 5 แล้ว `npm audit` ฝั่ง frontend
หลังย้ายเหลือ 0 ตัว โค้ดที่ต้องแก้มีแค่ 2 จุด:

- `main.js`: `new App({ target })` → `mount(App, { target })` (Svelte 5 component เป็น function ไม่ใช่ class)
- `App.svelte`: `<Router on:conditionsFailed=...>` → `onConditionsFailed=...` (svelte-spa-router 5 ใช้ callback
  prop แทน component event)

จากนั้นแปลงทุก component เป็น **runes** (`$state`/`$derived`, event attribute `onclick`/`onsubmit` แทน
`on:` directive) และบังคับ `compilerOptions.runes: true` ใน `vite.config.js` — syntax แบบ Svelte 4 ที่หลงเหลือจะ
compile ไม่ผ่านทันที ไม่ใช่แอบรันใน legacy mode ส่วน modifier `|preventDefault`/`|self` ที่ Svelte 5 ไม่มีแล้ว
แทนด้วย wrapper เล็ก ๆ ใน `frontend/src/lib/events.js` store เดิม (`svelte/store` + `$authStore`) ใช้ต่อได้ใน
runes mode จึงไม่ได้แปลง Vite 8 ต้องใช้ Node `^20.19 || >=22.12`
(`node:20-alpine` ตอนนี้เป็น 20.20) และใช้ rolldown แทน esbuild จึงลบ `skip-files` ของ esbuild กับ
`frontend/.trivyignore` ออกจาก CI

**Backend ย้ายเป็น Express 5** (`express@^5`, body-parser 2) — ไม่มีโค้ดที่ใช้ API ที่ถูกถอดออก (`req.param()`,
`res.redirect('back')`, wildcard `*` แบบไม่มีชื่อ, การเขียนทับ `req.query`) สิ่งที่เปลี่ยนพฤติกรรมจริงมีแค่ `req.body`
เป็น `undefined` (ไม่ใช่ `{}`) เมื่อไม่มี body ซึ่ง zod schema ทุกตัวปฏิเสธเป็น 400 เหมือนเดิม `asyncHandler` ยังเก็บไว้
แม้ Express 5 จะส่ง promise rejection เข้า error handler เองแล้ว (ไม่มีผลเสีย และไม่ต้องไล่แก้ทุก controller)

`error.middleware.js` ตอบ 4xx ตาม `err.status` สำหรับ error ของ Express/body-parser เองที่ `expose: true` (JSON เสีย →
400, body ใหญ่เกิน → 413) — เดิม (ทั้ง Express 4 และ 5) ตกไปเป็น 500 + log "Unexpected error" ทำให้ใครก็ยิง JSON
เสียมาให้ log เต็มได้

**Regenerate backup codes ต้อง step-up ด้วยโค้ด TOTP** (`POST /2fa/backup-codes/regenerate` รับ `{ code }`) —
backup codes คือ credential ข้าม 2FA ที่อยู่ได้นาน ถ้าใช้แค่ session ก็ออกให้ได้ คนที่ขโมย session cookie ไปจะแปลง
session ชั่วคราวเป็นสิทธิ์ข้าม 2FA ถาวรได้ ตั้งใจรับเฉพาะ TOTP ไม่รับ backup code (ต้องพิสูจน์ว่ายังถือเครื่องอยู่)
ผ่าน `verifyTotpCode` ตัวเดียวกับ login (มี replay protection) ผิดแล้วนับเข้า 2FA lockout ตัวเดียวกัน และมี
`twoFaLimiter`

## การทดสอบที่ทำไปแล้ว

Build และรันผ่าน `docker compose` จริงบน Docker Desktop (ทั้ง 2 variant: มี/ไม่มี Keycloak) แล้วทดสอบผ่าน
`curl` ครบทุก flow หลัก — เขียนเป็น script อัตโนมัติแล้วที่ [scripts/smoke-test.sh](scripts/smoke-test.sh)
(รันใน CI ทุก PR ด้วย):

- login → forced setup (QR/secret → TOTP confirm) → backup codes ออกให้ 10 ชุด → session cookie →
  `/auth/me` → change password → admin create user (`manager`/`user`) → RBAC ปฏิเสธ `user` ที่เรียก
  `/admin/users` (403) → account lockout หลังผิดรหัส 5 ครั้ง → admin reset password ปลดล็อกได้ → login
  ด้วย backup code สำเร็จและใช้ซ้ำไม่ได้ → refresh token rotation → logout แล้ว `/auth/me` เป็น 401
- รอบ 4: smoke test เพิ่ม assertion — เปลี่ยนรหัสผ่านแล้ว session เก่าถูก revoke, refresh token ที่ rotate
  แล้วใช้ซ้ำโดน revoke ทั้ง family, TOTP replay ถูกปฏิเสธ, backup code ใช้ซ้ำไม่ได้, โค้ดผิด 5 ครั้งล็อก 2FA
  (403) — รันผ่านครบกับ backend จริง + Postgres 16 (ใน sandbox รอบนี้ build image ไม่ได้เพราะ `apk` ออก
  network ไม่ได้ จึงรัน backend ด้วย node ตรง ๆ แทน container) ทดสอบมือเพิ่ม: refresh พร้อมกัน 2 request ผ่าน
  แค่ตัวเดียว, โค้ด TOTP ของ step ถัดไปใช้ได้ปกติ, admin route กับ id ผิดรูปได้ 404, uppercase id ของตัวเองโดน
  guard (409)
- รอบ 4 (หลังย้าย Svelte 5 + Vite 8): `vite build` ผ่าน, smoke test ผ่านครบผ่าน Vite 8 dev proxy, และทดสอบ UI
  จริงด้วย Playwright (Chromium) ครบ flow: guard ส่งคนไม่ login ไป `/login` → login → บังคับตั้ง 2FA (QR +
  secret) → backup codes 10 ชุด → บังคับเปลี่ยนรหัสผ่าน → dashboard → หน้า users (สร้าง user ผ่าน modal) →
  audit log → profile → logout → user ใหม่ทำ flow เดียวกัน → RBAC guard ส่งไป `/unauthorized` — ไม่มี JS error
  ในหน้าเว็บ (มีแค่ 401 ของ `/auth/me` ตอนยังไม่ login กับ 404 ของ `/favicon.ico` ซึ่งเป็นแบบนี้อยู่แล้ว)
- ทุก Svelte component ยืนยันแล้วว่า compile ผ่าน Vite ได้ไม่มี error (`curl` แต่ละไฟล์ได้ HTTP 200)

ทดสอบ SSO/Keycloak แบบ end-to-end จริงด้วย `curl` (จำลอง browser: ตาม redirect, submit ฟอร์ม login ของ
Keycloak, ตาม callback กลับ) ครบทุก branch ของ `findOrCreateUserFromIdentity`:

- User ใหม่ที่มี verified email → สร้าง account ใหม่ ตกไป stage `setup` (บังคับตั้ง 2FA) → login รอบสอง
  ด้วย identity เดิม → ตกไป stage `verify` (ไม่ใช่ `setup` ซ้ำ) ถูก
- Email verified ตรงกับ user ที่ admin สร้างไว้ก่อนแล้ว → link identity เข้า user เดิม (ไม่สร้างซ้ำ,
  ไม่เปลี่ยน password ที่มีอยู่)
- Email **ไม่ verified** ตรงกับ user ที่มีอยู่ → ไม่ link, ไม่ crash, สร้าง user ใหม่แยกด้วย placeholder
  email แทน (ยืนยันแล้วว่า user เดิมไม่ถูกแก้ไข)
- Provider ไม่ส่ง email มาเลย → ใช้ placeholder `<provider>.<sub>@sso.local` (ทดสอบ logic ตรง ๆ ผ่าน
  node script เพราะ Keycloak's required-action ฝั่ง UI ขวางไม่ให้ทดสอบผ่าน browser flow ได้)
- Account ที่ admin สั่ง disable → SSO login ถูกปฏิเสธ (`error=sso_denied`) ไม่ออก pre-auth cookie ให้

ทดสอบทั้ง 2 docker-compose variant (มี/ไม่มี Keycloak) ว่า build และ boot ผ่านทั้งคู่, `docker compose
down -v` แล้ว migration/seed รันซ้ำได้ถูกต้องจากฐานข้อมูลเปล่า
