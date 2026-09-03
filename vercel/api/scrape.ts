import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'URL parameter is required.' });
  }

  try {
    const pageResponse = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });

    const html = pageResponse.data;
    const $ = cheerio.load(html);

    let directLink: string | null = null;
    const regex = /https:\/\/(?:video-downloads|drive)\.googleusercontent\.com\/[^\s"'<>]+/i;

    const match = html.match(regex);
    if (match) {
      directLink = match[0];
    } else {
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (regex.test(href)) {
          directLink = href;
        }
      });
    }

    if (!directLink) {
      return res.status(404).json({ success: false, error: 'Direct Google video URL not detected.' });
    }

    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const streamUrl = `${protocol}://${host}/stream?url=${encodeURIComponent(directLink)}`;

    return res.status(200).json({
      success: true,
      original_destination: directLink,
      stream_url: streamUrl,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
