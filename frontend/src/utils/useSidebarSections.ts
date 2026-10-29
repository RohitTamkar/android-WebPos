import { useState } from 'react';

// Accordion sidebar: one section is open at a time. Opening a section closes the
// others; clicking the open section closes it. Moving to another page (including
// browser Back/Forward) opens that page's section so the active page stays visible.
// The Dashboard is always on screen, so the Home landing keeps Masters open as before.
export function useSidebarSections(screenId: string) {
  const sectionOf = (screen: string) => screen.split(':')[0] ?? '';
  const [openGroup, setOpenGroup] = useState<string | null>(sectionOf(screenId) === 'Home' ? 'Masters' : sectionOf(screenId));
  // Reset during render when the page changes (React's recommended pattern; no extra effect pass).
  const [shownFor, setShownFor] = useState(screenId);
  if (shownFor !== screenId) { setShownFor(screenId); setOpenGroup(sectionOf(screenId)); }
  const toggleGroup = (group: string) => setOpenGroup(current => current === group ? null : group);
  return { openGroup, toggleGroup };
}
