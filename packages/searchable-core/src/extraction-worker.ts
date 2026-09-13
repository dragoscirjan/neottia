import { parentPort, workerData } from 'node:worker_threads';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

interface ExtractionJob {
  readonly html: string;
  readonly finalUrl: string;
  readonly requestedUrl: string;
  readonly source: 'direct' | 'wayback';
  readonly maximumContentBytes: number;
}

interface ExtractionResult {
  readonly title: string;
  readonly content: string;
  readonly url: string;
  readonly excerpt?: string;
  readonly siteName?: string;
  readonly source: 'direct' | 'wayback';
}

/** Extracts untrusted DOM content off the runtime thread so deadlines can terminate it. */
function extract(job: ExtractionJob): ExtractionResult {
  const dom = new JSDOM(job.html, { url: job.finalUrl });
  try {
    const article = new Readability(dom.window.document).parse();
    if (!article?.content) throw new Error('EXTRACTION_FAILED');
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const content = turndown.turndown(article.content).trim();
    if (!content) throw new Error('EXTRACTION_FAILED');
    if (Buffer.byteLength(content, 'utf8') > job.maximumContentBytes) throw new Error('EXTRACTED_CONTENT_TOO_LARGE');
    const requested = new URL(job.requestedUrl);
    return {
      title: (article.title || dom.window.document.title || requested.hostname).trim(),
      content,
      url: requested.href,
      ...(article.excerpt ? { excerpt: article.excerpt } : {}),
      ...(article.siteName ? { siteName: article.siteName } : {}),
      source: job.source,
    };
  } finally {
    dom.window.close();
  }
}

try {
  parentPort?.postMessage({ result: extract(workerData as ExtractionJob) });
} catch (error: unknown) {
  const code = error instanceof Error ? error.message : 'EXTRACTION_FAILED';
  parentPort?.postMessage({ error: code });
}
