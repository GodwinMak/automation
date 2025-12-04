import {
  BarChart3,
  Home,
  Settings,
  LogOut,
  User,
  Activity,
  ChevronDown,
  ChevronRight,
  PieChart,
  TrendingUp,
  Calendar,
  Bell,
  ClipboardList,
  Users,
  ReceiptText,
  Share2,
  Gauge,
  Star,
  LineChart,
  TrendingDown,
  FileSpreadsheet,
  Wifi,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
// import { useAuthContext } from "@/hooks/useAuthContext";

const navigationItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Switches",
    url: "/switches",
    icon: Users,
  },
  {
    title: "Customers",
    children: [
      { title: "DIA Customers", url: "/dia-customer", icon: PieChart },
      { title: "IPT Customers", url: "/ipt-customer", icon: TrendingUp },
      { title: "Shared Customers", url: "/shared-customer", icon: Share2 },
    ],
    icon: User,
  },
  {
    title: "Capacity",
    url: "/capacity",
    icon: Gauge,
  },
  {
    title: "Watchlist",
    url: "/watchlist",
    icon: Star,
  },
  {
    title: "Uptime Trends",
    url: "/uptime-trends",
    icon: LineChart,
  },
  {
    title: "Churn Analysis",
    url: "/churn-analysis",
    icon: TrendingDown,
  },
  {
    title: "95th Report",
    children: [
      { title: "IPT Report", url: "/ipt-report", icon: FileSpreadsheet },
      { title: "DIA Report", url: "/dia-report", icon: FileSpreadsheet },
      { title: "GPON Report", url: "/gpon-report", icon: Wifi },
      { title: "Combined Report", url: "/combined-report", icon: BarChart3 },
    ],
    icon: BarChart3,
  },
];

const settingsItems = [
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
  {
    title: "Logout",
    url: "/logout",
    icon: LogOut,
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [stats, setStats] = useState({});
  // const user = JSON.parse(localStorage.getItem("userData"));
  // const userRole = user?.user_type;
  // const { dispatch } = useAuthContext();

  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("userToken");
    localStorage.removeItem("userData");
    // dispatch({ type: "SIGN_OUT" });
    navigate("/");
  };

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      return currentPath === "/dashboard";
    }
    return currentPath.startsWith(path);
  };

  const isParentActive = (item: any) => {
    if (item.url) return isActive(item.url);
    if (item.children) {
      return item.children.some((child: any) => isActive(child.url));
    }
    return false;
  };

  const toggleDropdown = (title: string) => {
    setOpenDropdown((prev) => (prev === title ? null : title));
  };

  const isDropdownOpen = (title: string) => openDropdown === title;

  const getNavClassName = (path?: string, isParent?: boolean) => {
    const baseClass =
      "flex items-center gap-2 w-full text-left transition-colors duration-200";
    if (path && isActive(path)) {
      return `${baseClass} bg-accent text-accent-foreground font-medium`;
    }
    if (isParent) {
      return `${baseClass} hover:bg-accent/50 text-muted-foreground hover:text-foreground`;
    }
    return `${baseClass} hover:bg-accent/50 text-muted-foreground hover:text-foreground`;
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-border overflow-x-hidden"
    >
      <SidebarContent className="bg-sidebar">
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
            DIA DASHBOARD
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {item.children ? (
                    <Collapsible
                      open={isDropdownOpen(item.title)}
                      onOpenChange={() => toggleDropdown(item.title)}
                    >
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          className={getNavClassName(
                            undefined,
                            isParentActive(item)
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          {state === "expanded" && (
                            <>
                              <span className="flex-1">{item.title}</span>
                              {isDropdownOpen(item.title) ? (
                                <ChevronDown className="h-4 w-4 transition-transform" />
                              ) : (
                                <ChevronRight className="h-4 w-4 transition-transform" />
                              )}
                            </>
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      {state === "expanded" && (
                        <CollapsibleContent className="transition-all duration-200 ease-in-out">
                          <SidebarMenu className="ml-2 mt-1 space-y-1 overflow-x-hidden">
                            {item.children.map((child) => (
                              <SidebarMenuItem key={child.title}>
                                <SidebarMenuButton asChild className="truncate">
                                  <NavLink
                                    to={child.url}
                                    className={getNavClassName(child.url)}
                                  >
                                    <child.icon className="h-3 w-3 shrink-0" />
                                    <span className="text-sm truncate">
                                      {child.title}
                                    </span>
                                  </NavLink>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            ))}
                          </SidebarMenu>
                        </CollapsibleContent>
                      )}
                    </Collapsible>
                  ) : (
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className={getNavClassName(item.url)}
                      >
                        <item.icon className="h-4 w-4" />
                        {state === "expanded" && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Settings & Account */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
            Account
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {item.title === "Logout" ? (
                    <SidebarMenuButton
                      onClick={handleLogout} // ✅ Call your logout handler
                      className={getNavClassName(item.url)}
                    >
                      <item.icon className="h-4 w-4" />
                      {state === "expanded" && <span>{item.title}</span>}
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className={getNavClassName(item.url)}
                      >
                        <item.icon className="h-4 w-4" />
                        {state === "expanded" && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
