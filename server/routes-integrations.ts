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

export function registerIntegrationRoutes(app: Express): void {
  const api = app;

  // ORGANIZATION INTEGRATIONS MANAGEMENT
  // ============================================
  
  api.get("/api/integrations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const integrations = await storage.getOrganizationIntegrations(org.id);
      
      const { maskApiKey, decryptJsonCredentials } = await import('./services/encryption');
      
      const masked = integrations.map(i => {
        let maskedKey = '';
        if (i.credentials?.encrypted) {
          try {
            const decrypted = decryptJsonCredentials<{ apiKey?: string }>(i.credentials.encrypted, org.id);
            maskedKey = maskApiKey(decrypted.apiKey);
          } catch {
            maskedKey = '****';
          }
        }
        return {
          ...i,
          credentials: i.credentials?.encrypted ? {
            hasApiKey: true,
            maskedKey,
          } : null,
        };
      });
      
      res.json(masked);
    } catch (err: any) {
      console.error("Get integrations error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      
      const integration = await storage.getOrganizationIntegration(org.id, provider);
      
      if (!integration) {
        return res.json({ provider, isEnabled: false, isConfigured: false });
      }
      
      const { maskApiKey, decryptJsonCredentials } = await import('./services/encryption');
      
      let maskedKey = '';
      if (integration.credentials?.encrypted) {
        try {
          const decrypted = decryptJsonCredentials<{ apiKey?: string }>(integration.credentials.encrypted, org.id);
          maskedKey = maskApiKey(decrypted.apiKey);
        } catch {
          maskedKey = '****';
        }
      }
      
      res.json({
        ...integration,
        isConfigured: !!integration.credentials?.encrypted,
        credentials: integration.credentials?.encrypted ? {
          hasApiKey: true,
          maskedKey,
        } : null,
      });
    } catch (err: any) {
      console.error("Get integration error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      const { apiKey, settings } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ message: "API key is required" });
      }
      
      const validProviders = ['sendgrid', 'twilio', 'lob', 'regrid', 'rapidapi'];
      if (!validProviders.includes(provider)) {
        return res.status(400).json({ message: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
      }
      
      const { encryptJsonCredentials } = await import('./services/encryption');
      
      const encryptedCredentials = encryptJsonCredentials({ apiKey, ...settings }, org.id);
      
      const integration = await storage.upsertOrganizationIntegration({
        organizationId: org.id,
        provider,
        isEnabled: true,
        credentials: { encrypted: encryptedCredentials },
        settings: settings || {},
      });
      
      await storage.updateIntegrationValidation(org.id, provider, null, null);
      
      res.json({
        success: true,
        provider,
        isEnabled: integration.isEnabled,
        isConfigured: true,
        message: `${provider} integration configured. Click 'Test Connection' to verify.`,
      });
    } catch (err: any) {
      console.error("Save integration error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/integrations/:provider/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      
      const integration = await storage.getOrganizationIntegration(org.id, provider);
      
      if (!integration || !integration.credentials) {
        return res.status(400).json({ message: `${provider} is not configured` });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ apiKey: string }>(
        (integration.credentials as any).encrypted,
        org.id
      );
      
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
          const testResponse = await fetch(`https://app.regrid.com/api/v2/parcels/address?query=1600%20Pennsylvania%20Ave%20NW,%20Washington,%20DC&token=${credentials.apiKey}&limit=1`);
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
      console.error("Test integration error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });
  
  api.delete("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      
      await storage.deleteOrganizationIntegration(org.id, provider);
      
      res.json({ success: true, message: `${provider} integration removed` });
    } catch (err: any) {
      console.error("Delete integration error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // ============================================
  // EMAIL SERVICE STATUS & LOGS
  // ============================================
  
  api.get("/api/email/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Get email status error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/email/logs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const { emailService } = await import("./services/emailService");
      
      const logs = emailService.getLogsByOrganization(org.id, limit);
      res.json(logs);
    } catch (err: any) {
      console.error("Get email logs error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/email/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const { to } = req.body;
      
      const recipientEmail = to || user.email || user.claims?.email;
      
      if (!recipientEmail) {
        return res.status(400).json({ message: "No recipient email address provided" });
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
        res.status(400).json({ 
          success: false, 
          message: result.error,
          errorType: result.errorType,
          attempts: result.attempts,
          retryable: result.retryable,
        });
      }
    } catch (err: any) {
      console.error("Test email error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // ============================================
  // VERIFIED EMAIL DOMAINS (SendGrid Domain Authentication)
  // ============================================
  
  api.get("/api/email-domains", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domains = await storage.getVerifiedEmailDomains(org.id);
      res.json(domains);
    } catch (err: any) {
      console.error("Get email domains error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/email-domains", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { domain, fromEmail, fromName } = req.body;
      
      if (!domain) {
        return res.status(400).json({ message: "Domain is required" });
      }
      
      const existing = (await storage.getVerifiedEmailDomains(org.id)).find(d => d.domain === domain);
      if (existing) {
        return res.status(400).json({ message: "Domain already exists" });
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
      let dnsRecords: any[] = [];
      let sendgridDomainId: string | undefined;
      
      if (integration?.credentials?.encrypted) {
        const { decryptJsonCredentials } = await import('./services/encryption');
        const credentials = decryptJsonCredentials<{ apiKey: string }>(
          integration.credentials.encrypted,
          org.id
        );
        
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
            console.error('[SendGrid] Domain creation failed:', errText);
          }
        } catch (sgErr: any) {
          console.error('[SendGrid] Domain API error:', sgErr.message);
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
      
      res.json(newDomain);
    } catch (err: any) {
      console.error("Add email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/email-domains/:id/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domainId = Number(req.params.id);
      
      const domainRecord = await storage.getVerifiedEmailDomain(domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      
      if (!domainRecord.sendgridDomainId) {
        return res.status(400).json({ message: "Domain not registered with SendGrid" });
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
      if (!integration?.credentials?.encrypted) {
        return res.status(400).json({ message: "SendGrid not configured" });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ apiKey: string }>(
        integration.credentials.encrypted,
        org.id
      );
      
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
        console.error('[SendGrid] Domain validation request failed:', errText);
        return res.status(400).json({ message: "Validation request failed" });
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
      console.error("Verify email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.patch("/api/email-domains/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domainId = Number(req.params.id);
      const { fromEmail, fromName, isDefault } = req.body;
      
      const domainRecord = await storage.getVerifiedEmailDomain(domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Domain not found" });
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
      
      res.json(updatedDomain);
    } catch (err: any) {
      console.error("Update email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.delete("/api/email-domains/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domainId = Number(req.params.id);
      
      const domainRecord = await storage.getVerifiedEmailDomain(domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      
      if (domainRecord.sendgridDomainId) {
        const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
        if (integration?.credentials?.encrypted) {
          try {
            const { decryptJsonCredentials } = await import('./services/encryption');
            const credentials = decryptJsonCredentials<{ apiKey: string }>(
              integration.credentials.encrypted,
              org.id
            );
            
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
            console.error('[SendGrid] Domain deletion failed:', sgErr.message);
          }
        }
      }
      
      await storage.deleteVerifiedEmailDomain(domainId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // ============================================
  // PROVISIONED PHONE NUMBERS (Twilio)
  // ============================================
  
  api.get("/api/phone-numbers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const phones = await storage.getProvisionedPhoneNumbers(org.id);
      res.json(phones);
    } catch (err: any) {
      console.error("Get phone numbers error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/phone-numbers/available", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { areaCode, contains, country } = req.query;
      
      const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
      if (!integration?.credentials?.encrypted) {
        return res.status(400).json({ message: "Twilio not configured. Add your Twilio credentials in Settings." });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ accountSid: string; authToken: string }>(
        integration.credentials.encrypted,
        org.id
      );
      
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
        console.error('[Twilio] Available numbers search failed:', errText);
        return res.status(400).json({ message: "Failed to search available numbers" });
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
      console.error("Search available numbers error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/phone-numbers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { phoneNumber, friendlyName } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
      if (!integration?.credentials?.encrypted) {
        return res.status(400).json({ message: "Twilio not configured" });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ accountSid: string; authToken: string }>(
        integration.credentials.encrypted,
        org.id
      );
      
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
        console.error('[Twilio] Phone purchase failed:', errText);
        return res.status(400).json({ message: "Failed to purchase phone number" });
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
      
      res.json(newPhone);
    } catch (err: any) {
      console.error("Purchase phone number error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.patch("/api/phone-numbers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const phoneId = Number(req.params.id);
      const { friendlyName, isDefault } = req.body;
      
      const phoneRecord = await storage.getProvisionedPhoneNumber(phoneId);
      if (!phoneRecord || phoneRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Phone number not found" });
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
      
      res.json(updatedPhone);
    } catch (err: any) {
      console.error("Update phone number error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.delete("/api/phone-numbers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const phoneId = Number(req.params.id);
      
      const phoneRecord = await storage.getProvisionedPhoneNumber(phoneId);
      if (!phoneRecord || phoneRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      if (phoneRecord.twilioSid) {
        const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
        if (integration?.credentials?.encrypted) {
          try {
            const { decryptJsonCredentials } = await import('./services/encryption');
            const credentials = decryptJsonCredentials<{ accountSid: string; authToken: string }>(
              integration.credentials.encrypted,
              org.id
            );
            
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
            console.error('[Twilio] Phone release failed:', twilioErr.message);
          }
        }
      }
      
      await storage.deleteProvisionedPhoneNumber(phoneId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete phone number error:", err);
      res.status(500).json({ message: err.message });
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
      const org = (req as any).organization;
      const tests = await storage.getAbTests(org.id);
      
      const testsWithVariants = await Promise.all(
        tests.map(async (test) => {
          const variants = await storage.getAbTestVariants(test.id);
          return { ...test, variants };
        })
      );
      
      res.json(testsWithVariants);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get single A/B test with variants
  api.get("/api/ab-tests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create A/B test for campaign
  api.post("/api/campaigns/:id/ab-test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = Number(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      
      // Check if campaign already has an active test
      const existingTest = await storage.getAbTestByCampaign(campaignId);
      if (existingTest && existingTest.status !== "completed") {
        return res.status(400).json({ message: "Campaign already has an active A/B test" });
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
        return res.status(400).json({ message: "Invalid input", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Start A/B test (split recipients)
  api.patch("/api/ab-tests/:id/start", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status !== "draft") {
        return res.status(400).json({ message: "Test is not in draft status" });
      }
      
      if (result.variants.length < 2) {
        return res.status(400).json({ message: "Test must have at least 2 variants" });
      }
      
      // Update test status to running
      const updatedTest = await storage.updateAbTest(testId, {
        status: "running",
        startedAt: new Date(),
      });
      
      res.json({ ...updatedTest, variants: result.variants });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Complete A/B test and declare winner
  api.patch("/api/ab-tests/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status === "completed") {
        return res.status(400).json({ message: "Test is already completed" });
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
      res.status(500).json({ message: err.message });
    }
  });

  // Update variant metrics (for tracking)
  api.patch("/api/ab-test-variants/:id/metrics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const variantId = Number(req.params.id);
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
      res.status(500).json({ message: err.message });
    }
  });

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
      res.status(500).json({ message: err.message });
    }
  });

  // Add variant to existing test
  api.post("/api/ab-tests/:id/variants", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status !== "draft") {
        return res.status(400).json({ message: "Cannot add variants to a running or completed test" });
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
        return res.status(400).json({ message: "Invalid input", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Delete A/B test
  api.delete("/api/ab-tests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const test = await storage.getAbTest(org.id, testId);
      if (!test) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      await storage.deleteAbTest(testId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Apply winning variant to campaign
  api.post("/api/ab-tests/:id/apply-winner", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status !== "completed" || !result.test.winnerId) {
        return res.status(400).json({ message: "Test is not completed or has no winner" });
      }
      
      const winningVariant = result.variants.find(v => v.id === result.test.winnerId);
      if (!winningVariant) {
        return res.status(404).json({ message: "Winning variant not found" });
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
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // CUSTOM FIELDS SYSTEM
  // ============================================

  // Custom Field Definitions
  api.get("/api/custom-fields/definitions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.query.entityType as string | undefined;
      const definitions = await storage.getCustomFieldDefinitions(org.id, entityType);
      res.json(definitions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      const definition = await storage.getCustomFieldDefinition(org.id, id);
      if (!definition) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      res.json(definition);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/custom-fields/definitions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertCustomFieldDefinitionSchema.parse({
        ...req.body,
        organizationId: org.id
      });
      const definition = await storage.createCustomFieldDefinition(parsed);
      res.status(201).json(definition);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.patch("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getCustomFieldDefinition(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      
      const updated = await storage.updateCustomFieldDefinition(id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getCustomFieldDefinition(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      
      await storage.deleteCustomFieldDefinition(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/custom-fields/values", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { definitionId, entityId, value } = req.body;
      
      const definition = await storage.getCustomFieldDefinition(org.id, definitionId);
      if (!definition) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      
      const fieldValue = await storage.setCustomFieldValue(definitionId, entityId, value);
      res.json(fieldValue);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/custom-fields/values/bulk", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // SAVED VIEWS
  // ============================================

  api.get("/api/saved-views", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.query.entityType as string | undefined;
      const views = await storage.getSavedViews(org.id, entityType);
      res.json(views);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      const view = await storage.getSavedView(org.id, id);
      if (!view) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      res.json(view);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/saved-views", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const parsed = insertSavedViewSchema.parse({
        ...req.body,
        organizationId: org.id,
        createdBy: user?.id || null
      });
      const view = await storage.createSavedView(parsed);
      res.status(201).json(view);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.patch("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      
      const updated = await storage.updateSavedView(id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      
      await storage.deleteSavedView(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/saved-views/:id/set-default", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      
      const updated = await storage.setDefaultView(org.id, existing.entityType, id);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
        console.error("[Health] Database check failed:", dbErr.message);
        checks.database = false;
      }
      
      res.json({
        status: checks.database ? 'healthy' : 'degraded',
        checks
      });
    } catch (err: any) {
      res.status(500).json({ status: 'unhealthy', error: err.message });
    }
  });

  // ============================================

}
