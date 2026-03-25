import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface OwningEntitySelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}

interface EntitiesResponse {
  entities: string[];
}

const PERSONAL_DEFAULT = "__personal__";
const ADD_NEW = "__add_new__";

export function OwningEntitySelect({
  value,
  onChange,
  className,
}: OwningEntitySelectProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");

  const { data } = useQuery<EntitiesResponse>({
    queryKey: ["/api/portfolio/entities"],
    staleTime: 60 * 1000,
  });

  const entities = data?.entities ?? [];

  const handleSelectChange = (selected: string) => {
    if (selected === ADD_NEW) {
      setIsAddingNew(true);
      return;
    }
    if (selected === PERSONAL_DEFAULT) {
      onChange(null);
      return;
    }
    onChange(selected);
  };

  const handleAddNew = () => {
    const trimmed = newEntityName.trim();
    if (trimmed) {
      onChange(trimmed);
      setNewEntityName("");
    }
    setIsAddingNew(false);
  };

  const handleCancelNew = () => {
    setNewEntityName("");
    setIsAddingNew(false);
  };

  if (isAddingNew) {
    return (
      <div className={className}>
        <Label htmlFor="new-entity-input">Owning Entity (optional)</Label>
        <div className="flex items-center gap-2 mt-1.5">
          <Input
            id="new-entity-input"
            placeholder="e.g. Smith Land LLC"
            value={newEntityName}
            onChange={(e) => setNewEntityName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddNew();
              if (e.key === "Escape") handleCancelNew();
            }}
            aria-label="New entity name"
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAddNew}
            aria-label="Confirm new entity"
          >
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleCancelNew}
            aria-label="Cancel adding new entity"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <Label htmlFor="owning-entity-select">Owning Entity (optional)</Label>
      <Select
        value={value ?? PERSONAL_DEFAULT}
        onValueChange={handleSelectChange}
      >
        <SelectTrigger
          id="owning-entity-select"
          className="mt-1.5"
          aria-label="Owning Entity (optional)"
        >
          <SelectValue placeholder="Personal / Default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PERSONAL_DEFAULT}>Personal / Default</SelectItem>
          {entities.map((entity) => (
            <SelectItem key={entity} value={entity}>
              {entity}
            </SelectItem>
          ))}
          <SelectItem value={ADD_NEW}>
            <span className="flex items-center gap-1">
              <Plus className="w-3 h-3" />
              Add new entity
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
