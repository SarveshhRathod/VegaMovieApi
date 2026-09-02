import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';

interface ExtractedLink {
  text: string;
  url: string;
  type: 'G-Direct' | 'VGMLINKS';
}

interface RedirectHop {
  url: string;
  status: number;
}

class InstantLinkScraper {
  private client: AxiosInstance;
  private jar: CookieJar;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.jar = new CookieJar();
    this.defaultHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://fast-dl.one/'
    };

    this.client = wrapper(
      axios.create({
        jar: this.jar,
        headers: this.defaultHeaders,
        timeout: 25000,
        validateStatus: () => true // Handle 3xx/4xx manual tracking
      })
    );
  }

  private resolveUrl(base: string, relative: string): string {
    try {
      return new URL(relative, base).href;
    } catch {
      return relative;
    }
  }

  public extractInstantLinks(html: string, baseUrl: string): ExtractedLink[] {
    const $ = cheerio.load(html);
    const links: ExtractedLink[] = [];

    $('a[href]').each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (href && (text.includes('G-Direct') || text.includes('VGMLINKS'))) {
        links.push({
          text,
          url: this.resolveUrl(baseUrl, href),
          type: text.includes('G-Direct') ? 'G-Direct' : 'VGMLINKS'
        });
      }
    });

    $('button').each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes('G-Direct') || text.includes('VGMLINKS')) {
        const parentHref = $(el).closest('a').attr('href');
        if (parentHref) {
          links.push({
            text,
            url: this.resolveUrl(baseUrl, parentHref),
            type: text.includes('G-Direct') ? 'G-Direct' : 'VGMLINKS'
          });
        }
      }
    });

    return links;
  }

  public extractDownloadLink(html: string, baseUrl: string): string | null {
    const $ = cheerio.load(html);
    const downloadRegex =
      /Download|Get Link|Continue|Proceed|Generate|Direct Download|Download File/i;

    let destination: string | null = null;

    // Direct match from anchor tags
    $('a[href]').each((_, el) => {
      if (destination) return;
      const text = $(el).text().trim();
      const href = $(el).attr('href');

      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        return;
      }

      if (downloadRegex.test(text)) {
        destination = this.resolveUrl(baseUrl, href);
        return;
      }

      const lowerHref = href.toLowerCase();
      if (['download', 'get', 'file', 'link'].some((kw) => lowerHref.includes(kw))) {
        destination = this.resolveUrl(baseUrl, href);
        return;
      }

      if (href.includes('drive.google.com') || href.includes('drive.usercontent.google.com')) {
        destination = href;
      }
    });

    if (destination) return destination;

    // Check button elements with onclick
    $('button').each((_, el) => {
      if (destination) return;
      const text = $(el).text().trim();
      if (downloadRegex.test(text)) {
        const onclick = $(el).attr('onclick');
        if (onclick) {
          const match = onclick.match(/window\.location\.href=['"]([^'"]+)['"]/);
          if (match && match[1]) {
            destination = this.resolveUrl(baseUrl, match[1]);
          }
        }
      }
    });

    if (destination) return destination;

    // Scan inline script tags for common file extensions
    $('script').each((_, el) => {
      if (destination) return;
      const content = $(el).html();
      if (content) {
        const match = content.match(
          /["'](https?:\/\/[^"']+\.(?:mp4|zip|rar|mkv|7z|gz|exe))["']/i
        );
        if (match && match[1]) {
          destination = match[1];
        }
      }
    });

    return destination;
  }

  private async handleVerification(
    currentUrl: string,
    html: string
  ): Promise<AxiosResponse<string> | null> {
    const $ = cheerio.load(html);
    const verifyPattern = /Click Here to Verify|Verify|I'm Human/i;

    let targetBtn = $('button')
      .filter((_, el) => verifyPattern.test($(el).text()))
      .first();

    if (!targetBtn.length) {
      targetBtn = $('a')
        .filter((_, el) => verifyPattern.test($(el).text()))
        .first();
    }

    if (!targetBtn.length) return null;

    const form = targetBtn.closest('form');
    if (form.length) {
      const actionAttr = form.attr('action') || '';
      const action = actionAttr ? this.resolveUrl(currentUrl, actionAttr) : currentUrl;
      const method = (form.attr('method') || 'post').toLowerCase();

      const formData = new URLSearchParams();
      form.find('input').each((_, input) => {
        const name = $(input).attr('name');
        const val = $(input).attr('value') || '';
        if (name) formData.append(name, val);
      });

      if (method === 'post') {
        return await this.client.post<string>(action, formData.toString(), {
          headers: {
            ...this.defaultHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: currentUrl
          }
        });
      } else {
        return await this.client.get<string>(action, {
          params: Object.fromEntries(formData.entries()),
          headers: { ...this.defaultHeaders, Referer: currentUrl }
        });
      }
    }

    const onclick = targetBtn.attr('onclick') || '';
    const match = onclick.match(/window\.location\.href=['"]([^'"]+)['"]/);
    if (match && match[1]) {
      const nextUrl = this.resolveUrl(currentUrl, match[1]);
      return await this.client.get<string>(nextUrl, {
        headers: { ...this.defaultHeaders, Referer: currentUrl }
      });
    }

    const dataHref = targetBtn.attr('data-href') || targetBtn.attr('data-url');
    if (dataHref) {
      const nextUrl = this.resolveUrl(currentUrl, dataHref);
      return await this.client.get<string>(nextUrl, {
        headers: { ...this.defaultHeaders, Referer: currentUrl }
      });
    }

    const directLink = targetBtn.attr('href');
    if (directLink && !directLink.startsWith('#')) {
      const nextUrl = this.resolveUrl(currentUrl, directLink);
      return await this.client.get<string>(nextUrl, {
        headers: { ...this.defaultHeaders, Referer: currentUrl }
      });
    }

    return null;
  }

  public async followRedirects(
    startUrl: string,
    maxHops = 10
  ): Promise<{
    finalDestination: string | null;
    redirectHistory: RedirectHop[];
  }> {
    let currentUrl = startUrl;
    let hops = 0;
    const redirectHistory: RedirectHop[] = [];

    while (hops < maxHops) {
      const response = await this.client.get<string>(currentUrl, {
        maxRedirects: 0,
        headers: { ...this.defaultHeaders, Referer: currentUrl }
      });

      redirectHistory.push({
        url: currentUrl,
        status: response.status
      });

      // Handle standard 3xx redirects
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers['location'];
        if (location) {
          currentUrl = this.resolveUrl(currentUrl, location);
          hops++;
          continue;
        }
        break;
      }

      // Successful page load inspection
      if (response.status === 200) {
        const pageHtml = typeof response.data === 'string' ? response.data : '';

        // Check if manual verification step is triggered
        if (/verify|click here/i.test(pageHtml)) {
          const verifiedResponse = await this.handleVerification(currentUrl, pageHtml);
          if (verifiedResponse && verifiedResponse.status === 200) {
            const finalLink = this.extractDownloadLink(verifiedResponse.data, currentUrl);
            if (finalLink) {
              return { finalDestination: finalLink, redirectHistory };
            }
          }
        }

        const directDownload = this.extractDownloadLink(pageHtml, currentUrl);
        if (directDownload) {
          return { finalDestination: directDownload, redirectHistory };
        }

        break;
      }

      break;
    }

    return { finalDestination: null, redirectHistory };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.'
    });
  }

  const { url, format } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing required "url" query parameter.'
    });
  }

  try {
    const scraper = new InstantLinkScraper();

    // Step 1: Initial page fetch
    const initialResponse = await axios.get<string>(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });

    if (initialResponse.status !== 200) {
      return res.status(502).json({
        success: false,
        error: `Failed to fetch target URL with status: ${initialResponse.status}`
      });
    }

    // Step 2: Extract instant link candidates
    const links = scraper.extractInstantLinks(initialResponse.data, url);
    if (!links.length) {
      return res.status(404).json({
        success: false,
        error: 'No valid download links (G-Direct/VGMLINKS) detected on the page.'
      });
    }

    // Step 3: Iterate unique candidate links
    const uniqueMap = new Map<string, ExtractedLink>();
    for (const item of links) {
      if (!uniqueMap.has(item.url)) {
        uniqueMap.set(item.url, item);
      }
    }

    let finalLink: string | null = null;
    let successfulHopCount = 0;
    let matchedSourceType = '';
    let matchedSourceUrl = '';

    for (const [_, item] of uniqueMap) {
      const outcome = await scraper.followRedirects(item.url);
      if (outcome.finalDestination) {
        finalLink = outcome.finalDestination;
        successfulHopCount = outcome.redirectHistory.length;
        matchedSourceType = item.type;
        matchedSourceUrl = item.url;
        break;
      }
    }

    if (!finalLink) {
      return res.status(404).json({
        success: false,
        error: 'Failed to resolve intermediate redirects or challenge tokens.'
      });
    }

    // Step 4: Respond with JSON or HTTP 302 redirect
    if (format === 'json') {
      return res.status(200).json({
        success: true,
        initial_url: url,
        destination_link: finalLink,
        source_type: matchedSourceType,
        source_url: matchedSourceUrl,
        redirect_hops: successfulHopCount
      });
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.redirect(302, finalLink);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error processing the request.'
    });
  }
}
