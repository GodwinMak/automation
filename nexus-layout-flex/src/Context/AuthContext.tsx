import React, {
  createContext,
  useReducer,
  useEffect,
  ReactNode,
  Dispatch,
} from "react";
import axios from "axios";
import { PRODUCTION_URL } from "@/utils/Api";

// Permission types
export type Permissions = {
  canManageUsers: boolean;
  canConfigureCustomers: boolean;
  canUpgradeCustomers: boolean;
  canViewCapacity: boolean;
  canViewUptimeTrends: boolean;
  canViewChurnAnalysis: boolean;
  canView95thReport: boolean;
  canManageNetworkMaps: boolean;
};

// Note: Watchlist is always personal - each user sees only their own watchlist

// User types
export type UserRole = "admin" | "operator" | "customer_relation";

// Flags granted to a specific person regardless of role (unlike
// Permissions above, which is entirely role-derived and shared by
// everyone with that role) — mirrors the backend's requireFlag()
// middleware (middleware/auth.js), used where access needs to be
// grantable to one individual without affecting their whole role.
export type UserFlag = "canViewProcessMonitoring";

export type User = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: Permissions;
  canViewProcessMonitoring: boolean;
  phoneNumber?: string | null;
  canReceiveIsisSms: boolean;
  highTrafficSmsEnabled: boolean;
  isisWatchScope: "all" | "watchlist";
};

type AuthState = {
  isLoading: boolean;
  isSignout: boolean;
  userToken: string | null;
  userData: User | null;
};

type AuthAction =
  | { type: "RESTORE_TOKEN"; payload: string | null }
  | { type: "RESTORE_DATA"; payload: User | null }
  | { type: "SIGN_IN_TOKEN"; payload: string }
  | { type: "SIGN_IN_DATA"; payload: User }
  | { type: "SIGN_OUT" }
  | { type: "SET_LOADING"; payload: boolean };

type AuthContextType = {
  state: AuthState;
  dispatch: Dispatch<AuthAction>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: keyof Permissions) => boolean;
  hasFlag: (flag: UserFlag) => boolean;
  isAdmin: () => boolean;
  isOperator: () => boolean;
  isCustomerRelation: () => boolean;
};

const initialState: AuthState = {
  isLoading: true,
  isSignout: false,
  userToken: null,
  userData: null,
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case "RESTORE_TOKEN":
      return { ...state, userToken: action.payload, isLoading: false };
    case "RESTORE_DATA":
      return { ...state, userData: action.payload, isLoading: false };
    case "SIGN_IN_TOKEN":
      return { ...state, isSignout: false, userToken: action.payload };
    case "SIGN_IN_DATA":
      return { ...state, isSignout: false, userData: action.payload };
    case "SIGN_OUT":
      return { ...state, isSignout: true, userToken: null, userData: null };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    default:
      return state;
  }
};

// Setup axios interceptor for auth headers
const setupAxiosInterceptor = (token: string | null) => {
  if (token) {
    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common["Authorization"];
  }
};

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        const userToken = localStorage.getItem("userToken");
        const userData = JSON.parse(localStorage.getItem("userData") || "null");

        if (userToken) {
          setupAxiosInterceptor(userToken);
          
          // Verify token is still valid by fetching profile
          try {
            const response = await axios.get(`${PRODUCTION_URL}/users/profile`);
            const user = response.data.user;
            localStorage.setItem("userData", JSON.stringify(user));
            dispatch({ type: "RESTORE_DATA", payload: user });
            dispatch({ type: "RESTORE_TOKEN", payload: userToken });
          } catch (error) {
            // Token is invalid, clear everything
            localStorage.removeItem("userToken");
            localStorage.removeItem("userData");
            setupAxiosInterceptor(null);
            dispatch({ type: "RESTORE_TOKEN", payload: null });
            dispatch({ type: "RESTORE_DATA", payload: null });
          }
        } else {
          dispatch({ type: "RESTORE_TOKEN", payload: null });
          dispatch({ type: "RESTORE_DATA", payload: null });
        }
      } catch (e) {
        console.error(e);
        dispatch({ type: "SET_LOADING", payload: false });
      }
    };

    bootstrapAsync();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await axios.post(`${PRODUCTION_URL}/users/login`, {
        email,
        password,
      });

      const { token, user } = response.data;

      localStorage.setItem("userToken", token);
      localStorage.setItem("userData", JSON.stringify(user));
      
      setupAxiosInterceptor(token);

      dispatch({ type: "SIGN_IN_TOKEN", payload: token });
      dispatch({ type: "SIGN_IN_DATA", payload: user });
    } catch (error: any) {
      throw new Error(error.response?.data?.message || "Login failed");
    }
  };

  const logout = () => {
    localStorage.removeItem("userToken");
    localStorage.removeItem("userData");
    setupAxiosInterceptor(null);
    dispatch({ type: "SIGN_OUT" });
  };

  const hasPermission = (permission: keyof Permissions): boolean => {
    if (!state.userData?.permissions) return false;
    return state.userData.permissions[permission] === true;
  };

  const hasFlag = (flag: UserFlag): boolean => {
    return state.userData?.[flag] === true;
  };

  const isAdmin = (): boolean => {
    return state.userData?.role === "admin";
  };

  const isOperator = (): boolean => {
    return state.userData?.role === "operator";
  };

  const isCustomerRelation = (): boolean => {
    return state.userData?.role === "customer_relation";
  };

  return (
    <AuthContext.Provider
      value={{
        state,
        dispatch,
        login,
        logout,
        hasPermission,
        hasFlag,
        isAdmin,
        isOperator,
        isCustomerRelation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export { AuthContext, AuthProvider };
