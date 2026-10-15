import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { gunzip, inflate, brotliDecompress } from 'node:zlib';
import { policyHtmlToText } from './storefront';
import type { TrainingSource } from './training-types';

const PAGE_BYTE_LIMIT = 1_000_000;
const decompressGzip = promisify(gunzip);
const decompressDeflate = promisify(inflate);
const decompressBrotli = promisify(brotliDecompress);

export class WebsiteFetchError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus: number
  ) {
    super(message);
  }
}

/** Bound decompressed output too: a small compressed response can expand enormously. */
export async function decodeTrainingBody(
  body: Buffer,
  encoding: string
): Promise<string> {
  const normalized = encoding.trim().toLowerCase();
  if (body.length > PAGE_BYTE_LIMIT)
    throw new Error('Website page exceeds the 1 MB limit.');
  if (!normalized || normalized === 'identity') return body.toString('utf8');
  const decode =
    normalized === 'gzip' || normalized === 'x-gzip'
      ? decompressGzip
      : normalized === 'deflate'
        ? decompressDeflate
        : normalized === 'br'
          ? decompressBrotli
          : null;
  if (!decode)
    throw new Error(
      `Website uses unsupported content encoding: ${normalized.slice(0, 80)}.`
    );
  try {
    const decoded = await decode(body, { maxOutputLength: PAGE_BYTE_LIMIT });
    return decoded.toString('utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_BUFFER_TOO_LARGE'
    )
      throw new Error('Website page exceeds the 1 MB decompressed limit.');
    throw new Error(
      'Website returned invalid compressed HTML. Retry the scan or use another public page.'
    );
  }
}

export function trainingUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new Error('Enter a valid public HTTPS website URL.');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    isIP(host) ||
    host.includes(':') ||
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
  ) {
    throw new Error(
      'Enter a public HTTPS website URL without credentials or a custom port.'
    );
  }
  url.hash = '';
  url.search = '';
  return url;
}

/** Strict IPv4 public unicast allowlist; IPv6-only sites are not fetched. */
export function publicTrainingAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** Resolve once, pin the socket to that address, retain TLS hostname verification. */
export async function fetchTrainingPage(
  url: URL,
  signal: AbortSignal
): Promise<{ status: number; location?: string; html: string }> {
  url = trainingUrl(url.href);
  let cancel: (() => void) | undefined;
  let addresses: LookupAddress[];
  try {
    addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      cancel = () => reject(new Error('Website scan timed out.'));
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, { once: true });
      lookup(url.hostname, { all: true, family: 4 }).then(resolve, reject);
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
  }
  if (
    !addresses.length ||
    addresses.some((entry) => !publicTrainingAddress(entry.address))
  )
    throw new Error('Website resolves to a non-public address.');
  const pinned = addresses[0].address;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        agent: false,
        headers: {
          'User-Agent': 'RecoverAgentTraining/1.0',
          Accept: 'text/html,text/plain',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all)
            callback(null, [{ address: pinned, family: 4 }]);
          else callback(null, pinned, 4);
        },
      },
      (res) => {
        const status = res.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location: res.headers.location, html: '' });
          return;
        }
        if (status !== 200) {
          res.resume();
          const reason =
            status === 401 || status === 403
              ? 'The website denied scanner access. Check storefront password or bot-protection settings.'
              : status === 429
                ? 'The website rate-limited this scan. Wait and retry.'
                : 'The website could not serve this page. Check the URL and retry.';
          reject(
            new WebsiteFetchError(
              `Website returned HTTP ${status}. ${reason}`,
              status
            )
          );
          return;
        }
        const contentType = res.headers['content-type'] ?? '';
        if (
          !/^(text\/html|text\/plain|application\/xhtml\+xml)\b/i.test(
            contentType
          )
        ) {
          res.resume();
          reject(
            new Error(
              `Website returned ${contentType.slice(0, 100) || 'no content type'} instead of readable HTML/text. Use a public website page URL.`
            )
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > PAGE_BYTE_LIMIT)
            req.destroy(new Error('Website page exceeds the 1 MB limit.'));
          else chunks.push(chunk);
        });
        res.on('end', () => {
          void decodeTrainingBody(
            Buffer.concat(chunks),
            res.headers['content-encoding'] ?? ''
          ).then((html) => resolve({ status, html }), reject);
        });
        res.on('error', reject);
        res.on('aborted', () =>
          reject(new Error('Website page download was interrupted.'))
        );
      }
    );
    req.setTimeout(6000, () =>
      req.destroy(new Error('Website page timed out.'))
    );
    req.on('error', reject);
    req.end();
  });
}

export function websiteLinks(html: string, base: URL): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi
  )) {
    try {
      const link = trainingUrl(
        new URL(match[1].replace(/&amp;/g, '&'), base).href
      );
      if (
        link.origin !== base.origin ||
        /\/(cart|checkout|account|admin|login|search)(\/|$)/i.test(
          link.pathname
        ) ||
        /\.(pdf|png|jpe?g|gif|zip|xml|js|css)$/i.test(link.pathname)
      )
        continue;
      links.add(link.href);
    } catch {
      /* Non-web links are not sources. */
    }
  }
  const priority = (link: string) =>
    /faq|polic|shipping|return|refund|contact|about|delivery/i.test(
      new URL(link).pathname
    )
      ? 0
      : /product|collection/i.test(new URL(link).pathname)
        ? 1
        : 2;
  return [...links].sort((a, b) => priority(a) - priority(b)).slice(0, 24);
}

export async function crawlTrainingWebsite(
  raw: string,
  fetchPage = fetchTrainingPage
): Promise<{
  websiteUrl: string;
  sources: TrainingSource[];
  warnings: string[];
}> {
  const signal = AbortSignal.timeout(35_000);
  const sources: TrainingSource[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let root = trainingUrl(raw);
  const queue = [root.href];
  let attempts = 0;
  while (
    queue.length &&
    sources.length < 6 &&
    attempts < 10 &&
    !signal.aborted
  ) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    attempts++;
    try {
      let url = trainingUrl(next);
      let html = '';
      for (let redirects = 0; redirects <= 3; redirects++) {
        const page = await fetchPage(url, signal);
        if (page.location && page.status >= 300 && page.status < 400) {
          if (redirects === 3) throw new Error('Too many website redirects.');
          const target = trainingUrl(new URL(page.location, url).href);
          if (sources.length && target.origin !== root.origin)
            throw new Error('Skipped a redirect outside the website.');
          url = target;
        } else {
          html = page.html;
          break;
        }
      }
      if (!sources.length) root = url;
      if (sources.some((source) => source.url === url.href)) continue;
      const clean = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(
          /<(script|style|svg|noscript|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,
          ''
        );
      const text = policyHtmlToText(clean)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 9000);
      if (text.length < 80)
        throw new Error(
          'Page contains too little readable text; JavaScript-only or password-protected pages need manual training.'
        );
      sources.push({
        id: randomUUID(),
        url: url.href,
        title: policyHtmlToText(
          html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url.hostname
        ).slice(0, 200),
        text,
        fetchedAt: new Date().toISOString(),
      });
      queue.push(...websiteLinks(html, url).filter((link) => !seen.has(link)));
    } catch (error) {
      if (!sources.length) throw error;
      warnings.push(
        `${new URL(next).pathname}: ${error instanceof Error ? error.message : 'Could not read page'}`
      );
    }
  }
  if (!sources.length) throw new Error('No readable website content found.');
  if (queue.length)
    warnings.push(
      'This scan reads up to six public HTML pages. Review coverage and add missing questions or scan a more specific page.'
    );
  return { websiteUrl: root.href, sources, warnings };
}
