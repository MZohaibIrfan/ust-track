import { Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { CareerPage } from "./pages/Career";
import { DegreePage } from "./pages/Degree";
import { HistoryPage } from "./pages/History";
import { OverviewPage } from "./pages/Overview";
import { ProfilePage } from "./pages/Profile";
import { TimetablePage } from "./pages/Timetable";

// Every page is kept mounted and just shown/hidden by path, instead of being
// unmounted by react-router's <Routes> — switching tabs used to wipe chat
// history and in-flight advisor streams because the page component itself
// was torn down. Staying mounted means that state just sits there again
// when you switch back.
const pages = [
  { path: "/", element: <OverviewPage /> },
  { path: "/timetable", element: <TimetablePage /> },
  { path: "/degree", element: <DegreePage /> },
  { path: "/history", element: <HistoryPage /> },
  { path: "/career", element: <CareerPage /> },
  { path: "/profile", element: <ProfilePage /> },
];

export function App() {
  const location = useLocation();

  if (!pages.some((page) => page.path === location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-bg text-ink sm:flex-row">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {pages.map((page) => (
          <div
            key={page.path}
            className={location.pathname === page.path ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            {page.element}
          </div>
        ))}
      </div>
    </div>
  );
}
