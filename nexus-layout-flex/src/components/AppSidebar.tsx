import {
  BarChart3,
  Home,
  Settings,
  LogOut,
  User,
  ChevronDown,
  ChevronRight,
  PieChart,
  TrendingUp,
  Users,
  Share2,
  Gauge,
  Star,
  LineChart,
  TrendingDown,
  FileSpreadsheet,
  Wifi,
  Cog,
  MonitorCog,
  UserCog,
  Tag,
  AlertTriangle,
  FileText,
  MapPin,
  Activity,
  Layers,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
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
import { useAuthContext } from "@/hooks/useAuthContext";
import { Permissions } from "@/Context/AuthContext";

type NavigationItem = {
  title: string;
  url?: string;
  icon: any;
  permission?: keyof Permissions;
  adminOnly?: boolean;
  children?: NavigationItem[];
};

const allNavigationItems: NavigationItem[] = [
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
    title: "Switch Map",
    url: "/switch-map",
    icon: MapPin,
  },
  {
    title: "ISIS Impact",
    url: "/isis-impact",
    icon: Activity,
    permission: "canViewUptimeTrends",

  },
  {
    title: "Customers",
    children: [
      { title: "DIA Customers", url: "/dia-customer", icon: PieChart },
      { title: "IPT Customers", url: "/ipt-customer", icon: TrendingUp },
      { title: "Shared Customers", url: "/shared-customer", icon: Share2 },
      { title: "L3VPN Customers", url: "/l3vpn-customer", icon: Layers },
      { title: "FTTH Customers", url: "/ftth-customer", icon: Wifi },
    ],
    icon: User,
  },
  {
    title: "Configurations",
    children: [
      {
        title: "DIA NO TAG",
        url: "/non-tag-dia",
        icon: MonitorCog,
        permission: "canConfigureCustomers",
      },
      {
        title: "DIA WITH TAG",
        url: "/with-tag-dia",
        icon: Tag,
        permission: "canConfigureCustomers",
      },
      {
        title: "Switch Configs",
        url: "/switch-configurations",
        icon: FileText,
        permission: "canConfigureCustomers",
      },
    ],
    icon: Cog,
    permission: "canConfigureCustomers",
  },
  {
    title: "Capacity",
    url: "/capacity",
    icon: Gauge,
    permission: "canViewCapacity",
  },
  {
    title: "DIA Over-Usage",
    url: "/dia-overusage-report",
    icon: AlertTriangle,
    permission: "canViewCapacity",
  },
  {
    title: "Pitch For Upgrade",
    url: "/pitch-for-upgrade",
    icon: FileSpreadsheet,
    permission: "canViewCapacity",
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
    permission: "canViewUptimeTrends",
  },
  {
    title: "Churn Analysis",
    url: "/churn-analysis",
    icon: TrendingDown,
    permission: "canViewChurnAnalysis",
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
    permission: "canView95thReport",
  },
  { title: "FTTH Reports", url: "/ftth-reports", icon: FileText },
  {
    title: "User Management",
    url: "/user-management",
    icon: UserCog,
    adminOnly: true,
  },
];

const settingsItems: NavigationItem[] = [
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
  const { state: sidebarState } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const navigate = useNavigate();
  const { state: authState, logout, hasPermission, isAdmin } = useAuthContext();

  // Filter navigation items based on permissions
  const navigationItems = useMemo(() => {
    const filterItems = (items: NavigationItem[]): NavigationItem[] => {
      return items
        .filter((item) => {
          // Check admin only
          if (item.adminOnly && !isAdmin()) {
            return false;
          }
          // Check permission
          if (item.permission && !hasPermission(item.permission)) {
            return false;
          }
          return true;
        })
        .map((item) => {
          // Filter children if any
          if (item.children) {
            const filteredChildren = filterItems(item.children);
            // Only include parent if it has children after filtering
            if (filteredChildren.length === 0) {
              return null;
            }
            return { ...item, children: filteredChildren };
          }
          return item;
        })
        .filter(Boolean) as NavigationItem[];
    };

    return filterItems(allNavigationItems);
  }, [authState.userData, hasPermission, isAdmin]);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      return currentPath === "/dashboard";
    }
    return currentPath.startsWith(path);
  };

  const isParentActive = (item: NavigationItem) => {
    if (item.url) return isActive(item.url);
    if (item.children) {
      return item.children.some((child) => child.url && isActive(child.url));
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

  // Get user role badge color
  const getRoleBadgeColor = () => {
    switch (authState.userData?.role) {
      case "admin":
        return "bg-red-500/20 text-red-400";
      case "operator":
        return "bg-blue-500/20 text-blue-400";
      case "customer_relation":
        return "bg-green-500/20 text-green-400";
      default:
        return "bg-gray-500/20 text-gray-400";
    }
  };

  const getRoleLabel = () => {
    switch (authState.userData?.role) {
      case "admin":
        return "Admin";
      case "operator":
        return "Operator";
      case "customer_relation":
        return "Customer Relation";
      default:
        return "";
    }
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-border overflow-x-hidden"
    >
      <SidebarContent className="bg-sidebar">
        {/* User Info */}
        {authState.userData && sidebarState === "expanded" && (
          <SidebarGroup>
            <div className="px-3 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {authState.userData.fullName || authState.userData.username}
                  </p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${getRoleBadgeColor()}`}
                  >
                    {getRoleLabel()}
                  </span>
                </div>
              </div>
            </div>
          </SidebarGroup>
        )}

        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
            Network Automation System
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
                          className={getNavClassName(undefined, isParentActive(item))}
                        >
                          <item.icon className="h-4 w-4" />
                          {sidebarState === "expanded" && (
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
                      {sidebarState === "expanded" && (
                        <CollapsibleContent className="transition-all duration-200 ease-in-out">
                          <SidebarMenu className="ml-2 mt-1 space-y-1 overflow-x-hidden">
                            {item.children.map((child) => (
                              <SidebarMenuItem key={child.title}>
                                <SidebarMenuButton asChild className="truncate">
                                  <NavLink
                                    to={child.url!}
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
                      <NavLink to={item.url!} className={getNavClassName(item.url)}>
                        <item.icon className="h-4 w-4" />
                        {sidebarState === "expanded" && <span>{item.title}</span>}
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
                      onClick={handleLogout}
                      className={getNavClassName(item.url)}
                    >
                      <item.icon className="h-4 w-4" />
                      {sidebarState === "expanded" && <span>{item.title}</span>}
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url!} className={getNavClassName(item.url)}>
                        <item.icon className="h-4 w-4" />
                        {sidebarState === "expanded" && <span>{item.title}</span>}
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
