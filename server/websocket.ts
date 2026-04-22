/**
 * AcreOS WebSocket Server
 *
 * Real-time event broadcasting for:
 * - Market alerts (price shifts, new deals, rate changes)
 * - Deal Hunter matches
 * - Marketplace bids/offers
 * - Negotiation updates
 * - Team notifications
 * - System alerts
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import crypto from 'crypto';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { logger } from "./utils/logger";

/** Inline cookie parser — avoids requiring @types/cookie. */
function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    result[pair.slice(0, idx).trim()] = decodeURIComponent(
      pair.slice(idx + 1).trim().replace(/\+/g, ' ')
    );
  }
  return result;
}

/**
 * Validate a WebSocket upgrade request by verifying the session cookie.
 * Returns true if the Clerk __session JWT is valid and maps to
 * claimedUserId (our internal users.id, not the Clerk user id).
 * T-WS-AUTH: WebSocket connections must prove a valid server-side session.
 *
 * Previously this checked express-session + Passport (sess.passport.user).
 * The app migrated to Clerk in cycle 3 but this validator was missed,
 * which meant every WebSocket upgrade was rejected with 4003 and live
 * features silently fell back to polling. Now the __session JWT is
 * verified with CLERK_JWT_KEY (same flow as hydrateUser's fallback) and
 * the JWT's `sub` is mapped to our users table to compare against the
 * claimed id.
 */
async function validateWsSession(
  req: IncomingMessage,
  claimedUserId: number,
): Promise<boolean> {
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookies = parseCookies(cookieHeader);
    const sessionCookie = cookies['__session'];
    const jwtKey = process.env.CLERK_JWT_KEY;
    if (!sessionCookie || !jwtKey) return false;

    const [headerB64, payloadB64, sigB64] = sessionCookie.split('.');
    if (!headerB64 || !payloadB64 || !sigB64) return false;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(headerB64 + '.' + payloadB64);
    if (!verifier.verify(jwtKey, sigB64, 'base64url')) return false;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const GRACE_PERIOD_MS = 30 * 1000;
    if (!payload.sub || payload.exp * 1000 <= Date.now() - GRACE_PERIOD_MS) return false;

    // Map Clerk user id → our internal users.id and compare to what the
    // client claimed. Prevents a stolen cookie from authenticating as
    // another org's user by passing their id in the querystring.
    const result = await db.execute<{ id: number }>(
      sql`SELECT id FROM users WHERE clerk_user_id = ${payload.sub} LIMIT 1`
    );
    const row = (result as any)?.rows?.[0];
    if (!row) return false;

    return String(row.id) === String(claimedUserId);
  } catch {
    return false;
  }
}

interface WSClient {
  id: string;
  ws: WebSocket;
  organizationId: number;
  userId: number;
  subscribedChannels: Set<string>;
  lastPing: number;
}

interface WSEvent {
  type: string;
  channel: string;
  payload: Record<string, any>;
  timestamp: string;
}

// Channel naming conventions:
// org:{orgId}                 — org-wide events
// user:{userId}               — user-specific events
// deal:{dealId}               — deal-specific updates
// listing:{listingId}         — marketplace listing updates
// negotiation:{sessionId}     — negotiation real-time coaching
// market:{state}:{county}     — market intelligence for a county

// Maximum simultaneous WebSocket connections per server instance.
// Prevents connection exhaustion DoS. Fly.io scales horizontally so
// the effective global limit = MAX_WS_CONNECTIONS × replica count.
const MAX_WS_CONNECTIONS = parseInt(process.env.MAX_WS_CONNECTIONS ?? "1000", 10);

class AcreOSWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  initialize(httpServer: Server): void {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Ping clients every 30 seconds to keep connections alive
    this.pingInterval = setInterval(() => this.pingClients(), 30_000);

    logger.info('[WebSocket] Server initialized on /ws');
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const clientId = crypto.randomUUID();

    // Extract claimed identity from query params (?orgId=X&userId=Y)
    const url = new URL(req.url || '/', 'http://localhost');
    const organizationId = parseInt(url.searchParams.get('orgId') || '0');
    const userId = parseInt(url.searchParams.get('userId') || '0');

    if (!organizationId || !userId) {
      ws.close(4001, 'Missing orgId or userId');
      return;
    }

    // Connection cap — reject if server is at max capacity
    if (this.clients.size >= MAX_WS_CONNECTIONS) {
      ws.close(4008, 'Server at capacity');
      return;
    }

    // T-WS-AUTH: Verify the session cookie before accepting the connection
    const sessionValid = await validateWsSession(req, userId);
    if (!sessionValid) {
      ws.close(4003, 'Invalid or expired session');
      return;
    }

    const client: WSClient = {
      id: clientId,
      ws,
      organizationId,
      userId,
      subscribedChannels: new Set([
        `org:${organizationId}`,
        `user:${userId}`,
      ]),
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);

    // Send connection confirmation
    this.sendToClient(client, {
      type: 'connected',
      channel: 'system',
      payload: { clientId, message: 'Real-time connection established' },
      timestamp: new Date().toISOString(),
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleClientMessage(client, msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('pong', () => {
      client.lastPing = Date.now();
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    ws.on('error', () => {
      this.clients.delete(clientId);
    });
  }

  private handleClientMessage(client: WSClient, msg: any): void {
    switch (msg.type) {
      case 'subscribe':
        if (msg.channel && this.isAllowedChannel(client, msg.channel)) {
          client.subscribedChannels.add(msg.channel);
          this.sendToClient(client, {
            type: 'subscribed',
            channel: msg.channel,
            payload: { channel: msg.channel },
            timestamp: new Date().toISOString(),
          });
        }
        break;

      case 'unsubscribe':
        client.subscribedChannels.delete(msg.channel);
        break;

      case 'ping':
        this.sendToClient(client, {
          type: 'pong',
          channel: 'system',
          payload: {},
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  // Only allow subscribing to channels scoped to the client's own org/user
  private isAllowedChannel(client: WSClient, channel: string): boolean {
    if (channel.startsWith(`org:${client.organizationId}`)) return true;
    if (channel.startsWith(`user:${client.userId}`)) return true;
    // Entity channels must be org-scoped to prevent cross-org data leakage
    const orgPrefix = `${client.organizationId}:`;
    if (channel.startsWith(`deal:${orgPrefix}`)) return true;
    if (channel.startsWith(`listing:${orgPrefix}`)) return true;
    if (channel.startsWith(`negotiation:${orgPrefix}`)) return true;
    // Market channels are public (no org-specific data)
    if (channel.startsWith('market:')) return true;
    // Founder activity only for founder orgs
    if (channel === 'founder:activity') return true;
    return false;
  }

  private sendToClient(client: WSClient, event: WSEvent): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(event));
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  private pingClients(): void {
    const now = Date.now();
    for (const [id, client] of this.clients) {
      // Remove clients that haven't responded to ping in 90 seconds
      if (now - client.lastPing > 90_000) {
        client.ws.terminate();
        this.clients.delete(id);
        continue;
      }
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    }
  }

  /**
   * Broadcast an event to all clients subscribed to a channel.
   */
  broadcast(channel: string, type: string, payload: Record<string, any>): void {
    const event: WSEvent = {
      type,
      channel,
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const client of this.clients.values()) {
      if (client.subscribedChannels.has(channel)) {
        this.sendToClient(client, event);
      }
    }
  }

  /**
   * Send an event to all clients of a specific organization.
   */
  broadcastToOrg(organizationId: number, type: string, payload: Record<string, any>): void {
    this.broadcast(`org:${organizationId}`, type, payload);
  }

  /**
   * Send an event to a specific user.
   */
  sendToUser(userId: number, type: string, payload: Record<string, any>): void {
    this.broadcast(`user:${userId}`, type, payload);
  }

  /**
   * Broadcast a market alert to all orgs watching a county.
   */
  broadcastMarketAlert(state: string, county: string, alert: Record<string, any>): void {
    this.broadcast(`market:${state}:${county}`, 'market_alert', alert);
  }

  /**
   * Broadcast a negotiation update to parties in a session.
   */
  broadcastNegotiationUpdate(sessionId: number, update: Record<string, any>): void {
    this.broadcast(`negotiation:${sessionId}`, 'negotiation_update', update);
  }

  /**
   * Broadcast a marketplace event (new bid, offer accepted, etc.).
   */
  broadcastListingEvent(listingId: number, type: string, payload: Record<string, any>): void {
    this.broadcast(`listing:${listingId}`, type, payload);
  }

  /**
   * Broadcast a founder notification (briefing, agent event, approval request).
   * Phase C: Pushes to founder:activity channel for real-time dashboard updates.
   */
  broadcastFounderEvent(type: string, payload: Record<string, any>): void {
    this.broadcast('founder:activity', type, payload);
  }

  /**
   * Broadcast an agent collaboration event.
   * Phase E: Inter-agent messages, delegations, consensus updates.
   */
  broadcastAgentEvent(organizationId: number, type: string, payload: Record<string, any>): void {
    this.broadcast(`org:${organizationId}`, `agent:${type}`, payload);
    this.broadcast('founder:activity', `agent:${type}`, payload);
  }

  getConnectionCount(): number {
    return this.clients.size;
  }

  getConnectionsForOrg(organizationId: number): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.organizationId === organizationId) count++;
    }
    return count;
  }

  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss?.close();
  }
}

export const wsServer = new AcreOSWebSocketServer();
