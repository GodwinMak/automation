import React, {
  createContext,
  useReducer,
  useEffect,
  ReactNode,
  Dispatch,
} from "react";

type AuthState = {
  isLoading: boolean;
  isSignout: boolean;
  userToken: string | null;
  userData: any | null; // change "any" to your user type if you have one
};

type AuthAction =
  | { type: "RESTORE_TOKEN"; payload: string | null }
  | { type: "RESTORE_DATA"; payload: any | null }
  | { type: "SIGN_IN_TOKEN"; payload: string }
  | { type: "SIGN_IN_DATA"; payload: any }
  | { type: "SIGN_OUT" };

type AuthContextType = {
  state: AuthState;
  dispatch: Dispatch<AuthAction>;
};

const initialState: AuthState = {
  isLoading: true,
  isSignout: false,
  userToken: null,
  userData: null,
};

// ✅ strongly typed context
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
    default:
      return state;
  }
};

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        const userToken = localStorage.getItem("userToken");
        const userData = JSON.parse(localStorage.getItem("userData") || "null");

        dispatch({ type: "RESTORE_TOKEN", payload: userToken });
        dispatch({ type: "RESTORE_DATA", payload: userData });
      } catch (e) {
        console.error(e);
      }
    };

    bootstrapAsync();
  }, []);

  return (
    <AuthContext.Provider value={{ state, dispatch }}>
      {children}
    </AuthContext.Provider>
  );
};

export { AuthContext, AuthProvider };