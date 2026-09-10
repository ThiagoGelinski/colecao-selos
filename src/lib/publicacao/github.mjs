import { operationError } from '../admin/editor.mjs';
export const REPOSITORY = 'ThiagoGelinski/colecao-selos';
export function createGithubClient({ token = process.env.GITHUB_PUBLISH_TOKEN, fetcher = fetch } = {}) {
  if (!token) throw operationError('PUBLICATION_NOT_CONFIGURED','Configure GITHUB_PUBLISH_TOKEN nas Functions da Netlify para habilitar a publicação.',503);
  const request = async (endpoint, method = 'GET', body) => {
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}${endpoint}`, {
      method, redirect:'error', signal:AbortSignal.timeout(20000),
      headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    });
    if (!response.ok) {
      if (response.status === 404 && method === 'GET') return null;
      throw operationError('GITHUB_ERROR',`GitHub recusou a operação (${response.status}). Confira acesso e estado da revisão.`,response.status === 401 || response.status === 403 ? 503 : 409);
    }
    return response.status === 204 ? null : response.json();
  };
  const getMain = async () => {
    const ref = await request('/git/ref/heads/main');
    if (!ref?.object?.sha) throw operationError('GITHUB_BASE_MISSING','A branch oficial main não foi encontrada.');
    return ref.object.sha;
  };
  const readFile = async (file, sha) => {
    const content = await request(`/contents/${file}?ref=${sha}`);
    if (!content) return null;
    if (content.type === 'file' && content.encoding === 'none' && content.sha) {
      const blob = await request('/git/blobs/' + content.sha);
      if (blob?.encoding === 'base64' && blob.size <= 6 * 1024 * 1024) return Buffer.from(blob.content.replace(/\s/g,''),'base64');
    }
    if (content.type !== 'file' || content.encoding !== 'base64') throw operationError('GITHUB_FILE_INVALID','Arquivo oficial indisponível para validação.');
    return Buffer.from(content.content.replace(/\s/g,''),'base64');
  };
  const createReview = async ({id,snapshot_hash,base_sha,files,reviewer}) => {
    const branch = `publicacao/${id}-${snapshot_hash.slice(0,24)}`;
    const existing = await request(`/pulls?state=all&head=ThiagoGelinski:${branch}&base=main`);
    if (existing?.length) return existing[0];
    let reference = await request(`/git/ref/heads/${branch}`);
    if (!reference) {
      const base = await request(`/git/commits/${base_sha}`);
      const tree = [];
      for (const file of files) {
        const blob = await request('/git/blobs','POST',{content:Buffer.from(file.bytes).toString('base64'),encoding:'base64'});
        tree.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha});
      }
      const createdTree = await request('/git/trees','POST',{base_tree:base.tree.sha,tree});
      const commit = await request('/git/commits','POST',{message:`Publica ${id} após revisão humana\n\nSnapshot: ${snapshot_hash}\nResponsável: ${reviewer}`,tree:createdTree.sha,parents:[base_sha]});
      reference = await request('/git/refs','POST',{ref:`refs/heads/${branch}`,sha:commit.sha});
    }
    return request('/pulls','POST',{
      title:`Publicação de ${id}`,head:branch,base:'main',
      body:`Revisão humana confirmada no painel por ${reviewer}.\n\nSnapshot: ${snapshot_hash}\nBase oficial: ${base_sha}\n\nInclui somente registro, manifesto e imagens verificadas. A integração aguarda CI e a ação Publicar do administrador.`,
    });
  };
  const reviewStatus = async (number, expectedHead) => {
    const pr = await request(`/pulls/${number}`);
    if (!pr || pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== REPOSITORY || pr.head?.repo?.full_name !== REPOSITORY || pr.head?.sha !== expectedHead) throw operationError('REVIEW_CHANGED','A revisão no GitHub mudou. Prepare e aprove novamente.');
    if (!pr.merged && (pr.state !== 'open' || pr.draft)) return {pr,ci_passed:false,ci_url:null};
    const runs = await request(`/actions/runs?head_sha=${expectedHead}&event=pull_request&per_page=100`);
    const workflow = (runs?.workflow_runs ?? []).filter(run => run.path === '.github/workflows/ci.yml' && run.head_sha === expectedHead && run.head_repository?.full_name === REPOSITORY).sort((a,b) => b.id-a.id)[0];
    let ciPassed = workflow?.status === 'completed' && workflow.conclusion === 'success';
    if (ciPassed) {
      const result = await request(`/actions/runs/${workflow.id}/jobs?filter=latest&per_page=100`);
      ciPassed = Boolean(result?.jobs?.some(job => job.name === 'Testes, auditoria e build' && job.head_sha === expectedHead && job.conclusion === 'success'));
    }
    return {pr,ci_passed:ciPassed,ci_url:workflow?.html_url ?? null};
  };
  const verifyReview = async ({pr,base_sha,files}) => {
    const commit = await request('/git/commits/' + pr.head.sha);
    if (commit?.parents?.length !== 1 || commit.parents[0].sha !== base_sha) throw operationError('REVIEW_CHANGED','A base da revisão foi alterada.');
    const diff = await request('/compare/' + base_sha + '...' + pr.head.sha);
    const allowed = new Map(files.map(file => [file.path,Buffer.from(file.bytes)]));
    if (!diff || !Array.isArray(diff.files) || diff.files.length > allowed.size || pr.changed_files > allowed.size || diff.files.some(file => !allowed.has(file.filename) || !['added','modified'].includes(file.status))) throw operationError('REVIEW_CHANGED','A revisão contém mudanças fora do snapshot aprovado.');
    for (const [file,expected] of allowed) {
      const actual = await readFile(file,pr.head.sha);
      if (!actual || !actual.equals(expected)) throw operationError('REVIEW_CHANGED','Os arquivos da revisão não correspondem à aprovação.');
    }
  };
  const publish = async ({head_sha,base_sha}) => {
    if (await getMain() !== base_sha) throw operationError('BASE_CHANGED','A main avançou. Prepare e aprove uma nova revisão.');
    // A non-forced fast-forward fails if main advances after the preceding read.
    await request('/git/refs/heads/main','PATCH',{sha:head_sha,force:false});
    return {sha:head_sha};
  };
  return {getMain,readFile,createReview,reviewStatus,verifyReview,publish};
}