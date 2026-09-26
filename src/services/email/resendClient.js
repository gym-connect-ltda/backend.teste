const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// Domínio/remetente configurado e verificado no painel do Resend.
// Ex: "Gym Connect <no-reply@seudominio.com>"
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS;

/**
 * Envia o e-mail de redefinição de senha pro aluno.
 */
const sendPasswordResetEmail = async ({ to, name, resetLink }) => {
  if (!process.env.RESEND_API_KEY || !FROM_ADDRESS) {
    throw new Error(
      "Envio de e-mail não configurado (RESEND_API_KEY / RESEND_FROM_ADDRESS ausentes).",
    );
  }

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "Redefinição de senha - Gym Connect",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #101810;">Redefinir senha</h2>
        <p>Olá, ${name || ""}!</p>
        <p>Recebemos um pedido para redefinir a senha da sua conta no Gym Connect. Clique no botão abaixo para escolher uma nova senha:</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}" style="background:#64FA35;color:#101810;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Redefinir minha senha
          </a>
        </p>
        <p style="color:#666;font-size:13px;">Este link expira em 1 hora. Se você não solicitou essa alteração, pode ignorar este e-mail com segurança.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Erro ao enviar e-mail via Resend: ${error.message}`);
  }
};

module.exports = { sendPasswordResetEmail };
