# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev           # Start with nodemon (auto-reload)
npm start             # Production start (generate + migrate + run)

# Database
npm run db:migrate    # Create and apply a new migration (dev)
npm run db:migrate:deploy  # Apply pending migrations (production/CI)
npm run db:generate   # Regenerate Prisma client after schema changes
npm run db:seed       # Seed initial data
npm run db:studio     # Open Prisma Studio UI

# Code quality
npm run lint          # ESLint
npm run format        # Prettier

# Tests (Jest + Supertest are configured; no test files exist yet)
npm test              # Run all tests
npm test -- <file>    # Run a single test file
```

## Architecture

### Request flow

```
HTTP Request
  → app.js (Express, helmet, cors, rate-limit, compression)
  → /middleware/auth.js (JWT verification via authenticateToken)
  → /routes/*.js
  → Prisma ORM → PostgreSQL
```

### Routes and their responsibilities

| Route | File | Key behaviour |
|---|---|---|
| Auth | `routes/auth.js` | Register, login, profile, avatar upload |
| Transactions | `routes/transactions.js` | CRUD + file upload/parsing + batch import |
| Categories | `routes/categories.js` | CRUD + AI auto-suggest + bulk update |
| Travels | `routes/travels.js` | Trip budgets and expenses |
| Kids | `routes/kids.js` | Allowance and savings goals per child |
| Bank | `routes/bank.js` | Plaid Open Banking link + sync + webhooks |
| Stripe | `routes/stripe.js` | Subscription management |

Pro-only routes are guarded by `/middleware/requirePro.js`.

### Categorization pipeline (`utils/ultimateCategorizer.js`)

1. Check local keyword map (extensive Italian merchant database in the same file)
2. If no match, call Claude AI (`utils/claudeCategorizer.js`) — requires `ANTHROPIC_API_KEY`
3. Optionally enrich merchant data via Google Places (`utils/googlePlacesService.js`)
4. User corrections are stored in the `CategoryKeyword` table with weights for future use

Category definitions, emojis, and colors live in `utils/categoryMetadata.js`.

### Bank statement parsing (`utils/fileParser.js` + `utils/parsers/`)

`fileParser.js` detects format (PDF, CSV, Excel, TXT, JSON, QIF, OFX, MT940) and dispatches to the right parser. Bank-specific parsers extend `baseBankParser.js`:

- Supported: UniCredit, BNL, Intesa, MPS, ING, Isybank, Fineco, Revolut, N26
- Fallback: `genericPDFParser.js`

### Database (Prisma + PostgreSQL)

Schema is in `prisma/schema.prisma`. Key models:

- **User** → owns everything
- **Transaction** → core record; links to Category, BankAccount, Travel, Kid
- **Category** + **CategoryKeyword** → categorization with learned keyword weights
- **BankConnection** + **BankAccount** → Plaid integration (access token, cursor)
- **UploadedFile** → metadata + parse results for uploaded statements
- **Travel** + **TravelExpense**, **Kid** + **AllowanceHistory** → feature-specific models
- **MerchantCache** → cached Google Places / Claude categorization results

Always run `npm run db:generate` after editing `prisma/schema.prisma`.

### Environment variables

Copy `.env.example` to `.env`. Required groups:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — token signing
- `PLAID_*` — Open Banking (CLIENT_ID, SECRET, ENV)
- `STRIPE_*` — payments (SECRET_KEY, WEBHOOK_SECRET)
- `ANTHROPIC_API_KEY` — AI categorization (optional but recommended)
- `GOOGLE_PLACES_API_KEY` — merchant enrichment (optional)

### Deployment

The app is deployed on **Railway**. After every code change, push to the `main` branch to trigger a Railway deploy:

```bash
git push
```

Docker files (`Dockerfile`, `docker-compose.yml`, `entrypoint.sh`) are used for containerised deployments; `entrypoint.sh` runs `prisma migrate deploy` before starting the server.
