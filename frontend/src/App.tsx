import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWebUsage } from './utils/useWebUsage.ts';
import { DAILY_WEB_USAGE_SCREEN_ENABLED } from './utils/featureFlags.ts';
import { LoginPage, type UserSession } from './pages/LoginPage.tsx';
import { OutletSelectionPage, type OutletSummary } from './pages/OutletSelectionPage.tsx';
import { CategoryPage } from './pages/CategoryPage.tsx';
import { ReportDateInput } from './pages/ReportDateInput.tsx';
import { ProfileMenu } from './pages/ProfileMenu.tsx';
import { EmployeesPage } from './pages/EmployeesPage.tsx';
import { CustomersPage } from './pages/CustomersPage.tsx';
import { DevicesPage } from './pages/DevicesPage.tsx';
import { BroadcastPage } from './pages/BroadcastPage.tsx';
import { TransferPreviewPage } from './pages/TransferPreviewPage.tsx';
import { MulticounterPage } from './pages/MulticounterPage.tsx';
import { UserAccountPage } from './pages/UserAccountPage.tsx';
import { ProductsPage } from './pages/ProductsPage.tsx';
import { ServicePointsPage } from './pages/ServicePointsPage.tsx';
import { PremisesPage } from './pages/PremisesPage.tsx';
import { UploadExcelPage } from './pages/UploadExcelPage.tsx';
import { BillWiseReportPage } from './pages/BillWiseReportPage.tsx';
import { ShiftSummaryReportPage } from './pages/ShiftSummaryReportPage.tsx';
import { DaywiseReportPage } from './pages/DaywiseReportPage.tsx';
import { CategoryWiseReportPage } from './pages/CategoryWiseReportPage.tsx';
import { ProductWiseReportPage } from './pages/ProductWiseReportPage.tsx';
import { GstReportPage } from './pages/GstReportPage.tsx';
import { GstDaywiseReportPage } from './pages/GstDaywiseReportPage.tsx';
import { StockReportPage } from './pages/StockReportPage.tsx';
import { StockInOutReportPage } from './pages/StockInOutReportPage.tsx';
import { StockAdjustmentPage } from './pages/StockAdjustmentPage.tsx';
import { GoodsReceivedPage } from './pages/GoodsReceivedPage.tsx';
import { StockTransferReportPage } from './pages/StockTransferReportPage.tsx';
import {
  Accessibility, BadgeIndianRupee, Banknote, Bot, Calculator, Download,
  CalendarCheck, CalendarDays, ChevronDown, CircleHelp, ClipboardCheck,
  ClipboardList, ContactRound, CreditCard, Database, Gauge, Home,
  LayoutDashboard, LogOut, Menu, MessageSquareText, Monitor, Package, Radio, ReceiptText,
  PackageSearch, RefreshCw, SlidersHorizontal, Store, TrendingUp, Upload,
  UserRoundCog, Users, UsersRound, WalletCards, X,
} from 'lucide-react';
import { downloadDashboardExcel, type ShiftDashboardData } from './utils/dashboardExcel.ts';
import './App.css';
import './Theme.css';

const hiddenNavigationGroups = new Set(['Inventory']);
const disabledNavigationItems = new Set(['Inventory:Products', 'Operations:Broadcast', 'Operations:Device', 'Operations:Multicounter']);
const dashboardBroadcastActionEnabled = false;

function Sparkline({ tone = 'cyan', compact = false }: { tone?: 'cyan' | 'green' | 'muted'; compact?: boolean }) {
  return (
    <svg className={`sparkline ${compact ? 'compact' : ''}`} viewBox="0 0 180 55" role="img" aria-label="Sales trend" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M2 47 L30 47 L45 34 L58 27 L72 35 L86 33 L98 13 L112 43 L125 28 L145 27 L178 11 L178 55 L2 55 Z" fill={`url(#spark-fill-${tone})`} />
      <path className="sparkline-line" d="M2 47 L30 47 L45 34 L58 27 L72 35 L86 33 L98 13 L112 43 L125 28 L145 27 L178 11" />
    </svg>
  );
}

function KpiCard({ label, value, tone, icon }: { label: string; value: string; tone: 'cyan' | 'green' | 'muted'; icon: ReactNode }) {
  return (
    <article className={`kpi-card ${tone}`}>
      <div className="kpi-card-topline"><span>{label}</span><span className="kpi-icon">{icon}</span></div>
      <strong>{value}</strong>
      <Sparkline tone={tone} />
    </article>
  );
}

function PaymentTile({ label, value = '₹ 0', brand, featured = false }: { label: string; value?: string; brand: ReactNode; featured?: boolean }) {
  return (
    <article className={`payment-tile ${featured ? 'featured' : ''}`}>
      <span className="payment-brand">{brand}</span>
      <div className="payment-copy"><span>{label}</span><strong>{value}</strong></div>
      {featured && <Sparkline compact />}
    </article>
  );
}

function MetricRow({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{icon}<span>{label}</span></span>
      <strong>{value}</strong>
    </div>
  );
}

function LogoutConfirmation({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="logout-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-modal-title">
        <span className="logout-modal-icon"><LogOut /></span>
        <h2 id="logout-modal-title">Confirm logout</h2>
        <p>Are you sure you want to logout?</p>
        <div className="logout-modal-actions">
          <button type="button" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="confirm" onClick={onConfirm}><LogOut /> Logout</button>
        </div>
      </section>
    </div>
  );
}


function localDayId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMoney(value = 0): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function App() {
  const [activeNavigation, setActiveNavigation] = useState({ id: 'Home:Dashboard', label: 'Dashboard' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clock, setClock] = useState('16:45:21');
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('pos_theme') === 'dark'; }
    catch { return false; }
  });
  const [session, setSession] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('pos_user_session');
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved) as Partial<UserSession>;
      if (parsed.id && parsed.email && parsed.name && parsed.role && parsed.terminal && parsed.token) {
        return parsed as UserSession;
      }
      localStorage.removeItem('pos_user_session');
      return null;
    } catch {
      localStorage.removeItem('pos_user_session');
      return null;
    }
  });
  const [selectedOutlet, setSelectedOutlet] = useState<OutletSummary | null>(() => {
    const saved = localStorage.getItem('pos_selected_outlet');
    if (!saved) return null;
    try { return JSON.parse(saved) as OutletSummary; } catch { return null; }
  });
  const usage = useWebUsage(session?.token, selectedOutlet?.id);
  const releaseUsage = usage.release;
  const [dashboardData, setDashboardData] = useState<ShiftDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboardReloadKey, setDashboardReloadKey] = useState(0);
  const [dashboardDay, setDashboardDay] = useState(localDayId);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('all');
  const [dashboardExporting, setDashboardExporting] = useState(false);
  const [dashboardExportError, setDashboardExportError] = useState('');
  const dashboardExportBusy = useRef(false);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Home: true,
    Masters: true,
    Inventory: false,
    Operations: false,
    Reports: false,
  });

  const toggleGroup = (groupLabel: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupLabel]: !prev[groupLabel],
    }));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    try { localStorage.setItem('pos_theme', darkMode ? 'dark' : 'light'); }
    catch { /* The theme still works when browser storage is unavailable. */ }
  }, [darkMode]);

  useEffect(() => {
    const updateClock = () => setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleLoginSuccess = useCallback((user: UserSession) => {
    setSession(user);
    setSelectedOutlet(null);
    setDashboardData(null);
    setSelectedShiftId('all');
    setDashboardError('');
    localStorage.setItem('pos_user_session', JSON.stringify(user));
    localStorage.removeItem('pos_selected_outlet');
  }, []);

  const handleAccountSaved = (details: { name: string | null; email: string | null }) => {
    if (!session) return;
    const updated = { ...session, ...(details.name !== null ? { name: details.name } : {}),
      ...(details.email !== null ? { email: details.email } : {}) };
    setSession(updated);
    localStorage.setItem('pos_user_session', JSON.stringify(updated));
  };

  const handleLogout = useCallback(() => {
    void releaseUsage().catch(() => undefined);
    setLogoutConfirmationOpen(false);
    setSession(null);
    setSelectedOutlet(null);
    setDashboardData(null);
    setSelectedShiftId('all');
    setDashboardError('');
    localStorage.removeItem('pos_user_session');
    localStorage.removeItem('pos_selected_outlet');
  }, [releaseUsage]);

  const requestLogout = useCallback(() => {
    setLogoutConfirmationOpen(true);
  }, []);

  const handleOutletSelect = useCallback((outlet: OutletSummary) => {
    setSelectedOutlet(outlet);
    setDashboardData(null);
    setSelectedShiftId('all');
    setDashboardError('');
    localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet));
  }, []);

  const handleChangeOutlet = useCallback(() => {
    void releaseUsage().catch(() => undefined);
    setSelectedOutlet(null);
    setDashboardData(null);
    setSelectedShiftId('all');
    setDashboardError('');
    localStorage.removeItem('pos_selected_outlet');
  }, [releaseUsage]);

  useEffect(() => {
    if (!session || !selectedOutlet || !usage.ready) return;

    const controller = new AbortController();
    let inFlight = false;
    const loadDashboard = async (background = false) => {
      if (controller.signal.aborted || inFlight || (background && document.visibilityState === 'hidden')) return;
      inFlight = true;
      if (!background) {
        setDashboardLoading(true);
        setDashboardError('');
        setDashboardData(null);
      }
      try {
        const dayId = dashboardDay;
        const response = await fetch(`/api/outlets/${encodeURIComponent(selectedOutlet.id)}/dashboard?dayId=${dayId}`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = await response.json() as { success: boolean; message?: string; data?: ShiftDashboardData };
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          handleLogout();
          return;
        }
        if (!response.ok || !result.data) {
          if (response.status === 403 || response.status === 404) setDashboardData(null);
          setDashboardError(result.message || 'Unable to load shift data.');
          return;
        }
        setDashboardData(result.data);
        setDashboardError('');
      } catch (requestError) {
        if (!controller.signal.aborted && (requestError as Error).name !== 'AbortError') {
          setDashboardError('Cannot reach the shift service.');
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted && !background) setDashboardLoading(false);
      }
    };

    void loadDashboard();
    const refresh = () => { void loadDashboard(true); };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [session, selectedOutlet, dashboardDay, dashboardReloadKey, handleLogout, usage.ready]);

  const exportDashboard = async () => {
    if (!session || !selectedOutlet || !dashboardData || dashboardLoading || dashboardError
      || dashboardData.dayId !== dashboardDay || dashboardExportBusy.current) return;
    dashboardExportBusy.current = true;
    setDashboardExporting(true); setDashboardExportError('');
    try {
      await downloadDashboardExcel({ outlet: selectedOutlet, dayId: dashboardDay,
        cashier: session.name, terminal: session.terminal, data: dashboardData });
    } catch {
      setDashboardExportError('Unable to download the dashboard Excel file. Please try Export again.');
    } finally {
      dashboardExportBusy.current = false; setDashboardExporting(false);
    }
  };

  if (!session) return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  if (!selectedOutlet) return (
    <>
      <OutletSelectionPage session={session} onSelect={handleOutletSelect} onLogout={requestLogout} />
      {logoutConfirmationOpen && <LogoutConfirmation onCancel={() => setLogoutConfirmationOpen(false)} onConfirm={handleLogout} />}
    </>
  );

  if (DAILY_WEB_USAGE_SCREEN_ENABLED && !usage.ready && !usage.suspended) return <main className="outlet-selection-page">
    <section className="outlet-selection-content"><div className="outlet-state-card" role={usage.message ? 'alert' : 'status'}>
      <strong>{usage.blocked ? 'Daily usage limit reached' : usage.message ? 'Web POS access paused' : 'Checking outlet access…'}</strong>
      <p>{usage.message || `Verifying daily usage for ${selectedOutlet.name}…`}</p>
      {!!usage.message && !usage.blocked && <button type="button" onClick={usage.retry}>Continue / Retry</button>}
      <button type="button" onClick={handleChangeOutlet}>Change outlet</button>
      <button type="button" onClick={handleLogout}>Sign out</button>
    </div></section>
  </main>;

  const shifts: ShiftDashboardData[] = dashboardData?.shifts && dashboardData.shifts.length > 0
    ? dashboardData.shifts
    : (dashboardData ? [dashboardData] : []);

  const activeShift = shifts.find(s => !s.inActive) ?? shifts.at(-1);

  const displayData: ShiftDashboardData | null = selectedShiftId === 'all'
    ? dashboardData
    : (shifts.find(s => s.id === selectedShiftId) ?? dashboardData);

  const shiftToShow = selectedShiftId === 'all' ? (activeShift ?? displayData) : displayData;

  const payments = displayData?.payments ?? {};
  const cashInHand = displayData
    ? displayData.openingAmt + displayData.cashSale - displayData.expCash
    : 0;

  const navigationGroups = [
    { label: 'Home', icon: <Home />, items: [{ label: 'Dashboard', icon: <LayoutDashboard /> }] },
    { label: 'Masters', icon: <ClipboardList />, items: [
      { label: 'Category', icon: <SlidersHorizontal /> },
      { label: 'Products', icon: <Package /> },
      { label: 'Service Point', icon: <Store /> },
      { label: 'Premises', icon: <Store /> },
      { label: 'Stock In and Out', icon: <ClipboardCheck /> },
      { label: 'Goods Received', icon: <ReceiptText /> },
      { label: 'User Account', icon: <ContactRound /> },
      { label: 'Employees/Captain/Salesman', icon: <UserRoundCog /> },
      { label: 'Category & Product Transfer', icon: <Database /> },
      { label: 'Customer', icon: <UsersRound /> },
    ] },
    { label: 'Inventory', icon: <Package />, items: [
      { label: 'Products', icon: <Store /> },
      { label: 'Upload Excel', icon: <Upload /> },
    ] },
    { label: 'Operations', icon: <Bot />, items: [
      { label: 'Upload Excel', icon: <Upload /> },
      { label: 'Multicounter', icon: <Users /> },
      { label: 'Device', icon: <Monitor /> },
      { label: 'Broadcast', icon: <Radio /> },
    ] },
    { label: 'Reports', icon: <ReceiptText />, items: [
      { label: 'Day Wise Report', icon: <CalendarDays /> },
      { label: 'Shift Summary Report', icon: <CalendarCheck /> },
      { label: 'Category Wise', icon: <SlidersHorizontal /> },
      { label: 'Product Wise', icon: <PackageSearch /> },
      { label: 'Stock Report', icon: <ClipboardCheck /> },
      { label: 'Stock In-Out Report', icon: <ClipboardList /> },
      { label: 'Stock Transfer Report', icon: <Accessibility /> },
      { label: 'GST Report', icon: <Calculator /> },
      { label: 'GST Report Day Wise', icon: <CalendarCheck /> },
      { label: 'Bill Wise Sale Report', icon: <ReceiptText /> },
    ] },
  ];

  return (
    <div className="retail-dashboard-shell">
      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`dashboard-sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Primary navigation">
        <button type="button" className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X /></button>
        <div className="business-profile">
          <span className="business-avatar">{selectedOutlet.name.slice(0, 2).toUpperCase()}</span>
          <div><small>Selected Outlet</small><strong>{selectedOutlet.name}</strong><span>{selectedOutlet.branch || selectedOutlet.country}</span></div>
        </div>
        <nav className="sidebar-nav">
          {navigationGroups.filter(group => !hiddenNavigationGroups.has(group.label)).map((group) => (
            <section
              className={`nav-group ${group.label === 'Masters' ? 'masters-group' : ''} ${group.label === 'Reports' ? 'reports-group' : ''}`}
              key={group.label}
            >
              <div
                className="nav-group-title"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleGroup(group.label)}
              >
                <span>{group.icon}{group.label}</span>
                <ChevronDown
                  style={{
                    transform: openGroups[group.label] ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </div>
              {(openGroups[group.label] ?? true) && (
                <div className="nav-group-items">
                  {group.items.filter(item => !disabledNavigationItems.has(`${group.label}:${item.label}`)).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className={activeNavigation.id === `${group.label}:${item.label}` ? 'active' : ''}
                      onClick={() => {
                        setActiveNavigation({ id: `${group.label}:${item.label}`, label: item.label });
                        setSidebarOpen(false);
                      }}
                    >
                      {item.icon}<span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </nav>
        <div className="plan-card">
          <small>Your Plan</small>
          <div><strong>POS Pro</strong><span>Active</span></div>
          <p>Valid till 24 Jan 2029</p>
          <button type="button">Upgrade Plan</button>
        </div>
      </aside>

      <div className="dashboard-stage">
        <header className="retail-header">
          <div className="header-brand">
            <button type="button" className="mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu /></button>
            <span className="header-logo-crop">
              <img src="/logo1.png" alt="Sensible Connect — Built for Business" />
            </span>
          </div>
          <div className="header-actions">
            <button className="theme-button" type="button" aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={darkMode} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setDarkMode(current => !current)}><span aria-hidden="true">☾</span></button>
            <ProfileMenu key={`${session.id}:${selectedOutlet.id}`} session={session} outletId={selectedOutlet.id} onSessionExpired={handleLogout} />
          </div>
        </header>

        <main className="dashboard-workspace">
          {!DAILY_WEB_USAGE_SCREEN_ENABLED && !usage.ready && !usage.suspended && (
            <section className="outlet-state-card" data-outlet-access-notice role={usage.message ? 'alert' : 'status'}>
              <strong>{usage.blocked ? 'Daily usage limit reached' : usage.message ? 'Outlet access paused' : 'Checking outlet access…'}</strong>
              <p>{usage.message || `Verifying access to ${selectedOutlet.name}…`}</p>
              {!usage.blocked && <button type="button" onClick={usage.retry}>{usage.message ? 'Continue / Retry' : 'Retry connection'}</button>}
              <button type="button" onClick={handleChangeOutlet}>Change outlet</button>
              <button type="button" onClick={handleLogout}>Sign out</button>
            </section>
          )}
          {!DAILY_WEB_USAGE_SCREEN_ENABLED && !usage.authorized ? null : activeNavigation.id === 'Masters:Goods Received' ? (
            <GoodsReceivedPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} onCancel={() => setActiveNavigation({ id: 'Home:Dashboard', label: 'Dashboard' })} />
          ) : activeNavigation.id === 'Masters:Stock In and Out' ? (
            <StockAdjustmentPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Operations:Multicounter' ? (
            <MulticounterPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Operations:Device' ? (
            <DevicesPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Operations:Broadcast' ? (
            <BroadcastPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Category & Product Transfer' ? (
            <TransferPreviewPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Service Point' ? (
            <ServicePointsPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Customer' ? (
            <CustomersPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Employees/Captain/Salesman' ? (
            <EmployeesPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:User Account' ? (
            <UserAccountPage key={session.id} token={session.token} onSessionExpired={handleLogout} onSaved={handleAccountSaved} />
          ) : activeNavigation.id === 'Reports:Bill Wise Sale Report' ? (
            <BillWiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Category Wise' ? (
            <CategoryWiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Product Wise' ? (
            <ProductWiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Stock Report' ? (
            <StockReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Stock In-Out Report' ? (
            <StockInOutReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Stock Transfer Report' ? (
            <StockTransferReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:GST Report' ? (
            <GstReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:GST Report Day Wise' ? (
            <GstDaywiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Shift Summary Report' ? (
            <ShiftSummaryReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Day Wise Report' ? (
            <DaywiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Category' ? (
            <CategoryPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Premises' ? (
            <PremisesPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Products' || activeNavigation.id === 'Inventory:Products' ? (
            <ProductsPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Inventory:Upload Excel' || activeNavigation.id === 'Operations:Upload Excel' ? (
            <UploadExcelPage outletId={selectedOutlet.id} token={session.token} onSessionExpired={handleLogout} />
          ) : (
            <>
              <section className="page-hero">
                <div><h1>Retail POS Dashboard</h1><p>{selectedOutlet.name} · {activeNavigation.label} · Daily sales performance</p></div>
                <div className="hero-actions"><div className="shift-selector-bar" role="tablist" aria-label="Shift view selection">
                  <button type="button" role="tab" aria-selected={selectedShiftId === 'all'} className={`shift-pill ${selectedShiftId === 'all' ? 'active' : ''}`} onClick={() => setSelectedShiftId('all')}>All Shifts</button>
                  {shifts.map(shift => <button key={shift.id} type="button" role="tab" aria-selected={selectedShiftId === shift.id} className={`shift-pill ${selectedShiftId === shift.id ? 'active' : ''}`} onClick={() => setSelectedShiftId(shift.id)}>Shift {shift.shiftNo || '—'}</button>)}
                </div><label className="dashboard-date-picker" htmlFor="dashboard-report-date"><ReportDateInput id="dashboard-report-date" aria-label="Dashboard date" value={dashboardDay} onChange={value => { if (value) { setDashboardDay(value); setSelectedShiftId('all'); } }} /><span>{clock}</span></label><button type="button" onClick={() => void exportDashboard()} disabled={!dashboardData || dashboardLoading || !!dashboardError || dashboardExporting || dashboardData.dayId !== dashboardDay}>{dashboardExporting ? <RefreshCw /> : <Download />}{dashboardExporting ? 'Exporting…' : 'Export Excel'}</button></div>
              </section>

              {dashboardLoading && <div className="dashboard-data-notice"><RefreshCw className="dashboard-data-spinner" /> Loading shift data…</div>}
              {!dashboardLoading && dashboardError && <div className="dashboard-data-notice error"><span>{dashboardError}</span><button type="button" onClick={() => setDashboardReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}

              {dashboardExportError && <div className="dashboard-data-notice error" role="alert">{dashboardExportError}</div>}

              <div className="dashboard-columns">
              <div className="dashboard-primary">
              <section className="kpi-grid" aria-label="Key sales figures">
                <KpiCard label="Cash In Hand" value={formatMoney(cashInHand)} tone="green" icon={<Banknote />} />
                <KpiCard label="Total Sale" value={formatMoney(displayData?.totalSale)} tone="cyan" icon={<TrendingUp />} />
                <KpiCard label="Total Digital Sale" value={formatMoney(displayData?.digitalSale)} tone="muted" icon={<span className="upi-wordmark">UPI</span>} />
              </section>

              <section className="payment-section">
                <div className="section-heading"><div><h2>Other Sales</h2><p>Sales by payment method{selectedShiftId !== 'all' ? ` (Shift ${displayData?.shiftNo})` : ''}</p></div><SlidersHorizontal /></div>
                <div className="payment-grid">
                  <PaymentTile label="Cash" value={formatMoney(payments.cash ?? displayData?.cashSale)} featured brand={<Banknote />} />
                  <PaymentTile label="Google Pay" value={formatMoney(payments.googlepay)} brand={<span className="google-pay-mark">G</span>} />
                  <PaymentTile label="PhonePe" value={formatMoney(payments.phonepe)} brand={<span className="phonepe-mark">पे</span>} />
                  <PaymentTile label="Paytm" value={formatMoney(payments.paytm)} brand={<span className="paytm-mark">paytm</span>} />
                  <PaymentTile label="Cheque" value={formatMoney(payments.cheque_payment_mode)} brand={<ReceiptText />} />
                  <PaymentTile label="Card" value={formatMoney(payments.card)} brand={<CreditCard />} />
                  <PaymentTile label="Credit" value={formatMoney(payments.credit ?? displayData?.creditSale)} brand={<WalletCards />} />
                  <PaymentTile label="Other" value={formatMoney(payments.other)} brand={<SlidersHorizontal />} />
                </div>
              </section>

              <section className="bottom-panels">
                <article className="detail-panel">
                  <h2>Operational Summary{selectedShiftId !== 'all' ? ` (Shift ${displayData?.shiftNo})` : ''}</h2>
                  <div className="detail-grid">
                    <MetricRow icon={<ReceiptText />} label="No. of Bills" value={String(displayData?.billCount ?? 0)} />
                    <MetricRow icon={<BadgeIndianRupee />} label="Total Discount" value={formatMoney(displayData?.discount)} />
                    <MetricRow icon={<WalletCards />} label="Opening Balance" value={formatMoney(displayData?.openingAmt)} />
                    <MetricRow icon={<span className="percent-icon">%</span>} label="Total Tax" value={formatMoney(displayData?.tax)} />
                    <MetricRow icon={<Gauge />} label="Refund Amount" value={formatMoney(displayData?.refundAmount)} />
                    <MetricRow icon={<WalletCards />} label="Extra Charge" value={formatMoney(displayData?.extraCharges)} />
                  </div>
                </article>
                <article className="detail-panel">
                  <h2>Expenses &amp; Credits{selectedShiftId !== 'all' ? ` (Shift ${displayData?.shiftNo})` : ''}</h2>
                  <div className="detail-grid expenses-grid">
                    <MetricRow label="Total Expenses" value={formatMoney(displayData?.expensesAmtTotal)} />
                    <MetricRow label="Advance Payment" value={formatMoney(displayData?.advanceAmtTotal)} />
                    <MetricRow label="Received Customer Credit" value={formatMoney(displayData?.customerReceiveAmtTotal)} />
                  </div>
                </article>
              </section>
              </div>

              <aside className="dashboard-insights">
                <article className="insight-card">
                  <h2>Quick Actions</h2>
                  <button
                    type="button"
                    onClick={() => setActiveNavigation({ id: 'Masters:Category', label: 'Category' })}
                  >
                    <SlidersHorizontal />
                    <span><strong>Category Master</strong><small>Add, update & organize</small></span>
                  </button>
                  {/* <button type="button"><ShoppingCart /><span><strong>New Sale</strong><small>Start a new checkout</small></span></button> */}
                  <button type="button" onClick={() => setActiveNavigation({ id: 'Operations:Upload Excel', label: 'Upload Excel' })}><Upload /><span><strong>Upload Stock</strong><small>Import products from Excel</small></span></button>
                  {dashboardBroadcastActionEnabled && <button type="button" onClick={() => setActiveNavigation({ id: 'Operations:Broadcast', label: 'Broadcast' })}><MessageSquareText /><span><strong>Broadcast</strong><small>View devices and employees</small></span></button>}
                </article>
                <article className="insight-card shift-card">
                  <h2>{selectedShiftId === 'all' ? (activeShift && !activeShift.inActive ? 'Current Active Shift' : 'Latest Shift') : `Shift ${displayData?.shiftNo || '—'}`}</h2>
                  <div><span>Outlet</span><strong>{selectedOutlet.name}</strong></div>
                  <div><span>Branch</span><strong>{selectedOutlet.branch || 'Not specified'}</strong></div>
                  <div><span>Terminal</span><strong>{session.terminal}</strong></div>
                  <div><span>Cashier</span><strong>{session.name}</strong></div>
                  <div><span>Shift No.</span><strong>Shift {shiftToShow?.shiftNo || '—'}</strong></div>
                  <div><span>Bills</span><strong>{shiftToShow?.startBillNo || '—'} → {shiftToShow?.lastBillNo || '—'}</strong></div>
                  <div><span>Status</span><strong className={shiftToShow ? (shiftToShow.inActive ? 'status-closed' : 'status-active') : 'status-active'}>{shiftToShow ? (shiftToShow.inActive ? 'Closed' : 'Active') : 'Unavailable'}</strong></div>
                  <button type="button" onClick={handleChangeOutlet}>Change outlet</button>
                </article>
                <button type="button" className="help-card"><CircleHelp /><span><strong>Need help?</strong><small>View POS documentation</small></span></button>
                <button type="button" className="sidebar-logout" onClick={requestLogout}><LogOut /> Logout</button>
              </aside>
              </div>
            </>
          )}
        </main>
      </div>
      {logoutConfirmationOpen && <LogoutConfirmation onCancel={() => setLogoutConfirmationOpen(false)} onConfirm={handleLogout} />}
    </div>
  );
}
