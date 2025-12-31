import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CreateAgentTaskRequest } from "@shared/routes";

export function useAgentTasks() {
  return useQuery({
    queryKey: [api.agentTasks.list.path],
    queryFn: async () => {
      const res = await fetch(api.agentTasks.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch agent tasks");
      return api.agentTasks.list.responses[200].parse(await res.json());
    },
    // Poll every 5 seconds for status updates
    refetchInterval: 5000,
  });
}

export function useCreateAgentTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateAgentTaskRequest) => {
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
