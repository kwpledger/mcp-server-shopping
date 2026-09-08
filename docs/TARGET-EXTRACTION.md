# Target order extraction

How itemized Target receipts are retrieved, and how the mechanism differs from Walmart's.

> **Documented 2026-09-05 from the source in `src/target-*.ts`, not from a live run.** The code has
> been exercised against Kevin's account; this doc has not been re-verified field by field against a
> captured response the way `WALMART-EXTRACTION.md` was. Treat field names as accurate to the code
> and the response shape as unconfirmed.

---

## Two endpoints, two steps

Unlike Walmart, Target does have a real API, and the data arrives in two pieces.

**1. Order history** — Puppeteer loads `https://www.target.com/orders` and intercepts the response
from `guest_order_aggregations/v1/order_history`. One page load captures both online and in-store
orders; `getAllTargetOrders()` then pages through the rest. This yields order number, date,
`summary.grand_total`, and item descriptions with quantities — but **no per-item prices.**

**2. Itemized receipt** — only when `includeItemDetails` is true. For each order,
`fetchStoreReceiptDetail()` calls:

```
https://api.target.com/post_orders/v1/orders/{orderNumber}/store?key={TARGET_API_KEY}
```

That second call is where per-line pricing, tax and the payment card come from. Without it you get
what the item was, not what it cost.

## The API key is public

`TARGET_API_KEY` in `src/target-config.ts` is a hardcoded constant, and that is correct rather than
a leak. Target's gateway requires it on every call, and it is visible in the query string of every
request target.com makes from a logged-out browser. It is documented in place so a reviewer does
not mistake it for a credential.

It will break if Target rotates it. When receipt fetches start returning HTTP 401/403 across the
board, re-read it from a live request before assuming the session expired.

## Why the fetch runs inside the page

`fetchStoreReceiptDetail()` issues the request through `page.evaluate()` with
`credentials: 'include'` rather than from Node. That reuses the authenticated session's cookies
directly instead of rebuilding auth outside the browser. Requests are **sequential with a 300 ms
gap** — deliberately slow, because Target's rate limit is unknown and finding it the hard way costs
an account lockout rather than a retry.

A failed receipt returns `undefined` and logs a warning; one bad order never aborts a run. An order
that comes back without `receipt_detail` is a partial result, not an error.

## Response shape

`TargetReceiptDetail` — every field optional, since the API returns partial data:

```
store_receipt_id, store_id, order_date
summary   → total_product_price, total_taxes, total_adjustments, grand_total,
            saved_redcard_discount, saved_cartwheel_discount
payments  → [ amount, card_number, payment_type, guest_display_payment_type ]
packages  → [ order_lines → [ quantity,
              item → { tcin, dpci, description, unit_price, list_price,
                       product_classification → { product_type_name,
                                                  product_subtype_name,
                                                  merchandise_type_name } } ] ]
```

`src/index.ts` flattens this into a `receipt` object on each order: `storeId`, `subtotal`, `tax`,
`adjustments`, `grandTotal`, `redcardDiscount`, `circleDiscount`, `payments[]`, `lineItems[]`.

**`product_classification` is Target's own taxonomy**, not Simplifi's. It is a useful *hint* for
categorization and never an answer — the mapping decision belongs to
`quicken-simplifi-mcp/docs/CONVENTIONS.md`.

**Descriptions contain HTML entities.** `L&#39;Oreal` arrives raw; `decodeHtmlEntities()` in
`src/index.ts` handles the numeric, hex and named forms.

## Tips are genuinely separate here

Target delivery uses Shipt, and **Shipt tips really do post as their own transaction** — the
opposite of Walmart, whose identical-sounding "charged separately after delivery" copy is false.

Consequence: `summary.grand_total` on a Target order is not expected to include a tip, so a Target
order reconciles against its own charge while the tip reconciles against a second one. Do not
port Walmart's `grandTotalWithTips` handling across.

This asymmetry is why per-retailer tip behavior has to be explicit configuration.

## Target versus Walmart at a glance

| | Target | Walmart |
|---|---|---|
| Mechanism | API interception + per-order receipt call | `__NEXT_DATA__` in the page HTML |
| Requests per order | 2 | 1 |
| API key needed | Yes (public, hardcoded) | No |
| Rate-limit pacing | 300 ms between receipts | Not needed |
| Tip in the order total | No — separate Shipt charge | **Yes** — use `grandTotalWithTips` |
| Item price field | `item.unit_price` | `priceInfo.linePrice.value` |
| Verified to reconcile | Not confirmed in this doc | Yes, 2026-09-05 |

## Known gaps

- **No reconciliation check has been recorded.** See the checklist below, which is the whole of what
  is missing before Target splits can be trusted.
- **Receipts carry a masked `card_number`.** Harmless, but worth knowing before piping a payload
  into a chat context.
- **`post_orders/.../store` is a store-receipt endpoint.** Whether online-only orders return
  anything useful from it is untested.
- **No tests.** Nothing in `src/*.test.ts` covers Target.

## The reconciliation check, ported from Walmart

**Written 2026-09-08. Not yet run — every line below is a question, not a finding.**

The reason this was never done is worth stating, because it is not the obvious one. The response
*structure* has been known since the integration was written; `TargetReceiptDetail` types every
field. What was missing was a sharp idea of *which identities to test* and *what a lying field name
looks like*. Walmart supplied both. Run this on the first live order of any future span, against an
order whose bank charge you can see, before trusting a single split.

**The two identities.** Both must hold exactly:

```
Sigma (line prices)                        == summary.total_product_price
total_product_price +/- adjustments + tax  == summary.grand_total == the posted charge
```

**The six questions, each a Walmart trap with a Target analogue:**

| # | Question | Why — the Walmart precedent |
|---|---|---|
| 1 | Is `unit_price` per-unit or already extended? | **Highest value.** Walmart's equivalently-positioned field is `linePrice` and is *extended*. Target's is *named* `unit_price`. If it is genuinely per-unit the sum is `Sigma (unit_price x quantity)`; port Walmart's logic unchanged and every `quantity > 1` line is undercounted. Test on an order with a qty-2 item. |
| 2 | Does `summary.grand_total` include the Shipt tip? | Walmart ships `grandTotal` (no tip) and `grandTotalWithTips` (the bank charge), both labelled "Total". Target has only `grand_total`. Since Shipt tips post separately, it most likely excludes the tip — so a Target order reconciles to one charge and the tip to a second. Confirm rather than assume. |
| 3 | What is actually inside `total_adjustments`? | Walmart hid CRV inside "Estimated regulatory fees & taxes" and only a `labelType` gave it away. `total_adjustments` is an unexplained bucket. Check in particular whether it double-counts `saved_redcard_discount` / `saved_cartwheel_discount`. |
| 4 | Is `list_price` a trap, and does it matter that it is dropped? | Walmart's `preDiscountedLinePrice` turned out to be a *different weight*, not a discount. Target's `list_price` is in the interface but `src/index.ts` never copies it into `lineItems`, so no caller can see it either way. Decide whether it is signal before restoring it. |
| 5 | Do multi-package orders repeat lines? | Walmart's item array appears twice in `__NEXT_DATA__` and must be deduped on `usItemId`. `packages[]` is an array here and `index.ts` flatMaps it blindly. If lines repeat, dedupe on `tcin`. |
| 6 | Are the money fields consistently typed? | They are not. `summary.*` are `number`; `unit_price` and `list_price` are `string`, and `index.ts` passes `unitPrice` straight through unparsed. `saved_redcard_discount` is also a string. Anything summing these has to parse first. |

Record the answers here with the date, the same way `WALMART-EXTRACTION.md` records its verified
order. One order settles all six.

## Why this doc is kept

**Ruled 2026-09-08.** Neither this file nor `TARGET-INTEGRATION-SUMMARY.md` is deleted, even though
Target extraction is not on the path to the September 30 goal and nothing currently calls it.

The SMART goal covers **May 23, 2025 – July 16, 2026** only. Kevin has been categorizing
transactions after that window by hand, deliberately, to keep the goal's scope from creeping. That
makes Target tooling idle right now — but idle is not dead. If splitting gets away from him again
over some later span, this is the capability that gets revived, and the mechanism here was hard-won:
the API interception, the public key, the two-endpoint shape, and the tip asymmetry against Walmart
all cost real time to establish and none of it is discoverable by looking at the code.

So a session that finds this doc unreferenced should leave it alone. "Nothing links to it" is the
expected state, not evidence it is stale.

The one thing that would make it *usable* on that future day is the missing reconciliation check in
**Known gaps** above. Establish it on the first live run of the next span, before trusting a single
split — not after.
