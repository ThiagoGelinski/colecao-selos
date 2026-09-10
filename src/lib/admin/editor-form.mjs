/** Browser-safe helpers shared by the editor and its tests. */
export const editorialFields = [
  ['titulo', 'Título', 'text'],
  ['descricao_curta', 'Descrição curta', 'textarea'],
  ['identificacao.pais', 'País', 'text'],
  ['identificacao.tipo', 'Tipo', 'text'],
  ['identificacao.categoria', 'Categoria', 'text'],
  ['identificacao.serie', 'Série', 'text'],
  ['identificacao.tema', 'Temas (um por linha)', 'lines'],
  ['identificacao.valor_facial.valor', 'Valor facial', 'text'],
  ['identificacao.valor_facial.unidade', 'Unidade do valor', 'text'],
  ['emissao.ano', 'Ano de emissão', 'year'],
  ['emissao.data_oficial', 'Data oficial', 'date'],
  ['emissao.data_status', 'Evidência da data', 'text'],
  ['emissao.finalidade', 'Finalidade da emissão', 'text'],
  ['exemplar.uso_postal', 'Uso postal', 'text'],
  ['exemplar.carimbo_frontal', 'Carimbo frontal', 'text'],
  ['exemplar.goma', 'Goma', 'text'],
  ['exemplar.charneira', 'Charneira', 'text'],
  ['exemplar.papel', 'Papel', 'text'],
  ['exemplar.serrilha', 'Serrilha', 'text'],
  ['exemplar.centragem', 'Centragem', 'text'],
  ['exemplar.rasgos', 'Rasgos', 'text'],
  ['exemplar.dobras', 'Dobras', 'text'],
  ['exemplar.manchas', 'Manchas', 'text'],
  ['exemplar.classificacao_visual', 'Classificação visual', 'text'],
  ['exemplar.observacao', 'Observação sobre o exemplar', 'textarea'],
  ['historico.resumo', 'Resumo histórico', 'textarea'],
  ['historico.nota', 'Nota histórica', 'textarea'],
  ['imagens.alt', 'Descrição acessível da imagem', 'textarea'],
  ['seo.title', 'Título da página pública', 'text'],
  ['seo.meta_description', 'Descrição para busca', 'textarea']
];

export function fieldValue(record, path) {
  const value = path.split('.').reduce((current, key) => current?.[key], record);
  return Array.isArray(value) ? value.join('\n') : String(value ?? '');
}

function assignPath(target, path, value) {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts.at(-1)] = value;
}

/** Only changed, explicitly editable leaves are sent; unshown data stays untouched. */
export function buildEditorChanges(record, values, sources) {
  const changes = {};
  for (const [path, , kind] of editorialFields) {
    if (!(path in values)) continue;
    const raw = String(values[path] ?? '');
    if (raw === fieldValue(record, path)) continue;
    let value = raw;
    if (kind === 'lines') value = raw.split('\n').map(part => part.trim()).filter(Boolean);
    if (kind === 'year') {
      if (raw && (!/^\d{4}$/.test(raw) || Number(raw) < 1000)) throw new Error('Informe um ano válido com quatro dígitos.');
      value = raw ? Number(raw) : null;
    }
    if (kind === 'date' && !raw) value = null;
    assignPath(changes, path, value);
  }
  const count = String(values['exemplar.quantidade'] ?? '').trim();
  if (count) {
    if (!/^[1-9]\d*$/.test(count) || !Number.isSafeInteger(Number(count))) throw new Error('A quantidade deve ser um número inteiro maior ou igual a 1.');
    const quantity = Number(count);
    if (quantity > 1 && values['exemplar.melhor_conservacao'] !== 'on') throw new Error('Confirme que a fotografia mostra o exemplar de melhor conservação.');
    if (record.exemplar?.quantidade !== quantity) assignPath(changes, 'exemplar.quantidade', quantity);
    if (quantity > 1 && record.exemplar?.criterio_selecao !== 'melhor_conservacao') assignPath(changes, 'exemplar.criterio_selecao', 'melhor_conservacao');
  } else if (record.exemplar?.quantidade != null) {
    throw new Error('A quantidade já foi registrada. Informe a contagem confirmada para preservá-la.');
  }
  if (sources && JSON.stringify(sources) !== JSON.stringify(record.fontes)) changes.fontes = sources;
  return changes;
}

export function privateAssetUrl(id, role, digest = '') {
  if (!/^SEL-\d{6}$/.test(id) || !['frente', 'card', 'verso', 'thumb'].includes(role)) throw new Error('Imagem inválida.');
  const suffix = /^[a-f0-9]{64}$/.test(digest) ? '?v=' + digest : '';
  return '/api/admin/selos/' + encodeURIComponent(id) + '/assets/' + role + suffix;
}

export function buildMediaFormData(file, role, digest, cropX = '0', cropY = '0') {
  if (!file || !['frente', 'card', 'verso', 'thumb'].includes(role)) throw new Error('Escolha a fotografia original.');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Recarregue o registro antes de enviar a imagem.');
  if (file.size > 5 * 1024 * 1024) throw new Error('A fotografia deve ter no máximo 5 MiB.');
  const margins = [cropX, cropY].map(value => String(value).trim());
  if (margins.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error('Os recortes devem ser inteiros não negativos em pixels.');
  const form = new FormData();
  form.append('file', file);
  form.append('papel', role);
  form.append('expected_digest', digest);
  form.append('crop_x', margins[0]);
  form.append('crop_y', margins[1]);
  return form;
}
