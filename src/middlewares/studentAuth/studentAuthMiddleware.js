const jwt = require("jsonwebtoken");

/**
 * Valida o token JWT do ALUNO (app), assinado com JWT_STUDENT_SECRET —
 * uma chave diferente da usada pros usuários do painel administrativo
 * (JWT_SECRET). Isso impede que um token vaze pra autenticar no domínio
 * errado, mesmo por engano.
 */
const studentAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token não fornecido." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_STUDENT_SECRET);
    req.student = decoded; // { id_aluno_app, nome, email, cpf }
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
};

module.exports = studentAuthMiddleware;
