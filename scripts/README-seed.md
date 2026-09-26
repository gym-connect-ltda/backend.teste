# Seed de dados de teste — Gym Connect

Script em `scripts/seed.js` que popula o banco pra você testar o sistema com volume real.

## O que ele cria

- **1 empresa** (ou reaproveita uma sua, veja abaixo)
- **2 filiais**
- **3 perfis** com permissões bem diferentes entre si, pra testar o controle de acesso:
  - `Seed - Administrador` (acesso total)
  - `Seed - Gerente de Filial` (alunos + filiais, sem configurações sensíveis)
  - `Seed - Recepção` (só alunos)
- **3 usuários**, um por perfil acima, todos com senha `Teste123!`:
  - `seed.admin@seed-teste.com`
  - `seed.gerente@seed-teste.com`
  - `seed.recepcao@seed-teste.com`
- **6.000 alunos**, distribuídos entre as 2 filiais:
  - 80% ativos, 20% inativos (ajustável)
  - 12% dos ativos com uma mensalidade vencida e não paga (pra virarem "inadimplentes" no dashboard)
  - **data de cadastro espalhada nos últimos 365 dias** (aleatório) — isso é o que faz o cálculo de tendência do dashboard ("vs. 30 dias atrás") ter algo real pra comparar, em vez de só alunos criados hoje

## Como rodar

```bash
cd connect.api
node scripts/seed.js
```

Isso demora um pouco (6 mil inserções em lotes de 500) — vai mostrar o progresso no terminal.

### Simular antes, sem gravar nada

```bash
DRY_RUN=true node scripts/seed.js
```

Mostra o que ele faria (contagens e um exemplo de aluno) sem tocar no banco.

### Reaproveitar sua empresa já existente

Se você já tem uma empresa cadastrada e só quer alimentar ela com alunos/usuários de teste (em vez de criar uma empresa nova do zero):

```bash
EMPRESA_ID=1 node scripts/seed.js
```

(troque `1` pelo `id_empresa` real — dá pra ver esse número na tabela `empresas` do Supabase, ou no token do seu usuário logado)

Nesse modo ele ainda cria as 2 filiais, os 3 perfis, os 3 usuários e os 6.000 alunos — só não cria uma empresa nova.

### Ajustar os números

Abra `scripts/seed.js` e mexa nas constantes no topo do arquivo:

```js
const TOTAL_ALUNOS = 6000;
const ATIVOS_RATIO = 0.8;
const INADIMPLENTES_RATIO_DOS_ATIVOS = 0.12;
const DIAS_HISTORICO = 365;
```

## Como limpar depois

Rode `scripts/cleanup-seed.sql` no SQL Editor do Supabase. Ele só apaga o que tem a "marca" do seed (matrículas `SEED-...`, e-mails `@seed-teste.com`, nomes com `Seed`) — não toca na sua empresa/usuário reais, **desde que você tenha usado `EMPRESA_ID`** ao rodar o seed. Se você deixou o seed criar uma empresa nova, o próprio script de limpeza também remove essa empresa de teste.

## Observações importantes

- **CPFs e matrículas são sintéticos** (só existem pra satisfazer as constraints `UNIQUE` do banco) — não são CPFs válidos de verdade, então não tente usar essas telas de aluno pra validar a regra de dígito verificador com esses dados.
- Rodar o script **duas vezes seguidas sem limpar antes** funciona sem erro (os identificadores incluem um timestamp da execução), mas você vai acumular o dobro de alunos/usuários de teste.
- Se sua tabela `alunos` tiver algum trigger ou RLS customizado que você adicionou depois da entrega original, o insert em lote pode se comportar diferente — rode primeiro com `DRY_RUN=true` se não tiver certeza.
