import { Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { CareerPage } from "./pages/Career";
import { DegreePage } from "./pages/Degree";
import { OverviewPage } from "./pages/Overview";
import { TimetablePage } from "./pages/Timetable";

export function App() {
  return (
    <div className="flex min-h-full flex-col bg-bg text-ink sm:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/degree" element={<DegreePage />} />
          <Route path="/career" element={<CareerPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
