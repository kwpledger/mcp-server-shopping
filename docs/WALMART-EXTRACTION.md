# Walmart order extraction

How to get itemized, reconcilable order data out of walmart.com.

> **Verified 2026-09-05** against one saved order page — order `2000148-71457165`, Jul 12 2026,
> delivery-from-store, 11 line items, $71.72 posted. Line items sum to subtotal exactly; subtotal
> plus fees plus tax plus tip equals the posted charge exactly. See *Coverage* at the bottom for
> what that one order does **not** establish.

---

## There is no API to intercept

Walmart server-renders the order details page. The entire order — items, prices, fees, tax, tip,
totals — is embedded in the initial HTML inside:

```html
<script id="__NEXT_DATA__" type="application/json" nonce="...">
```

Filtering the Network tab for `graphql` on an order page returns **nothing**. That is the correct
result. Do not go looking for a request that populates the page; there isn't one, and the ~53
`graphql` entries visible elsewhere in a session belong to the header, search and ad modules.

This is a better shape than Target's. One authenticated page load yields everything, with no second
request, no API key, and no rate-limit pacing.

**The URL carries the durable key in its path:**

```
https://www.walmart.com/orders/200014871457165?groupId=1fe5aa3b2b7829461e6c5da79b25db1f
                              ^^^^^^^^^^^^^^^ order number, dashes stripped
```

**Do not key on `groupId`.** It appears again as the `id` of `div.print-bill-group`, which makes it
look like a stable handle, but the same value was observed on two different orders placed six weeks
apart — it identifies a navigation session, not an order. The order number in the path is the key.

## Finding a value by hand

DevTools' Network **filter box** searches URLs only, which is why every request looks identical.
The **Search drawer** (`Ctrl+Shift+F`) searches response bodies and is what you want. Search the
subtotal (`62.16`); if that misses, search the integer-cents form (`6216`) and the order total.
Tick **Preserve log** first, since the search only covers what is still captured.

## The price model

Everything below lives under `priceDetails`. Every money row has the same shape — `label`,
`value` (number), `displayValue` (string), plus usually-null `strikeThroughValue`, `info`,
`rowInfo`, `subText`, `labelType`.

### The two-totals trap

```json
"grandTotal":         { "label": "Total", "value": 65.56 }
"grandTotalWithTips": { "label": "Total", "value": 71.72 }
```

**Both are labeled `"Total"`. `grandTotal` excludes the driver tip.** The bank charge is
`grandTotalWithTips`. An implementation that reaches for the obvious-looking `grandTotal` is
silently short by the tip on every delivery order, and the error is small enough to look like a
rounding problem rather than a missing field.

This is retailer-specific and must not be generalized. Walmart embeds its own drivers' tips in the
single charge; Target's Shipt tips genuinely post separately. A shared receipt model needs an
explicit per-retailer flag, not an inference.

### Walmart's tip copy is false

```json
"driverTip": { "value": 6.16,
               "subText": { "parts": [ { "text": "(charged separately after delivery)" } ] } }
```

It has never once been charged separately. Treat `subText` as display copy, never as a statement
about payment behavior.

### Fees, and where CRV actually lives

`fees` is an array. The regulatory row carries a stable machine code and its own breakdown:

```json
{ "label": "Estimated regulatory fees & taxes",
  "value": 2.6,
  "labelType": "ESTIMATE_REGULATORY_FEE",
  "rowInfo": { "chargeBreakdown": [
      { "label": "California Redemption Value(CRV)", "displayValue": "$2.60" } ] } }
```

**Key off `labelType`, not the display string.** The page shows the vague bucket name and hides the
breakdown behind an ⓘ tooltip; the JSON has both, so nothing needs clicking.

A waived delivery fee appears as a zero row with the original in `strikeThroughValue`:

```json
{ "label": "Free delivery from store", "labelStyle": "WPLUS_MEMBER",
  "strikeThroughValue": "$9.95", "value": 0 }
```

Rows with `value: 0` still matter — they are the evidence that Walmart+ paid for itself.

### Reconciliation

```
subTotal              62.16
+ fees[].value         2.60   (delivery 0.00 + regulatory 2.60)
+ taxTotal             0.80
= grandTotal          65.56
+ driverTip            6.16
= grandTotalWithTips  71.72   ← the posted bank charge
```

Check this on every order. A mismatch means a field was missed, not that Walmart is wrong.

## Line items

Items live under the shipment's `order_lines`. The useful fields:

| Field | Meaning |
|---|---|
| `productInfo.name` | Item description |
| `productInfo.usItemId` | Walmart's item ID — **use as the dedup key** |
| `priceInfo.linePrice.value` | **What was actually charged.** Authoritative. |
| `priceInfo.preDiscountedLinePrice` | Misleading — see below |
| `priceInfo.unitPrice.displayValue` | e.g. `"$15.97/lb"`, weight-priced items only |
| `priceInfo.additionalLines[]` | e.g. `{ "name": "Ordered price", "value": "$7.99" }` |
| `quantity` | Units; `linePrice` is already extended |
| `productInfo.salesUnitType` | `EACH` or `PACK_WEIGHT` |

**`linePrice` is the only authoritative price.** The eleven `linePrice` values on the verified order
sum to `62.16`, matching `subTotal` to the cent.

### `preDiscountedLinePrice` is not a discount

On a weight-priced item it is a *different weight*, not a markdown:

| Value | ÷ $15.97/lb | What it is |
|---|---|---|
| `additionalLines` "Ordered price" $7.99 | 0.50 lb | standard package ordered |
| `preDiscountedLinePrice` $11.19 | 0.70 lb | package the picker first pulled |
| `linePrice` $8.53 | 0.53 lb | package actually supplied and charged |

The order-level `discounts` array was empty on this order, confirming no discount was involved.
Ignore `preDiscountedLinePrice` unless you are specifically investigating substitutions.

### `salesUnitType: "PACK_WEIGHT"` marks the volatile items

Weight-priced lines are exactly the ones that move between ordering and pickup. They are the
mechanical reason for the timing rule below.

## Timing: only read cleared orders

Walmart revises an order after pickup or delivery — substitutions, out-of-stocks, and every
`PACK_WEIGHT` line. **An order read while its bank transaction is still `Pending` will not match
what posts.** Either wait for `Cleared`, or mark the extraction provisional and re-read later.

This lines up with the sibling project's standing rule that nothing is marked reviewed until it
clears (`quicken-simplifi-mcp/docs/CONVENTIONS.md`).

## Gotchas that cost time

- **The item array appears twice** in the blob. Dedupe on `usItemId` or every order doubles.
- **A browser "Save page as" can truncate the JSON.** The file that established this contract was
  886 KB with 572 KB of JSON and **no closing `</script>`**. Recover by bracket-matching from a
  known key rather than regexing to the closing tag. Prefer copying the `__NEXT_DATA__` contents
  directly over saving the page.
- **`div.od-print-view` is empty** in the served HTML — it is a portal target filled when print
  fires. Reading it before triggering print gets the on-page order card, not the invoice.
- **Never export or share a HAR** of an authenticated Walmart session. It embeds live session
  cookies. A single copied JSON response body carries no credentials and is all anyone needs.

## Coverage

The contract above is verified against **one** order: a delivery-from-store order with a waived
Walmart+ delivery fee, a CRV charge, a driver tip, and one weight-priced substitution.

**Not yet verified — do not assume:**

- Pickup orders and in-store purchases (field shape may differ from delivery)
- Orders with real order-level discounts (`discounts` was empty here)
- Multi-shipment orders (`order_lines` was read from a single shipment)
- Returns, refunds, and cancellations
- Orders paid partly with a gift card or Walmart Cash — note the sibling project's ruling that
  gift-card offsets flip sign between workbook and UI
- Whether `usItemId` is stable across orders for the same product

When one of these first comes up, verify it and add it here with the date.
