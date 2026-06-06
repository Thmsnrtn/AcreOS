/**
 * Minimal, zero-dependency Zod → JSON-Schema converter.
 *
 * Covers the shapes our LLM tool/intent schemas actually use: z.object with
 * primitive / enum / number / string / boolean / array fields, z.union of
 * primitives, and z.optional / z.default wrappers. Field `.describe()` text is
 * carried through as JSON-Schema `description`.
 *
 * This is shared by:
 *   - The App Intent registry (server/services/appIntents) — single source of
 *     truth for Pax tool-use, the command palette, and external agents.
 *   - The founder Atlas chat tool inventory (server/routes-founder-chat.ts).
 *
 * It is deliberately NOT a full JSON-Schema implementation — just enough for
 * OpenRouter/OpenAI `function.parameters` and Anthropic `input_schema`.
 */
import type { z } from "zod";

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def: any = (schema as any)?._def;
  if (!def) return { type: "object", properties: {} };

  // zod v4 stores the kind on `def.type`; v3 on `def.typeName`. Support both.
  const kind: string = def.typeName ?? def.type ?? "";
  // `.describe()` lands on `_def.description` (v3) or `.meta().description` (v4).
  const meta =
    typeof (schema as any)?.meta === "function" ? (schema as any).meta() : undefined;
  const description: string | undefined = def.description ?? meta?.description;

  const withDescription = (node: Record<string, unknown>): Record<string, unknown> =>
    description ? { ...node, description } : node;

  switch (kind) {
    case "ZodObject":
    case "object": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape ?? {})) {
        const childSchema = v as z.ZodTypeAny;
        const childDef = (childSchema as any)._def;
        const childKind = childDef?.typeName ?? childDef?.type ?? "";
        properties[k] = zodToJsonSchema(childSchema);
        if (
          childKind !== "ZodOptional" &&
          childKind !== "optional" &&
          childKind !== "ZodDefault" &&
          childKind !== "default"
        ) {
          required.push(k);
        }
      }
      const node: Record<string, unknown> = { type: "object", properties };
      if (required.length > 0) node.required = required;
      return withDescription(node);
    }
    case "ZodString":
    case "string":
      return withDescription({ type: "string" });
    case "ZodNumber":
    case "number":
      return withDescription({ type: "number" });
    case "ZodBoolean":
    case "boolean":
      return withDescription({ type: "boolean" });
    case "ZodEnum":
    case "enum": {
      // zod v3: def.values (array); zod v4: def.entries (object) or def.values
      const values =
        def.values ?? (def.entries ? Object.values(def.entries) : undefined) ?? [];
      return withDescription({ type: "string", enum: values });
    }
    case "ZodArray":
    case "array": {
      // v4: def.element; v3: def.type (the element schema) / def.valueType.
      const element = def.element ?? def.valueType ?? def.type;
      const elementIsSchema = element && typeof (element as any)?._def === "object";
      return withDescription({
        type: "array",
        items: elementIsSchema ? zodToJsonSchema(element as z.ZodTypeAny) : { type: "string" },
      });
    }
    case "ZodOptional":
    case "optional":
    case "ZodDefault":
    case "default":
      return zodToJsonSchema((def.innerType ?? def.inner) as z.ZodTypeAny);
    case "ZodUnion":
    case "union": {
      const options = def.options ?? [];
      return withDescription({
        anyOf: options.map((o: z.ZodTypeAny) => zodToJsonSchema(o)),
      });
    }
    case "ZodRecord":
    case "record":
      return withDescription({ type: "object" });
    default:
      return withDescription({ type: "string" });
  }
}
