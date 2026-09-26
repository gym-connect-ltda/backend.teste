/**
 * Middleware que valida permissão de módulo no próprio backend — não dá
 * mais pra contornar a permissão chamando a API direto (Postman, DevTools
 * etc.), já que até agora só o frontend escondia a tela.
 *
 * Comportamento FAIL-CLOSED de propósito (diferente do fail-open que
 * existia no frontend antes): se a chave não existir na árvore de
 * permissões, ou não for exatamente `true`, o acesso é NEGADO. Isso é
 * seguro mesmo se o dado de permissão vier vazio/corrompido por algum
 * motivo — nunca libera por engano.
 */
function getNestedPermission(permissions, path) {
  let node = permissions;

  for (const key of path) {
    if (node === null || node === undefined || typeof node !== "object") {
      return undefined;
    }
    node = node[key];
  }

  return node;
}

/**
 * @param {string[]} path - ex: ["alunos"] ou ["configuracoes", "usuarios"]
 */
function requirePermission(path) {
  return (req, res, next) => {
    const value = getNestedPermission(req.user?.permissions, path);

    if (value !== true) {
      return res.status(403).json({
        message: "Você não tem permissão para acessar este recurso.",
      });
    }

    next();
  };
}

module.exports = { requirePermission, getNestedPermission };
