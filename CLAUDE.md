# Shopping MCP Server (Amazon · Target · Walmart)

Pulls itemized order and receipt data out of Amazon, Target and Walmart so it can be turned into
category splits that reconcile to what the bank actually charged. The point is not shopping — it is
feeding the transaction backlog in the sibling project, `kwpledger/quicken-simplifi-mcp`.

**Two things live here, and they are not the same thing.** The Node MCP server under `src/` drives
Puppeteer with exported cookies and is what upstream forked from. The *retail extraction work* that
matters right now runs in **Claude in Chrome**, against Kevin's own logged-in session, using the
contracts documented in `docs/`. A session asked to "get the Walmart orders" should read
`docs/CHROME-SESSION-PLAYBOOK.md` and use the browser — not build against `src/`.

---

## The goal that defines "done"

This repo is in service of the Simplifi goal, restated here so a session does not have to go
looking for it:

> All unreviewed Simplifi transactions from **May 17, 2025 through July 16, 2026**, categorized —
> or **September 30, 2026**, whichever comes first.

Amazon + Walmart + Target are **302 of the 1,126 unreviewed transactions (27%)** and carry nearly
all of the split work. That is why this repo exists and why its scope is narrow.

Scope test for anything proposed here: *does it move unreviewed transactions through the pipe
before Sept 30?* If not, it waits. When a session could either improve tooling or extract another
month of orders, extract the orders and say so.

## Layout

```
src/                       Node MCP server (stdio), Puppeteer + Cheerio
  index.ts                 Tool definitions; Target receipt flattening
  amazon.*.test.ts         Amazon tests; hit live ASINs
  cart.ts products.ts orders.ts utils.ts      Amazon paths
  target-config.ts         Target cookies + the public web API key
  target-orders.ts         Order history + itemized receipt fetch
  target-utils.ts          Target Puppeteer helpers
docs/                      Extraction contracts — read these before scraping anything
mocks/                     Saved HTML for USE_MOCK_RESPONSES=true
LLM/                       Upstream's original session transcripts. Historical; not current.
```

`amazonCookies.json` and `targetCookies.json` are gitignored and must stay that way.

## Read before you act

- **Extracting Walmart orders** → `docs/WALMART-EXTRACTION.md`. Walmart server-renders everything
  into `__NEXT_DATA__`; there is no API call to intercept and the field names contain two traps
  that will silently corrupt every total.
- **Extracting Target orders** → `docs/TARGET-EXTRACTION.md`. Different mechanism entirely — a real
  API, a public key, one extra request per order.
- **Running the actual work in a browser** → `docs/CHROME-SESSION-PLAYBOOK.md`. Start here if you
  have been asked to produce splits rather than to change code.
- **Deciding what category something is** → `docs/CONVENTIONS.md` in `quicken-simplifi-mcp`, not
  here. Those rulings are settled and this repo does not restate them. This repo answers *what was
  bought and for how much*; that repo answers *what bucket it goes in*.

## Design decisions

**Walmart is read from the page, not from an API — because there is no API to read.** The order
details page is server-rendered React; the whole order sits in a `__NEXT_DATA__` script tag in the
initial HTML. Filtering DevTools' Network tab for `graphql` on an order page returns nothing,
which is the correct result and not a failed search. This is *better* than Target's shape: one
authenticated page load gets items, prices, fees, tax, tip and totals together, with no second
request and no API key.

*Rejected:* scraping the print-invoice DOM. The print view is richer than the on-page summary — it
names CRV where the page says "Estimated regulatory fees & taxes" — but that same breakdown is
already in `__NEXT_DATA__` under `rowInfo.chargeBreakdown`, so the DOM buys nothing and costs a
dependency on rendered markup. Note also that `div.od-print-view` is empty until print fires.

**Tip handling differs by retailer, and the retailer's own words are not evidence.** Walmart's
invoice says the driver tip is "charged separately after delivery." It is not; it rides inside the
single charge. Target's Shipt tips genuinely are separate. Both use near-identical language, so
this has to be per-retailer configuration, never inferred from the page. Reconcile against the bank
transaction, never against the retailer's description of the bank transaction.

**Scrape an order only after its bank transaction clears.** Walmart revises orders after pickup or
delivery — substitutions, out-of-stocks, and weight-priced items all move. An order read while its
transaction is still `Pending` produces numbers that will not match what posts. This is the same
rule as Simplifi's "nothing gets marked reviewed until it clears," arrived at from the other end.

**Amazon and Target hard-failed the server on a missing cookie file; they no longer do.**
`loadAmazonCookiesFile()` used to throw at startup, which killed the Target tools too even though
they need no Amazon credentials. Both loaders now warn and return `[]`, and the per-retailer tools
surface an auth error when they are actually called. That made Target-only operation possible and
is the substance of the open upstream PR.

## Current state

**The Walmart contract is verified; the Walmart tooling does not exist.** `docs/WALMART-EXTRACTION.md`
was validated on 2026-09-05 against one saved order page, end to end — line items sum to subtotal,
subtotal plus fees plus tax plus tip equals the posted charge. There is no Walmart code in `src/`
and none is planned before Sept 30. Extraction runs in Claude in Chrome.

**Target's itemized receipts work and are unverified against a live account by anyone but Kevin.**
`includeItemDetails` on `get-target-orders-history` fetches one receipt per order. It is slower by
design — sequential, 300 ms apart — because Target's rate limit is unknown.

**Amazon is upstream's original scraping code and is untouched.** It parses HTML, its tests hit
live ASINs, and it is the most fragile path here. Amazon order history is available in the browser,
so Chrome is the better route for backlog work regardless.

**There is no test suite for Target or Walmart**, no CI, and no deployment. The Amazon tests are
upstream's and require live network plus valid cookies.

**The upstream PR to `sachinparyani/mcp-server-shopping` was closed unmerged on 2026-09-08**, three
days after it was opened, with no response from upstream. It covered Target-only startup and
itemized receipts, and that work lives on `main` regardless. So `main` no longer feeds an open
upstream PR and repo-local work can land there freely. **If a new upstream PR is ever opened from
`main`, the constraint returns:** anything on `main` joins it, and these docs reference a sibling
private repo and Kevin's own backlog, neither of which belongs upstream. Branch first in that case.

## Conventions

- **Keep this file under 1,850 words; start pruning at 1,350.** Anything a session will not need in
  its first four minutes belongs in `docs/`, with a pointer here saying when to go read it.
- **Verify a selector or a field path against real data before writing it down**, and stamp the
  doc with the date you verified it. Every guessed selector in the sibling project was wrong.
- **Record what a field actually means, not what it is named.** `grandTotal`, `preDiscountedLinePrice`
  and "charged separately after delivery" are all misleading, and each one was found the hard way.
- Keep cookies, session tokens and full account numbers out of this repo. Payee names, category
  names and order numbers are fine. **Never commit a HAR file** — it embeds live session
  credentials.
