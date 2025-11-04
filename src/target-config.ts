import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const IS_BROWSER_VISIBLE = false

export const COOKIES_FILE_PATH = `${__dirname}/../targetCookies.json`

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
  } catch (error) {
    console.error(`[ERROR] Failed to load Target cookies from ${COOKIES_FILE_PATH}:`, error)
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
