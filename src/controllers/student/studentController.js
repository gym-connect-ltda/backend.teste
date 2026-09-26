const studentService = require("../../services/student/studentService");
const pricingService = require("../../services/pricing/pricingService");
const auditService = require("../../services/audit/auditService");
const supabase = require("../../config/db");
const { parseStudentsCsv } = require("../../utils/studentCsvParser");
const { validateEmail } = require("../../utils/validators");
const { assertBranchAllowed } = require("../../utils/branchScope");

// Bucket privado (não público) no Supabase Storage: guarda o arquivo
// original de cada importação para auditoria, separado por empresa.
// Crie esse bucket no painel do Supabase (Storage > New bucket >
// "student-imports", SEM marcar como público — tem CPF/e-mail/telefone).
const IMPORT_BUCKET = "student-imports";

function normalizeCpfDigits(cpf) {
  return (cpf || "").replace(/\D/g, "");
}

/**
 * Valida uma linha do CSV antes de tentar criar o aluno. Espelha as
 * mesmas regras do preview no front-end (ImportStudent.tsx), mas nunca
 * confia só no que o cliente validou.
 */
function validateImportRow(row, validPlanNames) {
  const errors = [];

  if (!row.nome_aluno) errors.push("Nome em branco");

  if (!row.email_aluno) {
    errors.push("Email em branco");
  } else if (!validateEmail(row.email_aluno)) {
    errors.push("Email inválido");
  }

  if (!row.telefone_aluno) errors.push("Telefone em branco");

  if (!row.cpf_aluno) {
    errors.push("CPF em branco");
  } else if (normalizeCpfDigits(row.cpf_aluno).length !== 11) {
    errors.push("CPF inválido");
  }

  if (!row.plano_aluno) {
    errors.push("Plano em branco");
  } else if (
    validPlanNames.length > 0 &&
    !validPlanNames.some((plan) => plan.toLowerCase() === row.plano_aluno.toLowerCase())
  ) {
    errors.push(`Plano deve ser: ${validPlanNames.join(", ")}`);
  }

  return errors;
}

const createNewStudent = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { name, cpf, email, phone, gymPlan, branchId } = req.body;

  if (!name || !cpf || !gymPlan || !branchId) {
    return res
      .status(400)
      .json({ message: "Preencha todos os campos obrigatórios." });
  }

  try {
    assertBranchAllowed(req.user, branchId);
  } catch (err) {
    return res.status(403).json({ message: err.message });
  }

  try {
    const student = await studentService.createStudent({
      companyId,
      name,
      cpf,
      email,
      phone,
      gymPlan,
      branchId,
    });

    auditService.logAction({
      companyId,
      userId,
      branchId: branchId || userBranchId,
      action: "Cadastrou/Importou",
      description: `Cadastrou o aluno ${name}`,
    });

    return res.status(201).json({
      message: "Aluno cadastrado com sucesso!",
      ...student,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const getCompanyStudents = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const students = await studentService.listStudents(companyId, req.user);
    return res.json(students);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getStudent = async (req, res) => {
  const { id_empresa: companyId } = req.user;
  const { id: studentId } = req.params;

  try {
    const student = await studentService.getStudentById(studentId, companyId, req.user);
    return res.json(student);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

const editCompanyStudent = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { id: studentId } = req.params;
  const { name, email, phone, gymPlan, branchId, status } = req.body;

  if (!name || !gymPlan) {
    return res
      .status(400)
      .json({ message: "Os campos de identificação são obrigatórios." });
  }

  if (branchId) {
    try {
      assertBranchAllowed(req.user, branchId);
    } catch (err) {
      return res.status(403).json({ message: err.message });
    }
  }

  try {
    const previousStudent = await studentService
      .getStudentById(studentId, companyId, req.user)
      .catch(() => null);

    const student = await studentService.updateStudent(
      studentId,
      companyId,
      {
        name,
        email,
        phone,
        gymPlan,
        branchId,
        status,
      },
      req.user,
    );

    let action = "Editou";
    if (previousStudent && status && previousStudent.status !== status) {
      action = status === "Ativo" ? "Ativou" : "Inativou";
    }

    auditService.logAction({
      companyId,
      userId,
      branchId: branchId || userBranchId,
      action,
      description: `${action} o aluno ${name}`,
    });

    return res.json({ message: "Aluno atualizado com sucesso!", ...student });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * Importa alunos em massa a partir de um arquivo CSV (multipart/form-data,
 * campo "file") + a filial de destino (campo "branchId").
 *
 * Fluxo: parseia e valida o CSV -> sobe o arquivo original pro Storage
 * (auditoria) -> cria cada aluno válido -> loga a ação -> devolve o
 * resultado linha a linha (o front usa isso pra mostrar o que passou e o
 * que falhou, sem esconder nada).
 */
const importStudentsFromCsv = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId } = req.user;
  const { branchId } = req.body;

  if (!req.file) {
    return res.status(400).json({ message: "Nenhum arquivo foi enviado." });
  }

  if (!branchId) {
    return res.status(400).json({ message: "Selecione a filial de destino." });
  }

  try {
    assertBranchAllowed(req.user, branchId);
  } catch (err) {
    return res.status(403).json({ message: err.message });
  }

  const csvText = req.file.buffer.toString("utf-8");
  const { rows, missingColumns } = parseStudentsCsv(csvText);

  if (missingColumns.length > 0) {
    return res.status(400).json({
      message: `Não encontrei todas as colunas esperadas. Faltando: ${missingColumns.join(", ")}.`,
    });
  }

  if (rows.length === 0) {
    return res.status(400).json({ message: "O arquivo não tem nenhuma linha de dados." });
  }

  // Planos válidos vêm da Precificação real da empresa, não de uma lista fixa.
  let validPlanNames = [];
  try {
    const pricing = await pricingService.listPricing(companyId);
    validPlanNames = pricing.map((p) => p.cycle);
  } catch (err) {
    // Se a precificação não puder ser carregada, seguimos sem restringir
    // o plano (evita travar a importação inteira por um problema à parte).
    console.error("Erro ao carregar precificação para validar importação:", err.message);
  }

  const rowsWithErrors = [];
  const rowsToImport = [];

  for (const row of rows) {
    const errors = validateImportRow(row, validPlanNames);
    if (errors.length > 0) {
      rowsWithErrors.push({ rowNumber: row.rowNumber, success: false, error: errors.join(", ") });
    } else {
      rowsToImport.push(row);
    }
  }

  // Sobe o arquivo original pro Storage antes de processar, pra manter o
  // rastro mesmo que a importação falhe no meio do caminho. Path isolado
  // por empresa (id_empresa) — isolamento multi-tenant também no Storage.
  const storagePath = `${companyId}/${Date.now()}-${req.file.originalname}`;
  const { error: uploadError } = await supabase.storage
    .from(IMPORT_BUCKET)
    .upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype || "text/csv",
      upsert: false,
    });

  if (uploadError) {
    console.error("Erro ao salvar arquivo de importação no Storage:", uploadError.message);
    // Não bloqueia a importação por causa disso — o arquivo de auditoria é
    // um "nice to have", não pode impedir o aluno de ser cadastrado.
  }

  const importResults = await studentService.importStudents({
    companyId,
    branchId,
    rows: rowsToImport,
  });

  const allResults = [...importResults, ...rowsWithErrors].sort(
    (a, b) => a.rowNumber - b.rowNumber,
  );

  const importedCount = allResults.filter((r) => r.success).length;
  const failedCount = allResults.length - importedCount;

  auditService.logAction({
    companyId,
    userId,
    branchId,
    action: "Cadastrou/Importou",
    description: `Importou ${importedCount} aluno(s) via CSV (${failedCount} linha(s) com erro)`,
  });

  return res.json({
    message: `${importedCount} aluno(s) importado(s) com sucesso.`,
    imported: importedCount,
    failed: failedCount,
    results: allResults,
  });
};

module.exports = {
  createNewStudent,
  getCompanyStudents,
  getStudent,
  editCompanyStudent,
  importStudentsFromCsv,
};
