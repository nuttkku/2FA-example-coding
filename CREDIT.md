# Credits / Acknowledgments

โปรเจกต์นี้สร้างขึ้นด้วยความช่วยเหลือของ [Claude Code](https://claude.com/claude-code) (Anthropic)
และใช้ open-source software / บริการต่อไปนี้ ขอขอบคุณผู้พัฒนาและ maintainer ของทุกโครงการ

## Runtime & ภาษา

| ชื่อ | ใช้ทำอะไร |
|---|---|
| [Node.js](https://nodejs.org) 20 | JavaScript runtime ของ backend และเครื่องมือ build ฝั่ง frontend |
| [PostgreSQL](https://www.postgresql.org) 16 | ฐานข้อมูล |
| [Docker](https://www.docker.com) / [Docker Compose](https://docs.docker.com/compose/) | รันทั้งระบบเป็น container |

## Backend (Node.js / Express)

| Package | ใช้ทำอะไร |
|---|---|
| [express](https://expressjs.com) | HTTP server / routing |
| [pg](https://node-postgres.com) | PostgreSQL client |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | Hash รหัสผ่าน/backup codes |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | ออก/ตรวจ JWT (pre-auth, access, refresh, sso_state cookie) |
| [otplib](https://github.com/yeojz/otplib) | สร้าง/ตรวจโค้ด TOTP สำหรับ 2FA |
| [qrcode](https://github.com/soldair/node-qrcode) | สร้าง QR code ตอนตั้ง 2FA |
| [openid-client](https://github.com/panva/openid-client) | OIDC client (ใช้ร่วมกันสำหรับ Keycloak, LINE, generic OIDC) |
| [zod](https://zod.dev) | Validate request body / environment variables |
| [helmet](https://helmetjs.github.io) | ตั้งค่า security header เริ่มต้น |
| [cors](https://github.com/expressjs/cors) | CORS middleware |
| [cookie-parser](https://github.com/expressjs/cookie-parser) | อ่าน cookie จาก request |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | Rate limit endpoint login/2FA |
| [morgan](https://github.com/expressjs/morgan) | HTTP request logging |
| [dotenv](https://github.com/motdotla/dotenv) | โหลดตัวแปรจากไฟล์ `.env` |
| [nodemon](https://nodemon.io) | Auto-restart backend ตอนพัฒนา |

## Frontend (Svelte / Vite)

| Package | ใช้ทำอะไร |
|---|---|
| [Svelte](https://svelte.dev) 4 | UI framework |
| [Vite](https://vitejs.dev) | Dev server / build tool (รวมถึง dev proxy ไป backend) |
| [@sveltejs/vite-plugin-svelte](https://github.com/sveltejs/vite-plugin-svelte) | ผนวก Svelte เข้ากับ Vite |
| [svelte-spa-router](https://github.com/ItalyPaleAle/svelte-spa-router) | Client-side routing แบบ hash-based |

## Identity Providers / SSO

| ชื่อ | ใช้ทำอะไร |
|---|---|
| [Keycloak](https://www.keycloak.org) | Self-hosted OIDC identity provider (รันเป็น addon container ผ่าน `docker-compose.keycloak.yml`) |
| [Facebook Login](https://developers.facebook.com/docs/facebook-login) | OAuth 2.0 SSO provider |
| [LINE Login](https://developers.line.biz/en/docs/line-login/) | OIDC SSO provider |

## เครื่องมือความปลอดภัย / CI-CD

| ชื่อ | ใช้ทำอะไร |
|---|---|
| [npm audit](https://docs.npmjs.com/cli/commands/npm-audit) | สแกนช่องโหว่ของ dependency |
| [Semgrep](https://semgrep.dev) (ruleset `p/security-audit`, `p/secrets`, `p/javascript`, `p/nodejsscan`) | Static analysis หา pattern ที่เป็นช่องโหว่ในโค้ด |
| [Trivy](https://trivy.dev) (Aqua Security) | สแกนช่องโหว่ของ container image ที่ build เสร็จ (OS package + dependency) |
| [GitHub Actions](https://github.com/features/actions) | รัน CI (audit/scan/build/smoke test) และ CD (publish image) |
| [GitHub Container Registry (GHCR)](https://ghcr.io) | เก็บ image ที่ publish จาก CD pipeline |

## GitHub Actions ที่ใช้ใน workflow

| Action | ใช้ทำอะไร |
|---|---|
| [actions/checkout](https://github.com/actions/checkout) | Checkout โค้ดในแต่ละ job |
| [actions/setup-node](https://github.com/actions/setup-node) | ติดตั้ง Node.js ใน CI |
| [aquasecurity/trivy-action](https://github.com/aquasecurity/trivy-action) | รัน Trivy image scan ใน CI |
| [docker/login-action](https://github.com/docker/login-action) | Login เข้า GHCR ตอน publish |
| [docker/setup-buildx-action](https://github.com/docker/setup-buildx-action) | ตั้งค่า Docker Buildx สำหรับ build image |
| [docker/build-push-action](https://github.com/docker/build-push-action) | Build + push image ขึ้น GHCR |

## Container base image

| ชื่อ | ใช้ทำอะไร |
|---|---|
| [node:20-alpine](https://hub.docker.com/_/node) | Base image ของ backend และ frontend container |
| [postgres:16-alpine](https://hub.docker.com/_/postgres) | Base image ของ database container |
| [quay.io/keycloak/keycloak](https://quay.io/repository/keycloak/keycloak) | Base image ของ Keycloak addon container |
