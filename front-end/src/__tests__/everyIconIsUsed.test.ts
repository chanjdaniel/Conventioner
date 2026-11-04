/**
 * Every icon in `components/icons/` is one the app draws (T212, ADR 0015).
 *
 * The folder is where a developer looks before adding an icon, so a drawing nothing uses reads as
 * available and part of the product. It held 14 of them, Vue's scaffold icons among them.
 *
 * This reads imports, never names. Two of the 14 survived a count of names because another icon's
 * comment named each, so a name in a comment, or an import commented out, must not count. Tests do
 * not count either, since a test of an icon is no use of it, and neither does the folder itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';

const SRC = resolvePath(process.cwd(), 'src');
const ICONS = join(SRC, 'components', 'icons');
const TESTS = join(SRC, '__tests__');

/** Every source file that may use an icon: under `src`, outside the tests and the icons. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(vue|ts|tsx)$/.test(file))
    .map((file) => join(SRC, file))
    .filter((file) => !file.startsWith(TESTS + sep) && !file.startsWith(ICONS + sep));
}

/** The code of a file: a component's script blocks, or the whole of a TypeScript file. */
function codeOf(file: string): string {
  const source = readFileSync(file, 'utf8');
  if (!file.endsWith('.vue')) return source;
  const { script, scriptSetup } = parse(source, { filename: file }).descriptor;
  return [script?.content, scriptSetup?.content].join('\n');
}

/** What a file imports, static and dynamic, as absolute paths; a package's name is left out. */
function importsOf(file: string): string[] {
  return ts
    .preProcessFile(codeOf(file))
    .importedFiles.map((imported) => imported.fileName)
    .flatMap((name) => {
      if (name.startsWith('@/')) return [join(SRC, name.slice(2))];
      if (name.startsWith('.')) return [resolvePath(dirname(file), name)];
      return [];
    });
}

describe('every icon', () => {
  it('is imported by a source file outside the tests and the icons', () => {
    const icons = readdirSync(ICONS).filter((file) => /^Icon.*\.vue$/.test(file));
    const imported = new Set(sourceFiles().flatMap(importsOf));

    expect(icons).not.toEqual([]);
    expect(icons.filter((icon) => !imported.has(join(ICONS, icon)))).toEqual([]);
  });
});
