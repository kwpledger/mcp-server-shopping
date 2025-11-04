# Shopping MCP Server (Amazon & Target)

Model Context Protocol server for interacting with Amazon and Target order history.

## Features

### Amazon
- ✅ Get order history (with year filtering and return status filtering)
- ✅ View cart contents
- ✅ Add items to cart
- ✅ Clear cart
- ✅ Search products
- ✅ Get product details

### Target
- ✅ Get order history (all orders with full details)
- 🚧 Product search (coming soon)
- 🚧 Cart management (coming soon)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Export Cookies

#### For Amazon:
1. Go to [amazon.com](https://www.amazon.com) and log in
2. Install [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) browser extension
3. Click the extension icon and click "Export" → "Export as JSON"
4. Save the cookies to `amazonCookies.json` in the project root

#### For Target:
1. Go to [target.com](https://www.target.com) and log in
2. Use the same Cookie-Editor extension
3. Click "Export" → "Export as JSON"
4. Save the cookies to `targetCookies.json` in the project root

### 3. Build the Project

```bash
npm run build
```

### 4. Configure Claude Desktop

Edit your Claude Desktop config file:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "shopping": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_USERNAME\\source\\repos\\mcp-server-shopping\\build\\index.js"
      ]
    }
  }
}
```

Replace `YOUR_USERNAME` and the path with your actual path.

### 5. Restart Claude Desktop

Close and reopen Claude Desktop completely (check system tray/menu bar).

## Usage

### Amazon Commands

Ask Claude:
- "Show me my Amazon orders from 2025"
- "What's in my Amazon cart?"
- "Search for wireless headphones on Amazon"
- "Show me only orders that weren't returned"

### Target Commands

Ask Claude:
- "Show me my Target order history"
- "What did I order from Target recently?"
- "Show me all my Target orders with their status"

## Available Tools

### Amazon Tools
- `get-orders-history` - Get Amazon order history (supports year filtering and return status)
- `get-cart-content` - View current Amazon cart
- `add-to-cart` - Add item to Amazon cart by ASIN
- `clear-cart` - Clear all items from Amazon cart
- `search-products` - Search for products on Amazon
- `get-product-details` - Get details for a specific Amazon product
- `perform-purchase` - Mock purchase flow (demonstration only)

### Target Tools
- `get-target-orders-history` - Get all Target order history with full details

## Troubleshooting

### "Not logged in" Error
Your cookies have expired. Re-export fresh cookies from your browser.

### No Orders Found
- Make sure you're logged into the correct account
- Verify cookies were exported correctly
- Check that cookies file exists (`amazonCookies.json` or `targetCookies.json`)

### Claude doesn't see the tools
- Verify the path in `claude_desktop_config.json` is correct
- Make sure you ran `npm run build`
- Restart Claude Desktop completely
- Check logs: `%APPDATA%\Claude\Logs\mcp-server-shopping.log` (Windows)

## Architecture

The server uses Puppeteer to:
- **Amazon**: Scrape HTML from order history pages
- **Target**: Intercept API responses from Target's internal APIs

This approach works with cookie-based authentication without requiring API keys.

## Security Note

**Never commit your `amazonCookies.json` or `targetCookies.json` files!** They contain your authentication credentials.

## License

MIT
