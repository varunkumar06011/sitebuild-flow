import { api } from "../api-client";

export function getVendorScorecard(data: { vendorId: string }): Promise<any> {
  return api.get(`/api/vendor-scorecard/${data.vendorId}`);
}
