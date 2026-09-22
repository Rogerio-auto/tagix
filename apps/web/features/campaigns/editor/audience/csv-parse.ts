/**
 * Leitor de CSV do público da campanha (F58-S08).
 *
 * ## Por que não dava para manter o `split(',')`
 *
 * O parser anterior quebrava a linha em vírgulas e pronto. Isso corrompe
 * silenciosamente o arquivo mais comum que existe:
 *
 * ```csv
 * phone,name
 * +5566999342444,"Silva, João"
 * ```
 *
 * O nome vira `"Silva` e o `João"` empurra a coluna seguinte. Ninguém percebe até
 * a mensagem sair com o nome errado — e aí já saiu para mil pessoas.
 *
 * ## O que este leitor cobre, e por quê
 *
 * - **Aspas**, inclusive com vírgula e quebra de linha dentro (RFC 4180).
 * - **Aspas escapadas** (`""` vira `"`), que é como o Excel grava um nome com aspas.
 * - **Ponto e vírgula** como separador: é o que o Excel em português exporta por
 *   padrão, e é o formato que o cliente brasileiro vai anexar.
 * - **BOM** do UTF-8 (U+FEFF), que o Excel do Windows sempre põe e que faria a
 *   primeira coluna se chamar "<BOM>phone" — quebrando o reconhecimento do
 *   cabeçalho.
 * - **CRLF**, porque o arquivo vem do Windows.
 *
 * Nada aqui adivinha: o que não reconhece vira linha inválida com motivo, não uma
 * suposição silenciosa.
 */

/** Uma linha já dividida em colunas. */
export type CsvRow = readonly string[];

/**
 * Detecta o separador contando ocorrências FORA de aspas na primeira linha.
 *
 * Contar no arquivo todo confundiria um `;` dentro de um nome com um separador.
 * O empate vai para a vírgula: é o padrão internacional, e o `;` é o desvio.
 */
export function detectDelimiter(texto: string): ',' | ';' {
  let virgulas = 0;
  let pontoVirgulas = 0;
  let dentroDeAspas = false;
  for (const ch of texto) {
    if (ch === '"') dentroDeAspas = !dentroDeAspas;
    else if (!dentroDeAspas && ch === ',') virgulas += 1;
    else if (!dentroDeAspas && ch === ';') pontoVirgulas += 1;
    else if (!dentroDeAspas && (ch === '\n' || ch === '\r')) break;
  }
  return pontoVirgulas > virgulas ? ';' : ',';
}

/**
 * Divide o texto em linhas e colunas respeitando aspas.
 *
 * Implementado como máquina de estados de um caractere só: é a única forma de
 * tratar quebra de linha DENTRO de um campo entre aspas, que uma divisão por
 * linhas antes das colunas já teria destruído.
 */
export function parseCsvGrid(texto: string, delimiter?: ',' | ';'): CsvRow[] {
  // O Excel do Windows sempre grava BOM (U+FEFF). Sem removê-lo, a primeira
  // coluna se chamaria "<BOM>phone" e o cabeçalho não seria reconhecido.
  // Escrito como escape de propósito: o caractere literal é invisível no
  // editor e vira um bug que ninguém consegue ver ao ler o código.
  const limpo = texto.replace(/^\uFEFF/, '');
  const sep = delimiter ?? detectDelimiter(limpo);

  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let dentroDeAspas = false;

  const fecharCampo = (): void => {
    linha.push(campo);
    campo = '';
  };
  const fecharLinha = (): void => {
    fecharCampo();
    // Linha totalmente vazia não é dado: é o \n final que todo arquivo tem.
    if (!(linha.length === 1 && linha[0] === '')) linhas.push(linha);
    linha = [];
  };

  for (let i = 0; i < limpo.length; i += 1) {
    const ch = limpo[i];

    if (dentroDeAspas) {
      if (ch === '"') {
        // `""` dentro de aspas é uma aspa literal — como o Excel grava um nome
        // que contém aspas.
        if (limpo[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += ch;
      }
      continue;
    }

    if (ch === '"' && campo === '') {
      dentroDeAspas = true;
    } else if (ch === sep) {
      fecharCampo();
    } else if (ch === '\n') {
      fecharLinha();
    } else if (ch === '\r') {
      // CRLF: o \n seguinte fecha a linha. Um \r solto (Mac clássico) também fecha.
      if (limpo[i + 1] !== '\n') fecharLinha();
    } else {
      campo += ch;
    }
  }

  // Último campo sem quebra de linha no fim do arquivo.
  if (campo !== '' || linha.length > 0) fecharLinha();

  return linhas;
}

/** Papéis que sabemos reconhecer numa coluna. */
export type ColumnRole = 'phone' | 'name' | 'consent' | 'ignore';

/**
 * Sinônimos por papel, em português e inglês, sem acento e minúsculos.
 *
 * O cliente vai anexar uma planilha feita por ele, não um template nosso. Se o
 * cabeçalho dele diz "celular" e nós só entendemos "phone", a importação inteira
 * falha com o arquivo certo na mão.
 */
const SINONIMOS: Readonly<Record<Exclude<ColumnRole, 'ignore'>, readonly string[]>> = {
  phone: ['phone', 'telefone', 'celular', 'whatsapp', 'fone', 'numero', 'number', 'tel', 'mobile'],
  name: ['name', 'nome', 'contato', 'contact', 'cliente', 'first_name', 'nome_completo'],
  consent: ['opt_in', 'optin', 'consent', 'consentimento', 'aceite', 'autorizacao', 'permissao'],
};

/** Normaliza para comparar cabeçalho: sem acento, sem espaço nas pontas, minúsculo. */
export function normalizeHeader(bruto: string): string {
  return bruto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
}

/**
 * Adivinha o papel de cada coluna a partir do cabeçalho.
 *
 * É um PALPITE, e o passo mostra o mapeamento para o usuário confirmar antes de
 * importar. Um palpite exibido é ajuda; um palpite escondido é um bug esperando
 * a hora de aparecer com mil mensagens já enviadas.
 */
export function guessColumns(header: CsvRow): ColumnRole[] {
  return header.map((bruto) => {
    const h = normalizeHeader(bruto);
    for (const [papel, nomes] of Object.entries(SINONIMOS)) {
      if (nomes.includes(h)) return papel as ColumnRole;
    }
    return 'ignore';
  });
}

/**
 * O cabeçalho é mesmo um cabeçalho?
 *
 * Um arquivo sem cabeçalho começa direto no primeiro telefone. Tratá-lo como
 * cabeçalho descartaria silenciosamente um contato — e o cliente jamais notaria
 * que faltou um.
 */
export function looksLikeHeader(primeira: CsvRow): boolean {
  return guessColumns(primeira).some((p) => p !== 'ignore');
}

export interface ParsedFile {
  readonly header: CsvRow | null;
  readonly roles: ColumnRole[];
  readonly rows: CsvRow[];
  readonly delimiter: ',' | ';';
}

/**
 * Lê o arquivo inteiro: separador, cabeçalho (se houver) e linhas de dados.
 *
 * Sem cabeçalho, assume a primeira coluna como telefone e a segunda como nome —
 * a convenção mais comum — e diz isso na tela, para o usuário corrigir se estiver
 * errado.
 */
export function parseCsvFile(texto: string): ParsedFile {
  const delimiter = detectDelimiter(texto.replace(/^\uFEFF/, ''));
  const grid = parseCsvGrid(texto, delimiter);
  if (grid.length === 0) {
    return { header: null, roles: [], rows: [], delimiter };
  }

  const primeira = grid[0] as CsvRow;
  if (looksLikeHeader(primeira)) {
    return {
      header: primeira,
      roles: guessColumns(primeira),
      rows: grid.slice(1),
      delimiter,
    };
  }

  const roles: ColumnRole[] = primeira.map((_, i) =>
    i === 0 ? 'phone' : i === 1 ? 'name' : 'ignore',
  );
  return { header: null, roles, rows: grid, delimiter };
}
