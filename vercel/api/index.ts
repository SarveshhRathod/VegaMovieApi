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
  <title>VegaMovie API - Status & Docs</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: rgba(255, 255, 255, 0.1);
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --success: #3fb950;
      --code-bg: #090d13;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .title { font-size: 22px; font-weight: 700; color: var(--heading); }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(63, 185, 80, 0.1);
      border: 1px solid rgba(63, 185, 80, 0.3);
      color: var(--success);
      padding: 6px 12px;
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
      padding: 20px;
      margin-bottom: 20px;
    }
    .card h2 { font-size: 17px; color: var(--heading); margin-bottom: 10px; }
    p { color: var(--text-muted); margin-bottom: 12px; font-size: 14px; }
    .code-block {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 13px;
      color: #79c0ff;
      overflow-x: auto;
      word-break: break-all;
      margin-bottom: 12px;
    }
    .badge {
      display: inline-block;
      background: #238636;
      color: #fff;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      margin-right: 6px;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); }
    th { color: var(--heading); }
    td code { background: var(--code-bg); padding: 2px 6px; border-radius: 4px; color: #ff7b72; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">VegaMovie API</h1>
        <p style="margin: 2px 0 0 0;">Unified Scraper & Byte-Range Streaming Engine</p>
      </div>
      <div class="status-badge">
        <div class="pulse-dot"></div>
        ACTIVE
      </div>
    </div>

    <div class="card">
      <h2>1. Direct Stream & Player Playback Endpoint</h2>
      <p>Supports scrubbing/seeking (HTTP 206) in VLC, ExoPlayer, MX Player, and auto-download in browsers.</p>
      <div class="code-block"><span class="badge">GET</span>${baseUrl}/stream?url={TARGET_URL}</div>
      <table>
        <thead>
          <tr><th>Query Param</th><th>Type</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>url</code></td><td>string (required)</td><td>Nexdrive / Fast-DL / CDN target link</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>2. JSON Scrape Endpoint</h2>
      <p>Returns raw direct destination video link without initiating redirect.</p>
      <div class="code-block"><span class="badge">GET</span>${baseUrl}/scrape?url={TARGET_URL}</div>
    </div>

    <div class="card">
      <h2>Live Test Example</h2>
      <div class="code-block">${baseUrl}/stream?url=https://nexdrive.help/genxfm028383548555738/</div>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).send(html);
}
