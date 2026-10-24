// Temporary master switch for both frontend and backend. Rebuild/restart both
// applications after changing this. No daily counters, leases or limits run
// while false; ordinary login and outlet authorization remain required.
export const DAILY_WEB_USAGE_ENABLED: boolean = false;
