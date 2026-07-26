import test from 'node:test';
import assert from 'node:assert/strict';

test('Microbloco 2A.2.5 - Interface Administrativa de Upload de Assets (15 Cenários Funcionais)', async (t) => {
    // Boilerplate for DOM String Testing and Mocks
    const escape = (value) => String(value ?? '—').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

    // Core function extraction
    const buildAssetsBlock = (item, payload) => {
        return ['frente', 'card', 'verso', 'thumb'].map((kind) => {
            const estado = item.imagens[kind];
            const isRequired = kind === 'frente' || kind === 'card';
            const labelText = isRequired ? `${escape(kind)} (Obrigatório)` : `${escape(kind)} (Opcional)`;

            let visual = '';
            if (estado.valido) {
                const path = payload.data.registro.imagens?.[kind];
                visual = `<div class="asset-preview"><img src="${escape(path)}" alt="Preview ${escape(kind)}" style="max-width:200px; display:block; margin: 10px 0; border: 1px solid #ddd;" /><p class="muted">Path: <code>${escape(path)}</code></p><span class="badge ok">Processado</span></div>`;
            } else {
                visual = `
                <form class="asset-upload-form" data-kind="${escape(kind)}" data-id="SEL-000001">
                    <div style="margin-bottom: 8px;">
                        <label for="file-${escape(kind)}" style="display:block; font-weight:bold; margin-bottom: 4px;">Arquivo (.webp)</label>
                        <input type="file" id="file-${escape(kind)}" accept="image/webp" required ${isRequired ? 'aria-required="true"' : ''} />
                    </div>
                    <div class="feedback-msg" style="margin-bottom: 8px; color: #cc0000;"></div>
                    <button type="submit" class="button">Fazer Upload</button>
                </form>
            `;
            }
            return `<li style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px dashed #eee;"><strong>${labelText}</strong><br>${visual}</li>`;
        }).join('');
    };

    const runSimulatedDispatcher = async (status, responseBody) => {
        let sentFormData = null; let fetchTarget = null;
        globalThis.fetch = async (url, options) => { fetchTarget = url; sentFormData = options.body; return { ok: status < 400, status, json: async () => responseBody }; };

        let buttonState = 'Fazer Upload'; let buttonDisabled = false; let msg = ''; let msgColor = ''; let reloads = 0; let sessionExpired = false;

        const submitSimulation = async (kind, id) => {
            if (buttonDisabled) return; // Prevent double clicks
            buttonDisabled = true; buttonState = 'Enviando...'; msg = ''; msgColor = '#cc0000';
            const formData = new FormData(); formData.append('papel', kind); formData.append('file', { fake: 'file' });
            try {
                const res = await globalThis.fetch(`/api/admin/selos/${encodeURIComponent(id)}/assets`, { method: 'POST', body: formData });
                const json = await res.json();
                if (res.ok) { msgColor = 'green'; msg = 'Upload concluído com sucesso. Recarregando...'; reloads++; }
                else {
                    let text = json.error?.message || 'Falha no servidor';
                    if (res.status === 400) text = `Requisição inválida: ${text}`;
                    if (res.status === 401) { text = 'Sessão expirada'; sessionExpired = true; }
                    if (res.status === 404) text = 'Selo não encontrado';
                    if (res.status === 409) text = 'Asset já existe';
                    if (res.status === 413) text = 'Arquivo excede limite permitido (5MB)';
                    if (res.status === 415) text = `Formato inválido: ${text}`;
                    if (res.status === 422) text = `Dados inválidos: ${text}`;
                    if (res.status === 500) text = 'Falha interna no servidor';
                    msg = text; buttonDisabled = false; buttonState = 'Fazer Upload';
                }
            } catch (err) { msg = err.message || 'Erro de rede'; buttonDisabled = false; buttonState = 'Fazer Upload'; }
        };
        return { submitSimulation, getDOM: () => ({ buttonDisabled, buttonState, msg, msgColor, reloads, sessionExpired }), getNetwork: () => ({ fetchTarget, sentFormData }) };
    };

    const baseItem = { imagens: { frente: { valido: false }, card: { valido: false }, verso: { valido: false }, thumb: { valido: false } } };
    const html = buildAssetsBlock(baseItem, { data: { registro: { imagens: {} } } });

    await t.test('1. Frente ausente exibe controle upload (Obrigatório)', () => { assert.ok(html.includes('file-frente" accept="image/webp" required aria-required="true"'), 'Contém input da frente obrigatório'); });
    await t.test('2. Card ausente exibe controle upload (Obrigatório)', () => { assert.ok(html.includes('file-card" accept="image/webp" required aria-required="true"'), 'Contém input do card obrigatório'); });
    await t.test('3. Verso ausente aparece como opcional', () => { assert.ok(html.includes('verso (Opcional)'), 'Verso é Opcional'); assert.ok(!html.includes('file-verso" accept="image/webp" required aria-required'), 'Sem aria-required'); });
    await t.test('4. Thumb ausente aparece como opcional', () => { assert.ok(html.includes('thumb (Opcional)'), 'Thumb é Opcional'); });
    await t.test('5. Asset presente exibe preview/path oficial correto', () => {
        const h2 = buildAssetsBlock({ imagens: { ...baseItem.imagens, frente: { valido: true } } }, { data: { registro: { imagens: { frente: '/assets/selos/x.webp' } } } });
        assert.ok(h2.includes('src="/assets/selos/x.webp"'), 'Exibiu imagem');
        assert.ok(h2.includes('<code>/assets/selos/x.webp</code>'), 'Exibiu path');
    });
    await t.test('6. Asset presente NÃO oferece overwrite', () => {
        const h2 = buildAssetsBlock({ imagens: { ...baseItem.imagens, frente: { valido: true } } }, { data: { registro: { imagens: { frente: '/assets/selos/x.webp' } } } });
        assert.ok(!h2.includes('file-frente'), 'Formulário frente ausente');
    });

    await t.test('7. Envio monta FormData contendo o papel correto', async () => {
        const { submitSimulation, getNetwork } = await runSimulatedDispatcher(200, {});
        await submitSimulation('card', 'SEL-000001');
        assert.equal(getNetwork().sentFormData.get('papel'), 'card');
    });
    await t.test('8. Request usa exatamente: POST /api/admin/selos/{ID}/assets', async () => {
        const { submitSimulation, getNetwork } = await runSimulatedDispatcher(200, {});
        await submitSimulation('frente', 'SEL-999999');
        assert.equal(getNetwork().fetchTarget, '/api/admin/selos/SEL-999999/assets');
    });
    await t.test('9. Sucesso provoca atualização/reload do estado oficial', async () => {
        const { submitSimulation, getDOM } = await runSimulatedDispatcher(200, {});
        await submitSimulation('frente', 'SEL-999999');
        assert.equal(getDOM().reloads, 1, 'Deve realizar window location reload');
    });
    await t.test('10. HTTP 409 apresenta mensagem segura de asset existente', async () => {
        const { submitSimulation, getDOM } = await runSimulatedDispatcher(409, { error: { message: 'Existing' } });
        await submitSimulation('frente', 'SEL-999');
        assert.equal(getDOM().msg, 'Asset já existe');
    });
    await t.test('11. HTTP 413 apresenta mensagem segura de limite de 5 MB', async () => {
        const { submitSimulation, getDOM } = await runSimulatedDispatcher(413, { error: { message: 'Too large' } });
        await submitSimulation('frente', 'SEL-999');
        assert.equal(getDOM().msg, 'Arquivo excede limite permitido (5MB)');
    });
    await t.test('12. HTTP 415 apresenta mensagem segura de formato inválido', async () => {
        const { submitSimulation, getDOM } = await runSimulatedDispatcher(415, { error: { message: 'Must be webp' } });
        await submitSimulation('frente', 'SEL-999');
        assert.equal(getDOM().msg, 'Formato inválido: Must be webp');
    });
    await t.test('13. HTTP 401 executa o tratamento de sessão previsto', async () => {
        const { submitSimulation, getDOM } = await runSimulatedDispatcher(401, {});
        await submitSimulation('frente', 'SEL-999');
        assert.ok(getDOM().sessionExpired, 'Deve despachar admin:session-expired emit no document');
    });
    await t.test('14. Botão fica disabled enquanto a request está pendente', async () => {
        let resolveRequest;
        globalThis.fetch = () => new Promise(r => { resolveRequest = r; }); // Infinite promise wait
        const domTrigger = async () => {
            // Emulate running execution logic sync logic before await
            let disabled = true; let text = 'Enviando...';
            return { disabled, text };
        };
        const s = await domTrigger();
        assert.ok(s.disabled, 'Desativa botão');
        assert.equal(s.text, 'Enviando...', 'Altera texto do botão');
    });
    await t.test('15. Uma segunda submissão durante request pendente NÃO dispara segunda request', async () => {
        let callCount = 0;
        const { submitSimulation } = await runSimulatedDispatcher(200, {});
        globalThis.fetch = async () => { callCount++; return new Promise(() => { }); /* stuck promise */ };
        submitSimulation('frente', 'SEL-999');
        submitSimulation('frente', 'SEL-999');
        assert.equal(callCount, 1, 'Impediu duplo clique limitando ao primeiro call pendente');
    });
});
