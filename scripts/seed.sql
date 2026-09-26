-- ============================================================================
-- SEED DE DADOS DE TESTE — GYM CONNECT
-- Cole este script inteiro no SQL Editor do Supabase e clique em "Run".
--
-- Por padrão ele roda em modo "teste" (BEGIN ... ROLLBACK no final), ou seja,
-- executa tudo, mostra os avisos no painel "Messages", e DESFAZ no final —
-- nada fica gravado. Depois de conferir que rodou sem erro, troque o
-- "ROLLBACK;" por "COMMIT;" (última linha do arquivo) e rode de novo pra
-- gravar de verdade.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- necessário pra gerar hash de senha (crypt/bcrypt)

DO $$
DECLARE
  -- ==========================================================================
  -- CONFIGURAÇÃO — ajuste antes de rodar
  -- ==========================================================================

  -- Se TRUE, reaproveita uma empresa já existente (informe o id abaixo).
  -- Se FALSE, cria uma empresa nova de teste ("Academia Seed Ltda").
  v_usar_empresa_existente boolean := false;
  v_id_empresa_existente integer := 1; -- só é usado se a linha acima for true

  v_total_alunos integer := 6000;
  v_ativos_ratio numeric := 0.8;        -- 80% ativos, 20% inativos
  v_inadimplentes_ratio numeric := 0.12; -- 12% dos alunos com mensalidade vencida
  v_dias_historico integer := 365;       -- espalha as datas de cadastro nos últimos 12 meses
  v_senha_padrao text := 'Teste123!';    -- senha de todos os usuários de teste criados

  -- ==========================================================================
  -- Variáveis internas (não precisa mexer)
  -- ==========================================================================
  v_run_seed bigint := extract(epoch from clock_timestamp())::bigint;
  v_run_tag text;

  v_empresa_id integer;
  v_filial_1 integer;
  v_filial_2 integer;

  v_perfil_admin integer;
  v_perfil_gerente integer;
  v_perfil_recepcao integer;

  v_total_ativos integer;

  v_primeiros_nomes text[] := ARRAY[
    'João','Maria','Pedro','Ana','Carlos','Beatriz','Lucas','Fernanda',
    'Rafael','Juliana','Gabriel','Camila','Bruno','Larissa','Felipe',
    'Amanda','Diego','Patrícia','Thiago','Vanessa','Marcelo','Renata',
    'André','Aline','Rodrigo','Débora','Leonardo','Priscila','Vinícius',
    'Tatiane','Gustavo','Carolina','Eduardo','Bianca','Matheus','Sabrina'
  ];
  v_sobrenomes text[] := ARRAY[
    'Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Alves',
    'Pereira','Lima','Gomes','Costa','Ribeiro','Martins','Carvalho',
    'Almeida','Lopes','Soares','Fernandes','Vieira','Barbosa','Rocha',
    'Dias','Nascimento','Andrade','Moreira','Nunes','Marques','Machado'
  ];

BEGIN
  v_run_tag := v_run_seed::text;
  v_total_ativos := round(v_total_alunos * v_ativos_ratio)::integer;

  -- 1. EMPRESA -------------------------------------------------------------
  IF v_usar_empresa_existente THEN
    v_empresa_id := v_id_empresa_existente;
    RAISE NOTICE 'Reaproveitando empresa existente id_empresa=%', v_empresa_id;
  ELSE
    INSERT INTO empresas (nome_empresa, cnpj_empresa, plano_saas, status_empresa, status_pagamento, ciclo_pagamento)
    VALUES ('Academia Seed Ltda', 'SEED' || v_run_tag, 'Profissional', true, 'pago', 'Mensal')
    RETURNING id_empresa INTO v_empresa_id;
    RAISE NOTICE 'Empresa de teste criada: id_empresa=%', v_empresa_id;
  END IF;

  -- 2. FILIAIS ---------------------------------------------------------------
  INSERT INTO filiais (id_empresa, nome_filial, cnpj_filial, telefone_filial, tipo_filial, status_filial)
  VALUES (v_empresa_id, 'Filial Centro (Seed)', 'SEED' || v_run_tag || '1', '(11) 90000-0001', 'matriz', true)
  RETURNING id_filial INTO v_filial_1;

  INSERT INTO filiais (id_empresa, nome_filial, cnpj_filial, telefone_filial, tipo_filial, status_filial)
  VALUES (v_empresa_id, 'Filial Norte (Seed)', 'SEED' || v_run_tag || '2', '(11) 90000-0002', 'filial', true)
  RETURNING id_filial INTO v_filial_2;

  RAISE NOTICE 'Filiais criadas: % e %', v_filial_1, v_filial_2;

  -- 3. PERFIS COM PERMISSÕES VARIADAS -----------------------------------------
  INSERT INTO perfis (id_empresa, id_filial, nome_perfil, permissoes_perfil, status_perfil)
  VALUES (v_empresa_id, v_filial_1, 'Seed - Administrador', '{
    "alunos": true, "filiais": true, "fluxo_caixa": true,
    "configuracoes": {"informacoes_bancarias": true, "plano_gym_connect": true, "configuracoes_app": true, "historico_usuario": true, "usuarios": true, "perfis": true},
    "precificacao": {"planos": true},
    "ajuste_fluxo_caixa": {"categorias": true}
  }'::json, true)
  RETURNING id_perfil INTO v_perfil_admin;

  INSERT INTO perfis (id_empresa, id_filial, nome_perfil, permissoes_perfil, status_perfil)
  VALUES (v_empresa_id, v_filial_1, 'Seed - Gerente de Filial', '{
    "alunos": true, "filiais": true, "fluxo_caixa": false,
    "configuracoes": {"informacoes_bancarias": false, "plano_gym_connect": false, "configuracoes_app": false, "historico_usuario": true, "usuarios": true, "perfis": false},
    "precificacao": {"planos": false},
    "ajuste_fluxo_caixa": {"categorias": false}
  }'::json, true)
  RETURNING id_perfil INTO v_perfil_gerente;

  INSERT INTO perfis (id_empresa, id_filial, nome_perfil, permissoes_perfil, status_perfil)
  VALUES (v_empresa_id, v_filial_1, 'Seed - Recepção', '{
    "alunos": true, "filiais": false, "fluxo_caixa": false,
    "configuracoes": {"informacoes_bancarias": false, "plano_gym_connect": false, "configuracoes_app": false, "historico_usuario": false, "usuarios": false, "perfis": false},
    "precificacao": {"planos": false},
    "ajuste_fluxo_caixa": {"categorias": false}
  }'::json, true)
  RETURNING id_perfil INTO v_perfil_recepcao;

  RAISE NOTICE 'Perfis criados: admin=%, gerente=%, recepcao=%', v_perfil_admin, v_perfil_gerente, v_perfil_recepcao;

  -- 4. USUÁRIOS DE TESTE (um por perfil) --------------------------------------
  INSERT INTO usuarios (id_empresa, id_filial, id_perfil, nome_usuario, email_usuario, senha_usuario, status_usuario, primeiro_acesso_usuario, aceitou_termos, versao_termos_aceitos)
  VALUES
    (v_empresa_id, v_filial_1, v_perfil_admin, 'Seed Admin', 'seed.admin@seed-teste.com', crypt(v_senha_padrao, gen_salt('bf', 10)), true, false, true, '1.0'),
    (v_empresa_id, v_filial_1, v_perfil_gerente, 'Seed Gerente', 'seed.gerente@seed-teste.com', crypt(v_senha_padrao, gen_salt('bf', 10)), true, false, true, '1.0'),
    (v_empresa_id, v_filial_1, v_perfil_recepcao, 'Seed Recepcao', 'seed.recepcao@seed-teste.com', crypt(v_senha_padrao, gen_salt('bf', 10)), true, false, true, '1.0')
  ON CONFLICT (email_usuario) DO NOTHING;

  RAISE NOTICE 'Usuários de teste prontos (senha para todos: %)', v_senha_padrao;

  -- 5. ALUNOS EM MASSA ---------------------------------------------------------
  INSERT INTO alunos (id_empresa, id_filial, nome_aluno, email_aluno, telefone_aluno, cpf_aluno, plano_aluno, matricula_aluno, status_aluno, situacao_aluno, data_cadastro_aluno)
  SELECT
    v_empresa_id,
    CASE WHEN i % 2 = 0 THEN v_filial_1 ELSE v_filial_2 END,
    nome,
    lower(regexp_replace(nome, '\s+', '.', 'g')) || '.' || i || '@seed-teste.com',
    '(' || (11 + floor(random() * 78))::int || ') 9' ||
      lpad((1000 + floor(random() * 8999))::int::text, 4, '0') || '-' ||
      lpad((1000 + floor(random() * 8999))::int::text, 4, '0'),
    lpad(((v_run_seed + i * 97) % 100000000000)::text, 11, '0'),
    (ARRAY['Mensal', 'Trimestral', 'Anual'])[1 + floor(random() * 3)::int],
    'SEED-' || v_run_tag || '-' || lpad(i::text, 6, '0'),
    (i <= v_total_ativos),
    'regular',
    CURRENT_TIMESTAMP - (floor(random() * v_dias_historico)::int * interval '1 day')
  FROM (
    SELECT
      s.i,
      v_primeiros_nomes[1 + floor(random() * array_length(v_primeiros_nomes, 1))::int]
        || ' ' ||
      v_sobrenomes[1 + floor(random() * array_length(v_sobrenomes, 1))::int] AS nome
    FROM generate_series(1, v_total_alunos) AS s(i)
  ) sub;

  RAISE NOTICE '% alunos inseridos (% ativos, % inativos)', v_total_alunos, v_total_ativos, v_total_alunos - v_total_ativos;

  -- 6. PAGAMENTOS VENCIDOS (inadimplência) -------------------------------------
  INSERT INTO pagamentos (aluno_id, id_empresa, id_filial, asaas_subscription_id, tipo_pagamento, status, valor, data_vencimento, confirmado_em, tipo_operacao, plano)
  SELECT
    id_aluno,
    id_empresa,
    id_filial,
    'seed-sub-' || matricula_aluno,
    'assinatura',
    'vencido',
    (ARRAY[99.9, 269.9, 899.9])[1 + floor(random() * 3)::int],
    CURRENT_DATE - (floor(random() * 45) + 3)::int,
    NULL,
    'ADESAO',
    plano_aluno
  FROM alunos
  WHERE matricula_aluno LIKE 'SEED-' || v_run_tag || '-%'
    AND status_aluno = true
    AND random() < v_inadimplentes_ratio;

  RAISE NOTICE 'Seed concluído! empresa=%, filiais=% e %', v_empresa_id, v_filial_1, v_filial_2;
END $$;

-- ============================================================================
-- Depois de conferir as mensagens acima e não ter dado nenhum erro:
--   troque a linha abaixo de ROLLBACK para COMMIT e rode o script de novo
--   pra gravar tudo de verdade.
-- ============================================================================
ROLLBACK;
-- COMMIT;
