import { Page } from 'puppeteer'
import { createTargetBrowserAndPage, throwIfNotLoggedIn } from './target-utils.js'
import { getTargetBaseUrl, TARGET_API_KEY } from './target-config.js'

/**
 * Target order structure from API
 * Note: All fields are optional as the API may return incomplete data
 */
export interface TargetOrder {
  order_number?: string
  placed_date?: string
  order_type?: string
  summary?: {
    grand_total?: string
  }
  order_lines?: Array<{
    item?: {
      tcin?: string
      description?: string
      images?: {
        base_url?: string
        primary_image?: string
      }
    }
    original_quantity?: number
    fulfillment_spec?: {
      fulfillment_type?: string
      fulfillment_method?: string
      status?: {
        key?: string
        code?: string
        date?: string
        operations?: {
          is_returnable?: boolean
          is_cancellable?: boolean
        }
      }
    }
  }>
  /**
   * Full itemized receipt, populated only when item details are requested.
   * Comes from the post_orders/v1/orders/{id}/store endpoint.
   */
  receipt_detail?: TargetReceiptDetail
}

/**
 * Itemized store-receipt detail from post_orders/v1/orders/{id}/store.
 * This is the per-line pricing + tax breakdown needed to build category
 * splits that reconcile to the charged total. All fields optional - the API
 * may return partial data.
 */
export interface TargetReceiptDetail {
  store_receipt_id?: string
  store_id?: string
  order_date?: string
  summary?: {
    total_product_price?: number
    total_taxes?: number
    total_adjustments?: number
    grand_total?: number
    saved_redcard_discount?: string
    saved_cartwheel_discount?: string
  }
  payments?: Array<{
    amount?: number
    card_number?: string
    payment_type?: string
    guest_display_payment_type?: string
  }>
  packages?: Array<{
    order_lines?: Array<{
      quantity?: number
      item?: {
        tcin?: string
        dpci?: string
        description?: string
        unit_price?: string
        list_price?: string
        product_classification?: {
          product_type_name?: string
          product_subtype_name?: string
          merchandise_type_name?: string
        }
      }
    }>
  }>
}

/**
 * API response structure
 */
interface TargetOrdersResponse {
  metadata: {
    total_time: number
    guest_type: string
  }
  guest_id: string
  total_orders: number
  total_pages: number
  orders: TargetOrder[]
}

/**
 * Fetch the full itemized receipt for a single store order.
 *
 * Runs the request from inside the already-authenticated target.com page
 * context (via page.evaluate) so it reuses the session cookies. The endpoint
 * requires the public web API key. Returns undefined on any failure so a
 * single bad receipt never aborts the whole run.
 */
async function fetchStoreReceiptDetail(
  puppeteerPage: Page,
  receiptId: string
): Promise<TargetReceiptDetail | undefined> {
  try {
    const detail = await puppeteerPage.evaluate(
      async (id: string, key: string) => {
        const res = await fetch(
          `https://api.target.com/post_orders/v1/orders/${id}/store?key=${key}`,
          { credentials: 'include', headers: { accept: 'application/json' } }
        )
        if (!res.ok) return { __error: res.status }
        return res.json()
      },
      receiptId,
      TARGET_API_KEY
    )

    if (detail && (detail as any).__error) {
      console.error(`[WARN] Receipt detail for ${receiptId} returned HTTP ${(detail as any).__error}`)
      return undefined
    }
    return detail as TargetReceiptDetail
  } catch (error: any) {
    console.error(`[WARN] Failed to fetch receipt detail for ${receiptId}: ${error?.message || error}`)
    return undefined
  }
}

/**
 * Get order history from Target by intercepting API calls
 * Captures ALL order types (online and instore) from a single page load.
 *
 * When fetchDetails is true, each returned order is additionally enriched with
 * its full itemized receipt (per-line prices + tax), fetched from within the
 * same authenticated page session.
 */
export async function getTargetOrdersHistory(
  page?: number,
  filterType?: 'online' | 'instore',
  fetchDetails: boolean = false
): Promise<{
  orders: TargetOrder[]
  totalOrders: number
  totalPages: number
  currentPage: number
}> {
  const { browser, page: puppeteerPage } = await createTargetBrowserAndPage()

  try {
    const apiResponses: Map<string, TargetOrdersResponse> = new Map()
    const currentPage = page || 1

    // Set up request interception to capture API response
    await puppeteerPage.setRequestInterception(true)
    
    puppeteerPage.on('request', request => {
      request.continue()
    })

    puppeteerPage.on('response', async response => {
      const url = response.url()
      
      // Capture ALL order history API responses - Target makes multiple calls
      if (url.includes('guest_order_aggregations/v1/order_history')) {
        try {
          const responseData = await response.json()
          
          if (responseData && responseData.orders !== undefined) {
            // Extract the order type from URL
            const orderTypeMatch = url.match(/order_purchase_type=([A-Z]+)/)
            const orderType = orderTypeMatch ? orderTypeMatch[1] : 'UNKNOWN'
            
            apiResponses.set(orderType, responseData)
            console.error(`[INFO] Captured ${responseData.orders.length} ${orderType} orders`)
          }
        } catch (error) {
          // Silently ignore parsing errors
        }
      }
    })

    // Navigate to orders page (will trigger API calls for all order types)
    const ordersUrl = `${getTargetBaseUrl()}/orders${currentPage > 1 ? `?page=${currentPage}` : ''}`
    console.error(`[INFO] Navigating to Target orders page: ${ordersUrl}`)
    
    await puppeteerPage.goto(ordersUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    })

    // Check if logged in
    throwIfNotLoggedIn(puppeteerPage)

    // Wait for API calls to complete (Target makes multiple API calls)
    await new Promise(resolve => setTimeout(resolve, 5000))

    if (apiResponses.size === 0) {
      throw new Error(`Failed to capture any Target API responses. Cookies may be expired.`)
    }

    console.error(`[INFO] Captured ${apiResponses.size} API response types: ${Array.from(apiResponses.keys()).join(', ')}`)

    // Combine orders based on filter
    let allOrders: TargetOrder[] = []
    let totalOrders = 0
    let totalPages = 1

    if (filterType) {
      // Only return specific type
      const purchaseType = filterType === 'online' ? 'ONLINE' : 'INSTORE'
      const response = apiResponses.get(purchaseType)
      if (response) {
        allOrders = response.orders
        totalOrders = response.total_orders
        totalPages = response.total_pages
      }
    } else {
      // Combine all types
      for (const response of apiResponses.values()) {
        allOrders.push(...response.orders)
        totalOrders += response.total_orders
        totalPages = Math.max(totalPages, response.total_pages)
      }
    }

    // Optionally enrich each order with its full itemized receipt. Done here,
    // while the authenticated page is still open, so the in-page fetch reuses
    // the session cookies. Sequential to stay gentle on Target's API.
    if (fetchDetails) {
      console.error(`[INFO] Fetching itemized receipt details for ${allOrders.length} orders...`)
      for (const order of allOrders) {
        if (!order.order_number) continue
        const detail = await fetchStoreReceiptDetail(puppeteerPage, order.order_number)
        if (detail) order.receipt_detail = detail
        // Small delay between receipt fetches to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    return {
      orders: allOrders,
      totalOrders,
      totalPages,
      currentPage
    }

  } finally {
    await browser.close()
  }
}

/**
 * Get all orders across all pages
 * Since we capture all order types in one page load, we just filter the results
 */
export async function getAllTargetOrders(
  orderType: 'online' | 'instore' | 'both' = 'both',
  fetchDetails: boolean = false
): Promise<TargetOrder[]> {
  console.error(`[INFO] Fetching Target orders (type: ${orderType}${fetchDetails ? ', with item details' : ''})...`)

  const filterType = orderType === 'both' ? undefined : orderType

  const firstPage = await getTargetOrdersHistory(1, filterType, fetchDetails)
  const allOrders: TargetOrder[] = [...firstPage.orders]

  console.error(`[INFO] Found ${firstPage.totalPages} pages with ${firstPage.totalOrders} total orders`)

  // Fetch remaining pages if needed
  for (let page = 2; page <= firstPage.totalPages; page++) {
    console.error(`[INFO] Fetching page ${page}/${firstPage.totalPages}...`)
    const pageData = await getTargetOrdersHistory(page, filterType, fetchDetails)
    allOrders.push(...pageData.orders)
  }

  console.error(`[INFO] Retrieved ${allOrders.length} total orders`)
  return allOrders
}
