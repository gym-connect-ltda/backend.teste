const billingService = require("../billing/billingService");
const supabase = require("../../config/db");
const bcrypt = require("bcryptjs");

/**
 * Normaliza o ciclo de pagamento para corresponder exatamente
 * ao CHECK CONSTRAINT da tabela 'empresas' no PostgreSQL (Mensal, Semestral, Anual).
 * @param {string} cycle
 * @returns {string}
 */
const formatPaymentCycle = (cycle) => {
  if (!cycle) return "Mensal";
  const lower = cycle.toLowerCase();
  if (lower === "semestral") return "Semestral";
  if (lower === "anual") return "Anual";
  return "Mensal";
};

/**
 * Cria a conta completa de um novo cliente SaaS de forma sequencial (Self-Service).
 */
const registerSelfService = async ({
  companyName,
  companyCnpj,
  saasPlan,
  paymentCycle,
  paymentStatus,
  userName,
  userEmail,
  userPassword,
  termsVersion,
  clientIp,
}) => {
  // 1. Validação de duplicidade de CNPJ no banco de dados
  const { data: existingCompany, error: searchError } = await supabase
    .from("empresas")
    .select("id_empresa")
    .eq("cnpj_empresa", companyCnpj)
    .maybeSingle();

  if (searchError)
    throw new Error("Erro ao validar duplicidade de CNPJ no servidor.");
  if (existingCompany)
    throw new Error("Este CNPJ já está cadastrado no sistema.");

  // 2. Insere a Empresa traduzindo os parâmetros para as colunas em português
  const { data: company, error: companyError } = await supabase
    .from("empresas")
    .insert({
      nome_empresa: companyName,
      cnpj_empresa: companyCnpj,
      plano_saas: saasPlan,
      ciclo_pagamento: formatPaymentCycle(paymentCycle),
      status_empresa: true,
      status_pagamento: paymentStatus || "pendente",
    })
    .select()
    .single();

  if (companyError || !company) {
    throw new Error(
      `Erro ao cadastrar empresa no banco de dados: ${companyError?.message}`,
    );
  }

  const companyId = company.id_empresa;

  // 3. Cadastra a Filial Matriz automaticamente para a nova empresa
  const { data: branch, error: branchError } = await supabase
    .from("filiais")
    .insert({
      id_empresa: companyId,
      nome_filial: companyName,
      cnpj_filial: companyCnpj,
      tipo_filial: "matriz", // Certifique-se de que corresponde ao tipo USER-DEFINED no banco
      status_filial: true,
    })
    .select()
    .single();

  if (branchError || !branch) {
    throw new Error(
      `Empresa criada, mas falhou ao gerar filial matriz: ${branchError?.message}`,
    );
  }

  const branchId = branch.id_filial;

  // 4. Cria a categoria padrão "Mensalidade" no Fluxo de Caixa da nova empresa
  const { error: categoryError } = await supabase
    .from("categorias_fluxo_caixa")
    .insert({
      id_empresa: companyId,
      id_filial: branchId,
      nome_categoria: "Mensalidade",
    });

  if (categoryError) {
    throw new Error(
      `Estruturas criadas, mas falhou ao gerar categorias financeiras padrão: ${categoryError.message}`,
    );
  }

  // 5. Cria o Perfil Administrativo com permissões totais no formato JSON exigido pelo banco
  const { data: profile, error: profileError } = await supabase
    .from("perfis")
    .insert({
      id_empresa: companyId,
      id_filial: branchId,
      nome_perfil: "Administrador",
      status_perfil: true,
      permissoes_perfil: {
        alunos: true,
        filiais: true,
        fluxo_caixa: true,
        importacao: true,
        exportacao: true,
        configuracoes: {
          informacoes_bancarias: true,
          plano_gym_connect: true,
          configuracoes_app: true,
          historico_usuario: true,
          usuarios: true,
          perfis: true,
        },
      },
    })
    .select()
    .single();

  if (profileError || !profile) {
    throw new Error(
      `Empresa e filial criadas, mas falhou ao gerar perfil de acesso ADM: ${profileError?.message}`,
    );
  }

  // 6. Criptografa a senha com bcryptjs e gera o primeiro Usuário Administrador vinculado a todos os IDs
  const hashedPassword = await bcrypt.hash(userPassword, 10);

  const { data: user, error: userError } = await supabase
    .from("usuarios")
    .insert({
      id_empresa: companyId,
      id_filial: branchId,
      id_perfil: profile.id_perfil,
      nome_usuario: userName,
      email_usuario: userEmail,
      senha_usuario: hashedPassword,
      status_usuario: true,
      primeiro_acesso_usuario: false,
      aceitou_termos: true,
      data_aceite_termos: new Date().toISOString(),
      ip_aceite_termos: clientIp || "127.0.0.1",
      versao_termos_aceitos: termsVersion || "1.0",
      permissoes_usuario: {
        alunos: true,
        filiais: true,
        fluxo_caixa: true,

        configuracoes: {
          subconta_asaas: false,
          informacoes_bancarias: true,
          plano_gym_connect: true,
          configuracoes_app: true,
          historico_usuario: true,
          usuarios: true,
          perfis: true,
        },

        precificacao: {
          planos: true,
        },

        ajuste_fluxo_caixa: {
          categorias: true,
        },
      },
      acesso_todas_filiais: true,
    })
    .select("id_usuario, nome_usuario, email_usuario")
    .single();

  if (userError) {
    throw new Error(
      `Empresa e estruturas configuradas, mas falhou ao gerar o usuário de acesso final: ${userError.message}`,
    );
  }

  const { data: planRow, error: planError } = await supabase
    .from("saas_planos")
    .select("id_plano")
    .eq("nome", saasPlan)
    .single();

  if (planError || !planRow) {
    throw new Error(
      `Empresa e usuário criados, mas o plano "${saasPlan}" não foi encontrado em saas_planos. ` +
        `Cadastro incompleto — verifique o nome do plano enviado pelo frontend.`,
    );
  }

  const subscription = await billingService.startTrialSubscription({
    companyId,
    companyName,
    companyCnpj,
    companyEmail: userEmail,
    planId: planRow.id_plano,
    cycle: formatPaymentCycle(paymentCycle),
  });

  return { company, branch, profile, user, subscription };
};

/**
 * Dados mínimos da empresa, usados pelo módulo de billing SaaS pra criar/
 * atualizar o customer na conta master do Asaas.
 */
const getCompanyBasicInfo = async (companyId) => {
  const { data, error } = await supabase
    .from("empresas")
    .select("id_empresa, nome_empresa, cnpj_empresa")
    .eq("id_empresa", companyId)
    .single();

  if (error || !data) {
    throw new Error("Empresa não encontrada.");
  }

  return data;
};

module.exports = {
  registerSelfService,
  getCompanyBasicInfo,
};
