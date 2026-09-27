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
  CheckCircle,
  Building,
} from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";
import { toast } from "@/state/toast";

export type Branch = {
  id: string;
  name: string;
  platform_status: "active" | "suspended" | "inactive";
  members_count: number;
  orders_count: number;
};

const emptyForm = {
  name: "",
  platform_status: "active" as Branch["platform_status"],
};

export function BranchesSettingsTab() {
  const can = useSession((s) => s.can);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isAdmin = can(["admin"]);

  const branchesQuery = useQuery({
    queryKey: ["store-branches", storeId],
    queryFn: async () => (await api.get<{ data: Branch[] }>("/api/store-branches")).data ?? [],
    enabled: Boolean(storeId) && isAdmin,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["store-branches"] });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        platform_status: form.platform_status,
      };
      return editingId
        ? api.patch(`/api/store-branches/${editingId}`, payload)
        : api.post("/api/store-branches", payload);
    },
    onSuccess: () => {
      setIsModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? "Branch updated successfully." : "New branch added successfully.");
      refresh();
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

  return (
    <div className="settings-tab-pane">
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-title-group">
            <div className="settings-icon-badge badge-branches">
              <GitBranch size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="settings-card-heading">Multi-Location Branches</h2>
              <p className="settings-card-subheading">
                Configure physical branch outlets, warehouses, and till distribution locations
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
        {branchesQuery.isLoading ? (
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
              const statusClass =
                branch.platform_status === "active"
                  ? "status-active"
                  : branch.platform_status === "suspended"
                    ? "status-suspended"
                    : "status-inactive";

              return (
                <div key={branch.id} className="branch-card">
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
                    <button
                      type="button"
                      className="category-action-btn"
                      title="Edit Branch"
                      onClick={() => {
                        setEditingId(branch.id);
                        setForm({
                          name: branch.name,
                          platform_status: branch.platform_status,
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
                      disabled={remove.isPending}
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
                  disabled={save.isPending || !form.name.trim()}
                >
                  <CheckCircle size={15} />
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
