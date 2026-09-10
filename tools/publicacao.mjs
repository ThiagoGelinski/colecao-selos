import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { preparePublication } from '../src/lib/publicacao/prepare.mjs';

function git(...args) {
  return execFileSync('git', ['--no-optional-locks', ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-')) throw new Error('Uso: npm run publicacao:preparar -- caminho/pacote.json');
  const remote = git('remote', 'get-url', 'origin');
  if (!['https://github.com/ThiagoGelinski/colecao-selos.git', 'https://github.com/ThiagoGelinski/colecao-selos', 'git@github.com:ThiagoGelinski/colecao-selos.git'].includes(remote)) throw new Error('O origin não é o repositório oficial.');
  const baseCommit = git('rev-parse', 'refs/heads/main');
  const names = git('ls-tree', '-r', '--name-only', baseCommit, '--', 'src/data/selos').split('\n').filter(name => /^src\/data\/selos\/SEL-[0-9]{6}\.json$/.test(name));
  if (!names.length) throw new Error('Catálogo base vazio.');
  const baselineRecords = names.map(name => JSON.parse(git('show', baseCommit + ':' + name)));
  const baselineManifest = JSON.parse(git('show', baseCommit + ':manifests/ids.json'));
  const file = path.resolve(args[0]);
  const packet = JSON.parse(await readFile(file, 'utf8'));
  const result = await preparePublication(packet, { root: path.dirname(file), baseCommit, baselineRecords, baselineManifest });
  result.warnings.push('Comparação feita com a main local (' + baseCommit + '); confirmar o HEAD remoto antes de integrar.');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
main().catch(error => {
  process.stdout.write(JSON.stringify({ ok: false, mode: 'preparation_only', can_publish: false, files: [], errors: [error.message] }, null, 2) + '\n');
  process.exitCode = 1;
});
