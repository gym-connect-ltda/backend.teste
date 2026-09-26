const REQUIRED_COLUMNS = [
  "nome_aluno",
  "email_aluno",
  "telefone_aluno",
  "cpf_aluno",
  "plano_aluno",
  "forma_pagamento",
];

/** Parser simples de CSV (separado por vírgula, com suporte a aspas). */
function parseCsvLine(line) {
  const values = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

/**
 * Faz o parse de um CSV de alunos, validando que todas as colunas
 * obrigatórias existem no cabeçalho. Espelha o parser do front-end
 * (ImportStudent.tsx) pra manter o mesmo contrato de arquivo.
 */
function parseStudentsCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { rows: [], missingColumns: [...REQUIRED_COLUMNS] };
  }

  const header = parseCsvLine(lines[0]).map((column) => column.trim().toLowerCase());
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !header.includes(column));

  if (missingColumns.length > 0) {
    return { rows: [], missingColumns };
  }

  const columnIndex = Object.fromEntries(
    REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]),
  );

  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const rowData = Object.fromEntries(
      REQUIRED_COLUMNS.map((column) => [column, values[columnIndex[column]]?.trim() ?? ""]),
    );

    return { rowNumber: index + 2, ...rowData }; // +2: pula o header, começa em 1
  });

  return { rows, missingColumns: [] };
}

module.exports = { parseStudentsCsv, REQUIRED_COLUMNS };
