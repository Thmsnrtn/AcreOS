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
import { and, eq, gte, isNull, like, sql } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, apiKeyUsage, organizations, type Organization } from "@shared/schema";
import { Errors } from "../utils/errors";
import { hashApiKey, verifyHash } from "../services/apiKeys";
import { mcpEndpointDark, mcpOrgAllowed, parseOrgAllowlist } from "./auth";
import { isWrappedUntrusted, unwrapUntrusted } from "../ai/untrustedEnvelope";
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
// Application-level: org exceeded the shared tool-call budget.
const MCP_RATE_LIMITED = -32002;
// JSON-RPC batch size cap (see the handler's batch guard).
const MAX_BATCH_MESSAGES = 20;

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
  /** api_keys.id — receipts in api_key_usage are keyed to it. */
  keyId: number;
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

    return { organization: org, scopes: Array.isArray(row.scopes) ? row.scopes : [], keyId: row.id };
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

/**
 * Strip the internal untrusted-envelope markers before data leaves for an
 * EXTERNAL MCP client. The envelope exists to protect OUR model loops; an
 * external agent gets its org's own data back without our marker framing
 * (audit P-2 / Wave 0.6). Honest limits: sanitizer effects INSIDE the
 * envelope (8K truncation, injection-phrase redaction, edge trimming) are
 * not reversible — external content is post-sanitization; and only a
 * ROOT-position wrapped value is JSON-restored to an object (nested
 * wholesale wraps, e.g. `enrichment`, arrive as JSON text — the safe
 * direction, since parsing nested keyed free-text fields would flip a
 * note's type from string to object whenever a customer typed JSON).
 */
function externalizeToolData(value: unknown, root = true): unknown {
  if (typeof value === "string" && isWrappedUntrusted(value)) {
    const inner = unwrapUntrusted(value);
    // JSON-restore ONLY the root position — that is the wholesale-wrap shape
    // (wrapUntrustedJson replaced the whole `data` object). A NESTED wrapped
    // string is a keyed free-text field (a note, a file name); parsing one
    // whose content happens to be JSON would silently change its external
    // type from string to object.
    if (root) {
      const trimmed = inner.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return JSON.parse(trimmed);
        } catch {
          /* truncated or non-JSON — return the bare text */
        }
      }
    }
    return inner;
  }
  if (Array.isArray(value)) return value.map((v) => externalizeToolData(v, false));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        externalizeToolData(v, false),
      ]),
    );
  }
  return value;
}

/** Wrap an intent's data payload in the MCP CallToolResult shape. */
function toolTextResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(externalizeToolData(data), null, 2) }],
    isError,
  };
}

// ─── Rate limiting (audit §8.2 / Wave 0.7) ───────────────────────────────────
// Availability policy (kill switch / org allowlist) lives in ./auth so BOTH
// MCP surfaces (/api/mcp here and the /mcp mount in server/index.ts) share it.

/** Receipt path prefix — distinguishes MCP tool calls from /api/v1 rows. */
const MCP_USAGE_PATH_PREFIX = "/api/mcp#";

/**
 * Shared-store rate limit for tools/call, replacing the retired legacy
 * endpoint's in-memory Map (which reset per-machine on the 2-node deploy and
 * grew without cleanup). The store is api_key_usage — the surface's NATIVE
 * usage ledger, already written per-request by requireApiKey for /api/v1,
 * machine-native (no behavioral-analytics consumer assumes its rows are
 * human actions — the 0.7 audit caught that activity_log receipts would
 * have polluted the customer feed and defeated re-engagement/churn
 * signals), and indexed on (organization_id, created_at). Each allowed
 * call inserts a receipt keyed to the api key; the check counts MCP
 * receipts in the trailing hour. The check-then-insert pair is not atomic,
 * so the cap is a firm budget with small possible overshoot under
 * concurrent requests — acceptable for an abuse brake, and unlike the
 * retired Map the count is shared by every machine. Fails OPEN when the
 * store is unreachable: the tool call would hit the same DB and fail
 * anyway, and availability beats a hard-closed limiter for a read-mostly
 * surface.
 */
async function consumeSharedRateLimit(
  orgId: number,
  keyId: number,
  tool: string,
): Promise<{ allowed: boolean; limit: number }> {
  // Explicit "0" or "off" disables the cap (founder control); anything else
  // unparseable falls back to the default.
  const raw = (process.env.MCP_RATE_LIMIT_PER_HOUR ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "off") return { allowed: true, limit: 0 };
  const parsed = Number.parseInt(raw, 10);
  const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKeyUsage)
      .where(
        and(
          eq(apiKeyUsage.organizationId, orgId),
          like(apiKeyUsage.path, `${MCP_USAGE_PATH_PREFIX}%`),
          gte(apiKeyUsage.createdAt, windowStart),
        ),
      );
    if ((row?.count ?? 0) >= limit) return { allowed: false, limit };
    await db.insert(apiKeyUsage).values({
      apiKeyId: keyId,
      organizationId: orgId,
      method: "POST",
      path: `${MCP_USAGE_PATH_PREFIX}${tool}`.slice(0, 255),
      statusCode: 200,
      durationMs: 0,
    });
    return { allowed: true, limit };
  } catch (err) {
    logger.warn("[mcp] shared rate-limit store unreachable — allowing call", {
      metadata: { orgId, error: err instanceof Error ? err.message : String(err) },
    });
    return { allowed: true, limit };
  }
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

  // Shared-store budget + usage-ledger receipt, checked only once the call
  // is otherwise authorized (unknown/forbidden tools never consume budget).
  const rate = await consumeSharedRateLimit(key.organization.id, key.keyId, name);
  if (!rate.allowed) {
    return rpcError(
      id,
      MCP_RATE_LIMITED,
      `Rate limit exceeded: ${rate.limit} tool calls per hour per organization.`,
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
  // 0. Founder availability controls (audit §8.2 / Wave 0.7), shared with
  //    the /mcp mount via ./auth: a kill switch that darkens the endpoint
  //    (the app's standard 404 shape — a determined prober can fingerprint
  //    it, but no auth oracle runs and no capability is reachable) and an
  //    org allowlist that narrows it. Env-driven so the founder can flip
  //    without a deploy; defaults preserve current behavior. The flip
  //    decision itself is in the founder approval queue, not made here.
  if (mcpEndpointDark()) {
    Errors.notFound(res, "Endpoint");
    return;
  }

  // 1. Authenticate (transport level → real HTTP 401).
  const key = await authenticate(req);
  if (!key) {
    res
      .status(401)
      .json({ error: "UNAUTHORIZED", message: "Valid Bearer API key required.", statusCode: 401 });
    return;
  }

  // 1b. Per-org allowlist (post-auth: the org is derived from the key).
  if (!mcpOrgAllowed(key.organization.id)) {
    Errors.forbidden(res, "This organization is not enabled for the MCP endpoint.");
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
  // Batch cap: the 1MB body limit would otherwise admit ~17k tools/call
  // messages, each driving a rate-limit COUNT round-trip — the limiter's
  // own enforcement path must not be the amplifier (0.7 audit).
  if (isBatch && messages.length > MAX_BATCH_MESSAGES) {
    res
      .status(400)
      .json(
        rpcError(
          null,
          JSONRPC_INVALID_REQUEST,
          `Batch too large: max ${MAX_BATCH_MESSAGES} messages per request`,
        ),
      );
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
  MCP_RATE_LIMITED,
  JSONRPC_METHOD_NOT_FOUND,
  externalizeToolData,
  consumeSharedRateLimit,
  parseOrgAllowlist,
};

// Reference unused JSON-RPC codes so tsc doesn't flag them while keeping the
// full code table documented at the top of the file for future methods.
void JSONRPC_PARSE_ERROR;
