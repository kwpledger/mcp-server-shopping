import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getOrdersHistory } from './orders.js'
import { getCartContent, addToCart, clearCart } from './cart.js'
import { getProductDetails, searchProducts } from './products.js'
import { getAllTargetOrders } from './target-orders.js'

// Create server instance
const server = new McpServer({
  name: 'shopping',
  version: '1.0.0',
})

/**
 * Decode the numeric/named HTML entities Target returns in item descriptions
 * (e.g. "L&#39;Oreal" -> "L'Oreal") so line items read cleanly.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

server.tool(
  'get-orders-history',
  'Get orders history for a user. Optionally filter by year (e.g., 2025, 2024). Set onlyUnreturned to true to exclude returned/refunded items.',
  {
    year: z
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe('Optional year to filter orders (e.g., 2025, 2024, 2023). If not provided, returns recent orders.'),
    onlyUnreturned: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, only shows orders/items that were NOT returned or refunded. Default is false (shows all orders).'),
  },
  async ({ year, onlyUnreturned }) => {
    let ordersHistory: Awaited<ReturnType<typeof getOrdersHistory>>
    try {
      ordersHistory = await getOrdersHistory(year)
    } catch (error: any) {
      console.error('[ERROR][get-orders-history] Error in get-orders-history tool:', error)
      return {
        content: [
          {
            type: 'text',
            text: `An error occurred while retrieving orders history. Error: ${error.message}`,
          },
        ],
      }
    }

    if (!ordersHistory || ordersHistory.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: year ? `No orders found for year ${year}.` : 'No orders found.',
          },
        ],
      }
    }

    // Optimize the data by keeping only essential fields for analysis
    let optimizedOrders = ordersHistory.map(order => {
      const isReturned = order.orderInfo.status.toLowerCase().includes('refund') || 
                         order.orderInfo.status.toLowerCase().includes('return')
      
      return {
        orderDate: order.orderInfo.orderDate,
        total: order.orderInfo.total,
        status: order.orderInfo.status,
        isReturned: isReturned,
        items: order.items.map((item: any) => ({
          title: item.title,
          asin: item.asin,
          returnEligible: item.returnEligible
        }))
      }
    })

    // Filter out returned orders if requested
    if (onlyUnreturned) {
      optimizedOrders = optimizedOrders.filter(order => !order.isReturned)
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(optimizedOrders, null, 2),
        },
      ],
    }
  }
)

server.tool(
  'get-cart-content',
  'Get the current cart content for a user - Always provide the product link when you mention a product in the response',
  {},
  async ({}) => {
    let cartContent: Awaited<ReturnType<typeof getCartContent>>
    try {
      cartContent = await getCartContent()
    } catch (error: any) {
      console.error('[ERROR][get-cart-content] Error in get-cart-content tool:', error)
      return {
        content: [
          {
            type: 'text',
            text: `An error occurred while retrieving cart content. Error: ${error.message}`,
          },
        ],
      }
    }

    if (cartContent.isEmpty) {
      return {
        content: [
          {
            type: 'text',
            text: 'Your Amazon cart is empty.',
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(cartContent, null, 2),
        },
      ],
    }
  }
)

server.tool(
  'add-to-cart',
  'Add a product to the Amazon cart using ASIN - You should always ask for confirmation to the user before running this tool',
  {
    asin: z
      .string()
      .length(10, { message: 'ASIN must be a 10-character string.' })
      .describe('The ASIN (Amazon Standard Identification Number) of the product to add to cart. Must be a 10-character string.'),
  },
  async ({ asin }) => {
    let result: Awaited<ReturnType<typeof addToCart>>
    try {
      result = await addToCart(asin)
    } catch (error: any) {
      console.error('[ERROR][add-to-cart] Error in add-to-cart tool:', error)
      return {
        content: [
          {
            type: 'text',
            text: `An error occurred while adding product to cart. Error: ${error.message}`,
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: result.success ? `✅ ${result.message}` : `❌ Failed to add product to cart: ${result.message}`,
        },
      ],
    }
  }
)

server.tool('clear-cart', 'Clear all items from the Amazon cart', {}, async ({}) => {
  let result: Awaited<ReturnType<typeof clearCart>>
  try {
    result = await clearCart()
  } catch (error: any) {
    console.error('[ERROR][clear-cart] Error in clear-cart tool:', error)
    return {
      content: [
        {
          type: 'text',
          text: `An error occurred while clearing the cart. Error: ${error.message}`,
        },
      ],
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: result.message,
      },
    ],
  }
})

server.tool(
  'get-product-details',
  'Get detailed information about a product using its ASIN - Always provide the product link when you mention a product in the response',
  {
    asin: z
      .string()
      .length(10, { message: 'ASIN must be a 10-character string.' })
      .describe('The ASIN (Amazon Standard Identification Number) of the product to get details for. Must be a 10-character string.'),
  },
  async ({ asin }) => {
    let result: Awaited<ReturnType<typeof getProductDetails>>
    try {
      result = await getProductDetails(asin)
    } catch (error: any) {
      console.error('[ERROR][get-product-details] Error in get-product-details tool:', error)
      return {
        content: [
          {
            type: 'text',
            text: `An error occurred while retrieving product details. Error: ${error.message}`,
          },
        ],
      }
    }

    return {
      content: result.mainImageBase64
        ? [
            {
              type: 'text',
              text: JSON.stringify(result.data, null, 2),
            },
            {
              type: 'image',
              data: result.mainImageBase64,
              mimeType: 'image/jpeg',
            },
          ]
        : [
            {
              type: 'text',
              text: JSON.stringify(result.data, null, 2),
            },
          ],
    }
  }
)

server.tool(
  'search-products',
  'Search for products on Amazon using a search term - Returns a list of products matching the search term - Always provide the product link when you mention a product in the response',
  {
    searchTerm: z
      .string()
      .min(1, { message: 'Search term cannot be empty.' })
      .describe('The search term to look for products on Amazon. For example: "collagen", "laptop", "books"'),
  },
  async ({ searchTerm }) => {
    let result: Awaited<ReturnType<typeof searchProducts>>
    try {
      result = await searchProducts(searchTerm)
    } catch (error: any) {
      console.error('[ERROR][search-products] Error in search-products tool:', error)
      return {
        content: [
          {
            type: 'text',
            text: `An error occurred while searching for products. Error: ${error.message}`,
          },
        ],
      }
    }

    if (!result || result.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No products found for search term "${searchTerm}".`,
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  }
)

server.tool(
  'perform-purchase',
  'Checkout with the current cart and complete the purchase - ' +
    'Before purchasing, you should verify in the cart content that your are not buying another product that was already there. ' +
    'If there are other products, clear the cart then add the items that the user want to buy again to the cart. ' +
    'Eventually you can purchase. ' +
    'You should always ask for confirmation to the user before running this tool',
  {},
  async ({}) => {
    // Mock the purchase confirmation for demonstration purposes
    return {
      content: [
        {
          type: 'text',
          text: '✅ Purchase confirmed! You can now consult your orders history to see the details of your latest purchase.',
        },
      ],
    }
  }
)

// ============================================================================
// TARGET TOOLS
// ============================================================================

server.tool(
  'get-target-orders-history',
  'Get order history from Target.com. Optionally filter by year (e.g., 2025, 2024) and order type (online, instore, or both). Returns orders with essential details: order number, date, total, and items. Set includeItemDetails to true to also pull the full itemized receipt for each order (per-item name, price, quantity, product category, plus subtotal/tax/discounts and payment card) - needed for building category splits that reconcile to the charged total. Note: includeItemDetails is slower as it fetches one receipt per order.',
  {
    year: z.number().int().min(2000).max(2100).optional().describe('Optional year to filter orders (e.g., 2025, 2024, 2023). If not provided, returns all recent orders.'),
    orderType: z.enum(['online', 'instore', 'both']).optional().default('both').describe('Type of orders to fetch: "online" for online orders, "instore" for in-store orders, or "both" (default) for all orders.'),
    includeItemDetails: z.boolean().optional().default(false).describe('If true, enrich each order with its full itemized receipt: per-item price + quantity + product category, subtotal, tax, RedCard/Circle discounts, and payment card. Needed for transaction categorization. Slower - fetches one receipt per order.'),
  },
  async ({ year, orderType = 'both', includeItemDetails = false }) => {
    try {
      console.error(`[INFO] Fetching Target ${orderType} order history${year ? ` for year ${year}` : ''}${includeItemDetails ? ' with item details' : ''}...`)
      const allOrders = await getAllTargetOrders(orderType, includeItemDetails)

      if (!allOrders || allOrders.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No Target orders found.',
            },
          ],
        }
      }

      // Filter by year if specified
      let orders = allOrders
      if (year) {
        orders = allOrders.filter(order => {
          if (!order.placed_date) return false
          const orderYear = new Date(order.placed_date).getFullYear()
          return orderYear === year
        })
        console.error(`[INFO] Filtered to ${orders.length} orders for year ${year}`)
      }

      if (orders.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: year ? `No Target orders found for year ${year}.` : 'No Target orders found.',
            },
          ],
        }
      }

      // Deduplicate orders by order number (Target API sometimes returns duplicates)
      const uniqueOrders = Array.from(
        new Map(orders.map(order => [order.order_number, order])).values()
      )
      
      console.error(`[INFO] Deduplicated ${orders.length} orders down to ${uniqueOrders.length} unique orders`)

      // Optimize the data structure - only keep essential fields
      const optimizedOrders = uniqueOrders.map(order => {
        const base = {
          orderNumber: order.order_number || 'N/A',
          orderDate: order.placed_date || 'N/A',
          total: order.summary?.grand_total || 'N/A',
          orderType: order.order_number?.startsWith('9') ? 'online' : order.order_number?.startsWith('1') ? 'instore' : 'unknown',
          items: (order.order_lines || []).map(line => ({
            description: line.item?.description || 'N/A',
            quantity: line.original_quantity || 0,
          })),
        }

        // When available, attach the itemized receipt with per-line pricing +
        // tax - the detail needed to build category splits that reconcile to
        // the charged total.
        const detail = order.receipt_detail
        if (!detail) return base

        const lineItems = (detail.packages || []).flatMap(pkg =>
          (pkg.order_lines || []).map(line => ({
            description: decodeHtmlEntities(line.item?.description || 'N/A'),
            unitPrice: line.item?.unit_price ?? 'N/A',
            quantity: line.quantity ?? 0,
            productType: line.item?.product_classification?.product_type_name,
            productSubtype: line.item?.product_classification?.product_subtype_name,
            merchandiseType: line.item?.product_classification?.merchandise_type_name,
          }))
        )

        return {
          ...base,
          receipt: {
            storeId: detail.store_id,
            subtotal: detail.summary?.total_product_price,
            tax: detail.summary?.total_taxes,
            adjustments: detail.summary?.total_adjustments,
            grandTotal: detail.summary?.grand_total,
            redcardDiscount: detail.summary?.saved_redcard_discount,
            circleDiscount: detail.summary?.saved_cartwheel_discount,
            payments: (detail.payments || []).map(p => ({
              type: p.guest_display_payment_type || p.payment_type,
              cardNumber: p.card_number,
              amount: p.amount,
            })),
            lineItems,
          },
        }
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(optimizedOrders, null, 2),
          },
        ],
      }
    } catch (error: any) {
      console.error('[ERROR][get-target-orders-history] Error:', error)
      return {
        content: [
          {
            type: 'text',
            text: `An error occurred while retrieving Target orders. Error: ${error.message}\n\nMake sure you have exported your Target cookies to targetCookies.json`,
          },
        ],
      }
    }
  }
)

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[INFO] Shopping MCP Server running on stdio (Amazon + Target support)')
}

main().catch(error => {
  console.error('[ERROR] Fatal error in main():', error)
  process.exit(1)
})
