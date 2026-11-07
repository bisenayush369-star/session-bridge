import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const root = process.cwd();
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
const args = new Set(process.argv.slice(2));

if (fs.existsSync(envPath)) {
  console.error('.env already exists; refusing to overwrite it.');
  process.exit(1);
}

const example = fs.readFileSync(examplePath, 'utf8');
const pepper = randomBytes(48).toString('base64url');
const next = example.replace(
  'TOKEN_PEPPER=CHANGE_ME_generate_with_openssl_rand_base64_48',
  `TOKEN_PEPPER=${pepper}`,
);
const withProxy = args.has('--tunnel')
  ? next.replace('TRUST_PROXY=true', 'TRUST_PROXY=true')
  : next;

fs.writeFileSync(envPath, withProxy, 'utf8');
console.log('Created .env with a new TOKEN_PEPPER and TRUST_PROXY=true');
