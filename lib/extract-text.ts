/**
 * Extract plain text from an uploaded file.
 * Supports PDF, DOCX, plain text. Returns the extracted text plus a soft truncation if huge.
 */

const MAX_CHARS = 200_000; // ~50k tokens — comfortable for Llama 3.3 70B's 131k context.

export interface Extracted {
  text: string;
  truncated: boolean;
  approxTokens: number;
}

export async function extractText(filename: string, mimeType: string, bytes: ArrayBuffer): Promise<Extracted> {
  const lower = filename.toLowerCase();
  const buf = Buffer.from(bytes);

  let raw = '';

  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    raw = await extractPdf(buf);
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    raw = await extractDocx(buf);
  } else if (mimeType.startsWith('text/') || lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
    raw = buf.toString('utf-8');
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    lower.endsWith('.pptx')
  ) {
    raw = await extractPptx(buf);
  } else {
    throw new Error(`Unsupported file type: ${filename} (${mimeType}). Use PDF, DOCX, PPTX, TXT, MD, or CSV.`);
  }

  raw = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = raw.length > MAX_CHARS;
  const text = truncated ? raw.slice(0, MAX_CHARS) + '\n\n[...document truncated to first ~50k tokens...]' : raw;
  return {
    text,
    truncated,
    approxTokens: Math.round(text.length / 4),
  };
}

async function extractPdf(buf: Buffer): Promise<string> {
  // unpdf is a serverless-friendly PDF parser (no native deps).
  const { extractText: unpdfExtract, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const result = await unpdfExtract(pdf, { mergePages: true });
  // unpdf's typings narrow .text to string when mergePages=true, but defensively handle both shapes.
  const t = result.text as unknown;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return (t as string[]).join('\n\n');
  return '';
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value ?? '';
}

async function extractPptx(buf: Buffer): Promise<string> {
  // Minimal PPTX text extraction via the underlying XML — no native deps.
  // PPTX is a zip containing slideN.xml files; pull <a:t> text runs out of each.
  const JSZip = (await import('jszip')).default ?? (await import('jszip'));
  // Fallback if pptx parsing dep missing — just return empty.
  try {
    // @ts-ignore — type-check leniency for the dynamic JSZip import shape
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files).filter((n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    const parts: string[] = [];
    for (const name of slideFiles) {
      const xml = await zip.files[name].async('text');
      const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
      const text = matches
        .map((m: string) => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, ''))
        .join(' ')
        .trim();
      if (text) parts.push(text);
    }
    return parts.join('\n\n');
  } catch (e) {
    throw new Error(`PPTX parsing failed (${(e as Error).message}). Try exporting to PDF and re-uploading.`);
  }
}
