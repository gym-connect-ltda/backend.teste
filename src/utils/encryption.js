const crypto = require("crypto");

/**
 * Criptografia simétrica (AES-256-GCM) pra segredos sensíveis que
 * precisam ser recuperados depois (diferente de senha, que é hash
 * de mão única — aqui a gente PRECISA conseguir ler o valor original
 * de volta pra usar na chamada real à API do Asaas).
 *
 * A chave secreta nunca fica no banco — só na variável de ambiente
 * ENCRYPTION_KEY do backend. Sem ela, o dado criptografado no banco
 * é inútil pra quem não tiver acesso ao servidor.
 *
 * Formato armazenado: "iv:authTag:dadoCriptografado" (tudo em hex).
 * O GCM inclui um "authTag" que detecta automaticamente se a chave
 * estiver errada ou se o dado foi adulterado — falha alto, não retorna
 * lixo silenciosamente.
 */

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      "ENCRYPTION_KEY não configurada no .env — necessária pra criptografar/descriptografar segredos do Asaas.",
    );
  }

  const key = Buffer.from(keyHex, "hex");

  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY inválida — precisa ser uma chave de 32 bytes em hexadecimal (64 caracteres).",
    );
  }

  return key;
}

function encrypt(plainText) {
  if (plainText === null || plainText === undefined) return null;

  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decrypt(cipherText) {
  if (cipherText === null || cipherText === undefined) return null;

  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    throw new Error("Valor criptografado em formato inválido.");
  }

  const [ivHex, authTagHex, dataHex] = parts;
  const key = getKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };