'use client';

/**
 * Placeholder honesto de uma seção de settings ainda não preenchida por um sub-slot
 * (F8-S04/S06/S07/S08). NÃO simula UI: deixa claro que a seção será entregue, para
 * não passar como "pronto" o que ainda não está. Os sub-slots trocam o loader desta
 * seção no registry pelo componente real.
 */
export function SectionStub({ sectionId, title }: { sectionId: string; title: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-8">
      <h3 className="font-head text-text">{title}</h3>
      <p className="mt-2 font-body text-sm text-text-low">
        Esta seção será entregue em um slot dedicado da F8 (<code>{sectionId}</code>).
      </p>
    </div>
  );
}
