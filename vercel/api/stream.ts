import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

async function resolveToDestination(pageUrl: string): Promise<string | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  const response = await axios.get(pageUrl, {
    headers,
    timeout: 12000,
    maxRedirects: 5
  });

  const html = typeof response.data === 'string' ? response.data : '';

  // 1. Direct match with Google CDN
  const videoRegex = /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i;
  const match = html.match(videoRegex);
  if (match) return match[0];

  // 2. Extract from anchor tags
  const $ = cheerio.load(html);
  let destination: string | null = null;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (videoRegex.test(href)) {
      destination = href;
    }
  });

  return destination;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  // Cross-Origin and Byte-Range support headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let finalVideoUrl = url;

    // Scrape if not already a direct video CDN link
    if (!url.includes('googleusercontent.com')) {
      const resolvedUrl = await resolveToDestination(url);
      if (!resolvedUrl) {
        return res.status(404).json({ error: 'Could not extract destination video link from URL.' });
      }
      finalVideoUrl = resolvedUrl;
    }

    // 302 Redirect to destination Google CDN:
    // Video player receives full byte-range seeking capability & Browser starts download.
    return res.redirect(302, finalVideoUrl);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error resolving video stream' });
  }
}
