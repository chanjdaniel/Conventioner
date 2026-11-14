import { inflateSync } from 'node:zlib';

/**
 * The text of each page of a PDF Chromium printed (`page.pdf`), in page order, so a spec can say
 * what a printed page carries (T318).
 *
 * Chromium writes each page's text as glyph codes of an embedded font, in a Flate-compressed
 * content stream, and maps the codes back to characters in the font's `ToUnicode` CMap; this reads
 * just that much of the format. Whitespace is not reliable: a space may be a glyph or a gap the
 * text is moved by, so a spec compares text with its whitespace taken out (`pdfPagesText` does).
 */

interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

function objectsOf(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const out = new Map<number, PdfObject>();
  for (const match of text.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj\b/g)) {
    const body = match[2]!;
    const opens = /(>>\s*)stream\r?\n/.exec(body);
    if (!opens) {
      out.set(Number(match[1]), { dict: body, stream: null });
      continue;
    }
    const dict = body.slice(0, opens.index + opens[1]!.length);
    const start = opens.index + opens[0].length;
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const end = length ? start + Number(length[1]) : body.lastIndexOf('endstream');
    let stream = Buffer.from(body.slice(start, end), 'latin1');
    if (/\/FlateDecode/.test(dict)) stream = inflateSync(stream);
    out.set(Number(match[1]), { dict, stream });
  }
  return out;
}

function refs(text: string): number[] {
  return [...text.matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1]));
}

/** The dictionary at `/key`, inline or referred to. */
function dictAt(objects: Map<number, PdfObject>, dict: string, key: string): string {
  const referred = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  if (referred) return objects.get(Number(referred[1]))?.dict ?? '';
  const at = dict.indexOf(`/${key}`);
  if (at < 0) return '';
  // From its `<<` to the `>>` that closes it.
  let depth = 0;
  const from = dict.indexOf('<<', at);
  for (let i = from; i < dict.length - 1; i += 1) {
    if (dict.startsWith('<<', i)) {
      depth += 1;
      i += 1;
    } else if (dict.startsWith('>>', i)) {
      depth -= 1;
      i += 1;
      if (depth === 0) return dict.slice(from, i + 1);
    }
  }
  return '';
}

function utf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4)
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
}

interface Font {
  codeLength: number;
  chars: Map<number, string>;
}

function cmapOf(cmap: string): Font {
  const chars = new Map<number, string>();
  const space = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(cmap);
  const codeLength = space ? space[1]!.length : 4;
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      chars.set(parseInt(pair[1]!, 16), utf16(pair[2]!));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1]!.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g,
    )) {
      const low = parseInt(range[1]!, 16);
      const high = parseInt(range[2]!, 16);
      const to = range[3]!;
      if (to.startsWith('[')) {
        const each = [...to.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => utf16(m[1]!));
        each.forEach((ch, i) => chars.set(low + i, ch));
      } else {
        const first = parseInt(to.slice(1, -1), 16);
        for (let code = low; code <= high; code += 1) {
          chars.set(code, String.fromCharCode(first + code - low));
        }
      }
    }
  }
  return { codeLength, chars };
}

function pageText(objects: Map<number, PdfObject>, page: string): string {
  const resources = dictAt(objects, page, 'Resources');
  const fontDict = dictAt(objects, resources, 'Font');
  const fonts = new Map<string, Font>();
  for (const entry of fontDict.matchAll(/\/([^\s/<>]+)\s+(\d+)\s+0\s+R/g)) {
    const font = objects.get(Number(entry[2]))?.dict ?? '';
    const toUnicode = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font);
    const cmap = toUnicode ? objects.get(Number(toUnicode[1]))?.stream : null;
    if (cmap) fonts.set(entry[1]!, cmapOf(cmap.toString('latin1')));
  }
  const contents = /\/Contents\s+(\[[^\]]*\]|\d+\s+0\s+R)/.exec(page);
  const streams = contents ? refs(contents[1]!) : [];
  let text = '';
  for (const id of streams) {
    const content = objects.get(id)?.stream?.toString('latin1') ?? '';
    let font: Font | undefined;
    for (const op of content.matchAll(
      /\/([^\s/]+)\s+[-\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj/g,
    )) {
      if (op[1]) {
        font = fonts.get(op[1]);
        continue;
      }
      const hexes = op[2] ? [...op[2].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((m) => m[1]!) : [op[3]!];
      if (!font) continue;
      for (const raw of hexes) {
        const hex = raw.replace(/\s/g, '');
        for (let i = 0; i + font.codeLength <= hex.length; i += font.codeLength) {
          text += font.chars.get(parseInt(hex.slice(i, i + font.codeLength), 16)) ?? '';
        }
      }
      text += ' ';
    }
  }
  return text;
}

function pagesOf(objects: Map<number, PdfObject>, id: number): string[] {
  const dict = objects.get(id)?.dict ?? '';
  if (/\/Type\s*\/Page\b(?!s)/.test(dict)) return [dict];
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(dict);
  return kids ? refs(kids[1]!).flatMap((kid) => pagesOf(objects, kid)) : [];
}

/** Each page's text, in order, its whitespace taken out. */
export function pdfPagesText(pdf: Buffer): string[] {
  const objects = objectsOf(pdf);
  const catalog = [...objects.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
  const root = catalog ? /\/Pages\s+(\d+)\s+0\s+R/.exec(catalog.dict) : null;
  if (!root) throw new Error('No page tree in this PDF');
  return pagesOf(objects, Number(root[1])).map((page) =>
    pageText(objects, page).replace(/\s/g, ''),
  );
}
