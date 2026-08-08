import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchWorkCategories } from "@/lib/api/work-categories";

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
    queryFn: () => fetchWorkCategories({ data: {} }),
  });

  const categories = data?.data ?? [];

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
      </SelectContent>
    </Select>
  );
}

const CATEGORY_TONES: Record<string, string> = {
  civil: "bg-blue-100 text-blue-700",
  structural: "bg-purple-100 text-purple-700",
  uncategorized: "bg-muted text-muted-foreground",
};

export function WorkCategoryBadge({ category }: { category: string }) {
  const { data } = useQuery({
    queryKey: ["workCategories"],
    queryFn: () => fetchWorkCategories({ data: {} }),
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
