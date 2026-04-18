import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Clock, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const SCHEDULE_PRESETS = [
  { value: "daily_8am", label: "Every day at 8 AM" },
  { value: "daily_6pm", label: "Every day at 6 PM" },
  { value: "weekly_monday_9am", label: "Every Monday at 9 AM" },
  { value: "weekly_friday_5pm", label: "Every Friday at 5 PM" },
  { value: "hourly", label: "Every hour" },
];

interface PaxScheduleButtonProps {
  currentPrompt: string;
  disabled?: boolean;
}

export function PaxScheduleButton({ currentPrompt, disabled }: PaxScheduleButtonProps) {
  const [open, setOpen] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [schedule, setSchedule] = useState("daily_8am");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  );
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/ai/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: taskName, prompt: currentPrompt, schedule, timezone }),
      });
      if (!r.ok) throw new Error("Failed to create task");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/scheduled-tasks"] });
      setOpen(false);
      setTaskName("");
    },
  });

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => setOpen(true)}
            disabled={disabled || !currentPrompt.trim()}
            aria-label="Schedule task"
          >
            <Clock className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Schedule this prompt</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Schedule Task
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Task name</label>
              <Input
                autoFocus
                placeholder="Morning Briefing"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                className="text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Schedule</label>
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-sm">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Prompt preview</label>
              <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground line-clamp-3">
                {currentPrompt}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!taskName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
