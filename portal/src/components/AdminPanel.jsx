import { useState } from 'react'
import AdminStaffTab from './AdminStaffTab'
import AdminTilesTab from './AdminTilesTab'
import AdminRolesV2Tab from './AdminRolesV2Tab'
import AdminReferencesTab from './AdminReferencesTab'
import AdminConfig from './AdminConfig'
import SyncStatusTile from './SyncStatusTile'
import WebhookLogs from './admin/WebhookLogs'
import BulkImportTab from './admin/BulkImportTab'
import EmployeeRosterTab from './admin/EmployeeRosterTab'
import SMSHistoryTab from './admin/SMSHistoryTab'
import PaychexAdmin from './admin/PaychexAdmin'
import TicketEmbedsAdmin from './admin/TicketEmbedsAdmin'
import DriveFoldersAdmin from './admin/DriveFoldersAdmin'
import GoogleConnections from './admin/GoogleConnections'
import LayoutExplorer from './admin/LayoutExplorer'
import ABCSyncAdmin from './admin/ABCSyncAdmin'
import CustomFieldsAdmin from './admin/CustomFieldsAdmin'
import ActionLinksAdmin from './admin/ActionLinksAdmin'
import MembershipSkipListAdmin from './admin/MembershipSkipListAdmin'
import SharedCredentialsAdmin from './admin/SharedCredentialsAdmin'
import LauncherVersionAdmin from './admin/LauncherVersionAdmin'
import LauncherInstallsAdmin from './admin/LauncherInstallsAdmin'
import PortalRefreshAdmin from './admin/PortalRefreshAdmin'
import AuditLogAdmin from './admin/AuditLogAdmin'
import PtSchedulerView from './admin/PtSchedulerView'
import OnlineJoinAdmin from './admin/OnlineJoinAdmin'
import VipReferralsAdmin from './admin/VipReferralsAdmin'
import TourCheckinLocations from './admin/TourCheckinLocations'
import DailySnapshotReport from './reports/DailySnapshotReport'
import PaychexTrainingAdmin from './admin/PaychexTrainingAdmin'
import RevenueBackfillTile from './admin/RevenueBackfillTile'
import VendorPriceListAdmin from './admin/VendorPriceListAdmin'
import Trends12moExportTab from './admin/Trends12moExportTab'
import ReferralRewardsAdmin from './admin/ReferralRewardsAdmin'
import KpiGoalsAdmin from './admin/KpiGoalsAdmin'
import AuditTogglesAdmin from './admin/AuditTogglesAdmin'
import SpeedToLeadAudit from './admin/SpeedToLeadAudit'
import MembershipAuditReport from './reports/MembershipAuditReport'
import UniversityEnrollAdmin from './admin/UniversityEnrollAdmin'
import BlogAutomationView from './BlogAutomationView'
import AdminPrintDevicesTab from './admin/AdminPrintDevicesTab'
import AdminPrintAutomationsTab from './admin/AdminPrintAutomationsTab'
import DayOneProgramsAdmin from './admin/DayOneProgramsAdmin'

const SETUP_TILES = [
  { key: 'staff', label: 'Staff', desc: 'Accounts & Roles', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z' },
  { key: 'import', label: 'Import Staff', desc: 'Bulk Excel Upload', icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5' },
  { key: 'employee-roster', label: 'Employee Roster', desc: 'ABC Audit for Managers', icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3' },
  { key: 'trends-12mo', label: '12-Month Trends', desc: 'Excel Export', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z' },
  { key: 'tiles', label: 'Tiles', desc: 'Portal Layout', icon: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z' },
  { key: 'roles-v2', label: 'Roles', desc: 'Roles & Permissions', icon: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z' },
  { key: 'config', label: 'App Config', desc: 'Kiosk Settings', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z' },
  { key: 'tickets', label: 'Tickets', desc: 'Embed Config', icon: 'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z' },
  { key: 'drive-folders', label: 'Drive Folders', desc: 'Shared Drive Tiles', icon: 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z' },
  { key: 'layouts', label: 'Layouts', desc: 'Explore UI Options', icon: 'M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 0 1-1.125-1.125v-3.75ZM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-8.25ZM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-2.25Z' },
  { key: 'action-links', label: 'Action Links', desc: 'Day One & VIP URLs', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-4.939a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757' },
  { key: 'day-one-programs', label: 'Day One Programs', desc: 'Generator Setup & Monitor', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
  { key: 'membership-skip', label: 'Excluded Types', desc: 'Membership Filter', icon: 'M3 4.5h13.5m-13.5 7.5H21m-7.5 7.5h-9M9 4.5l3 3m0-3-3 3' },
  { key: 'online-join', label: 'Online Join', desc: 'Membership Signup Admin', icon: 'M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z' },
  { key: 'vip-referrals', label: 'VIP Referrals', desc: 'Referral Submissions + Webhook Config', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z' },
  { key: 'tour-checkin', label: 'Tour Check-In', desc: 'Check-In App per Location', icon: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z' },
  { key: 'kpi-goals', label: 'KPI Goals', desc: 'Report Targets', icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z' },
  { key: 'audit-toggles', label: 'Audits', desc: 'Per-Club Audit Toggles', icon: 'M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V19.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75h-7.5m7.5-3h-7.5m-4.5-9v12.75c0 .621.504 1.125 1.125 1.125h.375' },
  { key: 'vendor-price-list', label: 'Vendor Price List', desc: 'SKU↔UPC & Cost Import', icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3' },
  { key: 'print-devices', label: 'Print Devices', desc: 'Receipt Printers per Gym', icon: 'M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z' },
  { key: 'print-automations', label: 'Print Automations', desc: 'Till-Close Print Triggers', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
]

const TECHNICAL_TILES = [
  { key: 'sync', label: 'GHL Sync', desc: 'Sync Health', icon: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182' },
  { key: 'abc-sync', label: 'ABC Sync', desc: 'Member Reconciliation', icon: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
  { key: 'paychex', label: 'Paychex', desc: 'API & Companies', icon: 'M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z' },
  { key: 'references', label: 'References', desc: 'Links & URLs', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-4.939a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757' },
  { key: 'sms', label: 'SMS History', desc: 'Twilio Messages', icon: 'M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z' },
  { key: 'webhooks', label: 'Webhooks', desc: 'Webhook History', icon: 'M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m-6 3.75 3 3m0 0 3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5a2.25 2.25 0 0 1 2.25-2.25H9' },
  { key: 'custom-fields', label: 'Custom Fields', desc: 'GHL Field Lookup', icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z' },
  { key: 'google-connections', label: 'Google Connections', desc: 'OAuth Scopes & Reconnect', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244' },
  { key: 'shared-credentials', label: 'Shared Logins', desc: 'Master Account Credentials', icon: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z' },
  { key: 'launcher-version', label: 'Force Update', desc: 'Pin Launcher Version', icon: 'M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3' },
  { key: 'kiosk-installs', label: 'Kiosk Installs', desc: 'Machine Locations & ABC URLs', icon: 'M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25' },
  { key: 'portal-refresh', label: 'Force Refresh', desc: 'Reload All Portal Tabs', icon: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182' },
  { key: 'audit-log', label: 'Activity', desc: 'Audit Log', icon: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z' },
  { key: 'revenue-backfill', label: 'Revenue Backfill', desc: 'ABC CSV Upload', icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3' },
  { key: 'referral-rewards', label: 'Referral Rewards', desc: 'Free-Month Credits', icon: 'M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z' },
  { key: 'speed-to-lead-audit', label: 'Speed to Lead Audit', desc: 'Vet Lead Response Times', icon: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z' },
  { key: 'blog', label: 'Blog Automation', desc: 'AI Posts', icon: 'M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z' },
]

// Experimental Tools — admin-only sandbox for in-progress features
const EXPERIMENTAL_TILES = [
  { key: 'pt-scheduler', label: 'PT Scheduler', desc: 'Trainer Calendar (Beta)', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5' },
  { key: 'paychex-training', label: 'Training', desc: 'Paychex Compliance (Beta)', icon: 'M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5' },
  { key: 'daily-snapshot', label: 'Daily Snapshot', desc: 'Single-Day Report (Beta)', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5M12 12.75h.008v.008H12v-.008z' },
  { key: 'membership-audit', label: 'Membership Audit', desc: 'Dues & Leaks (Beta)', icon: 'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z M6 6h.008v.008H6V6Z' },
  { key: 'university-enroll', label: 'University Enrollment', desc: 'Enroll Trainees (Beta)', icon: 'M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5' },
]

const ALL_TILES = [...SETUP_TILES, ...TECHNICAL_TILES, ...EXPERIMENTAL_TILES]

const EXPERIMENTAL_KEYS = new Set(EXPERIMENTAL_TILES.map(t => t.key))

const TILE_BY_KEY = Object.fromEntries(ALL_TILES.map(t => [t.key, t]))

// ABC-style grouped layout: a handful of category columns, each with a header
// and its list of tools — no more one long scrolling list.
const CATEGORIES = [
  { title: 'Staff & HR', keys: ['staff', 'import', 'employee-roster', 'roles-v2', 'paychex', 'paychex-training'] },
  { title: 'Portal Setup', keys: ['tiles', 'layouts', 'config', 'drive-folders', 'action-links', 'references', 'tickets', 'portal-refresh'] },
  { title: 'Reports & KPIs', keys: ['kpi-goals', 'trends-12mo', 'daily-snapshot', 'membership-audit', 'speed-to-lead-audit', 'revenue-backfill'] },
  { title: 'Members & Sales', keys: ['online-join', 'vip-referrals', 'tour-checkin', 'membership-skip', 'referral-rewards', 'audit-toggles', 'vendor-price-list'] },
  { title: 'Integrations & Sync', keys: ['sync', 'abc-sync', 'custom-fields', 'google-connections', 'shared-credentials'] },
  { title: 'Logs & Messaging', keys: ['webhooks', 'sms', 'audit-log'] },
  { title: 'Kiosk & Devices', keys: ['kiosk-installs', 'launcher-version', 'print-devices', 'print-automations'] },
  { title: 'Automation & AI', keys: ['blog', 'day-one-programs', 'university-enroll', 'pt-scheduler'] },
]

// Build each category's tiles from the lookup, flagging experimental ones. Any
// tile not assigned to a category above falls into a catch-all so nothing is
// ever silently dropped when new admin tools are added.
const ASSIGNED_KEYS = new Set(CATEGORIES.flatMap(c => c.keys))
const CATEGORY_GROUPS = [
  ...CATEGORIES.map(c => ({
    title: c.title,
    tiles: c.keys
      .map(k => TILE_BY_KEY[k])
      .filter(Boolean)
      .map(t => ({ ...t, experimental: EXPERIMENTAL_KEYS.has(t.key) })),
  })),
  ...(ALL_TILES.some(t => !ASSIGNED_KEYS.has(t.key))
    ? [{
        title: 'Other',
        tiles: ALL_TILES
          .filter(t => !ASSIGNED_KEYS.has(t.key))
          .map(t => ({ ...t, experimental: EXPERIMENTAL_KEYS.has(t.key) })),
      }]
    : []),
].filter(g => g.tiles.length > 0)

export default function AdminPanel({ onBack, isElectron, onLocationChange, userRole }) {
  const [activeSection, setActiveSection] = useState(null)
  const [query, setQuery] = useState('')

  // Render active section content
  if (activeSection) {
    const tile = ALL_TILES.find(t => t.key === activeSection)
    return (
      <div className="w-full px-8 py-6">
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
          <button
            onClick={() => setActiveSection(null)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin
          </button>
          <h2 className="text-xl font-bold text-text-primary">{tile?.label}</h2>
        </div>
        {activeSection === 'staff' && <AdminStaffTab />}
        {activeSection === 'import' && <BulkImportTab />}
        {activeSection === 'employee-roster' && <EmployeeRosterTab />}
        {activeSection === 'tiles' && <AdminTilesTab />}
        {activeSection === 'references' && <AdminReferencesTab />}
        {activeSection === 'config' && <AdminConfig isElectron={isElectron} onClose={() => setActiveSection(null)} onLocationChange={onLocationChange} embedded />}
        {activeSection === 'sms' && <SMSHistoryTab />}
        {activeSection === 'webhooks' && <WebhookLogs />}
        {activeSection === 'sync' && <SyncStatusTile />}
        {activeSection === 'tickets' && <TicketEmbedsAdmin />}
        {activeSection === 'drive-folders' && <DriveFoldersAdmin />}
        {activeSection === 'google-connections' && <GoogleConnections />}
        {activeSection === 'paychex' && <PaychexAdmin />}
        {activeSection === 'layouts' && <LayoutExplorer />}
        {activeSection === 'abc-sync' && <ABCSyncAdmin />}
        {activeSection === 'referral-rewards' && <ReferralRewardsAdmin />}
        {activeSection === 'custom-fields' && <CustomFieldsAdmin />}
        {activeSection === 'action-links' && <ActionLinksAdmin />}
        {activeSection === 'day-one-programs' && <DayOneProgramsAdmin />}
        {activeSection === 'membership-skip' && <MembershipSkipListAdmin />}
        {activeSection === 'shared-credentials' && <SharedCredentialsAdmin />}
        {activeSection === 'launcher-version' && <LauncherVersionAdmin />}
        {activeSection === 'kiosk-installs' && <LauncherInstallsAdmin />}
        {activeSection === 'print-devices' && <AdminPrintDevicesTab />}
        {activeSection === 'print-automations' && <AdminPrintAutomationsTab />}
        {activeSection === 'portal-refresh' && <PortalRefreshAdmin />}
        {activeSection === 'audit-log' && <AuditLogAdmin />}
        {activeSection === 'pt-scheduler' && <PtSchedulerView />}
        {activeSection === 'online-join' && <OnlineJoinAdmin />}
        {activeSection === 'vip-referrals' && <VipReferralsAdmin />}
        {activeSection === 'tour-checkin' && <TourCheckinLocations />}
        {activeSection === 'kpi-goals' && <KpiGoalsAdmin />}
        {activeSection === 'audit-toggles' && <AuditTogglesAdmin />}
        {activeSection === 'speed-to-lead-audit' && <SpeedToLeadAudit />}
        {activeSection === 'membership-audit' && <MembershipAuditReport />}
        {activeSection === 'university-enroll' && <UniversityEnrollAdmin />}
        {activeSection === 'roles-v2' && <AdminRolesV2Tab />}
        {activeSection === 'daily-snapshot' && <DailySnapshotReport />}
        {activeSection === 'paychex-training' && <PaychexTrainingAdmin />}
        {activeSection === 'revenue-backfill' && <RevenueBackfillTile />}
        {activeSection === 'vendor-price-list' && <VendorPriceListAdmin />}
        {activeSection === 'trends-12mo' && <Trends12moExportTab />}
        {activeSection === 'blog' && <BlogAutomationView onBack={() => setActiveSection(null)} userRole={userRole} />}
      </div>
    )
  }

  // Filter the grouped tools by the search box, dropping empty categories.
  const q = query.trim().toLowerCase()
  const groups = q
    ? CATEGORY_GROUPS
        .map(g => ({
          ...g,
          tiles: g.tiles.filter(t =>
            t.label.toLowerCase().includes(q) || (t.desc || '').toLowerCase().includes(q)
          ),
        }))
        .filter(g => g.tiles.length > 0)
    : CATEGORY_GROUPS

  return (
    <div className="w-full px-8 py-6">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <h2 className="text-xl font-bold text-text-primary">Admin Panel</h2>
      </div>

      <div className="bg-surface rounded-xl border border-border p-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter admin tools…"
          className="w-full max-w-md mb-6 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
        />

        {groups.length === 0 ? (
          <p className="text-sm text-text-muted">No admin tools match “{query}”.</p>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-8 [column-fill:balance]">
            {groups.map(group => (
              <div key={group.title} className="mb-7 break-inside-avoid">
                <h3 className="mb-2 pb-1.5 border-b border-border text-sm font-bold uppercase tracking-wide text-wcs-red">
                  {group.title}
                </h3>
                <ul className="space-y-0.5">
                  {group.tiles.map(tile => (
                    <li key={tile.key}>
                      <button
                        onClick={() => setActiveSection(tile.key)}
                        title={tile.desc || ''}
                        className="group flex w-full items-center gap-1.5 rounded-md py-1 px-1.5 -mx-1.5 text-left transition-colors hover:bg-bg"
                      >
                        <span className="truncate text-sm text-text-primary group-hover:text-wcs-red transition-colors">
                          {tile.label}
                        </span>
                        {tile.experimental && (
                          <span className="shrink-0 rounded-full bg-wcs-red/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-wcs-red">
                            Beta
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
