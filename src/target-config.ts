import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const IS_BROWSER_VISIBLE = false

export const COOKIES_FILE_PATH = `${__dirname}/../targetCookies.json`

/**
 * Public Target web API key. This is not a secret - it is embedded in every
 * request the target.com site makes (visible in the query string of their
 * public API calls) and is required by Target's API gateway. Used to call the
 * store-receipt detail endpoint (post_orders/v1/orders/{id}/store).
 */
export const TARGET_API_KEY = 'ff457966e64d5e877fdbad070f276d18ecec4a01'

/**
 * Load Target cookies from file
 */
export function loadTargetCookiesFile(): {
  domain: string
  expirationDate?: number
  hostOnly?: boolean
  httpOnly?: boolean
  name: string
  path: string
  sameSite?: 'Strict' | 'Lax' | 'None' | 'no_restriction' | 'unspecified'
  secure: boolean
  session?: boolean
  storeId?: string | null
  value: string
}[] {
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE_PATH, 'utf-8'))
    console.error(`[INFO] Loaded ${cookies.length} Target cookies from ${COOKIES_FILE_PATH}`)
    return cookies
  } catch (error: any) {
    // Non-fatal: the server still loads. Target tools will surface an auth
    // error at call time if cookies are missing or invalid.
    console.error(
      `[WARN] No usable targetCookies.json at ${COOKIES_FILE_PATH} (${error?.code || error?.message}). Target tools will be unavailable until you add it.`
    )
    return []
  }
}

/**
 * Go to the Target website and log in to your account
 * Then export cookies as JSON using a browser extension like "Cookie-Editor"
 * and paste them in targetCookies.json
 *
 * @see https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm?hl=fr
 */
export const TARGET_COOKIES = loadTargetCookiesFile()

/**
 * Get the Target domain
 */
export function getTargetDomain(): string {
  return 'target.com'
}

/**
 * Get the Target base URL
 */
export function getTargetBaseUrl(): string {
  return `https://www.${getTargetDomain()}`
}
