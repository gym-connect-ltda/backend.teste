-- Remove SOMENTE os dados gerados pelo scripts/seed.js, sem tocar
-- na sua empresa/filiais/usuários reais.
--
-- Funciona porque tudo que o seed cria é identificável por padrão:
--   - alunos: matricula_aluno começa com 'SEED-'
--   - pagamentos: asaas_subscription_id começa com 'seed-sub-'
--   - usuários/perfis/filiais/empresa: nome começa com 'Seed'
--     (só serão apagados se você RODOU o seed criando empresa nova,
--      ou seja, NÃO usou EMPRESA_ID de uma empresa já existente sua)
--
-- Rode em partes, na ordem abaixo (respeita as foreign keys).

-- 1. Pagamentos de teste
DELETE FROM public.pagamentos
WHERE asaas_subscription_id LIKE 'seed-sub-%';

-- 2. Alunos de teste
DELETE FROM public.alunos
WHERE matricula_aluno LIKE 'SEED-%';

-- 3. Usuários de teste (só os e-mails @seed-teste.com)
DELETE FROM public.usuarios
WHERE email_usuario LIKE '%@seed-teste.com';

-- 4. Perfis de teste
DELETE FROM public.perfis
WHERE nome_perfil LIKE 'Seed - %';

-- 5. Filiais de teste (só apaga se você deixou o seed criar filiais novas)
DELETE FROM public.filiais
WHERE nome_filial LIKE '%(Seed)';

-- 6. Empresa de teste (só apaga se você deixou o seed criar uma empresa nova
--    — ou seja, rodou SEM a variável EMPRESA_ID)
DELETE FROM public.empresas
WHERE nome_empresa = 'Academia Seed Ltda';
