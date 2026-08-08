export type CustomerUpsertPayload = {
  id?: string;
  store_id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  total_spend?: number;
  outstanding_balance?: number;
  notes?: string | null;
};

export function buildCustomerRowForSupabase(payload: CustomerUpsertPayload): Record<string, unknown> {
  const row: Record<string, unknown> = {
    store_id: payload.store_id,
    name: payload.name,
    phone: payload.phone ?? null,
    email: payload.email ?? null,
    total_spend: payload.total_spend ?? 0,
    outstanding_balance: payload.outstanding_balance ?? 0,
    notes: payload.notes ?? null,
  };

  if (payload.id && payload.id.length > 20) {
    row.id = payload.id;
  }

  return row;
}
