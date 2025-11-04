import puppeteer, { Browser, Page, Protocol } from 'puppeteer'
import { TARGET_COOKIES, IS_BROWSER_VISIBLE, getTargetBaseUrl } from './target-config.js'

/**
 * Create a browser instance and page with Target cookies
 */
export async function createTargetBrowserAndPage(): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: !IS_BROWSER_VISIBLE,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()

  // Set user agent to avoid detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )

  // Set cookies for Target
  if (TARGET_COOKIES && TARGET_COOKIES.length > 0) {
    const puppeteerCookies = TARGET_COOKIES.map(cookie => {
      // Normalize sameSite value
      let sameSite: 'Strict' | 'Lax' | 'None' | undefined = undefined
      
      if (cookie.sameSite) {
        const sameSiteStr = String(cookie.sameSite).toLowerCase()
        if (sameSiteStr === 'strict') {
          sameSite = 'Strict'
        } else if (sameSiteStr === 'lax') {
          sameSite = 'Lax'
        } else if (sameSiteStr === 'none' || sameSiteStr === 'no_restriction') {
          sameSite = 'None'
        }
        // For 'unspecified' or any other value, leave as undefined
      }

      return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expirationDate,
        httpOnly: cookie.httpOnly ?? false,
        secure: cookie.secure ?? false,
        sameSite: sameSite,
      }
    })

    await page.setCookie(...puppeteerCookies)
    console.error(`[INFO] Set ${puppeteerCookies.length} Target cookies`)
  } else {
    console.error('[WARN] No Target cookies found')
  }

  return { browser, page }
}

/**
 * Check if the page shows that user is not logged in
 */
export function throwIfNotLoggedIn(page: Page) {
  const url = page.url()
  
  if (url.includes('/login') || url.includes('/signin')) {
    throw new Error('Not logged in to Target - please export fresh cookies from your browser')
  }
}

/**
 * Get current timestamp for logging
 */
export function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
}
