/**
 * Lucide's licence notice reaches the bundle the app ships, not only the source tree (T45).
 *
 * ISC asks for the copyright and permission notice "in all copies", and the copy a visitor
 * downloads is the minified bundle. `LICENSE-lucide.txt` sits beside the five copied icons, but
 * the build never emits it, and minifying drops every comment unless told to keep legal ones; so
 * each icon carries a `/*! @license` banner comment, as Lucide's own packages do, and `vite.config.ts`
 * keeps legal comments. This builds the icons with the project's own configuration, minified, and
 * reads what comes out.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { build, loadConfigFromFile, mergeConfig, type InlineConfig } from 'vite';

const ROOT = process.cwd();
const ICONS = resolvePath(ROOT, 'src/components/icons');
const LUCIDE = ['IconCloudUpload', 'IconImage', 'IconList', 'IconPencil', 'IconTrash'];

/** The minified code the project's build makes of each icon, by name. */
let bundled: Record<string, string>;

beforeAll(async () => {
  // The config refuses a production build with no reCAPTCHA site key; this bundle is never served.
  const allowInsecure = process.env.VITE_ALLOW_INSECURE_LOCAL_DEV;
  process.env.VITE_ALLOW_INSECURE_LOCAL_DEV = 'true';
  try {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      resolvePath(ROOT, 'vite.config.ts'),
      ROOT,
      'silent',
    );
    const icons: InlineConfig = {
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: true,
        lib: {
          entry: Object.fromEntries(LUCIDE.map((n) => [n, join(ICONS, `${n}.vue`)])),
          formats: ['es'],
        },
        rolldownOptions: { external: ['vue'] },
      },
    };
    const result = await build(mergeConfig(loaded!.config, icons));
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) =>
      'output' in r ? r.output : [],
    );
    bundled = Object.fromEntries(
      outputs.flatMap((o) => (o.type === 'chunk' && o.name ? [[o.name, o.code]] : [])),
    );
  } finally {
    if (allowInsecure === undefined) delete process.env.VITE_ALLOW_INSECURE_LOCAL_DEV;
    else process.env.VITE_ALLOW_INSECURE_LOCAL_DEV = allowInsecure;
  }
}, 60_000);

afterAll(() => {
  bundled = {};
});

describe("Lucide's notice", () => {
  it.each(LUCIDE)('survives minifying %s', (name) => {
    const code = bundled[name];
    expect(code, `the build made no chunk for ${name}`).toBeDefined();
    expect(code).toContain('@license lucide-static');
    expect(code).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(code).toContain('licensed under the ISC license');
  });

  it("carries Feather's MIT notice with `trash`, the one copied icon derived from it", () => {
    expect(bundled.IconTrash).toContain('Copyright (c) 2013-present Cole Bemis');
    expect(bundled.IconList).not.toContain('Cole Bemis');
  });

  it('ships the full texts beside the icons in the source', () => {
    const path = join(ICONS, 'LICENSE-lucide.txt');
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('ISC License');
    expect(text).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(text).toContain('copyright notice and this permission notice appear in all copies');
    expect(text).toContain('Copyright (c) 2013-present Cole Bemis');
  });
});
