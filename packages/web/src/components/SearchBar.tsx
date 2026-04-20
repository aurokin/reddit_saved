import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "./ui/input";

/** Debounced search bar. Calls `onSearch` with the trimmed query after `debounceMs`. */
export function SearchBar({
  value,
  onSearch,
  placeholder = "Search saved posts...",
  debounceMs = 250,
  autoFocus,
}: {
  value?: string;
  onSearch: (query: string) => void;
  placeholder?: string;
  debounceMs?: number;
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState(value ?? "");
  const latestOnSearch = useRef(onSearch);
  const lastSubmitted = useRef((value ?? "").trim());

  useEffect(() => {
    latestOnSearch.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    lastSubmitted.current = (value ?? "").trim();
    setInput(value ?? "");
  }, [value]);

  useEffect(() => {
    const normalizedInput = input.trim();
    if (normalizedInput === lastSubmitted.current) return;

    const t = setTimeout(() => {
      lastSubmitted.current = normalizedInput;
      latestOnSearch.current(normalizedInput);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [input, debounceMs]);

  return (
    <div className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
      <Input
        type="search"
        value={input}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setInput(e.currentTarget.value)}
        className="h-9 pl-8"
        aria-label="Search"
        data-testid="search-input"
      />
    </div>
  );
}
