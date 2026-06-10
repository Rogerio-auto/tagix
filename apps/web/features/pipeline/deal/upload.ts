/** Helpers de upload de anexo de deal (F5-S10, PIPELINE.md §5.2). */

/** SHA-256 hex de um Blob via WebCrypto (subtle). Browser-only. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** PUT direto do blob para a signed URL do storage (§5.2 passo 2). */
export async function uploadToSignedUrl(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) throw new Error(`Falha no upload (${res.status}).`);
}
