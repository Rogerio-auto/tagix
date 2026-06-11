/** Seções de dados do workspace (F8-S08): tags + auditoria. As seções de features
 *  já construídas (canais/agentes/KB/pipeline/conversões) entram no SectionRegistry
 *  do shell (S05) como deep-links (externalHref), não como componentes daqui. */
export { default as TagsManager } from './TagsManager';
export { default as AuditLogViewer } from './AuditLogViewer';
