import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Navbar } from "@/components/Navbar";
import { Outlet } from "react-router-dom";

// interface LayoutProps {
//   children: React.ReactNode;
// }

export function Layout() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-gradient-subtle">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Navbar />
          <main className="flex-1 overflow-auto">
            <div className=" mx-auto px-4 py-6 lg:px-6">
              <Outlet /> {/* renders child route */}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}