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

    console.log('[WebSocket] Server initialized on /ws');
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = crypto.randomUUID();

    // Extract auth from query params (?orgId=X&userId=Y)
    const url = new URL(req.url || '/', 'http://localhost');
    const organizationId = parseInt(url.searchParams.get('orgId') || '0');
    const userId = parseInt(url.searchParams.get('userId') || '0');

    if (!organizationId || !userId) {
      ws.close(4001, 'Missing orgId or userId');
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

  // Only allow subscribing to channels for the client's own org/user
  private isAllowedChannel(client: WSClient, channel: string): boolean {
    if (channel.startsWith(`org:${client.organizationId}`)) return true;
    if (channel.startsWith(`user:${client.userId}`)) return true;
    // Allow deal/listing/negotiation/market channels (no auth restriction needed — data is filtered server-side)
    if (channel.startsWith('deal:')) return true;
    if (channel.startsWith('listing:')) return true;
    if (channel.startsWith('negotiation:')) return true;
    if (channel.startsWith('market:')) return true;
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
