import * as cheerio from 'cheerio'
import fs from 'fs'
import puppeteer from 'puppeteer'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { USE_MOCKS, EXPORT_LIVE_SCRAPING_FOR_MOCKS, getAmazonDomain } from './config.js'
import { createBrowserAndPage, getTimestamp, throwIfNotLoggedIn } from './utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ##################################
// Get Orders History
// ##################################

export async function getOrdersHistory(year?: number) {
  const allOrders: any[] = []
  
  if (USE_MOCKS) {
    console.error('[INFO][get-orders-history] Fetching orders history from mocks')
    const mockPath = `${__dirname}/../mocks/getOrdersHistory.html`
    const html = fs.readFileSync(mockPath, 'utf-8')
    const $ = cheerio.load(html)
    const orderCards = $('.order-card')
      .map((index, element) => extractOrdersHistoryPageData($, $(element)))
      .get()
    return orderCards
  }

  const domain = getAmazonDomain()
  let url = `https://www.${domain}/-/en/gp/css/order-history`
  
  // Add year filter to URL if specified
  if (year) {
    url += `?timeFilter=year-${year}`
    console.error(`[INFO][get-orders-history] Filtering orders for year ${year}`)
  }
  
  console.error(`[INFO][get-orders-history] Fetching orders history from ${url}`)

  const { browser, page } = await createBrowserAndPage()

  try {
    // Navigate to the page
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // Handle login if needed
    await throwIfNotLoggedIn(page)

    // Wait for the order cards to load (adjust selector as needed)
    try {
      await page.waitForSelector('.order-card, .your-orders-content-container', { timeout: 10000 })
    } catch (e) {
      throw new Error(
        '[INFO][get-orders-history] Could not find orders card selector. Ensure you are logged in and the orders history is accessible.'
      )
    }

    // Scrape all pages
    let pageNumber = 1
    let hasNextPage = true

    while (hasNextPage) {
      console.error(`[INFO][get-orders-history] Scraping page ${pageNumber}`)

      // Wait a bit for the page to fully load
      await page.waitForSelector('.order-card', { timeout: 10000 })

      if (EXPORT_LIVE_SCRAPING_FOR_MOCKS && pageNumber === 1) {
        // Export only the first page to mock file
        const timestamp = getTimestamp()
        const mockPath = `${__dirname}/../mocks/getOrdersHistory_${timestamp}.html`
        const orderCardsHtml = await page.$$eval('.order-card, .your-orders-content-container', elements =>
          elements.map(el => el.outerHTML).join('\n')
        )
        fs.writeFileSync(mockPath, orderCardsHtml)
        console.error(`[INFO][get-orders-history] Exported order cards HTML to ${mockPath}`)
      }

      // Get the HTML content and parse orders
      const html = await page.content()
      const $ = cheerio.load(html)
      const orderCards = $('.order-card')
        .map((index, element) => extractOrdersHistoryPageData($, $(element)))
        .get()
      
      console.error(`[INFO][get-orders-history] Found ${orderCards.length} orders on page ${pageNumber}`)
      allOrders.push(...orderCards)

      // Check if there's a next page
      const nextButton = await page.$('.a-pagination .a-last a')
      
      if (nextButton) {
        const nextButtonText = await page.evaluate(el => el?.textContent?.trim() || '', nextButton)
        
        if (nextButtonText.includes('Next')) {
          console.error(`[INFO][get-orders-history] Navigating to page ${pageNumber + 1}`)
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            nextButton.click()
          ])
          pageNumber++
          
          // Add a small delay between page requests
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
          hasNextPage = false
        }
      } else {
        hasNextPage = false
      }
    }

    console.error(`[INFO][get-orders-history] Completed scraping. Total orders found: ${allOrders.length}`)
  } finally {
    await browser.close()
  }

  return allOrders
}

function extractOrdersHistoryPageData($: cheerio.CheerioAPI, $card: cheerio.Cheerio<any>) {
  // Extract order information
  const orderNumber = $card.find('.yohtmlc-order-id span').last().text().trim()
  const orderDate = $card.find('.order-header__header-list-item').first().find('.a-size-base').text().trim()
  const total = $card.find('.order-header__header-list-item').eq(1).find('.a-size-base').text().trim()
  const status = $card.find('.delivery-box__primary-text').text().trim()
  const collectionMatch = status.match(/Collected on (.+)/)
  const collectionDate = collectionMatch ? collectionMatch[1] : null

  // Extract delivery address
  const deliveryName = $card.find('.a-popover-preload h5').text().trim()
  const deliveryAddress = $card.find('.a-popover-preload .a-row').eq(1).text().trim().replace(/\s+/g, ' ')
  const deliveryCountry = $card.find('.a-popover-preload .a-row').last().text().trim()

  // Extract items
  const items: {
    title: string
    image: string | undefined
    productUrl: string | undefined
    asin: string | null
    returnEligible: boolean
    returnDate: string | null
  }[] = []
  $card.find('.item-box').each((index, element) => {
    const $element = $(element)
    const title = $element.find('.yohtmlc-product-title a').text().trim()
    const image = $element.find('.product-image img').attr('src')
    const productUrl = $element.find('.yohtmlc-product-title a').attr('href')
    const returnText = $element.find('.a-size-small').text().trim()

    let asin = null
    if (productUrl) {
      const asinMatch = productUrl.match(/\/dp\/([A-Z0-9]{10})/)
      asin = asinMatch ? asinMatch[1] : null
    }

    let returnEligible = false
    let returnDate = null
    if (returnText.includes('Return or Replace Items')) {
      returnEligible = true
      const returnDateMatch = returnText.match(/until (.+)/)
      returnDate = returnDateMatch ? returnDateMatch[1] : null
    }

    items.push({
      title,
      image,
      productUrl,
      asin,
      returnEligible,
      returnDate,
    })
  })

  return {
    orderInfo: {
      orderNumber,
      orderDate,
      total,
      deliveryAddress: {
        name: deliveryName,
        address: deliveryAddress,
        country: deliveryCountry,
      },
      status,
      collectionDate,
    },
    items,
  }
}