import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

async function fetchWithSession(
  targetUrl: string,
  cookieJar: Record<string, string>,
  options: RequestInit = {}
): Promise<{ text: string; status: number; location: string | null; url: string }> {
  const cookieHeader = Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const headers = new Headers({
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Referer': targetUrl,
    ...(options.headers as any),
  });

  if (cookieHeader) {
    headers.set('Cookie', cookieHeader);
  }

  const res = await fetch(targetUrl, {
    ...options,
    headers,
    redirect: 'manual',
  });

  // Extract set-cookie
  const rawCookies = res.headers.get('set-cookie');
  if (rawCookies) {
    const parts = rawCookies.split(/,(?=\s*[^;]+=[^;]+)/);
    for (const part of parts) {
      const cookie = part.split(';')[0].trim();
      const eqIdx = cookie.indexOf('=');
      if (eqIdx !== -1) {
        cookieJar[cookie.substring(0, eqIdx).trim()] = cookie.substring(eqIdx + 1).trim();
      }
    }
  }

  const text = await res.text();
  const location = res.headers.get('location');

  return { text, status: res.status, location, url: targetUrl };
}

function findDirectVideoLink(html: string): string | null {
  const videoRegex = /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i;
  const match = html.match(videoRegex);
  if (match) return match[0];

  const $ = cheerio.load(html);
  let result: string | null = null;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (videoRegex.test(href)) {
      result = href;
    }
  });
  return result;
}

async function resolveFullWorkflow(inputUrl: string): Promise<string | null> {
  const cookieJar: Record<string, string> = {};

  // Step 1: Fetch the initial Nexdrive page
  let step1 = await fetchWithSession(inputUrl, cookieJar);

  // Handle immediate 3xx redirects
  if ([301, 302, 303, 307, 308].includes(step1.status) && step1.location) {
    step1 = await fetchWithSession(resolveUrl(inputUrl, step1.location), cookieJar);
  }

  // Check if video link is already here
  let directVideo = findDirectVideoLink(step1.text);
  if (directVideo) return directVideo;

  // Step 2: Extract G-Direct or VGMLINKS candidate link
  const $1 = cheerio.load(step1.text);
  const candidates: string[] = [];

  $1('a[href]').each((_, el) => {
    const txt = $1(el).text().trim();
    const href = $1(el).attr('href');
    if (href && (txt.includes('G-Direct') || txt.includes('VGMLINKS') || /fast-dl|download|hubcloud/i.test(href))) {
      candidates.push(resolveUrl(step1.url, href));
    }
  });

  if (!candidates.length) {
    // If no specific buttons found, scan all external download links
    $1('a[href]').each((_, el) => {
      const href = $1(el).attr('href') || '';
      if (!href.startsWith('#') && !href.startsWith('javascript:') && href.startsWith('http')) {
        candidates.push(href);
      }
    });
  }

  // Step 3: Iterate candidates and follow the verification process
  for (const candidateUrl of candidates) {
    let currentUrl = candidateUrl;
    let hops = 0;

    while (hops < 6) {
      const res = await fetchWithSession(currentUrl, cookieJar);

      if ([301, 302, 303, 307, 308].includes(res.status) && res.location) {
        currentUrl = resolveUrl(currentUrl, res.location);
        hops++;
        continue;
      }

      directVideo = findDirectVideoLink(res.text);
      if (directVideo) return directVideo;

      // Handle Fast-DL verification button/form
      const $page = cheerio.load(res.text);
      const verifyBtn = $page('button, a')
        .filter((_, el) => /Click Here to Verify|Verify|I'm Human|Get Link|Download/i.test($page(el).text()))
        .first();

      if (verifyBtn.length) {
        const form = verifyBtn.closest('form');
        if (form.length) {
          const actionAttr = form.attr('action') || '';
          const action = actionAttr ? resolveUrl(currentUrl, actionAttr) : currentUrl;
          const method = (form.attr('method') || 'post').toLowerCase();

          const formData = new URLSearchParams();
          form.find('input').each((_, input) => {
            const name = $page(input).attr('name');
            const val = $page(input).attr('value') || '';
            if (name) formData.append(name, val);
          });

          const postRes = await fetchWithSession(action, cookieJar, {
            method: method.toUpperCase(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Referer: currentUrl,
            },
            body: method === 'post' ? formData.toString() : undefined,
          });

          if ([301, 302, 303, 307, 308].includes(postRes.status) && postRes.location) {
            currentUrl = resolveUrl(action, postRes.location);
            hops++;
            continue;
          }

          directVideo = findDirectVideoLink(postRes.text);
          if (directVideo) return directVideo;
        }

        const dataHref = verifyBtn.attr('data-href') || verifyBtn.attr('href');
        if (dataHref && !dataHref.startsWith('#') && !dataHref.startsWith('javascript:')) {
          currentUrl = resolveUrl(currentUrl, dataHref);
          hops++;
          continue;
        }
      }

      break;
    }
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing ?url= parameter' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (url.includes('googleusercontent.com')) {
    return res.redirect(302, url);
  }

  try {
    const finalVideoUrl = await resolveFullWorkflow(url);

    if (!finalVideoUrl) {
      return res.status(404).json({
        success: false,
        error: 'Destination video URL could not be resolved from this link.'
      });
    }

    return res.redirect(302, finalVideoUrl);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
