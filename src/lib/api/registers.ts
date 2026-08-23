// Frontend API wrapper for register calls (visitors, vehicles).
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/registers/visitors
export function fetchVisitors(data: {
  page?: number;
  limit?: number;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/registers/visitors", data);
}

// GET /api/registers/vehicles
export function fetchVehicles(data: {
  page?: number;
  limit?: number;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/registers/vehicles", data);
}

// POST /api/registers/visitors/create
export function createVisitor(data: {
  name: string;
  org?: string;
  purpose?: string;
  host?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/registers/visitors/create", data);
}

// POST /api/registers/vehicles/create
export function createVehicle(data: {
  number: string;
  type?: string;
  driver?: string;
  material?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/registers/vehicles/create", data);
}

// POST /api/registers/visitors/checkout
export function checkOutVisitor(data: {
  id: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/registers/visitors/checkout", data);
}

// POST /api/registers/vehicles/checkout
export function checkOutVehicle(data: {
  id: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/registers/vehicles/checkout", data);
}
