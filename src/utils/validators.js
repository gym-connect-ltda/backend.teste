/**
 * Valida se a senha possui no mínimo 6 caracteres, incluindo letras, números e caracteres especiais.
 * @param {string} password
 * @returns {boolean}
 */
const validateStrongPassword = (password) => {
  const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{6,}$/;
  return regex.test(password);
};

/**
 * Exemplo de futura reutilização: Valida formato de e-mail básico
 * @param {string} email
 * @returns {boolean}
 */
const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

module.exports = {
  validateStrongPassword,
  validateEmail,
};
