import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, LogOut, MapPin, RefreshCw, Search, Store, X } from 'lucide-react';
import type { UserSession } from './LoginPage.tsx';
import './OutletSelectionPage.css';

export interface OutletSummary {
  id: string;
  name: string;
  branch: string;
  country: string;
  dealerCode: string;
  fssaiNo: string;
  businessId: string;
  restaurantId: string;
  active: boolean;
  renewalDate: number | null;
  isPrimary: boolean;
}

interface OutletSelectionPageProps {
  session: UserSession;
  onSelect: (outlet: OutletSummary) => void;
  onLogout: () => void;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Not available';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(timestamp));
}

export const OutletSelectionPage = ({ session, onSelect, onLogout }: OutletSelectionPageProps) => {
  const [outlets, setOutlets] = useState<OutletSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOutlets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return outlets;

    return outlets.filter(outlet => [
      outlet.name,
      outlet.branch,
      outlet.country,
      outlet.id,
      outlet.dealerCode,
      outlet.fssaiNo,
    ].some(value => value.toLowerCase().includes(query)));
  }, [outlets, searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      setError('Loading outlets timed out. Please try again.');
      setLoading(false);
    }, 15000);

    const loadOutlets = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/auth/outlets', {
          headers: { Authorization: `Bearer ${session.token}` },
          signal: controller.signal,
        });
        const result = await response.json() as {
          success: boolean;
          message?: string;
          data?: { outlets: OutletSummary[] };
        };

        if (response.status === 401) {
          onLogout();
          return;
        }
        if (!response.ok || !result.data) {
          setError(result.message || 'Unable to load your outlets.');
          return;
        }
        setOutlets(result.data.outlets);
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError' && !timedOut) {
          setError('Cannot reach the server. Please try again.');
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadOutlets();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [session.token, onLogout, reloadKey]);

  return (
    <main className="outlet-selection-page">
      <header className="outlet-selection-header">
        <span className="outlet-logo-crop"><img src="/logo1.png" alt="Sensible Connect" /></span>
        <div>
          <span>Signed in as</span>
          <strong>{session.name}</strong>
        </div>
        <button type="button" onClick={onLogout}><LogOut /> Sign out</button>
      </header>

      <section className="outlet-selection-content">
        <div className="outlet-selection-title">
          <span>POS WORKSPACE</span>
          <h1>Select an outlet</h1>
          <p>Choose the business location you want to manage for this session.</p>
        </div>

        {!loading && !error && outlets.length > 0 && (
          <div className="outlet-search-wrap">
            <Search />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search by outlet name, branch, ID or dealer code"
              aria-label="Search outlets"
            />
            {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear outlet search"><X /></button>}
            <span>{filteredOutlets.length} of {outlets.length}</span>
          </div>
        )}

        {loading && <div className="outlet-state-card"><RefreshCw className="outlet-spinner" /><strong>Loading your outlets…</strong></div>}

        {!loading && error && (
          <div className="outlet-state-card error">
            <strong>{error}</strong>
            <button type="button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw /> Try again</button>
          </div>
        )}

        {!loading && !error && outlets.length === 0 && (
          <div className="outlet-state-card"><Store /><strong>No outlets are assigned to this account.</strong><p>Ask your administrator to update USER_PROFILE.outlets.</p></div>
        )}

        {!loading && !error && outlets.length > 0 && filteredOutlets.length === 0 && (
          <div className="outlet-state-card outlet-no-results">
            <Search />
            <strong>No matching outlets found.</strong>
            <p>Try searching with a different name, branch, ID, or dealer code.</p>
            <button type="button" onClick={() => setSearchQuery('')}><X /> Clear search</button>
          </div>
        )}

        {!loading && !error && filteredOutlets.length > 0 && (
          <div className="outlet-card-grid">
            {filteredOutlets.map(outlet => (
              <article className={`outlet-card ${!outlet.active ? 'inactive' : ''}`} key={outlet.id}>
                <div className="outlet-card-heading">
                  <span className="outlet-icon"><Building2 /></span>
                  <div><h2>{outlet.name}</h2><p><MapPin /> {outlet.branch || outlet.country || 'Branch not specified'}</p></div>
                  {outlet.isPrimary && <span className="primary-badge">Primary</span>}
                </div>
                <dl>
                  <div><dt>Outlet ID</dt><dd>{outlet.id}</dd></div>
                  <div><dt>Dealer code</dt><dd>{outlet.dealerCode || '—'}</dd></div>
                  <div><dt>FSSAI number</dt><dd>{outlet.fssaiNo || '—'}</dd></div>
                  <div><dt><CalendarDays /> Renewal</dt><dd>{formatDate(outlet.renewalDate)}</dd></div>
                </dl>
                <div className="outlet-card-footer">
                  <span className={outlet.active ? 'active' : 'inactive'}>{outlet.active ? 'Active' : 'Inactive'}</span>
                  <button type="button" disabled={!outlet.active} onClick={() => onSelect(outlet)}>Open outlet</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};
