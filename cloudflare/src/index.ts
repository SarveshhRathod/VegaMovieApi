export default {
  async fetch(request: Request): Promise<Response> {
    const urlObj = new URL(request.url);

    // CORS preflight handling for web video players
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

    // STREAM ROUTE: Handles Range requests & 206 Partial Content for fast forward/backward seek
    if (urlObj.pathname === "/stream") {
      const destination = urlObj.searchParams.get("url");
      if (!destination) {
        return new Response(JSON.stringify({ success: false, error: 'Missing "url" parameter.' }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Forward client's Range header to Googleusercontent
      const clientRange = request.headers.get("Range");
      const forwardHeaders = new Headers({
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "*/*",
      });

      if (clientRange) {
        forwardHeaders.set("Range", clientRange);
      }

      const videoResponse = await fetch(destination, {
        method: request.method,
        headers: forwardHeaders,
      });

      // Pass crucial video playback headers back to player
      const streamHeaders = new Headers();
      streamHeaders.set("Access-Control-Allow-Origin", "*");
      streamHeaders.set("Accept-Ranges", "bytes");

      const headersToPass = [
        "content-type",
        "content-length",
        "content-range",
        "last-modified",
        "etag",
      ];

      for (const h of headersToPass) {
        const val = videoResponse.headers.get(h);
        if (val) streamHeaders.set(h, val);
      }

      if (!streamHeaders.has("content-type")) {
        streamHeaders.set("content-type", "video/mp4");
      }

      return new Response(videoResponse.body, {
        status: videoResponse.status, // Passes 206 status for seeking or 200 for full stream
        statusText: videoResponse.statusText,
        headers: streamHeaders,
      });
    }

    // SCRAPE ROUTE: Extracts direct Google Video link and returns ready-to-play stream URL
    if (urlObj.pathname === "/scrape") {
      const targetUrl = urlObj.searchParams.get("url");
      if (!targetUrl) {
        return new Response(JSON.stringify({ success: false, error: 'Missing target "url" parameter.' }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const pageRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        const html = await pageRes.text();

        // Match Google CDN / usercontent download link
        const videoRegex = /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i;
        const match = html.match(videoRegex);

        if (match) {
          const directLink = match[0];
          const streamUrl = `${urlObj.origin}/stream?url=${encodeURIComponent(directLink)}`;

          return new Response(
            JSON.stringify({
              success: true,
              direct_source: directLink,
              stream_url: streamUrl,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        return new Response(
          JSON.stringify({ success: false, error: "Direct Google video link not found on the page." }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Endpoint not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
