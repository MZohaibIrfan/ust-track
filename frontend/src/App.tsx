import { Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { AdvisorPage } from "./pages/Advisor";
import { CoursesPage } from "./pages/Courses";
import { HomePage } from "./pages/Home";
import { ProgramsPage } from "./pages/Programs";
import { TimetablePage } from "./pages/Timetable";

export function App() {
  return (
    <div className="flex min-h-full flex-col bg-bg text-ink sm:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/advisor" element={<AdvisorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
