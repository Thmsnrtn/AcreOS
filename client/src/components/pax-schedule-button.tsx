import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
              <Clock className="w-4 h-4 text-primary" aria-hidden="true" />
              Schedule task
            </DialogTitle>
          </DialogHeader>

          <form
            id="pax-schedule-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!taskName.trim() || createMutation.isPending) return;
              createMutation.mutate();
            }}
          >
            <div>
              <Label htmlFor="pax-task-name" className="text-xs text-muted-foreground mb-1 block">Task name</Label>
              <Input
                id="pax-task-name"
                autoFocus
                placeholder="Morning briefing"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                autoCapitalize="sentences"
                required
                className="text-sm"
              />
            </div>

            <div>
              <Label htmlFor="pax-schedule" className="text-xs text-muted-foreground mb-1 block">Schedule</Label>
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger id="pax-schedule" className="text-sm">
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
              <p className="text-xs text-muted-foreground mb-1 block">Prompt preview</p>
              <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground line-clamp-3">
                {currentPrompt}
              </div>
            </div>
          </form>

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              form="pax-schedule-form"
              size="sm"
              disabled={!taskName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" aria-hidden="true" /> : null}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
