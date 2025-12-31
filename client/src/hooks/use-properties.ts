import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertProperty } from "@shared/routes";
import { z } from "zod";

export function useProperties() {
  return useQuery({
    queryKey: [api.properties.list.path],
    queryFn: async () => {
      const res = await fetch(api.properties.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch properties");
      return api.properties.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertProperty) => {
      // Coerce numeric strings to numbers if needed (though schema uses numeric string for decimals usually)
      const validated = api.properties.create.input.parse(data);
      const res = await fetch(api.properties.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create property");
      return api.properties.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.properties.list.path] });
    },
  });
}
