/**
 * Atlas delegation tools — ask_<agent>.
 *
 * Each tool dispatches to a named company agent (Sophie/Forge/Beacon/…)
 * using the same routing the founder agent-chat endpoint uses, then
 * returns an `agent_quote` artifact that Atlas can quote in-thread.
 *
 * Phase B keeps these thin: we invoke the same companyAgentService +
 * routeAITask pipeline as routes-founder-intelligence.ts:agent-chat
 * instead of reaching across HTTP.
 */

import { z } from "zod";
import { registerTool } from "../tool-registry";

const AGENT_CODENAMES = {
  sophie: "sophie_csm",
  forge: "forge_revenue",
  beacon: "beacon_marketing",
  sentinel: "sentinel_devops",
  ledger: "ledger_finance",
  shield: "shield_legal",
  oracle: "oracle_analytics",
  compass: "compass_pm",
  crucible: "crucible_qa",
} as const;

const AGENT_TITLES: Record<string, string> = {
  sophie_csm: "Sophie — Customer Success",
  forge_revenue: "Forge — Revenue",
  beacon_marketing: "Beacon — Marketing",
  sentinel_devops: "Sentinel — DevOps",
  ledger_finance: "Ledger — Finance",
  shield_legal: "Shield — Legal",
  oracle_analytics: "Oracle — Analytics",
  compass_pm: "Compass — Product",
  crucible_qa: "Crucible — QA",
};

async function askAgent(codename: string, prompt: string, orgId?: number) {
  let systemPrompt = `You are ${AGENT_TITLES[codename] ?? codename}. Answer in character.`;
  let agentTitle = AGENT_TITLES[codename] ?? codename;
  let dataSection = "";
  try {
    const { companyAgentService } = await import("../../companyAgents");
    const agent = await companyAgentService.getByCodename(codename);
    if (agent) {
      systemPrompt = agent.personalityPrompt || systemPrompt;
      agentTitle = agent.title || agentTitle;
      try {
        const { resolveAgentData } = await import("../../agentDataResolvers");
        const liveData = await resolveAgentData(codename);
        if (liveData && Object.keys(liveData).length > 0) {
          dataSection = "\n\nLIVE METRICS:\n" + Object.entries(liveData).map(([k, v]) => `${k}: ${v}`).join("\n");
        }
      } catch {
        /* live data unavailable — fall through */
      }
    }
  } catch {
    /* agent lookup unavailable — return canned response */
  }

  try {
    const { routeAITask, TaskComplexity } = await import("../../aiRouter");
    const r = await routeAITask({
      taskType: "agent_chat",
      complexity: TaskComplexity.MODERATE,
      taskTier: "standard",
      messages: [
        { role: "system", content: systemPrompt + dataSection },
        { role: "user", content: orgId ? `[org_id=${orgId}] ${prompt}` : prompt },
      ],
    });
    return { content: r.content ?? "", agentTitle };
  } catch (err) {
    return { content: `(${codename} unavailable: ${String(err)})`, agentTitle };
  }
}

function registerAskTool(name: string, codename: string, hasOrgArg: boolean): void {
  const schema = hasOrgArg
    ? z.object({ prompt: z.string().min(1).max(4000), org_id: z.number().int().positive().optional() })
    : z.object({ prompt: z.string().min(1).max(4000) });
  registerTool({
    name,
    description: `Delegate a question to ${AGENT_TITLES[codename] ?? codename} and quote the response.`,
    category: "delegation",
    destructive: false,
    tier: 1,
    schema: schema as any,
    artifactType: "agent_quote",
    async handler(args: any) {
      const result = await askAgent(codename, args.prompt, args.org_id);
      return {
        artifact: {
          type: "agent_quote",
          agentCodename: codename,
          agentTitle: result.agentTitle,
          markdown: result.content,
        },
      };
    },
  });
}

registerAskTool("ask_sophie",   AGENT_CODENAMES.sophie,   true);
registerAskTool("ask_forge",    AGENT_CODENAMES.forge,    false);
registerAskTool("ask_beacon",   AGENT_CODENAMES.beacon,   false);
registerAskTool("ask_sentinel", AGENT_CODENAMES.sentinel, false);
registerAskTool("ask_ledger",   AGENT_CODENAMES.ledger,   false);
registerAskTool("ask_shield",   AGENT_CODENAMES.shield,   false);
registerAskTool("ask_oracle",   AGENT_CODENAMES.oracle,   false);
registerAskTool("ask_compass",  AGENT_CODENAMES.compass,  false);
registerAskTool("ask_crucible", AGENT_CODENAMES.crucible, false);
