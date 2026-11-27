import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  FileWarning,
  Hash,
  History,
  Lock,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  PRIMARY_ADMIN_EMAIL,
  adminAddOrUpdateModerator,
  adminAddSuperAdmin,
  adminBanUser,
  adminDeleteGroupRoom,
  adminDeleteReport,
  adminDeleteUser,
  adminFetchRoomMembers,
  adminRemoveModerator,
  adminRemoveSuperAdmin,
  adminResetRateLimit,
  adminResetUserProfile,
  adminResolveReport,
  adminRestoreDeletedUser,
  fetchAdminDashboardData,
  fetchUserTrackingDetails,
  type AdminDashboardSnapshot,
} from '../lib/api';
import type {
  AdminChatRoomSummary,
  AdminRecord,
  DeletedUserRecord,
  ModerationActionType,
  ModeratorRecord,
  Profile,
  ReportEntry,
  StaffAccess,
  UserTrackingDetails,
} from '../types';

interface AdminDashboardProps {
  currentUser: Profile;
  currentUserEmail: string | null;
  staffAccess: StaffAccess;
  onBack: () => void;
  onOpenPublicProfile: (userId: string) => void;
  onToast: (message: string) => void;
}

type AdminTab = 'overview' | 'users' | 'staff' | 'reports' | 'rooms' | 'logs';
type UserFilter = 'all' | 'active' | 'banned' | 'staff' | 'removed';

function formatRelative(iso?: string | null): string {
  if (!iso) return 'Never';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'Never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatExactDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatActionLabel(action: ModerationActionType): string {
  const map: Record<ModerationActionType, string> = {
    ban_user: 'Banned user',
    unban_user: 'Unbanned user',
    delete_user: 'Deleted user',
    restore_user: 'Restored access',
    add_moderator: 'Added moderator',
    update_moderator: 'Updated moderator',
    remove_moderator: 'Removed moderator',
    add_admin: 'Added admin',
    remove_admin: 'Removed admin',
    resolve_report: 'Resolved report',
    dismiss_report: 'Dismissed report',
    reset_profile: 'Reset profile',
    reset_ratelimit: 'Cleared rate limit',
    delete_room: 'Deleted room',
  };
  return map[action] ?? action;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  currentUserEmail,
  staffAccess,
  onBack,
  onOpenPublicProfile,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  // Users directory state
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<UserFilter>('all');

  // Inspector drawer state
  const [inspectedUserId, setInspectedUserId] = useState<string | null>(null);
  const [trackingDetails, setTrackingDetails] = useState<UserTrackingDetails | null>(null);
  const [loadingTracking, setLoadingTracking] = useState(false);
  const [banReasonInput, setBanReasonInput] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Delete user confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Moderator / Admin assignment modal
  const [modModalOpen, setModModalOpen] = useState(false);
  const [modSearch, setModSearch] = useState('');
  const [modSelectedUid, setModSelectedUid] = useState<string>('');
  const [modRoleType, setModRoleType] = useState<'moderator' | 'admin'>('moderator');
  const [modCanBan, setModCanBan] = useState(true);
  const [modCanManageReports, setModCanManageReports] = useState(true);
  const [modCanManageRooms, setModCanManageRooms] = useState(false);
  const [modNote, setModNote] = useState('');
  const [editingModUid, setEditingModUid] = useState<string | null>(null);

  // Reports state
  const [reportFilter, setReportFilter] = useState<'pending' | 'resolved' | 'dismissed' | 'all'>(
    'pending',
  );
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});

  // Rooms state
  const [roomFilter, setRoomFilter] = useState<'all' | 'public_group' | 'private_group' | 'dm'>(
    'all',
  );
  const [roomSearch, setRoomSearch] = useState('');
  const [inspectedRoom, setInspectedRoom] = useState<AdminChatRoomSummary | null>(null);
  const [roomMembers, setRoomMembers] = useState<Profile[]>([]);
  const [loadingRoomMembers, setLoadingRoomMembers] = useState(false);
  const [deleteRoomTarget, setDeleteRoomTarget] = useState<AdminChatRoomSummary | null>(null);

  // Audit log filter
  const [logFilter, setLogFilter] = useState<'all' | 'bans' | 'deletes' | 'staff' | 'reports' | 'rooms'>(
    'all',
  );

  // Chart hover state
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);

  const loadData = useCallback(async (isManual = false) => {
    if (isManual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchAdminDashboardData();
      setSnapshot(data);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Unable to load admin telemetry.';
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed?.error) msg = parsed.error;
      } catch {
        // keep string
      }
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  // Lookup maps
  const profilesById = useMemo(() => {
    const map = new Map<string, Profile>();
    if (snapshot) {
      for (const p of snapshot.profiles) map.set(p.id, p);
    }
    return map;
  }, [snapshot]);

  const adminsById = useMemo(() => {
    const map = new Map<string, AdminRecord>();
    if (snapshot) {
      for (const a of snapshot.admins) map.set(a.uid, a);
    }
    return map;
  }, [snapshot]);

  const modsById = useMemo(() => {
    const map = new Map<string, ModeratorRecord>();
    if (snapshot) {
      for (const m of snapshot.moderators) map.set(m.uid, m);
    }
    return map;
  }, [snapshot]);

  const inspectedUser = useMemo(
    () => (inspectedUserId ? profilesById.get(inspectedUserId) ?? null : null),
    [inspectedUserId, profilesById],
  );

  useEffect(() => {
    if (!inspectedUserId) {
      setTrackingDetails(null);
      return;
    }
    let cancelled = false;
    setLoadingTracking(true);
    setBanReasonInput('');
    fetchUserTrackingDetails(inspectedUserId)
      .then((details) => {
        if (!cancelled) setTrackingDetails(details);
      })
      .finally(() => {
        if (!cancelled) setLoadingTracking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inspectedUserId]);

  const handleOpenRoomMembers = async (room: AdminChatRoomSummary) => {
    setInspectedRoom(room);
    setLoadingRoomMembers(true);
    try {
      const members = await adminFetchRoomMembers(room.id);
      setRoomMembers(members);
    } catch {
      setRoomMembers([]);
    } finally {
      setLoadingRoomMembers(false);
    }
  };

  // Computed Metrics & Real Chart Series
  const metrics = useMemo(() => {
    if (!snapshot) return null;
    const now = Date.now();
    const dayMs = 86_400_000;

    const totalUsers = snapshot.profiles.length;
    const bannedUsers = snapshot.profiles.filter((p) => p.banned).length;
    const activeAccounts = totalUsers - bannedUsers;
    const deletedCount = snapshot.deletedUsers.length;
    const staffAdminsCount = snapshot.admins.length + (staffAccess.isPrimaryOwner && !adminsById.has(currentUser.id) ? 1 : 0);
    const moderatorsCount = snapshot.moderators.length;

    let active24h = 0;
    let totalSessions = 0;
    let totalTrackedMessages = 0;
    for (const act of Object.values(snapshot.activities)) {
      totalSessions += act.sessionCount;
      totalTrackedMessages += act.messagesSentCount;
      const seenMs = new Date(act.lastSeenAt).getTime();
      if (!Number.isNaN(seenMs) && now - seenMs <= dayMs) {
        active24h += 1;
      }
    }

    const pendingReports = snapshot.reports.filter((r) => r.status === 'pending').length;
    const totalReports = snapshot.reports.length;
    const groupsCount = snapshot.chats.filter((c) => c.type === 'group').length;
    const dmsCount = snapshot.chats.filter((c) => c.type === 'dm').length;
    const totalMemberships = snapshot.chats.reduce((acc, c) => acc + c.memberCount, 0);

    // 7-day chart buckets (strictly derived from real Firestore timestamps)
    const days: {
      key: string;
      label: string;
      fullDate: string;
      signups: number;
      activeUsers: number;
      roomMessages: number;
    }[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      days.push({
        key: dayKey(d),
        label: d.toLocaleDateString([], { weekday: 'short' }),
        fullDate: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        signups: 0,
        activeUsers: 0,
        roomMessages: 0,
      });
    }

    const dayIndexByKey = new Map(days.map((d, idx) => [d.key, idx]));

    for (const p of snapshot.profiles) {
      if (p.createdAt) {
        const idx = dayIndexByKey.get(dayKey(new Date(p.createdAt)));
        if (idx !== undefined) days[idx].signups += 1;
      }
    }

    for (const act of Object.values(snapshot.activities)) {
      const idx = dayIndexByKey.get(dayKey(new Date(act.lastSeenAt)));
      if (idx !== undefined) days[idx].activeUsers += 1;
    }

    for (const chat of snapshot.chats) {
      if (chat.lastMessageAt) {
        const idx = dayIndexByKey.get(dayKey(new Date(chat.lastMessageAt)));
        if (idx !== undefined) days[idx].roomMessages += 1;
      }
    }

    const topActiveUsers = [...snapshot.profiles]
      .map((p) => ({
        profile: p,
        activity: snapshot.activities[p.id] ?? null,
      }))
      .sort((a, b) => {
        const msgDiff = (b.activity?.messagesSentCount ?? 0) - (a.activity?.messagesSentCount ?? 0);
        if (msgDiff !== 0) return msgDiff;
        const seenB = b.activity ? new Date(b.activity.lastSeenAt).getTime() : 0;
        const seenA = a.activity ? new Date(a.activity.lastSeenAt).getTime() : 0;
        return seenB - seenA;
      })
      .slice(0, 6);

    const topActiveRooms = [...snapshot.chats]
      .sort((a, b) => {
        const memberDiff = b.memberCount - a.memberCount;
        if (memberDiff !== 0) return memberDiff;
        return (
          new Date(b.lastMessageAt ?? b.createdAt).getTime() -
          new Date(a.lastMessageAt ?? a.createdAt).getTime()
        );
      })
      .slice(0, 6);

    const actionCounts: Record<string, number> = {};
    for (const log of snapshot.logs) {
      actionCounts[log.action] = (actionCounts[log.action] ?? 0) + 1;
    }

    return {
      totalUsers,
      activeAccounts,
      bannedUsers,
      deletedCount,
      staffAdminsCount,
      moderatorsCount,
      active24h,
      totalSessions,
      totalTrackedMessages,
      pendingReports,
      totalReports,
      groupsCount,
      dmsCount,
      totalMemberships,
      days,
      topActiveUsers,
      topActiveRooms,
      actionCounts,
    };
  }, [snapshot, staffAccess.isPrimaryOwner, adminsById, currentUser.id]);

  // Filtered users list
  const filteredUsers = useMemo(() => {
    if (!snapshot) return [];
    const q = userSearch.trim().toLowerCase();
    return snapshot.profiles.filter((p) => {
      const isStaffUser =
        adminsById.has(p.id) ||
        modsById.has(p.id) ||
        (p.id === currentUser.id && staffAccess.isPrimaryOwner);

      if (userFilter === 'active' && p.banned) return false;
      if (userFilter === 'banned' && !p.banned) return false;
      if (userFilter === 'staff' && !isStaffUser) return false;
      if (!q) return true;
      return (
        p.username.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.usernameHistory.some((h) => h.username.toLowerCase().includes(q))
      );
    });
  }, [snapshot, userSearch, userFilter, adminsById, modsById, currentUser.id, staffAccess.isPrimaryOwner]);

  const filteredDeletedUsers = useMemo(() => {
    if (!snapshot) return [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return snapshot.deletedUsers;
    return snapshot.deletedUsers.filter(
      (d) => d.username.toLowerCase().includes(q) || d.uid.toLowerCase().includes(q),
    );
  }, [snapshot, userSearch]);

  const filteredReports = useMemo(() => {
    if (!snapshot) return [];
    if (reportFilter === 'all') return snapshot.reports;
    return snapshot.reports.filter((r) => r.status === reportFilter);
  }, [snapshot, reportFilter]);

  const filteredRooms = useMemo(() => {
    if (!snapshot) return [];
    const q = roomSearch.trim().toLowerCase();
    return snapshot.chats.filter((c) => {
      if (roomFilter === 'public_group' && !(c.type === 'group' && c.visibility === 'public')) {
        return false;
      }
      if (roomFilter === 'private_group' && !(c.type === 'group' && c.visibility === 'private')) {
        return false;
      }
      if (roomFilter === 'dm' && c.type !== 'dm') return false;
      if (!q) return true;
      return (
        (c.name ?? '').toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.lastSenderUsername ?? '').toLowerCase().includes(q)
      );
    });
  }, [snapshot, roomFilter, roomSearch]);

  const filteredLogs = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.logs.filter((l) => {
      if (logFilter === 'all') return true;
      if (logFilter === 'bans') return l.action === 'ban_user' || l.action === 'unban_user';
      if (logFilter === 'deletes') return l.action === 'delete_user' || l.action === 'restore_user';
      if (logFilter === 'staff') {
        return (
          l.action === 'add_moderator' ||
          l.action === 'update_moderator' ||
          l.action === 'remove_moderator' ||
          l.action === 'add_admin' ||
          l.action === 'remove_admin'
        );
      }
      if (logFilter === 'reports') {
        return l.action === 'resolve_report' || l.action === 'dismiss_report';
      }
      if (logFilter === 'rooms') return l.action === 'delete_room';
      return true;
    });
  }, [snapshot, logFilter]);

  // Action handlers
  const actorRole: 'admin' | 'moderator' = staffAccess.isAdmin ? 'admin' : 'moderator';

  const canActOnTargetBan = (targetId: string): boolean => {
    if (targetId === currentUser.id) return false;
    if (staffAccess.isAdmin) return true;
    if (!staffAccess.canBan) return false;
    return !adminsById.has(targetId) && !modsById.has(targetId);
  };

  const handleToggleBan = async (target: Profile, reason?: string) => {
    setActionBusy(true);
    try {
      await adminBanUser(currentUser, actorRole, target, !target.banned, reason);
      onToast(target.banned ? `Unbanned ${target.username}.` : `Banned ${target.username}.`);
      setBanReasonInput('');
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update ban status.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDeleteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteTarget || deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    setActionBusy(true);
    try {
      await adminDeleteUser(currentUser, deleteTarget, deleteReason);
      onToast(`Permanently deleted ${deleteTarget.username} from Buddy Chat.`);
      if (inspectedUserId === deleteTarget.id) {
        setInspectedUserId(null);
      }
      setDeleteTarget(null);
      setDeleteReason('');
      setDeleteConfirmText('');
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to delete user.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRestoreDeletedUser = async (rec: DeletedUserRecord) => {
    setActionBusy(true);
    try {
      await adminRestoreDeletedUser(currentUser, rec);
      onToast(`Restored platform access for ${rec.username}.`);
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to restore access.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleResetProfile = async (
    target: Profile,
    opts: { clearBio?: boolean; clearAvatar?: boolean; randomizeUsername?: boolean },
  ) => {
    setActionBusy(true);
    try {
      await adminResetUserProfile(currentUser, target, opts);
      onToast(`Updated profile hygiene for ${target.username}.`);
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to reset profile.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleResetRateLimit = async (target: Profile) => {
    setActionBusy(true);
    try {
      await adminResetRateLimit(currentUser, target);
      onToast(`Cleared message cooldown for ${target.username}.`);
      const details = await fetchUserTrackingDetails(target.id);
      setTrackingDetails(details);
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to clear cooldown.');
    } finally {
      setActionBusy(false);
    }
  };

  const openAddStaffModal = (presetUser?: Profile, existingMod?: ModeratorRecord) => {
    setModSearch('');
    if (existingMod) {
      setEditingModUid(existingMod.uid);
      setModSelectedUid(existingMod.uid);
      setModRoleType('moderator');
      setModCanBan(existingMod.canBan);
      setModCanManageReports(existingMod.canManageReports);
      setModCanManageRooms(existingMod.canManageRooms);
      setModNote(existingMod.note ?? '');
    } else {
      setEditingModUid(null);
      setModSelectedUid(presetUser?.id ?? '');
      setModRoleType('moderator');
      setModCanBan(true);
      setModCanManageReports(true);
      setModCanManageRooms(false);
      setModNote('');
    }
    setModModalOpen(true);
  };

  const handleSaveStaffAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = profilesById.get(modSelectedUid);
    if (!target) {
      onToast('Select a valid user first.');
      return;
    }
    if (target.id === currentUser.id) {
      onToast('You already have Primary Admin access.');
      return;
    }
    setActionBusy(true);
    try {
      if (modRoleType === 'admin') {
        await adminAddSuperAdmin(currentUser, target, modNote);
        onToast(`Promoted ${target.username} to Super Admin.`);
      } else {
        await adminAddOrUpdateModerator(
          currentUser,
          target,
          {
            canBan: modCanBan,
            canManageReports: modCanManageReports,
            canManageRooms: modCanManageRooms,
            note: modNote,
          },
          Boolean(editingModUid),
        );
        onToast(
          editingModUid
            ? `Updated moderator permissions for ${target.username}.`
            : `Added ${target.username} as a Moderator.`,
        );
      }
      setModModalOpen(false);
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update staff role.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveModerator = async (mod: ModeratorRecord) => {
    setActionBusy(true);
    try {
      await adminRemoveModerator(currentUser, { uid: mod.uid, username: mod.username });
      onToast(`Removed moderator access for ${mod.username}.`);
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to remove moderator.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveAdmin = async (adm: AdminRecord) => {
    setActionBusy(true);
    try {
      await adminRemoveSuperAdmin(currentUser, { uid: adm.uid, username: adm.username });
      onToast(`Revoked Super Admin privileges for ${adm.username}.`);
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to revoke admin.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleTriageReport = async (report: ReportEntry, status: 'resolved' | 'dismissed') => {
    setActionBusy(true);
    try {
      await adminResolveReport(currentUser, actorRole, report, status, reportNotes[report.id]);
      onToast(status === 'resolved' ? 'Report marked resolved.' : 'Report dismissed.');
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update report.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    setActionBusy(true);
    try {
      await adminDeleteReport(currentUser, reportId);
      onToast('Report deleted.');
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to delete report.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDeleteRoom = async () => {
    if (!deleteRoomTarget) return;
    setActionBusy(true);
    try {
      await adminDeleteGroupRoom(currentUser, actorRole, deleteRoomTarget);
      onToast(`Deleted group "${deleteRoomTarget.name ?? deleteRoomTarget.id}".`);
      setDeleteRoomTarget(null);
      if (inspectedRoom?.id === deleteRoomTarget.id) setInspectedRoom(null);
      await loadData(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to delete room.');
    } finally {
      setActionBusy(false);
    }
  };

  const candidateModUsers = useMemo(() => {
    if (!snapshot) return [];
    const q = modSearch.trim().toLowerCase();
    return snapshot.profiles
      .filter((p) => {
        if (p.id === currentUser.id || p.banned) return false;
        if (!q) return true;
        return p.username.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [snapshot, modSearch, currentUser.id]);

  const navItems: {
    id: AdminTab;
    label: string;
    Icon: React.FC<{ className?: string }>;
    count?: number;
  }[] = [
    { id: 'overview', label: 'Overview', Icon: Activity },
    { id: 'users', label: 'Users & Tracking', Icon: Users, count: snapshot?.profiles.length },
    {
      id: 'staff',
      label: 'Staff & Mods',
      Icon: UserCog,
      count: snapshot ? snapshot.moderators.length + snapshot.admins.length + 1 : undefined,
    },
    {
      id: 'reports',
      label: 'Reports Queue',
      Icon: FileWarning,
      count: metrics?.pendingReports,
    },
    { id: 'rooms', label: 'Rooms Monitor', Icon: Hash, count: snapshot?.chats.length },
    { id: 'logs', label: 'Audit Log', Icon: History },
  ];

  // Chart calculations
  const chartStats = useMemo(() => {
    if (!metrics) return { maxVal: 4, totalSignups7d: 0, totalActive7d: 0 };
    const maxVal = Math.max(
      4,
      ...metrics.days.map((d) => Math.max(d.signups, d.activeUsers, d.roomMessages)),
    );
    return {
      maxVal,
      totalSignups7d: metrics.days.reduce((a, d) => a + d.signups, 0),
      totalActive7d: metrics.days.reduce((a, d) => a + d.activeUsers, 0),
    };
  }, [metrics]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0D12] text-slate-900 dark:text-neutral-100 flex flex-col lg:flex-row">
      {/* Left Navigation Sidebar */}
      <aside className="lg:w-64 lg:shrink-0 bg-white dark:bg-[#121318] border-b lg:border-b-0 lg:border-r border-slate-200/90 dark:border-white/[0.08] flex flex-col">
        <div className="px-4 h-14 border-b border-slate-200/90 dark:border-white/[0.08] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-[#2B84F6]/12 text-[#2B84F6] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight truncate">Admin Console</p>
              <p className="text-[11px] text-slate-500 dark:text-neutral-400 truncate">
                {staffAccess.isPrimaryOwner
                  ? 'Primary Owner'
                  : staffAccess.isAdmin
                    ? 'Super Admin'
                    : 'Moderator'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="lg:hidden inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Chats</span>
          </button>
        </div>

        <nav
          aria-label="Admin sections"
          className="p-2.5 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible chat-scroll"
        >
          {navItems.map(({ id, label, Icon, count }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between gap-2.5 whitespace-nowrap transition-colors shrink-0 ${
                  active
                    ? 'bg-[#2B84F6]/10 text-[#2B84F6] font-semibold'
                    : 'text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-white/[0.05]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                </span>
                {typeof count === 'number' && count > 0 && (
                  <span
                    className={`text-[11px] font-mono tabular-nums ${
                      id === 'reports'
                        ? 'px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold'
                        : 'text-slate-400 dark:text-neutral-500'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto hidden lg:block p-3 border-t border-slate-200/90 dark:border-white/[0.08] space-y-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar
              username={currentUser.username}
              color={currentUser.color}
              avatarUrl={currentUser.avatarUrl}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">{currentUser.username}</p>
              <p className="text-[11px] text-slate-500 dark:text-neutral-400 truncate font-mono">
                {currentUserEmail ?? currentUser.id.slice(0, 10)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="w-full min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.05] text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to chats</span>
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 h-14 px-4 sm:px-6 bg-white/90 dark:bg-[#121318]/90 backdrop-blur-md border-b border-slate-200/90 dark:border-white/[0.08] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-neutral-400 min-w-0">
            <span className="font-medium text-slate-800 dark:text-neutral-200 hidden sm:inline">
              Buddy Chat
            </span>
            <span className="hidden sm:inline">/</span>
            <span>Admin</span>
            <span>/</span>
            <span className="font-semibold text-slate-900 dark:text-white truncate">
              {navItems.find((n) => n.id === activeTab)?.label}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {lastUpdatedAt && (
              <span className="hidden md:inline text-[11px] font-mono tabular-nums text-slate-400 dark:text-neutral-500">
                Synced {formatExactDate(lastUpdatedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadData(true)}
              disabled={refreshing || loading}
              className="min-h-[34px] px-3 py-1 rounded-lg border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Syncing...' : 'Refresh'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void loadData(true)}
                className="text-xs font-semibold underline shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {loading && !snapshot ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded-xl bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.08] animate-pulse"
                  />
                ))}
              </div>
              <div className="h-72 rounded-xl bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.08] animate-pulse" />
            </div>
          ) : snapshot && metrics ? (
            <>
              {/* ============================================================
                  TAB 1: OVERVIEW & TRACKING
              ============================================================ */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* 4 KPI Cards */}
                  <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
                        <span className="font-medium">Platform Users</span>
                        <Users className="w-4 h-4 text-[#2B84F6]" />
                      </div>
                      <p className="text-2xl font-bold tracking-tight tabular-nums">
                        {metrics.totalUsers.toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                        {metrics.activeAccounts} active · {metrics.bannedUsers} banned ·{' '}
                        {metrics.deletedCount} removed
                      </p>
                    </div>

                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
                        <span className="font-medium">Active (24h Telemetry)</span>
                        <Activity className="w-4 h-4 text-emerald-500" />
                      </div>
                      <p className="text-2xl font-bold tracking-tight tabular-nums">
                        {metrics.active24h.toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                        {metrics.totalSessions.toLocaleString()} sessions ·{' '}
                        {metrics.totalTrackedMessages.toLocaleString()} msgs tracked
                      </p>
                    </div>

                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
                        <span className="font-medium">Reports Queue</span>
                        <FileWarning
                          className={`w-4 h-4 ${
                            metrics.pendingReports > 0 ? 'text-amber-500' : 'text-emerald-500'
                          }`}
                        />
                      </div>
                      <p className="text-2xl font-bold tracking-tight tabular-nums">
                        {metrics.pendingReports.toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                        {metrics.totalReports} total reports · {snapshot.logs.length} mod actions
                      </p>
                    </div>

                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
                        <span className="font-medium">Conversations & Rooms</span>
                        <MessageSquare className="w-4 h-4 text-indigo-500" />
                      </div>
                      <p className="text-2xl font-bold tracking-tight tabular-nums">
                        {snapshot.chats.length.toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                        {metrics.groupsCount} groups · {metrics.dmsCount} DMs ·{' '}
                        {metrics.totalMemberships} seats
                      </p>
                    </div>
                  </section>

                  {/* Charts Row */}
                  <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    {/* 7-Day Activity & Growth SVG Column Chart */}
                    <div className="xl:col-span-2 rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h2 className="text-sm font-semibold tracking-tight">
                            7-Day User & Room Activity
                          </h2>
                          <p className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                            {chartStats.totalActive7d} active user check-ins ·{' '}
                            {chartStats.totalSignups7d} new signups in the last 7 days
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-neutral-300">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-xs bg-[#2B84F6]" />
                            Active users
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                            New signups
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" />
                            Active rooms
                          </span>
                        </div>
                      </div>

                      <div className="relative pt-2">
                        <svg
                          viewBox="0 0 640 220"
                          className="w-full h-52 overflow-visible"
                          role="img"
                          aria-label="7-day platform activity chart"
                        >
                          {/* Horizontal grid lines */}
                          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                            const y = 180 - ratio * 150;
                            const val = Math.round(chartStats.maxVal * ratio);
                            return (
                              <g key={idx}>
                                <line
                                  x1="36"
                                  y1={y}
                                  x2="628"
                                  y2={y}
                                  className="stroke-slate-200 dark:stroke-white/[0.08]"
                                  strokeDasharray={idx === 0 ? undefined : '3 3'}
                                />
                                <text
                                  x="28"
                                  y={y + 4}
                                  textAnchor="end"
                                  className="fill-slate-400 dark:fill-neutral-500 text-[10px] font-mono"
                                >
                                  {val}
                                </text>
                              </g>
                            );
                          })}

                          {/* Bars per day */}
                          {metrics.days.map((day, idx) => {
                            const groupWidth = (628 - 44) / 7;
                            const groupX = 44 + idx * groupWidth;
                            const barWidth = 14;
                            const centerX = groupX + groupWidth / 2;

                            const hActive = (day.activeUsers / chartStats.maxVal) * 150;
                            const hSignups = (day.signups / chartStats.maxVal) * 150;
                            const hRooms = (day.roomMessages / chartStats.maxVal) * 150;
                            const isHovered = hoveredDayIndex === idx;

                            return (
                              <g
                                key={day.key}
                                onMouseEnter={() => setHoveredDayIndex(idx)}
                                onMouseLeave={() => setHoveredDayIndex(null)}
                                className="cursor-pointer"
                              >
                                <rect
                                  x={groupX + 2}
                                  y={20}
                                  width={groupWidth - 4}
                                  height={165}
                                  rx="6"
                                  className={
                                    isHovered
                                      ? 'fill-slate-100/80 dark:fill-white/[0.04]'
                                      : 'fill-transparent'
                                  }
                                />
                                <rect
                                  x={centerX - 23}
                                  y={180 - Math.max(2, hActive)}
                                  width={barWidth}
                                  height={Math.max(2, hActive)}
                                  rx="3"
                                  fill="#2B84F6"
                                />
                                <rect
                                  x={centerX - 6}
                                  y={180 - Math.max(2, hSignups)}
                                  width={barWidth}
                                  height={Math.max(2, hSignups)}
                                  rx="3"
                                  fill="#10B981"
                                />
                                <rect
                                  x={centerX + 11}
                                  y={180 - Math.max(2, hRooms)}
                                  width={barWidth}
                                  height={Math.max(2, hRooms)}
                                  rx="3"
                                  fill="#F59E0B"
                                />
                                <text
                                  x={centerX}
                                  y={200}
                                  textAnchor="middle"
                                  className="fill-slate-500 dark:fill-neutral-400 text-[11px] font-medium"
                                >
                                  {day.label}
                                </text>
                              </g>
                            );
                          })}
                        </svg>

                        {hoveredDayIndex !== null && metrics.days[hoveredDayIndex] && (
                          <div className="mt-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-black text-white text-xs inline-flex items-center gap-3 font-mono tabular-nums">
                            <span className="font-sans font-semibold">
                              {metrics.days[hoveredDayIndex].fullDate}
                            </span>
                            <span className="text-blue-400">
                              {metrics.days[hoveredDayIndex].activeUsers} active
                            </span>
                            <span className="text-emerald-400">
                              {metrics.days[hoveredDayIndex].signups} signups
                            </span>
                            <span className="text-amber-400">
                              {metrics.days[hoveredDayIndex].roomMessages} rooms active
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Account & Role Distribution Card */}
                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-5 flex flex-col justify-between gap-5">
                      <div className="space-y-3">
                        <div>
                          <h2 className="text-sm font-semibold tracking-tight">
                            Account & Role Distribution
                          </h2>
                          <p className="text-xs text-slate-500 dark:text-neutral-400">
                            Live breakdown across {metrics.totalUsers + metrics.deletedCount} total records
                          </p>
                        </div>

                        {/* Segmented horizontal bar */}
                        {(() => {
                          const regularActive = Math.max(
                            0,
                            metrics.activeAccounts -
                              metrics.staffAdminsCount -
                              metrics.moderatorsCount,
                          );
                          const total = Math.max(
                            1,
                            regularActive +
                              metrics.moderatorsCount +
                              metrics.staffAdminsCount +
                              metrics.bannedUsers +
                              metrics.deletedCount,
                          );
                          const segments = [
                            {
                              label: 'Regular active',
                              value: regularActive,
                              color: 'bg-[#2B84F6]',
                            },
                            {
                              label: 'Moderators',
                              value: metrics.moderatorsCount,
                              color: 'bg-indigo-500',
                            },
                            {
                              label: 'Super Admins',
                              value: metrics.staffAdminsCount,
                              color: 'bg-emerald-500',
                            },
                            {
                              label: 'Banned',
                              value: metrics.bannedUsers,
                              color: 'bg-amber-500',
                            },
                            {
                              label: 'Removed tombstones',
                              value: metrics.deletedCount,
                              color: 'bg-red-500',
                            },
                          ];

                          return (
                            <>
                              <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden flex">
                                {segments.map(
                                  (seg) =>
                                    seg.value > 0 && (
                                      <div
                                        key={seg.label}
                                        style={{ width: `${(seg.value / total) * 100}%` }}
                                        className={seg.color}
                                        title={`${seg.label}: ${seg.value}`}
                                      />
                                    ),
                                )}
                              </div>

                              <ul className="space-y-2 pt-1">
                                {segments.map((seg) => (
                                  <li
                                    key={seg.label}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="flex items-center gap-2 text-slate-600 dark:text-neutral-300">
                                      <span className={`w-2 h-2 rounded-full ${seg.color}`} />
                                      <span>{seg.label}</span>
                                    </span>
                                    <span className="font-mono tabular-nums font-medium">
                                      {seg.value}{' '}
                                      <span className="text-slate-400 dark:text-neutral-500">
                                        ({Math.round((seg.value / total) * 100)}%)
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </>
                          );
                        })()}
                      </div>

                      <div className="pt-4 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-neutral-400">
                          Primary Owner
                        </span>
                        <span className="font-mono text-slate-800 dark:text-neutral-200">
                          {PRIMARY_ADMIN_EMAIL}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Top Active Users & Active Rooms Tables */}
                  <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-200/90 dark:border-white/[0.08] flex items-center justify-between">
                        <h2 className="text-sm font-semibold tracking-tight">
                          Most Active Tracked Users
                        </h2>
                        <button
                          type="button"
                          onClick={() => setActiveTab('users')}
                          className="text-xs font-medium text-[#2B84F6] hover:underline"
                        >
                          View all
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-neutral-400 border-b border-slate-200/80 dark:border-white/[0.06]">
                            <tr>
                              <th className="py-2.5 px-4 font-medium">User</th>
                              <th className="py-2.5 px-3 font-medium text-right">Msgs</th>
                              <th className="py-2.5 px-3 font-medium text-right">Sessions</th>
                              <th className="py-2.5 px-4 font-medium text-right">Last Seen</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                            {metrics.topActiveUsers.map(({ profile: p, activity }) => (
                              <tr
                                key={p.id}
                                onClick={() => {
                                  setActiveTab('users');
                                  setInspectedUserId(p.id);
                                }}
                                className="hover:bg-slate-50 dark:hover:bg-white/[0.03] cursor-pointer transition-colors"
                              >
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <Avatar
                                      username={p.username}
                                      color={p.color}
                                      avatarUrl={p.avatarUrl}
                                      size="xs"
                                    />
                                    <span className="font-medium truncate max-w-[140px]">
                                      {p.username}
                                    </span>
                                    {p.banned && (
                                      <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
                                        Banned
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                  {activity?.messagesSentCount ?? 0}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                  {activity?.sessionCount ?? 0}
                                </td>
                                <td className="py-2.5 px-4 text-right text-slate-500 dark:text-neutral-400 tabular-nums">
                                  {activity ? formatRelative(activity.lastSeenAt) : 'No session'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-200/90 dark:border-white/[0.08] flex items-center justify-between">
                        <h2 className="text-sm font-semibold tracking-tight">
                          Most Active Rooms & Channels
                        </h2>
                        <button
                          type="button"
                          onClick={() => setActiveTab('rooms')}
                          className="text-xs font-medium text-[#2B84F6] hover:underline"
                        >
                          Monitor rooms
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-neutral-400 border-b border-slate-200/80 dark:border-white/[0.06]">
                            <tr>
                              <th className="py-2.5 px-4 font-medium">Room</th>
                              <th className="py-2.5 px-3 font-medium">Type</th>
                              <th className="py-2.5 px-3 font-medium text-right">Members</th>
                              <th className="py-2.5 px-4 font-medium text-right">Last Active</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                            {metrics.topActiveRooms.map((room) => (
                              <tr
                                key={room.id}
                                onClick={() => {
                                  setActiveTab('rooms');
                                  void handleOpenRoomMembers(room);
                                }}
                                className="hover:bg-slate-50 dark:hover:bg-white/[0.03] cursor-pointer transition-colors"
                              >
                                <td className="py-2.5 px-4 font-medium truncate max-w-[160px]">
                                  {room.type === 'group'
                                    ? room.name ?? 'Group'
                                    : `DM · ${room.id.slice(3, 13)}`}
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 dark:text-neutral-400">
                                  {room.type === 'dm'
                                    ? 'Direct'
                                    : room.visibility === 'private'
                                      ? 'Private'
                                      : 'Public'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                  {room.memberCount}
                                </td>
                                <td className="py-2.5 px-4 text-right text-slate-500 dark:text-neutral-400 tabular-nums">
                                  {formatRelative(room.lastMessageAt ?? room.createdAt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* ============================================================
                  TAB 2: USERS & TRACKING INSPECTOR
              ============================================================ */}
              {activeTab === 'users' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="Search by username, UID, or past handle..."
                        className="w-full min-h-[38px] pl-9 pr-3 py-1.5 rounded-lg bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.1] text-xs focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                      />
                    </div>

                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#141417] border border-slate-200/80 dark:border-white/[0.08] overflow-x-auto">
                      {(
                        [
                          { id: 'all', label: `All (${snapshot.profiles.length})` },
                          { id: 'active', label: `Active (${metrics.activeAccounts})` },
                          { id: 'banned', label: `Banned (${metrics.bannedUsers})` },
                          { id: 'staff', label: 'Staff' },
                          { id: 'removed', label: `Removed (${snapshot.deletedUsers.length})` },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setUserFilter(f.id)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                            userFilter === f.id
                              ? 'bg-white dark:bg-[#242429] text-slate-900 dark:text-white shadow-xs'
                              : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {userFilter === 'removed' ? (
                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-200/90 dark:border-white/[0.08] flex items-center justify-between">
                        <div>
                          <h2 className="text-sm font-semibold">Removed Accounts (Tombstones)</h2>
                          <p className="text-xs text-slate-500 dark:text-neutral-400">
                            Deleted UIDs are blocked from creating new profiles unless restored by an admin.
                          </p>
                        </div>
                      </div>
                      {filteredDeletedUsers.length === 0 ? (
                        <p className="p-8 text-center text-xs text-slate-500 dark:text-neutral-400">
                          No removed user tombstones found.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-neutral-400 border-b border-slate-200/80 dark:border-white/[0.06]">
                              <tr>
                                <th className="py-2.5 px-4 font-medium">Former Handle / UID</th>
                                <th className="py-2.5 px-3 font-medium">Reason</th>
                                <th className="py-2.5 px-3 font-medium">Deleted By</th>
                                <th className="py-2.5 px-3 font-medium">Deleted At</th>
                                <th className="py-2.5 px-4 font-medium text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                              {filteredDeletedUsers.map((rec) => (
                                <tr key={rec.uid} className="hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                                  <td className="py-2.5 px-4">
                                    <p className="font-semibold">{rec.username}</p>
                                    <p className="font-mono text-[11px] text-slate-400">{rec.uid}</p>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 dark:text-neutral-300 max-w-xs truncate">
                                    {rec.reason ?? '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 dark:text-neutral-300">
                                    {rec.deletedByUsername}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-500 dark:text-neutral-400 tabular-nums">
                                    {formatExactDate(rec.deletedAt)}
                                  </td>
                                  <td className="py-2.5 px-4 text-right">
                                    {staffAccess.isAdmin && (
                                      <button
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={() => void handleRestoreDeletedUser(rec)}
                                        className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium inline-flex items-center gap-1"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                        <span>Restore access</span>
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-neutral-400 border-b border-slate-200/80 dark:border-white/[0.06]">
                            <tr>
                              <th className="py-2.5 px-4 font-medium">User</th>
                              <th className="py-2.5 px-3 font-medium">Role & Status</th>
                              <th className="py-2.5 px-3 font-medium text-right">Msgs / Sessions</th>
                              <th className="py-2.5 px-3 font-medium text-right">Last Seen</th>
                              <th className="py-2.5 px-3 font-medium text-right">Joined</th>
                              <th className="py-2.5 px-4 font-medium text-right">Controls</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                            {filteredUsers.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="py-8 text-center text-slate-500 dark:text-neutral-400"
                                >
                                  No matching users found.
                                </td>
                              </tr>
                            ) : (
                              filteredUsers.map((u) => {
                                const act = snapshot.activities[u.id];
                                const isAdm =
                                  adminsById.has(u.id) ||
                                  (u.id === currentUser.id && staffAccess.isPrimaryOwner);
                                const modRec = modsById.get(u.id);
                                const allowBan = canActOnTargetBan(u.id);
                                const allowDelete =
                                  staffAccess.canDeleteUsers && u.id !== currentUser.id;

                                return (
                                  <tr
                                    key={u.id}
                                    className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                                  >
                                    <td className="py-2.5 px-4">
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <Avatar
                                          username={u.username}
                                          color={u.color}
                                          avatarUrl={u.avatarUrl}
                                          size="sm"
                                        />
                                        <div className="min-w-0">
                                          <button
                                            type="button"
                                            onClick={() => setInspectedUserId(u.id)}
                                            className="font-semibold hover:text-[#2B84F6] truncate block max-w-[160px] text-left"
                                          >
                                            {u.username}
                                          </button>
                                          <p className="font-mono text-[11px] text-slate-400 dark:text-neutral-500 truncate max-w-[160px]">
                                            {u.id}
                                          </p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="flex items-center gap-2 whitespace-nowrap">
                                        <span
                                          className={`inline-flex items-center gap-1.5 font-medium ${
                                            u.banned
                                              ? 'text-red-600 dark:text-red-400'
                                              : 'text-emerald-600 dark:text-emerald-400'
                                          }`}
                                        >
                                          <span
                                            className={`w-1.5 h-1.5 rounded-full ${
                                              u.banned ? 'bg-red-500' : 'bg-emerald-500'
                                            }`}
                                          />
                                          {u.banned ? 'Banned' : 'Active'}
                                        </span>
                                        {isAdm && (
                                          <span className="text-[11px] font-semibold text-[#2B84F6]">
                                            · Admin
                                          </span>
                                        )}
                                        {modRec && !isAdm && (
                                          <span className="text-[11px] font-semibold text-indigo-500">
                                            · Mod
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                      {act?.messagesSentCount ?? 0}{' '}
                                      <span className="text-slate-400 dark:text-neutral-500">
                                        / {act?.sessionCount ?? 0}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-right text-slate-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                                      {act ? formatRelative(act.lastSeenAt) : '—'}
                                    </td>
                                    <td className="py-2.5 px-3 text-right text-slate-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                                      {formatRelative(u.createdAt)}
                                    </td>
                                    <td className="py-2.5 px-4 text-right">
                                      <div className="inline-flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => setInspectedUserId(u.id)}
                                          title="Open tracking & controls"
                                          className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium inline-flex items-center gap-1"
                                        >
                                          <Eye className="w-3 h-3" />
                                          <span>Track</span>
                                        </button>
                                        {allowBan && (
                                          <button
                                            type="button"
                                            disabled={actionBusy}
                                            onClick={() => void handleToggleBan(u)}
                                            className={`px-2.5 py-1 rounded-md border text-xs font-medium inline-flex items-center gap-1 ${
                                              u.banned
                                                ? 'border-emerald-500/35 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                                                : 'border-amber-500/35 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10'
                                            }`}
                                          >
                                            <Ban className="w-3 h-3" />
                                            <span>{u.banned ? 'Unban' : 'Ban'}</span>
                                          </button>
                                        )}
                                        {allowDelete && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setDeleteTarget(u);
                                              setDeleteReason('');
                                              setDeleteConfirmText('');
                                            }}
                                            title="Delete user permanently"
                                            className="p-1.5 rounded-md border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================
                  TAB 3: STAFF & MODERATORS
              ============================================================ */}
              {activeTab === 'staff' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold tracking-tight">
                        Platform Admins & Moderators
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        {staffAccess.canManageStaff
                          ? 'Assign trusted users as Moderators with granular permissions or promote co-admins.'
                          : 'Directory of active platform administrators and moderators.'}
                      </p>
                    </div>
                    {staffAccess.canManageStaff && (
                      <button
                        type="button"
                        onClick={() => openAddStaffModal()}
                        className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#2B84F6] hover:bg-[#1D74E8] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors self-start sm:self-auto"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Add Moderator / Admin</span>
                      </button>
                    )}
                  </div>

                  {/* Primary Platform Owner */}
                  <section className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-[#2B84F6]/12 text-[#2B84F6] flex items-center justify-center shrink-0">
                        <Crown className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold truncate">{PRIMARY_ADMIN_EMAIL}</p>
                          <span className="text-[11px] font-semibold text-[#2B84F6]">
                            Primary Owner
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-neutral-400">
                          Immutable root administrator verified via Google email claim in Firestore security rules.
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-slate-500 dark:text-neutral-400 shrink-0">
                      All Permissions · Protected
                    </span>
                  </section>

                  {/* Moderators Table */}
                  <section className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200/90 dark:border-white/[0.08] flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        Moderators ({snapshot.moderators.length})
                      </h3>
                    </div>
                    {snapshot.moderators.length === 0 ? (
                      <div className="p-8 text-center space-y-2">
                        <p className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                          No moderators assigned yet
                        </p>
                        <p className="text-xs text-slate-400 dark:text-neutral-500">
                          Super Admins can add moderators to help ban abusive accounts, triage reports, or moderate group rooms.
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-neutral-400 border-b border-slate-200/80 dark:border-white/[0.06]">
                            <tr>
                              <th className="py-2.5 px-4 font-medium">Moderator</th>
                              <th className="py-2.5 px-3 font-medium">Permissions</th>
                              <th className="py-2.5 px-3 font-medium">Assigned By</th>
                              <th className="py-2.5 px-3 font-medium">Note</th>
                              {staffAccess.canManageStaff && (
                                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                            {snapshot.moderators.map((mod) => {
                              const prof = profilesById.get(mod.uid);
                              return (
                                <tr
                                  key={mod.uid}
                                  className="hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                                >
                                  <td className="py-2.5 px-4">
                                    <div className="flex items-center gap-2.5">
                                      <Avatar
                                        username={mod.username}
                                        color={mod.color}
                                        avatarUrl={prof?.avatarUrl}
                                        size="xs"
                                      />
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActiveTab('users');
                                            setInspectedUserId(mod.uid);
                                          }}
                                          className="font-semibold hover:text-[#2B84F6]"
                                        >
                                          {mod.username}
                                        </button>
                                        <p className="font-mono text-[11px] text-slate-400">
                                          {mod.uid.slice(0, 14)}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-700 dark:text-neutral-300">
                                    {[
                                      mod.canBan ? 'Ban users' : null,
                                      mod.canManageReports ? 'Reports' : null,
                                      mod.canManageRooms ? 'Rooms' : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ') || 'Tracking only'}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-500 dark:text-neutral-400">
                                    {mod.addedByUsername} · {formatRelative(mod.createdAt)}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-500 dark:text-neutral-400 max-w-[180px] truncate">
                                    {mod.note ?? '—'}
                                  </td>
                                  {staffAccess.canManageStaff && (
                                    <td className="py-2.5 px-4 text-right">
                                      <div className="inline-flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => openAddStaffModal(prof, mod)}
                                          className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          disabled={actionBusy}
                                          onClick={() => void handleRemoveModerator(mod)}
                                          className="px-2.5 py-1 rounded-md border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-medium"
                                        >
                                          Revoke
                                        </button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {/* Delegated Admins */}
                  <section className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200/90 dark:border-white/[0.08]">
                      <h3 className="text-sm font-semibold">
                        Delegated Super Admins ({snapshot.admins.length})
                      </h3>
                    </div>
                    {snapshot.admins.length === 0 ? (
                      <p className="p-6 text-center text-xs text-slate-400 dark:text-neutral-500">
                        No delegated co-admins configured.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                        {snapshot.admins.map((adm) => (
                          <li
                            key={adm.uid}
                            className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar username={adm.username} color={adm.color} size="xs" />
                              <div className="min-w-0">
                                <p className="font-semibold truncate">{adm.username}</p>
                                <p className="text-slate-400 font-mono text-[11px] truncate">
                                  {adm.uid} · Added by {adm.addedByUsername}
                                </p>
                              </div>
                            </div>
                            {staffAccess.canManageStaff && adm.uid !== currentUser.id && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void handleRemoveAdmin(adm)}
                                className="px-2.5 py-1 rounded-md border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 font-medium shrink-0"
                              >
                                Revoke Admin
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}

              {/* ============================================================
                  TAB 4: REPORTS QUEUE
              ============================================================ */}
              {activeTab === 'reports' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold tracking-tight">Safety Reports Queue</h2>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        Inspect reported accounts, resolve incidents, or ban repeat offenders.
                      </p>
                    </div>
                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#141417] border border-slate-200/80 dark:border-white/[0.08]">
                      {(['pending', 'resolved', 'dismissed', 'all'] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setReportFilter(status)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                            reportFilter === status
                              ? 'bg-white dark:bg-[#242429] text-slate-900 dark:text-white shadow-xs'
                              : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredReports.length === 0 ? (
                    <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-10 text-center space-y-1.5">
                      <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                      <p className="text-sm font-semibold">No {reportFilter} reports</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        User-submitted safety reports will appear here for review.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredReports.map((report) => {
                        const reporter = profilesById.get(report.reporterId);
                        const reported = report.reportedUserId
                          ? profilesById.get(report.reportedUserId)
                          : null;
                        const canBanReported =
                          Boolean(reported) && canActOnTargetBan(reported!.id);

                        return (
                          <div
                            key={report.id}
                            className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] p-4 space-y-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span
                                    className={`font-semibold capitalize ${
                                      report.status === 'pending'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : report.status === 'resolved'
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : 'text-slate-500 dark:text-neutral-400'
                                    }`}
                                  >
                                    {report.status}
                                  </span>
                                  <span className="text-slate-400">·</span>
                                  <span className="text-slate-500 dark:text-neutral-400 tabular-nums">
                                    {formatExactDate(report.createdAt)}
                                  </span>
                                  <span className="text-slate-400">·</span>
                                  <span className="font-mono text-[11px] text-slate-400">
                                    #{report.id.slice(0, 8)}
                                  </span>
                                </div>

                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                  {report.reason}
                                </p>

                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-neutral-400">
                                  <span>
                                    Reporter:{' '}
                                    <strong className="text-slate-700 dark:text-neutral-200">
                                      {reporter?.username ?? report.reporterId.slice(0, 10)}
                                    </strong>
                                  </span>
                                  {report.reportedUserId && (
                                    <span>
                                      Target:{' '}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveTab('users');
                                          setInspectedUserId(report.reportedUserId);
                                        }}
                                        className="font-semibold text-[#2B84F6] hover:underline"
                                      >
                                        {reported?.username ?? report.reportedUserId.slice(0, 10)}
                                      </button>
                                      {reported?.banned && (
                                        <span className="ml-1 text-red-500 font-medium">
                                          (Banned)
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  {report.chatId && (
                                    <span className="font-mono text-[11px]">
                                      Chat: {report.chatId.slice(0, 14)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {staffAccess.isAdmin && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleDeleteReport(report.id)}
                                  title="Delete report record"
                                  className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-500/10"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            {report.status !== 'pending' && report.resolvedByUsername && (
                              <p className="text-xs text-slate-500 dark:text-neutral-400 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
                                {report.status === 'resolved' ? 'Resolved' : 'Dismissed'} by{' '}
                                <span className="font-medium text-slate-700 dark:text-neutral-200">
                                  {report.resolvedByUsername}
                                </span>{' '}
                                · {formatRelative(report.resolvedAt)}
                                {report.resolutionNote ? ` — "${report.resolutionNote}"` : ''}
                              </p>
                            )}

                            {report.status === 'pending' && staffAccess.canManageReports && (
                              <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center gap-2">
                                <input
                                  type="text"
                                  value={reportNotes[report.id] ?? ''}
                                  onChange={(e) =>
                                    setReportNotes((prev) => ({
                                      ...prev,
                                      [report.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Optional resolution note..."
                                  maxLength={300}
                                  className="flex-1 min-h-[34px] px-3 py-1 rounded-lg bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.1] text-xs focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                                />
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => void handleTriageReport(report, 'resolved')}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                                  >
                                    Resolve
                                  </button>
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => void handleTriageReport(report, 'dismissed')}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium"
                                  >
                                    Dismiss
                                  </button>
                                  {reported && canBanReported && !reported.banned && (
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() =>
                                        void handleToggleBan(reported, `Report: ${report.reason}`)
                                      }
                                      className="px-3 py-1.5 rounded-lg border border-red-500/35 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-semibold"
                                    >
                                      Ban user
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================
                  TAB 5: ROOMS MONITOR
              ============================================================ */}
              {activeTab === 'rooms' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        value={roomSearch}
                        onChange={(e) => setRoomSearch(e.target.value)}
                        placeholder="Search rooms by name, ID, or last sender..."
                        className="w-full min-h-[38px] pl-9 pr-3 py-1.5 rounded-lg bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.1] text-xs focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                      />
                    </div>

                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#141417] border border-slate-200/80 dark:border-white/[0.08] overflow-x-auto">
                      {(
                        [
                          { id: 'all', label: 'All rooms' },
                          { id: 'public_group', label: 'Public groups' },
                          { id: 'private_group', label: 'Private groups' },
                          { id: 'dm', label: 'DMs' },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setRoomFilter(f.id)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                            roomFilter === f.id
                              ? 'bg-white dark:bg-[#242429] text-slate-900 dark:text-white shadow-xs'
                              : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-neutral-400 border-b border-slate-200/80 dark:border-white/[0.06]">
                          <tr>
                            <th className="py-2.5 px-4 font-medium">Room / Channel</th>
                            <th className="py-2.5 px-3 font-medium">Type</th>
                            <th className="py-2.5 px-3 font-medium">Creator</th>
                            <th className="py-2.5 px-3 font-medium text-right">Members</th>
                            <th className="py-2.5 px-3 font-medium text-right">Last Activity</th>
                            <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                          {filteredRooms.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="py-8 text-center text-slate-500 dark:text-neutral-400"
                              >
                                No rooms match your filter.
                              </td>
                            </tr>
                          ) : (
                            filteredRooms.map((room) => {
                              const creator = profilesById.get(room.createdBy);
                              return (
                                <tr
                                  key={room.id}
                                  className="hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                                >
                                  <td className="py-2.5 px-4">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {room.type === 'group' ? (
                                        room.visibility === 'private' ? (
                                          <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        ) : (
                                          <Hash className="w-3.5 h-3.5 text-[#2B84F6] shrink-0" />
                                        )
                                      ) : (
                                        <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        <p className="font-semibold truncate max-w-[200px]">
                                          {room.type === 'group'
                                            ? room.name ?? 'Group'
                                            : `DM · ${room.id.slice(3, 18)}`}
                                        </p>
                                        <p className="font-mono text-[11px] text-slate-400 truncate max-w-[200px]">
                                          {room.id}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 dark:text-neutral-300">
                                    {room.type === 'dm'
                                      ? 'Direct Chat'
                                      : room.visibility === 'private'
                                        ? 'Private Group'
                                        : 'Public Group'}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 dark:text-neutral-300">
                                    {creator?.username ?? room.createdBy.slice(0, 10)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                    {room.memberCount}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-500 dark:text-neutral-400 tabular-nums">
                                    {formatRelative(room.lastMessageAt ?? room.createdAt)}
                                  </td>
                                  <td className="py-2.5 px-4 text-right">
                                    <div className="inline-flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => void handleOpenRoomMembers(room)}
                                        className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-medium"
                                      >
                                        Members
                                      </button>
                                      {staffAccess.canManageRooms && room.type === 'group' && (
                                        <button
                                          type="button"
                                          onClick={() => setDeleteRoomTarget(room)}
                                          title="Delete group room"
                                          className="p-1.5 rounded-md border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================
                  TAB 6: AUDIT LOG
              ============================================================ */}
              {activeTab === 'logs' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold tracking-tight">
                        Immutable Moderation Audit Log
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        Every administrative and moderation action is permanently recorded here.
                      </p>
                    </div>
                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#141417] border border-slate-200/80 dark:border-white/[0.08] overflow-x-auto">
                      {(
                        [
                          { id: 'all', label: 'All' },
                          { id: 'bans', label: 'Bans' },
                          { id: 'deletes', label: 'Deletions' },
                          { id: 'staff', label: 'Staff' },
                          { id: 'reports', label: 'Reports' },
                          { id: 'rooms', label: 'Rooms' },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setLogFilter(f.id)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                            logFilter === f.id
                              ? 'bg-white dark:bg-[#242429] text-slate-900 dark:text-white shadow-xs'
                              : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white dark:bg-[#141417] border border-slate-200/90 dark:border-white/[0.08] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-white/[0.02] text-slate-500 dark:text-neutral-400 border-b border-slate-200/80 dark:border-white/[0.06]">
                          <tr>
                            <th className="py-2.5 px-4 font-medium">Time</th>
                            <th className="py-2.5 px-3 font-medium">Actor</th>
                            <th className="py-2.5 px-3 font-medium">Action</th>
                            <th className="py-2.5 px-4 font-medium">Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                          {filteredLogs.length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="py-8 text-center text-slate-500 dark:text-neutral-400"
                              >
                                No moderation log entries recorded yet.
                              </td>
                            </tr>
                          ) : (
                            filteredLogs.map((log) => (
                              <tr
                                key={log.id}
                                className="hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                              >
                                <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-neutral-400 whitespace-nowrap tabular-nums">
                                  {formatExactDate(log.createdAt)}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span className="font-semibold">{log.actorUsername}</span>{' '}
                                  <span className="text-[11px] text-slate-400">
                                    ({log.actorRole})
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                                  {formatActionLabel(log.action)}
                                </td>
                                <td className="py-2.5 px-4 text-slate-600 dark:text-neutral-300">
                                  {log.details}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>

      {/* ====================================================================
          SLIDE-OVER USER TRACKING & CONTROL INSPECTOR
      ==================================================================== */}
      {inspectedUser && (
        <div
          className="fixed inset-0 z-50 bg-black/45 dark:bg-black/70 backdrop-blur-xs flex justify-end"
          onClick={() => setInspectedUserId(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Inspect ${inspectedUser.username}`}
        >
          <div
            className="w-full max-w-lg h-full bg-white dark:bg-[#141417] border-l border-slate-200 dark:border-white/[0.1] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  username={inspectedUser.username}
                  color={inspectedUser.color}
                  avatarUrl={inspectedUser.avatarUrl}
                  size="md"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold truncate">{inspectedUser.username}</h2>
                    {inspectedUser.banned && (
                      <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                        Banned
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-slate-400 truncate">{inspectedUser.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenPublicProfile(inspectedUser.id)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] text-xs font-medium hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                >
                  Public profile
                </button>
                <button
                  type="button"
                  onClick={() => setInspectedUserId(null)}
                  aria-label="Close inspector"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto chat-scroll p-5 space-y-6 text-xs">
              {/* Telemetry Grid */}
              <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02]">
                  <p className="text-slate-500 dark:text-neutral-400">Messages</p>
                  <p className="text-base font-bold font-mono tabular-nums mt-0.5">
                    {trackingDetails?.activity?.messagesSentCount ?? 0}
                  </p>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02]">
                  <p className="text-slate-500 dark:text-neutral-400">Sessions</p>
                  <p className="text-base font-bold font-mono tabular-nums mt-0.5">
                    {trackingDetails?.activity?.sessionCount ?? 0}
                  </p>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02]">
                  <p className="text-slate-500 dark:text-neutral-400">Joined Chats</p>
                  <p className="text-base font-bold font-mono tabular-nums mt-0.5">
                    {loadingTracking ? '…' : trackingDetails?.joinedChats.length ?? 0}
                  </p>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.02]">
                  <p className="text-slate-500 dark:text-neutral-400">Blocked Users</p>
                  <p className="text-base font-bold font-mono tabular-nums mt-0.5">
                    {loadingTracking ? '…' : trackingDetails?.blockCount ?? 0}
                  </p>
                </div>
              </section>

              {/* Activity & Rate Limit Tracking */}
              <section className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-white/[0.08]">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#2B84F6]" />
                  <span>Live Telemetry & Rate Limit Window</span>
                </h3>
                <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-neutral-300">
                  <div>
                    <span className="text-slate-400">Last seen:</span>{' '}
                    <span className="font-mono">
                      {trackingDetails?.activity
                        ? formatExactDate(trackingDetails.activity.lastSeenAt)
                        : 'No recorded activity'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Last screen:</span>{' '}
                    <span className="font-mono capitalize">
                      {trackingDetails?.activity?.lastScreen ?? '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Account created:</span>{' '}
                    <span className="font-mono">{formatExactDate(inspectedUser.createdAt)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Rate window:</span>{' '}
                    <span className="font-mono tabular-nums">
                      {trackingDetails?.rateLimit
                        ? `${trackingDetails.rateLimit.count}/5 msgs (${formatRelative(
                            trackingDetails.rateLimit.windowStart,
                          )})`
                        : 'Clear'}
                    </span>
                  </div>
                </div>

                {staffAccess.isAdmin && trackingDetails?.rateLimit && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleResetRateLimit(inspectedUser)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] font-medium inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Clear rate-limit cooldown</span>
                  </button>
                )}
              </section>

              {/* Username History Timeline */}
              <section className="space-y-2 pt-3 border-t border-slate-200 dark:border-white/[0.08]">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Username History ({inspectedUser.usernameHistory.length})</span>
                </h3>
                {inspectedUser.usernameHistory.length === 0 ? (
                  <p className="text-slate-400 dark:text-neutral-500">
                    Never changed handle since creation.
                  </p>
                ) : (
                  <ul className="space-y-1.5 max-h-36 overflow-y-auto chat-scroll">
                    {inspectedUser.usernameHistory.map((h, i) => (
                      <li
                        key={`${h.username}-${i}`}
                        className="flex items-center justify-between text-slate-600 dark:text-neutral-300"
                      >
                        <span className="font-mono">{h.username}</span>
                        <span className="text-slate-400 tabular-nums">
                          {formatExactDate(h.changedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Joined Chats */}
              <section className="space-y-2 pt-3 border-t border-slate-200 dark:border-white/[0.08]">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Joined Conversations ({trackingDetails?.joinedChats.length ?? 0})</span>
                </h3>
                {!trackingDetails || trackingDetails.joinedChats.length === 0 ? (
                  <p className="text-slate-400 dark:text-neutral-500">
                    No active conversations.
                  </p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto chat-scroll">
                    {trackingDetails.joinedChats.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0"
                      >
                        <span className="font-medium truncate">
                          {c.type === 'group'
                            ? `# ${c.name ?? 'Group'}`
                            : `DM · ${c.partner?.username ?? 'User'}`}
                        </span>
                        <span className="text-slate-400 tabular-nums shrink-0">
                          {formatRelative(c.lastMessageAt ?? c.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Moderation Controls */}
              <section className="space-y-3 pt-3 border-t border-slate-200 dark:border-white/[0.08]">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
                  <span>Moderation & Account Controls</span>
                </h3>

                {inspectedUser.banned && inspectedUser.bannedReason && (
                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-700 dark:text-red-300">
                    Ban reason: {inspectedUser.bannedReason}
                  </div>
                )}

                {canActOnTargetBan(inspectedUser.id) && (
                  <div className="space-y-2">
                    {!inspectedUser.banned && (
                      <input
                        type="text"
                        value={banReasonInput}
                        onChange={(e) => setBanReasonInput(e.target.value)}
                        placeholder="Ban reason (optional, e.g. Spamming public rooms)"
                        maxLength={240}
                        className="w-full min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.1] text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    )}
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleToggleBan(inspectedUser, banReasonInput)}
                      className={`w-full min-h-[38px] px-3 py-1.5 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                        inspectedUser.banned
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-amber-600 hover:bg-amber-700 text-white'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>
                        {inspectedUser.banned ? 'Lift Platform Ban' : 'Ban User from Platform'}
                      </span>
                    </button>
                  </div>
                )}

                {staffAccess.isAdmin && (
                  <div className="space-y-2 pt-1">
                    <p className="text-[11px] font-medium text-slate-500 dark:text-neutral-400">
                      Profile Hygiene Reset
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleResetProfile(inspectedUser, { clearBio: true })}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] font-medium"
                      >
                        Clear Bio
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleResetProfile(inspectedUser, { clearAvatar: true })}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] font-medium"
                      >
                        Remove Avatar
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() =>
                          void handleResetProfile(inspectedUser, { randomizeUsername: true })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.12] hover:bg-slate-100 dark:hover:bg-white/[0.06] font-medium"
                      >
                        Randomize Handle
                      </button>
                    </div>
                  </div>
                )}

                {staffAccess.canManageStaff && inspectedUser.id !== currentUser.id && (
                  <div className="pt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        openAddStaffModal(inspectedUser, modsById.get(inspectedUser.id))
                      }
                      className="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg border border-[#2B84F6]/40 text-[#2B84F6] hover:bg-[#2B84F6]/10 font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>
                        {modsById.has(inspectedUser.id)
                          ? 'Edit Moderator Role'
                          : 'Make Moderator / Admin'}
                      </span>
                    </button>

                    {staffAccess.canDeleteUsers && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTarget(inspectedUser);
                          setDeleteReason('');
                          setDeleteConfirmText('');
                        }}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg border border-red-500/35 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete User</span>
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          DELETE USER PERMANENTLY MODAL
      ==================================================================== */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            if (!actionBusy) setDeleteTarget(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.1] shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Delete {deleteTarget.username}?</h2>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    Purges profile, chat memberships, & blocks recreation.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setDeleteTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmDeleteUser} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                  Removal reason (recorded in audit log)
                </span>
                <input
                  type="text"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="e.g. Severe harassment or spam account"
                  maxLength={240}
                  className="w-full min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.12] text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                  Type <span className="font-mono font-bold">DELETE</span> to confirm
                </span>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoFocus
                  className="w-full min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.12] text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/[0.1] text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionBusy || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{actionBusy ? 'Deleting...' : 'Delete permanently'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          ADD / EDIT MODERATOR OR SUPER ADMIN MODAL
      ==================================================================== */}
      {modModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            if (!actionBusy) setModModalOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.1] shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-[#2B84F6]" />
                <h2 className="text-base font-bold">
                  {editingModUid ? 'Edit Moderator Permissions' : 'Assign Staff Role'}
                </h2>
              </div>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setModModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStaffAssignment} className="space-y-4">
              {!editingModUid && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-neutral-300">
                    Select user
                  </label>
                  <input
                    type="search"
                    value={modSearch}
                    onChange={(e) => setModSearch(e.target.value)}
                    placeholder="Filter active users..."
                    className="w-full min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.1] text-xs focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                  />
                  <div className="max-h-36 overflow-y-auto chat-scroll rounded-lg border border-slate-200 dark:border-white/[0.1] divide-y divide-slate-100 dark:divide-white/[0.05]">
                    {candidateModUsers.length === 0 ? (
                      <p className="p-3 text-center text-xs text-slate-400">No eligible users</p>
                    ) : (
                      candidateModUsers.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setModSelectedUid(u.id)}
                          className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 ${
                            modSelectedUid === u.id
                              ? 'bg-[#2B84F6]/12 text-[#2B84F6] font-semibold'
                              : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Avatar username={u.username} color={u.color} size="xs" />
                            <span className="truncate">{u.username}</span>
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {u.id.slice(0, 8)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {!editingModUid && (
                <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-slate-100 dark:bg-black">
                  <button
                    type="button"
                    onClick={() => setModRoleType('moderator')}
                    className={`py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      modRoleType === 'moderator'
                        ? 'bg-white dark:bg-[#242429] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500'
                    }`}
                  >
                    Moderator
                  </button>
                  <button
                    type="button"
                    onClick={() => setModRoleType('admin')}
                    className={`py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      modRoleType === 'admin'
                        ? 'bg-white dark:bg-[#242429] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500'
                    }`}
                  >
                    Super Admin
                  </button>
                </div>
              )}

              {modRoleType === 'moderator' ? (
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                    Moderator Permissions
                  </p>
                  <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                    <span>Ban & unban regular users</span>
                    <input
                      type="checkbox"
                      checked={modCanBan}
                      onChange={(e) => setModCanBan(e.target.checked)}
                      className="rounded accent-[#2B84F6]"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                    <span>Resolve & dismiss safety reports</span>
                    <input
                      type="checkbox"
                      checked={modCanManageReports}
                      onChange={(e) => setModCanManageReports(e.target.checked)}
                      className="rounded accent-[#2B84F6]"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                    <span>Delete abusive group rooms & messages</span>
                    <input
                      type="checkbox"
                      checked={modCanManageRooms}
                      onChange={(e) => setModCanManageRooms(e.target.checked)}
                      className="rounded accent-[#2B84F6]"
                    />
                  </label>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Super Admins can ban/delete users, reset profiles, manage rooms, and add/remove moderators.
                  </span>
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                  Staff note (optional)
                </span>
                <input
                  type="text"
                  value={modNote}
                  onChange={(e) => setModNote(e.target.value)}
                  placeholder="e.g. Night shift community moderator"
                  maxLength={200}
                  className="w-full min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.1] text-xs focus:outline-none focus:ring-2 focus:ring-[#2B84F6]"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setModModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/[0.1] text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionBusy || !modSelectedUid}
                  className="px-4 py-2 rounded-lg bg-[#2B84F6] hover:bg-[#1D74E8] disabled:opacity-50 text-white text-xs font-semibold"
                >
                  {actionBusy ? 'Saving...' : editingModUid ? 'Save changes' : 'Assign role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          ROOM MEMBERS MODAL
      ==================================================================== */}
      {inspectedRoom && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setInspectedRoom(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.1] shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-bold truncate">
                  {inspectedRoom.type === 'group'
                    ? inspectedRoom.name ?? 'Group'
                    : `DM · ${inspectedRoom.id.slice(3, 18)}`}
                </h2>
                <p className="font-mono text-[11px] text-slate-400 truncate">{inspectedRoom.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedRoom(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingRoomMembers ? (
              <p className="py-6 text-center text-xs text-slate-400">Loading room members...</p>
            ) : roomMembers.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No members found.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto chat-scroll divide-y divide-slate-100 dark:divide-white/[0.05]">
                {roomMembers.map((m) => (
                  <li key={m.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar username={m.username} color={m.color} avatarUrl={m.avatarUrl} size="xs" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{m.username}</p>
                        <p className="font-mono text-[10px] text-slate-400 truncate">{m.id}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectedRoom(null);
                        setActiveTab('users');
                        setInspectedUserId(m.id);
                      }}
                      className="text-xs font-medium text-[#2B84F6] hover:underline shrink-0"
                    >
                      Inspect
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          DELETE GROUP ROOM CONFIRMATION MODAL
      ==================================================================== */}
      {deleteRoomTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            if (!actionBusy) setDeleteRoomTarget(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#141417] border border-slate-200 dark:border-white/[0.1] shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-bold">
              Delete group "{deleteRoomTarget.name ?? deleteRoomTarget.id}"?
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed">
              This removes all messages, memberships, join requests, and room links for all{' '}
              {deleteRoomTarget.memberCount} members.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setDeleteRoomTarget(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.1] text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleConfirmDeleteRoom()}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                {actionBusy ? 'Deleting...' : 'Delete Room'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
