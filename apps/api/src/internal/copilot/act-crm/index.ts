/**
 * Ferramentas do Copiloto · ações de CRM (propose_*: tags, contato, responsável, mover, nota,
 * compromisso) — dono: F73-S08.
 *
 * Toda escrita nasce de `makeProposeTool` sobre o executor completo (o motor classifica,
 * autoriza, confirma, executa item a item e desfaz; ADR-004). Os executores também entram em
 * `executors`, que `../index.ts` compõe em `COPILOT_EXECUTORS` (o confirmar de produção acha a
 * capacidade por ali).
 *
 *   propose_tag_contacts    contact.tag             tag-contacts.ts
 *   propose_update_contact  contact.update          update-contact.ts
 *   propose_assign_deals    deal.assign_owner       assign-deals.ts
 *   propose_move_deals      deal.move               move-deals.ts (+ stage-effects.ts)
 *   propose_add_note        conversation.note       add-note.ts
 *   propose_create_event    event.create_internal   create-event.ts
 */
import type { CopilotToolDefinition } from '../core/registry';
import type { CapabilityExecutor } from '../core/executor-types';
import { makeProposeTool } from '../../../services/copilot/proposals';
import { ADD_NOTE_TOOL_DESCRIPTION, addNoteExecutor } from './add-note';
import { ASSIGN_DEALS_TOOL_DESCRIPTION, assignDealsExecutor } from './assign-deals';
import { CREATE_EVENT_TOOL_DESCRIPTION, createEventExecutor } from './create-event';
import { MOVE_DEALS_TOOL_DESCRIPTION, moveDealsExecutor } from './move-deals';
import { TAG_CONTACTS_TOOL_DESCRIPTION, tagContactsExecutor } from './tag-contacts';
import { UPDATE_CONTACT_TOOL_DESCRIPTION, updateContactExecutor } from './update-contact';

/** Chaves das ferramentas desta área (o modelo as vê com estes nomes). */
export const ACT_CRM_TOOL_KEYS = {
  tagContacts: 'propose_tag_contacts',
  updateContact: 'propose_update_contact',
  assignDeals: 'propose_assign_deals',
  moveDeals: 'propose_move_deals',
  addNote: 'propose_add_note',
  createEvent: 'propose_create_event',
} as const;

export const tools: readonly CopilotToolDefinition[] = [
  makeProposeTool(tagContactsExecutor, {
    key: ACT_CRM_TOOL_KEYS.tagContacts,
    description: TAG_CONTACTS_TOOL_DESCRIPTION,
  }),
  makeProposeTool(updateContactExecutor, {
    key: ACT_CRM_TOOL_KEYS.updateContact,
    description: UPDATE_CONTACT_TOOL_DESCRIPTION,
  }),
  makeProposeTool(assignDealsExecutor, {
    key: ACT_CRM_TOOL_KEYS.assignDeals,
    description: ASSIGN_DEALS_TOOL_DESCRIPTION,
  }),
  makeProposeTool(moveDealsExecutor, {
    key: ACT_CRM_TOOL_KEYS.moveDeals,
    description: MOVE_DEALS_TOOL_DESCRIPTION,
  }),
  makeProposeTool(addNoteExecutor, {
    key: ACT_CRM_TOOL_KEYS.addNote,
    description: ADD_NOTE_TOOL_DESCRIPTION,
  }),
  makeProposeTool(createEventExecutor, {
    key: ACT_CRM_TOOL_KEYS.createEvent,
    description: CREATE_EVENT_TOOL_DESCRIPTION,
  }),
];

/** Executores das capacidades de escrita desta área (motor de propostas, F73-S05). */
export const executors: readonly CapabilityExecutor[] = [
  tagContactsExecutor,
  updateContactExecutor,
  assignDealsExecutor,
  moveDealsExecutor,
  addNoteExecutor,
  createEventExecutor,
];

export { addNoteExecutor, AddNoteArgsSchema, type AddNoteArgs } from './add-note';
export { assignDealsExecutor, AssignDealsArgsSchema, type AssignDealsArgs } from './assign-deals';
export { createEventExecutor, CreateEventArgsSchema, type CreateEventArgs } from './create-event';
export { moveDealsExecutor, MoveDealsArgsSchema, type MoveDealsArgs } from './move-deals';
export { tagContactsExecutor, TagContactsArgsSchema, type TagContactsArgs } from './tag-contacts';
export {
  updateContactExecutor,
  UpdateContactArgsSchema,
  type UpdateContactArgs,
} from './update-contact';
export { stageEffects, EXTERNAL_AUTOMATION_ACTIONS } from './stage-effects';
