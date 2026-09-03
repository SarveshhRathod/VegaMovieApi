// Helper to extract the final Googleusercontent video link
async function resolveNexDriveToDirectVideo(targetUrl: string): Promise<string | null> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  let currentUrl = targetUrl;
  let hops = 0;
  const maxHops = 5;

  while (hops < maxHops) {
    const res = await fetch(currentUrl, {
      headers,
      redirect: "manual"
    });

    // Handle 3xx redirects
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("Location");
      if (loc) {
        currentUrl = new URL(loc, currentUrl).href;
        hops++;
        continue;
      }
    }

    const html = await res.text();

    // Check for direct Googleusercontent CDN video link
    const videoRegex = /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i;
    const match = html.match(videoRegex);
    if (match) {
      return match[0];
    }

    // Check for intermediate G-Direct / Fast-DL / Nexdrive links
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

    // CORS for video players
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

    // SINGLE ALL-IN-ONE ENDPOINT: Scrape + Seek + Play + Download
    if (urlObj.pathname === "/watch" || urlObj.pathname === "/stream") {
      const inputUrl = urlObj.searchParams.get("url");

      if (!inputUrl) {
        return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Step 1: Scrape & Resolve destination link
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

      // Step 2: Handle Range header for video player scrubbing (aage-peeche)
      const clientRange = request.headers.get("Range");
      const videoFetchHeaders = new Headers({
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "*/*",
      });

      if (clientRange) {
        videoFetchHeaders.set("Range", clientRange);
      }

      // Stream the Google video
      const videoRes = await fetch(destinationVideoUrl, {
        method: request.method,
        headers: videoFetchHeaders,
      });

      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin": "*");
      responseHeaders.set("Accept-Ranges", "bytes");

      // Pass crucial seek & play headers
      const copyHeaders = ["content-type", "content-length", "content-range", "last-modified", "etag"];
      for (const h of copyHeaders) {
        const val = videoRes.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("content-type", "video/mp4");
      }

      // 'inline' ensures player streams it directly, and browser also allows downloading
      responseHeaders.set("Content-Disposition", 'inline; filename="video.mp4"');

      return new Response(videoRes.body, {
        status: videoRes.status, // 206 for forward/backward seeking, 200 for full stream
        statusText: videoRes.statusText,
        headers: responseHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "Use /watch?url=YOUR_NEXDRIVE_URL" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
