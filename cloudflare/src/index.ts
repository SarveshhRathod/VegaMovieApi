// Helper to extract the final Googleusercontent video link
async function resolveNexDriveToDirectVideo(targetUrl: string): Promise<string | null> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  let currentUrl = targetUrl;
  let hops = 0;
  const maxHops = 6;

  while (hops < maxHops) {
    const res = await fetch(currentUrl, {
      headers,
      redirect: "manual",
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (loc) {
        currentUrl = new URL(loc, currentUrl).href;
        hops++;
        continue;
      }
    }

    const html = await res.text();

    const videoRegex = /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i;
    const match = html.match(videoRegex);
    if (match) {
      return match[0];
    }

    const directPattern = /href=["'](https?:\/\/[^"']*(?:fast-dl|g-direct|download|drive)[^"']*)["']/i;
    const nextMatch = html.match(directPattern);
    if (nextMatch && nextMatch[1] && nextMatch[1] !== currentUrl) {
      currentUrl = nextMatch[1];
      hops++;
      continue;
    }

    break;
  }

  return null;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const urlObj = new URL(request.url);

    // Root status & documentation page
    if (urlObj.pathname === "/" || urlObj.pathname === "") {
      const docsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>VegaMovie API - Cloudflare Worker</title>
  <style>
    body { background: #0d1117; color: #c9d1d9; font-family: sans-serif; padding: 40px 20px; }
    .card { background: #161b22; border: 1px solid rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; max-width: 700px; margin: auto; }
    code { background: #090d13; color: #79c0ff; padding: 4px 8px; border-radius: 4px; }
    .badge { background: #238636; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h2>VegaMovie Worker Status: ACTIVE</h2>
    <p>Supports byte-range scrubbing (HTTP 206) and direct browser downloads.</p>
    <p><span class="badge">GET</span> <code>/stream?url={TARGET_URL}</code></p>
    <p><span class="badge">GET</span> <code>/watch?url={TARGET_URL}</code></p>
  </div>
</body>
</html>`;
      return new Response(docsHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // CORS for Players & Web apps
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Unified Stream + Seek + Play + Download Route
    if (urlObj.pathname === "/watch" || urlObj.pathname === "/stream") {
      const inputUrl = urlObj.searchParams.get("url");

      if (!inputUrl) {
        return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let destinationVideoUrl = inputUrl;
      if (!inputUrl.includes("googleusercontent.com")) {
        const resolved = await resolveNexDriveToDirectVideo(inputUrl);
        if (!resolved) {
          return new Response(
            JSON.stringify({ error: "Failed to scrape destination video link from URL" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        destinationVideoUrl = resolved;
      }

      const clientRange = request.headers.get("Range");
      const videoFetchHeaders = new Headers({
        "User-Agent":
          request.headers.get("User-Agent") ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
      });

      if (clientRange) {
        videoFetchHeaders.set("Range", clientRange);
      }

      const videoRes = await fetch(destinationVideoUrl, {
        method: request.method,
        headers: videoFetchHeaders,
      });

      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Accept-Ranges", "bytes");

      const copyHeaders = [
        "content-type",
        "content-length",
        "content-range",
        "last-modified",
        "etag",
      ];
      for (const h of copyHeaders) {
        const val = videoRes.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("content-type", "video/mp4");
      }

      responseHeaders.set("Content-Disposition", 'inline; filename="video.mp4"');

      return new Response(videoRes.body, {
        status: videoRes.status,
        statusText: videoRes.statusText,
        headers: responseHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "Endpoint not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
