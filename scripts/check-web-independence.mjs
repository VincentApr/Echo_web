import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const configurationFiles = [
  'package.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
];
const forbiddenReferences = [
  { label: 'mobile_src', pattern: /mobile_src/ },
  { label: '@mobile', pattern: /@mobile(?:\/|\b)/ },
];
const checkedExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.scss',
  '.ts',
  '.tsx',
]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return checkedExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  }));
  return nestedFiles.flat();
}

const sourceFiles = await collectSourceFiles(sourceRoot);
const files = [
  ...sourceFiles,
  ...configurationFiles.map((file) => path.join(root, file)),
];
const violations = [];

for (const file of files) {
  const content = await readFile(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const reference of forbiddenReferences) {
      if (reference.pattern.test(line)) {
        violations.push(`${path.relative(root, file)}:${index + 1} (${reference.label})`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('Echo_web must not depend on the mobile reference submodule.');
  console.error(violations.map((violation) => `- ${violation}`).join('\n'));
  process.exit(1);
}

console.log('Web independence check passed.');
