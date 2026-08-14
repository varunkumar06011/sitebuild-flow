import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchWorkCategories, createWorkCategory } from "@/lib/api/work-categories";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export function WorkCategorySelect({
  value,
  onChange,
  placeholder = "Select work category",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ["workCategories"],
    queryFn: () => fetchWorkCategories(),
  });
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const categories = data?.data ?? [];

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    const name = newLabel.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
    if (!name) {
      toast.error("Category name must contain at least one letter or number");
      return;
    }
    try {
      const result = await createWorkCategory({
        name,
        label: newLabel.trim(),
        sort_order: 99,
      });
      if (result.success) {
        toast.success("Category created");
        qc.invalidateQueries({ queryKey: ["workCategories"] });
        onChange(name);
        setCreating(false);
        setNewLabel("");
      } else {
        toast.error(result.error || "Failed to create category");
      }
    } catch {
      toast.error("Failed to create category");
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Category label (e.g. MEP Work)"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") {
              setCreating(false);
              setNewLabel("");
            }
          }}
        />
        <Button size="sm" onClick={handleCreate} disabled={!newLabel.trim()}>
          Add
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCreating(false);
            setNewLabel("");
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {categories.map((cat) => (
          <SelectItem key={cat.id} value={cat.name}>
            {cat.label}
          </SelectItem>
        ))}
        <div className="border-t pt-1 mt-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCreating(true);
            }}
          >
            <Plus className="mr-1 size-3.5" /> Create new category...
          </Button>
        </div>
      </SelectContent>
    </Select>
  );
}

const CATEGORY_TONES: Record<string, string> = {
  civil: "bg-blue-100 text-blue-700",
  medical: "bg-emerald-100 text-emerald-700",
  uncategorized: "bg-muted text-muted-foreground",
};

export function WorkCategoryBadge({ category }: { category: string }) {
  const { data } = useQuery({
    queryKey: ["workCategories"],
    queryFn: () => fetchWorkCategories(),
  });

  const categories = data?.data ?? [];
  const cat = categories.find((c) => c.name === category);
  const label = cat?.label ?? "Uncategorized";
  const tone = CATEGORY_TONES[category] ?? CATEGORY_TONES["uncategorized"];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}
