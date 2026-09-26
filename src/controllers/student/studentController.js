const studentService = require("../../services/student/studentService");
const pricingService = require("../../services/pricing/pricingService");
const auditService = require("../../services/audit/auditService");
const supabase = require("../../config/db");
const { parseStudentsCsv } = require("../../utils/studentCsvParser");
const { validateEmail } = require("../../utils/validators");
const { assertBranchAllowed } = require("../../utils/branchScope");

function normalizeCpfDigits(cpf) {
  return (cpf || "").replace(/\D/g, "");
}

function validateImportRow(row, validPlanNames) {
  const errors = [];

  if (!row.nome_aluno) {
    errors.push("Nome em branco");
  }

  if (!row.email_aluno) {
    errors.push("Email em branco");
  } else if (!validateEmail(row.email_aluno)) {
    errors.push("Email inválido");
  }

  if (!row.telefone_aluno) {
    errors.push("Telefone em branco");
  }

  if (!row.cpf_aluno) {
    errors.push("CPF em branco");
  } else if (normalizeCpfDigits(row.cpf_aluno).length !== 11) {
    errors.push("CPF inválido");
  }

  if (!row.plano_aluno) {
    errors.push("Plano em branco");
  } else if (
    validPlanNames.length > 0 &&
    !validPlanNames.some(
      (plan) => plan.toLowerCase() === row.plano_aluno.toLowerCase(),
    )
  ) {
    errors.push(`Plano deve ser: ${validPlanNames.join(", ")}`);
  }

  return errors;
}

const createNewStudent = async (req, res) => {
  const {
    id_empresa: companyId,
    id_usuario: userId,
    id_filial: userBranchId,
  } = req.user;

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
    const student = await studentService.getStudentById(
      studentId,
      companyId,
      req.user,
    );

    return res.json(student);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

const editCompanyStudent = async (req, res) => {
  const {
    id_empresa: companyId,
    id_usuario: userId,
    id_filial: userBranchId,
  } = req.user;

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

    return res.json({
      message: "Aluno atualizado com sucesso!",
      ...student,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

async function updateImportRecord(importId, payload) {
  const { error } = await supabase
    .from("importacoes_alunos")
    .update(payload)
    .eq("id_importacao", importId);

  if (error) {
    throw new Error(
      `Erro ao atualizar o progresso da importação: ${error.message}`,
    );
  }
}

async function getImportRecord(importId, companyId) {
  const { data, error } = await supabase
    .from("importacoes_alunos")
    .select("*")
    .eq("id_importacao", importId)
    .eq("id_empresa", companyId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

async function processStudentImport({
  importId,
  companyId,
  userId,
  branchId,
  rowsToImport,
  rowsWithErrors,
}) {
  let completedCount = rowsWithErrors.length;
  let importedCount = 0;
  let failedCount = rowsWithErrors.length;

  const persistedResults = [...rowsWithErrors].map((result) => ({
    rowNumber: result.rowNumber,
    success: false,
    error: result.error,
  }));

  try {
    await updateImportRecord(importId, {
      processados: completedCount,
      importados: importedCount,
      erros: failedCount,
      resultados: persistedResults,
    });

    const importResults = await studentService.importStudents({
      companyId,
      branchId,
      rows: rowsToImport,
      onProgress: async (result) => {
        completedCount += 1;

        if (result.success) {
          importedCount += 1;
        } else {
          failedCount += 1;
        }

        persistedResults.push({
          rowNumber: result.rowNumber,
          success: result.success,
          error: result.success ? undefined : result.error,
        });

        await updateImportRecord(importId, {
          processados: completedCount,
          importados: importedCount,
          erros: failedCount,
          resultados: persistedResults,
        });
      },
    });

    const allResults = [...importResults, ...rowsWithErrors].sort(
      (a, b) => a.rowNumber - b.rowNumber,
    );

    const finalImportedCount = allResults.filter(
      (result) => result.success,
    ).length;

    const finalFailedCount = allResults.length - finalImportedCount;

    const finalResults = allResults.map((result) => ({
      rowNumber: result.rowNumber,
      success: result.success,
      error: result.success ? undefined : result.error,
    }));

    await updateImportRecord(importId, {
      status: "concluida",
      total: allResults.length,
      processados: allResults.length,
      importados: finalImportedCount,
      erros: finalFailedCount,
      resultados: finalResults,
      finalizado_em: new Date().toISOString(),
      erro_mensagem: null,
    });

    auditService.logAction({
      companyId,
      userId,
      branchId,
      action: "Cadastrou/Importou",
      description: `Importou ${finalImportedCount} aluno(s) via CSV (${finalFailedCount} linha(s) com erro)`,
    });
  } catch (err) {
    console.error(`Erro na importação ${importId}:`, err.message);

    try {
      await updateImportRecord(importId, {
        status: "erro",
        processados: completedCount,
        importados: importedCount,
        erros: failedCount,
        resultados: persistedResults,
        finalizado_em: new Date().toISOString(),
        erro_mensagem: err.message || "Erro inesperado durante a importação.",
      });
    } catch (updateError) {
      console.error(
        `Erro ao salvar falha da importação ${importId}:`,
        updateError.message,
      );
    }
  }
}

const importStudentsFromCsv = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId } = req.user;

  const { branchId } = req.body;

  if (!req.file) {
    return res.status(400).json({
      message: "Nenhum arquivo foi enviado.",
    });
  }

  if (!branchId) {
    return res.status(400).json({
      message: "Selecione a filial de destino.",
    });
  }

  try {
    assertBranchAllowed(req.user, branchId);
  } catch (err) {
    return res.status(403).json({
      message: err.message,
    });
  }

  const csvText = req.file.buffer.toString("utf-8");

  const { rows, missingColumns } = parseStudentsCsv(csvText);

  if (missingColumns.length > 0) {
    return res.status(400).json({
      message: `Não encontrei todas as colunas esperadas. Faltando: ${missingColumns.join(", ")}.`,
    });
  }

  if (rows.length === 0) {
    return res.status(400).json({
      message: "O arquivo não tem nenhuma linha de dados.",
    });
  }

  let validPlanNames = [];

  try {
    const pricing = await pricingService.listPricing(companyId);
    validPlanNames = pricing.map((plan) => plan.cycle);
  } catch (err) {
    console.error(
      "Erro ao carregar precificação para validar importação:",
      err.message,
    );
  }

  const rowsWithErrors = [];
  const rowsToImport = [];

  for (const row of rows) {
    const errors = validateImportRow(row, validPlanNames);

    if (errors.length > 0) {
      rowsWithErrors.push({
        rowNumber: row.rowNumber,
        success: false,
        error: errors.join(", "),
      });
    } else {
      rowsToImport.push(row);
    }
  }

  const totalRows = rows.length;
  const initialErrors = rowsWithErrors.length;

  const { data: importRecord, error: importError } = await supabase
    .from("importacoes_alunos")
    .insert({
      id_empresa: companyId,
      id_filial: branchId,
      id_usuario: userId || null,
      nome_arquivo: req.file.originalname || null,
      status: "processando",
      total: totalRows,
      processados: initialErrors,
      importados: 0,
      erros: initialErrors,
      resultados: rowsWithErrors.map((result) => ({
        rowNumber: result.rowNumber,
        success: false,
        error: result.error,
      })),
      iniciado_em: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (importError || !importRecord) {
    console.error(
      "Erro ao criar registro da importação:",
      importError?.message,
    );

    return res.status(500).json({
      message: "Não foi possível iniciar a importação.",
    });
  }

  const importId = importRecord.id_importacao;

  void processStudentImport({
    importId,
    companyId,
    userId,
    branchId,
    rowsToImport,
    rowsWithErrors,
  });

  return res.status(202).json({
    message: "Importação iniciada com sucesso.",
    importId,
    total: totalRows,
    processados: initialErrors,
    importados: 0,
    erros: initialErrors,
    status: "processando",
    iniciadoEm: importRecord.iniciado_em,
  });
};

const getStudentImport = async (req, res) => {
  const { id_empresa: companyId } = req.user;
  const { id: importId } = req.params;

  try {
    const importRecord = await getImportRecord(importId, companyId);

    if (!importRecord) {
      return res.status(404).json({
        message: "Importação não encontrada.",
      });
    }

    return res.json({
      id: importRecord.id_importacao,
      status: importRecord.status,
      total: importRecord.total,
      processados: importRecord.processados,
      importados: importRecord.importados,
      erros: importRecord.erros,
      resultados: importRecord.resultados || [],
      nomeArquivo: importRecord.nome_arquivo,
      iniciadoEm: importRecord.iniciado_em,
      finalizadoEm: importRecord.finalizado_em,
      erroMensagem: importRecord.erro_mensagem,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
};

const getActiveStudentImport = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const { data, error } = await supabase
      .from("importacoes_alunos")
      .select("*")
      .eq("id_empresa", companyId)
      .eq("status", "processando")
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return res.json(null);
    }

    return res.json({
      id: data.id_importacao,
      status: data.status,
      total: data.total,
      processados: data.processados,
      importados: data.importados,
      erros: data.erros,
      resultados: data.resultados || [],
      nomeArquivo: data.nome_arquivo,
      iniciadoEm: data.iniciado_em,
      finalizadoEm: data.finalizado_em,
      erroMensagem: data.erro_mensagem,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
};

module.exports = {
  createNewStudent,
  getCompanyStudents,
  getStudent,
  editCompanyStudent,
  importStudentsFromCsv,
  getStudentImport,
  getActiveStudentImport,
};
