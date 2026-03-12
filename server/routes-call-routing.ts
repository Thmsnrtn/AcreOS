import { Router, type Request, type Response } from 'express';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// ROUTING CONFIG
// =====================

// GET /call-routing/config — get routing config for org
router.get('/call-routing/config', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    // Stub: fetch from DB by org.id
    const config = {
      organizationId: org.id,
      strategy: 'round_robin', // round_robin | least_busy | skill_based | priority
      overflowAction: 'voicemail', // voicemail | queue | external
      maxQueueSize: 20,
      maxWaitSeconds: 300,
      businessHours: {
        timezone: 'America/Chicago',
        schedule: {
          mon: { open: '08:00', close: '18:00' },
          tue: { open: '08:00', close: '18:00' },
          wed: { open: '08:00', close: '18:00' },
          thu: { open: '08:00', close: '18:00' },
          fri: { open: '08:00', close: '17:00' },
          sat: null,
          sun: null,
        },
      },
      greetingMessage: 'Thank you for calling. Please hold while we connect you.',
      holdMusic: 'default',
      updatedAt: new Date().toISOString(),
    };
    res.json({ config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /call-routing/config — update routing config
router.put('/call-routing/config', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const updates = req.body;
    // Stub: persist to DB
    const config = {
      organizationId: org.id,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    res.json({ config, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// AGENTS
// =====================

// GET /call-routing/agents — list available agents with availability
router.get('/call-routing/agents', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { available } = req.query;
    // Stub: replace with DB query filtered by org and optionally availability
    const agents: any[] = [];
    res.json({ agents, organizationId: org.id, availableOnly: available === 'true' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /call-routing/agents/:agentId/status — set agent availability
router.patch('/call-routing/agents/:agentId/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const validStatuses = ['available', 'busy', 'away', 'offline'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${validStatuses.join(', ')}`,
      });
    }
    // Stub: persist agent status
    const agent = {
      id: req.params.agentId,
      status,
      updatedAt: new Date().toISOString(),
    };
    res.json({ agent, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// QUEUE
// =====================

// GET /call-routing/queue — get current call queue
router.get('/call-routing/queue', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    // Stub: return live queue from telephony provider
    const queue = {
      organizationId: org.id,
      activeCalls: [],
      waiting: [],
      queueDepth: 0,
      averageWaitSeconds: 0,
      longestWaitSeconds: 0,
      fetchedAt: new Date().toISOString(),
    };
    res.json({ queue });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// ROUTING WEBHOOK
// =====================

// POST /call-routing/route — route an incoming call (webhook)
router.post('/call-routing/route', async (req: Request, res: Response) => {
  try {
    const { callSid, from, to, callerId, skills } = req.body;
    if (!callSid || !from) {
      return res.status(400).json({ error: 'callSid and from are required' });
    }
    // Stub: determine routing based on config + agent availability
    const routing = {
      callSid,
      from,
      to,
      callerId,
      assignedAgentId: null,
      action: 'queue', // queue | agent | voicemail | reject
      queuePosition: 1,
      estimatedWaitSeconds: 60,
      routedAt: new Date().toISOString(),
    };
    res.json({ routing, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /call-routing/transfer — transfer call between agents
router.post('/call-routing/transfer', async (req: Request, res: Response) => {
  try {
    const { callSid, fromAgentId, toAgentId, note } = req.body;
    if (!callSid || !toAgentId) {
      return res.status(400).json({ error: 'callSid and toAgentId are required' });
    }
    // Stub: execute transfer via telephony provider
    const transfer = {
      callSid,
      fromAgentId,
      toAgentId,
      note: note ?? '',
      status: 'transferred',
      transferredAt: new Date().toISOString(),
    };
    res.json({ transfer, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// STATS
// =====================

// GET /call-routing/stats — queue stats and performance metrics
router.get('/call-routing/stats', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { period } = req.query; // today | week | month
    // Stub: aggregate from call logs
    const stats = {
      organizationId: org.id,
      period: period ?? 'today',
      totalCalls: 0,
      answeredCalls: 0,
      missedCalls: 0,
      averageHandleTimeSeconds: 0,
      averageWaitTimeSeconds: 0,
      abandonRate: 0,
      agentUtilization: 0,
      peakHour: null,
      fetchedAt: new Date().toISOString(),
    };
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// SKILLS
// =====================

// GET /call-routing/skills — list agent skills and mappings
router.get('/call-routing/skills', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    // Stub: return skill catalog + agent assignments
    const skills: any[] = [];
    res.json({ skills, organizationId: org.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /call-routing/skills — assign skill to agent
router.post('/call-routing/skills', async (req: Request, res: Response) => {
  try {
    const { agentId, skill, proficiencyLevel } = req.body;
    if (!agentId || !skill) {
      return res.status(400).json({ error: 'agentId and skill are required' });
    }
    // Stub: persist skill assignment
    const assignment = {
      agentId,
      skill,
      proficiencyLevel: proficiencyLevel ?? 1,
      assignedAt: new Date().toISOString(),
    };
    res.status(201).json({ assignment, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
