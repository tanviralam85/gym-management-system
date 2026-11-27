# Lion Gym

Lion Gym is a responsive gym management app. Product rules and the implementation roadmap are in [the development blueprint](comprehensiveplan.md).

## Local development

After cloning, open the project folder in VS Code. With Node.js 24 (minimum 24.19.0) and npm 11.17.0 installed, run one command from the repository root.

```powershell
npm.cmd run dev
```

On macOS or Linux, use `npm run dev`. The first run needs internet access to install the locked dependencies, including the packaged PostgreSQL runtime. The launcher creates a local `.env`, initializes PostgreSQL, applies checked-in migrations, and starts the API and web app. No separate PostgreSQL server or shared database credentials are needed.

Wait for **Lion Gym is ready**, then open [the local web app](http://127.0.0.1:5173). On the first run, open `.local/owner-first-login.txt` in VS Code. Sign in as `lion.owner` with the temporary password from the file and change it when prompted. Keep `.env` and the first-login file private.

Press **Ctrl+C** in the same terminal to stop the services. Windows may ask you to confirm with **Y**. Your data stays in `.local/postgres-data`, and subsequent starts reuse your Owner account. Stop any separately running Lion Gym processes before using the launcher.

The packaged database runtime is supported on [the platforms listed by Embedded Postgres](https://github.com/leinelissen/embedded-postgres#postgresql-versions). Use the manual setup below if your platform needs a separately managed database.

### Independently managed database

Use Node.js 24 (minimum 24.19.0) and npm 11.17.0. Install from the repository root.

```powershell
npm.cmd ci
npm.cmd run db:generate
```

Copy `.env.example` to `.env`. Set `DATABASE_URL` to an isolated PostgreSQL development database you control. The API defaults to port 3000. Keep `WEB_ORIGIN` equal to the exact origin of the web app. If you change either port, restart the servers and update the origin as needed.

Apply the schema, build the API, and create the first Owner.

```powershell
npm.cmd run db:migrate
npm.cmd run build:api
npm.cmd run auth:bootstrap-owner -- lion.owner
```

The bootstrap command prints a temporary password once. Keep it private. Sign in with that password, set a new one, then sign in again.

Run these commands in separate terminals, both from the repository root.

```powershell
npm.cmd run dev:api
```

```powershell
npm.cmd run dev:web
```

Open [the local web app](http://127.0.0.1:5173) to sign in. Vite proxies same-origin API requests to NestJS. Restart the API command after changing its source.

### Authentication slice

The API provides sign-in, sign-out, session lookup, and password change under `/api/v1/auth`. An authenticated Owner who has changed their temporary password can list and provision accounts at `/api/v1/users`. A JSON POST with a `username` and a `role` of `STAFF` or `TRAINER` returns a generated temporary password once. Make the request from the same origin as the signed-in browser so it carries the Owner's session cookie. Staff and Trainer accounts must change their temporary passwords before normal use.

Local defaults are a 12–128 character password, a 30-minute idle session limit, and an eight-hour absolute limit. Password changes revoke all existing sessions for the account. Set `NODE_ENV=production` for Secure cookies on an HTTPS deployment.

Owner recovery email, account disable/reset controls, and account management screens are outside this slice.

### Members and membership plans

After updating an existing checkout, run `npm.cmd run db:generate` and `npm.cmd run db:migrate` before restarting the API. Signed-in Owners and Staff can find and register members. A shared family number requires explicit confirmation after the directory identifies who already uses it. Owners can create, edit, and deactivate membership plan templates from **Membership plans**.

### Membership purchases and payments

From **Members**, open a member’s **Membership and dues** screen, or use **Save and add membership** during registration. Choose **Buy or renew membership** or **Collect existing dues**, enter the amount received, and review the dates, oldest-first allocation, and remaining balance before confirming. Use **UPI already received** for an external UPI payment. An unpaid new plan needs a due date. A purchase with zero collected has no payment receipt.

If confirmation is interrupted, use **Retry same request**. It returns the original result if the request already saved. After a reload in the same tab, **Check and resolve attempt** opens that result or closes an unsaved attempt before a replacement can be entered. Recent receipts can be reopened and printed from the member’s billing screen.

An Owner can open **Owner adjustments** on the member’s billing screen. Each adjustment requires a reason, a preview, and the Owner’s current password. Corrections preserve the original collector and effective date and link the original and replacement receipts. Backdated payments allocate against dues open when entered. Refunds target a specific receipt allocation. Queued cancellations remove the charge and require confirmation of any linked amounts already returned outside the app. Receipt snapshots remain available alongside current dues and adjustment history.

## Checks

```powershell
npm.cmd run check
npm.cmd run build
Invoke-RestMethod http://127.0.0.1:5173/api/v1/health
```

The last command assumes both development servers are running and should return `status: ok`.

The health endpoint checks that the API responds. Sign in to exercise the PostgreSQL connection.
