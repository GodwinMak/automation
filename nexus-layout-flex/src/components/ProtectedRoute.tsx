import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthContext } from "@/hooks/useAuthContext";
import { Permissions } from "@/Context/AuthContext";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: keyof Permissions;
  requiredRoles?: Array<"admin" | "operator" | "customer_relation">;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredPermission,
  requiredRoles,
}) => {
  const { state, hasPermission } = useAuthContext();
  const location = useLocation();

  // Show loading state
  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!state.userToken || !state.userData) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  // Check role requirement
  if (requiredRoles && !requiredRoles.includes(state.userData.role)) {
    return <AccessDenied message="You don't have the required role to access this page." />;
  }

  // Check permission requirement
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <AccessDenied message={`You don't have permission to access this feature.`} />;
  }

  return <>{children}</>;
};

const AccessDenied: React.FC<{ message: string }> = ({ message }) => {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-xl">Access Denied</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">{message}</p>
          <Button variant="outline" onClick={() => window.history.back()}>
            Go Back
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProtectedRoute;

