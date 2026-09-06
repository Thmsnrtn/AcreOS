import { z } from 'zod';
// CLIENT-SAFE IMPORTS ONLY. This module is imported by three client hooks
// (use-leads, use-properties, use-notes), so anything it pulls in ships in the
// browser. `./schema` is a barrel over 84 drizzle modules whose column chains no
// bundler can prove pure — one VALUE import from it drags all 541 table
// definitions into the entry chunk.
//
// The four table objects below are used ONLY inside `z.custom<typeof
// X.$inferSelect>()`, which is a pure TYPE position, so `import type` erases
// them entirely. The four zod schemas are used as VALUES (.omit/.partial/as an
// `input`), so they come from shared/forms/* — plain zod, pinned against
// drizzle-zod by clientFormSchemasMatchDrizzle.test.ts.
import { insertLeadSchema } from './forms/lead';
import { insertPropertySchema } from './forms/property';
import { insertNoteSchema } from './forms/note';
import { insertAgentTaskSchema } from './forms/agent-task';
import type { leads, properties, notes, agentTasks } from './schema';

export const createAgentTaskInputSchema = insertAgentTaskSchema.omit({ organizationId: true });

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  leads: {
    list: {
      method: 'GET' as const,
      path: '/api/leads',
      responses: {
        200: z.array(z.custom<typeof leads.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/leads',
      input: insertLeadSchema,
      responses: {
        201: z.custom<typeof leads.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/leads/:id',
      responses: {
        200: z.custom<typeof leads.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/leads/:id',
      input: insertLeadSchema.partial(),
      responses: {
        200: z.custom<typeof leads.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  properties: {
    list: {
      method: 'GET' as const,
      path: '/api/properties',
      responses: {
        200: z.array(z.custom<typeof properties.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/properties',
      input: insertPropertySchema,
      responses: {
        201: z.custom<typeof properties.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/properties/:id',
      responses: {
        200: z.custom<typeof properties.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  notes: {
    list: {
      method: 'GET' as const,
      path: '/api/notes',
      responses: {
        200: z.array(z.custom<typeof notes.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/notes',
      input: insertNoteSchema,
      responses: {
        201: z.custom<typeof notes.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  agentTasks: {
    list: {
      method: 'GET' as const,
      path: '/api/agents/tasks',
      responses: {
        200: z.array(z.custom<typeof agentTasks.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/agents/tasks',
      input: createAgentTaskInputSchema,
      responses: {
        201: z.custom<typeof agentTasks.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
};

export type InsertNote = z.infer<typeof insertNoteSchema>;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type CreateAgentTaskInput = z.infer<typeof createAgentTaskInputSchema>;

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
