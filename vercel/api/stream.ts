import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

async function extractGoogleVideoUrl(targetUrl: string): Promise<string | null> {
  const videoRegex = /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i;

  let currentUrl = targetUrl;
  let hops = 0;
  const cookieJar: Record<string, string> = {};

  const getCookieHeader = () =>
    Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  const updateCookies = (res: Response) => {
    const rawCookies = res.headers.get('set-cookie');
    if (rawCookies) {
      // Split and store cookies
      const parts = rawCookies.split(/,(?=\s*[^;]+=[^;]+)/);
      for (const part of parts) {
        const cookie = part.split(';')[0].trim();
        const eqIdx = cookie.indexOf('=');
        if (eqIdx !== -1) {
          const name = cookie.substring(0, eqIdx).trim();
          const val = cookie.substring(eqIdx + 1).trim();
          cookieJar[name] = val;
        }
      }
    }
  };

  const defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Referer': 'https://fast-dl.one/'
  };

  while (hops < 6) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          ...defaultHeaders,
          ...(Object.keys(cookieJar).length > 0 ? { Cookie: getCookieHeader() } : {})
        },
        redirect: 'manual',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      updateCookies(res);

      // Handle 3xx Redirects
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (location) {
          currentUrl = resolveUrl(currentUrl, location);
          hops++;
          continue;
        }
      }

      const html = await res.text();

      // Check for Google video link directly
      const match = html.match(videoRegex);
      if (match) return match[0];

      const $ = cheerio.load(html);

      // Check anchor tags
      let directLink: string | null = null;
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (videoRegex.test(href)) {
          directLink = href;
        }
      });
      if (directLink) return directLink;

      // Check verify buttons or forms
      const verifyBtn = $('button, a')
        .filter((_, el) =>
          /Click Here to Verify|Verify|I'm Human|Get Link|Download/i.test($(el).text())
        )
        .first();

      if (verifyBtn.length) {
        const form = verifyBtn.closest('form');
        if (form.length) {
          const actionAttr = form.attr('action') || '';
          const action = actionAttr ? resolveUrl(currentUrl, actionAttr) : currentUrl;
          const method = (form.attr('method') || 'post').toLowerCase();

          const formData = new URLSearchParams();
          form.find('input').each((_, input) => {
            const name = $(input).attr('name');
            const val = $(input).attr('value') || '';
            if (name) formData.append(name, val);
          });

          const postController = new AbortController();
          const postTimeout = setTimeout(() => postController.abort(), 8000);

          const formRes = await fetch(action, {
            method: method.toUpperCase(),
            headers: {
              ...defaultHeaders,
              'Content-Type': 'application/x-www-form-urlencoded',
              Referer: currentUrl,
              ...(Object.keys(cookieJar).length > 0 ? { Cookie: getCookieHeader() } : {})
            },
            body: method === 'post' ? formData.toString() : undefined,
            redirect: 'manual',
            signal: postController.signal
          });
          clearTimeout(postTimeout);

          updateCookies(formRes);

          if ([301, 302, 303, 307, 308].includes(formRes.status)) {
            const loc = formRes.headers.get('location');
            if (loc) {
              currentUrl = resolveUrl(action, loc);
              hops++;
              continue;
            }
          }

          const formHtml = await formRes.text();
          const formMatch = formHtml.match(videoRegex);
          if (formMatch) return formMatch[0];
        }

        const href = verifyBtn.attr('href') || verifyBtn.attr('data-href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          currentUrl = resolveUrl(currentUrl, href);
          hops++;
          continue;
        }
      }

      // Check G-Direct / Fast-DL redirects
      let nextHop: string | null = null;
      $('a[href]').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href') || '';
        if (/G-Direct|VGMLINKS/i.test(text) && !href.startsWith('#')) {
          nextHop = resolveUrl(currentUrl, href);
        }
      });

      if (nextHop && nextHop !== currentUrl) {
        currentUrl = nextHop;
        hops++;
        continue;
      }

      break;
    } catch {
      clearTimeout(timeoutId);
      break;
    }
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required "url" parameter. Example: /stream?url=https://nexdrive.help/...'
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Direct Google CDN link bypass
    if (url.includes('googleusercontent.com')) {
      return res.redirect(302, url);
    }

    const videoUrl = await extractGoogleVideoUrl(url);

    if (!videoUrl) {
      return res.status(404).json({
        success: false,
        error: 'Destination video URL could not be resolved from this link.'
      });
    }

    return res.redirect(302, videoUrl);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Internal Server Error'
    });
  }
}
