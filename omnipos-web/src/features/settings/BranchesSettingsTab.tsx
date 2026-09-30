import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  Plus,
  Pencil,
  Trash2,
  Users,
  Receipt,
  X,
  CheckCircle2,
  Building,
  ArrowRightLeft,
  Store,
  WifiOff,
} from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { toast } from "@/state/toast";

export type Branch = {
  id: string;
  name: string;
  platform_status: "active" | "suspended" | "inactive";
  members_count: number;
  orders_count: number;
};

export type StoreItem = {
  id: string;
  name: string;
  is_branch: boolean;
  parent_store_id: string | null;
};

const emptyForm = {
  name: "",
  platform_status: "active" as Branch["platform_status"],
  switchAfterCreate: true,
};

export function BranchesSettingsTab() {
  const can = useSession((s) => s.can);
  const storeId = useSession((s) => s.storeId);
  const currentStore = useSession((s) => s.store);
  const selectStore = useSession((s) => s.selectStore);
  const isOnline = useSync((s) => s.online);
  const queryClient = useQueryClient();

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const isAdmin = can(["admin"]);

  // Fetch branches with offline localStorage cache
  const branchesQuery = useQuery({
    queryKey: ["store-branches", storeId],
    queryFn: async () => {
      try {
        const res = (await api.get<{ data: Branch[] }>("/api/store-branches")).data ?? [];
        if (storeId) {
          localStorage.setItem(`omnipos_branches_${storeId}`, JSON.stringify(res));
        }
        return res;
      } catch (err) {
        if (storeId) {
          const cached = localStorage.getItem(`omnipos_branches_${storeId}`);
          if (cached) return JSON.parse(cached) as Branch[];
        }
        throw err;
      }
    },
    enabled: Boolean(storeId) && isAdmin,
  });

  // Fetch all stores and branches the user has access to
  const storesQuery = useQuery({
    queryKey: ["user-accessible-stores"],
    queryFn: async () => {
      try {
        const res = (await api.get<{ data: StoreItem[] }>("/api/stores")).data ?? [];
        localStorage.setItem("omnipos_accessible_stores", JSON.stringify(res));
        return res;
      } catch (err) {
        const cached = localStorage.getItem("omnipos_accessible_stores");
        if (cached) return JSON.parse(cached) as StoreItem[];
        return [];
      }
    },
    enabled: isAdmin,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["store-branches"] });
    void queryClient.invalidateQueries({ queryKey: ["user-accessible-stores"] });
  };

  const handleSwitchStore = async (targetId: string, targetName: string) => {
    if (targetId === storeId) return;
    setSwitchingId(targetId);
    try {
      await selectStore(targetId);
      toast.success(`Active store switched to "${targetName}".`);
      await queryClient.invalidateQueries();
    } catch {
      toast.error(`Could not switch to store "${targetName}".`);
    } finally {
      setSwitchingId(null);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        platform_status: form.platform_status,
      };
      if (editingId) {
        return (await api.patch<{ branch: StoreItem }>(`/api/store-branches/${editingId}`, payload)).branch;
      }
      return (await api.post<{ branch: StoreItem }>("/api/store-branches", payload)).branch;
    },
    onSuccess: async (createdBranch) => {
      const isNew = !editingId;
      const shouldSwitch = isNew && form.switchAfterCreate && createdBranch?.id;

      setIsModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? "Branch updated successfully." : "New branch added successfully.");
      refresh();

      if (shouldSwitch) {
        await handleSwitchStore(createdBranch.id, createdBranch.name);
      }
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : "Could not save the branch.";
      toast.error(msg);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-branches/${id}`),
    onSuccess: () => {
      toast.success("Branch removed successfully.");
      refresh();
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : "Could not delete the branch.";
      toast.error(msg);
    },
  });

  if (!isAdmin) return null;

  const branchList = branchesQuery.data ?? [];
  const allStores = storesQuery.data ?? [];
  const otherStores = allStores.filter((s) => s.id !== storeId);

  return (
    <div className="settings-tab-pane">
      {!isOnline && (
        <div
          className="action-alert-banner alert-warn-theme"
          role="status"
          style={{ marginBottom: "1rem" }}
        >
          <div className="alert-left-content">
            <WifiOff size={16} />
            <span>
              <strong>Offline Mode:</strong> Branch directory is displayed from local device cache. You can still switch between stores locally.
            </span>
          </div>
        </div>
      )}

      {/* --- Store Switcher & Estate Hub Card --- */}
      {otherStores.length > 0 && (
        <div className="settings-card" style={{ marginBottom: "1.25rem" }}>
          <div className="settings-card-header">
            <div className="settings-title-group">
              <div className="settings-icon-badge" style={{ background: "rgba(7, 103, 222, 0.12)", color: "#0767de" }}>
                <Store size={20} aria-hidden="true" />
              </div>
              <div>
                <h2 className="settings-card-heading">Switch Active Store Location</h2>
                <p className="settings-card-subheading">
                  Quickly switch active workspace context between organization stores and branch outlets
                </p>
              </div>
            </div>

            <span className="settings-pill-badge badge-admin">
              Currently: <strong>{currentStore?.name ?? "Active Store"}</strong>
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "0.75rem",
              marginTop: "0.5rem",
            }}
          >
            {allStores.map((st) => {
              const isCurrent = st.id === storeId;
              const isSwitching = switchingId === st.id;

              return (
                <div
                  key={st.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.75rem 1rem",
                    borderRadius: "var(--radius-sm)",
                    border: isCurrent ? "2px solid var(--accent)" : "1px solid var(--line)",
                    background: isCurrent ? "var(--accent-soft)" : "var(--panel-2)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                    <Building size={16} color={isCurrent ? "var(--accent-text)" : "var(--muted)"} />
                    <div style={{ display: "grid", gap: "0.1rem", minWidth: 0 }}>
                      <strong
                        style={{
                          fontSize: "0.85rem",
                          color: isCurrent ? "var(--accent-text)" : "var(--text-strong)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {st.name}
                      </strong>
                      <small style={{ color: "var(--muted)", fontSize: "0.7rem" }}>
                        {st.is_branch ? "Branch Outlet" : "Primary Organization"}
                      </small>
                    </div>
                  </div>

                  {isCurrent ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        color: "var(--ok)",
                      }}
                    >
                      <CheckCircle2 size={14} /> Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="branch-switch-btn"
                      disabled={isSwitching}
                      onClick={() => handleSwitchStore(st.id, st.name)}
                      title={`Switch active till context to ${st.name}`}
                    >
                      <ArrowRightLeft size={13} />
                      <span>{isSwitching ? "Switching…" : "Switch"}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- Main Multi-Location Branches Card --- */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-title-group">
            <div className="settings-icon-badge badge-branches">
              <GitBranch size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="settings-card-heading">Multi-Location Branches</h2>
              <p className="settings-card-subheading">
                Configure physical branch outlets, warehouses, and till distribution locations attached to this store
              </p>
            </div>
          </div>

          <button
            type="button"
            className="settings-btn-primary"
            onClick={() => {
              setForm(emptyForm);
              setEditingId(null);
              setIsModalOpen(true);
            }}
          >
            <Plus size={16} />
            <span>Add Branch Outlet</span>
          </button>
        </div>

        {/* Branches Grid */}
        {branchesQuery.isLoading && !branchesQuery.data ? (
          <p className="muted" style={{ padding: "1rem" }}>
            Loading store branches…
          </p>
        ) : branchList.length === 0 ? (
          <div className="chart-empty-state">
            <Building size={24} className="muted" />
            <strong>No secondary branches configured</strong>
            <small className="muted">
              Add branch locations to partition stock, manage localized registers, and track sales by outlet.
            </small>
          </div>
        ) : (
          <div className="branches-grid">
            {branchList.map((branch) => {
              const isCurrent = branch.id === storeId;
              const isSwitching = switchingId === branch.id;
              const statusClass =
                branch.platform_status === "active"
                  ? "status-active"
                  : branch.platform_status === "suspended"
                    ? "status-suspended"
                    : "status-inactive";

              return (
                <div
                  key={branch.id}
                  className="branch-card"
                  style={{
                    border: isCurrent ? "2px solid var(--accent)" : undefined,
                  }}
                >
                  <div className="branch-card-top">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                      <Building size={18} color="var(--accent-text)" />
                      <strong className="branch-name">{branch.name}</strong>
                    </div>
                    <span className={`branch-status-pill ${statusClass}`}>
                      {branch.platform_status}
                    </span>
                  </div>

                  <div className="branch-metrics-row">
                    <div className="branch-stat">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <Users size={13} className="muted" />
                        <strong className="branch-stat-val">{branch.members_count}</strong>
                      </div>
                      <span className="branch-stat-label">Assigned Staff</span>
                    </div>

                    <div className="branch-stat">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <Receipt size={13} className="muted" />
                        <strong className="branch-stat-val">{branch.orders_count}</strong>
                      </div>
                      <span className="branch-stat-label">Processed Orders</span>
                    </div>
                  </div>

                  <div className="branch-card-footer">
                    {isCurrent ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          color: "var(--ok)",
                        }}
                      >
                        <CheckCircle2 size={14} /> Active Store
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="branch-switch-btn"
                        disabled={isSwitching}
                        onClick={() => handleSwitchStore(branch.id, branch.name)}
                        title={`Switch active session to ${branch.name}`}
                      >
                        <ArrowRightLeft size={13} />
                        <span>{isSwitching ? "Switching…" : "Switch to Branch"}</span>
                      </button>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="category-action-btn"
                        title="Edit Branch"
                        onClick={() => {
                          setEditingId(branch.id);
                          setForm({
                            name: branch.name,
                            platform_status: branch.platform_status,
                            switchAfterCreate: false,
                          });
                          setIsModalOpen(true);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="category-action-btn btn-danger"
                        title="Delete Branch"
                        disabled={remove.isPending || !isOnline}
                        onClick={() => {
                          if (window.confirm(`Delete branch outlet "${branch.name}"?`)) {
                            remove.mutate(branch.id);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Branch Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <GitBranch size={18} color="var(--accent-text)" />
                <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>
                  {editingId ? "Edit Branch Location" : "Add Branch Outlet"}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (form.name.trim() && !save.isPending) {
                  save.mutate();
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.5rem" }}
            >
              <div className="settings-field-group">
                <label className="settings-label" htmlFor="branch-modal-name">
                  Branch Outlet Name
                </label>
                <input
                  id="branch-modal-name"
                  className="settings-input"
                  placeholder="e.g. Downtown Mall, Airport Kiosk, West Warehouse…"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div className="settings-field-group">
                <label className="settings-label" htmlFor="branch-modal-status">
                  Operational Status
                </label>
                <select
                  id="branch-modal-status"
                  className="settings-input"
                  value={form.platform_status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      platform_status: e.target.value as Branch["platform_status"],
                    })
                  }
                >
                  <option value="active">Active (Trading & Syncing)</option>
                  <option value="suspended">Suspended (Temporary Freeze)</option>
                  <option value="inactive">Inactive (Decommissioned)</option>
                </select>
              </div>

              {!editingId && (
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", cursor: "pointer", color: "var(--text-strong)" }}>
                  <input
                    type="checkbox"
                    checked={form.switchAfterCreate}
                    onChange={(e) => setForm({ ...form, switchAfterCreate: e.target.checked })}
                  />
                  <span>Switch to this branch immediately after creation</span>
                </label>
              )}

              <div className="modal-actions" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="settings-btn-primary"
                  disabled={save.isPending || !form.name.trim() || !isOnline}
                >
                  <CheckCircle2 size={15} />
                  <span>{save.isPending ? "Saving…" : editingId ? "Save Branch" : "Add Branch"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
