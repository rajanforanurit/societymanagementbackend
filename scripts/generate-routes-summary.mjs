// Builds a compact, per-section route index from src/docs/openapi.yaml.
// Usage: node scripts/generate-routes-summary.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, 'src/docs/openapi.yaml');
const output = resolve(root, 'src/docs/routes-summary.json');

const spec = parse(readFileSync(input, 'utf8'));
const methods = ['get', 'post', 'put', 'patch', 'delete'];

const sections = {};
for (const tag of spec.tags ?? []) {
  sections[tag.name] = { description: tag.description ?? '', routes: [] };
}

let total = 0;
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of methods) {
    const op = item[method];
    if (!op) continue;
    const tag = op.tags?.[0] ?? 'Untagged';
    sections[tag] ??= { description: '', routes: [] };
    const isPublic = !op.security || op.security.length === 0;
    const route = `${method.toUpperCase()} ${path}${isPublic ? ' [public]' : ''}${op.summary ? ` - ${op.summary}` : ''}`;
    sections[tag].routes.push(route);
    total += 1;
  }
}

const sorted = Object.fromEntries(
  Object.entries(sections)
    .filter(([, s]) => s.routes.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, s]) => [name, { description: s.description, count: s.routes.length, routes: s.routes }]),
);

const doc = {
  title: spec.info?.title,
  version: spec.info?.version,
  generatedFrom: 'src/docs/openapi.yaml',
  totalRoutes: total,
  sections: sorted,
};

writeFileSync(output, JSON.stringify(doc, null, 2) + '\n');
console.log(`Wrote ${output}: ${Object.keys(sorted).length} sections, ${total} routes`);
