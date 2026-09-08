# Claude in Chrome: running the extraction

Start here if you have been asked to produce category splits from retail orders rather than to
change code. Written for a session with **no prior context** — Claude in Chrome does not read this
repo on its own, so Kevin pastes or points at this file.

> Written 2026-09-05, off the Walmart contract verified the same day.

---

## What you are doing, in one paragraph

Kevin has a Simplifi transaction backlog. A Walmart charge of $71.72 currently sits in Simplifi as
one line called `Groceries`, when it is really groceries plus household goods plus tax plus a fee
plus a tip. Your job is to open the order behind that charge, read what was actually bought and for
how much, and emit split lines that **add up to the charged amount exactly**. You are not deciding
policy — the category rulings are already settled. You are applying them to real numbers.

## Before you start

Kevin should give you:

1. **`docs/WALMART-EXTRACTION.md`** (or `TARGET-EXTRACTION.md`) — the field contract. Non-optional.
   The field names lie in two specific places and you will get every total wrong without it.
2. **The canonical category list** — 163 paths, `Primary:Secondary` form. Never invent a category;
   if nothing fits, say so and stop.
3. **The transaction rows you are covering** — date, amount, and whether each has cleared.

You need to be signed in to the retailer in the browser you are driving. You will not need cookies,
an API key, or DevTools.

## The loop, per order

**1. Confirm the transaction has cleared.** Skip anything still `Pending`. Walmart revises orders
after pickup or delivery — substitutions, out-of-stocks, and every weight-priced item — so a pending
order's numbers are not final. This matches Kevin's standing rule that nothing is reviewed until it
clears.

**2. Open the order details page.** `https://www.walmart.com/orders/{orderNumber}` — the order
number with dashes stripped. Ignore `groupId` in the URL; it identifies a browsing session, not an
order.

**3. Read `__NEXT_DATA__`, not the rendered page.** Everything is in the JSON, including the fee
breakdown the page hides behind an ⓘ tooltip. Reading rendered text is how the earlier attempt ended
up with item names and no prices.

**4. Pull items and totals.** Per item: `productInfo.name`, `priceInfo.linePrice.value`,
`quantity`, `usItemId`. Ignore `preDiscountedLinePrice` — on weight-priced items it is a different
weight, not a markdown. Then `subTotal`, `fees[]`, `taxTotal`, `driverTip`, `grandTotalWithTips`.

**5. Reconcile before categorizing.** Two identities, both exact:

```
Σ linePrice                                    == subTotal
subTotal + Σ fees + taxTotal + driverTip       == grandTotalWithTips == the bank charge
```

**If either fails, stop and report it.** Do not emit splits that do not balance and do not "adjust"
a line to force the total. A mismatch means a field was missed — most often the item array appearing
twice (dedupe on `usItemId`) or `grandTotal` used in place of `grandTotalWithTips`.

**6. Assign categories, then apply the no-split rule below.**

**7. Emit rows** in the schema at the bottom.

## The rulings that change your output

Summarized here because you may not have the Simplifi repo in front of you.
**`quicken-simplifi-mcp/docs/CONVENTIONS.md` is authoritative** — if this section and that file
disagree, that file wins and this one is stale.

- **A one-category order does not get split at all.** If everything lands in a single category
  besides sales tax, assign the **whole amount** to that category and emit one row. Do not break out
  the tax. Splitting is reserved for orders that genuinely span three or more categories. This
  ruling alone cut the Amazon workload from 169 transactions to 36.
- **A fee you *chose* gets its own split line; a fee you *could not avoid* rides inside the thing it
  came with.** A delivery fee is elective — it goes to `Fees & Charges:Service Fee`. Regulatory
  charges baked into a bill are not elective and stay put.
- **CRV and bag fees go to `Fees & Charges:Service Fee`.** Kevin knows this is not literally what
  they are and has decided against separate categories for them. Do not propose new ones.
- **Driver tips go to `Cash & ATM:Tips`** as their own line.
- **Amounts are negative for spending.** A $71.72 purchase is `-71.72`, and its split lines are
  negative too. Gift-card and coupon offsets are the exception and flip sign — the workbook encodes
  them negative, Simplifi's drawer takes them as a positive credit.
- **Never mark anything reviewed.** That is Kevin's call, by hand.

## Output schema

Match the store sheets in the transactions workbook exactly — same column order, one row per split
line, transaction-level fields repeated:

| Column | Notes |
|---|---|
| `Quicken Transaction Number` | Leave blank unless Kevin supplies it — see below |
| `Transaction Number` | Sheet-local key; leave blank unless supplied |
| `Date` | Transaction date, not order date, when they differ |
| `Reviewed` | Always `no` |
| `Payee` | `Walmart` / `Target` / `Amazon` |
| `Transaction Amount` | Negative. Repeated on every row of the transaction. |
| `Split Category` | Canonical path, `Primary:Secondary` |
| `Split Amount` | Negative. **Must sum to `Transaction Amount`.** |
| `Split Tag(s)` | `Delivery` on delivery-fee lines; `;`-separated |
| `Notes/Order ID` | `Order #...` — the audit trail back to the receipt |

**On the two key columns:** as of 2026-09-05 both are empty in every store sheet (0 of 1,102 rows
populated), and the master workbook's `Simplifi All Transactions` sheet has no
`Quicken Transaction Number` column at all. The key scheme is designed but not yet assigned. Leave
both blank and let Kevin key the rows rather than inventing numbers that will collide.

## What not to do

- **Do not open DevTools' Network tab looking for GraphQL.** Walmart has no such call; the page is
  server-rendered. Searching for it wastes a session.
- **Do not export a HAR, and do not paste one into a chat.** It contains live session cookies. A
  copied JSON body carries no credentials.
- **Do not scrape the print invoice.** Its `div.od-print-view` is empty until print fires, and
  everything in it is already in `__NEXT_DATA__`.
- **Do not invent a category.** 163 exist; if none fits, stop and ask.
- **Do not batch aggressively.** One order at a time, reconciled before moving on. An unbalanced row
  that reaches the workbook costs more to find later than it saved.

## Stopping rule

A batch is done when every order in it either produced balanced split rows or produced a written
reason it was skipped. **"Mostly balanced" is not done.** Report skipped orders explicitly — a
silent omission is the one failure mode that survives all the way into the account.
