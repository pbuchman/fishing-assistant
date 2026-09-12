import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const [output = '', home = '', node = '', pnpm = ''] = process.argv.slice(2);
for (const value of [output, home, node, pnpm]) {
  if (!value || !/^\/[a-zA-Z0-9_./-]+$/.test(value))
    throw new Error('Supply absolute paths without whitespace or systemd substitutions');
}
const user = home.split('/').at(-1);
if (user !== 'pbuchman') throw new Error('This host installation is configured for pbuchman');
const repo = `${home}/deploy/fishing-assistant`;
const state = `${home}/.local/state/fishing-assistant/deploy`;
const runtime = `${home}/tools/fa-webhook-handler`;
const path = [
  ...new Set([dirname(node), dirname(pnpm), '/usr/local/bin', '/usr/bin', '/bin']),
].join(':');
mkdirSync(output, { recursive: true, mode: 0o700 });
const values = {
  USER: user,
  HOME: home,
  REPO: repo,
  STATE: state,
  RUNTIME: runtime,
  PATH: path,
  NODE: node,
  PNPM: pnpm,
};
for (const name of ['fa-webhook-handler.service', 'fa-pm2.service']) {
  let template = readFileSync(
    new URL(
      name === 'fa-webhook-handler.service' ? 'webhook-handler.service' : name,
      import.meta.url
    ),
    'utf8'
  );
  for (const [key, value] of Object.entries(values))
    template = template.replaceAll(`@${key}@`, value);
  if (/@[A-Z]+@|%h/.test(template)) throw new Error('Unresolved unit template');
  writeFileSync(resolve(output, name), template);
}
process.stdout.write(`Rendered units in ${resolve(output)}\n`);
