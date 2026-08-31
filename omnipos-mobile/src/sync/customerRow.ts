const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value?: string | null): boolean {
  return Boolean(value && UUID_REGEX.test(value.trim()));
}

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
    total_spend: Number(payload.total_spend ?? 0),
    outstanding_balance: Number(payload.outstanding_balance ?? 0),
    notes: payload.notes ?? null,
  };

  if (payload.id && isUuid(payload.id)) {
    row.id = payload.id;
  }

  return row;
}

