import { api } from "../api-client";

export type SearchResult = {
  type: string;
  id: string;
  label: string;
  sublabel: string;
  route: string;
};

export function globalEntitySearch(params: { query: string }) {
  return api.get("/api/global-search", params);
}
