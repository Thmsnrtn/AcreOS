import { ListTodo } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

interface TasksEmptyStateProps {
  onAddTask?: () => void;
}

/**
 * Surface-specific empty state for the Tasks surface.
 * Thin wrapper around the canonical EmptyState primitive.
 * Agency-frame copy (Joanna wave 3): names what Pax does the moment the user acts.
 */
export function TasksEmptyState({ onAddTask }: TasksEmptyStateProps) {
  return (
    <EmptyState
      icon={ListTodo}
      headline="Nothing on your list yet"
      subtitle="Add a task and link it to a lead, deal, or parcel — Pax slides follow-ups in automatically as deals age past 5 days."
      cta={{
        label: "Create your first task",
        onClick: onAddTask,
        "data-testid": "button-add-task-empty",
      }}
      actionIcon={null}
      tips={[
        "Pax adds a follow-up task the moment a seller goes 5 days silent — you don't have to remember the cool-off window",
        "Wire tasks to leads, deals, or parcels — Pax surfaces them on Today the morning they're due",
      ]}
      testId="empty-state-tasks"
    />
  );
}
