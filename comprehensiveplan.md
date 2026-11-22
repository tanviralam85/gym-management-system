# Gym Management System — Development Blueprint

Document date: 16 November 2026 (Asia/Kolkata)

Status: Approved product decisions consolidated into an implementation blueprint. No application code or scaffolding is included in this task. This document is the master reference for implementation, acceptance, installation, and maintenance.

## 1. Decision status and how to use this document

- **DECIDED:** Explicitly agreed during the product interview.
- **ASSUMPTION:** A proposed implementation default filling a remaining gap. Confirm before implementing the affected workflow; do not silently treat it as an interview decision.
- **PRE-LAUNCH CHECK:** Evidence required before the applicable release gate. A synthetic-data demonstration may precede commercial readiness.
- **OPEN RISK:** An unresolved issue with potential business, security, cost, or correctness impact.

Implementation must preserve the decided product scope. If a proposed change conflicts with this document, record the conflict and obtain a product decision before changing behavior. Low-level implementation details may evolve without expanding scope.

## 2. Product, market, and commercial model

### 2.1 Product objective

Provide a polished, reliable system that saves gym owners time, makes membership and payment records trustworthy, and supports everyday front-desk work.

Initial customers are small and medium single-location gyms in India, starting in Bihar, with approximately 50–500 active members and 2–10 staff/trainers. Priorities, in order:

1. Accurate memberships, payment history, dues, renewals, and expiry dates.
2. Fast registration, membership purchase, payment collection, and renewal.
3. Daily attendance and actionable membership/dues follow-up.

### 2.2 Installation and ownership model — DECIDED

- Maintain one private GitHub master product repository.
- Each gym has its own application deployment, backend, PostgreSQL database, authentication records, secrets, and business configuration.
- No shared customer database, centralized SaaS control plane, tenant switching, or developer super-admin panel.
- Gym name, logo, branding, business details, admission fee defaults, and plans are configuration rather than code forks.
- Clients own and pay for domains, hosting, database, storage, and other service accounts. The developer handles initial provisioning.
- Sell a one-time setup plus annual maintenance/support. Infrastructure charges remain distinct and transparent.
- Shared useful features enter the master product. Exceptional client-specific development requires separate pricing and an explicit maintenance decision.

### 2.3 Budget and timeline

- Target a working pilot in 1–2 weeks, flexibly. This is not a promise of commercial readiness.
- Prefer free services for development and demonstrations.
- Approximately ₹1,500/month per installation is an operating target, not a verified quote or guaranteed ceiling.
- If reliable production operation exceeds this amount, retain demo/pilot-only status until the owner agrees to a suitable commercial arrangement. Do not silently subsidize overruns.
- One pilot gym first; expand only after operational validation.

## 3. Scope

### 3.1 Included in v1 — DECIDED

- Responsive browser application for desktop, laptop, tablet, and mobile, including Android browsers.
- Owner, Staff, and Trainer individual accounts with fixed roles.
- Member registration, editing, search/filtering, archival, trainer assignment, and profiles.
- Configurable calendar-month and custom-day gym-access plans; optional admission fee.
- Membership purchase, full/partial payments, due dates, renewals, one future queued renewal, expiry extensions, and owner cancellation.
- Manual cash, externally received UPI, and bank-transfer recording; optional reference IDs.
- Owner-only financial corrections, reversals, refunds, discounts, and backdating with preserved history.
- Manual daily attendance and recorded expired-membership overrides.
- Manual WhatsApp follow-up, contact history, and contact opt-out.
- Basic trainer notes and restricted assigned-member visibility.
- Dashboard, core reports, own-staff collections, owner-wide collections, and CSV exports.
- CSV onboarding for existing members, current memberships, and opening dues.
- A4 browser-printable receipts; users may use the browser's Save as PDF feature.
- Private uploads, account recovery, audit records, operational monitoring, backups, and tested recovery.

### 3.2 Deferred

Native Android/iOS apps; member login/portal; multiple branches; online payment gateways; webhooks; automated SMS/WhatsApp and daily summary emails; offline writes/synchronization; QR attendance; workout builders, detailed fitness progress, diet plans, AI, complex schedules; PT packages, lockers, merchandise; formal freezes; transfers; prorated upgrades; multiple queued renewals; installment schedules; member credit/overpayments; formal GST invoice functionality; Hindi UI; XLSX import; thermal layouts and direct printer integration; cash drawers, opening floats, expenses, and shift handovers; granular per-user permission builders.

### 3.3 Explicit non-goals

This is not accounting software, bank/UPI settlement verification, payroll, an expense ledger, or a guarantee that staff-entered payment records equal money actually received. Owners manually reconcile physical cash and external bank/UPI statements against reports.

## 4. Users, permissions, and account lifecycle

### 4.1 Permission matrix

| Capability | Owner | Staff | Trainer |
|---|---|---|---|
| Register/edit members | Yes | Yes, ordinary details | No |
| Read member directory | All, including archive | Operational directory, archive lookup | Assigned members only |
| View phone/photo/validity/attendance | Yes | Yes | Assigned members only |
| View member payments and dues | Yes | Yes | No |
| Standard sales/renewals/payments | Yes | Yes | No |
| Check-in / allow expired entry | Yes | Yes, recorded override | No |
| Assign primary trainer | Yes | Yes | No |
| Plain text trainer notes | Yes | See assumption below | Own assigned-member notes |
| Discount / admission waiver / date override | Yes, reauthenticate | No | No |
| Correction/refund/cancellation/backdating | Yes, reauthenticate | No | No |
| Plans/settings/account administration | Yes | No | No |
| Personal daily collection report | Yes | Own only | No |
| All-staff reports, bulk exports | Yes | No | No |
| Member archival | Yes | ASSUMPTION: No | No |

ASSUMPTION: Owners can read all trainer notes; staff cannot read or edit trainer notes unless later justified. Trainers may append notes while assigned; historical note authorship remains. Reassignment immediately removes the former trainer's access. Define whether the new trainer sees previous notes before implementing this feature; default to a visible shared history within the member profile.

### 4.2 Provisioning and recovery

1. Developer provisions the independent gym and initial owner through a controlled installation procedure.
2. Owner changes the temporary password and configures/verifies a recovery email.
3. Owner creates individual username/password Staff and Trainer accounts; no public signup.
4. Multiple owners with identical permissions are permitted when partners need access. No shared credentials.
5. Owners create/disable accounts and reset staff/trainer passwords. Temporary credentials require change on next login.
6. Owner recovery uses expiring, single-use email tokens. Never email an existing password.
7. Sensitive operations require fresh authentication in the owner's own session, not the owner's password typed into a staff session.

ASSUMPTIONS: Normalize usernames case-insensitively and enforce installation-wide uniqueness; revoke existing sessions on disable/reset; prevent removal or disabling of the last active owner. Owner recovery email is required before real-data use. Exact password length policy, reauthentication lifetime, session idle/absolute limits, owner MFA, and recovery escalation are security-design checks before implementation. MFA is not an interview-confirmed feature; evaluate its cost/effort before commercial launch.

## 5. Business rules and financial model

### 5.1 Member identity and registration

- Required: full name and Indian mobile number. Store a normalized representation suitable for +91 WhatsApp links; display a familiar local format.
- Duplicate mobile numbers produce a warning identifying existing members; explicit family-sharing confirmation permits saving.
- Assign a unique installation-scoped member number independent of phone number.
- Optional: date of birth, gender, address, photo, emergency contact, guardian name/contact.
- Avoid medical information. Trainer notes are operational plain text, not a medical-record system.
- Archive rather than hard-delete members with linked business records. Archive state is separate from membership expiry.
- Contact opt-out suppresses reminder actions and default follow-up lists; its changes are recorded.

ASSUMPTION: Name and phone can be saved before purchasing a plan, so interrupted registration does not require fabrication of a payment. The UI offers “Save and add membership.” A member may buy access with zero initial payment, provided the charge has a due date. Confirm this last rule before implementing sales validation.

### 5.2 Plans and admission fees

- Plan template: name, duration type (calendar months or days), positive integer duration, INR price, active/inactive flag.
- Monthly/quarterly/half-yearly/yearly templates are configuration, not hardcoded product variants.
- Purchases snapshot name, price, duration, dates, and discounts; changing/deactivating a template never rewrites prior purchases.
- Staff sells standard configured prices. Owner-only discounts record amount, reason, actor, and original price; never allow negative resulting charges.
- Admission fee is suggested once at first registration. A returning member can be charged again or waived by the owner explicitly.

ASSUMPTION: Currency arithmetic uses integer paise throughout; no floating-point money. Rates are tax-exclusive only in the sense that no tax calculation is implemented: receipts must not imply GST tax-invoice compliance. Decide required tax treatment with each real pilot before financial use.

### 5.3 Membership dates — DECIDED

Dates are local business dates in Asia/Kolkata; events/audits also retain absolute timestamps. A displayed expiry is inclusive through that local day.

| Scenario | Accepted behavior |
|---|---|
| First calendar-month purchase | 10 June starts, 10 July expires, both dates inclusive |
| Early/uninterrupted monthly renewal | 11 July starts, 10 August expires |
| Month-end anniversary | Preserve anchor: 31 January → 28/29 February → 31 March |
| Custom 7-day purchase starting 1 June | 1–7 June inclusive |
| Renewal after a gap | Default start is payment/purchase business date; reset calendar anchor |
| Manual override | Owner-only, mandatory reason and preview |

The accepted first calendar-month period intentionally includes the anniversary date. Do not replace it with an anniversary-minus-one convention without a product decision.

- At most one current entitlement and one queued renewal. No overlapping periods.
- Active/queued/expired entitlement is derived from stored dates and cancellation state; correctness must not depend on a midnight scheduler.
- An early renewal creates a separate future period, not a destructive edit to the current purchase.
- Active renewal extends the prior expiry by the purchased month/day duration; starts the day after prior expiry.
- Owner extension requires a reason. If a queued renewal exists, preview shifting both its dates by exactly the extension's day count, preserving its paid interval.
- Paid queued plan/price changes require cancellation/adjustment and replacement purchase. Date-only changes are audited and cannot create overlap.

PRE-IMPLEMENTATION CHECK: Define shifted calendar anchors explicitly. Proposed ASSUMPTION: an extension shifts stored queued dates by calendar days without recomputing the interval; subsequent month renewals use the shifted expiry day as the new anchor, with end-of-month clamping. Confirm with worked examples before implementing. Also confirm handling a queued start moved later with a gap: preserve the paid interval and show the gap clearly.

### 5.4 Charges, payments, dues, and FIFO

- Distinguish the sale/charge from money received and membership entitlement.
- Each purchase may create membership and admission charge lines, with its agreed due date. Imported opening dues are a separate charge type.
- Partial/full payments allocate to the member's oldest outstanding charge first. New purchases do not erase old debt.
- Renewal with debt is allowed and prominently warned. No owner approval is needed solely for carrying debt.
- Reject a payment larger than the member's total outstanding balance; return physical change. No stored credit.
- Payment methods: cash, UPI, bank transfer. Optional reference ID is evidence entered by staff, not verified settlement.
- Staff records today's business date only. Owners may backdate with a reason; actual creation timestamp never changes.
- Store the recording actor separately from effective business date. Historical reports show when backdated records were entered.
- A saved payment returns a unique receipt number. Receipt-number gaps are acceptable; numbers are never reused.

ASSUMPTIONS: Require a due date whenever a purchase remains unpaid; fully paid purchases need no debt follow-up date. FIFO order is charge business date then stable creation order/ID. Owner backdating does not silently reshuffle previously posted allocations; the new payment allocates against outstanding charges at posting time. Confirm admission-vs-membership line ordering and backdated-report expectations using concrete examples.

### 5.5 Corrections, refunds, cancellation

All require owner authorization, recent reauthentication, a reason, a preview, and a linked audit trail.

- Correction: retain original payment and allocations; post an explicit reversal and corrected replacement in one transaction. Do not silently edit amounts or delete history.
- Refund: a new record for actual money returned, linked to the original receipt/payment and its allocations. Returning money alone may reopen dues; reducing a charge is a separate explicit action.
- Cancellation: owner chooses entitlement termination and explicit charge reduction/cancellation. Show previous/new dues and any money requiring refund before confirming.
- A paid queued purchase can be cancelled before its start and replaced using the same controlled process.
- No automatic prorating, self-service refunds, or automatic online fund movement.
- Refund amount cannot exceed the refundable amount on the referenced payment after earlier refunds/reversals.
- Charge reductions cannot exceed remaining non-cancelled charge value. Reject impossible/negative states.

OPEN RISK: Reducing a fully paid charge can create unapplied funds, conflicting with the no-credit rule. Proposed ASSUMPTION: require an explicit linked refund or atomic reallocation to another existing charge in the same operation; otherwise reject. Define treatment of cash already returned and UPI/bank refund references. Test chained corrections/refunds and cancellations after usage before implementation approval.

### 5.6 Attendance

- Owner/staff searches by name, phone, or member number.
- One record per member per local business date, enforced by a database uniqueness rule.
- Current membership permits standard check-in, even if dues remain; show dues warnings.
- Expired membership shows days overdue. “Allow Entry” records staff actor and override reason/context.
- No checkout, multi-session tracking, or trainer check-in.

ASSUMPTIONS: No membership/current entitlement follows the same recorded override flow as expiry. No attendance backdating by staff. Future owner-only correction/backdating is excluded unless a pilot requires it. Archived records must be deliberately reopened/reactivated rather than appearing in normal check-in results.

### 5.7 Follow-ups

- Expiry list: expiry date within today minus 7 days through today plus 3 days, inclusive.
- Dues list: outstanding balances, with due/overdue distinction and oldest due date.
- “Open WhatsApp” opens an encoded +91 link with gym/member context and “Please contact reception to renew.” No self-service renewal link.
- Opening WhatsApp is not delivery confirmation. “Mark as Contacted” records staff, timestamp, channel/context, and optional note.
- Respect opt-out and avoid exposing debt in messages to shared family numbers without review.
- No automatic messaging queue or scheduled delivery in v1.

## 6. Information architecture and page-level UI

### 6.1 Shared interaction standards

- Responsive navigation: desktop sidebar; compact mobile navigation with clear primary actions.
- Tables support server-side pagination, search, appropriate filters, loading/empty/error states, and mobile-friendly row details.
- Financial confirmation displays member, dates, charges, existing debt, payment allocation, resulting dues, and actor.
- Save buttons indicate pending state; retries use the same operation identity. Never show “saved” before server confirmation.
- Preserve unsaved form values during recoverable failures where practical; avoid sensitive persistent browser storage.
- Visible connectivity warning; no offline writes or false queued-payment success.
- Keyboard navigation, visible focus, labelled fields, readable contrast, touch targets, clear validation, and accessible dialogs.
- No silent destructive actions. Show actionable errors without internal implementation details.

### 6.2 Pages and primary actions

| Page | Content and actions |
|---|---|
| Login | Username/password, owner recovery route, generic authentication errors |
| First login / recovery | Password change, owner recovery-email setup/verification, session invalidation |
| Owner dashboard | Member/entitlement counts, today's attendance, period collections, dues, expiries, quick actions |
| Staff dashboard | Registration/check-in/renewal shortcuts, follow-up tasks, own collections; no gym-wide revenue |
| Members | Search name/phone/ID; membership/dues/trainer filters; archived lookup; add member |
| Register/edit member | Required identity first, duplicate-phone confirmation, optional details/photo, save-and-purchase |
| Member profile | Identity, current/queued entitlement, debt banner, purchases, payments/receipts, attendance, trainer and notes |
| Purchase/renewal | Plan, suggested dates, admission fee, owner discounts/overrides, debt preview, full/partial payment |
| Membership plans | Owner creates/edits/deactivates templates; immutable historical terms explained |
| Attendance | Fast search/check-in, already-checked-in state, warnings/override, daily list/count |
| Payments & dues | Member lookup, record collection, FIFO preview, history, receipt, owner adjustments |
| Financial adjustment | Owner reauthentication, reason, linked records, before/after preview, confirmation |
| Follow-ups | Expiry and dues tabs, opt-out status, WhatsApp action, contact history/manual contacted action |
| Trainers & staff | Owner account lifecycle; primary-trainer assignment accessible to staff where appropriate |
| Reports | Owner-wide filters and exports; staff own daily collections only |
| Settings | Branding/business details, admission default, owner account/recovery, installation metadata |
| Trainer: My Members | Assigned member list/search with no finance payloads |
| Trainer: member detail | Allowed identity/contact, membership dates, attendance and plain text notes |
| Receipt print view | Branding, unique number, member, amount/method, effective date and recorded timestamp, actor, remaining dues |

ASSUMPTION: Saved receipts show the balance snapshot at issue time, clearly labelled; current dues appear separately when viewing later. Reprints preserve receipt identity and original facts. Corrections/refunds show linked status rather than silently rewriting the original receipt.

## 7. System architecture

### 7.1 Components and responsibility

| Component | Responsibility |
|---|---|
| React/TypeScript | Accessible responsive UI, form state, API queries, print views; no authoritative financial rules |
| Tailwind CSS + shadcn/ui | Consistent visual primitives, customized into a cohesive gym product |
| NestJS REST API | Authentication, authorization, validation, business workflows, uploads, export/import, audit |
| Prisma | Typed database access and reviewed migrations; does not replace database constraints |
| Neon PostgreSQL | Authoritative relational business records and transaction boundaries |
| Private object storage | Member photos, controlled gym assets, independent lifecycle and backup |
| Transactional email | Owner verification/password recovery only |
| Monitoring/logging | Availability, errors, service limits, security and recovery-job failures |

Use one modular backend application per gym, not microservices. Suggested modules: Auth/Users, Gym Settings, Members, Plans/Memberships, Billing, Attendance, Trainers/Notes, Follow-ups, Reports, Import/Export, Assets, Audit/Operations.

ASSUMPTIONS: React is a browser application built with Vite rather than an SEO/server-rendered frontend framework. Use an API query cache for server state and ordinary local form state; select exact libraries during compatibility verification. Serve frontend and API under one site where practical (for example /api), reducing cross-origin session complexity. Future mobile clients reuse versioned business APIs, with a separately designed mobile authentication flow.

### 7.2 Boundaries and data flow

1. Browser sends a validated user intent, not a trusted computed total.
2. Backend authenticates, authorizes the resource and role, and recomputes rules.
3. Transaction locks/serializes relevant member balances and entitlement changes, enforces invariants, and commits records/audit/idempotency response atomically.
4. Browser refreshes relevant queries after success; other sessions require navigation/manual refresh.
5. Financial data does not use optimistic success. Reference data may be cached but cannot authorize stale prices or rights.

No Redis, event bus, WebSockets, or general-purpose job system is required initially. Do not add them without a demonstrated need.

### 7.3 Version policy and research checkpoint

Pin exact compatible stable versions and commit a dependency lockfile before implementation. Do not use floating latest tags, release candidates, or unsupported runtimes for the commercial build.

Interview-time verification found React 19.3 listed on the official versions page and Prisma ORM 8 labelled a release candidate on its supported-versions page. These are observations, not a finalized version matrix. NestJS runtime/module requirements also need checking alongside Prisma, TypeScript, UI tooling, and deployment runtime.

Sources to recheck at implementation time:

- React: https://react.dev/versions
- NestJS: https://docs.nestjs.com/faq/versions and https://docs.nestjs.com/migration-guide
- Prisma: https://www.prisma.io/docs/orm/supported-versions and https://www.prisma.io/docs/orm/reference/system-requirements
- Neon: https://neon.com/pricing and its backup/restore documentation

PRE-IMPLEMENTATION CHECK: Record exact Node.js, package manager, TypeScript, React, NestJS, Prisma, PostgreSQL, Tailwind, shadcn/ui dependencies, build tooling, and testing versions with official compatibility references and a clean install/build result. Exact versions remain deliberately unpinned in this planning-only task.

## 8. Proposed logical database schema

This is the schema blueprint, not a migration. Field names/types below are proposed implementation details. Use stable internal IDs, foreign keys, explicit timestamps, and indexes. Do not add tenant_id to simulate a shared SaaS database.

| Entity | Principal fields / relationships |
|---|---|
| GymSettings | Single configuration record; name, business/address/contact details, branding asset references, timezone, currency, admission default |
| User | ID, normalized unique username, password hash, fixed role, active state, password-change requirement, owner recovery email/verification, timestamps |
| Session | Hashed session identifier, user, expiry/revocation, authentication/reauthentication timestamps; minimize device metadata |
| RecoveryToken | User, hashed single-use token, purpose, expiry, used timestamp |
| Member | Unique member number, full name, normalized nonunique phone, optional profile/guardian/contact fields, archive state, contact opt-out, timestamps |
| TrainerAssignment | Member, trainer user, effective start/end, assigning actor; at most one current primary trainer |
| Plan | Name, duration type/value, price in paise, active flag, timestamps |
| MembershipPurchase | Member, source plan, immutable purchased terms/discount snapshot, actor, business date, lifecycle state |
| MembershipPeriod | Purchase, start/expiry dates, calendar anchor, cancellation details, extension/override metadata |
| Charge | Member, purchase if relevant, type, original amount, effective date, due date, opening-import source |
| ChargeAdjustment | Charge, signed reduction/correction details, reason, owner, linked operation; preserves original charge |
| Payment | Member, amount, method, optional reference, effective date, entry timestamp, recording actor, unique receipt number, operation linkage |
| PaymentAllocation | Payment, charge, amount; append-only allocation/reversal events or equally auditable postings |
| PaymentReversal | Original payment, reversed amount/postings, owner, reason, replacement payment if correction |
| Refund | Original payment, amount, return method/reference, business date, owner, reason, allocation reversal linkage |
| Attendance | Member, local attendance date, check-in timestamp, actor, override flag/context |
| MemberNote | Member, author, plain text, created timestamp; optional append-only amendment linkage |
| FollowUpContact | Member, expiry/dues context, actor, contact timestamp, optional note; no delivery/read claim |
| Asset | Private object key, purpose, member/gym link, media metadata, uploader, lifecycle state |
| AuditEvent | Actor/system identity, action, entity links, redacted before/after facts, reason, timestamp, request/support reference |
| IdempotencyRecord | Actor/operation/key uniqueness, request fingerprint, committed result reference, retention metadata |
| ImportBatch / ImportRow | File fingerprint, preview/validation outcomes, row keys, actor, confirmed status, created entity links |
| InstallationMetadata | Installed release/schema compatibility, installation identity; no credentials or central control requirement |

### 8.1 Integrity constraints

- Unique usernames, member numbers, receipt numbers, attendance (member/date), and scoped idempotency keys.
- Phone is intentionally not unique. Normalize before duplicate lookup.
- Monetary values are nonnegative integer paise where applicable; constraints guard totals with transaction-level domain checks.
- Require valid start/expiry and positive plan duration; enforce no conflicting entitlements under concurrent writes.
- Refunds/reversals cannot exceed the remaining eligible original amount; allocations cannot exceed payment or outstanding charge.
- Reject cross-member payment allocations and mismatched linked records.
- Retain actors even after account disabling. Foreign-key deletion policy must preserve financial history.
- Index member lookup, period dates/status, outstanding charge/member/date, payment effective date/actor/method, attendance date, assignments, audit references.
- Do not persist mutable totals as a second unexplained source of truth. Derived/cached balances need a reconciliation strategy before use.

ASSUMPTION: The financial subsystem is a constrained operational subledger, not full double-entry accounting. Decide the exact append-only posting representation before billing implementation and prove every aggregate can be reconstructed from source events.

## 9. API contract blueprint

Use a versioned REST namespace such as /api/v1. Backend DTO validation, resource-level authorization, consistent errors, pagination bounds, and request IDs apply throughout. Client role hiding is not authorization.

| Area | Representative endpoints / operations |
|---|---|
| Authentication | POST /auth/login, /logout, /reauthenticate, /change-password; GET /auth/me |
| Owner recovery | POST /auth/recovery/request and /complete; owner email verification operations |
| Accounts | GET/POST /users; PATCH /users/:id; POST /users/:id/disable and /reset-password |
| Gym configuration | GET/PATCH /gym/settings, appropriately filtered public/authenticated branding |
| Members | GET/POST /members; GET/PATCH /members/:id; POST /members/:id/archive or /restore |
| Plans | GET/POST /plans; PATCH /plans/:id; deactivate instead of destructive deletion |
| Memberships | POST /members/:id/purchase-preview and /purchases; GET /members/:id/memberships |
| Adjustments | Preview/confirm endpoints for extensions, queued date changes, cancellations, charge adjustments |
| Payments | GET/POST /members/:id/payments; payment allocation preview; owner correction/refund preview/confirm |
| Receipts | GET /payments/:id/receipt with role-safe details and printable representation |
| Attendance | POST /attendance/check-ins; GET /attendance with authorized filters |
| Trainers | POST /members/:id/trainer-assignment; GET /trainer/members; authorized notes endpoints |
| Follow-ups | GET /follow-ups/expiry and /dues; POST /members/:id/contacts; PATCH contact preference |
| Reports | GET /reports/collections, /dues, /memberships, /attendance; own-staff scope enforced server-side |
| Import/export | Upload/validate/preview/confirm CSV batch; authorized CSV export endpoints |
| Assets | Authorized upload/read/delete lifecycle endpoints; restricted signed access if used |
| Operations | Minimal liveness/readiness endpoints; owner audit viewer or support export as scoped |

ASSUMPTIONS: Mutation previews are advisory; confirmation revalidates against current state. Include an expected version/state token to detect stale financial previews. Use idempotency keys for purchases, collections, corrections, refunds, cancellation, and import confirmation; reject reuse with different payloads. Return the original committed result for an identical retry. Standard error categories include validation, unauthorized, forbidden, not-found, conflict/stale-state, dependency-unavailable, and unexpected failure.

## 10. CSV onboarding and reporting definitions

### 10.1 Import workflow

1. Download a documented CSV template.
2. Include member name/mobile, stable import row identifier, current membership start/expiry, and opening dues; optional supported details.
3. Validate encoding, dates, amounts, mobile normalization, duplicates, required values, and incompatible membership periods before writing.
4. Show row-level errors and a preview of members, entitlements, and total opening debt.
5. Owner confirms; prevent accidental repeated import using a stable batch/row identity.
6. Produce an outcome summary. Do not reconstruct unverifiable historical payments or count opening balances as current collections/sales.

ASSUMPTIONS: Owner-only import; all-or-nothing confirmation for up to 500 rows after validation; UTF-8 CSV with a documented date format and maximum file size. Existing-member matching is explicit, never a silent phone-number merge. If original membership start or anchor is missing, require an explicit owner-approved import convention and disclose its effect on future renewals. Historical membership price may be unknown; do not invent a paid charge solely to create current entitlement.

### 10.2 Report definitions

- Collections: money recorded as received, grouped by effective business date, recording actor, and method.
- Corrections: show reversals/replacement entries explicitly so totals remain explainable. Do not double-count the original and corrected amount.
- Refunds: actual returned money grouped by refund effective date/method and executing owner, linked to the originating collection.
- Net recorded cash movement: receipts minus financial outflows/reversals as applicable; state the definition and avoid counting a correction twice.
- Sales: charges for purchases, distinct from collections; advanced earned-revenue recognition is deferred.
- Outstanding dues: charge amounts minus valid adjustments and net allocations, including imported opening debt.
- Active members: members with a noncancelled current entitlement; separately label archived status and registered-member count.
- Attendance: unique checked-in members per local date, including clearly identified overrides.
- Collections by staff means the recording actor, not a fully managed cash drawer or shift owner.

PRE-IMPLEMENTATION CHECK: Approve a small worked ledger containing sale, partial payments, FIFO across renewals, imported debt, typo correction, backdating, refund, and cancellation. Every receipt, member balance, and report must agree on expected figures before coding financial logic.

## 11. Security, privacy, and data handling

- TLS everywhere; database credentials remain server-side. No secrets in frontend builds, repository, exports, or logs.
- Strong password hashing with an appropriate maintained algorithm/library; credential/session/token rate limits and generic recovery responses.
- Secure HTTP-only session cookies with appropriate SameSite, CSRF protection, session rotation, and explicit origin/CORS rules.
- Server-side authorization on every query and mutation, including assets, receipts, exports, trainer notes, and aggregate reports.
- Trainer endpoints return only permitted fields; do not fetch financial data and merely hide it in the UI.
- Parameterized database access; validation and safe output rendering; never render notes as arbitrary HTML.
- Private uploads: size/type limits, content verification, randomized object keys, authorization, safe image handling, and no public member-photo bucket.
- CSV exports neutralize spreadsheet-formula injection without corrupting financial values.
- Financial history is append-only to ordinary application roles. Audit records redact passwords, tokens, and unnecessary personal data.
- Developer infrastructure access is named/revocable, least-privileged, and documented. Emergency data changes record actor, reason, affected records, and evidence outside ordinary application audit when required.
- Database administrators can potentially alter data; do not claim cryptographically immutable or tamper-proof logs without additional controls.
- No production member data in development, AI prompts, screenshots, or diagnostic bundles without explicit authorization and appropriate safeguards.
- Deletion requests go to owner review. Do not equate archival with legal deletion or assume financial records can be retained forever.

PRE-LAUNCH CHECKS: India-specific privacy/consent, minors/guardian requirements, applicable financial retention and invoicing obligations, processor terms, hosting regions, incident handling, support access agreement, and deletion/anonymization procedure. Appropriate professional guidance may be required. Initial validation uses adults and synthetic data; real-data processing waits until applicable requirements are resolved.

## 12. External services, asynchronous work, and failure behavior

| Dependency | Failure behavior / required evidence |
|---|---|
| Database | No false success; preserve recoverable form state; retry safely with idempotency; alert developer |
| Recovery email | Generic response; expiring tokens; bounded retries; monitor failures; documented owner recovery escalation |
| Storage | Member registration can proceed without optional photo; report upload failure and allow retry; prevent orphan objects |
| WhatsApp | External navigation only; unavailable app/browser shows a usable manual fallback; no sent/delivered claim |
| Monitoring | Independent uptime check where feasible; avoid making one failure invisible because monitoring shares the failed backend |
| Backups | Alert on failed/late backups, retention failure, or restore-test failure; identify responsible operator |

ASSUMPTION: Email delivery uses a small durable outbox/retry mechanism if needed; no heavyweight queue service by default. Idempotent cleanup handles abandoned uploads and expired tokens/sessions. Core expiry, entitlement, and dues queries remain correct without scheduled jobs. Provider/API quotas, payload limits, retry delays, job retention, and cost caps are provider-selection checks.

## 13. Environments, deployment, backup, and operations

### 13.1 Environments

- Local development: disposable local PostgreSQL or an isolated development database; synthetic fixtures; no production secrets.
- Staging/preview: isolated database/storage/email recipients; exercise release and restore procedures.
- Production: independent client-owned accounts/resources, custom domain, HTTPS, reviewed secrets and access.
- Preview deployments must never inherit production database credentials.
- Keep deployment templates and an installation checklist in the master repository; store per-gym secrets/configuration outside source control.

### 13.2 Hosting selection gate

Neon remains the chosen PostgreSQL provider, subject to verifying a suitable service arrangement. Backend/frontend/storage/email/monitoring providers remain unselected. Do not silently switch to Firebase or Supabase.

For each candidate, record: commercial terms, supported runtime, region/latency to India, cold-start/sleep behavior, database connections/pooling, compute/storage/egress limits, backups/PITR, recovery window, account ownership, alerts, spend caps, tax/currency effects, and full installation cost.

Neon's pricing page advertised usage-based Launch pricing and a typical US$15/month at interview verification. This is not a quote, minimum, ceiling, or assurance that the entire system fits ₹1,500. Recheck actual terms before purchase.

### 13.3 Recovery objectives

- Target RPO: no more than one hour of saved-data loss.
- Target RTO: restore operation within one business day. Define local support hours and incident clock in the maintenance agreement.
- Daily backups alone do not meet a one-hour RPO. Verify sufficient PITR/continuous recovery or another proven arrangement.
- Recovery covers database records, private assets, configuration, secrets recovery, and compatible application release.
- Backups on the same account/provider may not cover account compromise or provider-wide loss; evaluate independent encrypted copies and retention.
- Protect and restrict backup access because backups contain personal data.

PRE-LAUNCH CHECK: Restore into an isolated destination; verify sample balances, receipts, allocation totals, memberships, attendance, user access, and file retrieval; measure recovery time and recoverable timestamp; record evidence. Test actual capability rather than trusting a “backup enabled” switch. Ongoing restore cadence is an ASSUMPTION to set in the support agreement; proposed quarterly and after material recovery changes.

### 13.4 Release procedure

1. Build a versioned release from the master repository; record changelog and compatible schema/runtime.
2. Pass automated checks and staging migration/restore exercises.
3. Schedule client maintenance; confirm account access, recovery capability, and any write pause.
4. Take/verify a fresh recoverable database point and relevant asset/configuration protection.
5. Apply reviewed migrations through a single controlled process, then deploy and smoke-test.
6. Confirm login, member lookup, financial/report invariants, and health; resume operations.
7. On failure, use the rehearsed forward-fix or restore procedure. App rollback is safe only if schema compatibility is verified; never blindly undo migrations or erase post-release payments.
8. Record installed release and outcome per gym.

Feature updates may be postponed; critical security/compliance patches are mandatory under the agreement. Support the immediate previous minor version with a 90-day retirement window. PRE-LAUNCH CHECK: clarify the exact clock and exception policy; do not promise indefinite support because a client declines an update.

## 14. Observability and support

- Structured request/error logs with request ID, release, route, latency, outcome, and safe actor references.
- Never log credentials, full session tokens, payment references unnecessarily, photos, or entire member payloads.
- Monitor availability, API error rate/latency, DB failures/connections/storage, resource usage, email failures, backup freshness, and restore evidence.
- Alert developer on actionable infrastructure/security failures. Owner business summaries remain in-app only.
- Maintain operational incident records and distinguish business audit events from diagnostic logs.
- Record support changes with before/after facts and reason. Direct SQL bypasses application controls and requires an exceptional reviewed support procedure.
- No developer backdoor. Client can revoke access; define support consequences and emergency contact process.

ASSUMPTIONS: Initially use simple uptime/error monitoring and provider metrics, not a full observability platform. Log retention, alert thresholds, support response hours, escalation, and incident communication are explicit service-agreement checks. A lightweight private release inventory may track installation/version/provider identifiers, never serve as a cross-gym business admin panel or store client secrets.

## 15. Testing and quality gates

### 15.1 Required automated checks

- Domain tests: calendar anchors/leap years, inclusive days, active/expired renewals, queued periods/extensions, FIFO, admission fees, discounts, refunds/reversals/cancellation.
- Integration tests against PostgreSQL: transaction rollback, concurrent payments and renewals, unique attendance/receipt constraints, retry deduplication, stale previews, cross-member allocation prevention.
- Authorization tests: every role's denied and allowed routes, trainer reassignment, report scope, asset URLs, exports, account disable/session revocation, owner-only adjustments.
- API validation/security checks: malformed dates/amounts, credential abuse controls, CSRF/session behavior, CSV injection, unsafe uploads, recovery-token reuse/expiry.
- End-to-end critical flows: registration → partial collection → check-in → renewal → second collection → receipt/report; owner correction/refund/cancellation; CSV preview/confirm/retry.
- Frontend build/type checks, backend build/type checks, migration validation, dependency/security review.

### 15.2 Manual acceptance

- Owner and actual front-desk user complete ordinary operations with synthetic records.
- Mobile/tablet/desktop checks, keyboard navigation, readable contrast, loading/empty/error states.
- A4 print preview and physical print/Save as PDF on the pilot's actual setup.
- Disconnect during submission; retry without double posting. Test simultaneous front-desk sessions.
- Import 100–500 representative rows and reconcile opening dues.
- Match collection reports to a worked manual cash/UPI example, including backdating and refunds.
- Perform and document full database/assets restore.

ASSUMPTION: Provisional performance goal is ordinary search/page loads within two seconds and financial confirmations within three seconds on representative India connectivity and provisioned hosting, excluding explicit dependency outages. Validate with realistic data and concurrent staff; negotiate targets rather than asserting an SLA.

### 15.3 Release gates

**Demo gate:** synthetic data only; clear nonproduction status; no real-money reliance.

**Real-data pilot gate:** financial/permission tests pass; date and ledger ambiguities resolved; privacy/consent requirements addressed; providers and costs approved; recovery objectives demonstrated; owner recovery and support access verified; pilot owner signs off.

**Repeatable commercial release gate:** pilot issues resolved, onboarding/release/recovery instructions proven, client account ownership and maintenance agreement complete, supportable cost model, no critical security/financial defects.

Critical failures delay launch regardless of the 1–2 week target.

## 16. Implementation roadmap — no scaffolding authorized by this document alone

The user requested this blueprint only. Execute the roadmap only when development is separately requested.

| Phase | Deliverables / exit criteria |
|---|---|
| 0. Resolve gates | Confirm ledger/date examples, exact stable compatibility matrix, provider/cost/recovery feasibility, privacy boundaries, pilot participant |
| 1. Product foundation | Cohesive UI tokens/navigation, isolated environment configuration, database/migration foundation, login/session/recovery, role enforcement |
| 2. Members and plans | Registration/search/profiles, duplicate-phone confirmation, private photos, plans/snapshots, archival, trainer assignment |
| 3. Membership and billing core | Deterministic dates, charge ledger, FIFO payments, safe retries/concurrency, receipts, partial dues, queued renewal |
| 4. Owner adjustments | Reauthentication, preview/confirm, extensions, corrections/refunds/cancellation, audit and financial reconciliation tests |
| 5. Daily operations | Attendance/overrides, follow-ups/opt-out/WhatsApp, trainer notes, role-specific dashboards |
| 6. Onboarding and reports | Validated CSV import, exports, owner/staff report scopes, A4 print, large-directory usability |
| 7. Operational hardening | Monitoring, deployment/migrations, database/assets backups and restore, access review, devices/security/performance checks |
| 8. Pilot and release | One-gym synthetic acceptance, resolved blockers, controlled real-data pilot, documented commercial release |

Work in vertical, testable slices. Do not postpone financial invariants, permission enforcement, or retry handling until a final polish phase. If time is short, reduce demo scope openly instead of declaring untested features production-ready.

## 17. Customization and future expansion

- Configuration: branding, business contacts, membership plans, admission fee defaults, owner-created accounts.
- Deployment configuration: domains, provider credentials, resource identifiers, email sender, operational alert destinations.
- Never mix deployment secrets with gym-editable settings.
- Prefer backward-compatible shared features and reviewed migrations over per-client forks.
- Future branches can introduce explicit location entities and memberships/staff/attendance scoped to locations, but v1 does not implement tenant isolation or branch UI.
- Separate member identity from login accounts so future member access does not require replacing member records.
- Keep API contracts and business logic independent of React to allow future Flutter/mobile clients.
- Future payment gateways require verified webhooks, reconciliation, idempotency, refunds, and a revised fee/security model; manual UPI entry must never masquerade as gateway confirmation.
- Offline writes, formal freezes, credit balances, and prorating require independent domain design and migration/acceptance work.

## 18. Consolidated assumptions and unresolved decisions

These are not concealed product commitments:

1. Vite browser frontend, query-state tooling, same-site API deployment, and exact compatible package versions.
2. Session/password/MFA parameters, last-owner protection, and owner recovery escalation.
3. Staff archival restrictions and trainer-note visibility/history policy.
4. Saving members without a purchase and permitting a zero-payment purchase with a due date.
5. Exact charge ordering, backdated allocation behavior, and treatment of admission lines.
6. Shifted calendar anchors and queued date changes that create gaps.
7. Handling unapplied money during paid-charge cancellation without introducing stored credit.
8. Receipt balance snapshots, corrected/reprinted status, and detailed report posting definitions.
9. Owner-only all-or-nothing CSV import, missing historical start/anchor handling, and stable retry identity.
10. Exact provider arrangement, regions, costs, quotas, PITR window, independent backups, and asset recovery.
11. Email retry/outbox implementation, cleanup jobs, operational thresholds/retention, and restore-test cadence.
12. Provisional performance targets, support hours, patch deadlines, and the 90-day support-window clock.
13. Legal retention, consent, minors, tax/receipt obligations, deletion/anonymization, and real-data approval.

## 19. Pre-launch evidence checklist

- [ ] Pilot gym and responsible owner identified; scope accepted.
- [ ] Calendar and financial worked examples approved, including unresolved assumptions above.
- [ ] Exact stable dependency/runtime matrix verified and pinned; clean builds and checks pass.
- [ ] Hosting/storage/email/monitoring choices documented with commercial terms, regions, quotas, and total cost.
- [ ] Client owns accounts/domain and approves operating charges; no unapproved cost exposure.
- [ ] One-hour RPO / one-business-day RTO demonstrated or explicitly renegotiated before real use.
- [ ] Database and asset restore tested, timed, and financially reconciled.
- [ ] Real-data consent/privacy/minors/retention/deletion and invoice requirements reviewed.
- [ ] Owner recovery email verified; session/role/access tests pass; no shared credentials.
- [ ] Financial mutation concurrency/retry/correction/refund/cancellation checks pass.
- [ ] Import preview/retry and opening balances validated on representative data.
- [ ] Collections, refunds, reversals, and staff report scopes match approved examples.
- [ ] Check-in warnings/overrides, opt-out, trainer assignment and note restrictions verified.
- [ ] Actual browser/device/A4 printing and accessibility checks completed.
- [ ] Monitoring and actionable alerts tested; sensitive logging review completed.
- [ ] Release, migration, recovery, support-access, and incident procedures documented and rehearsed.
- [ ] Maintenance contract states supported versions, patch obligations, hours, access, costs, and recovery limits.
- [ ] Pilot owner signs off; no unresolved critical financial/security defects.

End of blueprint. Any unchecked commercial gate remains visible; a working demo is not evidence that the installation is ready for real financial operations.
