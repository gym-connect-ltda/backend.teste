/**
 * Extrai um único IP válido do cliente a partir do header X-Forwarded-For.
 *
 * Atrás de proxies em cadeia (Vercel -> Render, por exemplo), esse header
 * vem como uma lista separada por vírgula: "cliente, proxy1, proxy2...".
 * Colunas do tipo `inet` no Postgres rejeitam essa string inteira — só
 * aceitam um único IP/CIDR. Por convenção, o primeiro IP da lista é o do
 * cliente original.
 */
function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  // req.socket.remoteAddress pode vir prefixado como "::ffff:1.2.3.4"
  // (IPv4 mapeado em IPv6) — normaliza removendo o prefixo.
  const remote = req.socket?.remoteAddress || "";
  return remote.replace(/^::ffff:/, "") || null;
}

module.exports = { getClientIp };
