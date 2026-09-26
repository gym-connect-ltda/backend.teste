const supabase = require("../../config/db");
const { fetchAllRows } = require("../../utils/supabasePagination");
const { applyBranchScope } = require("../../utils/branchScope");

/**
 * Gera uma matrícula única para o aluno.
 * Formato: <ddmmyy><6 dígitos do timestamp> — evita colisão sem depender
 * de sequência dedicada no banco.
 */
function generateMatricula() {
  const now = new Date();

  const datePart = `${String(now.getDate()).padStart(2, "0")}${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}${String(now.getFullYear()).slice(-2)}`;

  const uniquePart = String(Date.now()).slice(-6);

  return `${datePart}${uniquePart}`;
}

/**
 * Traduz uma linha de "alunos" (+ filial associada) para o shape que o
 * front-end espera (chaves em inglês, status como string PT-BR amigável).
 */
function mapStudent(row) {
  return {
    id: row.id_aluno,
    name: row.nome_aluno,
    numberId: row.cpf_aluno,
    phone: row.telefone_aluno,
    email: row.email_aluno,
    gymPlan: row.plano_aluno,
    status: row.status_aluno ? "Ativo" : "Inativo",
    situation: row.situacao_aluno,
    matricula: row.matricula_aluno,
    registrationDate: row.data_cadastro_aluno,
    branch: row.filiais?.nome_filial ?? "",
    branchId: row.id_filial,
    observations: row.observacoes_aluno ?? undefined,
  };
}

/**
 * Cadastra um novo aluno vinculado à empresa (e filial) do usuário logado.
 */
const createStudent = async ({
  companyId,
  name,
  cpf,
  email,
  phone,
  gymPlan,
  branchId,
  observacoes,
}) => {
  // Garante que a filial informada realmente pertence à empresa logada.
  const { data: branch, error: branchError } = await supabase
    .from("filiais")
    .select("id_filial")
    .eq("id_filial", branchId)
    .eq("id_empresa", companyId)
    .single();

  if (branchError || !branch) {
    throw new Error("Filial inválida para esta empresa.");
  }

  let attempts = 0;
  let lastError;

  // Tenta algumas vezes caso a matrícula gerada colida com uma existente.
  while (attempts < 3) {
    const matricula = generateMatricula();

    const { data: student, error } = await supabase
      .from("alunos")
      .insert({
        id_empresa: companyId,
        id_filial: branchId,
        nome_aluno: name,
        email_aluno: email || null,
        telefone_aluno: phone || null,
        cpf_aluno: cpf,
        plano_aluno: gymPlan,
        matricula_aluno: matricula,
        status_aluno: true,
        situacao_aluno: "regular",
        data_cadastro_aluno: new Date().toISOString(),
        observacoes_aluno: observacoes || null,
      })
      .select("*, filiais(nome_filial)")
      .single();

    if (!error && student) {
      return mapStudent(student);
    }

    lastError = error;

    // 23505 = unique_violation. Se for a matrícula, tenta de novo;
    // se for CPF/matrícula de outro campo, interrompe e informa o usuário.
    const isMatriculaConflict =
      error?.code === "23505" && error.message?.includes("matricula_aluno");

    if (!isMatriculaConflict) {
      break;
    }

    attempts += 1;
  }

  if (lastError?.code === "23505") {
    if (lastError.message?.includes("cpf_aluno")) {
      throw new Error("Já existe um aluno cadastrado com este CPF.");
    }

    throw new Error(
      "Não foi possível gerar uma matrícula única. Tente novamente.",
    );
  }

  throw new Error(
    `Erro ao cadastrar aluno no banco de dados: ${lastError?.message}`,
  );
};

/**
 * Lista todos os alunos da empresa autenticada, já com o nome da filial.
 * Busca paginada (ver utils/supabasePagination) porque o Supabase corta
 * em 1000 linhas por requisição por padrão.
 */
const listStudents = async (companyId, user) => {
  const students = await fetchAllRows(() => {
    let query = supabase
      .from("alunos")
      .select("*, filiais(nome_filial)")
      .eq("id_empresa", companyId);

    query = applyBranchScope(query, user);

    return query.order("data_cadastro_aluno", {
      ascending: false,
    });
  });

  return students.map(mapStudent);
};

/**
 * Busca um único aluno da empresa autenticada.
 */
const getStudentById = async (studentId, companyId, user) => {
  let query = supabase
    .from("alunos")
    .select("*, filiais(nome_filial)")
    .eq("id_aluno", studentId)
    .eq("id_empresa", companyId);

  query = applyBranchScope(query, user);

  const { data: student, error } = await query.single();

  if (error || !student) {
    throw new Error("Aluno não encontrado.");
  }

  return mapStudent(student);
};

/**
 * Atualiza os dados cadastrais de um aluno específico.
 */
const updateStudent = async (
  studentId,
  companyId,
  { name, email, phone, gymPlan, branchId, status },
  user,
) => {
  if (branchId) {
    const { data: branch, error: branchError } = await supabase
      .from("filiais")
      .select("id_filial")
      .eq("id_filial", branchId)
      .eq("id_empresa", companyId)
      .single();

    if (branchError || !branch) {
      throw new Error("Filial inválida para esta empresa.");
    }
  }

  const updatePayload = {
    nome_aluno: name,
    email_aluno: email || null,
    telefone_aluno: phone || null,
    plano_aluno: gymPlan,
    atualizado_em: new Date().toISOString(),
  };

  if (branchId) {
    updatePayload.id_filial = branchId;
  }

  if (typeof status === "string") {
    updatePayload.status_aluno = status === "Ativo";
  }

  let query = supabase
    .from("alunos")
    .update(updatePayload)
    .eq("id_aluno", studentId)
    .eq("id_empresa", companyId);

  query = applyBranchScope(query, user);

  const { data: student, error } = await query
    .select("*, filiais(nome_filial)")
    .single();

  if (error || !student) {
    throw new Error(`Erro ao atualizar o aluno no banco: ${error?.message}`);
  }

  return mapStudent(student);
};

/**
 * Importa alunos em lote a partir de linhas já parseadas (CSV). Reaproveita
 * createStudent linha a linha — mesma geração de matrícula, mesma checagem
 * de filial/CPF duplicado — e devolve o resultado individual de cada linha,
 * sem que uma linha com erro derrube o lote inteiro.
 */
const importStudents = async ({ companyId, branchId, rows, onProgress }) => {
  const results = [];

  for (const row of rows) {
    try {
      const student = await createStudent({
        companyId,
        name: row.nome_aluno,
        cpf: row.cpf_aluno,
        email: row.email_aluno,
        phone: row.telefone_aluno,
        gymPlan: row.plano_aluno,
        branchId,
        observacoes: row.forma_pagamento
          ? `Forma de pagamento (importação): ${row.forma_pagamento}`
          : undefined,
      });

      const result = {
        rowNumber: row.rowNumber,
        success: true,
        student,
      };

      results.push(result);

      if (typeof onProgress === "function") {
        await onProgress(result);
      }
    } catch (err) {
      const result = {
        rowNumber: row.rowNumber,
        success: false,
        error: err.message,
      };

      results.push(result);

      if (typeof onProgress === "function") {
        await onProgress(result);
      }
    }
  }

  return results;
};

module.exports = {
  createStudent,
  listStudents,
  getStudentById,
  updateStudent,
  importStudents,
};
