import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.headers.host || 'vega-movie-titu.vercel.app';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${protocol}://${host}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VegaMovie API - Documentation & Status</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: rgba(255, 255, 255, 0.1);
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --accent: #58a6ff;
      --success: #3fb950;
      --code-bg: #090d13;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 820px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .title {
      font-size: 24px;
      font-weight: 700;
      color: var(--heading);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(63, 185, 80, 0.1);
      border: 1px solid rgba(63, 185, 80, 0.3);
      color: var(--success);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .card h2 {
      font-size: 18px;
      color: var(--heading);
      margin-bottom: 12px;
    }
    p {
      color: var(--text-muted);
      margin-bottom: 16px;
      font-size: 14px;
    }
    .endpoint-badge {
      display: inline-block;
      background: #238636;
      color: #fff;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      margin-right: 8px;
    }
    .code-block {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      font-size: 13px;
      color: #79c0ff;
      overflow-x: auto;
      word-break: break-all;
      margin-bottom: 16px;
    }
    .features-list {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 10px;
    }
    .features-list li {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
    }
    .features-list span {
      color: var(--success);
      margin-right: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 10px;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--heading);
    }
    td code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      color: #ff7b72;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">VegaMovie Stream API</h1>
        <p style="margin: 4px 0 0 0;">High-performance scraper & byte-range streaming proxy</p>
      </div>
      <div class="status-badge">
        <div class="pulse-dot"></div>
        SYSTEM OPERATIONAL
      </div>
    </div>

    <div class="card">
      <h2>Active Endpoint</h2>
      <p>Resolve any supported movie link and instantly stream or download with seek support.</p>
      <div class="code-block">
        <span class="endpoint-badge">GET</span>${baseUrl}/stream?url={URL}
      </div>

      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>url</code></td>
            <td>string (required)</td>
            <td>Target page URL (Nexdrive, Fast-DL, etc.)</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Usage Examples</h2>
      
      <p><strong>1. HTML5 / ExoPlayer / VLC Media Player:</strong></p>
      <div class="code-block">${baseUrl}/stream?url=https://nexdrive.help/genxfm028383548555738/</div>

      <p><strong>2. Direct cURL / Terminal Test:</strong></p>
      <div class="code-block">curl -I "${baseUrl}/stream?url=https://nexdrive.help/genxfm028383548555738/"</div>
    </div>

    <div class="card">
      <h2>Capabilities</h2>
      <ul class="features-list">
        <li><span>✓</span> HTTP 206 Partial Content</li>
        <li><span>✓</span> Seamless Seeking / Scrubbing</li>
        <li><span>✓</span> Direct 302 Native CDN Delivery</li>
        <li><span>✓</span> Multi-Hop Scraper Engine</li>
      </ul>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).send(html);
}
