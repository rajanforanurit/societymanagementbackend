import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { getOpenApiSpec } from '../src/config/swagger';
import '../src/routes';

const spec = getOpenApiSpec();
const dir = path.resolve(__dirname, '../src/docs');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'openapi.yaml'), YAML.stringify(spec, { lineWidth: 0 }));
const ops = Object.values(spec.paths).reduce((n: number, p: any) => n + Object.keys(p).length, 0);
process.stdout.write(`OpenAPI ${spec.openapi}: ${Object.keys(spec.paths).length} paths, ${ops} operations written to src/docs/openapi.yaml\n`);
