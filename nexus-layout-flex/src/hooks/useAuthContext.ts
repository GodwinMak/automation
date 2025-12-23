import { useContext } from "react";
import { AuthContext, Permissions } from "@/Context/AuthContext";

export const useAuthContext = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw Error("useAuthContext must be used inside an AuthContextProvider");
  }

  return context;
};

// Convenience hook for checking permissions
export const usePermissions = () => {
  const { state, hasPermission } = useAuthContext();
  
  return {
    user: state.userData,
    isAuthenticated: !!state.userToken,
    isLoading: state.isLoading,
    hasPermission,
    canManageUsers: hasPermission("canManageUsers"),
    canConfigureCustomers: hasPermission("canConfigureCustomers"),
    canUpgradeCustomers: hasPermission("canUpgradeCustomers"),
    canViewCapacity: hasPermission("canViewCapacity"),
    canViewUptimeTrends: hasPermission("canViewUptimeTrends"),
    canViewChurnAnalysis: hasPermission("canViewChurnAnalysis"),
    canView95thReport: hasPermission("canView95thReport"),
  };
};
