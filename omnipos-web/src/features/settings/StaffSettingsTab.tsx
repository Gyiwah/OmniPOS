import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  Mail,
  Shield,
  Eye,
  EyeOff,
  Clock,
  Trash2,
  Lock,
  User,
  X,
  CheckCircle,
} from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";
import { toast } from "@/state/toast";

export type Member = {
  id: string;
  user_id: string;
  role: string;
  name: string | null;
  email: string | null;
};

export type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
};

const ROLES = ["admin", "manager", "cashier"] as const;

const ROLE_COLORS: Record<string, { bg: string; text: string; avatarBg: string }> = {
  admin: {
    bg: "rgba(139, 92, 246, 0.12)",
    text: "#8b5cf6",
    avatarBg: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
  },
  manager: {
    bg: "rgba(7, 103, 222, 0.12)",
    text: "#0767de",
    avatarBg: "linear-gradient(135deg, #0767de 0%, #0554b8 100%)",
  },
  cashier: {
    bg: "rgba(22, 163, 74, 0.12)",
    text: "#16a34a",
    avatarBg: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
  },
};

export function StaffSettingsTab() {
  const can = useSession((s) => s.can);
  const currentUserId = useSession((s) => s.user?.id);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<"members" | "invites">("members");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<"direct" | "invite">("direct");

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<string>("cashier");

  const isAdmin = can(["admin"]);
  const mayManage = can(["admin", "manager"]);

  const membersQuery = useQuery({
    queryKey: ["store-members", storeId],
    queryFn: async () => (await api.get<{ data: Member[] }>("/api/store-members")).data ?? [],
    enabled: Boolean(storeId) && mayManage,
  });

  const invitesQuery = useQuery({
    queryKey: ["store-invites", storeId],
    queryFn: async () => (await api.get<{ data: Invite[] }>("/api/store-invites")).data ?? [],
    enabled: Boolean(storeId) && mayManage,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["store-members"] });
    await queryClient.invalidateQueries({ queryKey: ["store-invites"] });
  };

  const fail = (error: unknown) => {
    const msg = error instanceof Error ? error.message : "That did not work.";
    toast.error(msg);
  };

  const addDirect = useMutation({
    mutationFn: () =>
      api.post("/api/store-members", {
        name: name.trim(),
        email: email.trim(),
        password: password.trim(),
        role,
      }),
    onSuccess: async () => {
      const addedName = name.trim();
      setName("");
      setEmail("");
      setPassword("");
      setShowAddModal(false);
      toast.success(`Staff member "${addedName}" added successfully.`);
      await refresh();
    },
    onError: fail,
  });

  const invite = useMutation({
    mutationFn: () => api.post<{ message: string }>("/api/store-invites", { email: email.trim(), role }),
    onSuccess: async (res) => {
      setEmail("");
      setShowAddModal(false);
      toast.success(res.message);
      await refresh();
    },
    onError: fail,
  });

  const changeRole = useMutation({
    mutationFn: (input: { id: string; role: string }) =>
      api.patch(`/api/store-members/${input.id}`, { role: input.role }),
    onSuccess: async () => {
      toast.success("Role updated successfully.");
      await refresh();
    },
    onError: fail,
  });

  const removeMember = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-members/${id}`),
    onSuccess: async () => {
      toast.success("Staff member removed from this store.");
      await refresh();
    },
    onError: fail,
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-invites/${id}`),
    onSuccess: async () => {
      toast.success("Staff invitation revoked.");
      await refresh();
    },
    onError: fail,
  });

  const membersList = membersQuery.data ?? [];
  const pendingInvites = useMemo(
    () => (invitesQuery.data ?? []).filter((i) => i.status === "pending"),
    [invitesQuery.data]
  );

  if (!mayManage) return null;

  return (
    <div className="settings-tab-pane">
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-title-group">
            <div className="settings-icon-badge badge-staff">
              <Users size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="settings-card-heading">Staff & Access Permissions</h2>
              <p className="settings-card-subheading">
                Manage cashier accounts, manager clearances, and staff access roles
              </p>
            </div>
          </div>

          <button
            type="button"
            className="settings-btn-primary"
            onClick={() => setShowAddModal(true)}
          >
            <UserPlus size={16} />
            <span>Add Team Member</span>
          </button>
        </div>

        {/* Segmented Sub Tabs */}
        <div className="staff-segmented-row">
          <div className="staff-segmented-tabs">
            <button
              type="button"
              className={`staff-seg-btn ${activeSubTab === "members" ? "active" : ""}`}
              onClick={() => setActiveSubTab("members")}
            >
              <Users size={14} />
              <span>Active Team ({membersList.length})</span>
            </button>
            <button
              type="button"
              className={`staff-seg-btn ${activeSubTab === "invites" ? "active" : ""}`}
              onClick={() => setActiveSubTab("invites")}
            >
              <Mail size={14} />
              <span>Pending Invites ({pendingInvites.length})</span>
            </button>
          </div>
        </div>

        {/* --- Active Members List --- */}
        {activeSubTab === "members" && (
          <div className="staff-roster-list">
            {membersQuery.isLoading ? (
              <p className="muted" style={{ padding: "1rem" }}>
                Loading staff members…
              </p>
            ) : membersList.length === 0 ? (
              <div className="chart-empty-state">
                <Users size={24} className="muted" />
                <strong>No staff members registered</strong>
                <small className="muted">Add cashiers or managers using the button above.</small>
              </div>
            ) : (
              membersList.map((m) => {
                const initials = (m.name ?? m.email ?? "U")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                const roleMeta = ROLE_COLORS[m.role] ?? ROLE_COLORS.cashier;
                const isYou = m.user_id === currentUserId;

                return (
                  <div key={m.id} className="staff-roster-row">
                    <div className="staff-user-cell">
                      <div
                        className="staff-avatar"
                        style={{ background: roleMeta.avatarBg }}
                      >
                        {initials}
                      </div>

                      <div className="staff-user-meta">
                        <div className="staff-user-name">
                          <span>{m.name || "Unnamed Staff Member"}</span>
                          {isYou && <span className="you-pill">You</span>}
                        </div>
                        <span className="staff-user-email">{m.email ?? "—"}</span>
                      </div>
                    </div>

                    <div className="staff-role-control">
                      <select
                        className="role-select"
                        value={m.role}
                        aria-label={`Role for ${m.name ?? m.email ?? "member"}`}
                        disabled={changeRole.isPending || !isAdmin}
                        onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value })}
                        style={{
                          background: roleMeta.bg,
                          color: roleMeta.text,
                          borderColor: `color-mix(in srgb, ${roleMeta.text} 30%, transparent)`,
                        }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} disabled={r === "admin" && !isAdmin}>
                            {r.toUpperCase()}
                          </option>
                        ))}
                      </select>

                      {isAdmin && !isYou && (
                        <button
                          type="button"
                          className="category-action-btn btn-danger"
                          title={`Remove ${m.name ?? "staff member"} from this store`}
                          disabled={removeMember.isPending}
                          onClick={() => {
                            if (window.confirm(`Remove ${m.name ?? m.email} from store staff?`)) {
                              removeMember.mutate(m.id);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* --- Pending Invites List --- */}
        {activeSubTab === "invites" && (
          <div className="staff-roster-list">
            {invitesQuery.isLoading ? (
              <p className="muted" style={{ padding: "1rem" }}>
                Loading invites…
              </p>
            ) : pendingInvites.length === 0 ? (
              <div className="chart-empty-state">
                <Mail size={24} className="muted" />
                <strong>No pending invites</strong>
                <small className="muted">All staff invitations have either been accepted or none have been sent.</small>
              </div>
            ) : (
              pendingInvites.map((inv) => {
                const roleMeta = ROLE_COLORS[inv.role] ?? ROLE_COLORS.cashier;

                return (
                  <div key={inv.id} className="staff-roster-row">
                    <div className="staff-user-cell">
                      <div
                        className="staff-avatar"
                        style={{ background: "var(--panel-2)", color: "var(--muted)", border: "1px dashed var(--line-strong)" }}
                      >
                        <Clock size={16} />
                      </div>

                      <div className="staff-user-meta">
                        <div className="staff-user-name">
                          <span>{inv.email}</span>
                          <span
                            className="settings-pill-badge"
                            style={{ background: roleMeta.bg, color: roleMeta.text }}
                          >
                            Invited as {inv.role.toUpperCase()}
                          </span>
                        </div>
                        <span className="staff-user-email">Awaiting user first-time sign in</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="category-action-btn btn-danger"
                      title="Revoke Invite"
                      disabled={revokeInvite.isPending}
                      onClick={() => {
                        if (window.confirm(`Revoke invitation for ${inv.email}?`)) {
                          revokeInvite.mutate(inv.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* --- Add Staff Modal --- */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal" style={{ width: "min(34rem, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <UserPlus size={18} color="var(--accent-text)" />
                <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Add Store Staff Member</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Mode Segmented Switch */}
            <div
              className="staff-segmented-tabs"
              style={{ width: "100%", justifyContent: "center", marginTop: "0.4rem" }}
            >
              <button
                type="button"
                className={`staff-seg-btn ${addMode === "direct" ? "active" : ""}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setAddMode("direct")}
              >
                <UserPlus size={14} /> Direct Account Creation
              </button>
              <button
                type="button"
                className={`staff-seg-btn ${addMode === "invite" ? "active" : ""}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setAddMode("invite")}
              >
                <Mail size={14} /> Email Invite
              </button>
            </div>

            {addMode === "direct" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!addDirect.isPending && name.trim() && email.trim() && password.length >= 8) {
                    addDirect.mutate();
                  }
                }}
                style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.6rem" }}
              >
                <div className="settings-field-group">
                  <label className="settings-label" htmlFor="new-staff-name">
                    Full Name
                  </label>
                  <div className="settings-input-wrap">
                    <span className="settings-input-icon">
                      <User size={16} />
                    </span>
                    <input
                      id="new-staff-name"
                      className="settings-input has-icon"
                      placeholder="Jane Doe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="settings-field-group">
                  <label className="settings-label" htmlFor="new-staff-email">
                    Login Email
                  </label>
                  <div className="settings-input-wrap">
                    <span className="settings-input-icon">
                      <Mail size={16} />
                    </span>
                    <input
                      id="new-staff-email"
                      type="email"
                      className="settings-input has-icon"
                      placeholder="jane@omnipos.store"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="settings-field-group">
                  <label className="settings-label" htmlFor="new-staff-pwd">
                    Initial Password (min 8 chars)
                  </label>
                  <div className="settings-input-wrap">
                    <span className="settings-input-icon">
                      <Lock size={16} />
                    </span>
                    <input
                      id="new-staff-pwd"
                      type={showPassword ? "text" : "password"}
                      className="settings-input has-icon"
                      placeholder="••••••••"
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="icon-button"
                      style={{ position: "absolute", right: "0.5rem" }}
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="settings-field-group">
                  <label className="settings-label" htmlFor="new-staff-role">
                    Access Permission Role
                  </label>
                  <div className="settings-input-wrap">
                    <span className="settings-input-icon">
                      <Shield size={16} />
                    </span>
                    <select
                      id="new-staff-role"
                      className="settings-input has-icon"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="cashier">Cashier (Till Checkout & Returns)</option>
                      <option value="manager">Manager (Reports, Shifts & Catalogue)</option>
                      <option value="admin" disabled={!isAdmin}>
                        Admin (Full Control across Store)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="modal-actions" style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowAddModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="settings-btn-primary"
                    disabled={addDirect.isPending || !name.trim() || !email.trim() || password.length < 8}
                  >
                    <CheckCircle size={15} />
                    <span>{addDirect.isPending ? "Creating Account…" : "Create Staff Account"}</span>
                  </button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!invite.isPending && email.trim()) {
                    invite.mutate();
                  }
                }}
                style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.6rem" }}
              >
                <div className="settings-field-group">
                  <label className="settings-label" htmlFor="invite-staff-email">
                    Recipient Email Address
                  </label>
                  <div className="settings-input-wrap">
                    <span className="settings-input-icon">
                      <Mail size={16} />
                    </span>
                    <input
                      id="invite-staff-email"
                      type="email"
                      className="settings-input has-icon"
                      placeholder="colleague@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <span className="settings-field-hint">
                    An email invitation link will be dispatched with instructions to join this store.
                  </span>
                </div>

                <div className="settings-field-group">
                  <label className="settings-label" htmlFor="invite-staff-role">
                    Access Permission Role
                  </label>
                  <div className="settings-input-wrap">
                    <span className="settings-input-icon">
                      <Shield size={16} />
                    </span>
                    <select
                      id="invite-staff-role"
                      className="settings-input has-icon"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="cashier">Cashier (Till Checkout & Returns)</option>
                      <option value="manager">Manager (Reports, Shifts & Catalogue)</option>
                      <option value="admin" disabled={!isAdmin}>
                        Admin (Full Control across Store)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="modal-actions" style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowAddModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="settings-btn-primary"
                    disabled={invite.isPending || !email.trim()}
                  >
                    <Mail size={15} />
                    <span>{invite.isPending ? "Sending Invitation…" : "Send Email Invitation"}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
