/**
 * F60-S01 — identidades do contato.
 *
 * O caso que motiva a tabela: lead chega por e-mail, é nutrido por e-mail, e três
 * semanas depois manda WhatsApp de um número que ninguém associou. Aqui o sistema
 * **sugere** que é a mesma pessoa e não funde sozinho.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { contactIdentitiesRepo, normalizeIdentity } from './repos/contact-identities';
import { withWorkspace } from './rls';
import { contactIdentities, contacts, workspaces } from './schema';

let wsA = '';
let wsB = '';
let suffix = '';

async function novoContato(workspaceId: string, nome: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(contacts)
    .values({ workspaceId, displayName: `${nome} ${suffix}` })
    .returning();
  if (!row) throw new Error('Falha ao criar contato.');
  return row.id;
}

beforeAll(async () => {
  const db = getDb();
  suffix = randomUUID().slice(0, 8);
  const [a] = await db
    .insert(workspaces)
    .values({ name: `Ident A ${suffix}`, slug: `ident-a-${suffix}` })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: `Ident B ${suffix}`, slug: `ident-b-${suffix}` })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces.');
  wsA = a.id;
  wsB = b.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsA, wsB]) {
    if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  await closeDb();
});

describe('normalizeIdentity', () => {
  it('e-mail: minúsculo e sem espaço nas bordas', () => {
    expect(normalizeIdentity('email', '  Joao@Empresa.COM ')).toBe('joao@empresa.com');
  });

  it('telefone: só dígitos — o + do E.164 é reconstruído na exibição', () => {
    // Guardar com e sem `+` criaria duas identidades para o mesmo número.
    expect(normalizeIdentity('phone', '+55 (11) 99999-8888')).toBe('5511999998888');
    expect(normalizeIdentity('phone', '5511999998888')).toBe('5511999998888');
  });

  it('outros tipos: só apara as bordas', () => {
    expect(normalizeIdentity('ig_user', '  17841400000  ')).toBe('17841400000');
  });

  it('é idempotente', () => {
    for (const [kind, v] of [
      ['email', 'A@B.com'],
      ['phone', '+55 11 9'],
    ] as const) {
      const once = normalizeIdentity(kind, v);
      expect(normalizeIdentity(kind, once)).toBe(once);
    }
  });
});

describe('resolve e attach', () => {
  it('acha o contato pelo identificador, normalizando a busca', async () => {
    const contato = await novoContato(wsA, 'Maria');
    await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.attach(tx, wsA, contato, { kind: 'email', value: 'Maria@Obra.com' }),
    );

    const achado = await withWorkspace(wsA, (tx) =>
      // Busca com caixa e espaço diferentes do que foi gravado.
      contactIdentitiesRepo.resolve(tx, wsA, { kind: 'email', value: '  maria@obra.COM ' }),
    );
    expect(achado).toBe(contato);
  });

  it('devolve null quando não conhece', async () => {
    const achado = await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.resolve(tx, wsA, { kind: 'email', value: 'ninguem@lugar.com' }),
    );
    expect(achado).toBeNull();
  });

  it('attach é idempotente', async () => {
    const contato = await novoContato(wsA, 'Repetido');
    for (let i = 0; i < 3; i += 1) {
      await withWorkspace(wsA, (tx) =>
        contactIdentitiesRepo.attach(tx, wsA, contato, { kind: 'phone', value: '+55 11 90000-0001' }),
      );
    }
    const lista = await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.listForContact(tx, wsA, contato),
    );
    expect(lista.filter((i) => i.kind === 'phone')).toHaveLength(1);
  });

  it('valor vazio não vira identidade', async () => {
    const contato = await novoContato(wsA, 'Vazio');
    await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.attach(tx, wsA, contato, { kind: 'phone', value: '   ' }),
    );
    const lista = await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.listForContact(tx, wsA, contato),
    );
    expect(lista).toHaveLength(0);
  });

  it('o mesmo identificador não pode pertencer a dois contatos', async () => {
    const um = await novoContato(wsA, 'Primeiro');
    const dois = await novoContato(wsA, 'Segundo');
    await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.attach(tx, wsA, um, { kind: 'email', value: 'disputado@x.com' }),
    );
    // `onConflictDoNothing`: a segunda tentativa não rouba o identificador.
    await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.attach(tx, wsA, dois, { kind: 'email', value: 'disputado@x.com' }),
    );

    const dono = await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.resolve(tx, wsA, { kind: 'email', value: 'disputado@x.com' }),
    );
    expect(dono).toBe(um);
  });
});

describe('sugestão de fusão — sugere, nunca funde', () => {
  it('identificadores que chegam juntos apontando para contatos distintos viram sugestão', async () => {
    // O caso real: lead entrou por e-mail há três semanas; hoje manda WhatsApp,
    // e o formulário traz os dois.
    const porEmail = await novoContato(wsA, 'LeadEmail');
    const porWhats = await novoContato(wsA, 'LeadWhats');
    await withWorkspace(wsA, async (tx) => {
      await contactIdentitiesRepo.attach(tx, wsA, porEmail, {
        kind: 'email',
        value: 'obra@cliente.com',
      });
      await contactIdentitiesRepo.attach(tx, wsA, porWhats, {
        kind: 'phone',
        value: '+1 407 555 0123',
      });
    });

    const sugestao = await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.suggestMerge(tx, wsA, [
        { kind: 'email', value: 'obra@cliente.com' },
        { kind: 'phone', value: '+1 (407) 555-0123' },
      ]),
    );

    expect(sugestao).toHaveLength(2);
    expect(sugestao).toContain(porEmail);
    expect(sugestao).toContain(porWhats);

    // E o mais importante: NADA foi fundido.
    const aindaExistem = await withWorkspace(wsA, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, porWhats)),
    );
    expect(aindaExistem).toHaveLength(1);
  });

  it('um contato só não é sugestão de fusão', async () => {
    const contato = await novoContato(wsA, 'Unico');
    await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.attach(tx, wsA, contato, { kind: 'email', value: 'unico@x.com' }),
    );
    const s = await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.suggestMerge(tx, wsA, [{ kind: 'email', value: 'unico@x.com' }]),
    );
    expect(s).toEqual([contato]);
  });

  it('lista vazia não consulta nada', async () => {
    const s = await withWorkspace(wsA, (tx) => contactIdentitiesRepo.suggestMerge(tx, wsA, []));
    expect(s).toEqual([]);
  });
});

describe('RLS', () => {
  it('workspace não resolve identidade de outro', async () => {
    const contato = await novoContato(wsB, 'DoB');
    await withWorkspace(wsB, (tx) =>
      contactIdentitiesRepo.attach(tx, wsB, contato, { kind: 'email', value: 'sob@b.com' }),
    );

    const deA = await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.resolve(tx, wsA, { kind: 'email', value: 'sob@b.com' }),
    );
    expect(deA).toBeNull();
  });

  it('o mesmo e-mail pode existir em workspaces diferentes', async () => {
    // Duas empresas clientes podem ter o mesmo consumidor. O único é POR workspace.
    const emA = await novoContato(wsA, 'Compartilhado');
    const emB = await novoContato(wsB, 'Compartilhado');
    await withWorkspace(wsA, (tx) =>
      contactIdentitiesRepo.attach(tx, wsA, emA, { kind: 'email', value: 'mesmo@cliente.com' }),
    );
    await withWorkspace(wsB, (tx) =>
      contactIdentitiesRepo.attach(tx, wsB, emB, { kind: 'email', value: 'mesmo@cliente.com' }),
    );

    expect(
      await withWorkspace(wsA, (tx) =>
        contactIdentitiesRepo.resolve(tx, wsA, { kind: 'email', value: 'mesmo@cliente.com' }),
      ),
    ).toBe(emA);
    expect(
      await withWorkspace(wsB, (tx) =>
        contactIdentitiesRepo.resolve(tx, wsB, { kind: 'email', value: 'mesmo@cliente.com' }),
      ),
    ).toBe(emB);
  });

  it('escrita cross-workspace é barrada', async () => {
    const contato = await novoContato(wsA, 'Alvo');
    const erro = await withWorkspace(wsB, (tx) =>
      tx.insert(contactIdentities).values({
        workspaceId: wsA,
        contactId: contato,
        kind: 'email',
        value: 'invasor@x.com',
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).not.toBeNull();
  });
});
