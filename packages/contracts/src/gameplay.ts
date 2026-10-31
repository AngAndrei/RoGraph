import { z } from "zod";
export const gameplayRelationSchema = z.object({
  label: z.string(),
  method: z.string(),
  sourceScriptId: z.string(),
  ownerId: z.string().optional(),
  ownerLabel: z.string().optional(),
  handlerId: z.string().optional(),
  reachableOwnerIds: z.array(z.string()).max(256).optional(),
  scopeIncomplete: z.boolean().optional(),
  configInputs: z
    .array(
      z.object({
        fieldId: z.string(),
        sourceId: z.string(),
        path: z.string(),
        span: z.object({
          startByte: z.number(),
          endByte: z.number(),
          startLine: z.number(),
          endLine: z.number(),
          startColumn: z.number(),
          endColumn: z.number(),
        }),
      }),
    )
    .optional(),
  supportSiteIds: z.array(z.string()).min(1),
  guards: z.array(z.string()),
  conditional: z.boolean(),
  allocationId: z.string().optional(),
  templateId: z.string().optional(),
  rolePath: z.string().optional(),
  destinationId: z.string().optional(),
  destinationRole: z.string().optional(),
  configPaths: z.array(z.string()).optional(),
  rule: z.string(),
  version: z.literal("1"),
});
export type GameplayRelation = z.infer<typeof gameplayRelationSchema>;
export { gameplayTypes } from "./relation-names.js";
