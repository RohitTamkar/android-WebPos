import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LoginPage, type UserSession } from './pages/LoginPage.tsx';
import { OutletSelectionPage, type OutletSummary } from './pages/OutletSelectionPage.tsx';
import { CategoryPage } from './pages/CategoryPage.tsx';
import { BillWiseReportPage } from './pages/BillWiseReportPage.tsx';
import { ShiftSummaryReportPage } from './pages/ShiftSummaryReportPage.tsx';
import { CategoryWiseReportPage } from './pages/CategoryWiseReportPage.tsx';
import { ProductWiseReportPage } from './pages/ProductWiseReportPage.tsx';
import { GstReportPage } from './pages/GstReportPage.tsx';
import { StockReportPage } from './pages/StockReportPage.tsx';
import {
  Accessibility, BadgeIndianRupee, Banknote, Bell, Bot, Calculator,
  CalendarCheck, CalendarDays, ChevronDown, Clock3, CircleHelp, ClipboardCheck,
  ClipboardList, ContactRound, CreditCard, Database, Gauge, Home,
  LayoutDashboard, LogOut, Menu, MessageSquareText, Monitor, Package, Radio, ReceiptText,
  PackageSearch, RefreshCw, ShoppingCart, SlidersHorizontal, Store, TrendingUp, Upload,
  UserRoundCog, Users, UsersRound, WalletCards, X,
} from 'lucide-react';
import './App.css';

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

interface ShiftDashboardData {
  id: string;
  dayId: string;
  shiftNo: number;
  inActive: boolean;
  startTime: number;
  endTime: number;
  startBillNo: string;
  lastBillNo: string;
  lastBillTime: number;
  billCount: number;
  billDeletesNumber: number;
  billDeletesAmount: number;
  openingAmt: number;
  totalSale: number;
  cashSale: number;
  digitalSale: number;
  creditSale: number;
  subTotalBill: number;
  discount: number;
  tax: number;
  gstTotal: number;
  vatTotal: number;
  refundAmount: number;
  extraCharges: number;
  serviceChargeAmount: number;
  roundOff: number;
  expensesAmtTotal: number;
  expCash: number;
  expDigital: number;
  advanceAmtTotal: number;
  customerReceiveAmtTotal: number;
  receiveAmtTotal: number;
  swiggyTotal: number;
  zomatoTotal: number;
  payments: Record<string, number>;
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
  const [dashboardData, setDashboardData] = useState<ShiftDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboardReloadKey, setDashboardReloadKey] = useState(0);
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
    const updateClock = () => setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleLoginSuccess = useCallback((user: UserSession) => {
    setSession(user);
    setSelectedOutlet(null);
    setDashboardData(null);
    setDashboardError('');
    localStorage.setItem('pos_user_session', JSON.stringify(user));
    localStorage.removeItem('pos_selected_outlet');
  }, []);

  const handleLogout = useCallback(() => {
    setLogoutConfirmationOpen(false);
    setSession(null);
    setSelectedOutlet(null);
    setDashboardData(null);
    setDashboardError('');
    localStorage.removeItem('pos_user_session');
    localStorage.removeItem('pos_selected_outlet');
  }, []);

  const requestLogout = useCallback(() => {
    setLogoutConfirmationOpen(true);
  }, []);

  const handleOutletSelect = useCallback((outlet: OutletSummary) => {
    setSelectedOutlet(outlet);
    setDashboardData(null);
    setDashboardError('');
    localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet));
  }, []);

  const handleChangeOutlet = useCallback(() => {
    setSelectedOutlet(null);
    setDashboardData(null);
    setDashboardError('');
    localStorage.removeItem('pos_selected_outlet');
  }, []);

  useEffect(() => {
    if (!session || !selectedOutlet) return;

    const controller = new AbortController();
    const loadDashboard = async () => {
      setDashboardLoading(true);
      setDashboardError('');
      try {
        const dayId = localDayId();
        const response = await fetch(`/api/outlets/${encodeURIComponent(selectedOutlet.id)}/dashboard?dayId=${dayId}`, {
          headers: { Authorization: `Bearer ${session.token}` },
          signal: controller.signal,
        });
        const result = await response.json() as { success: boolean; message?: string; data?: ShiftDashboardData };
        if (response.status === 401) {
          handleLogout();
          return;
        }
        if (!response.ok || !result.data) {
          setDashboardData(null);
          setDashboardError(result.message || 'Unable to load shift data.');
          return;
        }
        setDashboardData(result.data);
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') {
          setDashboardData(null);
          setDashboardError('Cannot reach the shift service.');
        }
      } finally {
        if (!controller.signal.aborted) setDashboardLoading(false);
      }
    };

    void loadDashboard();
    return () => controller.abort();
  }, [session, selectedOutlet, dashboardReloadKey, handleLogout]);

  if (!session) return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  if (!selectedOutlet) return (
    <>
      <OutletSelectionPage session={session} onSelect={handleOutletSelect} onLogout={requestLogout} />
      {logoutConfirmationOpen && <LogoutConfirmation onCancel={() => setLogoutConfirmationOpen(false)} onConfirm={handleLogout} />}
    </>
  );

  const payments = dashboardData?.payments ?? {};
  const cashInHand = dashboardData
    ? dashboardData.openingAmt + dashboardData.cashSale - dashboardData.expCash
    : 0;

  const navigationGroups = [
    { label: 'Home', icon: <Home />, items: [{ label: 'Dashboard', icon: <LayoutDashboard /> }] },
    { label: 'Masters', icon: <ClipboardList />, items: [
      { label: 'Category', icon: <SlidersHorizontal /> },
      { label: 'Products', icon: <Package /> },
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
      { label: 'Multicounter', icon: <Users /> },
      { label: 'Device', icon: <Monitor /> },
      { label: 'Broadcast', icon: <Radio /> },
    ] },
    { label: 'Reports', icon: <ReceiptText />, items: [
      { label: 'Category Wise', icon: <SlidersHorizontal /> },
      { label: 'Product Wise', icon: <PackageSearch /> },
      { label: 'Stock Report', icon: <ClipboardCheck /> },
      { label: 'Stock Transfer Report', icon: <Accessibility /> },
      { label: 'Daywise Report', icon: <CalendarDays /> },
      { label: 'Shift Summary Report', icon: <Clock3 /> },
      { label: 'GST Report', icon: <Calculator /> },
      { label: 'GST Report Day Wise', icon: <CalendarCheck /> },
      { label: 'Bill Wise Sale Report', icon: <ReceiptText /> },
      { label: 'Stock In-Out Report', icon: <ClipboardList /> },
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
          {navigationGroups.map((group) => (
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
                  {group.items.map((item) => (
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
            <button className="theme-button" type="button" aria-label="Theme"><span>☾</span></button>
            <button className="notification-button" type="button" aria-label="Notifications"><Bell /><span>1</span></button>
            <div className="admin-chip"><span>{session.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><strong>{session.name}</strong><small>{session.role}</small></div><ChevronDown /></div>
          </div>
        </header>

        <main className="dashboard-workspace">
          {activeNavigation.id === 'Reports:Bill Wise Sale Report' ? (
            <BillWiseReportPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Category Wise' ? (
            <CategoryWiseReportPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Product Wise' ? (
            <ProductWiseReportPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Stock Report' ? (
            <StockReportPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:GST Report' ? (
            <GstReportPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Shift Summary Report' ? (
            <ShiftSummaryReportPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Category' ? (
            <CategoryPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : (
            <>
              <section className="page-hero">
                <div><h1>Retail POS Dashboard</h1><p>{selectedOutlet.name} · {activeNavigation.label} · Daily sales performance</p></div>
                <div className="hero-actions"><span>Shift {dashboardData?.shiftNo || '—'}</span><span>{dashboardData?.dayId || localDayId()}&nbsp;&nbsp; {clock}</span><button type="button"><Upload /> Export</button></div>
              </section>

              {dashboardLoading && <div className="dashboard-data-notice"><RefreshCw className="dashboard-data-spinner" /> Loading shift data…</div>}
              {!dashboardLoading && dashboardError && <div className="dashboard-data-notice error"><span>{dashboardError}</span><button type="button" onClick={() => setDashboardReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}

              <div className="dashboard-columns">
              <div className="dashboard-primary">
              <section className="kpi-grid" aria-label="Key sales figures">
                <KpiCard label="Cash In Hand" value={formatMoney(cashInHand)} tone="green" icon={<Banknote />} />
                <KpiCard label="Total Sale" value={formatMoney(dashboardData?.totalSale)} tone="cyan" icon={<TrendingUp />} />
                <KpiCard label="Total Digital Sale" value={formatMoney(dashboardData?.digitalSale)} tone="muted" icon={<span className="upi-wordmark">UPI</span>} />
              </section>

              <section className="payment-section">
                <div className="section-heading"><div><h2>Other Sales</h2><p>Sales by payment method</p></div><SlidersHorizontal /></div>
                <div className="payment-grid">
                  <PaymentTile label="Cash" value={formatMoney(payments.cash ?? dashboardData?.cashSale)} featured brand={<Banknote />} />
                  <PaymentTile label="Google Pay" value={formatMoney(payments.googlepay)} brand={<span className="google-pay-mark">G</span>} />
                  <PaymentTile label="PhonePe" value={formatMoney(payments.phonepe)} brand={<span className="phonepe-mark">पे</span>} />
                  <PaymentTile label="Paytm" value={formatMoney(payments.paytm)} brand={<span className="paytm-mark">paytm</span>} />
                  <PaymentTile label="Cheque" value={formatMoney(payments.cheque_payment_mode)} brand={<ReceiptText />} />
                  <PaymentTile label="Card" value={formatMoney(payments.card)} brand={<CreditCard />} />
                  <PaymentTile label="Credit" value={formatMoney(payments.credit ?? dashboardData?.creditSale)} brand={<WalletCards />} />
                  <PaymentTile label="Other" value={formatMoney(payments.other)} brand={<SlidersHorizontal />} />
                </div>
              </section>

              <section className="bottom-panels">
                <article className="detail-panel">
                  <h2>Operational Summary</h2>
                  <div className="detail-grid">
                    <MetricRow icon={<ReceiptText />} label="No. of Bills" value={String(dashboardData?.billCount ?? 0)} />
                    <MetricRow icon={<BadgeIndianRupee />} label="Total Discount" value={formatMoney(dashboardData?.discount)} />
                    <MetricRow icon={<WalletCards />} label="Opening Balance" value={formatMoney(dashboardData?.openingAmt)} />
                    <MetricRow icon={<span className="percent-icon">%</span>} label="Total Tax" value={formatMoney(dashboardData?.tax)} />
                    <MetricRow icon={<Gauge />} label="Refund Amount" value={formatMoney(dashboardData?.refundAmount)} />
                    <MetricRow icon={<WalletCards />} label="Extra Charge" value={formatMoney(dashboardData?.extraCharges)} />
                  </div>
                </article>
                <article className="detail-panel">
                  <h2>Expenses &amp; Credits</h2>
                  <div className="detail-grid expenses-grid">
                    <MetricRow label="Total Expenses" value={formatMoney(dashboardData?.expensesAmtTotal)} />
                    <MetricRow label="Advance Payment" value={formatMoney(dashboardData?.advanceAmtTotal)} />
                    <MetricRow label="Received Customer Credit" value={formatMoney(dashboardData?.customerReceiveAmtTotal)} />
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
                  <button type="button"><ShoppingCart /><span><strong>New Sale</strong><small>Start a new checkout</small></span></button>
                  <button type="button"><Upload /><span><strong>Upload Stock</strong><small>Import products from Excel</small></span></button>
                  <button type="button"><MessageSquareText /><span><strong>Broadcast</strong><small>Send a store update</small></span></button>
                </article>
                <article className="insight-card shift-card">
                  <h2>Current Shift</h2>
                  <div><span>Outlet</span><strong>{selectedOutlet.name}</strong></div>
                  <div><span>Branch</span><strong>{selectedOutlet.branch || 'Not specified'}</strong></div>
                  <div><span>Terminal</span><strong>{session.terminal}</strong></div>
                  <div><span>Cashier</span><strong>{session.name}</strong></div>
                  <div><span>Bills</span><strong>{dashboardData?.startBillNo || '—'} → {dashboardData?.lastBillNo || '—'}</strong></div>
                  <div><span>Status</span><strong className="status-active">{dashboardData ? (dashboardData.inActive ? 'Closed' : 'Active') : 'Unavailable'}</strong></div>
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
