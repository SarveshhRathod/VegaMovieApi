// ================= MEMORY CACHE =================
// Caches resolved Google CDN URLs so playback seek/scrub never re-triggers scraping
const urlCache = new Map<string, { target: string; expiry: number }>();

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function isStaticAsset(urlStr: string): boolean {
  return /\.(?:css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot)(?:\?.*)?$/i.test(urlStr);
}

// ================= MULTI-HOP SCRAPER =================
async function resolveToGoogleUrl(
  targetUrl: string,
  debugLog: any[]
): Promise<string | null> {
  // Check memory cache first (valid for 2 hours)
  const cached = urlCache.get(targetUrl);
  if (cached && Date.now() < cached.expiry) {
    debugLog.push({ step: "cache_hit", target: cached.target });
    return cached.target;
  }

  const cookieJar: Record<string, string> = {};
  const getCookieHeader = () =>
    Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

  const updateCookies = (res: Response) => {
    const raw = res.headers.get("set-cookie");
    if (raw) {
      const parts = raw.split(/,(?=\s*[^;]+=[^;]+)/);
      for (const p of parts) {
        const c = p.split(";")[0].trim();
        const eq = c.indexOf("=");
        if (eq !== -1) cookieJar[c.substring(0, eq).trim()] = c.substring(eq + 1).trim();
      }
    }
  };

  const defaultHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  let current = targetUrl;
  let hops = 0;

  while (hops < 7) {
    debugLog.push({ hop: hops, fetching: current });

    const res = await fetch(current, {
      headers: {
        ...defaultHeaders,
        Referer: current,
        ...(Object.keys(cookieJar).length > 0 ? { Cookie: getCookieHeader() } : {}),
      },
      redirect: "manual",
    });

    updateCookies(res);
    debugLog.push({ hop: hops, status: res.status });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (loc) {
        current = resolveUrl(current, loc);
        hops++;
        continue;
      }
    }

    const html = await res.text();

    // 1. Direct match for Googleusercontent video CDN
    const videoMatch = html.match(
      /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i
    );
    if (videoMatch) {
      debugLog.push({ found: "google_video", link: videoMatch[0] });
      urlCache.set(targetUrl, { target: videoMatch[0], expiry: Date.now() + 7200 * 1000 });
      return videoMatch[0];
    }

    // 2. Scan inline scripts for Google direct link
    const scriptUrlMatch = html.match(
      /["'](https?:\/\/[^"']*(?:googleusercontent\.com|drive\.google\.com)[^"']*)["']/i
    );
    if (scriptUrlMatch && !isStaticAsset(scriptUrlMatch[1])) {
      debugLog.push({ found: "google_video_in_js", link: scriptUrlMatch[1] });
      urlCache.set(targetUrl, { target: scriptUrlMatch[1], expiry: Date.now() + 7200 * 1000 });
      return scriptUrlMatch[1];
    }

    // 3. Fast-DL Verification Form Submission
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

      debugLog.push({ found: "form_submission", action: formAction });

      const formRes = await fetch(formAction, {
        method: "POST",
        headers: {
          ...defaultHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: current,
          ...(Object.keys(cookieJar).length > 0 ? { Cookie: getCookieHeader() } : {}),
        },
        body: formData.toString(),
        redirect: "manual",
      });

      updateCookies(formRes);

      if ([301, 302, 303, 307, 308].includes(formRes.status)) {
        const loc = formRes.headers.get("location");
        if (loc) {
          current = resolveUrl(formAction, loc);
          hops++;
          continue;
        }
      }

      const formHtml = await formRes.text();
      const postVideo = formHtml.match(
        /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i
      );
      if (postVideo) {
        debugLog.push({ found: "google_video_via_post", link: postVideo[0] });
        urlCache.set(targetUrl, { target: postVideo[0], expiry: Date.now() + 7200 * 1000 });
        return postVideo[0];
      }

      const nextCandidate = formHtml.match(
        /href=["'](https?:\/\/[^"']*(?:fast-dl|download|drive)[^"']*)["']/i
      );
      if (nextCandidate && !isStaticAsset(nextCandidate[1])) {
        current = nextCandidate[1];
        hops++;
        continue;
      }
    }

    // 4. Onclick JS redirects
    const onclickMatch = html.match(
      /(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i
    );
    if (onclickMatch && !isStaticAsset(onclickMatch[1])) {
      const nextUrl = resolveUrl(current, onclickMatch[1]);
      if (nextUrl !== current) {
        debugLog.push({ found: "onclick_redirect", link: nextUrl });
        current = nextUrl;
        hops++;
        continue;
      }
    }

    // 5. Parse anchor tags (G-Direct, VGMLINKS, Fast-DL) filtering out assets
    const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let foundNext: string | null = null;
    let aMatch;

    while ((aMatch = anchorRegex.exec(html)) !== null) {
      const rawHref = aMatch[1].trim();
      const aText = aMatch[2].replace(/<[^>]+>/g, "").trim();

      if (rawHref.startsWith("#") || rawHref.startsWith("javascript:") || isStaticAsset(rawHref)) {
        continue;
      }

      const fullHref = resolveUrl(current, rawHref);

      if (/G-Direct|VGMLINKS|Verify|Human|Download|Get Link/i.test(aText)) {
        foundNext = fullHref;
        break;
      }

      if (!foundNext && /(?:fast-dl\.one\/dl\/|g-direct|download)/i.test(fullHref) && fullHref !== current) {
        foundNext = fullHref;
      }
    }

    if (foundNext && foundNext !== current) {
      debugLog.push({ found: "anchor_link", link: foundNext });
      current = foundNext;
      hops++;
      continue;
    }

    debugLog.push({ snippet: html.substring(0, 250).replace(/\s+/g, " ") });
    break;
  }

  return null;
}

// ================= WORKER ENTRYPOINT =================
export default {
  async fetch(request: Request): Promise<Response> {
    const urlObj = new URL(request.url);

    // 1. CORS Preflight Support (Crucial for online web players)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type, Accept-Encoding",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // 2. Reverse-Proxy Video Stream Endpoint
    if (urlObj.pathname === "/stream" || urlObj.pathname === "/watch") {
      const inputUrl = urlObj.searchParams.get("url");
      const isDebug = urlObj.searchParams.get("debug") === "1";

      if (!inputUrl) {
        return new Response(JSON.stringify({ success: false, error: 'Missing "?url=" parameter' }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const debugLog: any[] = [];
      let destinationUrl = inputUrl;

      // Scrape only if not already direct Google CDN link
      if (!inputUrl.includes("googleusercontent.com")) {
        const resolved = await resolveToGoogleUrl(inputUrl, debugLog);
        if (!resolved) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Failed to resolve destination video URL",
              debug: debugLog,
            }),
            {
              status: 404,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }
        destinationUrl = resolved;
      }

      // If debug param is set, inspect JSON output
      if (isDebug) {
        return new Response(
          JSON.stringify({ success: true, destination: destinationUrl, trace: debugLog }, null, 2),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // ================= ZERO REDIRECTION STREAM PROXY =================
      // Pass player Range headers straight to Google CDN
      const clientRange = request.headers.get("Range");
      const upstreamHeaders = new Headers({
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
      });

      if (clientRange) {
        upstreamHeaders.set("Range", clientRange);
      }

      // Fetch the video chunks directly from Google
      const upstreamRes = await fetch(destinationUrl, {
        method: request.method,
        headers: upstreamHeaders,
      });

      // Mirror response headers back to player
      const proxyHeaders = new Headers();
      proxyHeaders.set("Access-Control-Allow-Origin", "*");
      proxyHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      proxyHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
      proxyHeaders.set("Accept-Ranges", "bytes");

      const forwardable = [
        "content-type",
        "content-length",
        "content-range",
        "last-modified",
        "etag",
      ];

      for (const headerName of forwardable) {
        const val = upstreamRes.headers.get(headerName);
        if (val) proxyHeaders.set(headerName, val);
      }

      if (!proxyHeaders.has("content-type")) {
        proxyHeaders.set("content-type", "video/mp4");
      }

      // Allows in-browser seeking and direct clean downloads
      proxyHeaders.set("Content-Disposition", 'inline; filename="video.mp4"');

      // Return stream with 206 Partial Content (Seek) or 200 OK
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: proxyHeaders,
      });
    }

    // Default status route
    return new Response(
      JSON.stringify({
        status: "ACTIVE",
        engine: "Zero-Redirection Reverse Proxy",
        usage: "/stream?url=YOUR_NEXDRIVE_URL",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  },
};
