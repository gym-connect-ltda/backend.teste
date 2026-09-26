/**
 * Aplica o filtro de filial numa query do Supabase, de acordo com a
 * permissão do usuário logado: se o perfil dele NÃO tem
 * `allBranchesAccess`, a consulta é restrita à própria filial dele
 * (`req.user.id_filial`). Se tem, a consulta segue livre (todas as
 * filiais da empresa).
 *
 * @param {import('@supabase/supabase-js').PostgrestFilterBuilder} query
 * @param {{ allBranchesAccess?: boolean, id_filial: number }} user
 * @param {string} column - nome da coluna de filial na tabela consultada
 */
function applyBranchScope(query, user, column = "id_filial") {
  if (user.allBranchesAccess) {
    return query;
  }

  return query.eq(column, user.id_filial);
}

/**
 * Confirma que o usuário tem permissão de usar essa filial específica
 * (branchId). Usado em criação/edição, pra impedir que alguém sem acesso
 * a todas as filiais force um id_filial diferente do próprio via chamada
 * direta à API (defesa em profundidade — o frontend já esconde essa
 * opção, mas o backend não pode confiar só nisso).
 */
function assertBranchAllowed(user, branchId) {
  if (user.allBranchesAccess) return;

  if (Number(branchId) !== Number(user.id_filial)) {
    throw new Error("Você não tem permissão para acessar outra filial.");
  }
}

module.exports = { applyBranchScope, assertBranchAllowed };
