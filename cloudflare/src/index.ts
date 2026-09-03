// ================= CONFIG & IN-MEMORY CACHE =================
// Caches resolved Google CDN URLs for 1 hour to prevent re-scraping during scrubbing
const urlCache = new Map<string, { target: string; expiry: number }>();

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

// ================= SCRAPER & VERIFICATION ENGINE =================
async function resolveToGoogleUrl(targetUrl: string): Promise<string | null> {
  // 1. Return from cache if present and valid
  const cached = urlCache.get(targetUrl);
  if (cached && Date.now() < cached.expiry) {
    return cached.target;
  }

  const cookieJar: Record<string, string> = {};
  const getCookieHeader = () =>
    Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  const updateCookies = (res: Response) => {
    const raw = res.headers.get('set-cookie');
    if (raw) {
      const parts = raw.split(/,(?=\s*[^;]+=[^;]+)/);
      for (const p of parts) {
        const c = p.split(';')[0].trim();
        const eq = c.indexOf('=');
        if (eq !== -1) cookieJar[c.substring(0, eq).trim()] = c.substring(eq + 1).trim();
      }
    }
  };

  const defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  let current = targetUrl;
  let hops = 0;

  while (hops < 7) {
    const res = await fetch(current, {
      headers: {
        ...defaultHeaders,
        Referer: current,
        ...(Object.keys(cookieJar).length > 0 ? { Cookie: getCookieHeader() } : {}),
      },
      redirect: 'manual',
    });

    updateCookies(res);

    // Follow intermediate 3xx redirects
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (loc) {
        current = resolveUrl(current, loc);
        hops++;
        continue;
      }
    }

    const html = await res.text();

    // Check if direct Google Video Link exists
    const videoMatch = html.match(/https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i);
    if (videoMatch) {
      urlCache.set(targetUrl, { target: videoMatch[0], expiry: Date.now() + 3600 * 1000 });
      return videoMatch[0];
    }

    // Follow Fast-DL, HubCloud or G-Direct links
    const linkMatch = html.match(/href=["'](https?:\/\/[^"']*(?:fast-dl|g-direct|download|hubcloud)[^"']*)["']/i);
    if (linkMatch && linkMatch[1] && linkMatch[1] !== current) {
      current = linkMatch[1];
      hops++;
      continue;
    }

    // Handle verification button / form tokens
    const formMatch = html.match(/<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/i);
    if (formMatch) {
      const formAction = formMatch[1] ? resolveUrl(current, formMatch[1]) : current;
      const formContent = formMatch[2];

      const formData = new URLSearchParams();
      const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi;
      let m;
      while ((m = inputRegex.exec(formContent)) !== null) {
        formData.append(m[1], m[2]);
      }

      const formRes = await fetch(formAction, {
        method: 'POST',
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: current,
          ...(Object.keys(cookieJar).length > 0 ? { Cookie: getCookieHeader() } : {}),
        },
        body: formData.toString(),
        redirect: 'manual',
      });

      updateCookies(formRes);

      if ([301, 302, 303, 307, 308].includes(formRes.status)) {
        const loc = formRes.headers.get('location');
        if (loc) {
          current = resolveUrl(formAction, loc);
          hops++;
          continue;
        }
      }

      const formHtml = await formRes.text();
      const postVideo = formHtml.match(/https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i);
      if (postVideo) {
        urlCache.set(targetUrl, { target: postVideo[0], expiry: Date.now() + 3600 * 1000 });
        return postVideo[0];
      }
    }

    break;
  }

  return null;
}

// ================= WORKER REQUEST HANDLER =================
export default {
  async fetch(request: Request): Promise<Response> {
    const urlObj = new URL(request.url);

    // Root Documentation & Status Endpoint
    if (urlObj.pathname === '/' || urlObj.pathname === '') {
      const docsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>VegaMovie API - Cloudflare Worker</title>
  <style>
    body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, sans-serif; padding: 40px 20px; }
    .card { background: #161b22; border: 1px solid rgba(255,255,255,0.1); padding: 24px; border-radius: 8px; max-width: 720px; margin: auto; }
    h2 { color: #f0f6fc; margin-bottom: 12px; }
    code { background: #090d13; color: #79c0ff; padding: 4px 8px; border-radius: 4px; font-family: monospace; }
    .badge { background: #238636; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>VegaMovie Worker Engine: ONLINE</h2>
    <p>Supports byte-range scrubbing (HTTP 206) in video players and full speed direct browser download.</p>
    <br>
    <p><span class="badge">GET</span> <code>/stream?url={TARGET_URL}</code></p>
    <p><span class="badge">GET</span> <code>/watch?url={TARGET_URL}</code></p>
  </div>
</body>
</html>`;
      return new Response(docsHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // CORS preflight handling
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type, Accept-Encoding',
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Unified Stream + Seek + Play + Download Route
    if (urlObj.pathname === '/stream' || urlObj.pathname === '/watch') {
      const inputUrl = urlObj.searchParams.get('url');

      if (!inputUrl) {
        return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let finalUrl = inputUrl;
      if (!inputUrl.includes('googleusercontent.com')) {
        const resolved = await resolveToGoogleUrl(inputUrl);
        if (!resolved) {
          return new Response(JSON.stringify({ error: 'Failed to resolve destination video URL' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        finalUrl = resolved;
      }

      // Proxy Range request to Google CDN for smooth timeline seeking
      const clientRange = request.headers.get('Range');
      const fetchHeaders = new Headers({
        'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': '*/*',
      });

      if (clientRange) {
        fetchHeaders.set('Range', clientRange);
      }

      const videoRes = await fetch(finalUrl, {
        method: request.method,
        headers: fetchHeaders,
      });

      const responseHeaders = new Headers();
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Accept-Ranges', 'bytes');

      const copyHeaders = [
        'content-type',
        'content-length',
        'content-range',
        'last-modified',
        'etag',
      ];

      for (const h of copyHeaders) {
        const val = videoRes.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      if (!responseHeaders.has('content-type')) {
        responseHeaders.set('content-type', 'video/mp4');
      }

      // 'inline' lets players stream and scrub seamlessly, while browsers download directly
      responseHeaders.set('Content-Disposition', 'inline; filename="video.mp4"');

      return new Response(videoRes.body, {
        status: videoRes.status, // 206 Partial Content when seeking, 200 on initial play
        headers: responseHeaders,
      });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found. Use /stream?url={URL}' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
