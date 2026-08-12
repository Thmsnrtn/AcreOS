import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  organizationIntegrations,
  insertCustomFieldDefinitionSchema, insertCustomFieldValueSchema, insertSavedViewSchema,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireAdminOrAbove } from "./utils/permissions";
import { insertAbTestSchema, insertAbTestVariantSchema, Z_SCORES } from "@shared/schema";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { omitProtectedFields } from "./utils/updatePayload";

export function registerIntegrationRoutes(app: Express): void {
  const api = app;

  // ORGANIZATION INTEGRATIONS MANAGEMENT
  // ============================================
  
  api.get("/api/integrations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const integrations = await storage.getOrganizationIntegrations(org.id);
      
      const { maskApiKey } = await import('./services/fieldEncryption');
      const { readIntegrationCredentials } = await import('./services/integrationCredentials');

      const masked = integrations.map(i => {
        // Either stored shape. Keyed on `.encrypted` alone, this reported "not
        // configured" for every key saved through the BYOK panel in Settings.
        const creds = readIntegrationCredentials<{ apiKey?: string }>(i, org.id, i.provider);
        const apiKey = creds?.apiKey;
        // An envelope we cannot open is still a configured key; saying "not
        // configured" would be false. Shown as configured but unreadable.
        const unreadable = !!(i.credentials as { encrypted?: string } | null)?.encrypted && !creds;
        return {
          ...i,
          credentials: apiKey || unreadable ? {
            hasApiKey: true,
            maskedKey: apiKey ? maskApiKey(apiKey) : '****',
          } : null,
        };
      });
      
      res.json(masked);
    } catch (err: any) {
      logger.error("Get integrations error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.get("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { provider } = req.params;
      
      const integration = await storage.getOrganizationIntegration(org.id, provider);
      
      if (!integration) {
        return res.json({ provider, isEnabled: false, isConfigured: false });
      }
      
      const { maskApiKey } = await import('./services/fieldEncryption');
      const { readIntegrationCredentials } = await import('./services/integrationCredentials');

      const creds = readIntegrationCredentials<{ apiKey?: string }>(integration, org.id, provider);
      const apiKey = creds?.apiKey;
      const unreadable =
        !!(integration.credentials as { encrypted?: string } | null)?.encrypted && !creds;

      res.json({
        ...integration,
        isConfigured: !!apiKey || unreadable,
        credentials: apiKey || unreadable ? {
          hasApiKey: true,
          maskedKey: apiKey ? maskApiKey(apiKey) : '****',
        } : null,
      });
    } catch (err: any) {
      logger.error("Get integration error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.post("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { provider } = req.params;
      const { apiKey, settings } = req.body;

      if (!apiKey) {
        return Errors.badRequest(res, "API key is required");
      }

      const validProviders = ['sendgrid', 'twilio', 'lob', 'regrid', 'rapidapi'];
      if (!validProviders.includes(provider)) {
        return Errors.badRequest(res, `Invalid provider. Must be one of: ${validProviders.join(', ')}`);
      }

      const { sealIntegrationCredentials } = await import('./services/integrationCredentials');

      const integration = await storage.upsertOrganizationIntegration({
        organizationId: org.id,
        provider,
        isEnabled: true,
        credentials: sealIntegrationCredentials({ apiKey, ...settings }, org.id),
        settings: settings || {},
      });

      await storage.updateIntegrationValidation(org.id, provider, null, null);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "integration",
          entityId: org.id,
          changes: { after: { provider, isEnabled: true }, fields: ["provider", "apiKey", "settings"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: { provider },
        });
      } catch (e) { /* non-fatal */ }

      res.json({
        success: true,
        provider,
        isEnabled: integration.isEnabled,
        isConfigured: true,
        message: `${provider} integration configured. Click 'Test Connection' to verify.`,
      });
    } catch (err: any) {
      logger.error("Save integration error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.post("/api/integrations/:provider/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { provider } = req.params;
      
      const integration = await storage.getOrganizationIntegration(org.id, provider);
      
      const { readIntegrationCredentials } = await import('./services/integrationCredentials');
      const credentials = readIntegrationCredentials<{ apiKey: string }>(
        integration,
        org.id,
        `${provider} test`,
      );

      // Was `decryptJsonCredentials(credentials.encrypted)` guarded only by
      // "are there credentials at all", so a key stored in the other shape
      // reached JSON.parse as `undefined` and threw a 500 instead of saying
      // what was wrong.
      if (!credentials?.apiKey) {
        return Errors.badRequest(res, `${provider} is not configured`);
      }
      
      let testResult = { success: false, message: '' };
      
      if (provider === 'sendgrid') {
        const sgMail = (await import('@sendgrid/mail')).default;
        sgMail.setApiKey(credentials.apiKey);
        try {
          await sgMail.send({
            to: 'test@example.com',
            from: 'test@example.com',
            subject: 'Test',
            text: 'Test',
            mailSettings: { sandboxMode: { enable: true } },
          });
          testResult = { success: true, message: 'SendGrid API key is valid' };
        } catch (sgErr: any) {
          if (sgErr.code === 401 || sgErr.response?.body?.errors?.[0]?.message?.includes('API Key')) {
            testResult = { success: false, message: 'Invalid SendGrid API key' };
          } else {
            testResult = { success: true, message: 'SendGrid API key is valid' };
          }
        }
      } else if (provider === 'twilio') {
        try {
          const twilioResponse = await fetch('https://api.twilio.com/2010-04-01/Accounts.json', {
            headers: { 'Authorization': 'Basic ' + Buffer.from(credentials.apiKey + ':').toString('base64') },
          });
          if (twilioResponse.status === 401 || twilioResponse.status === 403) {
            testResult = { success: false, message: 'Invalid Twilio API key' };
          } else {
            testResult = { success: true, message: 'Twilio API key is valid' };
          }
        } catch (twilioErr: any) {
          testResult = { success: false, message: `Twilio test failed: ${twilioErr.message}` };
        }
      } else if (provider === 'lob') {
        try {
          const lobResponse = await fetch('https://api.lob.com/v1/addresses?limit=1', {
            headers: { 'Authorization': 'Basic ' + Buffer.from(credentials.apiKey + ':').toString('base64') },
          });
          if (lobResponse.status === 401 || lobResponse.status === 403) {
            testResult = { success: false, message: 'Invalid Lob API key' };
          } else {
            testResult = { success: true, message: 'Lob API key is valid' };
          }
        } catch (lobErr: any) {
          testResult = { success: false, message: `Lob test failed: ${lobErr.message}` };
        }
      } else if (provider === 'regrid') {
        try {
          // Tier 1E credential hygiene: key in the Authorization header
          // (Regrid supports Bearer auth), never in the URL.
          const testResponse = await fetch(
            `https://app.regrid.com/api/v2/parcels/address?query=1600%20Pennsylvania%20Ave%20NW,%20Washington,%20DC&limit=1`,
            { headers: { Authorization: `Bearer ${credentials.apiKey}` } },
          );
          if (testResponse.status === 401 || testResponse.status === 403) {
            testResult = { success: false, message: 'Invalid Regrid API key' };
          } else {
            testResult = { success: true, message: 'Regrid API key is valid' };
          }
        } catch (regridErr: any) {
          testResult = { success: false, message: `Regrid test failed: ${regridErr.message}` };
        }
      }
      
      if (testResult.success) {
        await storage.updateIntegrationValidation(org.id, provider, new Date(), null);
      } else {
        await storage.updateIntegrationValidation(org.id, provider, null, testResult.message);
      }
      
      res.json(testResult);
    } catch (err: any) {
      logger.error("Test integration error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.delete("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { provider } = req.params;

      await storage.deleteOrganizationIntegration(org.id, provider);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "integration",
          entityId: org.id,
          changes: { before: { provider }, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: { provider },
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true, message: `${provider} integration removed` });
    } catch (err: any) {
      logger.error("Delete integration error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  // ============================================
  // EMAIL SERVICE STATUS & LOGS
  // ============================================
  
  api.get("/api/email/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getEmailServiceStatus, emailService } = await import("./services/emailService");
      
      const status = await getEmailServiceStatus();
      const quota = await emailService.getSendQuota(org.id);
      const credentialSource = await emailService.getCredentialSource(org.id);
      
      res.json({
        ...status,
        credentialSource: credentialSource || 'platform',
        quota,
      });
    } catch (err: any) {
      logger.error("Get email status error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.get("/api/email/logs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const { emailService } = await import("./services/emailService");
      
      const logs = emailService.getLogsByOrganization(org.id, limit);
      res.json(logs);
    } catch (err: any) {
      logger.error("Get email logs error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.post("/api/email/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const { to } = req.body;
      
      const recipientEmail = to || user.email || user?.email;
      
      if (!recipientEmail) {
        return Errors.badRequest(res, "No recipient email address provided");
      }
      
      const { emailService } = await import("./services/emailService");
      
      const result = await emailService.sendTransactionalEmail('notification', {
        to: recipientEmail,
        templateData: {
          title: 'Test Email',
          message: `This is a test email from AcreOS. If you received this, your AWS SES configuration is working correctly.`,
          subject: 'Test Email - AWS SES Configuration',
        },
        organizationId: org.id,
      });
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `Test email sent to ${recipientEmail}`,
          messageId: result.messageId,
          attempts: result.attempts,
        });
      } else {
        Errors.badRequest(res, result.error || "Email test failed", {
          errorType: result.errorType,
          attempts: result.attempts,
          retryable: result.retryable,
        });
      }
    } catch (err: any) {
      logger.error("Test email error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  // ============================================
  // VERIFIED EMAIL DOMAINS (SendGrid Domain Authentication)
  // ============================================
  
  api.get("/api/email-domains", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const domains = await storage.getVerifiedEmailDomains(org.id);
      res.json(domains);
    } catch (err: any) {
      logger.error("Get email domains error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.post("/api/email-domains", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { domain, fromEmail, fromName } = req.body;
      
      if (!domain) {
        return Errors.badRequest(res, "Domain is required");
      }
      
      const existing = (await storage.getVerifiedEmailDomains(org.id)).find(d => d.domain === domain);
      if (existing) {
        return Errors.badRequest(res, "Domain already exists");
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
      let dnsRecords: any[] = [];
      let sendgridDomainId: string | undefined;
      
      const { readIntegrationCredentials } = await import('./services/integrationCredentials');
      const credentials = readIntegrationCredentials<{ apiKey: string }>(
        integration,
        org.id,
        'sendgrid',
      );
      if (credentials?.apiKey) {
        
        try {
          const sgResponse = await fetch('https://api.sendgrid.com/v3/whitelabel/domains', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${credentials.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              domain: domain.toLowerCase(),
              automatic_security: true,
              custom_dkim_selector: 'sg',
            }),
          });
          
          if (sgResponse.ok) {
            const sgData = await sgResponse.json();
            sendgridDomainId = String(sgData.id);
            dnsRecords = [];
            
            if (sgData.dns) {
              for (const [key, record] of Object.entries(sgData.dns)) {
                const rec = record as any;
                dnsRecords.push({
                  type: rec.type || 'CNAME',
                  host: rec.host,
                  data: rec.data,
                  valid: rec.valid || false,
                });
              }
            }
          } else {
            const errText = await sgResponse.text();
            logger.error("[SendGrid] Domain creation failed", { detail: errText });
          }
        } catch (sgErr: any) {
          logger.error("[SendGrid] Domain API error", sgErr instanceof Error ? sgErr : undefined);
        }
      }
      
      const newDomain = await storage.createVerifiedEmailDomain({
        organizationId: org.id,
        domain: domain.toLowerCase(),
        sendgridDomainId,
        status: 'pending',
        dnsRecords: dnsRecords.length > 0 ? dnsRecords : null,
        fromEmail: fromEmail || `noreply@${domain.toLowerCase()}`,
        fromName: fromName || org.name,
        isDefault: false,
      });

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "email_domain",
          entityId: newDomain.id,
          changes: { after: { domain, fromEmail, fromName }, fields: ["domain", "fromEmail", "fromName"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(newDomain);
    } catch (err: any) {
      logger.error("Add email domain error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.post("/api/email-domains/:id/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const domainId = Number(req.params.id);
      
      const domainRecord = await storage.getVerifiedEmailDomain(org.id, domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return Errors.notFound(res, "Domain");
      }

      if (!domainRecord.sendgridDomainId) {
        return Errors.badRequest(res, "Domain not registered with SendGrid");
      }

      const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
      const { readIntegrationCredentials } = await import('./services/integrationCredentials');
      const credentials = readIntegrationCredentials<{ apiKey: string }>(
        integration,
        org.id,
        'sendgrid',
      );
      if (!credentials?.apiKey) {
        return Errors.badRequest(res, "SendGrid not configured");
      }
      
      const validateResponse = await fetch(
        `https://api.sendgrid.com/v3/whitelabel/domains/${domainRecord.sendgridDomainId}/validate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (!validateResponse.ok) {
        const errText = await validateResponse.text();
        logger.error("[SendGrid] Domain validation request failed", { detail: errText });
        return Errors.badRequest(res, "Validation request failed");
      }
      
      const validateData = await validateResponse.json();
      const isValid = validateData.valid === true;
      
      let updatedDnsRecords = domainRecord.dnsRecords || [];
      if (validateData.validation_results) {
        for (const [key, result] of Object.entries(validateData.validation_results)) {
          const r = result as any;
          const existingIdx = updatedDnsRecords.findIndex((d: any) => d.host?.includes(key));
          if (existingIdx >= 0) {
            updatedDnsRecords[existingIdx].valid = r.valid || false;
          }
        }
      }
      
      const updatedDomain = await storage.updateVerifiedEmailDomain(domainId, {
        status: isValid ? 'verified' : 'pending',
        dnsRecords: updatedDnsRecords,
        verifiedAt: isValid ? new Date() : null,
      });
      
      res.json({
        verified: isValid,
        domain: updatedDomain,
        validationResults: validateData.validation_results,
      });
    } catch (err: any) {
      logger.error("Verify email domain error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.patch("/api/email-domains/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const domainId = Number(req.params.id);
      const { fromEmail, fromName, isDefault } = req.body;
      
      const domainRecord = await storage.getVerifiedEmailDomain(org.id, domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return Errors.notFound(res, "Domain");
      }

      if (isDefault === true) {
        const allDomains = await storage.getVerifiedEmailDomains(org.id);
        for (const d of allDomains) {
          if (d.id !== domainId && d.isDefault) {
            await storage.updateVerifiedEmailDomain(d.id, { isDefault: false });
          }
        }
      }
      
      const updatedDomain = await storage.updateVerifiedEmailDomain(domainId, {
        fromEmail: fromEmail ?? domainRecord.fromEmail,
        fromName: fromName ?? domainRecord.fromName,
        isDefault: isDefault ?? domainRecord.isDefault,
      });

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "email_domain",
          entityId: domainId,
          changes: { before: domainRecord, after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(updatedDomain);
    } catch (err: any) {
      logger.error("Update email domain error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.delete("/api/email-domains/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const domainId = Number(req.params.id);

      const domainRecord = await storage.getVerifiedEmailDomain(org.id, domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return Errors.notFound(res, "Domain");
      }

      if (domainRecord.sendgridDomainId) {
        const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
        const { readIntegrationCredentials } = await import('./services/integrationCredentials');
        const credentials = readIntegrationCredentials<{ apiKey: string }>(
          integration,
          org.id,
          'sendgrid',
        );
        if (credentials?.apiKey) {
          try {

            await fetch(
              `https://api.sendgrid.com/v3/whitelabel/domains/${domainRecord.sendgridDomainId}`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${credentials.apiKey}`,
                },
              }
            );
          } catch (sgErr: any) {
            logger.error("[SendGrid] Domain deletion failed", sgErr instanceof Error ? sgErr : undefined);
          }
        }
      }

      await storage.deleteVerifiedEmailDomain(domainId);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "email_domain",
          entityId: domainId,
          changes: { before: domainRecord, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (err: any) {
      logger.error("Delete email domain error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  // ============================================
  // PROVISIONED PHONE NUMBERS (Twilio)
  // ============================================
  
  api.get("/api/phone-numbers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const phones = await storage.getProvisionedPhoneNumbers(org.id);
      res.json(phones);
    } catch (err: any) {
      logger.error("Get phone numbers error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.get("/api/phone-numbers/available", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { areaCode, contains, country } = req.query;
      
      const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
      const { readIntegrationCredentials } = await import('./services/integrationCredentials');
      const credentials = readIntegrationCredentials<{ accountSid: string; authToken: string }>(
        integration,
        org.id,
        'twilio',
      );
      if (!credentials?.accountSid || !credentials?.authToken) {
        return Errors.badRequest(res, "Twilio not configured. Add your Twilio credentials in Settings.");
      }
      
      const countryCode = (country as string) || 'US';
      const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/AvailablePhoneNumbers/${countryCode}/Local.json`);
      if (areaCode) url.searchParams.set('AreaCode', areaCode as string);
      if (contains) url.searchParams.set('Contains', contains as string);
      url.searchParams.set('SmsEnabled', 'true');
      url.searchParams.set('PageSize', '10');
      
      const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });
      
      if (!response.ok) {
        const errText = await response.text();
        logger.error("[Twilio] Available numbers search failed", { detail: errText });
        return Errors.badRequest(res, "Failed to search available numbers");
      }
      
      const data = await response.json();
      const numbers = (data.available_phone_numbers || []).map((n: any) => ({
        phoneNumber: n.phone_number,
        friendlyName: n.friendly_name,
        locality: n.locality,
        region: n.region,
        capabilities: {
          sms: n.capabilities?.sms || false,
          mms: n.capabilities?.mms || false,
          voice: n.capabilities?.voice || false,
        },
      }));
      
      res.json(numbers);
    } catch (err: any) {
      logger.error("Search available numbers error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  api.post("/api/phone-numbers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { phoneNumber, friendlyName } = req.body;
      
      if (!phoneNumber) {
        return Errors.badRequest(res, "Phone number is required");
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
      const { readIntegrationCredentials } = await import('./services/integrationCredentials');
      const credentials = readIntegrationCredentials<{ accountSid: string; authToken: string }>(
        integration,
        org.id,
        'twilio',
      );
      if (!credentials?.accountSid || !credentials?.authToken) {
        return Errors.badRequest(res, "Twilio not configured");
      }
      
      const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');
      
      const purchaseResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            PhoneNumber: phoneNumber,
            FriendlyName: friendlyName || `Acreage - ${org.name}`,
          }).toString(),
        }
      );
      
      if (!purchaseResponse.ok) {
        const errText = await purchaseResponse.text();
        logger.error("[Twilio] Phone purchase failed", { detail: errText });
        return Errors.badRequest(res, "Failed to purchase phone number");
      }
      
      const purchaseData = await purchaseResponse.json();
      
      const newPhone = await storage.createProvisionedPhoneNumber({
        organizationId: org.id,
        phoneNumber: purchaseData.phone_number,
        twilioSid: purchaseData.sid,
        friendlyName: purchaseData.friendly_name,
        capabilities: {
          sms: purchaseData.capabilities?.sms || false,
          mms: purchaseData.capabilities?.mms || false,
          voice: purchaseData.capabilities?.voice || false,
        },
        status: 'active',
        isDefault: false,
        purchasedAt: new Date(),
      });

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "phone_number",
          entityId: newPhone.id,
          changes: { after: { phoneNumber: newPhone.phoneNumber, friendlyName: newPhone.friendlyName }, fields: ["phoneNumber", "friendlyName"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(newPhone);
    } catch (err: any) {
      logger.error("Purchase phone number error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.patch("/api/phone-numbers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const phoneId = Number(req.params.id);
      const { friendlyName, isDefault } = req.body;

      const phoneRecord = await storage.getProvisionedPhoneNumber(org.id, phoneId);
      if (!phoneRecord || phoneRecord.organizationId !== org.id) {
        return Errors.notFound(res, "Phone number");
      }

      if (isDefault === true) {
        const allPhones = await storage.getProvisionedPhoneNumbers(org.id);
        for (const p of allPhones) {
          if (p.id !== phoneId && p.isDefault) {
            await storage.updateProvisionedPhoneNumber(p.id, { isDefault: false });
          }
        }
      }

      const updatedPhone = await storage.updateProvisionedPhoneNumber(phoneId, {
        friendlyName: friendlyName ?? phoneRecord.friendlyName,
        isDefault: isDefault ?? phoneRecord.isDefault,
      });

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "phone_number",
          entityId: phoneId,
          changes: { before: phoneRecord, after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(updatedPhone);
    } catch (err: any) {
      logger.error("Update phone number error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.delete("/api/phone-numbers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const phoneId = Number(req.params.id);

      const phoneRecord = await storage.getProvisionedPhoneNumber(org.id, phoneId);
      if (!phoneRecord || phoneRecord.organizationId !== org.id) {
        return Errors.notFound(res, "Phone number");
      }

      if (phoneRecord.twilioSid) {
        const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
        const { readIntegrationCredentials } = await import('./services/integrationCredentials');
        const credentials = readIntegrationCredentials<{ accountSid: string; authToken: string }>(
          integration,
          org.id,
          'twilio',
        );
        if (credentials?.accountSid && credentials?.authToken) {
          try {

            const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');

            await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${phoneRecord.twilioSid}.json`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': `Basic ${auth}`,
                },
              }
            );
          } catch (twilioErr: any) {
            logger.error("[Twilio] Phone release failed", twilioErr instanceof Error ? twilioErr : undefined);
          }
        }
      }

      await storage.deleteProvisionedPhoneNumber(phoneId);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "phone_number",
          entityId: phoneId,
          changes: { before: phoneRecord, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (err: any) {
      logger.error("Delete phone number error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // A/B TESTING ROUTES
  // ============================================

  // Calculate statistical significance (z-score)
  function calculateZScore(control: { sent: number; converted: number }, variant: { sent: number; converted: number }): number {
    if (control.sent === 0 || variant.sent === 0) return 0;
    
    const p1 = control.converted / control.sent;
    const p2 = variant.converted / variant.sent;
    const p = (control.converted + variant.converted) / (control.sent + variant.sent);
    
    if (p === 0 || p === 1) return 0;
    
    const se = Math.sqrt(p * (1 - p) * (1 / control.sent + 1 / variant.sent));
    if (se === 0) return 0;
    
    return (p2 - p1) / se;
  }

  // Get confidence level from z-score
  function getConfidenceLevel(zScore: number): number {
    const absZ = Math.abs(zScore);
    if (absZ >= Z_SCORES[0.99]) return 0.99;
    if (absZ >= Z_SCORES[0.95]) return 0.95;
    if (absZ >= Z_SCORES[0.90]) return 0.90;
    return 0;
  }

  // Recommend minimum sample size for statistical significance
  function recommendMinSampleSize(baselineConversionRate: number, minimumDetectableEffect: number = 0.05): number {
    const alpha = 0.05; // 95% confidence
    const beta = 0.20; // 80% power
    const zAlpha = 1.96;
    const zBeta = 0.84;
    
    const p1 = baselineConversionRate;
    const p2 = p1 + minimumDetectableEffect;
    
    const numerator = Math.pow(zAlpha + zBeta, 2) * (p1 * (1 - p1) + p2 * (1 - p2));
    const denominator = Math.pow(p2 - p1, 2);
    
    if (denominator === 0) return 100;
    
    return Math.ceil(numerator / denominator);
  }

  // Get all A/B tests for organization
  api.get("/api/ab-tests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const tests = await storage.getAbTests(org.id);
      
      const testsWithVariants = await Promise.all(
        tests.map(async (test) => {
          const variants = await storage.getAbTestVariants(test.id);
          return { ...test, variants };
        })
      );
      
      res.json(testsWithVariants);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // recommend-sample-size — registered BEFORE /api/ab-tests/:id so the literal path wins (2026-07-11 route-order sweep).
  // Get recommended sample size
  api.get("/api/ab-tests/recommend-sample-size", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const baselineRate = parseFloat(req.query.baselineRate as string) || 0.05;
      const minEffect = parseFloat(req.query.minEffect as string) || 0.05;
      
      const sampleSize = recommendMinSampleSize(baselineRate, minEffect);
      
      res.json({ 
        recommendedSampleSize: sampleSize,
        baselineRate,
        minimumDetectableEffect: minEffect,
        confidenceLevel: 0.95,
        power: 0.80
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Get single A/B test with variants
  api.get("/api/ab-tests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const testId = Number(req.params.id);

      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return Errors.notFound(res, "A/B test");
      }
      
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Create A/B test for campaign
  api.post("/api/campaigns/:id/ab-test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = Number(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return Errors.notFound(res, "Campaign");
      }
      
      // Check if campaign already has an active test
      const existingTest = await storage.getAbTestByCampaign(campaignId);
      if (existingTest && existingTest.status !== "completed") {
        return Errors.badRequest(res, "Campaign already has an active A/B test");
      }
      
      const input = insertAbTestSchema.parse({
        organizationId: org.id,
        campaignId,
        name: req.body.name || `A/B Test for ${campaign.name}`,
        testType: req.body.testType || "subject",
        sampleSizePercent: req.body.sampleSizePercent || 20,
        winningMetric: req.body.winningMetric || "response_rate",
        minSampleSize: req.body.minSampleSize || 100,
        autoCompleteOnSignificance: req.body.autoCompleteOnSignificance ?? true,
      });
      
      const test = await storage.createAbTest(input);
      
      // Create default variants if provided
      const variants = req.body.variants || [
        { name: "Control", isControl: true, subject: campaign.subject, content: campaign.content },
        { name: "Variant B", isControl: false, subject: req.body.variantSubject, content: req.body.variantContent }
      ];
      
      const createdVariants = await Promise.all(
        variants.map((v: any) => 
          storage.createAbTestVariant({
            testId: test.id,
            name: v.name,
            isControl: v.isControl || false,
            subject: v.subject,
            content: v.content,
            offerAmount: v.offerAmount,
          })
        )
      );
      
      res.status(201).json({ ...test, variants: createdVariants });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return Errors.badRequest(res, "Invalid input");
      }
      Errors.internal(res, err);
    }
  });

  // Start A/B test (split recipients)
  api.patch("/api/ab-tests/:id/start", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return Errors.notFound(res, "A/B test");
      }

      if (result.test.status !== "draft") {
        return Errors.badRequest(res, "Test is not in draft status");
      }

      if (result.variants.length < 2) {
        return Errors.badRequest(res, "Test must have at least 2 variants");
      }
      
      // Update test status to running
      const updatedTest = await storage.updateAbTest(testId, {
        status: "running",
        startedAt: new Date(),
      });
      
      res.json({ ...updatedTest, variants: result.variants });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Complete A/B test and declare winner
  api.patch("/api/ab-tests/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return Errors.notFound(res, "A/B test");
      }

      if (result.test.status === "completed") {
        return Errors.badRequest(res, "Test is already completed");
      }
      
      // Determine winner based on winning metric
      let winnerId: number | null = null;
      let winningValue = -Infinity;
      
      for (const variant of result.variants) {
        let value = 0;
        const sent = variant.sent || 0;
        
        switch (result.test.winningMetric) {
          case "open_rate":
            value = sent > 0 ? (variant.opened || 0) / sent : 0;
            break;
          case "click_rate":
            value = sent > 0 ? (variant.clicked || 0) / sent : 0;
            break;
          case "response_rate":
          default:
            value = sent > 0 ? (variant.responded || 0) / sent : 0;
            break;
        }
        
        if (value > winningValue) {
          winningValue = value;
          winnerId = variant.id;
        }
      }
      
      // Calculate confidence levels for all variants against control
      const control = result.variants.find(v => v.isControl);
      if (control) {
        for (const variant of result.variants) {
          if (!variant.isControl) {
            const zScore = calculateZScore(
              { sent: control.sent || 0, converted: control.responded || 0 },
              { sent: variant.sent || 0, converted: variant.responded || 0 }
            );
            const confidence = getConfidenceLevel(zScore);
            
            await storage.updateAbTestVariant(variant.id, {
              responseRate: String(variant.sent ? ((variant.responded || 0) / variant.sent * 100).toFixed(2) : 0),
              confidenceLevel: String(confidence * 100),
            });
          }
        }
      }
      
      // Update test as completed
      const updatedTest = await storage.updateAbTest(testId, {
        status: "completed",
        completedAt: new Date(),
        winnerId,
      });
      
      // Get updated variants
      const updatedVariants = await storage.getAbTestVariants(testId);
      
      res.json({ ...updatedTest, variants: updatedVariants });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Update variant metrics (for tracking)
  api.patch("/api/ab-test-variants/:id/metrics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const variantId = Number(req.params.id);
      // F-D39: variants reference an A/B test which is org-scoped — resolve and
      // gate so another org can't poison metrics on yours.
      const { abTestVariants } = await import("@shared/schema");
      const [variant] = await db.select().from(abTestVariants).where(eq(abTestVariants.id, variantId));
      if (!variant) return Errors.notFound(res, "Variant");
      const parentTest = await storage.getAbTest(org.id, variant.testId);
      if (!parentTest) return Errors.notFound(res, "Variant");
      const { sent, delivered, opened, clicked, responded, converted } = req.body;
      
      const updates: any = {};
      if (sent !== undefined) updates.sent = sent;
      if (delivered !== undefined) updates.delivered = delivered;
      if (opened !== undefined) updates.opened = opened;
      if (clicked !== undefined) updates.clicked = clicked;
      if (responded !== undefined) updates.responded = responded;
      if (converted !== undefined) updates.converted = converted;
      
      // Calculate rates
      const currentSent = sent || 0;
      if (currentSent > 0) {
        if (delivered !== undefined) updates.deliveryRate = String((delivered / currentSent * 100).toFixed(2));
        if (opened !== undefined) updates.openRate = String((opened / currentSent * 100).toFixed(2));
        if (clicked !== undefined) updates.clickRate = String((clicked / currentSent * 100).toFixed(2));
        if (responded !== undefined) updates.responseRate = String((responded / currentSent * 100).toFixed(2));
        if (converted !== undefined) updates.conversionRate = String((converted / currentSent * 100).toFixed(2));
      }
      
      const updatedVariant = await storage.updateAbTestVariant(variantId, updates);
      res.json(updatedVariant);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });


  // Add variant to existing test
  api.post("/api/ab-tests/:id/variants", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return Errors.notFound(res, "A/B test");
      }

      if (result.test.status !== "draft") {
        return Errors.badRequest(res, "Cannot add variants to a running or completed test");
      }
      
      const input = insertAbTestVariantSchema.parse({
        testId,
        name: req.body.name,
        isControl: req.body.isControl || false,
        subject: req.body.subject,
        content: req.body.content,
        offerAmount: req.body.offerAmount,
      });
      
      const variant = await storage.createAbTestVariant(input);
      res.status(201).json(variant);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return Errors.badRequest(res, "Invalid input");
      }
      Errors.internal(res, err);
    }
  });

  // Delete A/B test
  api.delete("/api/ab-tests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const testId = Number(req.params.id);
      
      const test = await storage.getAbTest(org.id, testId);
      if (!test) {
        return Errors.notFound(res, "A/B test");
      }
      
      await storage.deleteAbTest(testId);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Apply winning variant to campaign
  api.post("/api/ab-tests/:id/apply-winner", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return Errors.notFound(res, "A/B test");
      }

      if (result.test.status !== "completed" || !result.test.winnerId) {
        return Errors.badRequest(res, "Test is not completed or has no winner");
      }
      
      const winningVariant = result.variants.find(v => v.id === result.test.winnerId);
      if (!winningVariant) {
        return Errors.notFound(res, "Winning variant");
      }
      
      // Update the campaign with the winning variant
      const updates: any = {};
      if (winningVariant.subject) updates.subject = winningVariant.subject;
      if (winningVariant.content) updates.content = winningVariant.content;
      
      const campaign = await storage.updateCampaign(result.test.campaignId, updates);
      
      res.json({ 
        success: true, 
        campaign,
        appliedVariant: winningVariant 
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // CUSTOM FIELDS SYSTEM
  // ============================================

  // Custom Field Definitions
  api.get("/api/custom-fields/definitions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const entityType = req.query.entityType as string | undefined;
      const definitions = await storage.getCustomFieldDefinitions(org.id, entityType);
      res.json(definitions);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      const definition = await storage.getCustomFieldDefinition(org.id, id);
      if (!definition) {
        return Errors.notFound(res, "Custom field definition");
      }
      res.json(definition);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/custom-fields/definitions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertCustomFieldDefinitionSchema.parse({
        ...req.body,
        organizationId: org.id
      });
      const definition = await storage.createCustomFieldDefinition(parsed);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "custom_field_definition",
          entityId: definition.id,
          changes: { after: parsed, fields: Object.keys(parsed) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(definition);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return Errors.badRequest(res, "Invalid data");
      }
      Errors.internal(res, err);
    }
  });

  api.patch("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);

      const existing = await storage.getCustomFieldDefinition(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Custom field definition");
      }

      const updated = await storage.updateCustomFieldDefinition(id, omitProtectedFields(req.body));

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "custom_field_definition",
          entityId: id,
          changes: { before: existing, after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);

      const existing = await storage.getCustomFieldDefinition(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Custom field definition");
      }

      await storage.deleteCustomFieldDefinition(id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "custom_field_definition",
          entityId: id,
          changes: { before: existing, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Custom Field Values
  api.get("/api/custom-fields/values/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const entityType = req.params.entityType;
      const entityId = Number(req.params.entityId);
      const values = await storage.getCustomFieldValues(entityType, entityId);
      res.json(values);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/custom-fields/values", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { definitionId, entityId, value } = req.body;
      
      const definition = await storage.getCustomFieldDefinition(org.id, definitionId);
      if (!definition) {
        return Errors.notFound(res, "Custom field definition");
      }
      
      const fieldValue = await storage.setCustomFieldValue(definitionId, entityId, value);
      res.json(fieldValue);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/custom-fields/values/bulk", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { entityType, entityId, values } = req.body as {
        entityType: string;
        entityId: number;
        values: { definitionId: number; value: string | null }[];
      };
      
      const results = [];
      for (const { definitionId, value } of values) {
        const definition = await storage.getCustomFieldDefinition(org.id, definitionId);
        if (definition) {
          const result = await storage.setCustomFieldValue(definitionId, entityId, value);
          results.push(result);
        }
      }
      
      res.json(results);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SAVED VIEWS
  // ============================================

  api.get("/api/saved-views", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const entityType = req.query.entityType as string | undefined;
      const views = await storage.getSavedViews(org.id, entityType);
      res.json(views);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      const view = await storage.getSavedView(org.id, id);
      if (!view) {
        return Errors.notFound(res, "Saved view");
      }
      res.json(view);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/saved-views", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const parsed = insertSavedViewSchema.parse({
        ...req.body,
        organizationId: org.id,
        createdBy: user?.id || null
      });
      const view = await storage.createSavedView(parsed);

      try {
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "saved_view",
          entityId: view.id,
          changes: { after: parsed, fields: Object.keys(parsed) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(view);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return Errors.badRequest(res, "Invalid data");
      }
      Errors.internal(res, err);
    }
  });

  api.patch("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);

      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Saved view");
      }

      const updated = await storage.updateSavedView(id, omitProtectedFields(req.body));

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "saved_view",
          entityId: id,
          changes: { before: existing, after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);

      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Saved view");
      }

      await storage.deleteSavedView(id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "saved_view",
          entityId: id,
          changes: { before: existing, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/saved-views/:id/set-default", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);

      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Saved view");
      }

      const updated = await storage.setDefaultView(org.id, existing.entityType, id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "saved_view",
          entityId: id,
          changes: { after: { isDefault: true }, fields: ["isDefault"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/system/health", async (req, res) => {
    try {
      const checks = {
        database: false,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };
      
      try {
        const result = await db.execute(sql`SELECT 1 as ok`);
        checks.database = true;
      } catch (dbErr: any) {
        logger.error("[Health] Database check failed", dbErr instanceof Error ? dbErr : undefined);
        checks.database = false;
      }
      
      res.json({
        status: checks.database ? 'healthy' : 'degraded',
        checks
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================

  // WEBHOOK MANAGEMENT
  // ============================================

  // GET /api/webhooks — list org webhook endpoints
  api.get("/api/webhooks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      // REDACTED read: the stored objects carry the HMAC signing secret, and
      // returning it let any authenticated member (a viewer included) read a key
      // that lets its holder FORGE deliveries into the org's own systems. The
      // PUT that sets it is admin-only; the read was not.
      const { getWebhookEndpointsForDisplay } = await import("./services/webhookDispatcher");
      const endpoints = await getWebhookEndpointsForDisplay(org.id);
      res.json(endpoints);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // PUT /api/webhooks — save/replace all webhook endpoints for org
  api.put("/api/webhooks", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const org = req.organization;
      const { endpoints } = req.body;

      if (!Array.isArray(endpoints)) {
        return Errors.badRequest(res, "endpoints must be an array");
      }
      if (endpoints.length > 10) {
        return Errors.badRequest(res, "Maximum 10 webhook endpoints per organization");
      }

      const { saveWebhookEndpoints } = await import("./services/webhookDispatcher");
      await saveWebhookEndpoints(org.id, endpoints);
      res.json({ success: true, count: endpoints.length });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/webhooks/test — fire a test event to a given URL
  api.post("/api/webhooks/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { url, secret } = req.body;

      if (!url || typeof url !== "string") {
        return Errors.badRequest(res, "url is required");
      }

      // F1 SSRF: validate user-supplied webhook URL before contacting the network.
      const { validateUrl, SSRFBlockedError } = await import("./middleware/fileUploadSecurity");
      try {
        await validateUrl(url);
      } catch (err: any) {
        if (err instanceof SSRFBlockedError) {
          return res.status(422).json({
            error: "ssrf_blocked",
            message: err.message,
            statusCode: 422,
          });
        }
        throw err;
      }

      const { signPayload } = await import("./services/webhookDispatcher");
      const payload = JSON.stringify({
        event: "webhook.test",
        timestamp: new Date().toISOString(),
        organizationId: org.id,
        data: { message: "This is a test event from AcreOS" },
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AcreOS-Event": "webhook.test",
      };
      if (secret) headers["X-AcreOS-Signature"] = signPayload(payload, secret);

      const response = await fetch(url, { method: "POST", headers, body: payload });
      res.json({ status: response.status, ok: response.ok });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

}
