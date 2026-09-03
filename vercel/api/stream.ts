import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';

const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    timeout: 12000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://fast-dl.one/'
    }
  })
);

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

  while (hops < 6) {
    const res = await client.get(currentUrl, {
      maxRedirects: 5,
      validateStatus: () => true
    });

    const html = typeof res.data === 'string' ? res.data : '';

    // 1. Check if direct video URL exists in page HTML
    const match = html.match(videoRegex);
    if (match) return match[0];

    const $ = cheerio.load(html);

    // 2. Check anchor tags for direct Google link
    let direct: string | null = null;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (videoRegex.test(href)) direct = href;
    });
    if (direct) return direct;

    // 3. Handle Fast-DL / Nexdrive intermediate forms or buttons
    const verifyBtn = $('button, a').filter((_, el) =>
      /Click Here to Verify|Verify|I'm Human|Get Link|Download/i.test($(el).text())
    ).first();

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

        const formRes = method === 'post' 
          ? await client.post(action, formData.toString(), {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: currentUrl }
            })
          : await client.get(action, { params: Object.fromEntries(formData) });

        const formHtml = typeof formRes.data === 'string' ? formRes.data : '';
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

    // 4. Check standard G-Direct or Fast-dl anchor links
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
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing ?url= parameter. Example: /stream?url=https://nexdrive.help/...' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const videoUrl = await extractGoogleVideoUrl(url);

    if (!videoUrl) {
      return res.status(404).json({
        success: false,
        error: 'Destination video URL could not be resolved. Please verify if the Nexdrive token is still valid.'
      });
    }

    // 302 Redirect to destination Google CDN:
    // Enables seamless forward/backward playback scrub on players, and instant download on browsers
    return res.redirect(302, videoUrl);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
