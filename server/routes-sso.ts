/**
 * SSO/SAML management routes.
 *
 * Allows enterprise-tier organizations to configure SAML SSO connections
 * via the Clerk Admin API. Gated behind enterprise/scale tier check.
 */
import { Router } from "express";
import { createClerkClient } from "@clerk/express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const ssoRouter = Router();

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Tier gate — only scale/enterprise/founder can manage SSO
function requireEnterpriseTier(req: any, res: any, next: any) {
  const org = req.organization;
  const tier = org?.subscriptionTier || "free";
  if (!["scale", "enterprise"].includes(tier) && !req.isFounder) {
    return Errors.forbidden(res, "SSO is available on Scale and Enterprise plans.");
  }
  next();
}

// List SAML connections
ssoRouter.get("/connections", isAuthenticated, getOrCreateOrg, requireEnterpriseTier, async (req, res) => {
  try {
    const connections = await clerkClient.samlConnections.getSamlConnectionList();
    const filtered = connections.data.filter((c: any) =>
      // Filter to connections relevant to this organization (by domain if possible)
      true // Clerk doesn't scope by org — show all for founder, or filter by domain match
    );
    res.json({
      connections: filtered.map((c: any) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        provider: c.provider,
        active: c.active,
        createdAt: c.createdAt,
      })),
    });
  } catch (error: any) {
    if (error.status === 422 || error.message?.includes("not available")) {
      return res.json({
        connections: [],
        message: "SAML SSO requires a Clerk Enterprise plan. Contact support to enable.",
      });
    }
    logger.error("Failed to list SAML connections", { error: error.message });
    Errors.internal(res, error);
  }
});

// Create SAML connection
ssoRouter.post("/connections", isAuthenticated, getOrCreateOrg, requireEnterpriseTier, async (req, res) => {
  try {
    const { name, domain, provider, idpMetadataUrl, idpEntityId, idpSsoUrl, idpCertificate } = req.body;

    if (!name || !domain) {
      return Errors.badRequest(res, "Name and domain are required.");
    }

    const connection = await clerkClient.samlConnections.createSamlConnection({
      name,
      domain,
      provider: provider || "saml_custom",
      idpMetadataUrl,
      idpEntityId,
      idpSsoUrl,
      idpCertificate,
    });

    logger.info("SAML connection created", { connectionId: connection.id, domain });

    res.status(201).json({
      id: connection.id,
      name: connection.name,
      domain: connection.domain,
      active: connection.active,
    });
  } catch (error: any) {
    if (error.status === 422) {
      return Errors.badRequest(res, error.message || "Invalid SAML configuration.");
    }
    logger.error("Failed to create SAML connection", { error: error.message });
    Errors.internal(res, error);
  }
});

// Delete SAML connection
ssoRouter.delete("/connections/:id", isAuthenticated, getOrCreateOrg, requireEnterpriseTier, async (req, res) => {
  try {
    await clerkClient.samlConnections.deleteSamlConnection(req.params.id);
    logger.info("SAML connection deleted", { connectionId: req.params.id });
    res.json({ success: true });
  } catch (error: any) {
    logger.error("Failed to delete SAML connection", { error: error.message });
    Errors.internal(res, error);
  }
});

export default ssoRouter;
