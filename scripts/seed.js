/**
 * Script de seed para popular o banco com dados de teste:
 * - 1 empresa (reaproveita se você já tiver uma via EMPRESA_ID)
 * - 2 filiais
 * - 6000 alunos (ativos / inativos / inadimplentes), com datas de
 *   cadastro espalhadas nos últimos 12 meses (pra testar a tendência
 *   do dashboard, que compara com "30 dias atrás")
 * - alguns usuários com perfis/permissões variadas, pra testar o
 *   controle de acesso por tela
 *
 * COMO RODAR (a partir da pasta connect.api):
 *   node scripts/seed.js
 *
 * Pra só simular sem gravar nada (ver o que ele faria):
 *   DRY_RUN=true node scripts/seed.js
 *
 * Pra reaproveitar uma empresa que você já tem (em vez de criar uma nova):
 *   EMPRESA_ID=1 node scripts/seed.js
 *
 * Requer o .env já configurado (SUPABASE_URL, SUPABASE_KEY).
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ----------------------------------------------------------------------
// CONFIGURAÇÃO — ajuste esses números como quiser antes de rodar
// ----------------------------------------------------------------------
const TOTAL_ALUNOS = 6000;
const ATIVOS_RATIO = 0.8; // 80% ativos, 20% inativos
const INADIMPLENTES_RATIO_DOS_ATIVOS = 0.12; // 12% dos ativos com mensalidade vencida
const DIAS_HISTORICO = 365; // espalha as datas de cadastro nos últimos 12 meses
const BATCH_SIZE = 500; // tamanho do lote de insert (evita payload gigante)
const SENHA_PADRAO = "Teste123!"; // senha de todos os usuários de teste criados

const DRY_RUN = process.env.DRY_RUN === "true";
const EMPRESA_ID_ENV = process.env.EMPRESA_ID ? Number(process.env.EMPRESA_ID) : null;

const RUN_TAG = Date.now().toString(36); // garante CPF/matrícula únicos mesmo rodando de novo

// ----------------------------------------------------------------------
// Dados fake pra gerar nomes variados
// ----------------------------------------------------------------------
const PRIMEIROS_NOMES = [
  "João", "Maria", "Pedro", "Ana", "Carlos", "Beatriz", "Lucas", "Fernanda",
  "Rafael", "Juliana", "Gabriel", "Camila", "Bruno", "Larissa", "Felipe",
  "Amanda", "Diego", "Patrícia", "Thiago", "Vanessa", "Marcelo", "Renata",
  "André", "Aline", "Rodrigo", "Débora", "Leonardo", "Priscila", "Vinícius",
  "Tatiane", "Gustavo", "Carolina", "Eduardo", "Bianca", "Matheus", "Sabrina",
];

const SOBRENOMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves",
  "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho",
  "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha",
  "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado",
];

const PLANOS = ["Mensal", "Trimestral", "Anual"];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function randomName() {
  return `${randomChoice(PRIMEIROS_NOMES)} ${randomChoice(SOBRENOMES)}`;
}

/** CPF sintético (só precisa ser único no banco — não passa pela validação de dígito do front, já que é inserido direto). */
function fakeCPF(index) {
  const base = Date.now() + index * 97 + randomInt(0, 96);
  return String(base).padStart(11, "0").slice(-11);
}

function fakeMatricula(index) {
  return `SEED-${RUN_TAG}-${String(index).padStart(6, "0")}`;
}

function fakePhone() {
  const ddd = randomInt(11, 89);
  const numero = randomInt(900000000, 999999999);
  return `(${ddd}) 9${String(numero).slice(0, 4)}-${String(numero).slice(4, 8)}`;
}

function fakeEmail(name, index) {
  const slug = name.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z.]/g, "");
  return `${slug}.${index}@seed-teste.com`;
}

/** Data ISO aleatória entre `diasAtras` dias atrás e hoje. */
function randomDateWithinDays(diasAtras) {
  const now = Date.now();
  const past = now - diasAtras * 24 * 60 * 60 * 1000;
  const timestamp = randomInt(past, now);
  return new Date(timestamp).toISOString();
}

async function main() {
  console.log(`\n=== Seed Gym Connect ${DRY_RUN ? "(DRY RUN — nada será gravado)" : ""} ===\n`);

  // 1. Empresa -----------------------------------------------------------
  let empresaId = EMPRESA_ID_ENV;

  if (empresaId) {
    console.log(`Reaproveitando empresa existente id_empresa=${empresaId}`);
  } else {
    console.log("Criando empresa de teste...");
    if (!DRY_RUN) {
      const { data: empresa, error } = await supabase
        .from("empresas")
        .insert({
          nome_empresa: "Academia Seed Ltda",
          cnpj_empresa: `SEED${RUN_TAG}`,
          plano_saas: "Profissional",
          status_empresa: true,
          status_pagamento: "pago",
          ciclo_pagamento: "Mensal",
        })
        .select()
        .single();

      if (error) throw new Error(`Erro ao criar empresa: ${error.message}`);
      empresaId = empresa.id_empresa;
    } else {
      empresaId = "DRY_RUN_ID";
    }
  }
  console.log(`→ id_empresa = ${empresaId}\n`);

  // 2. Filiais -------------------------------------------------------------
  console.log("Criando 2 filiais...");
  const filiaisData = [
    { nome_filial: "Filial Centro (Seed)", tipo_filial: "matriz" },
    { nome_filial: "Filial Norte (Seed)", tipo_filial: "filial" },
  ];

  let filialIds = [];
  if (!DRY_RUN) {
    for (const f of filiaisData) {
      const { data: filial, error } = await supabase
        .from("filiais")
        .insert({
          id_empresa: empresaId,
          nome_filial: f.nome_filial,
          cnpj_filial: `SEED${RUN_TAG}${filialIds.length}`,
          telefone_filial: fakePhone(),
          tipo_filial: f.tipo_filial,
          status_filial: true,
        })
        .select()
        .single();

      if (error) throw new Error(`Erro ao criar filial: ${error.message}`);
      filialIds.push(filial.id_filial);
    }
  } else {
    filialIds = ["DRY_RUN_FILIAL_1", "DRY_RUN_FILIAL_2"];
  }
  console.log(`→ filiais: ${filialIds.join(", ")}\n`);

  // 3. Perfis com permissões variadas --------------------------------------
  console.log("Criando perfis de teste com permissões variadas...");

  const perfisData = [
    {
      nome_perfil: "Seed - Administrador",
      permissoes: {
        alunos: true,
        filiais: true,
        fluxo_caixa: true,
        configuracoes: {
          informacoes_bancarias: true,
          plano_gym_connect: true,
          configuracoes_app: true,
          historico_usuario: true,
          usuarios: true,
          perfis: true,
        },
        precificacao: { planos: true },
        ajuste_fluxo_caixa: { categorias: true },
      },
    },
    {
      nome_perfil: "Seed - Gerente de Filial",
      permissoes: {
        alunos: true,
        filiais: true,
        fluxo_caixa: false,
        configuracoes: {
          informacoes_bancarias: false,
          plano_gym_connect: false,
          configuracoes_app: false,
          historico_usuario: true,
          usuarios: true,
          perfis: false,
        },
        precificacao: { planos: false },
        ajuste_fluxo_caixa: { categorias: false },
      },
    },
    {
      nome_perfil: "Seed - Recepção",
      permissoes: {
        alunos: true,
        filiais: false,
        fluxo_caixa: false,
        configuracoes: {
          informacoes_bancarias: false,
          plano_gym_connect: false,
          configuracoes_app: false,
          historico_usuario: false,
          usuarios: false,
          perfis: false,
        },
        precificacao: { planos: false },
        ajuste_fluxo_caixa: { categorias: false },
      },
    },
  ];

  let perfilIds = [];
  if (!DRY_RUN) {
    for (const p of perfisData) {
      const { data: perfil, error } = await supabase
        .from("perfis")
        .insert({
          id_empresa: empresaId,
          id_filial: filialIds[0],
          nome_perfil: p.nome_perfil,
          permissoes_perfil: p.permissoes,
          status_perfil: true,
        })
        .select()
        .single();

      if (error) throw new Error(`Erro ao criar perfil: ${error.message}`);
      perfilIds.push(perfil.id_perfil);
    }
  } else {
    perfilIds = ["DRY_RUN_PERFIL_1", "DRY_RUN_PERFIL_2", "DRY_RUN_PERFIL_3"];
  }
  console.log(`→ perfis: ${perfilIds.join(", ")}\n`);

  // 4. Usuários (um por perfil, pra testar o controle de acesso) -----------
  console.log(`Criando usuários de teste (senha padrão: ${SENHA_PADRAO})...`);

  const usuariosData = [
    { nome: "Seed Admin", email: "seed.admin@seed-teste.com", perfilIndex: 0 },
    { nome: "Seed Gerente", email: "seed.gerente@seed-teste.com", perfilIndex: 1 },
    { nome: "Seed Recepcao", email: "seed.recepcao@seed-teste.com", perfilIndex: 2 },
  ];

  if (!DRY_RUN) {
    const hashedPassword = await bcrypt.hash(SENHA_PADRAO, 10);

    for (const u of usuariosData) {
      const { error } = await supabase.from("usuarios").insert({
        id_empresa: empresaId,
        id_filial: filialIds[0],
        id_perfil: perfilIds[u.perfilIndex],
        nome_usuario: u.nome,
        email_usuario: u.email,
        senha_usuario: hashedPassword,
        status_usuario: true,
        primeiro_acesso_usuario: false,
        aceitou_termos: true,
        data_aceite_termos: new Date().toISOString(),
        versao_termos_aceitos: "1.0",
      });

      if (error && error.code !== "23505") {
        throw new Error(`Erro ao criar usuário ${u.email}: ${error.message}`);
      }
      if (error?.code === "23505") {
        console.log(`  (usuário ${u.email} já existia, pulei)`);
      }
    }
  }

  console.log("→ usuários de teste:");
  usuariosData.forEach((u) => console.log(`   ${u.email} / senha: ${SENHA_PADRAO}`));
  console.log();

  // 5. Alunos em massa ------------------------------------------------------
  const totalAtivos = Math.round(TOTAL_ALUNOS * ATIVOS_RATIO);
  const totalInativos = TOTAL_ALUNOS - totalAtivos;
  const totalInadimplentes = Math.round(totalAtivos * INADIMPLENTES_RATIO_DOS_ATIVOS);

  console.log(`Gerando ${TOTAL_ALUNOS} alunos:`);
  console.log(`  - ${totalAtivos} ativos (dos quais ${totalInadimplentes} com mensalidade vencida)`);
  console.log(`  - ${totalInativos} inativos`);
  console.log(`  - datas de cadastro espalhadas nos últimos ${DIAS_HISTORICO} dias\n`);

  const alunosParaInserir = [];
  const idsParaInadimplencia = []; // guardamos o índice pra criar pagamento depois

  for (let i = 0; i < TOTAL_ALUNOS; i++) {
    const ativo = i < totalAtivos;
    const name = randomName();
    const branchId = filialIds[i % filialIds.length];
    const dataCadastro = randomDateWithinDays(DIAS_HISTORICO);

    alunosParaInserir.push({
      id_empresa: empresaId,
      id_filial: branchId,
      nome_aluno: name,
      email_aluno: fakeEmail(name, i),
      telefone_aluno: fakePhone(),
      cpf_aluno: fakeCPF(i),
      plano_aluno: randomChoice(PLANOS),
      matricula_aluno: fakeMatricula(i),
      status_aluno: ativo,
      situacao_aluno: "regular",
      data_cadastro_aluno: dataCadastro,
    });

    // marca os primeiros N ativos como candidatos a inadimplente
    if (ativo && idsParaInadimplencia.length < totalInadimplentes) {
      idsParaInadimplencia.push(i);
    }
  }

  if (DRY_RUN) {
    console.log("(dry run) Nenhum aluno foi gravado. Exemplo do 1º registro que seria inserido:");
    console.log(alunosParaInserir[0]);
  } else {
    console.log(`Inserindo em lotes de ${BATCH_SIZE}...`);

    // Mapeia matrícula -> id_aluno real (não confiamos na ordem de retorno do insert em lote)
    const matriculaParaId = new Map();

    for (let i = 0; i < alunosParaInserir.length; i += BATCH_SIZE) {
      const batch = alunosParaInserir.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from("alunos")
        .insert(batch)
        .select("id_aluno, matricula_aluno");

      if (error) {
        throw new Error(`Erro ao inserir lote de alunos (offset ${i}): ${error.message}`);
      }

      data.forEach((row) => matriculaParaId.set(row.matricula_aluno, row.id_aluno));
      console.log(`  ${Math.min(i + BATCH_SIZE, alunosParaInserir.length)}/${alunosParaInserir.length} alunos inseridos...`);
    }

    // 6. Pagamentos vencidos pros alunos inadimplentes ---------------------
    console.log(`\nCriando ${idsParaInadimplencia.length} mensalidades vencidas (inadimplência)...`);

    const pagamentosParaInserir = idsParaInadimplencia.map((idx) => {
      const registro = alunosParaInserir[idx];
      const alunoId = matriculaParaId.get(registro.matricula_aluno);
      const branchId = registro.id_filial;
      const diasAtraso = randomInt(3, 45);
      const vencimento = new Date(Date.now() - diasAtraso * 24 * 60 * 60 * 1000);

      return {
        aluno_id: alunoId,
        id_empresa: empresaId,
        id_filial: branchId,
        asaas_subscription_id: `seed-sub-${registro.matricula_aluno}`,
        tipo_pagamento: "assinatura",
        status: "vencido",
        valor: randomChoice([99.9, 269.9, 899.9]),
        data_vencimento: vencimento.toISOString().slice(0, 10),
        confirmado_em: null,
        tipo_operacao: "ADESAO",
        plano: randomChoice(PLANOS),
      };
    }).filter((p) => p.aluno_id); // segurança: descarta qualquer um sem id resolvido

    for (let i = 0; i < pagamentosParaInserir.length; i += BATCH_SIZE) {
      const batch = pagamentosParaInserir.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("pagamentos").insert(batch);

      if (error) {
        throw new Error(`Erro ao inserir lote de pagamentos (offset ${i}): ${error.message}`);
      }
    }
  }

  console.log("\n=== Seed concluído com sucesso! ===\n");
  if (!DRY_RUN) {
    console.log(`Empresa: id_empresa=${empresaId}`);
    console.log(`Filiais: ${filialIds.join(", ")}`);
    console.log("Logue com um dos usuários acima para testar as permissões.");
  }
}

main().catch((err) => {
  console.error("\n❌ Erro no seed:", err.message);
  process.exit(1);
});
