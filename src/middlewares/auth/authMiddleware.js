const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Token de acesso não fornecido." });
  }

  // Divide o "Bearer Token"
  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res
      .status(401)
      .json({ message: "Token mal formatado ou inválido." });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Injeta os dados decodificados do usuário dentro da requisição
    req.user = decoded;

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Token expirado ou inválido." });
  }
};

module.exports = authMiddleware;
