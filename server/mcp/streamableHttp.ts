/**
 * Tahoe E12 — AcreOS as an MCP server (Streamable HTTP transport).
 *
 * Implements a focused subset of the Model Context Protocol over JSON-RPC 2.0
 * on a single HTTP endpoint: POST /api/mcp. This makes AcreOS a tool callable
 * by OTHER AI agents (agentic-web prep).
 *
 * Why a hand-rolled JSON-RPC handler rather than the @modelcontextprotocol/sdk
 * McpServer: the SDK's server surface is built around the stdio / SSE
 * transports and a per-connection session lifecycle. Our requirement is a
 * stateless, org-scoped, bearer-authenticated HTTP POST where the org (and its
 * allowed tools) is derived FROM the API key on every request — never passed
 * as a tool argument. A small focused handler expresses exactly that and keeps
 * the security boundary obvious. (The existing stdio server in
 * server/mcp/index.ts remains for Claude Desktop / local use; that one takes
 * organizationId as a tool param and is NOT exposed publicly.)
 *
 * Methods implemented (the MCP handshake + tool surface):
 *   - initialize          → protocol/capabilities handshake
 *   - notifications/initialized (notification, no response)
 *   - ping                → liveness
 *   - tools/list          → the SAFE external subset of the App Intent registry
 *   - tools/call          → validate input, run the intent with the authed org
 *
 * Auth: Authorization: Bearer ak_live_…  — the existing public API key
 * (shared/schema/public-api.ts api_keys + server/services/apiKeys.ts). The org
 * and the key's scopes are resolved on every request. Every tool call is
 * org-scoped (the intent handler only ever sees the key's org) AND
 * permission-checked: the intent's role-Scope is mapped to the ApiScope(s) the
 * key must hold (server/mcp/safeIntents.ts). Founder-only / account-mutating
 * intents are never in the safe subset, so they are unreachable here.
 */

import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, organizations, type Organization } from "@shared/schema";
import { hashApiKey, verifyHash } from "../services/apiKeys";
import { getIntent, resolveInputSchema, type AppIntent } from "../services/appIntents";
import {
  listExternalSafeIntents,
  isExternalSafeIntent,
  keyMaySatisfyIntent,
  requiredApiScopesFor,
} from "./safeIntents";
import { logger } from "../utils/logger";

// ─── MCP / JSON-RPC constants ──────────────────────────────────────────────

/** MCP protocol revision we speak. Echoed back on initialize. */
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "acreos", version: "1.0.0" } as const;

// JSON-RPC 2.0 standard error codes.
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;
// Application-level: caller authenticated but not authorized for this tool.
const MCP_FORBIDDEN = -32001;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface AuthedKey {
  organization: Organization;
  scopes: string[];
}

// ─── Auth ───────────────────────────────────────────────────────────────────

/**
 * Resolve the API key from the Authorization header to its org + scopes.
 * Returns null on any auth failure (missing/invalid/revoked/expired). We
 * deliberately collapse all failure modes to a single null → one 401 shape,
 * so the endpoint doesn't leak which keys exist.
 */
async function authenticate(req: Request): Promise<AuthedKey | null> {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(\S+)$/);
  if (!m) return null;
  const token = m[1];
  // Format guard — only accept ak_live_/ak_test_ tokens.
  if (!/^ak_(live|test)_[A-Za-z0-9_-]{16,}$/.test(token)) return null;

  try {
    const hashed = hashApiKey(token);
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.hashedKey, hashed), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!row) return null;
    if (!verifyHash(hashed, row.hashedKey)) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, row.organizationId))
      .limit(1);
    if (!org) return null;

    return { organization: org, scopes: Array.isArray(row.scopes) ? row.scopes : [] };
  } catch (err) {
    logger.error("[mcp] api key lookup failed", err instanceof Error ? err : undefined);
    return null;
  }
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/** Wrap an intent's data payload in the MCP CallToolResult shape. */
function toolTextResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

// ─── Method handlers ──────────────────────────────────────────────────────────

function handleInitialize(id: JsonRpcId) {
  return rpcResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      // We support tools (with a static list — no listChanged notifications).
      tools: { listChanged: false },
    },
    serverInfo: SERVER_INFO,
    instructions:
      "AcreOS land-investing platform. Tools are read-mostly and scoped to the " +
      "organization that owns the API key. Tool availability also depends on the " +
      "key's granted scopes.",
  });
}

/**
 * tools/list — the SAFE external subset of the App Intent registry, projected
 * to the MCP tool shape { name, description, inputSchema }. We further filter
 * to the tools the calling key's scopes can actually invoke, so an agent only
 * sees what it can use.
 */
function handleToolsList(id: JsonRpcId, key: AuthedKey) {
  const tools = listExternalSafeIntents()
    .filter((intent) => keyMaySatisfyIntent(intent, key.scopes))
    .map((intent: AppIntent) => ({
      name: intent.name,
      description: intent.description,
      inputSchema: resolveInputSchema(intent),
    }));
  return rpcResult(id, { tools });
}

/**
 * tools/call — validate, authorize, and run one intent with the authed org.
 * The org passed to the handler is ALWAYS the key's org — never anything the
 * caller supplied — so the call is org-scoped by construction.
 */
async function handleToolsCall(
  id: JsonRpcId,
  key: AuthedKey,
  params: Record<string, unknown> | undefined,
) {
  const name = params?.name;
  const args = (params?.arguments ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || name.length === 0) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "tools/call requires a string 'name'");
  }

  const intent = getIntent(name);
  // Unknown OR outside the safe subset → treat identically (don't reveal that
  // an unsafe/founder intent exists). Method-not-found-style application error.
  if (!intent || !isExternalSafeIntent(intent)) {
    return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Unknown tool: ${name}`);
  }

  // Permission ladder: the key must hold a scope that authorizes this intent.
  if (!keyMaySatisfyIntent(intent, key.scopes)) {
    return rpcError(
      id,
      MCP_FORBIDDEN,
      `API key lacks a required scope for "${name}"`,
      { requiredAnyOf: requiredApiScopesFor(intent) },
    );
  }

  try {
    const result = await intent.handler(args, key.organization);
    if (!result.success) {
      // Intent ran but reported a domain error — surface as an MCP tool error
      // result (isError:true), not a JSON-RPC protocol error.
      return rpcResult(id, toolTextResult({ error: result.error ?? "Tool failed" }, true));
    }
    return rpcResult(id, toolTextResult(result.data ?? null));
  } catch (err) {
    logger.error(
      `[mcp] tool '${name}' threw`,
      err instanceof Error ? err : undefined,
    );
    return rpcResult(
      id,
      toolTextResult(
        { error: err instanceof Error ? err.message : "Tool execution failed" },
        true,
      ),
    );
  }
}

/** Dispatch a single JSON-RPC request object. Returns null for notifications. */
async function dispatch(
  msg: JsonRpcRequest,
  key: AuthedKey,
): Promise<ReturnType<typeof rpcResult> | ReturnType<typeof rpcError> | null> {
  const id = msg.id ?? null;

  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(id, JSONRPC_INVALID_REQUEST, "Invalid JSON-RPC request");
  }

  switch (msg.method) {
    case "initialize":
      return handleInitialize(id);
    case "notifications/initialized":
    case "notifications/cancelled":
      // Notifications have no id and expect no response.
      return null;
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return handleToolsList(id, key);
    case "tools/call":
      return await handleToolsCall(id, key, msg.params);
    default:
      return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

// ─── Express handler ──────────────────────────────────────────────────────────

/**
 * POST /api/mcp — MCP Streamable HTTP endpoint.
 *
 * Transport-level failures (missing/invalid bearer token, unparseable body)
 * return HTTP errors. Protocol-level outcomes are JSON-RPC framed with HTTP
 * 200, per the MCP Streamable HTTP transport (the response is the JSON-RPC
 * reply, or 202 with no body for a notification-only batch).
 */
export async function mcpStreamableHttpHandler(req: Request, res: Response): Promise<void> {
  // 1. Authenticate (transport level → real HTTP 401).
  const key = await authenticate(req);
  if (!key) {
    res
      .status(401)
      .json({ error: "UNAUTHORIZED", message: "Valid Bearer API key required.", statusCode: 401 });
    return;
  }

  // 2. Parse the JSON-RPC body. Support single request or a batch array.
  const body = req.body;
  if (body == null || typeof body !== "object") {
    res
      .status(400)
      .json({ error: "BAD_REQUEST", message: "Request body must be a JSON-RPC object.", statusCode: 400 });
    return;
  }

  const isBatch = Array.isArray(body);
  const messages: JsonRpcRequest[] = isBatch ? (body as JsonRpcRequest[]) : [body as JsonRpcRequest];

  if (isBatch && messages.length === 0) {
    res.status(400).json(rpcError(null, JSONRPC_INVALID_REQUEST, "Empty batch"));
    return;
  }

  try {
    const responses = [];
    for (const msg of messages) {
      const out = await dispatch(msg, key);
      if (out !== null) responses.push(out);
    }

    // Notification-only payload → 202 Accepted, no body (MCP transport spec).
    if (responses.length === 0) {
      res.status(202).end();
      return;
    }

    res.status(200).json(isBatch ? responses : responses[0]);
  } catch (err) {
    logger.error("[mcp] dispatch failed", err instanceof Error ? err : undefined);
    res
      .status(200)
      .json(rpcError(null, JSONRPC_INTERNAL_ERROR, "Internal error"));
  }
}

// Internal export for unit tests — lets the test drive dispatch() with a fake
// authed key without spinning up Express or the DB.
export const __mcpInternals = {
  dispatch,
  authenticate,
  PROTOCOL_VERSION,
  MCP_FORBIDDEN,
  JSONRPC_METHOD_NOT_FOUND,
};

// Reference unused JSON-RPC codes so tsc doesn't flag them while keeping the
// full code table documented at the top of the file for future methods.
void JSONRPC_PARSE_ERROR;
