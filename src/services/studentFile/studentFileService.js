const supabase = require("../../config/db");

// Bucket privado no Supabase Storage — documentos de aluno podem conter
// dado sensível (CPF, identidade, atestado médico), então NUNCA marque
// como público. Crie no painel: Storage > New bucket > "student-files".
const FILES_BUCKET = "student-files";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const SIGNED_URL_EXPIRES_IN = 60 * 60; // 1 hora

function mapFile(row, signedUrl) {
  return {
    id: row.id_arquivo,
    name: row.nome_arquivo,
    mimeType: row.tipo_mime,
    sizeBytes: row.tamanho_bytes,
    uploadDate: row.criado_em,
    url: signedUrl || null,
  };
}

/**
 * Garante que o aluno pertence à empresa autenticada antes de qualquer
 * operação de arquivo (upload, listagem, exclusão).
 */
async function assertStudentBelongsToCompany(studentId, companyId) {
  const { data: student, error } = await supabase
    .from("alunos")
    .select("id_aluno")
    .eq("id_aluno", studentId)
    .eq("id_empresa", companyId)
    .single();

  if (error || !student) {
    throw new Error("Aluno não encontrado.");
  }
}

/**
 * Lista os arquivos de um aluno, com uma URL assinada (temporária) pra
 * cada um — o bucket é privado, então não existe URL pública fixa.
 */
const listStudentFiles = async (studentId, companyId) => {
  await assertStudentBelongsToCompany(studentId, companyId);

  const { data: files, error } = await supabase
    .from("arquivos_aluno")
    .select("*")
    .eq("id_aluno", studentId)
    .eq("id_empresa", companyId)
    .order("criado_em", { ascending: false });

  if (error) {
    throw new Error(`Erro ao listar arquivos do aluno: ${error.message}`);
  }

  const filesWithUrls = await Promise.all(
    files.map(async (file) => {
      const { data: signedData } = await supabase.storage
        .from(FILES_BUCKET)
        .createSignedUrl(file.caminho_storage, SIGNED_URL_EXPIRES_IN);

      return mapFile(file, signedData?.signedUrl);
    }),
  );

  return filesWithUrls;
};

/**
 * Envia um novo arquivo pro aluno: sobe pro Storage e grava os metadados.
 */
const uploadStudentFile = async ({ studentId, companyId, userId, file }) => {
  if (!file) {
    throw new Error("Nenhum arquivo foi enviado.");
  }

  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    throw new Error(
      "Formato inválido. Envie uma imagem (JPG, PNG, WEBP), PDF ou documento Word.",
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("O arquivo deve ter no máximo 10MB.");
  }

  await assertStudentBelongsToCompany(studentId, companyId);

  const storagePath = `${companyId}/${studentId}/${Date.now()}-${file.originalname}`;

  const { error: uploadError } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar arquivo para o Storage: ${uploadError.message}`);
  }

  const { data: fileRow, error: insertError } = await supabase
    .from("arquivos_aluno")
    .insert({
      id_aluno: studentId,
      id_empresa: companyId,
      nome_arquivo: file.originalname,
      caminho_storage: storagePath,
      tipo_mime: file.mimetype,
      tamanho_bytes: file.size,
      enviado_por: userId,
    })
    .select()
    .single();

  if (insertError) {
    // Não deixa lixo órfão no Storage se o registro no banco falhar.
    await supabase.storage.from(FILES_BUCKET).remove([storagePath]);
    throw new Error(`Erro ao salvar o arquivo no banco: ${insertError.message}`);
  }

  const { data: signedData } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN);

  return mapFile(fileRow, signedData?.signedUrl);
};

/**
 * Remove um arquivo do aluno: apaga do Storage e do banco.
 */
const deleteStudentFile = async (studentId, fileId, companyId) => {
  await assertStudentBelongsToCompany(studentId, companyId);

  const { data: file, error: fetchError } = await supabase
    .from("arquivos_aluno")
    .select("*")
    .eq("id_arquivo", fileId)
    .eq("id_aluno", studentId)
    .eq("id_empresa", companyId)
    .single();

  if (fetchError || !file) {
    throw new Error("Arquivo não encontrado.");
  }

  const { error: removeError } = await supabase.storage
    .from(FILES_BUCKET)
    .remove([file.caminho_storage]);

  if (removeError) {
    throw new Error(`Erro ao remover arquivo do Storage: ${removeError.message}`);
  }

  const { error: deleteError } = await supabase
    .from("arquivos_aluno")
    .delete()
    .eq("id_arquivo", fileId);

  if (deleteError) {
    throw new Error(`Erro ao remover o registro do arquivo: ${deleteError.message}`);
  }

  return true;
};

module.exports = { listStudentFiles, uploadStudentFile, deleteStudentFile };
