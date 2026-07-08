import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CreateAgentTaskInput } from "@shared/routes";

export function useAgentTasks() {
  return useQuery({
    queryKey: [api.agentTasks.list.path],
    queryFn: async () => {
      const res = await fetch(api.agentTasks.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch agent tasks");
      return api.agentTasks.list.responses[200].parse(await res.json());
    },
    // Perf audit 2026-07-04: was a 5s poll — the most aggressive customer
    // path in the app, firing app-wide. 15s keeps agent-task status feeling
    // live at a third of the load (background tabs stop entirely via the
    // global refetchIntervalInBackground default).
    refetchInterval: 15_000,
  });
}

export function useCreateAgentTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateAgentTaskInput) => {
      const validated = api.agentTasks.create.input.parse(data);
      const res = await fetch(api.agentTasks.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create task");
      return api.agentTasks.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.agentTasks.list.path] });
    },
  });
}
