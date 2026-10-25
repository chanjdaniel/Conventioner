/**
 * The app owns its components and icons, and depends on no PrimeTek package (ADR 0015, T45).
 *
 * The component kit and icon font it used went proprietary at their next majors, and what it used
 * of them, three dialogs, text and number fields, a two-way choice and five glyphs, the app already
 * had its own of: `AppDialog`, `.field`, native inputs and local SVG icons. Installed with no
 * theme, the kit's dialogs drew with no window and no scrim in production, so a kit added back
 * "for one widget" is a decision this test makes someone read the ADR for first.
 *
 * Both files are read, because either alone lets one back: `package.json` names what was chosen,
 * and the lockfile also holds what came in under something else.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PRIMETEK = /^(primevue|primeicons|@primevue\/|@primeuix\/)/;

describe('the front end depends on no PrimeTek package', () => {
  it('package.json declares none', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(declared.filter((name) => PRIMETEK.test(name))).toEqual([]);
  });

  it('the lockfile installs none', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
    const installed = Object.keys(lock.packages).map((path) =>
      path.replace(/^.*node_modules\//, ''),
    );
    expect(installed.filter((name) => PRIMETEK.test(name))).toEqual([]);
  });
});
