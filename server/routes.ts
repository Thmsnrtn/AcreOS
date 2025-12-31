import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Register Replit Integrations
  await setupAuth(app);
  registerAuthRoutes(app);
  registerChatRoutes(app);
  registerImageRoutes(app);

  // === APP ROUTES ===

  // Leads
  app.get(api.leads.list.path, async (req, res) => {
    const leads = await storage.getLeads();
    res.json(leads);
  });
  
  app.post(api.leads.create.path, async (req, res) => {
    try {
      const input = api.leads.create.input.parse(req.body);
      const lead = await storage.createLead(input);
      res.status(201).json(lead);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.leads.get.path, async (req, res) => {
    const lead = await storage.getLead(Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });

  app.put(api.leads.update.path, async (req, res) => {
    const input = api.leads.update.input.parse(req.body);
    const lead = await storage.updateLead(Number(req.params.id), input);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });

  // Properties
  app.get(api.properties.list.path, async (req, res) => {
    const properties = await storage.getProperties();
    res.json(properties);
  });

  app.post(api.properties.create.path, async (req, res) => {
    try {
      const input = api.properties.create.input.parse(req.body);
      const property = await storage.createProperty(input);
      res.status(201).json(property);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Notes
  app.get(api.notes.list.path, async (req, res) => {
    const notes = await storage.getNotes();
    res.json(notes);
  });

  app.post(api.notes.create.path, async (req, res) => {
    try {
      const input = api.notes.create.input.parse(req.body);
      const note = await storage.createNote(input);
      res.status(201).json(note);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Agent Tasks
  app.get(api.agentTasks.list.path, async (req, res) => {
    const tasks = await storage.getAgentTasks();
    res.json(tasks);
  });

  app.post(api.agentTasks.create.path, async (req, res) => {
    try {
      const input = api.agentTasks.create.input.parse(req.body);
      const task = await storage.createAgentTask(input);
      res.status(201).json(task);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Seed Data
  const existingLeads = await storage.getLeads();
  if (existingLeads.length === 0) {
    await storage.createLead({
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      status: "new",
      notes: "Interested in desert land."
    });
    await storage.createLead({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      status: "negotiation",
      notes: "Looking for 5+ acres."
    });

    const prop = await storage.createProperty({
      apn: "123-456-789",
      county: "Costilla",
      state: "CO",
      sizeAcres: "5.0",
      status: "available",
      purchasePrice: "2000",
      marketValue: "8000",
      description: "Beautiful 5 acre lot near mountains."
    });

    await storage.createNote({
      propertyId: prop.id,
      originalPrincipal: "6000",
      interestRate: "10",
      termMonths: 60,
      monthlyPayment: "127.48",
      startDate: new Date(),
      status: "active"
    });
    
    console.log("Seeding completed.");
  }

  return httpServer;
}
